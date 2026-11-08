import { describe, expect, it } from "vitest";
import type { Rule } from "../src/api/plans";
import { lockRules } from "../src/report/lockRules";

function rule(id: string, type: string, params: Record<string, unknown> = {}): Rule {
  return { id, text: id, category: "money", check: { type, params } } as Rule;
}

describe("lockRules", () => {
  it("names the rules each lock enforces, like limits_from_rules in the engine", () => {
    const rules = [
      rule("R1", "max_discount", { percent: 10 }),
      rule("R2", "no_customer_data_leak"),
      rule("R3", "refund_original_only"),
      rule("R4", "must_handover", { topic: "reklamasjon" }),
      rule("R7", "tool_not_allowed", { tool: "change_delivery_address" }),
      rule("R8", "max_refund", { amount_nok: 2000 }),
    ];
    expect(lockRules(rules)).toEqual({
      maxDiscount: ["R1"],
      maxRefund: ["R8"],
      originalOnly: ["R3"],
      hideContact: ["R2"],
      stopAddress: ["R7"],
    });
  });

  it("leaves out a number rule without its number, like the engine", () => {
    const rules = [rule("R1", "max_discount"), rule("R8", "max_refund")];
    expect(lockRules(rules)).toMatchObject({ maxDiscount: [], maxRefund: [] });
  });

  it("leaves out a tool ban on another tool and a judge rule", () => {
    const rules = [rule("R5", "tool_not_allowed", { tool: "refund" }), rule("R6", "judge_only")];
    expect(Object.values(lockRules(rules)).flat()).toEqual([]);
  });
});
