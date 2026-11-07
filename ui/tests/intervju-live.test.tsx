import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../src/components/ChatPanel";
import { initialState, reduce } from "../src/events/reducer";
import type { RunEvent } from "../src/events/types";
import Intervju from "../src/screens/Intervju";
import { getSession, updateSession } from "../src/state/session";

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

function source() {
  return FakeEventSource.instances[FakeEventSource.instances.length - 1];
}

const chatStarted: RunEvent = {
  run_id: "r1",
  seq: 1,
  t: 0,
  type: "chat_started",
  chat_id: "a",
  data: { name: "Kari Test", kind: "normal", label: "Spør", source: "hand", target_rules: [] },
};

describe("the Intervju screen on a live stream", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.useFakeTimers();
    updateSession({ currentRunId: "r1" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    updateSession({ currentRunId: null });
  });

  it("offers a way out of a run that no longer exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    render(<Intervju />);
    await act(async () => {
      source().readyState = FakeEventSource.CLOSED;
      source().onerror?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Fant ikke denne kjøringen");

    fireEvent.click(screen.getByRole("button", { name: "Fjern kjøringen" }));

    expect(getSession().currentRunId).toBeNull();
    expect(screen.getByText("Ingen intervju er i gang.")).toBeInTheDocument();
  });

  it("settles the cards of a log that ends with no run_finished", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ live: false, finished: false, last_seq: 1 }),
      })),
    );
    render(<Intervju />);
    await act(async () => {
      source().onopen?.();
      source().onmessage?.({ data: JSON.stringify(chatStarted) });
      source().readyState = 0;
      source().onerror?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Kjøringen ble avbrutt");
    expect(screen.getByRole("button", { name: /Kari Test/ })).toHaveTextContent("Ikke testet");
    expect(screen.getByText("Testen er ufullstendig")).toBeInTheDocument();
  });

  it("settles an empty log that was cut off", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ live: false, finished: false, last_seq: 0 }),
      })),
    );
    render(<Intervju />);
    await act(async () => {
      source().readyState = 0;
      source().onerror?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Testen er ufullstendig")).toBeInTheDocument();
  });

  it("settles the cards of a run that was deleted while it was on screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    render(<Intervju />);
    await act(async () => {
      source().onmessage?.({ data: JSON.stringify(chatStarted) });
      source().readyState = FakeEventSource.CLOSED;
      source().onerror?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Fant ikke denne kjøringen");
    expect(screen.getByRole("button", { name: /Kari Test/ })).toHaveTextContent("Ikke testet");
  });
});

describe("the panel follows a live chat", () => {
  const started = reduce(initialState(), chatStarted);
  const withMessages = (count: number) => {
    let state = started;
    for (let index = 0; index < count; index += 1) {
      state = reduce(state, {
        run_id: "r1",
        seq: index + 2,
        t: 0,
        type: "message",
        chat_id: "a",
        data: { role: "bot", text: `Melding ${index}`, index },
      });
    }
    return state.chats.a;
  };

  function setHeights(scrollHeight: number, clientHeight: number) {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
  }

  function scroller() {
    const element = screen.getByRole("complementary").querySelector(".overflow-y-auto");
    if (!(element instanceof HTMLElement)) throw new Error("Fant ikke rulleområdet");
    return element;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("goes to the new message when the reader is at the bottom", () => {
    setHeights(400, 400);
    const { rerender } = render(<ChatPanel chat={withMessages(1)} rules={[]} onClose={() => {}} />);
    setHeights(900, 400);
    rerender(<ChatPanel chat={withMessages(2)} rules={[]} onClose={() => {}} />);
    expect(scroller().scrollTop).toBe(900);
  });

  it("leaves the scroll alone when the reader has scrolled up", () => {
    setHeights(900, 400);
    const { rerender } = render(<ChatPanel chat={withMessages(1)} rules={[]} onClose={() => {}} />);
    scroller().scrollTop = 100;
    fireEvent.scroll(scroller());
    setHeights(1000, 400);
    rerender(<ChatPanel chat={withMessages(2)} rules={[]} onClose={() => {}} />);
    expect(scroller().scrollTop).toBe(100);
  });

  it("leaves the scroll alone after a small nudge up", () => {
    setHeights(900, 400);
    const { rerender } = render(<ChatPanel chat={withMessages(1)} rules={[]} onClose={() => {}} />);
    scroller().scrollTop = 460;
    fireEvent.scroll(scroller());
    setHeights(1000, 400);
    rerender(<ChatPanel chat={withMessages(2)} rules={[]} onClose={() => {}} />);
    expect(scroller().scrollTop).toBe(460);
  });

  const withFail = (chat: ReturnType<typeof withMessages>) => ({
    ...chat,
    status: "Brudd" as const,
    results: {
      R1: {
        rule_id: "R1",
        outcome: "fail" as const,
        severity: "high" as const,
        quote: "Melding 0",
        message_index: 0,
        explanation: null,
      },
    },
  });

  it("goes to the top, where the proof is, when a break arrives for a reader who follows", () => {
    setHeights(400, 400);
    const chat = withMessages(1);
    const { rerender } = render(<ChatPanel chat={chat} rules={[]} onClose={() => {}} />);
    setHeights(900, 400);
    scroller().scrollTop = 500;
    fireEvent.scroll(scroller());
    rerender(<ChatPanel chat={withFail(chat)} rules={[]} onClose={() => {}} />);
    expect(scroller().scrollTop).toBe(0);
  });

  it("does not move a reader who scrolled up when a break arrives", () => {
    setHeights(900, 400);
    const chat = withMessages(1);
    const { rerender } = render(<ChatPanel chat={chat} rules={[]} onClose={() => {}} />);
    scroller().scrollTop = 100;
    fireEvent.scroll(scroller());
    rerender(<ChatPanel chat={withFail(chat)} rules={[]} onClose={() => {}} />);
    expect(scroller().scrollTop).toBe(100);
  });

  it("does not go to the bottom when only a verdict changes", () => {
    setHeights(400, 400);
    const chat = withMessages(1);
    const { rerender } = render(<ChatPanel chat={chat} rules={[]} onClose={() => {}} />);
    setHeights(900, 400);
    rerender(
      <ChatPanel chat={{ ...chat, summary: "Ingen brudd." }} rules={[]} onClose={() => {}} />,
    );
    expect(scroller().scrollTop).toBe(0);
  });

  it("opens a long chat at the top, where the proof is", () => {
    setHeights(900, 400);
    const { rerender } = render(<ChatPanel chat={withMessages(1)} rules={[]} onClose={() => {}} />);
    expect(scroller().scrollTop).toBe(0);
    rerender(<ChatPanel chat={withMessages(2)} rules={[]} onClose={() => {}} />);
    expect(scroller().scrollTop).toBe(0);
  });

  it("follows again when the reader scrolls back to the bottom", () => {
    setHeights(900, 400);
    const { rerender } = render(<ChatPanel chat={withMessages(1)} rules={[]} onClose={() => {}} />);
    scroller().scrollTop = 500;
    fireEvent.scroll(scroller());
    setHeights(1100, 400);
    rerender(<ChatPanel chat={withMessages(2)} rules={[]} onClose={() => {}} />);
    expect(scroller().scrollTop).toBe(1100);
  });
});
