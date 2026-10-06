import type { TocItem } from "../utils/toc";

interface Props {
  items: TocItem[];
  activeId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (item: TocItem) => void;
  /** Shown instead of the list (e.g. while editing, when the rendered
   * headings the list points at aren't on the page). */
  unavailableReason?: string;
}

// Left-hand, collapsible table of contents for the Document page.
// Mirrors the comment sidebar's layout contract: sticky to the page
// scroll (`sticky top-0 h-screen self-start`) with its own overflow for
// long lists. It never scrolls the page on its own — clicks do, via
// onSelect — so it can't disturb the comment-card layout, which only
// reads vertical positions.
export default function TocSidebar({
  items,
  activeId,
  open,
  onToggle,
  onSelect,
  unavailableReason,
}: Props) {
  const minLevel = Math.min(...items.map((i) => i.level));
  return (
    <nav
      aria-label="Table of contents"
      className={`hidden lg:flex flex-col shrink-0 border-r border-rule bg-card sticky top-0 h-screen self-start transition-[width] duration-150 ${
        open ? "w-64" : "w-10"
      }`}
    >
      <div
        className={`flex items-center border-b border-rule py-3 ${
          open ? "justify-between px-4" : "justify-center"
        }`}
      >
        {open && (
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Contents
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={open ? "Hide table of contents" : "Show table of contents"}
          className="p-1 rounded text-muted hover:text-ink hover:bg-soft"
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className={`w-4 h-4 transition-transform ${open ? "" : "rotate-180"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open &&
        (unavailableReason ? (
          <p className="px-4 py-3 text-xs text-muted">{unavailableReason}</p>
        ) : (
          <ul className="flex-1 overflow-y-auto py-2 text-sm">
            {items.map((item) => {
              const active = item.id === activeId;
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onSelect(item);
                    }}
                    aria-current={active ? "location" : undefined}
                    title={item.text}
                    style={{ paddingLeft: `${1 + (item.level - minLevel) * 0.75}rem` }}
                    className={`block truncate pr-3 py-1 border-l-2 ${
                      active
                        ? "border-accent text-accent font-medium"
                        : "border-transparent text-muted hover:text-ink"
                    }`}
                  >
                    {item.text}
                  </a>
                </li>
              );
            })}
          </ul>
        ))}
    </nav>
  );
}
