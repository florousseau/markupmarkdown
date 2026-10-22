import { describe, expect, it } from "vitest";
import type { Comment } from "../types";
import { buildCommentsExport, locateInSource } from "./exportComments";

let n = 0;
function comment(over: Partial<Comment>): Comment {
  n++;
  return {
    id: `c${n}`,
    documentId: "d",
    anchor: { start: 0, end: 0, exact: "" },
    author: "Flo",
    body: "body",
    resolved: false,
    replies: [],
    createdAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`,
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const SOURCE = [
  "# Plan", // 1
  "", // 2
  "Le budget est de 10k€.", // 3
  "", // 4
  "Nous livrerons en mars.", // 5
  "Nous livrerons en mars.", // 6 (duplicate)
  "Fin.", // 7
].join("\n");

describe("locateInSource", () => {
  it("finds a unique passage", () => {
    expect(locateInSource(SOURCE, { start: 0, end: 0, exact: "budget est" })).toEqual({ start: 3, end: 3 });
  });

  it("spans lines", () => {
    expect(locateInSource(SOURCE, { start: 0, end: 0, exact: "10k€.\n\nNous" })).toEqual({ start: 3, end: 5 });
  });

  it("disambiguates duplicates with prefix/suffix, else gives up", () => {
    const exact = "Nous livrerons en mars.";
    expect(locateInSource(SOURCE, { start: 0, end: 0, exact, suffix: " Fin" })).toEqual({ start: 6, end: 6 });
    expect(locateInSource(SOURCE, { start: 0, end: 0, exact })).toBeNull();
  });

  it("returns null when the passage isn't in the source verbatim", () => {
    expect(locateInSource("un **gras** mot", { start: 0, end: 0, exact: "un gras mot" })).toBeNull();
  });
});

describe("buildCommentsExport", () => {
  const doc = { title: "PLAN", content: SOURCE, revisionIndex: 3 };

  it("dumps data only: title, then comments in document order", () => {
    const out = buildCommentsExport(
      doc,
      [
        comment({ anchor: { start: 0, end: 0, exact: "Fin." }, body: "Trop court." }),
        comment({
          anchor: { start: 0, end: 0, exact: "budget est de 10k€" },
          body: "À mettre à jour.",
          replies: [{ id: "r", author: "Marie", body: "12k€", createdAt: "", updatedAt: "" }],
          suggestion: { replacement: "budget est de 12k€" },
        }),
        comment({ body: "Ton trop formel." }),
        comment({ orphan: true, originalExact: "ancien texte", body: "Obsolète ?" }),
        comment({ anchor: { start: 0, end: 0, exact: "Plan" }, resolved: true, body: "ok" }),
      ],
      { includeResolved: false },
    );
    expect(out).toBe(
      [
        "# Review comments — PLAN (v3)",
        "## 1 · Line 3",
        "> budget est de 10k€",
        "**Flo:** À mettre à jour.",
        "**Suggested replacement:**\n```\nbudget est de 12k€\n```",
        "**↳ Marie:** 12k€",
        "## 2 · Line 7",
        "> Fin.",
        "**Flo:** Trop court.",
        "## General comments",
        "**Flo:** Ton trop formel.",
        "## Detached comments (quoted text no longer in the document)",
        "> ancien texte",
        "**Flo:** Obsolète ?",
      ].join("\n\n") + "\n",
    );
  });

  it("includes resolved comments on request, marked as such", () => {
    const out = buildCommentsExport(
      doc,
      [comment({ anchor: { start: 0, end: 0, exact: "Plan" }, resolved: true, body: "ok" })],
      { includeResolved: true },
    );
    expect(out).toContain("## 1 · Line 1\n\n> Plan\n\n**Flo:** ok\n\n_Resolved_");
  });

  it("fences suggestions containing backticks safely", () => {
    const out = buildCommentsExport(
      doc,
      [comment({ anchor: { start: 0, end: 0, exact: "Fin." }, suggestion: { replacement: "a ```b``` c" } })],
      { includeResolved: false },
    );
    expect(out).toContain("````\na ```b``` c\n````");
  });

  it("says so when there is nothing to export", () => {
    expect(buildCommentsExport(doc, [], { includeResolved: false })).toBe(
      "# Review comments — PLAN (v3)\n\n_No comments._\n",
    );
  });
});

describe("reply suggestions in the export", () => {
  it("includes the active reply suggestion and labels superseded ones", () => {
    const c = comment({
      anchor: { start: 0, end: 0, exact: "budget est" },
      suggestion: { replacement: "old root" },
      replies: [
        { id: "r1", author: "bot", body: "first try", createdAt: "", updatedAt: "", suggestion: { replacement: "budget sera" } },
        { id: "r2", author: "bot", body: "second try", createdAt: "", updatedAt: "", suggestion: { replacement: "budget reste" } },
      ],
    });
    const out = buildCommentsExport({ title: "T", content: SOURCE }, [c], { includeResolved: false });
    expect(out).toContain("**Superseded suggestion (do not apply):**\n```\nold root\n```");
    expect(out).toContain("**↳ bot:** first try\n\n**Superseded suggestion (do not apply):**\n```\nbudget sera\n```");
    expect(out).toContain("**↳ bot:** second try\n\n**Suggested replacement:**\n```\nbudget reste\n```");
  });

  it("omits applied suggestions", () => {
    const c = comment({
      anchor: { start: 0, end: 0, exact: "budget est" },
      replies: [
        { id: "r1", author: "bot", body: "done", createdAt: "", updatedAt: "", suggestion: { replacement: "zzz", appliedAt: "2026-01-02T00:00:00Z" } },
      ],
    });
    const out = buildCommentsExport({ title: "T", content: SOURCE }, [c], { includeResolved: false });
    expect(out).not.toContain("zzz");
  });
});

