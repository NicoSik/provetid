import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepNav } from "../src/components/StepNav";
import { findScreen, pathFromHash, type RegisteredScreen, screens } from "../src/screens/registry";

const intervju: RegisteredScreen = {
  meta: { path: "/intervju", step: 2, title: "Intervju" },
  Component: () => null,
};

describe("StepNav", () => {
  it("shows the five steps in order", () => {
    render(<StepNav screens={[intervju]} currentPath="/intervju" />);
    const names = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(names).toEqual([
      "Stillingsannonse",
      "Intervju",
      "Karakterkort",
      "Signeringsrett",
      "Prøvetid",
    ]);
  });

  it("links only the steps that have a registered screen", () => {
    render(<StepNav screens={[intervju]} currentPath="/intervju" />);
    const nav = within(screen.getByRole("navigation", { name: "Steg" }));
    expect(nav.getAllByRole("link")).toHaveLength(1);
    const link = nav.getByRole("link", { name: "Intervju" });
    expect(link).toHaveAttribute("href", "#/intervju");
    expect(link).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Karakterkort")).toHaveAttribute("aria-disabled", "true");
  });
});

describe("the screen registry", () => {
  it("finds the Intervju screen through the file discovery", () => {
    expect(screens.map((s) => s.meta.path)).toContain("/intervju");
  });

  it("reads the path from the hash", () => {
    expect(pathFromHash("#/intervju")).toBe("/intervju");
    expect(pathFromHash("")).toBe("/");
    expect(pathFromHash("#/")).toBe("/");
  });

  it("opens the first step at the root path, and nothing for an unknown path", () => {
    const first: RegisteredScreen = {
      ...intervju,
      meta: { ...intervju.meta, step: 1, path: "/a" },
    };
    expect(findScreen("/", [intervju, first])).toBe(first);
    expect(findScreen("/intervju", [intervju, first])).toBe(intervju);
    expect(findScreen("/finnes-ikke", [intervju, first])).toBeUndefined();
  });
});
