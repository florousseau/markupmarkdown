// In-document anchor resolution for rendered markdown.
//
// rehype-slug gives every heading a GitHub-compatible id (github-slugger:
// lowercase, spaces → dashes, punctuation/emoji dropped, accents kept,
// `-1`, `-2` suffixes for duplicates). rehype-sanitize then prefixes every
// id/name with `user-content-` (its default clobberPrefix) so user content
// can't clobber DOM globals or collide with app ids. That prefix is
// deliberate and stays — GitHub renders the exact same ids. Links, though,
// are written without it (`[Résumé](#résumé-exécutif)`), so, like GitHub's
// own client code, we map `#x` to `user-content-x` at lookup time.

export const USER_CONTENT_PREFIX = "user-content-";

// decodeFragment turns a raw URL fragment ("#r%C3%A9sum%C3%A9" or
// "résumé") into the id text. Malformed percent-escapes fall back to the
// raw string instead of throwing.
export function decodeFragment(fragment: string): string {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/["\\]/g, "\\$&");
}

// findAnchorTarget returns the element inside `root` a fragment points
// at, or null. Tries, in order: the prefixed id (what our renderer
// emits), the bare id (a link that already carries the prefix, or an
// id coming from outside the sanitizer), then lowercase variants of both
// for hand-written tables of contents (`#Résumé-Exécutif`). `name`
// attributes (`<a name="x">`) are matched the same way.
export function findAnchorTarget(
  root: ParentNode,
  fragment: string,
): HTMLElement | null {
  const id = decodeFragment(fragment);
  if (!id) return null;
  const variants = id === id.toLowerCase() ? [id] : [id, id.toLowerCase()];
  for (const v of variants) {
    for (const candidate of [USER_CONTENT_PREFIX + v, v]) {
      const esc = cssEscape(candidate);
      const el = root.querySelector<HTMLElement>(
        `[id="${esc}"], a[name="${esc}"]`,
      );
      if (el) return el;
    }
  }
  return null;
}

// setUrlFragment updates the address bar to `#id` without a reload and
// without dropping React Router's history.state (its idx/key live there;
// replacing it with null confuses back/forward).
export function setUrlFragment(id: string) {
  if (!window.history?.replaceState) return;
  const url = `${window.location.pathname}${window.location.search}#${encodeURIComponent(id)}`;
  window.history.replaceState(window.history.state, "", url);
}
