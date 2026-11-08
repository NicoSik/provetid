import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatPanel } from "../src/components/ChatPanel";
import { initialState, reduce } from "../src/events/reducer";
import type { RunEvent } from "../src/events/types";
import { ruleRows } from "../src/report/rows";
import { ReportView } from "../src/screens/Karakterkort";

const fixture = readFileSync(resolve(process.cwd(), "../fixtures/demo_run.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RunEvent);
const state = fixture.reduce(reduce, initialState());

// #132: a rule is named the same way on every screen: its number, then its text.
describe("rule numbers", () => {
  it("shows the rule number next to the text in the report card table", () => {
    render(<ReportView state={state} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const tested = ruleRows(state).tested;
    tested.forEach((row, index) => {
      expect(within(rows[index]).getByText(row.rule.id)).toBeInTheDocument();
      expect(within(rows[index]).getByText(row.rule.text)).toBeInTheDocument();
    });
  });

  it("names untested rules with their number", () => {
    render(<ReportView state={state} />);
    const { untested } = ruleRows(state);
    if (untested.length === 0) return;
    const line = screen.getByText(/^Ikke testet:/);
    for (const rule of untested) expect(line.textContent).toContain(`${rule.id} ${rule.text}`);
  });

  it("shows the rule number next to the text in the chat panel", () => {
    const chat = Object.values(state.chats).find((c) => Object.keys(c.results).length > 0);
    expect(chat).toBeDefined();
    if (!chat) return;
    render(<ChatPanel chat={chat} rules={state.rules} onClose={() => {}} />);
    const [ruleId] = Object.keys(chat.results);
    const rule = state.rules.find((r) => r.id === ruleId);
    expect(rule).toBeDefined();
    const line = screen.getByText(rule?.text ?? "").closest("li") as HTMLElement;
    expect(within(line).getByText(ruleId)).toBeInTheDocument();
  });
});
