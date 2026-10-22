package api

import (
	"errors"
	"strings"
	"testing"
	"time"

	"markupmarkdown/internal/models"
	"markupmarkdown/internal/render"
)

// Second "The cat" is the target in every duplicate case below.
const dupDoc = "# Pets\n\nThe cat sat on the mat. The cat ran away.\n"

func secondCat() int { return strings.LastIndex(dupDoc, "The cat") }

func TestResolveAnchor_SingleOccurrenceIgnoresContext(t *testing.T) {
	src := "# T\n\nOnly one fox here.\n"
	pos, err := resolveAnchorInSource(src, models.Anchor{Exact: "one fox", Prefix: "unrelated"})
	if err != nil || pos != strings.Index(src, "one fox") {
		t.Fatalf("pos=%d err=%v", pos, err)
	}
}

func TestResolveAnchor_NotFound(t *testing.T) {
	_, err := resolveAnchorInSource(dupDoc, models.Anchor{Exact: "The dog"})
	if !errors.Is(err, errAnchorNotFound) {
		t.Fatalf("err=%v want not found", err)
	}
}

func TestResolveAnchor_DuplicatePickedByPrefix(t *testing.T) {
	pos, err := resolveAnchorInSource(dupDoc, models.Anchor{Exact: "The cat", Prefix: "sat on the mat. "})
	if err != nil || pos != secondCat() {
		t.Fatalf("pos=%d err=%v want %d", pos, err, secondCat())
	}
}

func TestResolveAnchor_DuplicatePickedBySuffix(t *testing.T) {
	pos, err := resolveAnchorInSource(dupDoc, models.Anchor{Exact: "The cat", Suffix: " ran away."})
	if err != nil || pos != secondCat() {
		t.Fatalf("pos=%d err=%v", pos, err)
	}
	pos, err = resolveAnchorInSource(dupDoc, models.Anchor{Exact: "The cat", Suffix: " sat on"})
	if err != nil || pos != strings.Index(dupDoc, "The cat") {
		t.Fatalf("first: pos=%d err=%v", pos, err)
	}
}

func TestResolveAnchor_ContextIsWhitespaceInsensitive(t *testing.T) {
	// Browser textContent has "\n" between blocks where PlainText may
	// differ; the comparison drops whitespace on both sides.
	src := "# Pets\n\nThe cat sat\non the mat. The cat ran.\n"
	pos, err := resolveAnchorInSource(src, models.Anchor{Exact: "The cat", Prefix: "sat on  the\nmat. "})
	if err != nil || pos != strings.LastIndex(src, "The cat") {
		t.Fatalf("pos=%d err=%v", pos, err)
	}
}

func TestResolveAnchor_ContextAcrossInlineMarkup(t *testing.T) {
	// Context is captured in rendered text ("bold word "), the source
	// has ** markers — the lookup happens in PlainText, then maps back.
	src := "Start **bold** word The cat. Other The cat.\n"
	pos, err := resolveAnchorInSource(src, models.Anchor{Exact: "The cat", Prefix: "Start bold word "})
	if err != nil || pos != strings.Index(src, "The cat") {
		t.Fatalf("pos=%d err=%v", pos, err)
	}
}

func TestResolveAnchor_DuplicateWithoutContextIsAmbiguous(t *testing.T) {
	_, err := resolveAnchorInSource(dupDoc, models.Anchor{Exact: "The cat"})
	if !errors.Is(err, errAnchorAmbiguous) {
		t.Fatalf("err=%v want ambiguous", err)
	}
}

func TestResolveAnchor_ContextMatchingSeveralIsAmbiguous(t *testing.T) {
	src := "A. The cat x. B. The cat y.\n"
	_, err := resolveAnchorInSource(src, models.Anchor{Exact: "The cat", Prefix: ". "})
	if !errors.Is(err, errAnchorAmbiguous) {
		t.Fatalf("err=%v want ambiguous", err)
	}
}

func TestResolveAnchor_StaleContextIsAmbiguous(t *testing.T) {
	_, err := resolveAnchorInSource(dupDoc, models.Anchor{Exact: "The cat", Prefix: "text that is gone "})
	if !errors.Is(err, errAnchorAmbiguous) {
		t.Fatalf("err=%v want ambiguous", err)
	}
}

func TestResolveAnchor_OffsetsWhenNoContext(t *testing.T) {
	// MCP-created anchors carry PlainText offsets.
	plain := render.PlainText(dupDoc)
	start := strings.LastIndex(plain, "The cat")
	pos, err := resolveAnchorInSource(dupDoc, models.Anchor{Exact: "The cat", Start: start, End: start + len("The cat")})
	if err != nil || pos != secondCat() {
		t.Fatalf("pos=%d err=%v", pos, err)
	}
	// Offsets that don't land on an occurrence prove nothing.
	_, err = resolveAnchorInSource(dupDoc, models.Anchor{Exact: "The cat", Start: start + 1, End: start + 8})
	if !errors.Is(err, errAnchorAmbiguous) {
		t.Fatalf("err=%v want ambiguous", err)
	}
}

func TestResolveAnchor_CountMismatchIsAmbiguous(t *testing.T) {
	// "cat" also hides in a link URL: 3 source hits, 2 rendered ones —
	// the occurrence index can't be mapped back safely.
	src := "The cat [link](https://x.test/cat) and the cat.\n"
	_, err := resolveAnchorInSource(src, models.Anchor{Exact: "cat", Prefix: "and the "})
	if !errors.Is(err, errAnchorAmbiguous) {
		t.Fatalf("err=%v want ambiguous", err)
	}
}

func TestAnchorContext_RuneBoundaries(t *testing.T) {
	plain := strings.Repeat("é", 40) + "XX" + strings.Repeat("à", 40)
	start := strings.Index(plain, "XX")
	pre, suf := anchorContext(plain, start, start+2)
	if !strings.HasSuffix(plain[:start], pre) || !strings.HasPrefix(plain[start+2:], suf) {
		t.Fatalf("context not adjacent: %q / %q", pre, suf)
	}
	if !utf8Valid(pre) || !utf8Valid(suf) {
		t.Fatalf("split a rune: %q / %q", pre, suf)
	}
	if len(pre) > anchorContextLen || len(suf) > anchorContextLen {
		t.Fatalf("too long: %d / %d", len(pre), len(suf))
	}
	if p, s := anchorContext("abc", 2, 1); p != "" || s != "" {
		t.Fatal("bad range must yield no context")
	}
}

func utf8Valid(s string) bool { return strings.ToValidUTF8(s, "�") == s }

func sugg(applied bool) *models.Suggestion {
	s := &models.Suggestion{Replacement: "x"}
	if applied {
		now := time.Now()
		s.AppliedAt = &now
	}
	return s
}

func TestMarkSuggestionStates_NewestUnappliedWins(t *testing.T) {
	c := &models.Comment{
		Suggestion: sugg(false),
		Replies: []models.Reply{
			{ID: "r1", Suggestion: sugg(false)},
			{ID: "r2"},
			{ID: "r3", Suggestion: sugg(false)},
			{ID: "r4", Suggestion: sugg(true)},
		},
	}
	markSuggestionStates(c)
	if c.Suggestion.Active || !c.Suggestion.Superseded {
		t.Errorf("root should be superseded: %+v", c.Suggestion)
	}
	if !c.Replies[0].Suggestion.Superseded {
		t.Errorf("r1 should be superseded")
	}
	if !c.Replies[2].Suggestion.Active || c.Replies[2].Suggestion.Superseded {
		t.Errorf("r3 should be active: %+v", c.Replies[2].Suggestion)
	}
	if a := c.Replies[3].Suggestion; a.Active || a.Superseded {
		t.Errorf("applied r4 is neither: %+v", a)
	}
	if id, ok := activeSuggestionRef(c); !ok || id != "r3" {
		t.Errorf("activeSuggestionRef = %q, %v", id, ok)
	}
}

func TestMarkSuggestionStates_RootOnlyAndNone(t *testing.T) {
	c := &models.Comment{Suggestion: sugg(false), Replies: []models.Reply{{ID: "r1"}}}
	markSuggestionStates(c)
	if !c.Suggestion.Active {
		t.Error("lone root suggestion should be active")
	}
	empty := &models.Comment{Suggestion: sugg(true)}
	if _, ok := activeSuggestionRef(empty); ok {
		t.Error("applied-only thread has no active suggestion")
	}
}

func TestBuildCarriedComment_KeepsSuggestions(t *testing.T) {
	src := models.Comment{
		ID:         "c1",
		Anchor:     models.Anchor{Exact: "The cat", Prefix: "mat. "},
		Suggestion: sugg(false),
		Replies: []models.Reply{
			{ID: "r1", Suggestion: &models.Suggestion{Replacement: "A dog"}},
		},
	}
	src.Suggestion.Active = true
	child := &models.Document{ID: "child", Content: dupDoc}
	out := buildCarriedComment(src, child, time.Now())
	if out.Suggestion == nil || out.Suggestion == src.Suggestion {
		t.Fatalf("root suggestion not cloned: %+v", out.Suggestion)
	}
	if out.Suggestion.Active {
		t.Error("read-time flags must not be carried")
	}
	if len(out.Replies) != 1 || out.Replies[0].Suggestion == nil ||
		out.Replies[0].Suggestion.Replacement != "A dog" {
		t.Fatalf("reply suggestion lost: %+v", out.Replies)
	}
	if out.Anchor.Prefix != "mat. " {
		t.Errorf("anchor context lost on carry: %+v", out.Anchor)
	}
}

func TestValidateThreadSuggestion(t *testing.T) {
	anchored := &models.Comment{Anchor: models.Anchor{Start: 1, End: 4, Exact: "cat"}}
	cases := []struct {
		name string
		c    *models.Comment
		repl string
		ok   bool
	}{
		{"ok", anchored, "dog", true},
		{"doc-level", &models.Comment{}, "dog", false},
		{"orphan", &models.Comment{Anchor: anchored.Anchor, Orphan: true}, "dog", false},
		{"resolved", &models.Comment{Anchor: anchored.Anchor, Resolved: true}, "dog", false},
		{"empty", anchored, "", false},
		{"no-op", anchored, "cat", false},
		{"too long", anchored, strings.Repeat("x", maxSuggestionReplacementLen+1), false},
	}
	for _, tc := range cases {
		err := ValidateThreadSuggestion(tc.c, tc.repl)
		if (err == nil) != tc.ok {
			t.Errorf("%s: err=%v", tc.name, err)
		}
	}
	if err := ValidateThreadSuggestion(&models.Comment{Anchor: anchored.Anchor, Resolved: true}, "dog"); !errors.Is(err, errSuggestionThreadResolved) {
		t.Errorf("resolved should map to errSuggestionThreadResolved, got %v", err)
	}
}
