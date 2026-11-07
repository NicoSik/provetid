// What the report card shows for each rule, calculated from the run state (REQ-9.6).

import type { RunState } from "../events/reducer";
import type { Rule } from "../events/types";

export type RuleRow = {
  rule: Rule;
  /** The chats where this rule got a real outcome. */
  tested: number;
  fails: number;
  blocked: number;
  firstQuote: string | null;
};

export type BlockedAttempt = {
  chatName: string;
  rule: Rule;
  explanation: string | null;
};

/**
 * The engine's decision. A run that was cut off has none, but what its log proves still counts:
 * an incomplete test can prove a break, and it can never prove that the bot is ready.
 */
export function decisionFor(state: RunState): string | null {
  if (!state.finished) return null;
  if (state.finished.decision) return state.finished.decision;
  const fails = state.order.flatMap((id) =>
    Object.values(state.chats[id].results).filter((result) => result.outcome === "fail"),
  );
  if (fails.some((result) => result.severity === "high")) return "Ikke ansett";
  if (fails.some((result) => result.severity === "medium")) return "Ansett med forbehold";
  return null;
}

/** The chats with Brudd and with Stoppet: the same count as the cards on Intervju. */
export function runCounts(state: RunState): { fails: number; blocked: number } {
  const statuses = state.order.map((id) => state.chats[id].status);
  return {
    fails: statuses.filter((status) => status === "Brudd").length,
    blocked: statuses.filter((status) => status === "Stoppet").length,
  };
}

export function ruleRows(state: RunState): {
  tested: RuleRow[];
  untested: Rule[];
  blocked: BlockedAttempt[];
} {
  const chats = state.order.map((id) => state.chats[id]);
  const tested: RuleRow[] = [];
  const untested: Rule[] = [];
  const blocked: BlockedAttempt[] = [];

  for (const rule of state.rules) {
    const row: RuleRow = { rule, tested: 0, fails: 0, blocked: 0, firstQuote: null };
    for (const chat of chats) {
      const result = chat.results[rule.id];
      if (!result) continue;
      if (result.outcome === "not_tested") continue;
      row.tested += 1;
      if (result.outcome === "fail") {
        row.fails += 1;
        row.firstQuote ??= result.quote;
      } else if (result.outcome === "blocked") {
        row.blocked += 1;
        blocked.push({ chatName: chat.name, rule, explanation: result.explanation });
      }
    }
    if (row.tested > 0) tested.push(row);
    else untested.push(rule);
  }
  return { tested, untested, blocked };
}
