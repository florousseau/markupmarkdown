package api

import (
	"net/http/httptest"
	"net/url"
	"testing"

	"markupmarkdown/internal/models"
)

func TestAnonymousClaim(t *testing.T) {
	a := &API{}
	req := func(name, auth string) string {
		r := httptest.NewRequest("GET", "/", nil)
		if name != "" {
			r.Header.Set(authorNameHeader, url.QueryEscape(name))
		}
		if auth != "" {
			r.Header.Set("Authorization", auth)
		}
		return a.anonymousClaim(r)
	}

	t.Setenv(anonymousNameEditsEnv, "")
	if got := req("Marie", ""); got != "" {
		t.Errorf("feature off: claim=%q, want none", got)
	}

	t.Setenv(anonymousNameEditsEnv, "true")
	if got := req("Hélène Dupré", ""); got != "Hélène Dupré" {
		t.Errorf("claim=%q, want the decoded name", got)
	}
	if got := req("  Marie  ", ""); got != "Marie" {
		t.Errorf("claim=%q, want trimmed", got)
	}
	for _, name := range []string{"", "Anonymous", "anonymous"} {
		if got := req(name, ""); got != "" {
			t.Errorf("name %q: claim=%q, want none", name, got)
		}
	}
	if got := req("Marie", "Bearer mmk_whatever"); got != "" {
		t.Errorf("bearer request: claim=%q, want none", got)
	}
}

func TestClaimsAnonymous(t *testing.T) {
	cases := []struct {
		name                  string
		claim, author, authID string
		kind                  models.ActorKind
		want                  bool
	}{
		{"anonymous human, same name", "Marie", "Marie", "", models.ActorHuman, true},
		{"legacy comment without kind", "Marie", "Marie", "", "", true},
		{"different name", "Marie", "Marion", "", models.ActorHuman, false},
		{"signed-in author with that name", "Marie", "Marie", "u1", models.ActorHuman, false},
		{"agent", "Marie", "Marie", "", models.ActorAgent, false},
		{"no claim", "", "", "", models.ActorHuman, false},
	}
	for _, c := range cases {
		if got := claimsAnonymous(c.claim, c.author, c.authID, c.kind); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
