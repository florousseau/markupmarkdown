import { describe, expect, it } from "vitest";
import { parseRelativeDocLink } from "./docLinks";

describe("parseRelativeDocLink", () => {
  it.each([
    ["AUTRE.md", ""],
    ["AUTRE.md#section", "#section"],
    ["./AUTRE.md#section", "#section"],
    ["../docs/AUTRE.md", ""],
    ["Mon%20Plan.md#intro", "#intro"],
    ["notes.MARKDOWN", ""],
    ["page.mdx?x=1#a", "#a"],
    ["AUTRE.md#", ""],
  ])("accepts %s", (href, hash) => {
    expect(parseRelativeDocLink(href)).toEqual({ href, hash });
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
