interface Props {
  /** Owner / repo / file path on GitHub, for the "View on GitHub" link. */
  githubURL: string;
  /** When drift was first observed. */
  driftedAt?: string;
  /** Whether the viewer is allowed to merge (admin scope / cookie session). */
  canSync: boolean;
  /** Opens the merge modal. For non-revisions it's a trivial replace;
   * for revisions it runs the 3-way Claude merge with a preview. */
  onMerge: () => void;
  /** Discards the local copy and replaces it wholesale with the
   * upstream file — no Claude call, no token cost. Comments are
   * re-anchored the same way the merge path does it. Confirmation
   * lives in the caller (a styled dialog), because the local content
   * is lost. Same canSync gating as onMerge. */
  onReplace: () => void;
  /** True while the replace request is in flight, so the button can
   * show progress and both actions can be disabled. */
  replacing?: boolean;
  /** Opens the Ignore-this-drift confirmation modal. Dismissed drifts
   * stay suppressed until a *newer* upstream SHA appears. Same gating
   * as onMerge — surfaced only when canSync is true. */
  onIgnore: () => void;
  /** True when this doc is an AI revision (has revision_meta). The
   * banner copy adapts to explain the merge will reconcile both
   * branches' edits. */
  isRevision: boolean;
}

// Banner shown at the top of the doc page when the source file on GitHub
// has a different SHA than the cloned copy. Clicking Sync pulls the
// latest content and re-anchors comments where it can; orphans surface
// in the section below the doc body.
export default function SourceDriftBanner({
  githubURL,
  driftedAt,
  canSync,
  onMerge,
  onReplace,
  replacing = false,
  onIgnore,
  isRevision,
}: Props) {
  const when = driftedAt
    ? new Date(driftedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <div
      className="mb-6 rounded-lg border p-3 flex items-start gap-3"
      style={{
        backgroundColor: "var(--color-warn-bg)",
        borderColor: "var(--color-warn-border)",
        color: "var(--color-warn-ink)",
      }}
    >
      <div className="shrink-0 mt-0.5" style={{ color: "var(--color-warn-muted)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 text-sm">
        <div className="font-medium">
          Source updated on GitHub{when ? ` · noticed ${when}` : ""}
        </div>
        <div className="mt-0.5" style={{ color: "var(--color-warn-muted)" }}>
          {isRevision ? (
            <>
              This document is an AI revision; the original source on GitHub
              has new commits since it was generated. The merge runs a
              Claude-powered 3-way reconciliation so both the upstream edits
              and your AI revision land in the result. You'll get a diff
              preview before anything is saved. If you'd rather drop the
              revision and take the upstream file as-is, use{" "}
              <em>Replace with latest</em>.
            </>
          ) : (
            <>
              The underlying file has new commits since this doc was cloned.
              Merge to pull in the latest version — comments are re-anchored
              automatically where the original quoted text still appears; the
              rest surface as orphans below the doc with a manual re-anchor
              flow. <em>Replace with latest</em> does the same thing without
              the Claude call — the upstream file is taken verbatim.
            </>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {canSync && (
            <button
              onClick={onMerge}
              disabled={replacing}
              className="text-xs px-3 py-1 rounded font-medium transition-colors disabled:opacity-60"
              style={{
                backgroundColor: "var(--color-warn-action)",
                color: "var(--color-warn-action-fg)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "var(--color-warn-action-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "var(--color-warn-action)")
              }
            >
              Merge changes from GitHub
            </button>
          )}
          {/* Straight overwrite: take the upstream file verbatim. The
              escape hatch for people who don't want (or can't pay for)
              a Claude merge and are happy to lose the local copy. */}
          {canSync && (
            <button
              onClick={onReplace}
              disabled={replacing}
              className="text-xs px-3 py-1 rounded font-medium border transition-colors disabled:opacity-60"
              style={{
                borderColor: "var(--color-warn-border)",
                color: "var(--color-warn-ink)",
                backgroundColor: "transparent",
              }}
              title="Overwrite this doc with the current file on GitHub"
            >
              {replacing ? "Replacing…" : "Replace with latest"}
            </button>
          )}
          <a
            href={githubURL}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline hover:no-underline"
          >
            View latest on GitHub
          </a>
          {canSync && (
            <button
              onClick={onIgnore}
              disabled={replacing}
              className="text-xs ml-2 underline hover:no-underline disabled:opacity-60"
              style={{ color: "var(--color-warn-muted)" }}
              title="Hide this banner until a newer upstream commit shows up"
            >
              Ignore
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
