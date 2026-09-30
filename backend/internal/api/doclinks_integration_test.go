package api_test

// Integration tests for GET /api/documents/:id/resolve-link — relative
// .md links between uploaded docs.

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"

	"markupmarkdown/internal/models"
	"markupmarkdown/internal/store"
	"markupmarkdown/internal/testutil"
)

func insertUpload(t *testing.T, st *store.Store, creatorID, title, filename, parentID string) *models.Document {
	t.Helper()
	now := time.Now().UTC()
	d := &models.Document{
		ID:             uuid.NewString(),
		Title:          title,
		Origin:         "upload",
		SourceKind:     models.SourceKindUpload,
		Content:        "# " + title + "\n",
		CreatedByID:    creatorID,
		UploadFilename: filename,
		ParentID:       parentID,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := st.InsertDocument(context.Background(), d); err != nil {
		t.Fatalf("insert: %v", err)
	}
	return d
}

func resolveLink(t *testing.T, srvURL func(string) (int, []byte), docID, href string) (int, map[string]string) {
	t.Helper()
	status, body := srvURL("/api/documents/" + docID + "/resolve-link?href=" + url.QueryEscape(href))
	out := map[string]string{}
	_ = json.Unmarshal(body, &out)
	return status, out
}

func TestResolveUploadLink(t *testing.T) {
	srv, st, _ := newTestServer(t)
	get := func(p string) (int, []byte) { return doJSON(t, srv, "GET", p, nil) }
	alice := testutil.NewTestUser(t, st)
	bob := testutil.NewTestUser(t, st)

	a := insertUpload(t, st, alice.ID, "PLAN", "PLAN.md", "")
	b := insertUpload(t, st, alice.ID, "AUTRE", "AUTRE.md", "")
	bRev := insertUpload(t, st, bob.ID, "AUTRE", "", b.ID) // revision by someone else
	legacy := insertUpload(t, st, alice.ID, "Legacy", "", "")
	insertUpload(t, st, bob.ID, "Other", "OTHER.md", "")

	t.Run("resolves by filename to the chain leaf", func(t *testing.T) {
		status, out := resolveLink(t, get, a.ID, "./autre.md#section")
		if status != 200 || out["id"] != bRev.ID {
			t.Fatalf("status=%d out=%v, want leaf %s", status, out, bRev.ID)
		}
	})
	t.Run("works from a revision authored by another user", func(t *testing.T) {
		status, out := resolveLink(t, get, bRev.ID, "PLAN.md")
		if status != 200 || out["id"] != a.ID {
			t.Fatalf("status=%d out=%v, want %s", status, out, a.ID)
		}
	})
	t.Run("legacy uploads match on title", func(t *testing.T) {
		status, out := resolveLink(t, get, a.ID, "Legacy.md")
		if status != 200 || out["id"] != legacy.ID {
			t.Fatalf("status=%d out=%v, want %s", status, out, legacy.ID)
		}
	})
	t.Run("never crosses to another creator's uploads", func(t *testing.T) {
		if status, _ := resolveLink(t, get, a.ID, "OTHER.md"); status != 404 {
			t.Fatalf("status=%d, want 404", status)
		}
	})
	t.Run("rejects non-markdown targets", func(t *testing.T) {
		if status, _ := resolveLink(t, get, a.ID, "https://example.com/AUTRE.md"); status != 400 {
			t.Fatalf("status=%d, want 400", status)
		}
	})
	t.Run("anonymous uploads have nothing to resolve against", func(t *testing.T) {
		anon := insertUpload(t, st, "", "Anon", "ANON.md", "")
		if status, _ := resolveLink(t, get, anon.ID, "AUTRE.md"); status != 404 {
			t.Fatalf("status=%d, want 404", status)
		}
	})
}

func TestCreateDocument_StoresUploadFilename(t *testing.T) {
	srv, st, _ := newTestServer(t)
	user := testutil.NewTestUser(t, st)
	sess := testutil.NewTestSession(t, st, user.ID)
	status, body := doJSON(t, srv, "POST", "/api/documents", map[string]string{
		"content":  "# Hi\n",
		"title":    "AUTRE",
		"filename": `C:\docs\AUTRE.md`,
	}, withCookie(sess))
	if status != 201 {
		t.Fatalf("status=%d body=%s", status, body)
	}
	var doc models.Document
	if err := json.Unmarshal(body, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.UploadFilename != "AUTRE.md" {
		t.Errorf("UploadFilename=%q, want AUTRE.md", doc.UploadFilename)
	}
}
