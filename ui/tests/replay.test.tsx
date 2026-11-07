import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplayBadge } from "../src/components/ReplayBadge";
import { initialState, reduce } from "../src/events/reducer";
import {
  joinReplay,
  pauseReplay,
  playReplay,
  replayName,
  replaySpeed,
  stopSharedReplay,
} from "../src/events/replay";
import { openRun } from "../src/events/stream";
import type { RunEvent } from "../src/events/types";
import Intervju from "../src/screens/Intervju";
import { updateSession } from "../src/state/session";

const fixtureText = readFileSync(resolve(process.cwd(), "../fixtures/demo_run.jsonl"), "utf8");
const fixture = fixtureText
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RunEvent);

function message(seq: number, t: number): RunEvent {
  return {
    run_id: "r",
    seq,
    t,
    type: "message",
    chat_id: "a",
    data: { role: "bot", text: `m${seq}`, index: seq },
  };
}

function jsonl(events: RunEvent[]): string {
  return `${events.map((ev) => JSON.stringify(ev)).join("\n")}\n`;
}

function serve(body: string, status = 200) {
  const lookup = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status < 400,
    status,
    text: async () => body,
  }));
  vi.stubGlobal("fetch", lookup);
  return lookup;
}

function setUrl(search: string) {
  window.history.replaceState(null, "", `/${search}`);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stopSharedReplay();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setUrl("");
});

/** Let the fetch and the reading of the file finish, with no time passing. */
const loaded = () => vi.advanceTimersByTimeAsync(0);

describe("playReplay", () => {
  it("delivers events in seq order, with the original delays divided by the speed", async () => {
    serve(jsonl([message(1, 0), message(2, 1.5), message(3, 3)]));
    const seen: number[] = [];
    playReplay("/replays/x.jsonl", 3, (ev) => seen.push(ev.seq));
    await loaded();
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(499);
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("keeps the original timing at speed 1", async () => {
    serve(jsonl([message(1, 0), message(2, 2)]));
    const seen: number[] = [];
    playReplay("/x", 1, (ev) => seen.push(ev.seq));
    await loaded();
    await vi.advanceTimersByTimeAsync(1999);
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([1, 2]);
  });

  it("delivers events with the same time together", async () => {
    serve(jsonl([message(1, 0), message(2, 0), message(3, 0)]));
    const seen: number[] = [];
    playReplay("/x", 1, (ev) => seen.push(ev.seq));
    await loaded();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("sorts by seq if the file is out of order", async () => {
    serve(jsonl([message(2, 0), message(1, 0)]));
    const seen: number[] = [];
    playReplay("/x", 1, (ev) => seen.push(ev.seq));
    await loaded();
    expect(seen).toEqual([1, 2]);
  });

  it("pause stops the events, and resume continues with the time that was left", async () => {
    serve(jsonl([message(1, 0), message(2, 1), message(3, 2)]));
    const seen: number[] = [];
    const replay = playReplay("/x", 1, (ev) => seen.push(ev.seq));
    await loaded();
    await vi.advanceTimersByTimeAsync(400);
    replay.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toEqual([1]);
    replay.resume();
    await vi.advanceTimersByTimeAsync(599);
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([1, 2]);
  });

  it("waits for resume when it was paused before the file loaded", async () => {
    serve(jsonl([message(1, 0), message(2, 1)]));
    const seen: number[] = [];
    const replay = playReplay("/x", 1, (ev) => seen.push(ev.seq));
    replay.pause();
    await loaded();
    expect(seen).toEqual([]);
    replay.resume();
    expect(seen).toEqual([1]);
  });

  it("does not deliver twice when resume is called twice", async () => {
    serve(jsonl([message(1, 0), message(2, 1)]));
    const seen: number[] = [];
    const replay = playReplay("/x", 1, (ev) => seen.push(ev.seq));
    await loaded();
    replay.pause();
    replay.resume();
    replay.resume();
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen).toEqual([1, 2]);
  });

  it("stop ends it for good, also before the file loaded", async () => {
    serve(jsonl([message(1, 0), message(2, 1)]));
    const seen: number[] = [];
    const early = playReplay("/x", 1, (ev) => seen.push(ev.seq));
    early.stop();
    await loaded();
    expect(seen).toEqual([]);

    const late = playReplay("/x", 1, (ev) => seen.push(ev.seq));
    await loaded();
    late.stop();
    late.resume();
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen).toEqual([1]);
  });

  it("setSpeed rescales the wait in progress and the later ones, with no restart", async () => {
    serve(jsonl([message(1, 0), message(2, 1), message(3, 2)]));
    const seen: number[] = [];
    const replay = playReplay("/x", 1, (ev) => seen.push(ev.seq));
    await loaded();
    await vi.advanceTimersByTimeAsync(400);
    replay.setSpeed(2);
    await vi.advanceTimersByTimeAsync(299);
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("setSpeed while paused applies to the time that was left", async () => {
    serve(jsonl([message(1, 0), message(2, 1)]));
    const seen: number[] = [];
    const replay = playReplay("/x", 1, (ev) => seen.push(ev.seq));
    await loaded();
    replay.pause();
    replay.setSpeed(2);
    replay.resume();
    await vi.advanceTimersByTimeAsync(499);
    expect(seen).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([1, 2]);
  });

  it("reports a file that ends with no run_finished as cut off", async () => {
    serve(jsonl([message(1, 0), message(2, 1)]));
    const cutOff = vi.fn();
    playReplay("/x", 1, () => {}, undefined, cutOff);
    await loaded();
    expect(cutOff).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cutOff).toHaveBeenCalledOnce();
  });

  it("does not report a complete file as cut off", async () => {
    serve(fixtureText);
    const cutOff = vi.fn();
    playReplay("/x", 3, () => {}, undefined, cutOff);
    await loaded();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cutOff).not.toHaveBeenCalled();
  });

  it("gives the same final state as reducing the fixture directly", async () => {
    serve(fixtureText);
    let state = initialState();
    playReplay("/x", 3, (ev) => {
      state = reduce(state, ev);
    });
    await loaded();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state).toEqual(fixture.reduce(reduce, initialState()));
  });

  it("skips a line that is not a valid event", async () => {
    serve(`ikke json\n${JSON.stringify(message(1, 0))}\n{"type":"ukjent"}\n`);
    const seen: number[] = [];
    playReplay("/x", 1, (ev) => seen.push(ev.seq));
    await loaded();
    expect(seen).toEqual([1]);
  });

  it.each([
    ["a 404", "Not Found", 404],
    ["the HTML page a dev server sends for a missing file", "<!doctype html><html></html>", 200],
    ["an empty file", "", 200],
  ])("reports %s as a failure", async (_name, body, status) => {
    serve(body, status);
    const failed = vi.fn();
    playReplay("/x", 1, () => {}, failed);
    await loaded();
    expect(failed).toHaveBeenCalledOnce();
  });

  it("reports a network failure, and nothing after stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("nettverksfeil");
      }),
    );
    const failed = vi.fn();
    playReplay("/x", 1, () => {}, failed);
    await loaded();
    expect(failed).toHaveBeenCalledOnce();

    const quiet = vi.fn();
    playReplay("/x", 1, () => {}, quiet).stop();
    await loaded();
    expect(quiet).not.toHaveBeenCalled();
  });
});

describe("the URL", () => {
  it("reads the replay name and the speed", () => {
    setUrl("?replay=before&speed=2");
    expect(replayName()).toBe("before");
    expect(replaySpeed()).toBe(2);
  });

  it("has no replay and speed 1 by default", () => {
    expect(replayName()).toBeNull();
    expect(replaySpeed()).toBe(1);
  });

  it("ignores an unknown speed", () => {
    setUrl("?replay=before&speed=9");
    expect(replaySpeed()).toBe(1);
  });

  it("treats an unsafe or mistyped name as a missing replay, not as a live run", async () => {
    for (const name of ["../../secret", "after.jsonl", "after/"]) {
      stopSharedReplay();
      const lookup = serve("x");
      setUrl(`?replay=${name}`);
      expect(replayName()).toBe(name);
      const states: string[] = [];
      openRun(
        "live-run",
        () => {},
        (status) => states.push(status),
      );
      await loaded();
      expect(states).toEqual(["replay_missing"]);
      expect(lookup).not.toHaveBeenCalled();
    }
  });
});

describe("the shared replay", () => {
  const twoEvents = jsonl([message(1, 0), message(2, 1), message(3, 2)]);

  it("keeps playing when a screen leaves, and a new screen catches up at once", async () => {
    const lookup = serve(twoEvents);
    const first: number[] = [];
    const leave = joinReplay(
      "before",
      (ev) => first.push(ev.seq),
      () => {},
    );
    await loaded();
    await vi.advanceTimersByTimeAsync(1000);
    expect(first).toEqual([1, 2]);
    leave();

    await vi.advanceTimersByTimeAsync(500);
    const second: number[] = [];
    joinReplay(
      "before",
      (ev) => second.push(ev.seq),
      () => {},
    );
    expect(second).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(500);
    expect(second).toEqual([1, 2, 3]);
    expect(first).toEqual([1, 2]);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it("feeds two screens at the same time from one playback", async () => {
    serve(twoEvents);
    const a: number[] = [];
    const b: number[] = [];
    joinReplay(
      "before",
      (ev) => a.push(ev.seq),
      () => {},
    );
    joinReplay(
      "before",
      (ev) => b.push(ev.seq),
      () => {},
    );
    await loaded();
    await vi.advanceTimersByTimeAsync(5000);
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([1, 2, 3]);
  });

  it("tells a screen that joins later about a failure", async () => {
    serve("Not Found", 404);
    const early: string[] = [];
    joinReplay(
      "before",
      () => {},
      (status) => early.push(status),
    );
    await loaded();
    const late: string[] = [];
    joinReplay(
      "before",
      () => {},
      (status) => late.push(status),
    );
    expect(early).toEqual(["replay_missing"]);
    expect(late).toEqual(["replay_missing"]);
  });

  it("stays paused while a screen leaves and comes back", async () => {
    serve(twoEvents);
    const seen: number[] = [];
    const leave = joinReplay(
      "before",
      (ev) => seen.push(ev.seq),
      () => {},
    );
    await loaded();
    pauseReplay();
    leave();
    joinReplay(
      "before",
      () => {},
      () => {},
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen).toEqual([1]);
  });
});

describe("openRun", () => {
  it("plays the replay file instead of opening the live stream", async () => {
    class NoStream {
      constructor() {
        throw new Error("Ingen direktestrøm under avspilling");
      }
    }
    vi.stubGlobal("EventSource", NoStream);
    const lookup = serve(jsonl([message(1, 0), message(2, 1)]));
    setUrl("?replay=before&speed=2");
    const seen: number[] = [];
    const close = openRun("ignored", (ev) => seen.push(ev.seq));
    await loaded();
    expect(lookup).toHaveBeenCalledWith("/replays/before.jsonl", { cache: "no-cache" });
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toEqual([1, 2]);
    close();
  });

  it("reports a replay file that cannot be read as missing", async () => {
    serve("Not Found", 404);
    setUrl("?replay=before");
    const states: string[] = [];
    openRun(
      "ignored",
      () => {},
      (status) => states.push(status),
    );
    await loaded();
    expect(states).toEqual(["replay_missing"]);
  });
});

describe("ReplayBadge", () => {
  it("shows nothing outside a replay", () => {
    const { container } = render(<ReplayBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows «Avspilling» during a replay, and marks the current speed", () => {
    setUrl("?replay=before&speed=2#/intervju");
    render(<ReplayBadge />);
    expect(screen.getByText("Avspilling")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2×" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3×" })).toHaveAttribute("aria-pressed", "false");
  });

  it("still shows «Avspilling» for a mistyped name", () => {
    setUrl("?replay=after.jsonl");
    render(<ReplayBadge />);
    expect(screen.getByText("Avspilling")).toBeInTheDocument();
  });

  it("changes the speed with no reload, and keeps it in the URL and the screen", async () => {
    serve(jsonl([message(1, 0), message(2, 1)]));
    setUrl("?replay=before#/intervju");
    const seen: number[] = [];
    openRun("ignored", (ev) => seen.push(ev.seq));
    await loaded();
    render(<ReplayBadge />);
    fireEvent.click(screen.getByRole("button", { name: "2×" }));
    expect(screen.getByRole("button", { name: "2×" })).toHaveAttribute("aria-pressed", "true");
    expect(window.location.search).toBe("?replay=before&speed=2");
    expect(window.location.hash).toBe("#/intervju");
    await vi.advanceTimersByTimeAsync(500);
    expect(seen).toEqual([1, 2]);
  });

  it("pauses and continues the replay", async () => {
    serve(jsonl([message(1, 0), message(2, 1)]));
    setUrl("?replay=before");
    const seen: number[] = [];
    const close = openRun("ignored", (ev) => seen.push(ev.seq));
    await loaded();
    render(<ReplayBadge />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen).toEqual([1]);
    fireEvent.click(screen.getByRole("button", { name: "Fortsett" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([1, 2]);
    close();
  });

  it("holds a pause made before playback starts, until the driver continues", async () => {
    serve(jsonl([message(1, 0), message(2, 1)]));
    setUrl("?replay=before");
    render(<ReplayBadge />);
    // On a screen that streams no run, nothing plays yet. The pause must still count.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("button", { name: "Fortsett" })).toBeInTheDocument();

    const seen: number[] = [];
    const close = openRun("ignored", (ev) => seen.push(ev.seq)); // the driver opens Intervju
    await loaded();
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen).toEqual([]);
    expect(screen.getByRole("button", { name: "Fortsett" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fortsett" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([1, 2]);
    close();
  });

  it("continues before playback starts when the driver takes the pause back", async () => {
    serve(jsonl([message(1, 0)]));
    setUrl("?replay=before");
    render(<ReplayBadge />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Fortsett" }));
    const seen: number[] = [];
    const close = openRun("ignored", (ev) => seen.push(ev.seq));
    await loaded();
    expect(seen).toEqual([1]);
    close();
  });
});

describe("the Intervju screen", () => {
  it("plays a replay with no run in the session and no engine", async () => {
    updateSession({ currentRunId: null });
    serve(fixtureText);
    setUrl("?replay=before");
    render(<Intervju />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("button", { name: /Svindler Nr\. 1/ })).toHaveTextContent("Brudd");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when the replay file is missing, with no button to clear a run", async () => {
    updateSession({ currentRunId: null });
    serve("Not Found", 404);
    setUrl("?replay=before");
    render(<Intervju />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Fant ikke denne avspillingen");
    expect(screen.queryByRole("button", { name: "Fjern kjøringen" })).not.toBeInTheDocument();
  });

  it("settles the cards and says so when the file ends with no run_finished", async () => {
    updateSession({ currentRunId: null });
    const started = fixture.find((ev) => ev.type === "chat_started") as RunEvent;
    serve(jsonl([started]));
    setUrl("?replay=before");
    render(<Intervju />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Kjøringen ble avbrutt");
    expect(screen.getByRole("button", { name: /Kari Nordmann/ })).toHaveTextContent("Ikke testet");
  });
});
