// Anchor utilities: map between DOM selections and character offsets in the
// container's textContent, and apply highlight spans for stored ranges.

export interface AnchorSpec {
  start: number;
  end: number;
  exact: string;
  /** A few characters of rendered text before / after the selection.
   * They tell repeated passages apart — the server uses them to apply
   * a suggestion to the right occurrence (backend anchorresolve.go). */
  prefix?: string;
  suffix?: string;
}

/** How much rendered text around a selection is captured as
 * prefix / suffix. Mirrors anchorContextLen in the backend. */
export const ANCHOR_CONTEXT_LEN = 32;

export interface HighlightRange {
  id: string;
  start: number;
  end: number;
  resolved: boolean;
  active: boolean;
  // For agent-created comments anchored by text-substring rather than by
  // character offsets. When start == end == 0 and exact is set, the
  // renderer resolves it against the live textContent.
  exact?: string;
  // Captured context, used to pick the right occurrence when `exact`
  // appears several times.
  prefix?: string;
  suffix?: string;
}

function getTextOffset(
  container: HTMLElement,
  node: Node,
  offsetInNode: number
): number {
  if (!container.contains(node) && node !== container) return -1;

  if (node.nodeType !== Node.TEXT_NODE) {
    let acc = 0;
    for (let i = 0; i < offsetInNode && i < node.childNodes.length; i++) {
      acc += node.childNodes[i].textContent?.length ?? 0;
    }
    if (node === container) return acc;
    return offsetOfNodeStart(container, node) + acc;
  }

  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    if (cur === node) return offset + offsetInNode;
    offset += cur.textContent?.length ?? 0;
  }
  return -1;
}

function offsetOfNodeStart(container: HTMLElement, node: Node): number {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    if (node === cur || node.contains(cur)) return offset;
    offset += cur.textContent?.length ?? 0;
  }
  return -1;
}

export function getSelectionAnchor(container: HTMLElement): AnchorSpec | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  // A rendered Mermaid diagram lives in a shadow root and has no
  // textContent offsets; comment on it by selecting its source instead.
  if (inMermaidHost(range.startContainer) || inMermaidHost(range.endContainer)) {
    return null;
  }
  // A selection running ACROSS a shown diagram would count its hidden
  // source in start/end while sel.toString() omits it — an anchor whose
  // `exact` disagrees with its own offsets. Refuse it.
  for (const src of Array.from(
    container.querySelectorAll("[data-mm-mermaid-source][hidden]"),
  )) {
    if (range.intersectsNode(src)) return null;
  }

  const start = getTextOffset(container, range.startContainer, range.startOffset);
  const end = getTextOffset(container, range.endContainer, range.endOffset);
  if (start < 0 || end < 0 || end <= start) return null;

  const exact = sel.toString();
  if (!exact || exact.trim() === "") return null;

  const text = container.textContent ?? "";
  const prefix = text.slice(Math.max(0, start - ANCHOR_CONTEXT_LEN), start);
  const suffix = text.slice(end, end + ANCHOR_CONTEXT_LEN);
  return { start, end, exact, prefix, suffix };
}

/** Start offsets of the non-overlapping occurrences of needle in hay,
 * left to right (same counting rule as the backend). */
export function occurrenceOffsets(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j < 0) return out;
    out.push(j);
    i = j + needle.length;
  }
}

/** Removes whitespace — rendered textContent and the server's plain
 * text disagree on newlines between blocks. */
export const squashSpace = (s: string) => s.replace(/\s+/g, "");

/** Keeps letters and digits only — for matching rendered-text context
 * against markdown SOURCE, where markers (`**`, `[`, `#`) sit in between. */
export const lettersAndDigits = (s: string) =>
  s.replace(/[^\p{L}\p{N}]+/gu, "");

/** Returns the offset (from offs) of the single occurrence whose
 * surroundings match prefix / suffix under `norm`, or -1 when none or
 * several match, or when there is no context to compare. */
export function pickOccurrenceByContext(
  hay: string,
  offs: number[],
  needleLen: number,
  prefix: string | undefined,
  suffix: string | undefined,
  norm: (s: string) => string
): number {
  const pre = norm(prefix ?? "");
  const suf = norm(suffix ?? "");
  if (!pre && !suf) return -1;
  let found = -1;
  for (const p of offs) {
    if (pre) {
      const lo = Math.max(0, p - 4 * (prefix ?? "").length - 64);
      if (!norm(hay.slice(lo, p)).endsWith(pre)) continue;
    }
    if (suf) {
      const end = p + needleLen;
      const hi = end + 4 * (suffix ?? "").length + 64;
      if (!norm(hay.slice(end, hi)).startsWith(suf)) continue;
    }
    if (found >= 0) return -1;
    found = p;
  }
  return found;
}

function inMermaidHost(node: Node): boolean {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return !!el?.closest("[data-mm-mermaid-host]");
}

export function unwrapHighlights(container: HTMLElement) {
  const spans = Array.from(container.querySelectorAll("span.mm-highlight"));
  for (const span of spans) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
  }
  container.normalize();
}

export function applyHighlights(
  container: HTMLElement,
  ranges: HighlightRange[]
) {
  unwrapHighlights(container);

  // Resolve agent-style anchors (start == end == 0 with non-empty exact) by
  // finding the substring in the current textContent.
  const resolved = ranges.map((r) =>
    r.start === 0 && r.end === 0 && r.exact
      ? resolveTextAnchor(container, r)
      : r
  );

  const sorted = resolved
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  for (const r of sorted) {
    wrapRange(container, r);
  }
}

// resolveTextAnchor walks the container's textContent and returns the
// occurrence of r.exact designated by the anchor's prefix / suffix (the
// first one when there's no context or it doesn't settle it), mapping
// it back to a [start, end] character range. Used for comments created
// by agents via MCP and for comments carried to a new revision, whose
// offsets are zeroed.
function resolveTextAnchor(
  container: HTMLElement,
  r: HighlightRange
): HighlightRange {
  const needle = r.exact ?? "";
  if (!needle) return r;
  let combined = "";
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    combined += cur.textContent ?? "";
  }
  const offs = occurrenceOffsets(combined, needle);
  if (offs.length === 0) return { ...r, start: 0, end: 0 };
  let idx = offs[0];
  if (offs.length > 1) {
    const picked = pickOccurrenceByContext(
      combined, offs, needle.length, r.prefix, r.suffix, squashSpace
    );
    if (picked >= 0) idx = picked;
  }
  return { ...r, start: idx, end: idx + needle.length };
}

function wrapRange(container: HTMLElement, range: HighlightRange) {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const targets: Array<{
    node: Text;
    startInNode: number;
    endInNode: number;
  }> = [];

  let cur: Node | null;
  while ((cur = walker.nextNode())) {
    const text = cur as Text;
    const len = text.length;
    const nodeStart = offset;
    const nodeEnd = offset + len;
    offset = nodeEnd;

    if (nodeEnd <= range.start || nodeStart >= range.end) continue;
    if (text.parentElement?.closest("span.mm-highlight")) continue;

    const startInNode = Math.max(0, range.start - nodeStart);
    const endInNode = Math.min(len, range.end - nodeStart);
    if (endInNode > startInNode) {
      targets.push({ node: text, startInNode, endInNode });
    }
  }

  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    let target: Text = t.node;
    if (t.startInNode > 0) {
      target = target.splitText(t.startInNode);
    }
    const segLen = t.endInNode - t.startInNode;
    if (segLen < target.length) {
      target.splitText(segLen);
    }
    const span = document.createElement("span");
    span.className = "mm-highlight";
    span.dataset.commentId = range.id;
    if (range.resolved) span.dataset.resolved = "true";
    if (range.active) span.dataset.active = "true";
    target.parentNode!.insertBefore(span, target);
    span.appendChild(target);
  }
}

export function getHighlightRect(
  container: HTMLElement,
  commentId: string
): DOMRect | null {
  const el = container.querySelector(
    `span.mm-highlight[data-comment-id="${commentId}"]`
  );
  if (!el) return null;
  // Highlights inside a Mermaid block's source measure 0×0 while the
  // diagram is shown (the <pre> is hidden); align to the block instead.
  const hiddenSource = el.closest("[data-mm-mermaid-source][hidden]");
  const block = hiddenSource?.closest("[data-mm-mermaid]");
  if (block) return block.getBoundingClientRect();
  return (el as HTMLElement).getBoundingClientRect();
}
