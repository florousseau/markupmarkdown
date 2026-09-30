// Relative links between uploaded docs.
//
// An uploaded doc has no source URL to resolve `[x](AUTRE.md#s)`
// against, so the browser would land on /d/AUTRE.md. MarkdownRender
// hands such links to the page, which asks the backend
// (api.resolveDocLink) which upload they name. Mirrors the backend's
// linkTargetName in doclinks.go — keep the two in sync.

const MD_EXT = /\.(md|markdown|mdx)$/i;

export interface RelativeDocLink {
  /** The href as written — sent to the resolver verbatim. */
  href: string;
  /** "#section" or "" — re-applied on the target doc. */
  hash: string;
}

export function parseRelativeDocLink(href: string): RelativeDocLink | null {
  const h = href.trim();
  if (!h || h.startsWith("#") || h.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // has a scheme
  const hashAt = h.indexOf("#");
  const hash = hashAt >= 0 ? h.slice(hashAt) : "";
  const pathPart = (hashAt >= 0 ? h.slice(0, hashAt) : h).split("?")[0];
  if (!MD_EXT.test(pathPart)) return null;
  return { href: h, hash: hash.length > 1 ? hash : "" };
}
