package api_test

// Integration tests for POST /api/documents/:id/resolve-all.

import (
	"context"
	"encoding/json"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"markupmarkdown/internal/models"
	"markupmarkdown/internal/testutil"
)

func TestResolveAllComments(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	doc := testutil.NewTestDocument(t, st, user.ID, "# Hello\n\nAlpha beta gamma.\n")
	other := testutil.NewTestDocument(t, st, user.ID, "# Other\n\nAlpha beta gamma.\n")
	c1 := testutil.NewTestComment(t, st, doc.ID, user.ID, "Alpha", "one")
	c2 := testutil.NewTestComment(t, st, doc.ID, user.ID, "beta", "two")
	done := testutil.NewTestComment(t, st, doc.ID, user.ID, "gamma", "already done")
	if _, err := st.UpdateComment(context.Background(), done.ID, bson.M{"resolved": true, "resolved_by": "Earlier"}); err != nil {
		t.Fatal(err)
	}
	elsewhere := testutil.NewTestComment(t, st, other.ID, user.ID, "Alpha", "other doc")

	status, body := doJSON(t, srv, "POST", "/api/documents/"+doc.ID+"/resolve-all",
		map[string]string{"author": "Flo"}, withCookie(sess))
	if status != 200 {
		t.Fatalf("status=%d body=%s", status, body)
	}
	var out struct{ Resolved int64 }
	if err := json.Unmarshal(body, &out); err != nil || out.Resolved != 2 {
		t.Fatalf("resolved=%d err=%v body=%s, want 2", out.Resolved, err, body)
	}

	get := func(id string) *models.Comment {
		c, err := st.GetComment(context.Background(), id)
		if err != nil || c == nil {
			t.Fatalf("get %s: %v", id, err)
		}
		return c
	}
	for _, id := range []string{c1.ID, c2.ID} {
		if c := get(id); !c.Resolved || c.ResolvedAt == nil {
			t.Errorf("comment %s not resolved: %+v", id, c)
		}
	}
	if c := get(done.ID); c.ResolvedBy != "Earlier" {
		t.Errorf("already-resolved comment was rewritten: resolvedBy=%q", c.ResolvedBy)
	}
	if c := get(elsewhere.ID); c.Resolved {
		t.Error("comment on another document was resolved")
	}

	// Idempotent: nothing left to resolve.
	status, body = doJSON(t, srv, "POST", "/api/documents/"+doc.ID+"/resolve-all", nil, withCookie(sess))
	if status != 200 || !json.Valid(body) {
		t.Fatalf("second call status=%d body=%s", status, body)
	}
	_ = json.Unmarshal(body, &out)
	if out.Resolved != 0 {
		t.Errorf("second call resolved=%d, want 0", out.Resolved)
	}
}

func TestResolveAllComments_ReadTokenForbidden(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	doc := testutil.NewTestDocument(t, st, user.ID, "")
	testutil.NewTestComment(t, st, doc.ID, user.ID, "Hello", "x")
	raw, _ := testutil.NewAPIToken(t, st, user.ID, models.TokenScopeRead)
	status, _ := doJSON(t, srv, "POST", "/api/documents/"+doc.ID+"/resolve-all", nil, withBearer(raw))
	if status != 403 {
		t.Fatalf("status=%d, want 403", status)
	}
}

func TestResolveAllComments_UnknownDoc(t *testing.T) {
	srv, _, _ := newTestServer(t)
	if status, _ := doJSON(t, srv, "POST", "/api/documents/nope-nope-nope/resolve-all", nil); status != 404 {
		t.Fatalf("status=%d, want 404", status)
	}
}
