import { useMemo, useState } from "react";
import Modal from "./Modal";
import type { Comment, MdDocument } from "../types";
import { buildCommentsExport } from "../utils/exportComments";
import { downloadAsMarkdown } from "../utils/download";

interface Props {
  doc: MdDocument;
  comments: Comment[];
  onClose: () => void;
}

// Export the doc's review comments as plain markdown, to paste into or
// hand to an AI editing the file locally. Built entirely from what the
// page already loaded — no extra request.
export default function ExportCommentsModal({ doc, comments, onClose }: Props) {
  const [includeResolved, setIncludeResolved] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = useMemo(
    () => buildCommentsExport(doc, comments, { includeResolved }),
    [doc, comments, includeResolved],
  );
  const resolvedCount = comments.filter((c) => c.resolved).length;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the text stays selectable in the preview */
    }
  }

  return (
    <Modal title="Export comments" onClose={onClose}>
      <label className="flex items-center gap-2 text-sm text-ink mb-3">
        <input
          type="checkbox"
          checked={includeResolved}
          onChange={(e) => setIncludeResolved(e.target.checked)}
        />
        Include resolved comments ({resolvedCount})
      </label>
      <textarea
        readOnly
        value={text}
        aria-label="Exported comments"
        onFocus={(e) => e.currentTarget.select()}
        className="w-full h-72 text-xs font-mono border border-rule rounded p-3 bg-soft text-ink focus:outline-none resize-y"
      />
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={() => downloadAsMarkdown(`${doc.title} - comments`, text)}
          className="text-sm px-3 py-2 rounded border border-rule text-ink hover:bg-soft"
        >
          Download .md
        </button>
        <button
          onClick={copy}
          className="text-sm px-3 py-2 rounded bg-accent text-accent-fg font-medium hover:opacity-90"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </Modal>
  );
}
