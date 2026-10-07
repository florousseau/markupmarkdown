import { useMemo, useState } from "react";
import { inlineWordDiff } from "../utils/diff";
import type { Suggestion } from "../types";

/** The suggested-change card inside a comment or a reply (P0-2,
 * upgraded). Default view is a tracked-changes inline diff — removed
 * words in red strikethrough, added words in green — so the reviewer
 * reads the change in one pass instead of eyeballing two blocks. A
 * toggle flips to the clean "result" text. Apply is one click, per
 * Brown & Parnin's actionability finding.
 *
 * `anchorExact` is the thread ROOT's anchored text: a reply's
 * suggestion replaces it too. Three states: active (Apply shown when
 * `onApply` is given — the parent passes it only to viewers allowed to
 * apply), superseded by a newer suggestion in the thread (dimmed, no
 * Apply), applied (marked as such). */
export default function SuggestionBlock({
  anchorExact,
  suggestion,
  superseded = false,
  onApply,
}: {
  anchorExact: string;
  suggestion?: Suggestion;
  superseded?: boolean;
  onApply?: () => Promise<void>;
}) {
  const [view, setView] = useState<"diff" | "result">("diff");
  const [applying, setApplying] = useState(false);

  const segments = useMemo(
    () =>
      suggestion ? inlineWordDiff(anchorExact, suggestion.replacement) : [],
    [anchorExact, suggestion]
  );

  if (!suggestion || !anchorExact) return null;
  const applied = Boolean(suggestion.appliedAt);
  const isSuperseded = !applied && superseded;

  return (
    <div
      className={
        "mt-3 rounded-md border border-rule bg-soft overflow-hidden" +
        (isSuperseded ? " opacity-60" : "")
      }
      data-suggestion-state={
        applied ? "applied" : isSuperseded ? "superseded" : "active"
      }
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-rule">
        <span className="text-[11px] uppercase tracking-wide text-muted">
          {isSuperseded ? "Superseded suggestion" : "Suggested change"}
        </span>
        {!applied && (
          <div className="flex text-[11px] rounded overflow-hidden border border-rule">
            {(["diff", "result"] as const).map((v) => (
              <button
                key={v}
                onClick={(e) => {
                  e.stopPropagation();
                  setView(v);
                }}
                className={
                  "px-2 py-0.5 transition " +
                  (view === v
                    ? "bg-accent text-accent-fg"
                    : "bg-card text-muted hover:text-ink")
                }
              >
                {v === "diff" ? "Changes" : "Result"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 py-2 text-xs whitespace-pre-wrap break-words text-ink leading-relaxed">
        {applied || view === "result"
          ? suggestion.replacement
          : segments.map((s, i) =>
              s.kind === "same" ? (
                <span key={i}>{s.text}</span>
              ) : s.kind === "removed" ? (
                <del
                  key={i}
                  className="bg-danger/10 text-danger line-through decoration-danger/60 rounded-[2px] px-[1px]"
                >
                  {s.text}
                </del>
              ) : (
                <ins
                  key={i}
                  className="bg-success/15 text-success no-underline font-medium rounded-[2px] px-[1px]"
                >
                  {s.text}
                </ins>
              )
            )}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-rule bg-card">
        {applied ? (
          <span className="text-xs text-muted">
            ✓ Applied
            {suggestion.appliedBy ? ` by ${suggestion.appliedBy}` : ""}
          </span>
        ) : isSuperseded ? (
          <span className="text-xs text-muted">
            A newer suggestion in this thread replaces this one.
          </span>
        ) : !onApply ? (
          <span className="text-xs text-muted">
            Sign in to apply this suggestion.
          </span>
        ) : (
          <>
            <span className="text-xs text-muted">
              Applying creates a new revision with this change.
            </span>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!onApply || applying) return;
                setApplying(true);
                try {
                  await onApply();
                } finally {
                  setApplying(false);
                }
              }}
              disabled={applying}
              className="shrink-0 text-xs px-2.5 py-1 rounded bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {applying ? "Applying…" : "Apply"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
