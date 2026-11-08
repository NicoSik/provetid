import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StepNav } from "../src/components/StepNav";
import { initialState, type RunState, reduce } from "../src/events/reducer";
import { loadReplay, stopSharedReplay } from "../src/events/replay";
import type { Rule, RunEvent } from "../src/events/types";
import { runCounts } from "../src/report/rows";
import FoerEtter, { CompareView, screen as meta } from "../src/screens/FoerEtter";
import { ReportView } from "../src/screens/Karakterkort";
import Signeringsrett from "../src/screens/Signeringsrett";
import { updateSession } from "../src/state/session";

const fixtureText = readFileSync(resolve(process.cwd(), "../fixtures/demo_run.jsonl"), "utf8");
const fixture = fixtureText
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RunEvent);

const RULES: Rule[] = [
  {
    id: "R1",
    text: "Maks 10 % rabatt",
    category: "money",
    check: { type: "max_discount", params: { percent: 10 } },
  },
];

function run(
  options: {
    mode?: "observe" | "enforce";
    fails?: number;
    blocked?: number;
    decision?: string | null;
    incomplete?: boolean;
    finished?: boolean;
    rules?: Rule[];
    runId?: string;
  } = {},
): RunEvent[] {
  let seq = 0;
  const runId = options.runId ?? "r";
  const event = (type: RunEvent["type"], chatId: string | null, data: unknown) => {
    seq += 1;
    return { run_id: runId, seq, t: 0, type, chat_id: chatId, data } as RunEvent;
  };
  const events = [
    event("run_started", null, {
      mode: options.mode ?? "observe",
      chat_count: 20,
      rules: options.rules ?? RULES,
    }),
  ];
  const outcomes = [
    ...Array(options.fails ?? 0).fill("fail"),
    ...Array(options.blocked ?? 0).fill("blocked"),
  ];
  outcomes.forEach((outcome, index) => {
    const id = `chat-${index}`;
    events.push(
      event("chat_started", id, {
        name: `Kunde ${index}`,
        kind: "attack",
        label: "T",
        source: "hand",
        target_rules: [],
      }),
      event("chat_ended", id, { reason: "done" }),
      event("verdict", id, {
        source: "code",
        results: [
          {
            rule_id: "R1",
            outcome,
            severity: "high",
            quote: null,
            message_index: null,
            explanation: null,
          },
        ],
        summary: null,
      }),
    );
  });
  if (options.finished !== false) {
    events.push(
      event("run_finished", null, {
        totals: {},
        decision: options.decision === undefined ? "Ikke ansett" : options.decision,
        incomplete: options.incomplete ?? false,
      }),
    );
  }
  return events;
}

function state(events: RunEvent[]): RunState {
  return events.reduce(reduce, initialState());
}

const BEFORE = () => state(run({ mode: "observe", fails: 13, decision: "Ikke ansett" }));
const AFTER = () =>
  state(run({ mode: "enforce", fails: 1, blocked: 12, decision: "Ansett med forbehold" }));

function column(name: "FØR" | "ETTER") {
  return within(screen.getByRole("region", { name }));
}

function figure(name: "FØR" | "ETTER", label: string) {
  const term = column(name).getByText(label);
  return term.parentElement?.querySelector("dd")?.textContent;
}

function stubDismiss() {
  const lookup = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({ dismissed: false }),
  }));
  vi.stubGlobal("fetch", lookup);
  return lookup;
}

function hireButton() {
  return screen.getByRole("button", { name: "Ansett og start prøvetid" });
}

function jsonl(events: RunEvent[]) {
  return `${events.map((ev) => JSON.stringify(ev)).join("\n")}\n`;
}

function serveReplays(files: Record<string, string>) {
  const lookup = vi.fn(async (url: string) => {
    const name = url.replace("/replays/", "").replace(".jsonl", "");
    const body = files[name];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      text: async () => body ?? "",
    };
  });
  vi.stubGlobal("fetch", lookup);
  return lookup;
}

beforeEach(() => {
  updateSession({ currentRunId: null, beforeRunId: null, afterRunId: null });
  window.history.replaceState(null, "", "/#/foer-etter");
});

afterEach(() => {
  stopSharedReplay();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("runCounts", () => {
  it("counts the chats with Brudd and with Stoppet, as the cards on Intervju do", () => {
    expect(runCounts(AFTER())).toEqual({ fails: 1, blocked: 12 });
  });

  it("counts a chat once, also when it broke two rules", () => {
    const events = run({ fails: 1 });
    const verdict = events.find((ev) => ev.type === "verdict");
    if (verdict?.type !== "verdict") throw new Error("Fant ingen dom");
    verdict.data.results.push({ ...verdict.data.results[0], rule_id: "R2" });
    expect(runCounts(state(events))).toEqual({ fails: 1, blocked: 0 });
  });

  it("counts what the log already proves, before the verdict arrives", () => {
    const events = run({ finished: false });
    const proof = [
      {
        run_id: "r",
        seq: 50,
        t: 0,
        type: "chat_started",
        chat_id: "a",
        data: { name: "K", kind: "attack", label: "T", source: "hand", target_rules: [] },
      },
      {
        run_id: "r",
        seq: 51,
        t: 0,
        type: "tool_call",
        chat_id: "a",
        data: {
          tool: "give_discount",
          input: {},
          decision: "flagged",
          rule_id: "R1",
          result_summary: "x",
        },
      },
    ] as RunEvent[];
    expect(runCounts(state([...events, ...proof]))).toEqual({ fails: 1, blocked: 0 });
  });

  it("counts the fixture by hand", () => {
    expect(runCounts(state(fixture))).toEqual({ fails: 1, blocked: 1 });
  });

  it("is zero for a run with no results", () => {
    expect(runCounts(initialState())).toEqual({ fails: 0, blocked: 0 });
  });
});

describe("the two columns", () => {
  it("shows both decisions and both pairs of counts for two finished runs", () => {
    render(<CompareView before={BEFORE()} after={AFTER()} />);
    expect(column("FØR").getByRole("heading", { name: "Ikke ansett" })).toBeInTheDocument();
    expect(
      column("ETTER").getByRole("heading", { name: "Ansett med forbehold" }),
    ).toBeInTheDocument();
    expect(figure("FØR", "Brudd")).toBe("13");
    expect(figure("FØR", "Stoppet")).toBe("0");
    expect(figure("ETTER", "Brudd")).toBe("1");
    expect(figure("ETTER", "Stoppet")).toBe("12");
  });

  it("shows two states built from the fixture", () => {
    render(<CompareView before={state(fixture)} after={state(fixture)} />);
    expect(
      column("FØR").getByRole("heading", { name: "Ikke klar: boten røper kundedata." }),
    ).toBeInTheDocument();
    expect(
      column("ETTER").getByRole("heading", { name: "Ikke klar: boten røper kundedata." }),
    ).toBeInTheDocument();
    expect(figure("FØR", "Brudd")).toBe("1");
    expect(figure("ETTER", "Stoppet")).toBe("1");
  });

  it("shows «pågår» for a second run with no run_finished, with its counts so far", () => {
    const going = state(run({ mode: "enforce", blocked: 4, finished: false }));
    render(<CompareView before={BEFORE()} after={going} />);
    expect(column("ETTER").getByText("pågår")).toBeInTheDocument();
    expect(column("ETTER").queryByRole("heading", { name: /ansett/i })).not.toBeInTheDocument();
    expect(figure("ETTER", "Stoppet")).toBe("4");
  });

  it("says which run had limits, from the run itself", () => {
    render(<CompareView before={BEFORE()} after={AFTER()} />);
    expect(column("FØR").getByText("Uten grenser")).toBeInTheDocument();
    expect(column("ETTER").getByText("Med grenser")).toBeInTheDocument();
  });

  it("never says ready for an incomplete run", () => {
    const stopped = state(run({ mode: "enforce", decision: null, incomplete: true }));
    render(<CompareView before={BEFORE()} after={stopped} />);
    expect(column("ETTER").getByRole("heading", { name: "Ingen avgjørelse" })).toBeInTheDocument();
    expect(column("ETTER").getByText("Testen er ufullstendig")).toBeInTheDocument();
  });

  it("warns when the two runs do not have the same rules (REQ-5.8)", () => {
    const other = state(
      run({
        mode: "enforce",
        rules: [{ ...RULES[0], id: "R9", text: "Noe annet" }],
      }),
    );
    render(<CompareView before={BEFORE()} after={other} />);
    expect(screen.getByRole("alert")).toHaveTextContent("ikke samme regler");
  });

  it("warns when a rule keeps its ID but was changed", () => {
    const edited = state(
      run({ mode: "enforce", rules: [{ ...RULES[0], text: "Maks 50 % rabatt" }] }),
    );
    render(<CompareView before={BEFORE()} after={edited} />);
    expect(screen.getByRole("alert")).toHaveTextContent("ikke samme regler");
  });

  it("gives the real reason in the column when an error stopped the run", () => {
    const stopped = reduce(state(run({ mode: "enforce", decision: null, incomplete: true })), {
      run_id: "r",
      seq: 99,
      t: 0,
      type: "error",
      chat_id: null,
      data: { kind: "usage_limit", message: "raw text" },
    });
    render(<CompareView before={BEFORE()} after={stopped} />);
    expect(column("ETTER").getByText(/Bruksgrensen er nådd/)).toBeInTheDocument();
    expect(column("ETTER").queryByText(/raw text/)).not.toBeInTheDocument();
  });

  it("does not warn for the same rules, or before a run has its rules", () => {
    const first = render(<CompareView before={BEFORE()} after={AFTER()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    first.unmount();
    render(<CompareView before={BEFORE()} after={initialState()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a connection problem in the column it belongs to", () => {
    render(<CompareView before={BEFORE()} after={AFTER()} afterConnection="lost" />);
    expect(column("ETTER").getByRole("alert")).toHaveTextContent("Mistet kontakten");
    expect(column("FØR").queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("«Ansett og start prøvetid»", () => {
  it("opens the Prøvetid screen", async () => {
    stubDismiss();
    render(<CompareView before={BEFORE()} after={AFTER()} />);
    fireEvent.click(hireButton());
    await waitFor(() => expect(window.location.hash).toBe("#/proevetid"));
  });

  it("brings back a bot that was let go, so a rehearsal cannot break the demo", async () => {
    const lookup = stubDismiss();
    render(<CompareView before={BEFORE()} after={AFTER()} />);
    fireEvent.click(hireButton());
    await waitFor(() => expect(window.location.hash).toBe("#/proevetid"));
    const [url, init] = lookup.mock.calls[0];
    expect(url).toBe("/api/dismiss");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ dismissed: false });
  });

  it("stays, and says so, when the engine cannot bring the bot back", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    render(<CompareView before={BEFORE()} after={AFTER()} />);
    fireEvent.click(hireButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Fikk ikke kontakt med motoren");
    expect(window.location.hash).toBe("#/foer-etter");
  });

  it("cannot be used during a replay, because Prøvetid needs the engine", () => {
    window.history.replaceState(null, "", "/?replay=after#/foer-etter");
    render(<CompareView before={BEFORE()} after={AFTER()} />);
    expect(hireButton()).toBeDisabled();
    expect(hireButton()).toHaveAccessibleDescription(/avspilling/);
  });

  it("cannot be used when the screen says the runs cannot be compared", () => {
    const other = state(
      run({ mode: "enforce", decision: "Klar for prøvetid", rules: [{ ...RULES[0], id: "R9" }] }),
    );
    render(<CompareView before={BEFORE()} after={other} />);
    expect(hireButton()).toBeDisabled();
    expect(hireButton()).toHaveAccessibleDescription(/samme regler/);
  });

  it("cannot be used when ETTER ran with no limits", () => {
    const open = state(run({ mode: "observe", decision: "Klar for prøvetid" }));
    render(<CompareView before={BEFORE()} after={open} />);
    expect(hireButton()).toBeDisabled();
    expect(hireButton()).toHaveAccessibleDescription(/uten grenser/i);
  });

  it.each([
    ["is still going", () => state(run({ mode: "enforce", finished: false })), /pågår/],
    [
      "failed",
      () => state(run({ mode: "enforce", fails: 2, decision: "Ikke ansett" })),
      /ikke bestått/i,
    ],
    [
      "gave no decision",
      () => state(run({ mode: "enforce", decision: null, incomplete: true })),
      /ikke bestått|ufullstendig/i,
    ],
    ["does not exist", () => initialState(), /Ingen kjøring/],
  ])("cannot be used when the run with limits %s", (_name, after, reason) => {
    render(<CompareView before={BEFORE()} after={after()} />);
    expect(hireButton()).toBeDisabled();
    expect(hireButton()).toHaveAccessibleDescription(reason);
  });
});

describe("a run that is in the session but has not sent anything yet", () => {
  it("says it is fetching, and does not tell the speaker to redo a step", () => {
    render(<CompareView before={BEFORE()} after={initialState()} afterLoading />);
    expect(column("ETTER").getByText("Henter kjøringen …")).toBeInTheDocument();
    expect(column("ETTER").queryByText(/Kjør intervjuet igjen/)).not.toBeInTheDocument();
    expect(hireButton()).toHaveAccessibleDescription(/Henter/);
  });
});

describe("a run that is missing from the session", () => {
  it("says how to get the second run", () => {
    render(<CompareView before={BEFORE()} after={initialState()} />);
    // «Bruk forslagene» only exists when something failed; «Kjør intervjuet igjen» always does.
    expect(
      column("ETTER").getByText(/«Kjør intervjuet igjen» på Signeringsrett/),
    ).toBeInTheDocument();
    expect(column("ETTER").queryByText(/Bruk forslagene/)).not.toBeInTheDocument();
  });

  it("says how to get the first run", () => {
    render(<CompareView before={initialState()} after={AFTER()} />);
    expect(column("FØR").getByText(/uten grenser/i)).toBeInTheDocument();
  });
});

describe("the screen on live runs", () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    static readonly CLOSED = 2;
    readyState = 1;
    onmessage: ((message: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onopen: (() => void) | null = null;
    constructor(public url: string) {
      FakeEventSource.instances.push(this);
    }
    close() {
      this.readyState = FakeEventSource.CLOSED;
    }
  }

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  it("streams each run from the session into its own column, and updates live", async () => {
    updateSession({ beforeRunId: "r1", afterRunId: "r2" });
    render(<FoerEtter />);
    const urls = FakeEventSource.instances.map((source) => source.url);
    expect(urls).toEqual(["/api/runs/r1/events", "/api/runs/r2/events"]);
    const [first, second] = FakeEventSource.instances;
    const { act } = await import("@testing-library/react");
    act(() => {
      for (const ev of run({ runId: "r1", fails: 3 }))
        first.onmessage?.({ data: JSON.stringify(ev) });
      for (const ev of run({ runId: "r2", mode: "enforce", blocked: 2, finished: false })) {
        second.onmessage?.({ data: JSON.stringify(ev) });
      }
    });
    expect(figure("FØR", "Brudd")).toBe("3");
    expect(figure("ETTER", "Stoppet")).toBe("2");
    expect(column("ETTER").getByText("pågår")).toBeInTheDocument();
  });
});

describe("loadReplay", () => {
  it("reads a pinned file without timing", async () => {
    const lookup = serveReplays({ before: fixtureText });
    const events = await loadReplay("before");
    expect(events).toHaveLength(fixture.length);
    expect(lookup).toHaveBeenCalledWith("/replays/before.jsonl", { cache: "no-cache" });
  });

  it("gives null for a missing or empty file, a dev server's HTML page, and a failed fetch", async () => {
    serveReplays({ html: "<!doctype html>", empty: "" });
    expect(await loadReplay("missing")).toBeNull();
    expect(await loadReplay("html")).toBeNull();
    expect(await loadReplay("empty")).toBeNull();
    const before = vi.mocked(fetch).mock.calls.length;
    expect(await loadReplay("../../secret")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.length).toBe(before);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("nettverksfeil");
      }),
    );
    expect(await loadReplay("before")).toBeNull();
  });
});

describe("the screen during a replay", () => {
  it("shows the two pinned runs side by side with no engine, whichever one the URL names", async () => {
    const lookup = serveReplays({
      before: jsonl(run({ fails: 13, decision: "Ikke ansett" })),
      after: jsonl(run({ mode: "enforce", blocked: 13, decision: "Klar for prøvetid" })),
    });
    window.history.replaceState(null, "", "/?replay=after#/foer-etter");
    render(<FoerEtter />);
    expect(await column("FØR").findByRole("heading", { name: "Ikke ansett" })).toBeInTheDocument();
    expect(column("ETTER").getByRole("heading", { name: "Klar for prøvetid" })).toBeInTheDocument();
    expect(figure("FØR", "Brudd")).toBe("13");
    expect(figure("ETTER", "Stoppet")).toBe("13");
    for (const [url] of lookup.mock.calls) expect(url).toMatch(/^\/replays\//);
  });

  it("says which file is missing, and still shows the other", async () => {
    serveReplays({ before: jsonl(run({ fails: 13 })) });
    window.history.replaceState(null, "", "/?replay=before#/foer-etter");
    render(<FoerEtter />);
    expect(await column("ETTER").findByRole("alert")).toHaveTextContent(
      "Fant ikke denne avspillingen",
    );
    expect(figure("FØR", "Brudd")).toBe("13");
    expect(hireButton()).toBeDisabled();
  });

  it("settles a pinned file that was cut off, instead of «pågår» forever", async () => {
    serveReplays({
      before: jsonl(run({ fails: 2 })),
      after: jsonl(run({ mode: "enforce", blocked: 1, finished: false })),
    });
    window.history.replaceState(null, "", "/?replay=before#/foer-etter");
    render(<FoerEtter />);
    expect(await column("ETTER").findByText("Testen er ufullstendig")).toBeInTheDocument();
    expect(column("ETTER").queryByText("pågår")).not.toBeInTheDocument();
  });
});

describe("getting to the screen", () => {
  it("is not its own step, because it belongs to Karakterkort (D40)", () => {
    expect(meta).toEqual({ path: "/foer-etter", step: null, title: "Før og etter" });
    render(<StepNav screens={[]} currentPath="/foer-etter" />);
    expect(screen.queryByRole("link", { name: "Før og etter" })).not.toBeInTheDocument();
  });

  it("opens from Signeringsrett, where the pitch comes from, once there is a second run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          max_discount_percent: 10,
          max_refund_nok: null,
          refund_original_only: false,
          hide_address_phone: false,
          allow_address_change: true,
          extra_instructions: [],
        }),
      })),
    );
    updateSession({ afterRunId: "r2" });
    render(<Signeringsrett />);
    fireEvent.click(await screen.findByRole("button", { name: "Se før og etter" }));
    expect(window.location.hash).toBe("#/foer-etter");
  });

  it("is not offered on Signeringsrett before there is a second run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    render(<Signeringsrett />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Se før og etter" })).not.toBeInTheDocument();
  });

  it("is offered on Signeringsrett during a replay, because the pitch falls back to one", () => {
    window.history.replaceState(null, "", "/?replay=after#/signeringsrett");
    render(<Signeringsrett />);
    expect(screen.getByRole("button", { name: "Se før og etter" })).toBeInTheDocument();
  });

  it("opens from the report card once the second run has started", () => {
    updateSession({ currentRunId: "r", beforeRunId: "r", afterRunId: "r2" });
    window.history.replaceState(null, "", "/#/karakterkort");
    render(<ReportView state={state(run({ fails: 1 }))} />);
    fireEvent.click(screen.getByRole("button", { name: "Se før og etter" }));
    expect(window.location.hash).toBe("#/foer-etter");
  });

  it("opens from the report of the second run too, with or without fails", () => {
    updateSession({ currentRunId: "r2", beforeRunId: "r", afterRunId: "r2" });
    const clean = render(
      <ReportView state={state(run({ mode: "enforce", decision: "Klar for prøvetid" }))} />,
    );
    expect(screen.getByRole("button", { name: "Se før og etter" })).toBeInTheDocument();
    clean.unmount();
    render(<ReportView state={state(run({ mode: "enforce", fails: 1 }))} />);
    expect(screen.getByRole("button", { name: "Se før og etter" })).toBeInTheDocument();
  });

  it("is offered once on the report during a replay, with nothing that needs the engine", () => {
    updateSession({ beforeRunId: "r", afterRunId: "r2" });
    window.history.replaceState(null, "", "/?replay=before#/karakterkort");
    render(<ReportView state={state(run({ fails: 1 }))} />);
    expect(screen.getAllByRole("button", { name: "Se før og etter" })).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Se intervjuet med grenser" }),
    ).not.toBeInTheDocument();
  });

  it("is not offered on the report before there is a second run", () => {
    render(<ReportView state={state(run({ fails: 1 }))} />);
    expect(screen.queryByRole("button", { name: "Se før og etter" })).not.toBeInTheDocument();
  });
});
