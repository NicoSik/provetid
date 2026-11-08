import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE, PROSE } from "../src/screens/layout";

// #121: one content width and one left edge, so the heading does not jump between steps.
// Only the interview grid uses the full width.
const FRAMED = [
  "Stillingsannonse",
  "Karakterkort",
  "Signeringsrett",
  "Proevetid",
  "FoerEtter",
  "Health",
];

function source(name: string): string {
  return readFileSync(resolve(process.cwd(), `src/screens/${name}.tsx`), "utf8");
}

describe("the page frame", () => {
  it("is one width, centred, with the same padding", () => {
    expect(PAGE).toContain("max-w-4xl");
    expect(PAGE).toContain("mx-auto");
    expect(PROSE).toContain("max-w-2xl");
  });

  it.each(FRAMED)("%s uses the shared frame and sets no width of its own", (name) => {
    const code = source(name);
    // The frame is used in a className, not only imported.
    expect(code).toMatch(/className=\{`?\$?\{?PAGE/);
    // No page-sized width of its own, in any class order. Running text may use max-w-prose,
    // and forms use PROSE from layout.ts.
    expect(code).not.toMatch(/max-w-(xl|2xl|3xl|4xl|5xl|6xl|7xl|screen)/);
  });

  it("keeps the interview grid full width", () => {
    expect(source("Intervju")).not.toContain("PAGE");
  });
});
