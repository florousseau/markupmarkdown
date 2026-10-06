package api

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	"markupmarkdown/internal/models"
)

// Anonymous authorship by display name.
//
// A visitor without a session can comment under a display name (kept in
// their browser). Those comments carry no AuthorID, so the author-only
// checks (rule #13) refuse every edit/delete: nobody can prove they wrote
// them. Setting MARKUPMARKDOWN_ANONYMOUS_NAME_EDITS=true lets a still-
// anonymous visitor edit, delete or re-anchor comments and replies whose
// author name equals the name their browser sends in X-Author-Name.
//
// That is a claim, not a proof — anyone typing the same name gets the same
// rights — so it is opt-in and deliberately narrow:
//   - only for requests with neither a session nor a Bearer token;
//   - only on content written anonymously (no AuthorID) by a human, so a
//     signed-in user's or an agent's comment can never be claimed by name;
//   - never for the default "Anonymous" label everyone shares.

const (
	anonymousNameEditsEnv = "MARKUPMARKDOWN_ANONYMOUS_NAME_EDITS"
	authorNameHeader      = "X-Author-Name"
)

func anonymousNameEditsEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(anonymousNameEditsEnv))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// anonymousClaim returns the display name an anonymous request claims to
// write under, or "" when the feature is off, the request is
// authenticated (session or token), or no usable name was sent. The
// header is URL-encoded by the client so non-Latin-1 names survive.
func (a *API) anonymousClaim(r *http.Request) string {
	if !anonymousNameEditsEnabled() || hasBearer(r) || a.currentUser(r) != nil {
		return ""
	}
	raw := r.Header.Get(authorNameHeader)
	name, err := url.QueryUnescape(raw)
	if err != nil {
		name = raw
	}
	name = strings.TrimSpace(name)
	if name == "" || strings.EqualFold(name, anonymous) || len(name) > maxTitleLen {
		return ""
	}
	return name
}

// claimsAnonymous reports whether `claim` covers content written by
// author/authorID/kind: anonymous, human, same name.
func claimsAnonymous(claim, author, authorID string, kind models.ActorKind) bool {
	return claim != "" && authorID == "" && kind != models.ActorAgent && author == claim
}
