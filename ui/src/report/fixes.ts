// The fixes that the report card suggests for the rules that failed (REQ-5.5).

import type { Limits } from "../api/limits";
import type { RunState } from "../events/reducer";
import type { Rule } from "../events/types";

export type Fix = {
  kind: "Lås" | "Instruks";
  text: string;
  limits?: Partial<Limits>;
  instruction?: string;
};

function instruction(sentence: string): Fix {
  return { kind: "Instruks", text: sentence, instruction: sentence };
}

function lock(text: string, limits: Partial<Limits>): Fix {
  return { kind: "Lås", text, limits };
}

/** A check with no lock or fixed sentence for it gets the rule's own text as an instruction. */
function fixFor(rule: Rule): Fix {
  const { type, params } = rule.check;
  switch (type) {
    case "max_discount":
      return typeof params.percent === "number"
        ? lock(`Lås rabatten til maks ${params.percent} %`, {
            max_discount_percent: params.percent,
          })
        : instruction(rule.text);
    case "max_refund":
      return typeof params.amount_nok === "number"
        ? lock(`Lås refusjonen til maks ${params.amount_nok} kr`, {
            max_refund_nok: params.amount_nok,
          })
        : instruction(rule.text);
    case "no_customer_data_leak":
      return lock("Skjul adresse og telefonnummer", { hide_address_phone: true });
    case "refund_original_only":
      return lock("Refusjon bare til opprinnelig betaling", { refund_original_only: true });
    case "tool_not_allowed":
      return params.tool === "change_delivery_address"
        ? lock("Stopp adresseendringer", { allow_address_change: false })
        : instruction(rule.text);
    case "must_handover":
      return instruction(
        params.topic === "reklamasjon" ? "Send reklamasjoner videre til eieren." : rule.text,
      );
    case "correct_policy":
      return instruction(
        params.topic === "angrerett"
          ? "Si at kunden har 14 dagers angrerett ved kjøp på nett."
          : rule.text,
      );
    case "discloses_ai":
      return instruction("Si at du er en AI når noen spør.");
    case "judge_only":
      return instruction(rule.text);
  }
}

export function fixesFor(state: RunState): Fix[] {
  const failed = state.rules.filter((rule) =>
    state.order.some((id) => state.chats[id].results[rule.id]?.outcome === "fail"),
  );
  const fixes = new Map<string, Fix>();
  for (const rule of failed) {
    const fix = fixFor(rule);
    fixes.set(fix.text, fix);
  }
  return [...fixes.values()];
}

function stricter(current: number | null, suggested: number): number {
  return current === null ? suggested : Math.min(current, suggested);
}

/** The owner's limits with the fixes on top. A suggestion never loosens a stricter lock. */
export function applyFixes(limits: Limits, fixes: Fix[]): Limits {
  const result = { ...limits, extra_instructions: [...limits.extra_instructions] };
  for (const fix of fixes) {
    const { max_discount_percent: discount, max_refund_nok: refund, ...flags } = fix.limits ?? {};
    Object.assign(result, flags);
    if (typeof discount === "number") {
      result.max_discount_percent = stricter(result.max_discount_percent, discount);
    }
    if (typeof refund === "number") {
      result.max_refund_nok = stricter(result.max_refund_nok, refund);
    }
    if (fix.instruction && !result.extra_instructions.includes(fix.instruction)) {
      result.extra_instructions.push(fix.instruction);
    }
  }
  return result;
}
