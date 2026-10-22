import { describe, expect, it } from "vitest";
import {
  applyHighlights,
  getSelectionAnchor,
  lettersAndDigits,
  occurrenceOffsets,
  pickOccurrenceByContext,
  squashSpace,
} from "./anchor";

const TEXT = "The cat sat on the mat. The cat ran away.";

describe("occurrenceOffsets", () => {
  it("lists non-overlapping hits", () => {
    expect(occurrenceOffsets(TEXT, "The cat")).toEqual([0, 24]);
    expect(occurrenceOffsets("aaaa", "aa")).toEqual([0, 2]);
    expect(occurrenceOffsets(TEXT, "")).toEqual([]);
  });
});

describe("pickOccurrenceByContext", () => {
  const offs = occurrenceOffsets(TEXT, "The cat");
  it("picks by prefix or suffix", () => {
    expect(pickOccurrenceByContext(TEXT, offs, 7, "on the mat. ", "", squashSpace)).toBe(24);
    expect(pickOccurrenceByContext(TEXT, offs, 7, "", " sat on", squashSpace)).toBe(0);
  });
  it("returns -1 without context, or when several match", () => {
    expect(pickOccurrenceByContext(TEXT, offs, 7, "", "", squashSpace)).toBe(-1);
    expect(pickOccurrenceByContext("x The cat y. x The cat y.", [2, 15], 7, "x ", " y", squashSpace)).toBe(-1);
  });
  it("matches rendered context against markdown source", () => {
    const src = "The **cat** sat on the [mat](u). The cat ran away.";
    const hits = occurrenceOffsets(src, "The cat");
    expect(hits).toEqual([33]);
    const src2 = "The cat sat on **the mat**. The cat ran away.";
    const hits2 = occurrenceOffsets(src2, "The cat");
    expect(pickOccurrenceByContext(src2, hits2, 7, "sat on the mat. ", "", lettersAndDigits)).toBe(28);
  });
});

describe("selection context + highlights", () => {
  it("captures prefix/suffix and highlights the right occurrence", () => {
    const el = document.createElement("div");
    el.innerHTML = `<p>${TEXT}</p>`;
    document.body.appendChild(el);
    const text = el.querySelector("p")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 24);
    range.setEnd(text, 31);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const anchor = getSelectionAnchor(el)!;
    expect(anchor.exact).toBe("The cat");
    expect(anchor.prefix).toBe("The cat sat on the mat. ");
    expect(anchor.suffix).toBe(" ran away.");

    // Carried / agent anchors have start=end=0: context decides.
    applyHighlights(el, [
      { id: "c1", start: 0, end: 0, exact: "The cat", prefix: anchor.prefix, suffix: anchor.suffix, resolved: false, active: false },
    ]);
    const span = el.querySelector("span.mm-highlight")!;
    expect(span.textContent).toBe("The cat");
    expect(span.previousSibling?.textContent).toBe("The cat sat on the mat. ");
    el.remove();
  });
});
