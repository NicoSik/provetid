import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUTTON } from "../src/components/buttons";

// #138: action buttons come from one small set, so they share one height and one look.
const FILES = [
  "src/App.tsx",
  ...["screens", "components"].flatMap((dir) =>
    readdirSync(resolve(process.cwd(), "src", dir))
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `src/${dir}/${name}`),
  ),
];

/** The className of every <button> in a file, static or template. */
function buttonClasses(code: string): string[] {
  return [...code.matchAll(/<button\b[\s\S]*?className=(\{[^}]*\}|"[^"]*")/g)].map((m) => m[1]);
}

describe("buttons", () => {
  it.each(Object.entries(BUTTON))("%s has the shared size and no other padding", (_, cls) => {
    expect(cls.match(/\bp[xytrbl]?-\S+/g)).toEqual(["px-4", "py-2"]);
    expect(cls).not.toMatch(/\btext-(xs|sm|base|lg|xl)\b/);
  });

  it.each(FILES)("%s fills no button outside the shared set", (file) => {
    const code = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const cls of buttonClasses(code)) {
      // A solid blue, red or orange button must come from BUTTON (tints like bg-brudd/10 are fine).
      expect(cls).not.toMatch(/bg-(pagar|brudd|stoppet)(?![/\w-])/);
    }
  });
});
