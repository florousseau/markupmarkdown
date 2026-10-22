import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TocSidebar from "./TocSidebar";

const items = [
  { id: "user-content-a", text: "Alpha", level: 2 },
  { id: "user-content-b", text: "Beta", level: 3 },
];

describe("TocSidebar", () => {
  it("lists headings, marks the active one and reports clicks", () => {
    const onSelect = vi.fn();
    render(
      <TocSidebar items={items} activeId="user-content-b" open onToggle={() => {}} onSelect={onSelect} />,
    );
    expect(screen.getByText("Beta").getAttribute("aria-current")).toBe("location");
    expect(screen.getByText("Alpha").getAttribute("aria-current")).toBeNull();
    expect(fireEvent.click(screen.getByText("Alpha"))).toBe(false); // default prevented
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("collapses to a toggle-only rail", () => {
    const onToggle = vi.fn();
    render(
      <TocSidebar items={items} activeId={null} open={false} onToggle={onToggle} onSelect={() => {}} />,
    );
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.click(screen.getByTitle("Show table of contents"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("explains itself instead of listing when unavailable", () => {
    render(
      <TocSidebar
        items={items}
        activeId={null}
        open
        onToggle={() => {}}
        onSelect={() => {}}
        unavailableReason="Reading mode only."
      />,
    );
    expect(screen.getByText("Reading mode only.")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
  });
});
