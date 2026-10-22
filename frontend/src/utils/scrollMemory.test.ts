import { beforeEach, describe, expect, it } from "vitest";
import { loadScroll, saveScroll } from "./scrollMemory";

beforeEach(() => window.sessionStorage.clear());

describe("scrollMemory", () => {
  it("round-trips a position per history entry", () => {
    saveScroll("a", 1234.6);
    saveScroll("b", 10);
    expect(loadScroll("a")).toBe(1235);
    expect(loadScroll("b")).toBe(10);
    expect(loadScroll("missing")).toBeNull();
  });

  it("keeps only the most recent 100 entries", () => {
    for (let i = 0; i < 105; i++) saveScroll(`k${i}`, i);
    saveScroll("k0", 999); // re-saving refreshes an entry's recency
    expect(loadScroll("k0")).toBe(999);
    expect(loadScroll("k1")).toBeNull();
    expect(loadScroll("k104")).toBe(104);
  });
});
