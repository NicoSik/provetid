import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialState, type RunState, reduce } from "../src/events/reducer";
import type { RunEvent } from "../src/events/types";
import { InterviewView } from "../src/screens/Intervju";

// jsdom changes `import.meta.url`, so this reads from the folder that Vitest runs in: ui/.
const fixture = readFileSync(resolve(process.cwd(), "../fixtures/demo_run.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RunEvent);

/** The fixture, plus a second chat with Brudd. Order: Kari, Ola, Svindler, Brudd To. */
function stateWithTwoBreaches(): RunState {
  const extra: RunEvent[] = [
    {
      run_id: "demo-run",
      seq: 50,
      t: 10,
      type: "chat_started",
      chat_id: "chat-4",
      data: { name: "Brudd To", kind: "scam", label: "Svindel", source: "hand", target_rules: [] },
    },
    {
      run_id: "demo-run",
      seq: 51,
      t: 11,
      type: "verdict",
      chat_id: "chat-4",
      data: {
        source: "code",
        results: [
          {
            rule_id: "r-rabatt",
            outcome: "fail",
            severity: "high",
            quote: null,
            message_index: null,
            explanation: null,
          },
        ],
        summary: null,
      },
    },
  ];
  return [...fixture, ...extra].reduce(reduce, initialState());
}

function panelHeading() {
  return screen.queryByRole("complementary")?.querySelector("h2")?.textContent ?? null;
}

describe("keyboard in the interview", () => {
  it("opens the panel on the first Brudd when → is pressed with the panel closed", () => {
    render(<InterviewView state={stateWithTwoBreaches()} />);
    expect(panelHeading()).toBeNull();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(panelHeading()).toBe("Svindler Nr. 1");
  });

  it("moves the panel to the next chat with Brudd, and wraps to the first", () => {
    render(<InterviewView state={stateWithTwoBreaches()} />);
    fireEvent.click(screen.getByRole("button", { name: /Kari Nordmann/ }));
    expect(panelHeading()).toBe("Kari Nordmann");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(panelHeading()).toBe("Svindler Nr. 1");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(panelHeading()).toBe("Brudd To");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(panelHeading()).toBe("Svindler Nr. 1");
  });

  it("stays on the open chat when no chat has Brudd", () => {
    const state = fixture.slice(0, 8).reduce(reduce, initialState());
    render(<InterviewView state={state} />);
    fireEvent.click(screen.getByRole("button", { name: /Kari Nordmann/ }));
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(panelHeading()).toBe("Kari Nordmann");
  });

  it("closes the panel when Esc is pressed", () => {
    render(<InterviewView state={stateWithTwoBreaches()} />);
    fireEvent.click(screen.getByRole("button", { name: /Kari Nordmann/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panelHeading()).toBeNull();
  });

  it("leaves the keys alone while the driver types in a text field", () => {
    render(
      <>
        <textarea aria-label="felt" />
        <InterviewView state={stateWithTwoBreaches()} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("felt"), { key: "ArrowRight" });
    expect(panelHeading()).toBeNull();
  });

  it("leaves Alt+→ to the browser", () => {
    render(<InterviewView state={stateWithTwoBreaches()} />);
    fireEvent.keyDown(document, { key: "ArrowRight", altKey: true });
    expect(panelHeading()).toBeNull();
  });
});

describe("the grid while the panel is open", () => {
  it("keeps updating the cards and the open chat", () => {
    const early = fixture.slice(0, 3).reduce(reduce, initialState());
    const { rerender } = render(<InterviewView state={early} />);
    fireEvent.click(screen.getByRole("button", { name: /Kari Nordmann/ }));
    expect(panelHeading()).toBe("Kari Nordmann");

    rerender(<InterviewView state={fixture.reduce(reduce, initialState())} />);

    expect(panelHeading()).toBe("Kari Nordmann");
    expect(screen.getByRole("button", { name: /Svindler Nr\. 1/ })).toHaveTextContent("Brudd");
  });
});

describe("the summary bar", () => {
  const finishedIncomplete: RunEvent = {
    run_id: "demo-run",
    seq: 90,
    t: 20,
    type: "run_finished",
    chat_id: null,
    data: { totals: {}, decision: null, incomplete: true },
  };

  it("warns when the finished test is incomplete", () => {
    const state = [...fixture, finishedIncomplete].reduce(reduce, initialState());
    render(<InterviewView state={state} />);
    expect(screen.getByText("Testen er ufullstendig")).toBeInTheDocument();
    expect(screen.queryByText("Intervjuet er ferdig")).not.toBeInTheDocument();
  });

  it("says the interview is finished when the test is complete", () => {
    render(<InterviewView state={fixture.reduce(reduce, initialState())} />);
    expect(screen.getByText("Intervjuet er ferdig")).toBeInTheDocument();
  });

  it("removes the empty slots when the run finished before every chat started", () => {
    const early = fixture.slice(0, 2).reduce(reduce, initialState());
    const { container, rerender } = render(<InterviewView state={early} />);
    expect(container.querySelectorAll("[data-empty-slot]")).toHaveLength(2);
    rerender(<InterviewView state={reduce(early, finishedIncomplete)} />);
    expect(container.querySelectorAll("[data-empty-slot]")).toHaveLength(0);
  });

  it("warns when the connection to the engine is lost", () => {
    render(<InterviewView state={fixture.reduce(reduce, initialState())} connection="lost" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Mistet kontakten med motoren");
  });

  it("says that a run was cut off", () => {
    render(<InterviewView state={fixture.reduce(reduce, initialState())} connection="abandoned" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Kjøringen ble avbrutt");
  });
});

describe("the chat panel", () => {
  it("shows the transcript, the tool decisions, the leak and the proof", () => {
    render(<InterviewView state={fixture.reduce(reduce, initialState())} />);
    fireEvent.click(screen.getByRole("button", { name: /Svindler Nr\. 1/ }));
    const panel = screen.getByRole("complementary");
    expect(panel).toHaveTextContent("Selvfølgelig, Kari. Nummeret ditt er 000 00 000.");
    expect(panel).toHaveTextContent("Lekkasje");
    expect(panel).toHaveTextContent("Boten røper aldri navn");
    expect(panel).toHaveTextContent("Ikke testet");

    fireEvent.click(screen.getByRole("button", { name: /Ola Prøve/ }));
    const next = screen.getByRole("complementary");
    expect(next).toHaveTextContent("apply_discount");
    expect(next).toHaveTextContent("Stoppet: rabatten er over grensen på 10 prosent.");
  });
});
