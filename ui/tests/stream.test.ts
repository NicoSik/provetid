import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRun } from "../src/events/stream";
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

describe("openRun", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
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

  it("skips a line that is not a valid event", () => {
    const seen: number[] = [];
    openRun("r1", (ev) => seen.push(ev.seq));
    current().onmessage?.({ data: "ikke json" });
    current().onmessage?.({ data: '{"type":"ukjent"}' });
    current().send(message(1));
    expect(seen).toEqual([1]);
  });

  it("closes the stream at run_finished, so the browser does not reconnect", () => {
    openRun("r1", () => {});
    const source = current();
    source.send(finished);
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
    vi.advanceTimersByTime(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("reconnects after the last seen seq when the browser gives up on the connection", () => {
    const seen: number[] = [];
    openRun("r1", (ev) => seen.push(ev.seq));
    const first = current();
    first.send(message(1));
    first.send(message(2));

    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    vi.advanceTimersByTime(1000);

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(current().url).toBe("/api/runs/r1/events?after=2");
    current().send(message(3));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("leaves the reconnect to the browser while the browser is still retrying", () => {
    openRun("r1", () => {});
    const source = current();
    source.readyState = 0;
    source.onerror?.();
    vi.advanceTimersByTime(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("reports when the connection is lost and when it is back", () => {
    const states: boolean[] = [];
    openRun(
      "r1",
      () => {},
      (connected) => states.push(connected),
    );
    const first = current();
    first.onopen?.();
    first.readyState = 0;
    first.onerror?.();
    first.readyState = 1;
    first.onopen?.();
    first.readyState = FakeEventSource.CLOSED;
    first.onerror?.();
    vi.advanceTimersByTime(1000);
    current().onopen?.();
    expect(states).toEqual([true, false, true, false, true]);
  });

  it("keeps trying when the engine is away, so the run comes back when the engine does", () => {
    openRun("r1", () => {});
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const source = current();
      source.readyState = FakeEventSource.CLOSED;
      source.onerror?.();
      vi.advanceTimersByTime(1000);
      expect(FakeEventSource.instances).toHaveLength(attempt + 1);
    }
  });

  it("stops everything when the caller closes it, also a planned reconnect", () => {
    const close = openRun("r1", () => {});
    const source = current();
    source.readyState = FakeEventSource.CLOSED;
    source.onerror?.();
    close();
    vi.advanceTimersByTime(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
