import { describe, expect, it } from "vitest";
import {
  docLinkBase,
  docLinkHref,
  parseDocLinkHref,
  parseRelativeDocLink,
} from "./docLinks";

describe("parseRelativeDocLink", () => {
  it.each([
    ["AUTRE.md", "AUTRE.md", ""],
    ["AUTRE.md#section", "AUTRE.md", "#section"],
    ["./AUTRE.md#section", "AUTRE.md", "#section"],
    ["../docs/AUTRE.md", "AUTRE.md", ""],
    ["Mon%20Plan.md#intro", "Mon%20Plan.md", "#intro"],
    ["notes.MARKDOWN", "notes.MARKDOWN", ""],
    ["page.mdx?x=1#a", "page.mdx", "#a"],
    ["AUTRE.md#", "AUTRE.md", ""],
  ])("accepts %s", (href, name, hash) => {
    expect(parseRelativeDocLink(href)).toEqual({ name, hash });
  });

  it.each([
    "",
    "#section",
    "https://example.com/AUTRE.md",
    "//example.com/AUTRE.md",
    "mailto:a@b.c",
    "image.png",
    "AUTRE",
    "docs/",
  ])("rejects %s", (href) => {
    expect(parseRelativeDocLink(href)).toBeNull();
  });
});

describe("docLinkHref / parseDocLinkHref", () => {
  const base = docLinkBase("doc1");

  it("round-trips name and hash", () => {
    const link = { name: "Mon%20Plan.md", hash: "#intro" };
    const href = docLinkHref(base, link);
    expect(href).toBe("/d/doc1/link/Mon%20Plan.md#intro");
    expect(parseDocLinkHref(base, href)).toEqual(link);
  });

  it("ignores hrefs outside the base", () => {
    expect(parseDocLinkHref(base, "/d/doc2/link/A.md")).toBeNull();
    expect(parseDocLinkHref(base, "https://example.com")).toBeNull();
    expect(parseDocLinkHref(base, base)).toBeNull();
  });
});
