import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { createPortal } from "react-dom";
import { useOptionalToast } from "./Toast";
import { PanZoom, ZOOM_STEP } from "../utils/panZoom";
import { exportDiagram, renderMermaid, type ExportFormat } from "../utils/mermaid";

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
//   • the toolbar carries no text nodes — icons + aria-label/title only;
//   • the fullscreen viewer and the download menu are portalled to
//     <body>, outside the prose container, so they may carry text.
//
// Comments anchored inside the source still highlight (inside the hidden
// <pre>); getHighlightRect falls back to this block's rect, and the block
// flips to source view when one of those comments becomes active.

// Zoom/pan (utils/panZoom.ts) sizes the SVG in px and pans by
// scrolling .wrap. Grid + margin:auto centres a small diagram yet lets
// a zoomed one overflow to the right/bottom, where it can scroll (a
// flex centre would clip its left edge).
const SHADOW_STYLE = `<style>
:host { display: block; }
.wrap { display: grid; overflow: auto; }
.wrap[data-zoomed="true"] { max-height: 75vh; cursor: grab; }
.wrap[data-panning] { cursor: grabbing; }
svg { display: block; margin: auto; max-width: 100%; height: auto; }
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
  const panRef = useRef<PanZoom | null>(null);
  const lastActiveRef = useRef<string | null>(null);
  const dark = useIsDark();
  const toast = useOptionalToast();
  const [status, setStatus] = useState<Status>("loading");
  const [svg, setSvg] = useState<string | null>(null);
  const [view, setView] = useState<"diagram" | "source">("diagram");
  const [commentCount, setCommentCount] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  // The shadow root and its zoomable viewport are built once; renders
  // only swap the SVG inside it, so the zoom level survives a theme
  // flip or a live doc update.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = `${SHADOW_STYLE}<div class="wrap"></div>`;
    const pan = new PanZoom(root.querySelector<HTMLElement>(".wrap")!, {
      fit: "natural",
      wheel: "modifier",
      onChange: (scale) => setZoomed(scale !== null),
    });
    panRef.current = pan;
    return () => {
      pan.destroy();
      panRef.current = null;
    };
  }, []);

  useEffect(() => {
    const root = hostRef.current?.shadowRoot;
    const wrap = root?.querySelector<HTMLElement>(".wrap");
    if (!root || !wrap) return;
    let cancelled = false;
    // The previous SVG (if any) stays up until the new one is ready, so
    // a theme flip or a live doc update doesn't flash the source.
    renderMermaid(source, dark).then(
      (markup) => {
        if (cancelled) return;
        root.querySelector(".err")?.remove();
        wrap.innerHTML = markup;
        panRef.current?.attach(wrap.querySelector("svg"));
        setSvg(markup);
        setStatus("ok");
      },
      (err: unknown) => {
        if (cancelled) return;
        wrap.innerHTML = "";
        panRef.current?.attach(null);
        const note = root.querySelector(".err") ?? document.createElement("div");
        note.className = "err";
        const msg = err instanceof Error ? err.message.split("\n")[0] : "";
        note.textContent = `Couldn't render this Mermaid diagram — showing its source.${msg ? ` (${msg})` : ""}`;
        root.insertBefore(note, wrap);
        setSvg(null);
        setStatus("error");
        setFullscreen(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [source, dark]);

  const download = (format: ExportFormat) => {
    setMenuAnchor(null);
    exportDiagram(source, format).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (toast) toast.error(`Couldn't export the diagram: ${msg}`);
      else console.error("mermaid export", err);
    });
  };

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
          {view === "diagram" && (
            <>
              <span className="mm-mermaid-sep" aria-hidden />
              <button
                type="button"
                aria-label="Zoom out"
                title="Zoom out (Ctrl/⌘ + scroll)"
                onClick={() => panRef.current?.zoomBy(1 / ZOOM_STEP)}
              >
                <ZoomOutIcon />
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                title="Zoom in (Ctrl/⌘ + scroll)"
                onClick={() => panRef.current?.zoomBy(ZOOM_STEP)}
              >
                <ZoomInIcon />
              </button>
              {zoomed && (
                <button
                  type="button"
                  aria-label="Reset zoom"
                  title="Reset zoom"
                  onClick={() => panRef.current?.reset()}
                >
                  <FitIcon />
                </button>
              )}
              <button
                type="button"
                aria-label="Full screen"
                title="Full screen"
                onClick={() => setFullscreen(true)}
              >
                <ExpandIcon />
              </button>
              <button
                type="button"
                aria-label="Download"
                title="Download"
                aria-haspopup="menu"
                aria-expanded={menuAnchor !== null}
                onClick={(e) => {
                  const el = e.currentTarget;
                  setMenuAnchor((cur) => (cur ? null : el));
                }}
              >
                <DownloadIcon />
              </button>
            </>
          )}
        </div>
      )}
      {menuAnchor && !fullscreen && (
        <DownloadMenu
          anchor={menuAnchor}
          onPick={download}
          onClose={() => setMenuAnchor(null)}
        />
      )}
      {fullscreen && svg && (
        <MermaidFullscreen
          svg={svg}
          onClose={() => setFullscreen(false)}
          onDownload={download}
        />
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

// React events from a portal still bubble through the React tree — up
// into the prose container's handlers (selection, link clicks). Stop
// them at the portal root.
const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
const isolate = {
  onClick: stop,
  onMouseDown: stop,
  onMouseUp: stop,
  onPointerDown: stop,
  onPointerUp: stop,
  onKeyDown: stop,
  onContextMenu: stop,
};

const FULLSCREEN_STYLE = `<style>
:host { display: block; height: 100%; }
.wrap {
  display: grid;
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
  padding: 24px;
  cursor: grab;
}
.wrap[data-panning] { cursor: grabbing; }
svg { display: block; margin: auto; }
</style>`;

const toolBtn =
  "inline-flex items-center justify-center h-8 min-w-8 px-2 rounded-md text-sm text-muted hover:text-ink hover:bg-soft";

// MermaidFullscreen shows the diagram over the whole window: fitted on
// open, wheel / pinch zooms around the cursor, drag pans, + − 0 keys.
function MermaidFullscreen({
  svg,
  onClose,
  onDownload,
}: {
  svg: string;
  onClose: () => void;
  onDownload: (format: ExportFormat) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanZoom | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [percent, setPercent] = useState(100);
  const [fitted, setFitted] = useState(true);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    root.innerHTML = `${FULLSCREEN_STYLE}<div class="wrap"></div>`;
    const pan = new PanZoom(root.querySelector<HTMLElement>(".wrap")!, {
      fit: "fit",
      wheel: "always",
      onChange: (scale, effective) => {
        setFitted(scale === null);
        setPercent(Math.round(effective * 100));
      },
    });
    panRef.current = pan;
    return () => {
      pan.destroy();
      panRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const wrap = hostRef.current?.shadowRoot?.querySelector<HTMLElement>(".wrap");
    if (!wrap) return;
    wrap.innerHTML = svg;
    panRef.current?.attach(wrap.querySelector("svg"));
  }, [svg]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const pan = panRef.current;
      if (e.key === "+" || e.key === "=") pan?.zoomBy(ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") pan?.zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0") pan?.reset();
      else return;
      e.preventDefault();
    };
    // Capture: the portal root's `isolate` stops keydown bubbling at
    // <body>, before a bubbling document listener would see it.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      {...isolate}
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid diagram"
      className="fixed inset-0 z-[90] flex flex-col bg-card text-ink select-none"
    >
      <div className="flex items-center gap-1 px-3 py-2 border-b border-rule">
        <button
          type="button"
          className={toolBtn}
          aria-label="Zoom out"
          title="Zoom out (−)"
          onClick={() => panRef.current?.zoomBy(1 / ZOOM_STEP)}
        >
          <ZoomOutIcon size={16} />
        </button>
        <span className="w-14 text-center text-sm tabular-nums text-muted" aria-live="polite">
          {percent}%
        </span>
        <button
          type="button"
          className={toolBtn}
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={() => panRef.current?.zoomBy(ZOOM_STEP)}
        >
          <ZoomInIcon size={16} />
        </button>
        <button
          type="button"
          className={toolBtn}
          title="Fit to screen (0)"
          disabled={fitted}
          onClick={() => panRef.current?.reset()}
        >
          Fit
        </button>
        <span className="ml-3 text-xs text-faint hidden sm:inline">
          Scroll to zoom · drag to pan
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className={toolBtn}
            aria-haspopup="menu"
            aria-expanded={menuAnchor !== null}
            onClick={(e) => {
              const el = e.currentTarget;
              setMenuAnchor((cur) => (cur ? null : el));
            }}
          >
            <DownloadIcon size={16} />
            <span className="ml-1.5">Download</span>
          </button>
          <button
            ref={closeRef}
            type="button"
            className={toolBtn}
            aria-label="Close full screen"
            title="Close (Esc)"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      <div ref={hostRef} className="flex-1 min-h-0" data-mm-mermaid-fullscreen="" />
      {menuAnchor && (
        <DownloadMenu
          anchor={menuAnchor}
          onPick={(f) => {
            setMenuAnchor(null);
            onDownload(f);
          }}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </div>,
    document.body,
  );
}

const EXPORT_ITEMS: { format: ExportFormat; label: string }[] = [
  { format: "png", label: "PNG image" },
  { format: "svg", label: "SVG image" },
  { format: "pdf", label: "PDF (print)…" },
];

// DownloadMenu is a small popup menu under `anchor`, portalled to
// <body> so its labels stay out of the prose textContent.
function DownloadMenu({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  onPick: (format: ExportFormat) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [rect, setRect] = useState(() => anchor.getBoundingClientRect());

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const close = () => onCloseRef.current();
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchor.contains(t)) return;
      close();
    };
    // Capture on window: runs before the fullscreen viewer's Escape,
    // so Esc closes only the menu.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        anchor.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [],
      );
      if (items.length === 0) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      items[(next + items.length) % items.length].focus();
    };
    const follow = () => setRect(anchor.getBoundingClientRect());
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [anchor]);

  return createPortal(
    <div
      {...isolate}
      ref={menuRef}
      role="menu"
      aria-label="Download diagram"
      className="fixed z-[95] min-w-40 py-1 rounded-md border border-rule bg-card text-ink text-sm shadow-lg select-none"
      style={{ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) }}
    >
      {EXPORT_ITEMS.map((item) => (
        <button
          key={item.format}
          type="button"
          role="menuitem"
          className="block w-full text-left px-3 py-1.5 hover:bg-soft focus:bg-soft focus:outline-none"
          onClick={() => onPick(item.format)}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

function ZoomInIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="7" cy="7" r="4.75" />
      <path d="M10.5 10.5 14.5 14.5M5 7h4M7 5v4" />
    </svg>
  );
}

function ZoomOutIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="7" cy="7" r="4.75" />
      <path d="M10.5 10.5 14.5 14.5M5 7h4" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" />
      <rect x="5" y="5" width="6" height="6" rx="1" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" />
    </svg>
  );
}

function DownloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M8 1.5v9M4.5 7 8 10.5 11.5 7M2 12.5v2h12v-2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}
