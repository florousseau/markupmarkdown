import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, APIError } from "../api";
import DocLinkResolve from "./DocLinkResolve";

function Landed() {
  const loc = useLocation();
  return <div>landed {loc.pathname + loc.hash}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/d/:id/link/*" element={<DocLinkResolve />} />
        <Route path="/d/:id" element={<Landed />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("DocLinkResolve", () => {
  it("replaces itself with the resolved doc, keeping the section", async () => {
    const spy = vi.spyOn(api, "resolveDocLink").mockResolvedValue({ id: "doc2", title: "AUTRE" });
    renderAt("/d/doc1/link/Mon%20Plan.md#intro");
    await screen.findByText("landed /d/doc2#intro");
    expect(spy).toHaveBeenCalledWith("doc1", "Mon%20Plan.md");
  });

  it("shows the error with a way back when the file isn't found", async () => {
    vi.spyOn(api, "resolveDocLink").mockRejectedValue(
      new APIError("AUTRE.md hasn't been uploaded by this document's author.", { kind: "not_found" }),
    );
    renderAt("/d/doc1/link/AUTRE.md");
    await waitFor(() => expect(screen.getByText(/hasn't been uploaded/)).toBeTruthy());
    expect(screen.getByText("← Back to the document").getAttribute("href")).toBe("/d/doc1");
  });
});
