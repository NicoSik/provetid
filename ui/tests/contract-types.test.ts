// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type EventType, isRunEvent } from "../src/events/types";

const EVENT_TYPES: EventType[] = [
  "run_started",
  "chat_started",
  "message",
  "tool_call",
  "leak",
  "chat_ended",
  "verdict",
  "run_finished",
  "error",
];

const lines = readFileSync(new URL("../../fixtures/demo_run.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "");

describe("event contract", () => {
  it("accepts every fixture line", () => {
    for (const line of lines) {
      expect(isRunEvent(JSON.parse(line))).toBe(true);
    }
  });

  it("uses exactly the 9 event types", () => {
    const types = new Set(lines.map((line) => JSON.parse(line).type as string));
    expect(types).toEqual(new Set(EVENT_TYPES));
  });

  it("rejects an unknown type and non-objects", () => {
    const base = { run_id: "r", seq: 0, t: 0, chat_id: null, data: {} };
    expect(isRunEvent({ ...base, type: "nope" })).toBe(false);
    expect(isRunEvent(null)).toBe(false);
    expect(isRunEvent("message")).toBe(false);
  });
});
