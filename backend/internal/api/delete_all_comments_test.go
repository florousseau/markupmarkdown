package api_test

// Integration tests for DELETE /api/documents/:id/comments (owner-only
// wipe of a revision's comments) and the isOwner flag on getDocument.

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"markupmarkdown/internal/models"
	"markupmarkdown/internal/testutil"
)

func TestDeleteAllComments_Owner(t *testing.T) {
	srv, st, _ := newTestServer(t)
	owner := testutil.NewTestUser(t, st)
	other := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, owner.ID)
	doc := testutil.NewTestDocument(t, st, owner.ID, "# Hello\n\nAlpha beta gamma.\n")
	keep := testutil.NewTestDocument(t, st, owner.ID, "# Other\n\nAlpha.\n")
	testutil.NewTestComment(t, st, doc.ID, owner.ID, "Alpha", "mine")
	testutil.NewTestComment(t, st, doc.ID, other.ID, "beta", "someone else's")
	kept := testutil.NewTestComment(t, st, keep.ID, owner.ID, "Alpha", "other doc")

	status, body := doJSON(t, srv, "DELETE", "/api/documents/"+doc.ID+"/comments", nil, withCookie(sess))
	if status != 200 {
		t.Fatalf("status=%d body=%s", status, body)
	}
	var out struct{ Deleted int64 }
	if err := json.Unmarshal(body, &out); err != nil || out.Deleted != 2 {
		t.Fatalf("deleted=%d err=%v, want 2", out.Deleted, err)
	}
	left, err := st.ListComments(context.Background(), doc.ID)
	if err != nil || len(left) != 0 {
		t.Fatalf("comments left on doc: %d (err %v)", len(left), err)
	}
	if c, _ := st.GetComment(context.Background(), kept.ID); c == nil {
		t.Error("comment on another document was deleted")
	}
}

func TestDeleteAllComments_OwnerOfRootOnChildRevision(t *testing.T) {
	srv, st, _ := newTestServer(t)
	owner := testutil.NewTestUser(t, st)
	editor := testutil.NewTestUser(t, st)
	root := testutil.NewTestDocument(t, st, owner.ID, "# Root\n\nAlpha.\n")
	now := time.Now().UTC()
	child := &models.Document{
		ID: uuid.NewString(), Title: "Root", Origin: "upload", Content: "# Root\n\nAlpha beta.\n",
		ParentID: root.ID, CreatedByID: editor.ID, CreatedAt: now, UpdatedAt: now,
	}
	if err := st.InsertDocument(context.Background(), child); err != nil {
		t.Fatal(err)
	}
	testutil.NewTestComment(t, st, child.ID, editor.ID, "Alpha", "x")

	// The editor who wrote the revision isn't the owner.
	editorSess := testutil.NewTestSession(t, st, editor.ID)
	if status, _ := doJSON(t, srv, "DELETE", "/api/documents/"+child.ID+"/comments", nil, withCookie(editorSess)); status != 403 {
		t.Fatalf("editor status=%d, want 403", status)
	}
	ownerSess := testutil.NewTestSession(t, st, owner.ID)
	if status, body := doJSON(t, srv, "DELETE", "/api/documents/"+child.ID+"/comments", nil, withCookie(ownerSess)); status != 200 {
		t.Fatalf("owner status=%d body=%s", status, body)
	}
}

func TestDeleteAllComments_Refusals(t *testing.T) {
	srv, st, _ := newTestServer(t)
	owner := testutil.NewTestUser(t, st)
	stranger := testutil.NewTestUser(t, st)
	doc := testutil.NewTestDocument(t, st, owner.ID, "")
	testutil.NewTestComment(t, st, doc.ID, owner.ID, "Hello", "x")
	path := "/api/documents/" + doc.ID + "/comments"

	if status, _ := doJSON(t, srv, "DELETE", path, nil); status != 401 {
		t.Errorf("anonymous status=%d, want 401", status)
	}
	if status, _ := doJSON(t, srv, "DELETE", path, nil, withCookie(testutil.NewTestSession(t, st, stranger.ID))); status != 403 {
		t.Errorf("non-owner status=%d, want 403", status)
	}
	raw, _ := testutil.NewAPIToken(t, st, owner.ID, models.TokenScopeAdmin)
	if status, _ := doJSON(t, srv, "DELETE", path, nil, withBearer(raw)); status != 403 {
		t.Errorf("owner's admin token status=%d, want 403", status)
	}
	if left, _ := st.ListComments(context.Background(), doc.ID); len(left) != 1 {
		t.Errorf("a refused request deleted comments: %d left", len(left))
	}
}

func TestGetDocument_IsOwner(t *testing.T) {
	srv, st, _ := newTestServer(t)
	owner := testutil.NewTestUser(t, st)
	stranger := testutil.NewTestUser(t, st)
	doc := testutil.NewTestDocument(t, st, owner.ID, "")
	isOwner := func(sess string) bool {
		status, body := doJSON(t, srv, "GET", "/api/documents/"+doc.ID, nil, withCookie(sess))
		if status != 200 {
			t.Fatalf("status=%d body=%s", status, body)
		}
		var d struct{ IsOwner bool }
		_ = json.Unmarshal(body, &d)
		return d.IsOwner
	}
	if !isOwner(testutil.NewTestSession(t, st, owner.ID)) {
		t.Error("owner: isOwner=false")
	}
	if isOwner(testutil.NewTestSession(t, st, stranger.ID)) {
		t.Error("stranger: isOwner=true")
	}
}

// Regression: the Bearer guard on cookie-only endpoints must not depend on
// currentUser having run first (token info is attached lazily by it).
// revokeToken checked tokenInfoFromRequest before any auth lookup, so a
// token could revoke its owner's tokens.
func TestRevokeToken_BearerForbidden(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	raw, _ := testutil.NewAPIToken(t, st, user.ID, models.TokenScopeAdmin)
	_, victim := testutil.NewAPIToken(t, st, user.ID, models.TokenScopeRead)
	status, body := doJSON(t, srv, "DELETE", "/api/me/tokens/"+victim.ID, nil, withBearer(raw))
	if status != 403 {
		t.Fatalf("status=%d body=%s, want 403", status, body)
	}
}
