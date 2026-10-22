// Comment export: a plain-markdown dump of a doc's review comments,
// meant to be handed to any AI (or human) editing the file locally.
// Data only — a title line, then the comments; no instructions.

import type { Comment, MdDocument, Suggestion } from "../types";
import { activeSuggestion } from "./suggestions";

export interface ExportOptions {
  includeResolved: boolean;
}

/** 1-based line range of `exact` in the markdown source, or null when
 * it can't be located unambiguously. Anchors are recorded against the
 * rendered text, so a passage that spans inline markup (`**bold**`)
 * won't be found verbatim — the quote alone then has to do. Several
 * occurrences are disambiguated with the anchor's prefix/suffix. */
export function locateInSource(
  source: string,
  anchor: Comment["anchor"],
): { start: number; end: number } | null {
  const exact = anchor.exact;
  if (!exact) return null;
  const hits: number[] = [];
  for (let i = source.indexOf(exact); i >= 0; i = source.indexOf(exact, i + 1)) {
    hits.push(i);
  }
  if (hits.length === 0) return null;
  let at = hits[0];
  if (hits.length > 1) {
    const score = (i: number) => {
      const before = source.slice(Math.max(0, i - 40), i);
      const after = source.slice(i + exact.length, i + exact.length + 40);
      // Rendered text collapses whitespace (newline ↔ space), so compare
      // normalized forms.
      return (
        commonSuffix(ws(before), ws(anchor.prefix ?? "")) +
        commonPrefix(ws(after), ws(anchor.suffix ?? ""))
      );
    };
    const ranked = hits.map((i) => ({ i, s: score(i) })).sort((a, b) => b.s - a.s);
    if (ranked[0].s === 0 || ranked[0].s === ranked[1].s) return null;
    at = ranked[0].i;
  }
  const start = lineOf(source, at);
  return { start, end: lineOf(source, at + exact.length - 1) };
}

function ws(s: string): string {
  return s.replace(/\s+/g, " ");
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
}

/** Longest backtick run in `s` + 1 (min 3), so a fence can't be closed
 * by the content it wraps. */
function fenceFor(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** Unapplied suggestion as a fenced block. Only the thread's active
 * one is "the" suggested replacement; older ones are labeled
 * superseded so whoever edits from the export doesn't apply them. */
function suggestionBlock(s: Suggestion | undefined, active: boolean): string | null {
  if (!s || s.appliedAt) return null;
  const f = fenceFor(s.replacement);
  const label = active ? "Suggested replacement" : "Superseded suggestion (do not apply)";
  return `**${label}:**\n${f}\n${s.replacement}\n${f}`;
}

function commentBlock(c: Comment, quoted: string | null): string {
  const parts: string[] = [];
  const active = activeSuggestion(c);
  if (quoted) parts.push(quote(quoted));
  parts.push(`**${c.author}:** ${c.body.trim()}`);
  const root = suggestionBlock(c.suggestion, active?.replyId === null);
  if (root) parts.push(root);
  for (const r of c.replies ?? []) {
    parts.push(`**↳ ${r.author}:** ${r.body.trim()}`);
    const sb = suggestionBlock(r.suggestion, active?.replyId === r.id);
    if (sb) parts.push(sb);
  }
  if (c.resolved) parts.push("_Resolved_");
  return parts.join("\n\n");
}

export function buildCommentsExport(
  doc: Pick<MdDocument, "title" | "content" | "revisionIndex">,
  comments: Comment[],
  opts: ExportOptions,
): string {
  const kept = comments.filter((c) => opts.includeResolved || !c.resolved);
  const anchored = kept
    .filter((c) => !c.orphan && c.anchor.exact)
    .map((c) => ({ c, loc: locateInSource(doc.content, c.anchor) }))
    // Located comments in document order, then the rest in creation order.
    .sort((a, b) => {
      if (a.loc && b.loc) return a.loc.start - b.loc.start;
      if (a.loc) return -1;
      if (b.loc) return 1;
      return a.c.createdAt.localeCompare(b.c.createdAt);
    });
  const general = kept.filter((c) => !c.orphan && !c.anchor.exact);
  const detached = kept.filter((c) => c.orphan);

  const version = doc.revisionIndex ? ` (v${doc.revisionIndex})` : "";
  const out: string[] = [`# Review comments — ${doc.title}${version}`];

  anchored.forEach(({ c, loc }, i) => {
    const where = !loc
      ? ""
      : loc.start === loc.end
        ? ` · Line ${loc.start}`
        : ` · Lines ${loc.start}–${loc.end}`;
    out.push(`## ${i + 1}${where}\n\n${commentBlock(c, c.anchor.exact)}`);
  });
  if (general.length > 0) {
    out.push(
      "## General comments\n\n" + general.map((c) => commentBlock(c, null)).join("\n\n---\n\n"),
    );
  }
  if (detached.length > 0) {
    out.push(
      "## Detached comments (quoted text no longer in the document)\n\n" +
        detached
          .map((c) => commentBlock(c, c.originalExact || c.anchor.exact || null))
          .join("\n\n---\n\n"),
    );
  }
  if (out.length === 1) out.push("_No comments._");
  return out.join("\n\n") + "\n";
}
