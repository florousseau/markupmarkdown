import { describe, expect, it } from "vitest";
import { activeTocId, extractToc, fragmentForId } from "./toc";

function dom(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("extractToc", () => {
  it("lists h1–h4 with ids, in order, with normalized text", () => {
    const root = dom(`
      <h1 id="user-content-titre">Titre</h1>
      <h2 id="user-content-a">Section  <em>A</em></h2>
      <h5 id="user-content-deep">Too deep</h5>
      <h3 id="user-content-b">B</h3>
      <h2>No id</h2>
      <h4 id="user-content-empty">  </h4>
    `);
    expect(extractToc(root)).toEqual([
      { id: "user-content-titre", text: "Titre", level: 1 },
      { id: "user-content-a", text: "Section A", level: 2 },
      { id: "user-content-b", text: "B", level: 3 },
    ]);
  });
});

describe("fragmentForId", () => {
  it("drops the sanitizer prefix", () => {
    expect(fragmentForId("user-content-résumé")).toBe("résumé");
    expect(fragmentForId("plain")).toBe("plain");
  });
});

describe("activeTocId", () => {
  it("picks the last heading scrolled past the offset", () => {
    const root = dom(`<h2 id="a">A</h2><h2 id="b">B</h2><h2 id="c">C</h2>`);
    const tops: Record<string, number> = { a: -400, b: 50, c: 600 };
    root.querySelectorAll("h2").forEach((h) => {
      h.getBoundingClientRect = () => ({ top: tops[h.id] }) as DOMRect;
    });
    const items = extractToc(root);
    expect(activeTocId(items, root, 96)).toBe("b");
    tops.b = 200;
    expect(activeTocId(items, root, 96)).toBe("a");
    tops.a = 300;
    expect(activeTocId(items, root, 96)).toBe("a"); // nothing passed yet → first
  });
});
