package api

import (
	"reflect"
	"testing"
)

func TestLinkTargetName(t *testing.T) {
	cases := []struct {
		href string
		want string
		ok   bool
	}{
		{"AUTRE.md", "AUTRE.md", true},
		{"AUTRE.md#section", "AUTRE.md", true},
		{"./AUTRE.md#section", "AUTRE.md", true},
		{"../docs/AUTRE.md", "AUTRE.md", true},
		{"/AUTRE.md", "AUTRE.md", true},
		{"Mon%20Plan.md#intro", "Mon Plan.md", true},
		{"notes.MARKDOWN", "notes.MARKDOWN", true},
		{"page.mdx?x=1", "page.mdx", true},
		{"", "", false},
		{"#section", "", false},
		{"https://example.com/AUTRE.md", "", false},
		{"//example.com/AUTRE.md", "", false},
		{"mailto:a@b.c", "", false},
		{"image.png", "", false},
		{"docs/", "", false},
		{"AUTRE", "", false},
	}
	for _, c := range cases {
		got, ok := linkTargetName(c.href)
		if got != c.want || ok != c.ok {
			t.Errorf("linkTargetName(%q) = (%q, %v), want (%q, %v)", c.href, got, ok, c.want, c.ok)
		}
	}
}

func TestUploadFilename(t *testing.T) {
	cases := map[string]string{
		"SPEC.md":             "SPEC.md",
		"  SPEC.md ":          "SPEC.md",
		`C:\Users\me\SPEC.md`: "SPEC.md",
		"some/dir/SPEC.md":    "SPEC.md",
		"":                    "",
		"/":                   "",
	}
	for in, want := range cases {
		if got := uploadFilename(in); got != want {
			t.Errorf("uploadFilename(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUploadTitleCandidates(t *testing.T) {
	if got := uploadTitleCandidates("AUTRE.md"); !reflect.DeepEqual(got, []string{"AUTRE.md", "AUTRE"}) {
		t.Errorf("got %v", got)
	}
	if got := uploadTitleCandidates("AUTRE.MD"); !reflect.DeepEqual(got, []string{"AUTRE.MD", "AUTRE"}) {
		t.Errorf("got %v", got)
	}
	if got := uploadTitleCandidates("notes.markdown"); !reflect.DeepEqual(got, []string{"notes.markdown"}) {
		t.Errorf("got %v", got)
	}
}

func TestLinksTo(t *testing.T) {
	content := "Voir [autre](./docs/AUTRE.md#section), <a href=\"Raw.md\">raw</a>.\n\n" +
		"```\n[code](Code.md)\n```\n"
	cases := map[string]bool{
		"AUTRE.md": true,
		"autre.md": true, // lookup is case-insensitive too
		"Raw.md":   true,
		"Code.md":  false, // inside a code block — not a link
		"Other.md": false,
	}
	for name, want := range cases {
		if got := linksTo(content, name); got != want {
			t.Errorf("linksTo(%q) = %v, want %v", name, got, want)
		}
	}
}
