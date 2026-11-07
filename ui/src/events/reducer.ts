// Turns the event stream into the state of one run. Live runs and replays feed this same
// reducer (D2). It is pure, so a screen can rebuild a run from its events at any time.

import type {
  ChatEndedData,
  CustomerKind,
  ErrorData,
  LeakData,
  MessageData,
  Mode,
  Rule,
  RuleResult,
  RunEvent,
  RunFinishedData,
  ToolCallData,
  VerdictData,
} from "./types";

export type ChatStatus = "Pågår" | "Bestått" | "Brudd" | "Stoppet" | "Ikke testet";

/** One line in the chat panel. The order is the order the events arrived in. */
export type TimelineItem =
  | { kind: "message"; seq: number; message: MessageData }
  | { kind: "tool_call"; seq: number; call: ToolCallData }
  | { kind: "leak"; seq: number; leak: LeakData };

export type ChatView = {
  id: string;
  name: string;
  label: string;
  kind: CustomerKind;
  /** Sorted by message index. */
  messages: MessageData[];
  toolCalls: ToolCallData[];
  leaks: LeakData[];
  timeline: TimelineItem[];
  /** One result per rule, merged from the code checks and the judge (D9). */
  results: Record<string, RuleResult>;
  /** Which source gave each result. Code checks have the final word (D10). */
  resultSources: Record<string, VerdictData["source"]>;
  /** The judge follows the code checks (D9). Until then, a pass is not final. */
  judged: boolean;
  /** The code checks have sent a verdict, also if it holds no results. */
  codeChecked: boolean;
  summary: string | null;
  ended: boolean;
  endReason: ChatEndedData["reason"] | null;
  /** An error in this chat. An error for the whole run is on `RunState.error`. */
  error: ErrorData | null;
  status: ChatStatus;
};

export type RunState = {
  runId: string | null;
  mode: Mode | null;
  chatCount: number | null;
  rules: Rule[];
  chats: Record<string, ChatView>;
  /** Chat IDs in the order the chats started. */
  order: string[];
  finished: RunFinishedData | null;
  error: ErrorData | null;
  /** The highest `seq` seen. A resumed stream can send an event twice. */
  lastSeq: number | null;
};

export function initialState(): RunState {
  return {
    runId: null,
    mode: null,
    chatCount: null,
    rules: [],
    chats: {},
    order: [],
    finished: null,
    error: null,
    lastSeq: null,
  };
}

/** A chat that ended like this never counts as a pass (REQ-4.9). */
const BROKEN_ENDS: ReadonlyArray<ChatView["endReason"]> = ["refused", "error", "timeout"];

/** These stop the whole run (REQ-11.4), so they belong on the run even if a chat raised them. */
const RUN_STOPPING_ERRORS: ReadonlyArray<ErrorData["kind"]> = ["usage_limit", "login"];

/**
 * A rule break shows at once, from a verdict or from what the log already shows. The code checks
 * have the final word (D10), but only on the rule they name: a verdict on one rule never clears
 * a break of another. A pass waits for the judge or the end of the run, so that no card goes green
 * and then red. `run_finished` makes every status final: nothing more will arrive.
 */
function statusOf(
  chat: ChatView,
  run: Pick<RunState, "rules" | "mode">,
  finished: RunFinishedData | null,
): ChatStatus {
  const outcomes = Object.values(chat.results).map((result) => result.outcome);
  const logStands = (ruleId: string | null) =>
    ruleId === null ? !chat.codeChecked : chat.resultSources[ruleId] !== "code";
  const leakRule = run.rules.find((rule) => rule.check.type === "no_customer_data_leak");
  const leaksStand = logStands(leakRule?.id ?? null);

  const broke =
    outcomes.includes("fail") ||
    (leaksStand && chat.leaks.some((leak) => !leak.blocked)) ||
    chat.toolCalls.some((call) => call.decision === "flagged" && logStands(call.rule_id));
  if (broke) return "Brudd";

  // A block with no rule is an owner's limit that matches no rule, or a bot mistake such as bad
  // arguments. With no limits in force it can only be the mistake.
  const stoppedByLimit = (call: ToolCallData) =>
    call.decision === "blocked" &&
    (call.rule_id !== null || run.mode === "enforce") &&
    logStands(call.rule_id);
  const stopped =
    outcomes.includes("blocked") ||
    (leaksStand && chat.leaks.some((leak) => leak.blocked)) ||
    chat.toolCalls.some(stoppedByLimit);
  if (stopped) return "Stoppet";
  if (BROKEN_ENDS.includes(chat.endReason) || chat.error) return "Ikke testet";
  if (!finished && !(chat.ended && chat.judged)) return "Pågår";
  if (!chat.ended) return "Ikke testet";
  // A stopped run can cancel a chat that waits for the judge, with no event to say so.
  if (finished?.incomplete && !chat.judged) return "Ikke testet";
  return outcomes.every((outcome) => outcome === "not_tested") ? "Ikke testet" : "Bestått";
}

function mergeVerdict(chat: ChatView, verdict: VerdictData): Partial<ChatView> {
  const results = { ...chat.results };
  const resultSources = { ...chat.resultSources };
  for (const result of verdict.results) {
    const codeAlreadyDecided = resultSources[result.rule_id] === "code";
    if (verdict.source === "judge" && codeAlreadyDecided) continue;
    results[result.rule_id] = result;
    resultSources[result.rule_id] = verdict.source;
  }
  return {
    results,
    resultSources,
    judged: chat.judged || verdict.source === "judge",
    codeChecked: chat.codeChecked || verdict.source === "code",
    summary: verdict.summary ?? chat.summary,
  };
}

function newChat(id: string, ev: Extract<RunEvent, { type: "chat_started" }>): ChatView {
  return {
    id,
    name: ev.data.name,
    label: ev.data.label,
    kind: ev.data.kind,
    messages: [],
    toolCalls: [],
    leaks: [],
    timeline: [],
    results: {},
    resultSources: {},
    judged: false,
    codeChecked: false,
    summary: null,
    ended: false,
    endReason: null,
    error: null,
    status: "Pågår",
  };
}

/** The changes that an event makes to a chat that already exists. */
function chatChanges(chat: ChatView, ev: RunEvent): Partial<ChatView> | null {
  switch (ev.type) {
    case "message":
      return {
        messages: [...chat.messages, ev.data].sort((a, b) => a.index - b.index),
        timeline: [...chat.timeline, { kind: "message", seq: ev.seq, message: ev.data }],
      };
    case "tool_call":
      return {
        toolCalls: [...chat.toolCalls, ev.data],
        timeline: [...chat.timeline, { kind: "tool_call", seq: ev.seq, call: ev.data }],
      };
    case "leak":
      return {
        leaks: [...chat.leaks, ev.data],
        timeline: [...chat.timeline, { kind: "leak", seq: ev.seq, leak: ev.data }],
      };
    case "chat_ended":
      return { ended: true, endReason: ev.data.reason };
    case "verdict":
      return mergeVerdict(chat, ev.data);
    case "error":
      return { error: ev.data };
    default:
      return null;
  }
}

export function reduce(state: RunState, ev: RunEvent): RunState {
  if (state.runId !== null && ev.run_id !== state.runId) return state;
  if (state.lastSeq !== null && ev.seq <= state.lastSeq) return state;

  const next: RunState = { ...state, runId: ev.run_id, lastSeq: ev.seq };

  if (ev.type === "run_started") {
    return { ...next, mode: ev.data.mode, chatCount: ev.data.chat_count, rules: ev.data.rules };
  }
  if (ev.type === "run_finished") {
    const chats: Record<string, ChatView> = {};
    for (const id of state.order) {
      const chat = state.chats[id];
      const status = statusOf(chat, state, ev.data);
      chats[id] = status === chat.status ? chat : { ...chat, status };
    }
    return { ...next, chats, finished: ev.data };
  }
  if (ev.type === "error" && (ev.chat_id === null || RUN_STOPPING_ERRORS.includes(ev.data.kind))) {
    return { ...next, error: ev.data };
  }
  if (ev.chat_id === null) return next;
  if (ev.type === "chat_started") {
    const chats = { ...state.chats, [ev.chat_id]: newChat(ev.chat_id, ev) };
    return { ...next, chats, order: [...state.order, ev.chat_id] };
  }

  const chat = state.chats[ev.chat_id];
  const changes = chat ? chatChanges(chat, ev) : null;
  if (!changes) return next;

  const updated = { ...chat, ...changes };
  updated.status = statusOf(updated, state, state.finished);
  return { ...next, chats: { ...state.chats, [ev.chat_id]: updated } };
}

/** Settles a run whose log ends with no `run_finished`, because the engine stopped mid-run. */
export function abandonRun(state: RunState, runId: string): RunState {
  return reduce(state, {
    run_id: state.runId ?? runId,
    seq: (state.lastSeq ?? 0) + 1,
    t: 0,
    type: "run_finished",
    chat_id: null,
    data: { totals: {}, decision: null, incomplete: true },
  });
}
