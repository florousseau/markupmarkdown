import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BackToTop from "./BackToTop";

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
}

afterEach(() => {
  scrollTo(0);
  vi.restoreAllMocks();
});

describe("BackToTop", () => {
  it("appears past the threshold and scrolls the window to the top", async () => {
    // Run frames synchronously; returning 0 marks "no frame pending",
    // matching the component's state once a real frame has fired.
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const spy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<BackToTop threshold={600} />);
    expect(screen.queryByLabelText("Back to top")).toBeNull();

    scrollTo(900);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    fireEvent.click(screen.getByLabelText("Back to top"));
    expect(spy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });

    scrollTo(100);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByLabelText("Back to top")).toBeNull();
  });
});
