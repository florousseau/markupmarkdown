import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MarkdownRender from "./MarkdownRender";
import {
  applyHighlights,
  getHighlightRect,
  getSelectionAnchor,
} from "../utils/anchor";

// jsdom can't lay out SVG, so mermaid itself is mocked; what's under
// test is the DOM contract around it.
const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));
vi.mock("mermaid", () => ({ default: mermaidMock }));

const DOC = [
  "# Title",
  "",
  "Before the diagram.",
  "",
  "```mermaid",
  "graph TD",
  "  A[Start] --> B[Finish]",
  "```",
  "",
  "After the diagram.",
  "",
].join("\n");

function renderDoc(props: { renderDiagrams?: boolean } = {}) {
  return render(<MarkdownRender content={DOC} {...props} />);
}

function prose(container: HTMLElement): HTMLElement {
  return container.querySelector(".mm-prose") as HTMLElement;
}

async function renderedDiagram(container: HTMLElement) {
  await waitFor(() =>
    expect(
      container.querySelector("[data-mm-mermaid-host]")!.shadowRoot?.querySelector("svg"),
    ).toBeTruthy(),
  );
}

beforeEach(() => {
  mermaidMock.initialize.mockReset();
  mermaidMock.render.mockReset();
  mermaidMock.render.mockResolvedValue({
    svg: '<svg><text>Start</text><text>Finish</text></svg>',
  });
});

describe("Mermaid rendering", () => {
  // THE invariant: comment anchors are textContent offsets, and the
  // backend's PlainText mirrors the plain render. The diagram must not
  // add, drop or move a single character.
  it("leaves the rendered textContent identical to the plain render", async () => {
    const plain = renderDoc({ renderDiagrams: false });
    const expected = prose(plain.container).textContent;
    plain.unmount();

    const { container } = renderDoc();
    await renderedDiagram(container);
    expect(prose(container).textContent).toBe(expected);
    expect(expected).toContain("graph TD");
  });

  it("renders strict-mode SVG and hides the source until asked", async () => {
    const { container } = renderDoc();
    await renderedDiagram(container);
    expect(mermaidMock.render).toHaveBeenCalledWith(
      expect.any(String),
      "graph TD\n  A[Start] --> B[Finish]",
    );
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict", startOnLoad: false }),
    );
    const source = container.querySelector("[data-mm-mermaid-source]") as HTMLElement;
    expect(source.hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Show source" }));
    expect(source.hidden).toBe(false);
    expect(
      (container.querySelector("[data-mm-mermaid-host]") as HTMLElement).hidden,
    ).toBe(true);
  });

  it("keeps the source visible and reports an invalid diagram", async () => {
    mermaidMock.render.mockRejectedValue(new Error("Parse error on line 2"));
    const { container } = renderDoc();
    const host = container.querySelector("[data-mm-mermaid-host]") as HTMLElement;
    await waitFor(() => expect(host.shadowRoot?.querySelector(".err")).toBeTruthy());
    expect(host.shadowRoot!.querySelector(".err")!.textContent).toContain(
      "Parse error on line 2",
    );
    const source = container.querySelector("[data-mm-mermaid-source]") as HTMLElement;
    expect(source.hidden).toBe(false);
    expect(screen.queryByRole("button", { name: "Show source" })).toBeNull();
  });

  it("does not touch non-mermaid code blocks", () => {
    const { container } = render(
      <MarkdownRender content={"```js\nconst a = 1;\n```\n"} />,
    );
    expect(container.querySelector("[data-mm-mermaid]")).toBeNull();
    expect(container.querySelector("pre code.language-js")).toBeTruthy();
    expect(mermaidMock.render).not.toHaveBeenCalled();
  });
});

describe("comments on a Mermaid block", () => {
  it("flips to source when a comment inside it becomes active", async () => {
    const { container } = renderDoc();
    await renderedDiagram(container);
    const el = prose(container);
    const source = container.querySelector("[data-mm-mermaid-source]") as HTMLElement;
    expect(source.hidden).toBe(true);

    const exact = "A[Start]";
    act(() => {
      applyHighlights(el, [
        { id: "c1", start: 0, end: 0, exact, resolved: false, active: false },
      ]);
    });
    // A highlight alone only marks the toolbar…
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Show source (1 comment)" }),
      ).toBeTruthy(),
    );
    expect(source.hidden).toBe(true);

    // …activating it reveals the source.
    act(() => {
      applyHighlights(el, [
        { id: "c1", start: 0, end: 0, exact, resolved: false, active: true },
      ]);
    });
    await waitFor(() => expect(source.hidden).toBe(false));

    // The user switches back; a highlight refresh with the same active
    // comment must not yank them to the source again.
    fireEvent.click(screen.getByRole("button", { name: "Show diagram" }));
    expect(source.hidden).toBe(true);
    act(() => {
      applyHighlights(el, [
        { id: "c1", start: 0, end: 0, exact, resolved: false, active: true },
      ]);
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(source.hidden).toBe(true);
  });

  it("measures a hidden-source highlight against the block", async () => {
    const { container } = renderDoc();
    await renderedDiagram(container);
    const el = prose(container);
    applyHighlights(el, [
      { id: "c1", start: 0, end: 0, exact: "graph TD", resolved: false, active: false },
    ]);
    const block = container.querySelector("[data-mm-mermaid]") as HTMLElement;
    const blockRect = new DOMRect(10, 400, 600, 300);
    block.getBoundingClientRect = () => blockRect;
    expect(getHighlightRect(el, "c1")).toBe(blockRect);
  });

  it("refuses a selection inside the diagram host", async () => {
    const { container } = renderDoc();
    await renderedDiagram(container);
    const el = prose(container);
    const host = container.querySelector("[data-mm-mermaid-host]") as HTMLElement;
    const before = el.querySelector("p") as HTMLElement;
    const range = document.createRange();
    range.setStart(before.firstChild!, 0);
    range.setEnd(host, 0);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(getSelectionAnchor(el)).toBeNull();

    // Across the whole (shown) diagram: the hidden source would land in
    // the offsets but not in the selected text.
    const after = Array.from(el.querySelectorAll("p")).at(-1) as HTMLElement;
    range.setStart(before.firstChild!, 0);
    range.setEnd(after.firstChild!, 5);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(getSelectionAnchor(el)).toBeNull();

    // Sanity: an ordinary selection still anchors.
    range.setStart(before.firstChild!, 0);
    range.setEnd(before.firstChild!, 6);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(getSelectionAnchor(el)).toMatchObject({ exact: "Before" });
  });
});
