import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SuggestionBlock from "./SuggestionBlock";

describe("SuggestionBlock", () => {
  it("offers Apply on the active suggestion", () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <SuggestionBlock anchorExact="The cat" suggestion={{ replacement: "A dog" }} onApply={onApply} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("dims a superseded suggestion and hides Apply", () => {
    const { container } = render(
      <SuggestionBlock anchorExact="The cat" suggestion={{ replacement: "A dog" }} superseded onApply={vi.fn()} />
    );
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.getByText("Superseded suggestion")).toBeTruthy();
    expect(container.querySelector('[data-suggestion-state="superseded"]')).not.toBeNull();
  });

  it("marks an applied suggestion as such", () => {
    render(
      <SuggestionBlock
        anchorExact="The cat"
        suggestion={{ replacement: "A dog", appliedAt: "2026-01-01T00:00:00Z", appliedBy: "Flo" }}
        superseded
      />
    );
    expect(screen.getByText(/Applied by Flo/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });

  it("tells signed-out viewers to sign in instead of showing Apply", () => {
    render(<SuggestionBlock anchorExact="The cat" suggestion={{ replacement: "A dog" }} />);
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.getByText(/Sign in to apply/)).toBeTruthy();
  });

  it("renders nothing without a suggestion or an anchor", () => {
    const { container } = render(<SuggestionBlock anchorExact="" suggestion={{ replacement: "x" }} />);
    expect(container.innerHTML).toBe("");
  });
});
