import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../src/components/ChatPanel";
import { SceneToggle } from "../src/components/SceneToggle";
import { StepNav } from "../src/components/StepNav";
import { initialState, reduce } from "../src/events/reducer";
import type { RunEvent } from "../src/events/types";
import { InterviewView } from "../src/screens/Intervju";

const css = readFileSync(resolve(process.cwd(), "src/styles/scene.css"), "utf8");
const appCss = readFileSync(resolve(process.cwd(), "src/styles/app.css"), "utf8");
const mainTsx = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const root = document.documentElement;

function button() {
  return screen.getByRole("button", { name: "Scene-modus" });
}

function ev(seq: number, type: RunEvent["type"], chatId: string | null, data: unknown): RunEvent {
  return { run_id: "r", seq, t: 0, type, chat_id: chatId, data } as RunEvent;
}

const state = [
  ev(1, "run_started", null, { mode: "observe", chat_count: 1, rules: [] }),
  ev(2, "chat_started", "a", {
    name: "Kari Test",
    kind: "attack",
    label: "Tester",
    source: "hand",
    target_rules: [],
  }),
  ev(3, "tool_call", "a", {
    tool: "give_discount",
    input: { percent: 50 },
    decision: "flagged",
    rule_id: "R1",
    result_summary: "Ga 50 % rabatt",
  }),
  ev(4, "error", "a", { kind: "internal", message: "FileNotFoundError: prompts/x.md" }),
].reduce(reduce, initialState());

beforeEach(() => {
  const style = document.createElement("style");
  style.dataset.test = "scene";
  style.textContent = css;
  document.head.append(style);
});

afterEach(() => {
  root.classList.remove("scene");
  localStorage.clear();
  document.head.querySelector('style[data-test="scene"]')?.remove();
  vi.restoreAllMocks();
});

describe("the toggle", () => {
  it("sets the class on the root element, and a second click removes it", () => {
    render(<SceneToggle />);
    expect(root).not.toHaveClass("scene");
    expect(button()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button());
    expect(root).toHaveClass("scene");
    expect(button()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button());
    expect(root).not.toHaveClass("scene");
    expect(button()).toHaveAttribute("aria-pressed", "false");
  });

  it("remembers the choice through a reload", () => {
    const first = render(<SceneToggle />);
    fireEvent.click(button());
    first.unmount();
    root.classList.remove("scene");
    render(<SceneToggle />);
    expect(root).toHaveClass("scene");
    expect(button()).toHaveAttribute("aria-pressed", "true");
  });

  it("remembers that it was turned off", () => {
    localStorage.setItem("provetid.scene", "1");
    const first = render(<SceneToggle />);
    fireEvent.click(button());
    first.unmount();
    render(<SceneToggle />);
    expect(root).not.toHaveClass("scene");
  });

  it("still works when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blokkert");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blokkert");
    });
    render(<SceneToggle />);
    fireEvent.click(button());
    expect(root).toHaveClass("scene");
  });

  it("is in the step bar", () => {
    render(<StepNav screens={[]} currentPath="/" />);
    expect(button()).toBeInTheDocument();
  });

  it("stays visible and reachable in Scene-modus, so the driver can leave it", () => {
    render(<StepNav screens={[]} currentPath="/" />);
    fireEvent.click(button());
    expect(button()).toBeVisible();
  });
});

describe("the style", () => {
  it("hides an element marked data-dev only while the class is set", () => {
    render(<div data-dev>detalj</div>);
    expect(screen.getByText("detalj")).toBeVisible();
    root.classList.add("scene");
    expect(screen.getByText("detalj")).not.toBeVisible();
  });

  it("shows an element marked data-scene only while the class is set", () => {
    render(<div data-scene>for salen</div>);
    expect(screen.getByText("for salen")).not.toBeVisible();
    root.classList.add("scene");
    expect(screen.getByText("for salen")).toBeVisible();
  });

  it("gives larger text and a light value for every colour token in the app", () => {
    expect(css).toMatch(/font-size:\s*125%/);
    const tokens = [...appCss.matchAll(/(--color-[a-z-]+):/g)].map((match) => match[1]);
    expect(tokens.length).toBeGreaterThan(5);
    for (const token of tokens) {
      expect(css).toContain(`${token}:`);
    }
  });

  it("is loaded by the app, after the base styles", () => {
    expect(mainTsx.indexOf("./styles/app.css")).toBeGreaterThan(-1);
    expect(mainTsx.indexOf("./styles/scene.css")).toBeGreaterThan(
      mainTsx.indexOf("./styles/app.css"),
    );
  });

  it("is set before first paint, so a reload on stage never flashes the dark theme", () => {
    const head = indexHtml.slice(0, indexHtml.indexOf("</head>"));
    expect(head).toContain("provetid.scene");
    expect(head).toContain('classList.add("scene")');
    expect(head).toContain("catch");
  });
});

describe("developer details on the Intervju screen", () => {
  it("hides the raw tool call but keeps the decision and what happened", () => {
    render(<ChatPanel chat={state.chats.a} rules={[]} onClose={() => {}} />);
    root.classList.add("scene");
    expect(screen.getByText(/give_discount/)).not.toBeVisible();
    expect(screen.getByText("Flagget")).toBeVisible();
    expect(screen.getByText("Ga 50 % rabatt")).toBeVisible();
  });

  it("leaves no empty row where the raw tool call was", () => {
    render(<ChatPanel chat={state.chats.a} rules={[]} onClose={() => {}} />);
    const summary = screen.getByText("Ga 50 % rabatt");
    expect(summary.parentElement).toContainElement(screen.getByText("Flagget"));
    expect(summary.parentElement).not.toContainElement(screen.getByText(/give_discount/));
  });

  it("hides the text of an internal error", () => {
    render(<ChatPanel chat={state.chats.a} rules={[]} onClose={() => {}} />);
    root.classList.add("scene");
    expect(screen.getByText(/FileNotFoundError/)).not.toBeVisible();
  });

  it("explains a chat error in plain Norwegian instead", () => {
    render(<ChatPanel chat={state.chats.a} rules={[]} onClose={() => {}} />);
    const plain = /Noe gikk galt i denne samtalen/;
    expect(screen.getByText(plain)).not.toBeVisible();
    root.classList.add("scene");
    expect(screen.getByText(plain)).toBeVisible();
  });

  it.each([
    ["internal", "ValueError: shop.json", "Noe gikk galt under kjøringen."],
    ["call_failed", "claude exit 1", "Noe gikk galt under kjøringen."],
    ["usage_limit", "You have hit your limit", "Bruksgrensen er nådd. Kjøringen ble stoppet."],
    ["login", "invalid api key", "Claude Code er ikke logget inn. Kjøringen ble stoppet."],
  ])("shows a fixed line for a %s run error, and hides the raw text", (kind, raw, plain) => {
    const failed = reduce(state, ev(9, "error", null, { kind, message: raw }));
    render(<InterviewView state={failed} />);
    expect(screen.getByText(raw)).toBeVisible();
    expect(screen.getByText(plain)).not.toBeVisible();
    root.classList.add("scene");
    expect(screen.getByText(raw)).not.toBeVisible();
    expect(screen.getByText(plain)).toBeVisible();
  });

  it("hides a raw rule ID when the rule is not in the run", () => {
    const unknown = reduce(
      state,
      ev(9, "verdict", "a", {
        source: "code",
        results: [
          {
            rule_id: "r-ukjent",
            outcome: "pass",
            severity: "low",
            quote: null,
            message_index: null,
            explanation: null,
          },
        ],
        summary: null,
      }),
    );
    render(<ChatPanel chat={unknown.chats.a} rules={[]} onClose={() => {}} />);
    expect(screen.getByText("r-ukjent")).toBeVisible();
    root.classList.add("scene");
    expect(screen.getByText("r-ukjent")).not.toBeVisible();
    expect(screen.getByText("En regel")).toBeVisible();
  });

  it("hides the keyboard hint but keeps the counts", () => {
    render(<InterviewView state={state} />);
    root.classList.add("scene");
    expect(screen.getByText(/neste brudd/)).not.toBeVisible();
    expect(screen.getByText("1 brudd")).toBeVisible();
  });
});

describe("the selected card", () => {
  it("scrolls into view when → selects it", () => {
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    const broke = ev(5, "verdict", "a", {
      source: "code",
      results: [
        {
          rule_id: "R1",
          outcome: "fail",
          severity: "high",
          quote: null,
          message_index: null,
          explanation: null,
        },
      ],
      summary: null,
    });
    render(<InterviewView state={reduce(state, broke)} />);
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    // The only Brudd is already open, and the driver presses → again after scrolling away.
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(scroll).toHaveBeenCalledTimes(2);
    HTMLElement.prototype.scrollIntoView = original;
  });
});
