import { fireEvent, render } from "@testing-library/react";
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
