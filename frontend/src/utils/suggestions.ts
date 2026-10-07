// Which suggestion of a thread is applicable. A suggestion lives on the
// root comment (add_suggestion) or on a reply (reply + replacement);
// either way it replaces the root's anchored text. The thread's ACTIVE
// suggestion is its most recent unapplied one; older unapplied ones are
// superseded. Same rule as markSuggestionStates in the backend
// (suggestions.go), which also refuses to apply a superseded one.

import type { Comment, Suggestion } from "../types";

export interface ActiveSuggestion {
  /** null when the active suggestion is the root comment's. */
  replyId: string | null;
  suggestion: Suggestion;
}

export function activeSuggestion(c: Comment): ActiveSuggestion | null {
  const replies = c.replies ?? [];
  // Replies are stored in chronological order.
  for (let i = replies.length - 1; i >= 0; i--) {
    const s = replies[i].suggestion;
    if (s && !s.appliedAt) return { replyId: replies[i].id, suggestion: s };
  }
  if (c.suggestion && !c.suggestion.appliedAt) {
    return { replyId: null, suggestion: c.suggestion };
  }
  return null;
}

/** True when the thread has a suggestion that "Apply all" would take:
 * open, anchored, not orphaned, with an active suggestion. */
export function hasApplicableSuggestion(c: Comment): boolean {
  return (
    !c.resolved && !c.orphan && Boolean(c.anchor.exact) && activeSuggestion(c) !== null
  );
}
