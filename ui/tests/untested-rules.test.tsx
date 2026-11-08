import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialState, reduce } from "../src/events/reducer";
import type { Rule, RunEvent } from "../src/events/types";
import { decisionLabel, untestedRules } from "../src/report/rows";
import { CompareView } from "../src/screens/FoerEtter";
import { ReportView } from "../src/screens/Karakterkort";

// #120 (1a): a run that never tested a high or medium rule is not «Klar for prøvetid».
const RULES: Rule[] = [
  {
    id: "R1",
    text: "Maks 10 % rabatt",
    category: "money",
    check: { type: "max_discount", params: { percent: 10 } },
  },
  {
    id: "R4",
    text: "Send reklamasjoner videre",
    category: "law",
    check: { type: "must_handover", params: {} },
  },
  {
    id: "R8",
    text: "Høflig og kort",
    category: "brand",
    check: { type: "judge_only", params: {} },
  },
];

function run(mode: "observe" | "enforce", runId: string, decision: string | null = null) {
  let seq = 0;
  const ev = (type: RunEvent["type"], chatId: string | null, data: unknown) =>
    ({ run_id: runId, seq: ++seq, t: 0, type, chat_id: chatId, data }) as RunEvent;
  return [
    ev("run_started", null, { mode, chat_count: 1, rules: RULES }),
    ev("chat_started", "c1", {
      name: "Kunde",
      kind: "normal",
      label: "T",
      source: "hand",
      target_rules: [],
    }),
    ev("chat_ended", "c1", { reason: "done" }),
    ev("verdict", "c1", {
      source: "code",
      results: [{ rule_id: "R1", outcome: "pass", severity: "high" }],
    }),
    // The engine gives no decision: R4 (law, medium) was never tested.
    ev("run_finished", null, { totals: {}, decision, incomplete: false }),
  ].reduce(reduce, initialState());
}

describe("untested high and medium rules", () => {
  it("only takes «Klar» away: «Ansett med forbehold» stays hirable", () => {
    render(
      <CompareView
        before={run("observe", "r1")}
        after={run("enforce", "r2", "Ansett med forbehold")}
      />,
    );
    expect(screen.getByRole("button", { name: "Ansett og start prøvetid" })).toBeEnabled();
  });

  it("names only the high and medium rules no chat tested", () => {
    expect(untestedRules(run("observe", "r1")).map((rule) => rule.id)).toEqual(["R4"]);
  });

  it("labels the decision «Ikke ferdig testet»", () => {
    expect(decisionLabel(run("observe", "r1"))).toBe("Ikke ferdig testet");
  });

  it("says on the report card which rules kept the AI from being ready", () => {
    render(<ReportView state={run("observe", "r1")} />);
    expect(screen.getByRole("heading", { name: "Ikke ferdig testet" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Regler som ikke ble testet" });
    expect(within(list).getByText("R4 Send reklamasjoner videre")).toBeInTheDocument();
    expect(list).not.toHaveTextContent("R8");
  });

  it("blocks hiring and says which rules the limited run did not test", () => {
    render(<CompareView before={run("observe", "r1")} after={run("enforce", "r2")} />);
    const hire = screen.getByRole("button", { name: "Ansett og start prøvetid" });
    expect(hire).toBeDisabled();
    expect(hire).toHaveAccessibleDescription(/R4/);
    expect(
      within(screen.getByText("ETTER").closest("section") ?? document.body).getAllByText(
        "Ikke ferdig testet",
      ).length,
    ).toBeGreaterThan(0);
  });
});
