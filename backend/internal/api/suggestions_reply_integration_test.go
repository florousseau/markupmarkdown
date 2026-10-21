package api_test

// Integration tests for suggestions carried by REPLIES (the in-thread
// fix loop): creation over REST and MCP, the active-suggestion rule,
// the reply apply endpoint, occurrence-correct application when the
// anchored text repeats, the batch apply, carry-forward, realtime
// broadcast, and the human-only apply rule.

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/v2/bson"

	"markupmarkdown/internal/mcpserver"
	"markupmarkdown/internal/models"
	"markupmarkdown/internal/testutil"
)

// "The cat" appears twice; the comments target the SECOND one.
const twoCats = "# Pets\n\nThe cat sat on the mat. The cat ran away.\n"

// insertAnchoredComment inserts a human comment whose anchor carries
// rendered-text context, the way the UI now creates them.
func insertAnchoredComment(t *testing.T, st interface {
	InsertComment(ctx context.Context, c *models.Comment) error
}, docID, authorID string, anchor models.Anchor, root *models.Suggestion) *models.Comment {
	t.Helper()
	now := time.Now().UTC()
	if anchor.End == 0 {
		anchor.Start, anchor.End = 1, 1+len(anchor.Exact)
	}
	c := &models.Comment{
		ID: uuid.NewString(), DocumentID: docID, Anchor: anchor,
		Author: "reviewer", AuthorID: authorID, ActorKind: models.ActorHuman,
		Body: "Please change this.", Replies: []models.Reply{},
		Suggestion: root, CreatedAt: now, UpdatedAt: now,
	}
	if err := st.InsertComment(context.Background(), c); err != nil {
		t.Fatalf("insert: %v", err)
	}
	return c
}

func secondCatAnchor() models.Anchor {
	return models.Anchor{Exact: "The cat", Prefix: "sat on the mat. ", Suffix: " ran away."}
}

func replyWithSuggestion(t *testing.T, srvURL string, do func(method, path string, body any) (int, []byte), commentID, replacement string) models.Comment {
	t.Helper()
	status, body := do("POST", "/api/comments/"+commentID+"/replies", map[string]any{
		"body": "Here's a fix.", "suggestion": map[string]any{"replacement": replacement},
	})
	if status != 201 {
		t.Fatalf("reply status=%d body=%s", status, body)
	}
	var c models.Comment
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return c
}

func TestReplySuggestion_RESTCreateAndActiveFlags(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
	c := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(),
		&models.Suggestion{Replacement: "A cat"})
	do := func(m, p string, b any) (int, []byte) { return doJSON(t, srv, m, p, b, withCookie(sess)) }

	got := replyWithSuggestion(t, srv.URL, do, c.ID, "A dog")
	if len(got.Replies) != 1 || got.Replies[0].Suggestion == nil ||
		got.Replies[0].Suggestion.Replacement != "A dog" {
		t.Fatalf("reply suggestion missing: %+v", got.Replies)
	}
	if !got.Replies[0].Suggestion.Active {
		t.Error("newest suggestion should be active in the response")
	}
	if got.Suggestion == nil || !got.Suggestion.Superseded {
		t.Errorf("root suggestion should be superseded: %+v", got.Suggestion)
	}

	// Same flags on the list endpoint.
	_, body := do("GET", "/api/documents/"+doc.ID+"/comments", nil)
	var list []models.Comment
	mustDecode(t, body, &list)
	if len(list) != 1 || !list[0].Replies[0].Suggestion.Active || !list[0].Suggestion.Superseded {
		t.Fatalf("list flags wrong: %s", body)
	}
	// Flags are never persisted.
	raw, _ := st.GetComment(context.Background(), c.ID)
	if raw.Replies[0].Suggestion.Active || raw.Suggestion.Superseded {
		t.Error("read-time flags leaked into the store")
	}
}

func TestReplySuggestion_RESTRefusals(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	doc := testutil.NewTestDocument(t, st, user.ID, twoCats)

	docLevel := insertAnchoredComment(t, st, doc.ID, user.ID, models.Anchor{}, nil)
	_, _ = st.Comments().UpdateOne(context.Background(), bson.M{"_id": docLevel.ID},
		bson.M{"$set": bson.M{"anchor.start": 0, "anchor.end": 0}})
	orphan := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(), nil)
	_, _ = st.Comments().UpdateOne(context.Background(), bson.M{"_id": orphan.ID},
		bson.M{"$set": bson.M{"orphan": true}})
	resolved := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(), nil)
	_, _ = st.Comments().UpdateOne(context.Background(), bson.M{"_id": resolved.ID},
		bson.M{"$set": bson.M{"resolved": true}})
	open := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(), nil)

	cases := []struct {
		name, id, repl string
		want           int
	}{
		{"doc-level", docLevel.ID, "x", 400},
		{"orphan", orphan.ID, "x", 400},
		{"resolved", resolved.ID, "x", 409},
		{"no-op", open.ID, "The cat", 400},
		{"empty", open.ID, "", 400},
	}
	for _, tc := range cases {
		status, body := doJSON(t, srv, "POST", "/api/comments/"+tc.id+"/replies", map[string]any{
			"body": "fix", "suggestion": map[string]any{"replacement": tc.repl},
		}, withCookie(sess))
		if status != tc.want {
			t.Errorf("%s: status=%d want %d body=%s", tc.name, status, tc.want, body)
		}
	}
	// Nothing was appended on refusal.
	got, _ := st.GetComment(context.Background(), open.ID)
	if len(got.Replies) != 0 {
		t.Errorf("refused reply was stored: %+v", got.Replies)
	}
}

func TestReplySuggestion_MCPAPI(t *testing.T) {
	_, st, a := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	_, tok := testutil.NewAPIToken(t, st, user.ID, models.TokenScopeWrite)
	doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
	c := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(), nil)

	got, err := a.ReplyToComment(context.Background(), user.ID, c.ID, "fix", "A dog", tok.ID, "bot")
	if err != nil {
		t.Fatalf("reply: %v", err)
	}
	r := got.Replies[0]
	if r.Suggestion == nil || r.Suggestion.Replacement != "A dog" || !r.Suggestion.Active {
		t.Fatalf("suggestion: %+v", r.Suggestion)
	}
	if r.ActorKind != models.ActorAgent {
		t.Errorf("actor kind = %q", r.ActorKind)
	}
	// Without replacement: plain reply, as before.
	got, err = a.ReplyToComment(context.Background(), user.ID, c.ID, "just talk", "", tok.ID, "bot")
	if err != nil || got.Replies[1].Suggestion != nil {
		t.Fatalf("plain reply: %v %+v", err, got.Replies[1])
	}

	docLevel := insertAnchoredComment(t, st, doc.ID, user.ID, models.Anchor{}, nil)
	_, _ = st.Comments().UpdateOne(context.Background(), bson.M{"_id": docLevel.ID},
		bson.M{"$set": bson.M{"anchor.start": 0, "anchor.end": 0}})
	if _, err := a.ReplyToComment(context.Background(), user.ID, docLevel.ID, "fix", "A dog", tok.ID, "bot"); err == nil ||
		!strings.Contains(err.Error(), "doc-level") {
		t.Errorf("doc-level should be refused, got %v", err)
	}

	// list_comments surfaces the flags.
	list, err := a.ListComments(context.Background(), doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, lc := range list {
		if lc.ID == c.ID && !lc.Replies[0].Suggestion.Active {
			t.Error("ListComments must mark the active suggestion")
		}
	}
}

// TestReplySuggestion_MCPOverHTTP drives the real /mcp handler with a
// Bearer token: JSON-RPC tools/call "reply" with a replacement.
func TestReplySuggestion_MCPOverHTTP(t *testing.T) {
	_, st, a := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	plain, _ := testutil.NewAPIToken(t, st, user.ID, models.TokenScopeWrite)
	doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
	c := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(), nil)

	mcpSrv := httptest.NewServer(mcpserver.New(a, st, "http://example.test"))
	defer mcpSrv.Close()
	call := func(payload string) (int, string) {
		req, _ := http.NewRequest("POST", mcpSrv.URL+"/mcp", strings.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+plain)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		res, err := mcpSrv.Client().Do(req)
		if err != nil {
			t.Fatalf("mcp call: %v", err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	_, _ = call(`{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}`)
	status, out := call(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"reply","arguments":{"comment_id":"` +
		c.ID + `","body":"Proposed fix","replacement":"A dog"}}}`)
	if status != 200 || strings.Contains(out, `"isError":true`) {
		t.Fatalf("status=%d out=%s", status, out)
	}
	got, _ := st.GetComment(context.Background(), c.ID)
	if len(got.Replies) != 1 || got.Replies[0].Suggestion == nil ||
		got.Replies[0].Suggestion.Replacement != "A dog" || got.Replies[0].TokenID == "" {
		t.Fatalf("stored reply: %+v", got.Replies)
	}
}

func TestReplySuggestion_ApplyHappyPathThen409(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
	c := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(), nil)
	do := func(m, p string, b any) (int, []byte) { return doJSON(t, srv, m, p, b, withCookie(sess)) }
	got := replyWithSuggestion(t, srv.URL, do, c.ID, "A dog")
	rid := got.Replies[0].ID

	status, body := do("POST", "/api/comments/"+c.ID+"/replies/"+rid+"/apply-suggestion", nil)
	if status != 201 {
		t.Fatalf("apply status=%d body=%s", status, body)
	}
	var child models.Document
	mustDecode(t, body, &child)
	// The SECOND occurrence changed, the first did not.
	want := "# Pets\n\nThe cat sat on the mat. A dog ran away.\n"
	if child.Content != want {
		t.Fatalf("content=%q want %q", child.Content, want)
	}
	if child.ParentID != doc.ID || child.RevisionMeta == nil || child.RevisionMeta.Model != "suggestion" {
		t.Errorf("revision meta: %+v parent=%s", child.RevisionMeta, child.ParentID)
	}
	thread, _ := st.GetComment(context.Background(), c.ID)
	if !thread.Resolved {
		t.Error("thread not resolved")
	}
	s := thread.Replies[0].Suggestion
	if s.AppliedAt == nil || s.AppliedDocID != child.ID || s.AppliedByID != user.ID {
		t.Errorf("stamp: %+v", s)
	}
	// Second apply → 409, no new revision.
	status, _ = do("POST", "/api/comments/"+c.ID+"/replies/"+rid+"/apply-suggestion", nil)
	if status != 409 {
		t.Errorf("second apply status=%d want 409", status)
	}
	kids, _ := st.Documents().CountDocuments(context.Background(), bson.M{"parent_id": doc.ID})
	if kids != 1 {
		t.Errorf("children=%d want 1", kids)
	}
	// Unknown reply → 404.
	status, _ = do("POST", "/api/comments/"+c.ID+"/replies/nope/apply-suggestion", nil)
	if status != 404 {
		t.Errorf("unknown reply status=%d want 404", status)
	}
}

func TestReplySuggestion_SupersededRefused(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
	c := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(),
		&models.Suggestion{Replacement: "A cow"})
	do := func(m, p string, b any) (int, []byte) { return doJSON(t, srv, m, p, b, withCookie(sess)) }
	first := replyWithSuggestion(t, srv.URL, do, c.ID, "A dog")
	second := replyWithSuggestion(t, srv.URL, do, c.ID, "A fox")
	r1, r2 := first.Replies[0].ID, second.Replies[1].ID

	if status, body := do("POST", "/api/comments/"+c.ID+"/apply-suggestion", nil); status != 409 {
		t.Errorf("superseded root: status=%d body=%s", status, body)
	}
	if status, body := do("POST", "/api/comments/"+c.ID+"/replies/"+r1+"/apply-suggestion", nil); status != 409 {
		t.Errorf("superseded reply: status=%d body=%s", status, body)
	}
	status, body := do("POST", "/api/comments/"+c.ID+"/replies/"+r2+"/apply-suggestion", nil)
	if status != 201 || !strings.Contains(string(body), "A fox ran away.") {
		t.Fatalf("active apply: status=%d body=%s", status, body)
	}
}

func TestSuggestionApply_DuplicateText(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)

	t.Run("root targets second occurrence", func(t *testing.T) {
		doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
		c := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(),
			&models.Suggestion{Replacement: "A dog"})
		status, body := doJSON(t, srv, "POST", "/api/comments/"+c.ID+"/apply-suggestion", nil, withCookie(sess))
		if status != 201 {
			t.Fatalf("status=%d body=%s", status, body)
		}
		var child models.Document
		mustDecode(t, body, &child)
		if child.Content != "# Pets\n\nThe cat sat on the mat. A dog ran away.\n" {
			t.Fatalf("content=%q", child.Content)
		}
	})
	t.Run("ambiguous root is refused", func(t *testing.T) {
		doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
		// Legacy comment: no context, offsets zeroed by a carry.
		c := insertAnchoredComment(t, st, doc.ID, user.ID, models.Anchor{Exact: "The cat"},
			&models.Suggestion{Replacement: "A dog"})
		_, _ = st.Comments().UpdateOne(context.Background(), bson.M{"_id": c.ID},
			bson.M{"$set": bson.M{"anchor.start": 0, "anchor.end": 0}})
		status, body := doJSON(t, srv, "POST", "/api/comments/"+c.ID+"/apply-suggestion", nil, withCookie(sess))
		if status != 409 || !strings.Contains(string(body), "several times") {
			t.Fatalf("status=%d body=%s want 409 ambiguous", status, body)
		}
		got, _ := st.GetComment(context.Background(), c.ID)
		if got.Resolved || got.Suggestion.AppliedAt != nil {
			t.Error("refused apply must leave the thread untouched")
		}
	})
	t.Run("ambiguous reply is refused", func(t *testing.T) {
		doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
		c := insertAnchoredComment(t, st, doc.ID, user.ID, models.Anchor{Exact: "The cat"}, nil)
		_, _ = st.Comments().UpdateOne(context.Background(), bson.M{"_id": c.ID},
			bson.M{"$set": bson.M{"anchor.start": 0, "anchor.end": 0}})
		do := func(m, p string, b any) (int, []byte) { return doJSON(t, srv, m, p, b, withCookie(sess)) }
		got := replyWithSuggestion(t, srv.URL, do, c.ID, "A dog")
		status, _ := do("POST", "/api/comments/"+c.ID+"/replies/"+got.Replies[0].ID+"/apply-suggestion", nil)
		if status != 409 {
			t.Fatalf("status=%d want 409", status)
		}
	})
}

func TestSuggestionApply_TokensForbidden(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	plain, _ := testutil.NewAPIToken(t, st, user.ID, models.TokenScopeAdmin)
	doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
	c := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(), nil)
	do := func(m, p string, b any) (int, []byte) { return doJSON(t, srv, m, p, b, withCookie(sess)) }
	got := replyWithSuggestion(t, srv.URL, do, c.ID, "A dog")

	for _, path := range []string{
		"/api/comments/" + c.ID + "/apply-suggestion",
		"/api/comments/" + c.ID + "/replies/" + got.Replies[0].ID + "/apply-suggestion",
		"/api/documents/" + doc.ID + "/apply-suggestions",
	} {
		if status, body := doJSON(t, srv, "POST", path, nil, withBearer(plain)); status != 403 {
			t.Errorf("%s: status=%d want 403 body=%s", path, status, body)
		}
	}
	thread, _ := st.GetComment(context.Background(), c.ID)
	if thread.Resolved {
		t.Error("token apply must not touch the thread")
	}
}

func TestApplyAllSuggestions_ActiveRootAndReplyMix(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	content := "# Doc\n\nAlpha one. Beta two. Gamma three. The cat x. The cat y.\n"
	doc := testutil.NewTestDocument(t, st, user.ID, content)
	do := func(m, p string, b any) (int, []byte) { return doJSON(t, srv, m, p, b, withCookie(sess)) }

	// 1) root suggestion, active.
	alpha := insertAnchoredComment(t, st, doc.ID, user.ID, models.Anchor{Exact: "Alpha one"},
		&models.Suggestion{Replacement: "ALPHA"})
	// 2) root superseded by a reply: only the reply's text applies.
	beta := insertAnchoredComment(t, st, doc.ID, user.ID, models.Anchor{Exact: "Beta two"},
		&models.Suggestion{Replacement: "WRONG"})
	replyWithSuggestion(t, srv.URL, do, beta.ID, "BETA")
	// 3) overlaps (2): "two. Gamma" is consumed by the Beta edit.
	overlap := insertAnchoredComment(t, st, doc.ID, user.ID, models.Anchor{Exact: "two. Gamma"},
		&models.Suggestion{Replacement: "zzz"})
	// 4) duplicated text with context → second occurrence.
	cat := insertAnchoredComment(t, st, doc.ID, user.ID,
		models.Anchor{Exact: "The cat", Prefix: "x. ", Suffix: " y."}, nil)
	replyWithSuggestion(t, srv.URL, do, cat.ID, "A dog")
	// 5) duplicated text without context → skipped as ambiguous.
	amb := insertAnchoredComment(t, st, doc.ID, user.ID, models.Anchor{Exact: "The cat"}, nil)
	_, _ = st.Comments().UpdateOne(context.Background(), bson.M{"_id": amb.ID},
		bson.M{"$set": bson.M{"anchor.start": 0, "anchor.end": 0}})
	replyWithSuggestion(t, srv.URL, do, amb.ID, "A cow")

	status, body := do("POST", "/api/documents/"+doc.ID+"/apply-suggestions", nil)
	if status != 201 {
		t.Fatalf("status=%d body=%s", status, body)
	}
	var res struct {
		Document models.Document `json:"document"`
		Applied  []string        `json:"applied"`
		Skipped  []struct {
			CommentID string `json:"commentId"`
			ReplyID   string `json:"replyId"`
			Reason    string `json:"reason"`
		} `json:"skipped"`
	}
	mustDecode(t, body, &res)
	want := "# Doc\n\nALPHA. BETA. Gamma three. The cat x. A dog y.\n"
	if res.Document.Content != want {
		t.Fatalf("content=%q\nwant   %q", res.Document.Content, want)
	}
	if len(res.Applied) != 3 {
		t.Errorf("applied=%v want 3 threads", res.Applied)
	}
	reasons := map[string]string{}
	for _, s := range res.Skipped {
		reasons[s.CommentID] = s.Reason
	}
	if !strings.Contains(reasons[overlap.ID], "overlaps") {
		t.Errorf("overlap not reported: %+v", res.Skipped)
	}
	if !strings.Contains(reasons[amb.ID], "several times") || len(res.Skipped) != 2 {
		t.Errorf("ambiguous not reported: %+v", res.Skipped)
	}
	// Applied threads resolved; skipped ones stay open and are carried
	// to the new revision WITH their suggestions.
	for _, id := range []string{alpha.ID, beta.ID, cat.ID} {
		if c, _ := st.GetComment(context.Background(), id); !c.Resolved {
			t.Errorf("thread %s not resolved", id)
		}
	}
	betaThread, _ := st.GetComment(context.Background(), beta.ID)
	if betaThread.Suggestion.AppliedAt != nil || betaThread.Replies[0].Suggestion.AppliedAt == nil {
		t.Errorf("beta: the reply suggestion (not the superseded root) must be stamped")
	}
	carried, _ := st.ListComments(context.Background(), res.Document.ID)
	if len(carried) != 2 {
		t.Fatalf("carried=%d want 2", len(carried))
	}
	for _, c := range carried {
		if c.Body == "" {
			continue
		}
		if c.Anchor.Exact == "The cat" && (len(c.Replies) != 1 || c.Replies[0].Suggestion == nil) {
			t.Errorf("reply suggestion lost on carry: %+v", c.Replies)
		}
		if c.Anchor.Exact == "two. Gamma" && c.Suggestion == nil {
			t.Error("root suggestion lost on carry")
		}
	}
}

// TestSuggestionApply_BroadcastsCommentsUpdatedOnParent: a second tab
// on the parent revision must learn the thread is now resolved.
func TestSuggestionApply_BroadcastsCommentsUpdatedOnParent(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
	c := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(), nil)
	do := func(m, p string, b any) (int, []byte) { return doJSON(t, srv, m, p, b, withCookie(sess)) }
	got := replyWithSuggestion(t, srv.URL, do, c.ID, "A dog")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/documents/"+doc.ID+"/events", nil)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("sse: %v", err)
	}
	defer res.Body.Close()
	sc := bufio.NewScanner(res.Body)
	for sc.Scan() { // wait for the subscription to be live
		if strings.HasPrefix(sc.Text(), "event: hello") {
			break
		}
	}
	if status, body := do("POST", "/api/comments/"+c.ID+"/replies/"+got.Replies[0].ID+"/apply-suggestion", nil); status != 201 {
		t.Fatalf("apply status=%d body=%s", status, body)
	}
	for sc.Scan() {
		if strings.HasPrefix(sc.Text(), "event: comments-updated") {
			return
		}
	}
	t.Fatal("no comments-updated event on the parent doc after apply")
}

func TestSuggestionApply_OrphanThreadRefused(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	doc := testutil.NewTestDocument(t, st, user.ID, twoCats)
	c := insertAnchoredComment(t, st, doc.ID, user.ID, secondCatAnchor(),
		&models.Suggestion{Replacement: "A dog"})
	_, _ = st.Comments().UpdateOne(context.Background(), bson.M{"_id": c.ID},
		bson.M{"$set": bson.M{"orphan": true}})
	status, body := doJSON(t, srv, "POST", "/api/comments/"+c.ID+"/apply-suggestion", nil, withCookie(sess))
	if status != 409 || !strings.Contains(string(body), "orphan") {
		t.Fatalf("status=%d body=%s want 409 orphan", status, body)
	}
	// Signed-out viewers get 401, not a revision.
	if status, _ := doJSON(t, srv, "POST", "/api/comments/"+c.ID+"/apply-suggestion", nil); status != 401 {
		t.Errorf("anonymous status=%d want 401", status)
	}
}
