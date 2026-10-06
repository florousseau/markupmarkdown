// PanZoom drives zoom + pan for a Mermaid SVG inside a scrollable
// viewport. Panning is the viewport's own scroll position (so scrollbars,
// trackpads and keyboard scrolling all keep working); zooming sets the
// SVG's pixel size from its viewBox. The SVG is replaced on every
// re-render (theme flip, live doc update), so callers re-attach it.

export interface PanZoomOptions {
  /** "fit": a null scale fits the whole diagram in the viewport (may
   *  upscale — fullscreen). "natural": a null scale leaves the SVG's own
   *  sizing alone (inline: natural size, shrunk to the column width). */
  fit: "fit" | "natural";
  /** Plain wheel zooms ("always") or only with Ctrl/⌘ — which is also
   *  what a trackpad pinch sends ("modifier"). */
  wheel: "always" | "modifier";
  /** Called after every scale change; null = fitted / natural. */
  onChange?: (scale: number | null, effective: number) => void;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;
export const ZOOM_STEP = 1.25;

export class PanZoom {
  private svg: SVGSVGElement | null = null;
  private scale: number | null = null;
  private readonly viewport: HTMLElement;
  private readonly opts: PanZoomOptions;
  private readonly ro: ResizeObserver | null;
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;

  constructor(viewport: HTMLElement, opts: PanZoomOptions) {
    this.viewport = viewport;
    this.opts = opts;
    viewport.addEventListener("wheel", this.onWheel, { passive: false });
    viewport.addEventListener("pointerdown", this.onPointerDown);
    viewport.addEventListener("pointermove", this.onPointerMove);
    viewport.addEventListener("pointerup", this.onPointerUp);
    viewport.addEventListener("pointercancel", this.onPointerUp);
    // A fitted diagram follows the viewport (window resize, sidebar).
    this.ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (this.scale === null) this.apply();
          });
    this.ro?.observe(viewport);
  }

  destroy() {
    const v = this.viewport;
    v.removeEventListener("wheel", this.onWheel);
    v.removeEventListener("pointerdown", this.onPointerDown);
    v.removeEventListener("pointermove", this.onPointerMove);
    v.removeEventListener("pointerup", this.onPointerUp);
    v.removeEventListener("pointercancel", this.onPointerUp);
    this.ro?.disconnect();
  }

  attach(svg: SVGSVGElement | null) {
    this.svg = svg;
    this.apply();
  }

  /** Back to fitted / natural size. */
  reset() {
    this.scale = null;
    this.apply();
    this.viewport.scrollLeft = 0;
    this.viewport.scrollTop = 0;
  }

  /** Multiply the current scale, keeping the point under (clientX,
   *  clientY) — or the viewport centre — where it is. */
  zoomBy(factor: number, clientX?: number, clientY?: number) {
    const svg = this.svg;
    const size = svg && naturalSize(svg);
    if (!svg || !size) return;
    const before = svg.getBoundingClientRect();
    const current = this.scale ?? (before.width > 0 ? before.width / size.w : 1);
    const next = clamp(current * factor, MIN_SCALE, MAX_SCALE);
    if (next === current && this.scale !== null) return;

    const vp = this.viewport.getBoundingClientRect();
    const cx = clientX ?? vp.left + vp.width / 2;
    const cy = clientY ?? vp.top + vp.height / 2;
    // Fraction of the diagram under the focus point, before the resize.
    const fx = before.width > 0 ? (cx - before.left) / before.width : 0.5;
    const fy = before.height > 0 ? (cy - before.top) / before.height : 0.5;

    this.scale = next;
    this.apply();

    const after = svg.getBoundingClientRect();
    this.viewport.scrollLeft += after.left + fx * after.width - cx;
    this.viewport.scrollTop += after.top + fy * after.height - cy;
  }

  private effectiveScale(size: { w: number; h: number }): number {
    if (this.scale !== null) return this.scale;
    const v = this.viewport;
    if (this.opts.fit === "fit") {
      const cs = getComputedStyle(v);
      const w = v.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
      const h = v.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
      if (w <= 0 || h <= 0) return 1;
      return clamp(Math.min(w / size.w, h / size.h), MIN_SCALE, MAX_SCALE);
    }
    const rendered = this.svg?.getBoundingClientRect().width ?? 0;
    return rendered > 0 ? rendered / size.w : 1;
  }

  private apply() {
    const svg = this.svg;
    if (!svg) return;
    const size = naturalSize(svg);
    const natural = this.scale === null && this.opts.fit === "natural";
    this.viewport.dataset.zoomed = this.scale === null ? "false" : "true";
    if (!size || natural) {
      // Mermaid's own sizing: width=100% + max-width: <natural>px.
      svg.style.removeProperty("width");
      svg.style.removeProperty("height");
      svg.style.removeProperty("min-width");
      if (size) svg.style.maxWidth = `${size.w}px`;
    } else {
      const s = this.effectiveScale(size);
      svg.style.width = `${size.w * s}px`;
      svg.style.height = `${size.h * s}px`;
      svg.style.minWidth = `${size.w * s}px`;
      svg.style.maxWidth = "none";
    }
    this.opts.onChange?.(this.scale, size ? this.effectiveScale(size) : 1);
  }

  private onWheel = (e: WheelEvent) => {
    if (this.opts.wheel === "modifier" && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    // deltaMode 1 = lines (Firefox mouse wheel): ~16px each.
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomBy(Math.exp(-dy * 0.0015), e.clientX, e.clientY);
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === "touch") return;
    const v = this.viewport;
    if (v.scrollWidth <= v.clientWidth && v.scrollHeight <= v.clientHeight) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    v.setPointerCapture?.(e.pointerId);
    v.dataset.panning = "true";
  };

  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.viewport.scrollLeft -= e.clientX - d.x;
    this.viewport.scrollTop -= e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved = true;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    this.drag = null;
    this.viewport.releasePointerCapture?.(e.pointerId);
    delete this.viewport.dataset.panning;
  };
}

/** The diagram's intrinsic size, from its viewBox. */
export function naturalSize(svg: SVGSVGElement): { w: number; h: number } | null {
  const vb = svg.getAttribute("viewBox");
  if (!vb) return null;
  const parts = vb.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || !(parts[2] > 0) || !(parts[3] > 0)) return null;
  return { w: parts[2], h: parts[3] };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function px(v: string) {
  return parseFloat(v) || 0;
}
