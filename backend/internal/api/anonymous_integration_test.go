package api_test

// Integration tests for MARKUPMARKDOWN_ANONYMOUS_NAME_EDITS: anonymous
// visitors editing/deleting their own (anonymous) comments by name.

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"markupmarkdown/internal/models"
	"markupmarkdown/internal/testutil"
)

func withAuthorName(name string) func(*http.Request) {
	return func(r *http.Request) { r.Header.Set("X-Author-Name", url.QueryEscape(name)) }
}

func createAnonComment(t *testing.T, srvURL func(string, any, ...func(*http.Request)) (int, []byte), docID, author string) models.Comment {
	t.Helper()
	status, body := srvURL("/api/documents/"+docID+"/comments", map[string]any{
		"anchor": map[string]any{"start": 0, "end": 5, "exact": "Hello"},
		"body":   "anonymous note",
		"author": author,
	})
	if status != 201 && status != 200 {
		t.Fatalf("create: status=%d body=%s", status, body)
	}
	var c models.Comment
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestAnonymousNameEdits(t *testing.T) {
	srv, st, _ := newTestServer(t)
	owner := testutil.NewTestUser(t, st) // Name "Test User"
	doc := testutil.NewTestDocument(t, st, owner.ID, "# Hello\n\nHello world.\n")
	post := func(p string, b any, mods ...func(*http.Request)) (int, []byte) {
		return doJSON(t, srv, "POST", p, b, mods...)
	}
	marie := createAnonComment(t, post, doc.ID, "Marie")
	signedIn := testutil.NewTestComment(t, st, doc.ID, owner.ID, "world", "signed-in note") // Author "Test User"
	edit := map[string]string{"body": "edited"}

	t.Run("off by default: anonymous edits are refused", func(t *testing.T) {
		t.Setenv("MARKUPMARKDOWN_ANONYMOUS_NAME_EDITS", "")
		if status, _ := doJSON(t, srv, "PATCH", "/api/comments/"+marie.ID, edit, withAuthorName("Marie")); status != 403 {
			t.Fatalf("status=%d, want 403", status)
		}
	})

	t.Run("on: the matching name can edit, delete a reply and delete", func(t *testing.T) {
		t.Setenv("MARKUPMARKDOWN_ANONYMOUS_NAME_EDITS", "true")
		if status, body := doJSON(t, srv, "PATCH", "/api/comments/"+marie.ID, edit, withAuthorName("Marie")); status != 200 {
			t.Fatalf("edit: status=%d body=%s", status, body)
		}

		// listComments marks it mine for that name only.
		_, body := doJSON(t, srv, "GET", "/api/documents/"+doc.ID+"/comments", nil, withAuthorName("Marie"))
		var cs []models.Comment
		_ = json.Unmarshal(body, &cs)
		for _, c := range cs {
			if want := c.ID == marie.ID; c.Mine != want {
				t.Errorf("comment %q mine=%v, want %v", c.Author, c.Mine, want)
			}
		}

		// Replies follow the same rule.
		status, body := doJSON(t, srv, "POST", "/api/comments/"+signedIn.ID+"/replies",
			map[string]string{"body": "anon reply", "author": "Marie"})
		if status != 200 && status != 201 {
			t.Fatalf("reply: status=%d body=%s", status, body)
		}
		var parent models.Comment
		_ = json.Unmarshal(body, &parent)
		replyID := parent.Replies[len(parent.Replies)-1].ID
		if status, _ := doJSON(t, srv, "DELETE", "/api/comments/"+signedIn.ID+"/replies/"+replyID, nil, withAuthorName("Bob")); status != 403 {
			t.Errorf("reply delete by other name: status=%d, want 403", status)
		}
		if status, _ := doJSON(t, srv, "DELETE", "/api/comments/"+signedIn.ID+"/replies/"+replyID, nil, withAuthorName("Marie")); status != 204 && status != 200 {
			t.Errorf("reply delete by author name: status=%d, want 2xx", status)
		}

		if status, _ := doJSON(t, srv, "DELETE", "/api/comments/"+marie.ID, nil, withAuthorName("Marie")); status != 204 {
			t.Errorf("delete: status=%d, want 204", status)
		}
	})

	t.Run("on: never covers other names, signed-in authors or tokens", func(t *testing.T) {
		t.Setenv("MARKUPMARKDOWN_ANONYMOUS_NAME_EDITS", "true")
		other := createAnonComment(t, post, doc.ID, "Marie")
		if status, _ := doJSON(t, srv, "PATCH", "/api/comments/"+other.ID, edit, withAuthorName("Bob")); status != 403 {
			t.Errorf("other name: status=%d, want 403", status)
		}
		// A signed-in user's comment can't be claimed by typing their name.
		if status, _ := doJSON(t, srv, "DELETE", "/api/comments/"+signedIn.ID, nil, withAuthorName("Test User")); status != 403 {
			t.Errorf("signed-in author by name: status=%d, want 403", status)
		}
		// A Bearer request never uses the name header.
		raw, _ := testutil.NewAPIToken(t, st, owner.ID, models.TokenScopeAdmin)
		if status, _ := doJSON(t, srv, "PATCH", "/api/comments/"+other.ID, edit, withBearer(raw), withAuthorName("Marie")); status != 403 {
			t.Errorf("bearer + name: status=%d, want 403", status)
		}
		// The shared default label is never a claim.
		anon := createAnonComment(t, post, doc.ID, "")
		if status, _ := doJSON(t, srv, "DELETE", "/api/comments/"+anon.ID, nil, withAuthorName("Anonymous")); status != 403 {
			t.Errorf("\"Anonymous\": status=%d, want 403", status)
		}
	})
}
