import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";

// MermaidBlock renders a ```mermaid fence as a diagram WITHOUT changing
// the container's textContent. That's load-bearing: comment anchors are
// character offsets into the rendered textContent (utils/anchor.ts), and
// the backend's render.PlainText mirrors that textContent for MCP
// anchoring — code blocks included. So:
//
//   • the original <pre><code> stays in the light DOM, merely `hidden`
//     while the diagram is shown (TreeWalker ignores CSS, offsets hold);
//   • the SVG lives in a shadow root, which light-DOM textContent and
//     TreeWalkers never see (its <text> labels would otherwise shift
//     every offset after the diagram);
//   • the toolbar carries no text nodes — icons + aria-label/title only.
//
// Comments anchored inside the source still highlight (inside the hidden
// <pre>); getHighlightRect falls back to this block's rect, and the block
// flips to source view when one of those comments becomes active.

type Mermaid = typeof import("mermaid").default;

let mermaidPromise: Promise<Mermaid> | null = null;

// Lazy: mermaid is several MB, so it's only fetched once a doc actually
// contains a diagram. A failed chunk load is retried on the next block.
function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(
      (m) => m.default,
      (err) => {
        mermaidPromise = null;
        throw err;
      },
    );
  }
  return mermaidPromise;
}

let renderQueue: Promise<unknown> = Promise.resolve();
let renderSeq = 0;

// renderMermaid serializes initialize + render: mermaid's config is
// global, so two blocks rendering with different themes must not
// interleave.
export function renderMermaid(source: string, dark: boolean): Promise<string> {
  const job = renderQueue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      // Docs come from arbitrary URLs: strict sanitizes labels and
      // disables click handlers / embedded scripts. Mermaid refuses to
      // let %%{init}%% directives override it.
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: dark ? "dark" : "default",
    });
    const id = `mm-mermaid-${++renderSeq}`;
    try {
      const { svg } = await mermaid.render(id, source);
      return svg;
    } finally {
      // mermaid.render measures in a temporary node under <body>; on a
      // parse error some versions leave it behind.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }
  });
  renderQueue = job.catch(() => undefined);
  return job;
}

const SHADOW_STYLE = `<style>
:host { display: block; }
.wrap { display: flex; justify-content: center; overflow-x: auto; }
svg { max-width: 100%; height: auto; }
.err {
  font: 12px ui-sans-serif, system-ui, sans-serif;
  color: var(--color-warn-action);
  padding: 0 0 6px;
}
</style>`;

function useIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const update = () =>
      setDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

interface Props extends ComponentPropsWithoutRef<"pre"> {
  /** Diagram source (the fence body without its trailing newline). */
  source: string;
}

type Status = "loading" | "ok" | "error";

export default function MermaidBlock({ source, children, ...preProps }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const lastActiveRef = useRef<string | null>(null);
  const dark = useIsDark();
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<"diagram" | "source">("diagram");
  const [commentCount, setCommentCount] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    let cancelled = false;
    // The previous SVG (if any) stays up until the new one is ready, so
    // a theme flip or a live doc update doesn't flash the source.
    renderMermaid(source, dark).then(
      (svg) => {
        if (cancelled) return;
        root.innerHTML = `${SHADOW_STYLE}<div class="wrap">${svg}</div>`;
        setStatus("ok");
      },
      (err: unknown) => {
        if (cancelled) return;
        root.innerHTML = `${SHADOW_STYLE}<div class="err"></div>`;
        const msg = err instanceof Error ? err.message.split("\n")[0] : "";
        root.querySelector(".err")!.textContent =
          `Couldn't render this Mermaid diagram — showing its source.${msg ? ` (${msg})` : ""}`;
        setStatus("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, dark]);

  // Watch the highlights Document.tsx wraps inside the source: count
  // them for the toolbar dot, and flip to source view when one becomes
  // the active comment (Next/Prev, card click). Only on a CHANGE of
  // active id — highlights are re-applied on every comments refresh,
  // and that must not undo the user switching back to the diagram.
  useEffect(() => {
    const pre = preRef.current;
    if (!pre) return;
    const scan = () => {
      const spans = pre.querySelectorAll<HTMLElement>("span.mm-highlight");
      const ids = new Set<string>();
      let active: string | null = null;
      for (const s of Array.from(spans)) {
        const id = s.dataset.commentId;
        if (!id) continue;
        ids.add(id);
        if (s.dataset.active === "true") active = id;
      }
      setCommentCount(ids.size);
      if (active && active !== lastActiveRef.current) setView("source");
      lastActiveRef.current = active;
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(pre, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-active"],
    });
    return () => observer.disconnect();
  }, []);

  const showSource = view === "source" || status !== "ok";
  const showDiagram = status !== "loading" && (view === "diagram" || status === "error");

  return (
    <div className="mm-mermaid" data-mm-mermaid="">
      {status === "ok" && (
        <div className="mm-mermaid-toolbar" role="group" aria-label="Mermaid view">
          <button
            type="button"
            aria-label="Show diagram"
            title="Show diagram"
            aria-pressed={view === "diagram"}
            onClick={() => setView("diagram")}
          >
            <DiagramIcon />
          </button>
          <button
            type="button"
            aria-label={
              commentCount > 0
                ? `Show source (${commentCount} comment${commentCount === 1 ? "" : "s"})`
                : "Show source"
            }
            title="Show source"
            aria-pressed={view === "source"}
            onClick={() => setView("source")}
          >
            <SourceIcon />
            {commentCount > 0 && view === "diagram" && (
              <span className="mm-mermaid-dot" aria-hidden />
            )}
          </button>
        </div>
      )}
      <div
        ref={hostRef}
        className="mm-mermaid-diagram"
        data-mm-mermaid-host=""
        hidden={!showDiagram}
      />
      <pre
        {...preProps}
        ref={preRef}
        data-mm-mermaid-source=""
        hidden={!showSource}
      >
        {children}
      </pre>
    </div>
  );
}

// Icons carry no <title>: a <title> is a text node in the light DOM and
// would shift every comment offset after this block.
function DiagramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="1.5" y="1.5" width="5" height="4" rx="1" />
      <rect x="9.5" y="10.5" width="5" height="4" rx="1" />
      <path d="M4 5.5v3.5h8v1.5" />
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M5.5 4 1.5 8l4 4M10.5 4l4 4-4 4" />
    </svg>
  );
}
