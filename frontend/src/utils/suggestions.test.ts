import { describe, expect, it } from "vitest";
import type { Comment, Reply } from "../types";
import { activeSuggestion, hasApplicableSuggestion } from "./suggestions";

const applied = "2026-01-02T00:00:00Z";

function reply(id: string, replacement?: string, isApplied = false): Reply {
  return {
    id,
    author: "bot",
    body: "fix",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    suggestion: replacement
      ? { replacement, appliedAt: isApplied ? applied : undefined }
      : undefined,
  };
}

function thread(over: Partial<Comment>): Comment {
  return {
    id: "c1",
    documentId: "d",
    anchor: { start: 1, end: 8, exact: "The cat" },
    author: "Flo",
    body: "change this",
    resolved: false,
    replies: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("activeSuggestion", () => {
  it("is the newest unapplied suggestion across root and replies", () => {
    const c = thread({
      suggestion: { replacement: "root" },
      replies: [reply("r1", "first"), reply("r2"), reply("r3", "latest"), reply("r4", "done", true)],
    });
    expect(activeSuggestion(c)).toEqual({
      replyId: "r3",
      suggestion: { replacement: "latest", appliedAt: undefined },
    });
  });

  it("falls back to the root suggestion", () => {
    const c = thread({ suggestion: { replacement: "root" }, replies: [reply("r1")] });
    expect(activeSuggestion(c)?.replyId).toBeNull();
  });

  it("is null when every suggestion is applied", () => {
    const c = thread({
      suggestion: { replacement: "root", appliedAt: applied },
      replies: [reply("r1", "x", true)],
    });
    expect(activeSuggestion(c)).toBeNull();
  });
});

describe("hasApplicableSuggestion", () => {
  const withSugg = { replies: [reply("r1", "A dog")] };
  it("counts open anchored threads with an active suggestion", () => {
    expect(hasApplicableSuggestion(thread(withSugg))).toBe(true);
  });
  it("skips resolved, orphan and doc-level threads", () => {
    expect(hasApplicableSuggestion(thread({ ...withSugg, resolved: true }))).toBe(false);
    expect(hasApplicableSuggestion(thread({ ...withSugg, orphan: true }))).toBe(false);
    expect(
      hasApplicableSuggestion(thread({ ...withSugg, anchor: { start: 0, end: 0, exact: "" } }))
    ).toBe(false);
  });
});
