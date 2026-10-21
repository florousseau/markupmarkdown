package api

import (
	"errors"
	"strings"

	"markupmarkdown/internal/models"
)

// ValidateCommentBody enforces the same trim + length rules whether the
// comment arrived from REST or from MCP. Returns a friendly error suitable
// for surfacing to the caller; never reveals server internals.
func ValidateCommentBody(body string) (string, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return "", errors.New("body is required")
	}
	if len(body) > maxCommentBodyLen {
		return "", errors.New("comment body too long")
	}
	return body, nil
}

// ValidateReplyBody mirrors ValidateCommentBody for replies.
func ValidateReplyBody(body string) (string, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return "", errors.New("body is required")
	}
	if len(body) > maxReplyBodyLen {
		return "", errors.New("reply body too long")
	}
	return body, nil
}

// ValidateAnchor checks the offsets and exact-text length. Same rules for
// REST (Anchor object on the wire) and MCP (anchor computed from quoted_text).
//
// A doc-level comment (no inline highlight) is encoded as the zero
// anchor (Start=End=0, Exact="") and is treated as valid here. Callers
// that need to reject doc-level pins specifically can call IsDocLevel
// before this function.
func ValidateAnchor(a models.Anchor) error {
	if a.Start == 0 && a.End == 0 && strings.TrimSpace(a.Exact) == "" {
		return nil
	}
	if a.End <= a.Start {
		return errors.New("invalid anchor range")
	}
	if strings.TrimSpace(a.Exact) == "" {
		return errors.New("anchor.exact is required")
	}
	if len(a.Exact) > maxAnchorExactLen {
		return errors.New("anchor.exact too long")
	}
	if len(a.Prefix) > maxAnchorContextLen || len(a.Suffix) > maxAnchorContextLen {
		return errors.New("anchor.prefix / anchor.suffix too long")
	}
	return nil
}

// errSuggestionThreadResolved is the one ValidateThreadSuggestion error
// that is a state conflict (409) rather than a bad request (400).
var errSuggestionThreadResolved = errors.New(
	"this thread is resolved — reopen it before proposing a new suggestion")

// ValidateThreadSuggestion checks a replacement proposed in a REPLY to
// parent. The replacement targets parent's Anchor.Exact, so the thread
// must be anchored (not doc-level), still anchored (not orphan), and
// open. The replacement is kept verbatim (no trimming): it's the exact
// markdown source that will replace the anchored span. REST createReply
// and MCP reply both call this.
func ValidateThreadSuggestion(parent *models.Comment, replacement string) error {
	if isDocLevel(parent.Anchor) {
		return errors.New("doc-level threads can't carry a suggestion — there's no anchored text to replace")
	}
	if parent.Orphan {
		return errors.New("this thread lost its anchor (orphan) — it can't carry a suggestion until it's re-anchored")
	}
	if parent.Resolved {
		return errSuggestionThreadResolved
	}
	if replacement == "" {
		return errors.New("`replacement` must not be empty")
	}
	if len(replacement) > maxSuggestionReplacementLen {
		return errors.New("`replacement` too long (max 32KB)")
	}
	if replacement == parent.Anchor.Exact {
		return errors.New("`replacement` is identical to the anchored text — nothing to suggest")
	}
	return nil
}
