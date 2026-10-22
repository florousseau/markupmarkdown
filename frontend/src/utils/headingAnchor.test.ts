import { describe, expect, it } from "vitest";
import {
  decodeFragment,
  findAnchorTarget,
  setUrlFragment,
  USER_CONTENT_PREFIX,
} from "./headingAnchor";

function dom(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

describe("decodeFragment", () => {
  it("strips the hash and percent-decodes", () => {
    expect(decodeFragment("#r%C3%A9sum%C3%A9-ex%C3%A9cutif")).toBe("résumé-exécutif");
    expect(decodeFragment("résumé")).toBe("résumé");
  });
  it("keeps malformed escapes instead of throwing", () => {
    expect(decodeFragment("#100%-sûr")).toBe("100%-sûr");
  });
  it("returns empty for a bare hash", () => {
    expect(decodeFragment("#")).toBe("");
  });
});

describe("findAnchorTarget", () => {
  const root = () =>
    dom(`
      <h2 id="${USER_CONTENT_PREFIX}résumé-exécutif">Résumé exécutif</h2>
      <h2 id="${USER_CONTENT_PREFIX}intro">Intro</h2>
      <h2 id="${USER_CONTENT_PREFIX}intro-1">Intro</h2>
      <h2 id="${USER_CONTENT_PREFIX}1-chiffres">1. Chiffres</h2>
      <h2 id="${USER_CONTENT_PREFIX}quote&quot;id">Weird</h2>
      <a name="${USER_CONTENT_PREFIX}ancien"></a>
      <li id="${USER_CONTENT_PREFIX}fn-1">note</li>
    `);

  it("maps a bare fragment onto the user-content- prefixed id", () => {
    expect(findAnchorTarget(root(), "#r%C3%A9sum%C3%A9-ex%C3%A9cutif")?.textContent).toBe(
      "Résumé exécutif",
    );
  });
  it("targets the right duplicate", () => {
    const r = root();
    expect(findAnchorTarget(r, "#intro")?.id).toBe("user-content-intro");
    expect(findAnchorTarget(r, "#intro-1")?.id).toBe("user-content-intro-1");
  });
  it("handles ids starting with a digit and quotes", () => {
    const r = root();
    expect(findAnchorTarget(r, "#1-chiffres")).not.toBeNull();
    expect(findAnchorTarget(r, '#quote"id')).not.toBeNull();
  });
  it("accepts links that already carry the prefix (gfm footnotes)", () => {
    expect(findAnchorTarget(root(), "#user-content-fn-1")?.textContent).toBe("note");
  });
  it("falls back to lowercase for hand-written TOCs", () => {
    expect(findAnchorTarget(root(), "#Résumé-Exécutif")).not.toBeNull();
  });
  it("matches <a name>", () => {
    expect(findAnchorTarget(root(), "#ancien")?.tagName).toBe("A");
  });
  it("returns null for missing or empty fragments", () => {
    const r = root();
    expect(findAnchorTarget(r, "#nope")).toBeNull();
    expect(findAnchorTarget(r, "#")).toBeNull();
  });
  it("never escapes the root", () => {
    const r = root();
    const outside = document.createElement("h2");
    outside.id = "user-content-dehors";
    document.body.appendChild(outside);
    expect(findAnchorTarget(r, "#dehors")).toBeNull();
  });
});

describe("setUrlFragment", () => {
  it("keeps path, query and router state", () => {
    window.history.replaceState({ usr: null, key: "k", idx: 3 }, "", "/d/abc?c=1");
    setUrlFragment("résumé-exécutif");
    expect(window.location.pathname).toBe("/d/abc");
    expect(window.location.search).toBe("?c=1");
    expect(decodeURIComponent(window.location.hash)).toBe("#résumé-exécutif");
    expect(window.history.state).toEqual({ usr: null, key: "k", idx: 3 });
  });
});
