package api

import (
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"

	"github.com/gorilla/mux"
)

// Cross-document links between uploaded docs.
//
// An uploaded doc has no source URL, so a relative link such as
// `[voir](AUTRE.md#section)` has nothing to resolve against — the
// browser would turn it into /d/AUTRE.md. Instead the frontend asks
// resolveUploadLink which of the SAME creator's uploads is called
// AUTRE.md and navigates to that chain's latest revision. Scoping to
// the creator keeps a link from landing on a stranger's README.md.

// linkableExts are the file extensions treated as links to another doc.
var linkableExts = map[string]bool{".md": true, ".markdown": true, ".mdx": true}

// linkTargetName extracts the file name a relative markdown link points
// at ("docs/AUTRE.md#s" → "AUTRE.md"). Only the base name counts —
// uploads carry no folder structure. ok is false for absolute URLs,
// bare fragments, and non-markdown targets.
func linkTargetName(href string) (string, bool) {
	href = strings.TrimSpace(href)
	if href == "" || strings.HasPrefix(href, "#") {
		return "", false
	}
	u, err := url.Parse(href)
	if err != nil || u.Scheme != "" || u.Host != "" {
		return "", false
	}
	name := path.Base(u.Path)
	if name == "." || name == "/" || len(name) > maxTitleLen {
		return "", false
	}
	if !linkableExts[strings.ToLower(path.Ext(name))] {
		return "", false
	}
	return name, true
}

// uploadFilename normalizes the client-supplied file name of an upload
// to its base name. Returns "" when nothing usable is left.
func uploadFilename(name string) string {
	name = path.Base(strings.ReplaceAll(strings.TrimSpace(name), `\`, "/"))
	if name == "." || name == "/" || len(name) > maxTitleLen {
		return ""
	}
	return name
}

// uploadTitleCandidates lists the titles a pre-upload_filename doc
// would carry for `name`: the upload form stripped a trailing ".md",
// and kept any other extension as-is.
func uploadTitleCandidates(name string) []string {
	out := []string{name}
	if strings.EqualFold(path.Ext(name), ".md") {
		out = append(out, name[:len(name)-len(".md")])
	}
	return out
}

// resolveUploadLink is GET /api/documents/:id/resolve-link?href=… —
// maps a relative .md link inside doc :id to the latest revision of the
// matching upload by the same creator. Read-only: auth + access only.
func (a *API) resolveUploadLink(w http.ResponseWriter, r *http.Request) {
	doc, accErr := a.checkDocAccess(r, mux.Vars(r)["id"])
	if accErr != nil {
		a.writeAccessError(w, r, accErr)
		return
	}
	name, ok := linkTargetName(r.URL.Query().Get("href"))
	if !ok {
		writeError(w, http.StatusBadRequest, "href must be a relative link to a .md file")
		return
	}
	ctx := r.Context()
	// Revisions can be authored by anyone; the creator that scopes the
	// lookup is the chain root's.
	root := doc
	if doc.ParentID != "" {
		if rd, err := a.store.RootDocument(ctx, doc.ID); err == nil && rd != nil {
			root = rd
		}
	}
	notFound := func(msg string) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": msg, "kind": accessKindNotFound})
	}
	if root.CreatedByID == "" {
		notFound(fmt.Sprintf("Can't follow %s: this document was uploaded without signing in, so there is no set of files to look in.", name))
		return
	}
	target, err := a.store.FindLatestUploadByFilename(ctx, root.CreatedByID, name, uploadTitleCandidates(name))
	if err != nil {
		internalError(w, "store.find_upload_by_filename", err)
		return
	}
	if target == nil {
		notFound(fmt.Sprintf("%s hasn't been uploaded by this document's author.", name))
		return
	}
	leaf := target
	if d, _ := a.store.LatestDescendant(ctx, target.ID); d != nil {
		leaf = d
	}
	if _, accErr := a.checkDocAccess(r, leaf.ID); accErr != nil {
		a.writeAccessError(w, r, accErr)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": leaf.ID, "title": leaf.Title})
}
