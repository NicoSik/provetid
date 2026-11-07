import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConnectionStatus, openRun } from "../src/events/stream";
import type { RunEvent } from "../src/events/types";

/** Stands in for the browser's EventSource and records every connection. */
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
  send(ev: RunEvent) {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }
  /** The browser gave up on this connection. */
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
  /** The response ended, and the browser will retry by itself. */
  drop() {
    this.readyState = 0;
    this.onerror?.();
  }
}

function message(seq: number): RunEvent {
  return {
    run_id: "r1",
    seq,
    t: 0,
    type: "message",
    chat_id: "a",
    data: { role: "bot", text: "x", index: seq },
  };
}

const finished: RunEvent = {
  run_id: "r1",
  seq: 9,
  t: 0,
  type: "run_finished",
  chat_id: null,
  data: { totals: {}, decision: null, incomplete: false },
};

function current() {
  return FakeEventSource.instances[FakeEventSource.instances.length - 1];
}

type Lookup = { live: boolean; finished: boolean; last_seq: number };

const LIVE: Lookup = { live: true, finished: false, last_seq: 0 };

function stubRunLookup(answer: Lookup | number) {
  const lookup = vi.fn(async (_url: string, _init?: RequestInit) =>
    typeof answer === "number"
      ? { ok: false, status: answer, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => answer },
  );
  vi.stubGlobal("fetch", lookup);
  return lookup;
}

describe("openRun", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    stubRunLookup(LIVE);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens the run's event stream and passes on each event", () => {
    const seen: number[] = [];
    openRun("r1", (ev) => seen.push(ev.seq));
    expect(current().url).toBe("/api/runs/r1/events");
    current().send(message(1));
    current().send(message(2));
    expect(seen).toEqual([1, 2]);
  });

  it("skips an event it already passed on, and keeps its place in the log", async () => {
    const seen: number[] = [];
    openRun("r1", (ev) => seen.push(ev.seq));
    const first = current();
    first.send(message(5));
    first.send(message(2));
    first.send(message(6));
    expect(seen).toEqual([5, 6]);
    first.fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(current().url).toBe("/api/runs/r1/events?after=6");
  });

  it("skips a line that is not a valid event", () => {
    const seen: number[] = [];
    openRun("r1", (ev) => seen.push(ev.seq));
    current().onmessage?.({ data: "ikke json" });
    current().onmessage?.({ data: '{"type":"ukjent"}' });
    current().send(message(1));
    expect(seen).toEqual([1]);
  });

  it("closes the stream at run_finished, so the browser does not reconnect", async () => {
    openRun("r1", () => {});
    const source = current();
    source.send(finished);
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("reconnects after the last seen seq when the browser gives up", async () => {
    const seen: number[] = [];
    openRun("r1", (ev) => seen.push(ev.seq));
    const first = current();
    first.send(message(1));
    first.send(message(2));

    first.fail();
    await vi.advanceTimersByTimeAsync(1000);

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(current().url).toBe("/api/runs/r1/events?after=2");
    current().send(message(3));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("leaves the reconnect to the browser while the browser is still retrying", async () => {
    openRun("r1", () => {});
    current().drop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("reports when the connection is lost and when it is back", async () => {
    const states: ConnectionStatus[] = [];
    openRun(
      "r1",
      () => {},
      (status) => states.push(status),
    );
    const first = current();
    first.onopen?.();
    first.send(message(1));
    first.drop();
    first.readyState = 1;
    first.onopen?.();
    first.send(message(2));
    first.fail();
    await vi.advanceTimersByTimeAsync(1000);
    current().onopen?.();
    expect(states).toEqual(["connected", "lost", "connected", "lost", "connected"]);
  });

  it("keeps trying while the engine is away, also when the lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("nettverksfeil");
      }),
    );
    openRun("r1", () => {});
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      current().fail();
      await vi.advanceTimersByTimeAsync(1000);
      expect(FakeEventSource.instances).toHaveLength(attempt + 1);
    }
  });

  it("stops everything when the caller closes it, also a planned reconnect", async () => {
    const close = openRun("r1", () => {});
    current().fail();
    close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("opens one new connection when two lookups overlap", async () => {
    const answers: Array<(value: unknown) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => answers.push(resolve))),
    );
    openRun("r1", () => {});
    const first = current();
    first.drop();
    first.fail();
    const live = { ok: true, status: 200, json: async () => LIVE };
    for (const answer of answers) answer(live);
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("does not leave a reconnect hanging on a lookup that never answers", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    openRun("r1", () => {});
    current().fail();
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  describe("a run that no longer exists", () => {
    it("stops retrying and reports it", async () => {
      stubRunLookup(404);
      const states: ConnectionStatus[] = [];
      openRun(
        "r1",
        () => {},
        (status) => states.push(status),
      );
      current().fail();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(FakeEventSource.instances).toHaveLength(1);
      expect(states[states.length - 1]).toBe("missing");
    });

    it("keeps retrying on another error from the lookup", async () => {
      stubRunLookup(502);
      openRun("r1", () => {});
      current().fail();
      await vi.advanceTimersByTimeAsync(1000);
      expect(FakeEventSource.instances).toHaveLength(2);
    });

    it("asks about the right run, and reports nothing after the caller closed it", async () => {
      const lookup = stubRunLookup(404);
      const states: ConnectionStatus[] = [];
      const close = openRun(
        "r 1",
        () => {},
        (status) => states.push(status),
      );
      current().fail();
      close();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(lookup.mock.calls[0]?.[0]).toBe("/api/runs/r%201/status");
      expect(states).not.toContain("missing");
    });
  });

  describe("a saved log with no run_finished", () => {
    async function openedWith(answer: Lookup, seq: number) {
      stubRunLookup(answer);
      const states: ConnectionStatus[] = [];
      openRun(
        "r1",
        () => {},
        (status) => states.push(status),
      );
      const source = current();
      source.onopen?.();
      source.send(message(seq));
      source.drop();
      await vi.advanceTimersByTimeAsync(0);
      return { states, source };
    }

    it("is abandoned when the engine says it is not live and we have every event", async () => {
      const { states, source } = await openedWith({ live: false, finished: false, last_seq: 7 }, 7);
      expect(states[states.length - 1]).toBe("abandoned");
      expect(source.readyState).toBe(FakeEventSource.CLOSED);
    });

    it("is not abandoned while events are still missing", async () => {
      const { states, source } = await openedWith({ live: false, finished: false, last_seq: 9 }, 7);
      expect(states).not.toContain("abandoned");
      expect(source.readyState).not.toBe(FakeEventSource.CLOSED);
    });

    it("is not abandoned when the run is live, however often the connection drops", async () => {
      const { states, source } = await openedWith({ live: true, finished: false, last_seq: 7 }, 7);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        source.readyState = 1;
        source.onopen?.();
        source.drop();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(states).not.toContain("abandoned");
    });

    it("is not abandoned when the run finished, so the last events can still arrive", async () => {
      const { states } = await openedWith({ live: false, finished: true, last_seq: 9 }, 7);
      expect(states).not.toContain("abandoned");
    });

    it("is not abandoned when the engine cannot answer", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("nettverksfeil");
        }),
      );
      const states: ConnectionStatus[] = [];
      openRun(
        "r1",
        () => {},
        (status) => states.push(status),
      );
      current().drop();
      await vi.advanceTimersByTimeAsync(0);
      expect(states).toEqual(["lost"]);
    });
  });
});
