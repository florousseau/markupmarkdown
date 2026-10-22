import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, APIError } from "../api";
import ErrorBlock from "../components/ErrorBlock";
import { docLinkBase, parseDocLinkHref } from "../utils/docLinks";

// DocLinkResolve serves /d/:id/link/<file>.md — the href MarkdownRender
// gives relative `.md` links inside an uploaded doc (see utils/docLinks).
// Plain clicks never land here (Document.tsx resolves them in place);
// this page catches new-tab clicks, copied links and reloads. It asks
// the backend which of the creator's uploads <file> names and replaces
// itself with that doc, carrying the #section along.
export default function DocLinkResolve() {
  const { id = "" } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<APIError | null>(null);

  useEffect(() => {
    let cancelled = false;
    // pathname keeps the name URL-encoded, exactly as written in the doc.
    const link = parseDocLinkHref(docLinkBase(id), location.pathname + location.hash);
    if (!link) {
      setError(new APIError("Bad document link", { kind: "bad_request" }));
      return;
    }
    api
      .resolveDocLink(id, link.name)
      .then((target) => {
        if (!cancelled) navigate(`/d/${target.id}${link.hash}`, { replace: true });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof APIError ? err : new APIError((err as Error).message));
      });
    return () => {
      cancelled = true;
    };
  }, [id, location.pathname, location.hash, navigate]);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <ErrorBlock error={error} />
        <div className="mt-4 text-sm">
          <Link to={`/d/${id}`} className="text-accent hover:underline">
            ← Back to the document
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="rounded-lg border border-rule bg-card p-4 flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin shrink-0"
        />
        <span className="text-sm text-ink">Opening linked document…</span>
      </div>
    </div>
  );
}
