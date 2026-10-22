// Relative links between uploaded docs.
//
// An uploaded doc has no source URL to resolve `[x](AUTRE.md#s)`
// against, so the browser would land on /d/AUTRE.md. MarkdownRender
// rewrites such hrefs to /d/<current>/link/AUTRE.md#s — a real URL, so
// new-tab clicks and "copy link" work — and DocLinkResolve turns that
// into the target doc via api.resolveDocLink. Plain clicks skip the
// intermediate page. Mirrors the backend's linkTargetName in
// doclinks.go — keep the two in sync.

const MD_EXT = /\.(md|markdown|mdx)$/i;

export interface RelativeDocLink {
  /** Linked file name, still URL-encoded ("Mon%20Plan.md"). Only the
   * base name counts — uploads have no folder structure. */
  name: string;
  /** "#section" or "" — re-applied on the target doc. */
  hash: string;
}

function splitHash(href: string): [string, string] {
  const at = href.indexOf("#");
  if (at < 0) return [href, ""];
  const hash = href.slice(at);
  return [href.slice(0, at), hash.length > 1 ? hash : ""];
}

export function parseRelativeDocLink(href: string): RelativeDocLink | null {
  const h = href.trim();
  if (!h || h.startsWith("#") || h.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // has a scheme
  const [rest, hash] = splitHash(h);
  const path = rest.split("?")[0];
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (!MD_EXT.test(name)) return null;
  return { name, hash };
}

/** The in-app URL prefix for links out of doc `docId`. */
export function docLinkBase(docId: string): string {
  return `/d/${docId}/link/`;
}

export function docLinkHref(base: string, link: RelativeDocLink): string {
  return base + link.name + link.hash;
}

/** Inverse of docLinkHref; null when `href` isn't under `base`. */
export function parseDocLinkHref(base: string, href: string): RelativeDocLink | null {
  if (!href.startsWith(base)) return null;
  const [name, hash] = splitHash(href.slice(base.length));
  return name ? { name, hash } : null;
}
