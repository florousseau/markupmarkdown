import { forwardRef, memo, useCallback, useEffect, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type { Element, ElementContent } from "hast";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { makeUrlTransform } from "../utils/baseUrl";
import {
  decodeFragment,
  findAnchorTarget,
  setUrlFragment,
} from "../utils/headingAnchor";
import MermaidBlock from "./MermaidBlock";

interface Props {
  content: string;
  baseUrl?: string;
  /** The doc's canonical GitHub source URL (if any). Used to detect
   * "same-document" hyperlinks written as fully-qualified URLs —
   * `[Section](https://github.com/owner/repo/blob/ref/file.md#anchor)`
   * is the same physical file as the doc the user is currently
   * reading, so the click should scroll within the page rather than
   * navigating away to github.com. */
  sourceUrl?: string;
  /** Render ```mermaid fences as diagrams (default true). Off while a
   * revision is streaming in — a half-written diagram would re-render
   * and fail on every token. */
  renderDiagrams?: boolean;
}

// Extend the default sanitize schema to allow common HTML tags people put in
// READMEs: <img>, <picture>, <details>/<summary>, plus the width/height/align
// attributes those tags typically use. `id` on headings is allow-listed so
// rehype-slug's generated ids survive sanitization. Sanitize still prefixes
// them with `user-content-` (anti-clobbering, same as GitHub), so links are
// resolved through findAnchorTarget in utils/headingAnchor.ts, never by a
// bare getElementById.
const schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "picture",
    "source",
    "details",
    "summary",
    "kbd",
    "sub",
    "sup",
  ],
  attributes: {
    ...defaultSchema.attributes,
    h1: [...((defaultSchema.attributes?.h1 as unknown[]) ?? []), "id"],
    h2: [...((defaultSchema.attributes?.h2 as unknown[]) ?? []), "id"],
    h3: [...((defaultSchema.attributes?.h3 as unknown[]) ?? []), "id"],
    h4: [...((defaultSchema.attributes?.h4 as unknown[]) ?? []), "id"],
    h5: [...((defaultSchema.attributes?.h5 as unknown[]) ?? []), "id"],
    h6: [...((defaultSchema.attributes?.h6 as unknown[]) ?? []), "id"],
    img: [
      ...((defaultSchema.attributes?.img as unknown[]) ?? []),
      "width",
      "height",
      "align",
      "srcset",
    ],
    source: ["srcset", "media", "type"],
    "*": [
      ...((defaultSchema.attributes?.["*"] as unknown[]) ?? []),
      "align",
    ],
  },
};

// mermaidSource returns the diagram source when `pre` wraps a
// ```mermaid fence (<pre><code class="language-mermaid">), else null.
// rehype-sanitize's default schema keeps `language-*` classes on code.
function mermaidSource(pre: Element | undefined): string | null {
  const code = pre?.children.find((c) => c.type === "element");
  if (!code || code.type !== "element" || code.tagName !== "code") return null;
  const cls = code.properties?.className;
  const classes = Array.isArray(cls) ? cls : typeof cls === "string" ? cls.split(/\s+/) : [];
  if (!classes.includes("language-mermaid")) return null;
  return hastText(code).replace(/\n$/, "");
}

function hastText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(hastText).join("");
  return "";
}

// Overriding `pre` (not `code`) lets MermaidBlock wrap the original
// <pre> in a block container without nesting a <div> inside it. The
// original children are passed through untouched so the rendered
// textContent — and with it every comment anchor offset — is unchanged.
const diagramComponents: Components = {
  pre({ node, children, ...rest }) {
    const source = mermaidSource(node);
    if (source === null) return <pre {...rest}>{children}</pre>;
    return (
      <MermaidBlock {...rest} source={source}>
        {children}
      </MermaidBlock>
    );
  },
};

const MarkdownRender = memo(
  forwardRef<HTMLDivElement, Props>(({ content, baseUrl, sourceUrl, renderDiagrams = true }, ref) => {
    const urlTransform = makeUrlTransform(baseUrl);
    // Intercept clicks on in-document anchor links so they scroll
    // within the page instead of triggering a full reload. Three URL
    // shapes count as "same document":
    //   1. `#section-name` — bare fragment (toc / readme convention)
    //   2. `https://github.com/owner/repo/blob/ref/file.md#anchor` —
    //      fully-qualified GitHub URL pointing at the source the doc
    //      was cloned from. Common in markdown authored on GitHub.
    //   3. `https://mumd.metavert.io/owner/repo/blob/ref/file.md#anchor`
    //      — the same doc but expressed as our human URL.
    // Native browser behaviour would change window.location and snap-
    // scroll to the target — but with a sticky header in the layout,
    // the heading lands hidden behind it. We smooth-scroll into view
    // and let CSS `scroll-margin-top` (set on mm-prose headings in
    // styles.css) keep the heading clear of the toolbar. Off-document
    // links fall through to default.
    const onClick = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        const anchor = (e.target as HTMLElement).closest("a");
        if (!anchor) return;
        const href = anchor.getAttribute("href") ?? "";
        if (!href) return;

        let fragment = "";
        if (href.startsWith("#")) {
          fragment = href;
        } else {
          // Try to interpret the href as a fully-qualified URL and
          // detect whether it points at the same doc we're rendering.
          // Resolve against the page URL so relative paths like
          // `./WINGMAN_PRD.md#section` work too.
          let linkURL: URL;
          try {
            linkURL = new URL(href, window.location.href);
          } catch {
            return;
          }
          if (!linkURL.hash || linkURL.hash.length < 2) return;
          if (!isSameDoc(linkURL, sourceUrl)) return;
          fragment = linkURL.hash;
        }

        // A bare `#` or a fragment with no matching target falls through
        // to the browser default, same as GitHub.
        const target = findAnchorTarget(e.currentTarget, fragment);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        setUrlFragment(decodeFragment(fragment));
      },
      [sourceUrl],
    );

    // Shareable section links: honour `#section` in the URL once the doc
    // has rendered (the browser's own attempt ran before the content
    // arrived, and couldn't know about the user-content- prefix anyway),
    // and again whenever the hash changes by hand. Only the first render
    // with content scrolls — a live revision swap (SSE) must not yank the
    // reader back to the section they opened.
    const rootRef = useRef<HTMLDivElement | null>(null);
    const setRefs = useCallback(
      (el: HTMLDivElement | null) => {
        rootRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );
    const initialHashDone = useRef(false);
    useEffect(() => {
      const scrollToHash = (behavior: ScrollBehavior) => {
        const root = rootRef.current;
        const hash = window.location.hash;
        if (!root || hash.length < 2) return;
        findAnchorTarget(root, hash)?.scrollIntoView({ behavior, block: "start" });
      };
      if (!initialHashDone.current && content) {
        initialHashDone.current = true;
        scrollToHash("auto");
      }
      const onHashChange = () => scrollToHash("smooth");
      window.addEventListener("hashchange", onHashChange);
      return () => window.removeEventListener("hashchange", onHashChange);
    }, [content]);

    return (
      <div ref={setRefs} className="mm-prose" onClick={onClick}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug, rehypeRaw, [rehypeSanitize, schema]]}
          urlTransform={urlTransform}
          components={renderDiagrams ? diagramComponents : undefined}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  })
);

// isSameDoc returns true when `linkURL` points at the same physical
// file as the doc currently being rendered. Three matching shapes:
//   • points at this exact page (mumd.metavert.io/<same path>)
//   • points at the doc's GitHub source URL (sourceUrl, github.com/…)
//   • points at the raw.githubusercontent.com derivation of the source
// We strip the leading slash and lowercase the host before comparing —
// GitHub URLs are case-insensitive on the owner/repo segments.
function isSameDoc(linkURL: URL, sourceUrl?: string): boolean {
  const linkHost = linkURL.host.toLowerCase();
  const linkPath = linkURL.pathname.replace(/\/+$/, "");
  if (
    linkHost === window.location.host.toLowerCase() &&
    linkPath === window.location.pathname.replace(/\/+$/, "")
  ) {
    return true;
  }
  if (!sourceUrl) return false;
  try {
    const src = new URL(sourceUrl);
    const srcHost = src.host.toLowerCase();
    const srcPath = src.pathname.replace(/\/+$/, "");
    if (linkHost === srcHost && linkPath.toLowerCase() === srcPath.toLowerCase()) {
      return true;
    }
    // Also match the raw.githubusercontent.com form, which is what
    // urlTransform may have produced for relative links inside the doc.
    const m = sourceUrl.match(
      /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/,
    );
    if (m && linkHost === "raw.githubusercontent.com") {
      const rawPath = `/${m[1]}/${m[2]}/${m[3]}/${m[4]}`.toLowerCase();
      if (linkPath.toLowerCase() === rawPath) return true;
    }
  } catch {
    /* malformed sourceUrl — fall through to "not same doc" */
  }
  return false;
}

MarkdownRender.displayName = "MarkdownRender";
export default MarkdownRender;
