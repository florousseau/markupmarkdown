import { useEffect, useState } from "react";

interface Props {
  /** Extra classes for placement (the page decides where "bottom-right
   * of the document column" is). */
  className?: string;
  /** Shown once the page has scrolled past this many pixels. */
  threshold?: number;
}

// Floating "back to top" button for the document page. The doc scrolls
// with the window (no inner scroller — see CLAUDE.md, editor surface),
// so this watches and scrolls the window.
export default function BackToTop({ className = "", threshold = 600 }: Props) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setVisible(window.scrollY > threshold);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [threshold]);

  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      title="Back to top"
      aria-label="Back to top"
      className={`fixed z-30 w-10 h-10 rounded-full bg-card border border-rule shadow-lg text-muted hover:text-ink hover:bg-soft flex items-center justify-center ${className}`}
    >
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
