// Mermaid loading, rendering and export. Rendering itself only happens
// in MermaidBlock; exports re-render the source with a fixed light theme
// so a download looks the same whatever theme the reader is on.

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

export interface RenderOptions {
  /** false draws labels as SVG <text> instead of HTML in
   *  <foreignObject>, which some browsers refuse to rasterize. */
  htmlLabels?: boolean;
}

// renderMermaid serializes initialize + render: mermaid's config is
// global, so two blocks rendering with different themes must not
// interleave. initialize() resets to defaults first, so options never
// leak from one render into the next.
export function renderMermaid(
  source: string,
  dark: boolean,
  opts: RenderOptions = {},
): Promise<string> {
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
      ...(opts.htmlLabels === false
        ? { htmlLabels: false, flowchart: { htmlLabels: false } }
        : {}),
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

export type ExportFormat = "svg" | "png" | "pdf";

const EXPORT_BASENAME = "diagram";
// Rasterize at 2× for crisp text, but keep the canvas well inside every
// browser's size limit (Safari: ~16.7M px area).
const PNG_SCALE = 2;
const PNG_MAX_SIDE = 8192;
const PNG_MAX_AREA = 16_000_000;

/** Download (or, for "pdf", print) the diagram in `source`. */
export async function exportDiagram(source: string, format: ExportFormat): Promise<void> {
  const svg = await renderMermaid(source, false);
  if (format === "svg") {
    const { markup } = standaloneSvg(svg);
    downloadBlob(new Blob([markup], { type: "image/svg+xml" }), `${EXPORT_BASENAME}.svg`);
    return;
  }
  if (format === "pdf") {
    printSvg(standaloneSvg(svg));
    return;
  }
  let png: Blob;
  try {
    png = await rasterize(standaloneSvg(svg));
  } catch (err) {
    // A tainted canvas (Safari, HTML labels in <foreignObject>) throws a
    // SecurityError on export: retry with plain SVG text labels.
    if (!(err instanceof DOMException) || err.name !== "SecurityError") throw err;
    png = await rasterize(
      standaloneSvg(await renderMermaid(source, false, { htmlLabels: false })),
    );
  }
  downloadBlob(png, `${EXPORT_BASENAME}.png`);
}

interface Standalone {
  markup: string;
  width: number;
  height: number;
}

// standaloneSvg pins the SVG to its intrinsic size: mermaid emits
// width="100%", which an <img> or a file viewer can't resolve.
export function standaloneSvg(svg: string): Standalone {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement;
  const vb = (el.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const width = vb.length === 4 && vb[2] > 0 ? Math.ceil(vb[2]) : 800;
  const height = vb.length === 4 && vb[3] > 0 ? Math.ceil(vb[3]) : 600;
  el.setAttribute("width", String(width));
  el.setAttribute("height", String(height));
  el.removeAttribute("style");
  if (!el.getAttribute("xmlns")) el.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return { markup: new XMLSerializer().serializeToString(el), width, height };
}

async function rasterize({ markup, width, height }: Standalone): Promise<Blob> {
  // A data: URL (not a blob: URL) — Chrome taints the canvas for
  // blob-loaded SVGs containing <foreignObject>.
  const bytes = new TextEncoder().encode(markup);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const img = new Image();
  img.decoding = "sync";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("couldn't load the diagram image"));
    img.src = `data:image/svg+xml;base64,${btoa(bin)}`;
  });
  const scale = Math.min(
    PNG_SCALE,
    PNG_MAX_SIDE / width,
    PNG_MAX_SIDE / height,
    Math.sqrt(PNG_MAX_AREA / (width * height)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))),
        "image/png",
      );
    } catch (err) {
      reject(err);
    }
  });
}

// printSvg prints the diagram alone, scaled to one page, from a hidden
// iframe: the browser's print dialog offers "Save as PDF" everywhere,
// so there's no PDF library to ship. The iframe is sandboxed without
// scripts (the SVG is mermaid-strict output anyway).
function printSvg({ markup, width, height }: Standalone) {
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  const landscape = width > height;
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${EXPORT_BASENAME}</title><style>
@page { size: ${landscape ? "landscape" : "portrait"}; margin: 12mm; }
html, body { margin: 0; height: 100%; background: #fff; }
body { display: flex; align-items: center; justify-content: center; }
svg { max-width: 100%; max-height: 100%; width: auto; height: auto; }
</style></head><body>${markup}</body></html>`;
  frame.onload = () => {
    const win = frame.contentWindow;
    const cleanup = () => setTimeout(() => frame.remove(), 1000);
    if (!win) return cleanup();
    win.addEventListener("afterprint", cleanup, { once: true });
    win.focus();
    win.print();
    // Browsers where print() doesn't block and afterprint never fires.
    setTimeout(cleanup, 60_000);
  };
  document.body.appendChild(frame);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
