// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initialState, type RunState, reduce } from "../src/events/reducer";
import type { Outcome, RunEvent, Severity } from "../src/events/types";

const fixture = readFileSync(new URL("../../fixtures/demo_run.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RunEvent);

let nextSeq = 100;

/** Build one event. Each call gets a higher `seq`, as in a real event log. */
function ev<T extends RunEvent["type"]>(
  type: T,
  chatId: string | null,
  data: Extract<RunEvent, { type: T }>["data"],
): RunEvent {
  nextSeq += 1;
  return { run_id: "r", seq: nextSeq, t: 0, type, chat_id: chatId, data } as RunEvent;
}

function started(id: string): RunEvent {
  return ev("chat_started", id, {
    name: id,
    kind: "attack",
    label: "Tester",
    source: "hand",
    target_rules: [],
  });
}

function result(ruleId: string, outcome: Outcome, severity: Severity = "high") {
  return {
    rule_id: ruleId,
    outcome,
    severity,
    quote: null,
    message_index: null,
    explanation: null,
  };
}

function verdict(id: string, source: "code" | "judge", results: ReturnType<typeof result>[]) {
  return ev("verdict", id, { source, results, summary: null });
}

function ended(id: string, reason: "done" | "error" | "refused" | "timeout" = "done") {
  return ev("chat_ended", id, { reason });
}

function run(events: RunEvent[]): RunState {
  return events.reduce(reduce, initialState());
}

describe("reducing the fixture", () => {
  const state = run(fixture);

  it("gives one chat per chat_started, in start order", () => {
    const startedIds = fixture.filter((e) => e.type === "chat_started").map((e) => e.chat_id);
    expect(state.order).toEqual(startedIds);
    expect(Object.keys(state.chats)).toHaveLength(startedIds.length);
  });

  it("keeps the run details", () => {
    expect(state.runId).toBe("demo-run");
    expect(state.mode).toBe("enforce");
    expect(state.chatCount).toBe(3);
    expect(state.rules).toHaveLength(4);
    expect(state.finished?.decision).toBe("Ikke klar: boten røper kundedata.");
  });

  it("gives the status that the fixture's verdicts imply", () => {
    expect(state.chats["chat-1"].status).toBe("Bestått");
    expect(state.chats["chat-2"].status).toBe("Stoppet");
    expect(state.chats["chat-3"].status).toBe("Brudd");
  });

  it("collects the tool calls, the leaks and the end reason of a chat", () => {
    expect(state.chats["chat-2"].toolCalls[0].decision).toBe("blocked");
    expect(state.chats["chat-3"].leaks[0].field).toBe("phone");
    expect(state.chats["chat-3"].endReason).toBe("error");
  });

  it("handles every event type in the fixture", () => {
    const types = new Set(fixture.map((e) => e.type));
    expect(types.size).toBe(9);
    expect(() => run(fixture)).not.toThrow();
  });

  it("does not change the previous state", () => {
    const before = run(fixture.slice(0, 3));
    const snapshot = JSON.stringify(before);
    reduce(before, fixture[3]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("messages and the timeline", () => {
  it("sorts messages by index, even when they arrive out of order", () => {
    const state = run([
      started("a"),
      ev("message", "a", { role: "bot", text: "svar", index: 1 }),
      ev("message", "a", { role: "customer", text: "spørsmål", index: 0 }),
    ]);
    expect(state.chats.a.messages.map((m) => m.index)).toEqual([0, 1]);
  });

  it("keeps messages, tool calls and leaks in arrival order in the timeline", () => {
    const state = run(fixture);
    const kinds = state.chats["chat-2"].timeline.map((item) => item.kind);
    expect(kinds).toEqual(["message", "message", "tool_call", "message"]);
  });
});

describe("chat status", () => {
  it("is Pågår while the chat runs and has no result", () => {
    const state = run([started("a"), ev("message", "a", { role: "bot", text: "x", index: 0 })]);
    expect(state.chats.a.status).toBe("Pågår");
  });

  it("is Brudd when any result fails, also next to a blocked result", () => {
    const state = run([
      started("a"),
      verdict("a", "code", [result("x", "blocked"), result("y", "fail")]),
    ]);
    expect(state.chats.a.status).toBe("Brudd");
  });

  it("is Stoppet when a result is blocked and none fails", () => {
    const state = run([
      started("a"),
      ended("a"),
      verdict("a", "code", [result("x", "blocked"), result("y", "pass")]),
    ]);
    expect(state.chats.a.status).toBe("Stoppet");
  });

  it("is Ikke testet when every result is not_tested", () => {
    const state = run([
      started("a"),
      ended("a"),
      verdict("a", "judge", [result("x", "not_tested"), result("y", "not_tested")]),
    ]);
    expect(state.chats.a.status).toBe("Ikke testet");
  });

  it("is Bestått when the judge has ruled after the chat ended", () => {
    const state = run([
      started("a"),
      ended("a"),
      verdict("a", "code", [result("x", "pass")]),
      verdict("a", "judge", [result("y", "pass"), result("z", "not_tested")]),
    ]);
    expect(state.chats.a.status).toBe("Bestått");
  });

  it("stays Pågår, not green, while the judge has not ruled", () => {
    const codeOnly = run([started("a"), ended("a"), verdict("a", "code", [result("x", "pass")])]);
    expect(codeOnly.chats.a.status).toBe("Pågår");
    const noVerdict = run([started("b"), ended("b")]);
    expect(noVerdict.chats.b.status).toBe("Pågår");
  });

  it("shows Brudd and Stoppet at once, without waiting for the judge", () => {
    const failed = run([started("a"), ended("a"), verdict("a", "code", [result("x", "fail")])]);
    expect(failed.chats.a.status).toBe("Brudd");
    const blocked = run([started("b"), ended("b"), verdict("b", "code", [result("x", "blocked")])]);
    expect(blocked.chats.b.status).toBe("Stoppet");
  });

  it.each(["error", "refused", "timeout"] as const)(
    "never counts a chat that ended as %s as a pass, also with passing results",
    (reason) => {
      const noVerdict = run([started("a"), ended("a", reason)]);
      expect(noVerdict.chats.a.status).toBe("Ikke testet");
      const passing = run([
        started("b"),
        ended("b", reason),
        verdict("b", "judge", [result("x", "pass")]),
      ]);
      expect(passing.chats.b.status).toBe("Ikke testet");
    },
  );

  it("still shows Brudd for a chat that failed a rule before it crashed", () => {
    const state = run([
      started("a"),
      ended("a", "error"),
      verdict("a", "code", [result("x", "fail")]),
    ]);
    expect(state.chats.a.status).toBe("Brudd");
  });
});

describe("run_finished settles every chat", () => {
  const finished = () =>
    ev("run_finished", null, { totals: {}, decision: null, incomplete: false });

  it("makes a chat that the judge never ruled on final", () => {
    const state = run([
      started("a"),
      ended("a"),
      verdict("a", "code", [result("x", "pass")]),
      started("b"),
      ended("b"),
      finished(),
    ]);
    expect(state.chats.a.status).toBe("Bestått");
    expect(state.chats.b.status).toBe("Ikke testet");
  });

  it("makes a chat that a usage limit stopped Ikke testet, not Pågår forever", () => {
    const state = run([started("a"), finished()]);
    expect(state.chats.a.status).toBe("Ikke testet");
  });

  it("keeps a Brudd", () => {
    const state = run([started("a"), verdict("a", "code", [result("x", "fail")]), finished()]);
    expect(state.chats.a.status).toBe("Brudd");
  });
});

describe("merging code and judge verdicts by rule", () => {
  it("keeps the results of both sources", () => {
    const state = run([
      started("a"),
      ended("a"),
      verdict("a", "code", [result("x", "pass")]),
      verdict("a", "judge", [result("y", "pass")]),
    ]);
    expect(Object.keys(state.chats.a.results).sort()).toEqual(["x", "y"]);
  });

  it("turns a chat into Brudd when the judge fails a rule after the code checks passed", () => {
    const state = run([
      started("a"),
      ended("a"),
      verdict("a", "code", [result("x", "pass")]),
      verdict("a", "judge", [result("y", "fail", "medium")]),
    ]);
    expect(state.chats.a.status).toBe("Brudd");
  });

  it("lets the code checks have the final word on the same rule, in either order", () => {
    const codeFirst = run([
      started("a"),
      verdict("a", "code", [result("x", "fail")]),
      verdict("a", "judge", [result("x", "pass")]),
    ]);
    const judgeFirst = run([
      started("a"),
      verdict("a", "judge", [result("x", "pass")]),
      verdict("a", "code", [result("x", "fail")]),
    ]);
    expect(codeFirst.chats.a.results.x.outcome).toBe("fail");
    expect(judgeFirst.chats.a.results.x.outcome).toBe("fail");
  });
});

describe("errors", () => {
  it("keeps a chat error on the chat, not on the run", () => {
    const state = run(fixture);
    expect(state.chats["chat-3"].error?.kind).toBe("call_failed");
    expect(state.error).toBeNull();
  });

  it("keeps a run error on the run", () => {
    const state = run([ev("error", null, { kind: "usage_limit", message: "Grensen er nådd." })]);
    expect(state.error?.kind).toBe("usage_limit");
  });
});

describe("errors that stop the whole run", () => {
  it.each(["usage_limit", "login"] as const)(
    "puts %s on the run, also when the event names a chat",
    (kind) => {
      const state = run([started("a"), ev("error", "a", { kind, message: "Stopp." })]);
      expect(state.error?.kind).toBe(kind);
      expect(state.chats.a.error).toBeNull();
    },
  );
});

describe("a stream that resumes", () => {
  it("ignores an event it has already seen, so a resent message is not doubled", () => {
    const once = run(fixture);
    const twice = run([...fixture, ...fixture]);
    expect(twice).toEqual(once);
  });

  it("ignores an event from another run", () => {
    const state = run(fixture);
    const other = { ...fixture[1], run_id: "annen-run", seq: 999, chat_id: "chat-x" } as RunEvent;
    expect(reduce(state, other)).toBe(state);
  });

  it("ignores an event for a chat that it does not know, without an exception", () => {
    const state = run(fixture);
    const stray = { ...fixture[2], seq: 999, chat_id: "ukjent" } as RunEvent;
    expect(reduce(state, stray).chats.ukjent).toBeUndefined();
  });
});
