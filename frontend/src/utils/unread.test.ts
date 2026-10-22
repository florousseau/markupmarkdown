import { describe, expect, it } from "vitest";
import type { Comment, Reply } from "../types";
import { isCommentUnread } from "./unread";

const VISIT = "2026-09-30T10:00:00Z";
const BEFORE = "2026-09-30T09:00:00Z";
const AFTER = "2026-09-30T11:00:00Z";

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    documentId: "d",
    anchor: { start: 0, end: 0, exact: "x" },
    author: "Someone",
    body: "b",
    resolved: false,
    replies: [],
    createdAt: BEFORE,
    updatedAt: BEFORE,
    ...over,
  };
}
function reply(over: Partial<Reply> = {}): Reply {
  return { id: "r", author: "Someone", body: "r", createdAt: BEFORE, updatedAt: BEFORE, ...over };
}
const none = new Set<string>();

describe("isCommentUnread", () => {
  it("flags a comment someone else created since the last visit", () => {
    expect(isCommentUnread(comment({ createdAt: AFTER, updatedAt: AFTER }), VISIT, none)).toBe(true);
  });

  it("flags a new reply from someone else on an old thread", () => {
    expect(isCommentUnread(comment({ replies: [reply({ createdAt: AFTER })] }), VISIT, none)).toBe(true);
  });

  it("ignores bookkeeping updates: resolve, re-anchor, carry-forward", () => {
    const c = comment({ updatedAt: AFTER, resolved: true, resolvedAt: AFTER });
    expect(isCommentUnread(c, VISIT, none)).toBe(false);
  });

  it("never flags the reader's own comments or replies", () => {
    expect(isCommentUnread(comment({ mine: true, createdAt: AFTER }), VISIT, none)).toBe(false);
    expect(
      isCommentUnread(comment({ replies: [reply({ mine: true, createdAt: AFTER })] }), VISIT, none),
    ).toBe(false);
  });

  it("still flags what the reader's own agent tokens wrote", () => {
    const c = comment({ mine: true, actorKind: "agent", createdAt: AFTER });
    expect(isCommentUnread(c, VISIT, none)).toBe(true);
  });

  it("is off on a first visit and for threads read this session", () => {
    const c = comment({ createdAt: AFTER });
    expect(isCommentUnread(c, undefined, none)).toBe(false);
    expect(isCommentUnread(c, VISIT, new Set(["c1"]))).toBe(false);
  });
});
