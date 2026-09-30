import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MarkdownRender from "./MarkdownRender";

// End-to-end through the real pipeline (react-markdown + gfm + slug +
// raw + sanitize) — the ids asserted here are what the browser gets.
const MD = `
- [Résumé](#résumé-exécutif)
- [Intro 2](#intro-1)
- [Externe](https://example.com/page#x)
- [Absent](#nexiste-pas)
- [Vide](#)

## Résumé exécutif
## Intro
## Intro
## 🚀 Q&A : v2.0, c'est « prêt » ?
## 3 Étapes CLÉS
## Coût / bénéfice (€)
`;

let scrolled: Element[] = [];
beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
  window.history.replaceState(null, "", "/d/doc1");
});
afterEach(() => vi.restoreAllMocks());

describe("MarkdownRender heading ids", () => {
  it("emits GitHub-compatible slugs behind the user-content- prefix", () => {
    const { container } = render(<MarkdownRender content={MD} />);
    const ids = [...container.querySelectorAll("h2")].map((h) => h.id);
    expect(ids).toEqual([
      "user-content-résumé-exécutif",
      "user-content-intro",
      "user-content-intro-1",
      "user-content--qa--v20-cest--prêt--",
      "user-content-3-étapes-clés",
      "user-content-coût--bénéfice-",
    ]);
  });
});

describe("MarkdownRender anchor clicks", () => {
  const click = (c: HTMLElement, text: string) => {
    const a = [...c.querySelectorAll("a")].find((x) => x.textContent === text)!;
    return fireEvent.click(a); // false => default prevented
  };

  it("scrolls to an accented heading and updates the hash", () => {
    const { container } = render(<MarkdownRender content={MD} />);
    expect(click(container, "Résumé")).toBe(false);
    expect(scrolled.map((e) => e.id)).toEqual(["user-content-résumé-exécutif"]);
    expect(decodeURIComponent(window.location.hash)).toBe("#résumé-exécutif");
    expect(window.location.pathname).toBe("/d/doc1");
  });

  it("targets the second of two identical headings", () => {
    const { container } = render(<MarkdownRender content={MD} />);
    click(container, "Intro 2");
    expect(scrolled.map((e) => e.id)).toEqual(["user-content-intro-1"]);
  });

  it("leaves external, missing and empty links alone", () => {
    const { container } = render(<MarkdownRender content={MD} />);
    expect(click(container, "Externe")).toBe(true);
    expect(click(container, "Absent")).toBe(true);
    expect(click(container, "Vide")).toBe(true);
    expect(scrolled).toEqual([]);
  });
});

describe("MarkdownRender URL hash", () => {
  it("scrolls to the hash on first render", () => {
    window.history.replaceState(null, "", "/d/doc1#r%C3%A9sum%C3%A9-ex%C3%A9cutif");
    render(<MarkdownRender content={MD} />);
    expect(scrolled.map((e) => e.id)).toEqual(["user-content-résumé-exécutif"]);
  });

  it("does not re-scroll when the content is replaced by a new revision", () => {
    window.history.replaceState(null, "", "/d/doc1#intro");
    const { rerender } = render(<MarkdownRender content={MD} />);
    rerender(<MarkdownRender content={MD + "\nNouveau paragraphe.\n"} />);
    expect(scrolled).toHaveLength(1);
  });

  it("follows manual hash changes and ignores unknown ones", () => {
    render(<MarkdownRender content={MD} />);
    act(() => {
      window.history.replaceState(null, "", "/d/doc1#intro-1");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.history.replaceState(null, "", "/d/doc1#inconnu");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(scrolled.map((e) => e.id)).toEqual(["user-content-intro-1"]);
  });

  it("forwards the ref (Document.tsx relies on it for highlights)", () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<MarkdownRender ref={ref} content={MD} />);
    expect(ref.current?.className).toBe("mm-prose");
  });
});

describe("MarkdownRender relative doc links", () => {
  const LINKS = "[Autre](AUTRE.md#section) · [Web](https://example.com/X.md) · [Ici](#intro)\n\n## Intro\n";

  it("hands relative .md links to onRelativeDocLink instead of following them", () => {
    const onLink = vi.fn();
    const { getByText } = render(<MarkdownRender content={LINKS} onRelativeDocLink={onLink} />);
    expect(fireEvent.click(getByText("Autre"))).toBe(false);
    expect(onLink).toHaveBeenCalledWith({ href: "AUTRE.md#section", hash: "#section" });
  });

  it("leaves absolute and in-page links alone", () => {
    const onLink = vi.fn();
    const { getByText } = render(<MarkdownRender content={LINKS} onRelativeDocLink={onLink} />);
    fireEvent.click(getByText("Web"));
    fireEvent.click(getByText("Ici"));
    expect(onLink).not.toHaveBeenCalled();
  });

  it("doesn't intercept when no handler is given (docs with a source URL)", () => {
    const { getByText } = render(<MarkdownRender content={LINKS} />);
    expect(fireEvent.click(getByText("Autre"))).toBe(true);
  });
});
