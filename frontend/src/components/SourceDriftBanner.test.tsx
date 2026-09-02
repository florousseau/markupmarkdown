import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SourceDriftBanner from "./SourceDriftBanner";

// The drift banner is the only place the two reconciliation paths are
// offered. Replace is destructive and easy to lose in a refactor, so
// its presence + gating is pinned here.
function renderBanner(over: Partial<Parameters<typeof SourceDriftBanner>[0]> = {}) {
  const props = {
    githubURL: "https://github.com/o/r/blob/main/README.md",
    canSync: true,
    onMerge: vi.fn(),
    onReplace: vi.fn(),
    onIgnore: vi.fn(),
    isRevision: false,
    ...over,
  };
  render(<SourceDriftBanner {...props} />);
  return props;
}

describe("SourceDriftBanner", () => {
  it("offers replace alongside merge", () => {
    renderBanner();
    expect(screen.getByRole("button", { name: /merge changes from github/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /replace with latest/i })).toBeTruthy();
  });

  it("fires onReplace — the caller owns the confirmation", () => {
    const props = renderBanner();
    fireEvent.click(screen.getByRole("button", { name: /replace with latest/i }));
    expect(props.onReplace).toHaveBeenCalledTimes(1);
    expect(props.onMerge).not.toHaveBeenCalled();
  });

  it("hides both mutating actions when the viewer can't sync", () => {
    renderBanner({ canSync: false });
    expect(screen.queryByRole("button", { name: /replace with latest/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /merge changes from github/i })).toBeNull();
    // The read-only affordance stays.
    expect(screen.getByRole("link", { name: /view latest on github/i })).toBeTruthy();
  });

  it("disables every action while a replace is in flight", () => {
    renderBanner({ replacing: true });
    const replace = screen.getByRole("button", { name: /replacing/i }) as HTMLButtonElement;
    const merge = screen.getByRole("button", { name: /merge changes from github/i }) as HTMLButtonElement;
    const ignore = screen.getByRole("button", { name: /^ignore$/i }) as HTMLButtonElement;
    expect(replace.disabled).toBe(true);
    expect(merge.disabled).toBe(true);
    expect(ignore.disabled).toBe(true);
  });
});
