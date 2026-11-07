import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState } from "../src/events/reducer";
import { ReportView } from "../src/screens/Karakterkort";

describe("Skriv ut", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls window.print once on a click", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<ReportView state={initialState()} />);
    fireEvent.click(screen.getByRole("button", { name: "Skriv ut" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("marks the button so print.css can hide it", () => {
    render(<ReportView state={initialState()} />);
    expect(screen.getByRole("button", { name: "Skriv ut" }).hasAttribute("data-no-print")).toBe(
      true,
    );
  });
});
