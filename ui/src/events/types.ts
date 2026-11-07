// The event format shared with the engine. Part of the frozen contract: it mirrors
// engine/provetid/events.py and engine/provetid/plan/models.py.

export type Category = "money" | "privacy" | "law" | "brand";
export type CheckType =
  | "max_discount"
  | "max_refund"
  | "refund_original_only"
  | "no_customer_data_leak"
  | "tool_not_allowed"
  | "must_handover"
  | "correct_policy"
  | "discloses_ai"
  | "judge_only";
export type CustomerKind = "normal" | "attack" | "scam";

export interface Check {
  type: CheckType;
  params: Record<string, unknown>;
}

export interface Rule {
  id: string;
  text: string;
  category: Category;
  check: Check;
}

export type EventType =
  | "run_started"
  | "chat_started"
  | "message"
  | "tool_call"
  | "leak"
  | "chat_ended"
  | "verdict"
  | "run_finished"
  | "error";
export type Outcome = "pass" | "fail" | "blocked" | "not_tested";
export type Mode = "observe" | "enforce";
export type Severity = "high" | "medium" | "low";

export interface RunStartedData {
  mode: Mode;
  chat_count: number;
  rules: Rule[];
}

export interface ChatStartedData {
  name: string;
  kind: CustomerKind;
  label: string;
  source: string;
  target_rules: string[];
}

export interface MessageData {
  role: "customer" | "bot";
  text: string;
  index: number;
}

export interface ToolCallData {
  tool: string;
  input: Record<string, unknown>;
  decision: "allowed" | "flagged" | "blocked";
  rule_id: string | null;
  result_summary: string;
}

export interface LeakData {
  customer_id: string;
  field: "name" | "phone" | "email" | "address";
  excerpt: string;
  blocked: boolean;
}

export interface ChatEndedData {
  reason: "done" | "max_turns" | "refused" | "error" | "timeout";
}

export interface RuleResult {
  rule_id: string;
  outcome: Outcome;
  severity: Severity;
  quote: string | null;
  message_index: number | null;
  explanation: string | null;
}

export interface VerdictData {
  source: "code" | "judge";
  results: RuleResult[];
  summary: string | null;
}

export interface RunFinishedData {
  totals: Record<string, number>;
  decision: string | null;
  incomplete: boolean;
}

export interface ErrorData {
  kind: "usage_limit" | "login" | "call_failed" | "internal";
  message: string;
}

interface EventBase {
  run_id: string;
  seq: number;
  t: number;
  chat_id: string | null;
}

export type RunEvent =
  | (EventBase & { type: "run_started"; data: RunStartedData })
  | (EventBase & { type: "chat_started"; data: ChatStartedData })
  | (EventBase & { type: "message"; data: MessageData })
  | (EventBase & { type: "tool_call"; data: ToolCallData })
  | (EventBase & { type: "leak"; data: LeakData })
  | (EventBase & { type: "chat_ended"; data: ChatEndedData })
  | (EventBase & { type: "verdict"; data: VerdictData })
  | (EventBase & { type: "run_finished"; data: RunFinishedData })
  | (EventBase & { type: "error"; data: ErrorData });

export const EVENT_TYPES: readonly EventType[] = [
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

/** Check the envelope: the field types and a known `type`. The engine validates `data`. */
export function isRunEvent(x: unknown): x is RunEvent {
  if (typeof x !== "object" || x === null) return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.run_id === "string" &&
    typeof e.seq === "number" &&
    typeof e.t === "number" &&
    typeof e.type === "string" &&
    (EVENT_TYPES as readonly string[]).includes(e.type) &&
    (e.chat_id === null || typeof e.chat_id === "string") &&
    typeof e.data === "object" &&
    e.data !== null
  );
}
