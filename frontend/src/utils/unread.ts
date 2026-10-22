// "Unread" for the document page's filter and counter.
//
// A thread is unread when someone ELSE wrote something in it — the
// comment itself or a reply — after the reader's previous visit. Only
// creation times count: resolving, reopening, re-anchoring after an edit
// or carrying comments to a new revision all bump `updatedAt` without
// adding anything to read, and must not light the badge up. Your own
// writing never counts either — but an agent running on one of your
// tokens also reads as `mine` (its AuthorID is its owner's), and what it
// wrote is exactly what you haven't read yet, so agents still count.

import type { Comment } from "../types";

export function isCommentUnread(
  c: Comment,
  previouslyViewedAt: string | undefined,
  readThisSession: ReadonlySet<string>,
): boolean {
  if (!previouslyViewedAt || readThisSession.has(c.id)) return false;
  const since = Date.parse(previouslyViewedAt);
  if (Number.isNaN(since)) return false;
  const newer = (iso: string) => Date.parse(iso) > since;
  const byMe = (x: { mine?: boolean; actorKind?: string }) => !!x.mine && x.actorKind !== "agent";
  if (!byMe(c) && newer(c.createdAt)) return true;
  return c.replies.some((r) => !byMe(r) && newer(r.createdAt));
}
