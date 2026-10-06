// Table of contents for the rendered document (TocSidebar).
//
// Built from the rendered DOM rather than the markdown source so the ids
// are exactly the ones rehype-slug + sanitize emitted (user-content-
// prefix, duplicate suffixes) — no second slugger to keep in sync.

import { USER_CONTENT_PREFIX } from "./headingAnchor";

export interface TocItem {
  /** DOM id of the heading, prefix included. */
  id: string;
  text: string;
  /** 1–4 (h1–h4). Deeper levels are left out to keep the list scannable. */
  level: number;
}

const TOC_SELECTOR = "h1[id], h2[id], h3[id], h4[id]";

export function extractToc(root: ParentNode): TocItem[] {
  const items: TocItem[] = [];
  root.querySelectorAll<HTMLElement>(TOC_SELECTOR).forEach((h) => {
    const text = (h.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return;
    items.push({ id: h.id, text, level: Number(h.tagName[1]) });
  });
  return items;
}

/** The fragment a TOC click writes to the address bar — same shape as a
 * hand-written `[x](#slug)` link, without the sanitizer prefix. */
export function fragmentForId(id: string): string {
  return id.startsWith(USER_CONTENT_PREFIX) ? id.slice(USER_CONTENT_PREFIX.length) : id;
}

/** The section the reader is in: the last heading whose top has scrolled
 * past `offset` px from the viewport top (the sticky-header allowance),
 * or the first heading when none has yet. */
export function activeTocId(
  items: TocItem[],
  root: ParentNode,
  offset: number,
): string | null {
  const wanted = new Set(items.map((i) => i.id));
  let active: string | null = items[0]?.id ?? null;
  for (const el of root.querySelectorAll<HTMLElement>(TOC_SELECTOR)) {
    if (!wanted.has(el.id)) continue;
    if (el.getBoundingClientRect().top - offset <= 0) active = el.id;
    else break;
  }
  return active;
}
