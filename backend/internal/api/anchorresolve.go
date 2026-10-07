package api

// Locating WHICH occurrence of a comment's anchored text a suggestion
// targets, in the markdown source.
//
// Coordinate spaces matter here. Anchor.Start/End are offsets in the
// RENDERED text (the browser's textContent for UI selections, goldmark
// PlainText for MCP comments), never in the markdown source, and the
// carry-forward pipeline zeroes them on every new revision. Prefix /
// Suffix are captured in that same rendered space. So disambiguation
// happens in render.PlainText(source) and is then mapped back to the
// source by occurrence index: the k-th rendered occurrence is taken to
// be the k-th source occurrence, which is only sound when both spaces
// contain the SAME number of occurrences — otherwise we refuse.
//
// The resolver never guesses: zero candidates → not found, more than
// one → ambiguous. Callers surface both as explicit errors.

import (
	"errors"
	"strings"
	"unicode"

	"markupmarkdown/internal/models"
	"markupmarkdown/internal/render"
)

// anchorContextLen is how many characters of rendered text around the
// selection are captured as Prefix / Suffix at comment creation. The
// frontend uses the same constant (ANCHOR_CONTEXT_LEN in anchor.ts).
const anchorContextLen = 32

var (
	errAnchorNotFound = errors.New(
		"the anchored text no longer appears in the doc — re-anchor or re-write the suggestion")
	errAnchorAmbiguous = errors.New(
		"the anchored text appears several times in the doc and the comment doesn't say which one — re-anchor the comment on the exact passage, then apply")
)

// resolveAnchorInSource returns the byte offset in source where the
// anchored occurrence of a.Exact starts.
//
//   - 0 source occurrences → errAnchorNotFound.
//   - 1 source occurrence  → that one, whatever the context says.
//   - n > 1 → pick the rendered occurrences matching the anchor's
//     context: Prefix/Suffix when captured, else Start/End when they
//     land exactly on an occurrence. Exactly one match AND the same n
//     in rendered text → map to the source; anything else →
//     errAnchorAmbiguous.
func resolveAnchorInSource(source string, a models.Anchor) (int, error) {
	exact := a.Exact
	if strings.TrimSpace(exact) == "" {
		return -1, errAnchorNotFound
	}
	src := occurrenceOffsets(source, exact)
	switch len(src) {
	case 0:
		return -1, errAnchorNotFound
	case 1:
		return src[0], nil
	}
	plain := render.PlainText(source)
	pl := occurrenceOffsets(plain, exact)
	if len(pl) != len(src) {
		// Some occurrences are invisible in one space (inside a link
		// URL, an HTML comment, across formatting markers…) — the
		// index mapping would be a guess.
		return -1, errAnchorAmbiguous
	}
	k := pickOccurrence(plain, pl, a)
	if k < 0 {
		return -1, errAnchorAmbiguous
	}
	return src[k], nil
}

// pickOccurrence returns the index (into offs) of the single occurrence
// matching the anchor's context, or -1 when none or several match.
func pickOccurrence(plain string, offs []int, a models.Anchor) int {
	pre, suf := squashSpace(a.Prefix), squashSpace(a.Suffix)
	useContext := pre != "" || suf != ""
	useOffsets := !useContext && a.End > a.Start
	if !useContext && !useOffsets {
		return -1
	}
	found := -1
	for i, p := range offs {
		var ok bool
		if useContext {
			ok = contextMatches(plain, p, len(a.Exact), pre, suf)
		} else {
			ok = p == a.Start && a.End == p+len(a.Exact)
		}
		if !ok {
			continue
		}
		if found >= 0 {
			return -1 // two matches → ambiguous
		}
		found = i
	}
	return found
}

// contextMatches reports whether the text before / after the occurrence
// at p ends / starts with the captured prefix / suffix. Comparison is
// whitespace-insensitive: the browser's textContent and goldmark's
// PlainText disagree on newlines between blocks and soft line breaks.
func contextMatches(plain string, p, n int, pre, suf string) bool {
	if pre != "" {
		lo := p - 4*len(pre) - 64
		if lo < 0 {
			lo = 0
		}
		if !strings.HasSuffix(squashSpace(plain[lo:p]), pre) {
			return false
		}
	}
	if suf != "" {
		end := p + n
		hi := end + 4*len(suf) + 64
		if hi > len(plain) {
			hi = len(plain)
		}
		if !strings.HasPrefix(squashSpace(plain[end:hi]), suf) {
			return false
		}
	}
	return true
}

// squashSpace drops every whitespace rune.
func squashSpace(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, s)
}

// occurrenceOffsets lists the start offsets of non-overlapping
// occurrences of needle in hay, left to right (same counting rule as
// strings.Count / render.FindOccurrence).
func occurrenceOffsets(hay, needle string) []int {
	if needle == "" {
		return nil
	}
	var out []int
	for i := 0; ; {
		j := strings.Index(hay[i:], needle)
		if j < 0 {
			return out
		}
		out = append(out, i+j)
		i += j + len(needle)
	}
}

// anchorContext extracts Prefix / Suffix around [start, end) of plain,
// trimmed to anchorContextLen bytes on a rune boundary. Used when the
// server creates an anchor itself (MCP add_comment / add_suggestion).
func anchorContext(plain string, start, end int) (prefix, suffix string) {
	if start < 0 || end > len(plain) || start > end {
		return "", ""
	}
	lo := start - anchorContextLen
	if lo < 0 {
		lo = 0
	}
	for lo < start && !isRuneStart(plain[lo]) {
		lo++
	}
	hi := end + anchorContextLen
	if hi > len(plain) {
		hi = len(plain)
	}
	for hi > end && hi < len(plain) && !isRuneStart(plain[hi]) {
		hi--
	}
	return plain[lo:start], plain[end:hi]
}

func isRuneStart(b byte) bool { return b&0xC0 != 0x80 }
