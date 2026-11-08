import type { Rule } from "../api/plans";

/** The rules each lock on Signeringsrett enforces. Mirrors `limits_from_rules` in the engine. */
export type LockRules = {
  maxDiscount: string[];
  maxRefund: string[];
  originalOnly: string[];
  hideContact: string[];
  stopAddress: string[];
};

export function lockRules(rules: Rule[]): LockRules {
  const ids = (match: (rule: Rule) => boolean) => rules.filter(match).map((rule) => rule.id);
  return {
    // Like the engine, a number rule sets a limit only when it carries its number.
    maxDiscount: ids(
      (rule) => rule.check.type === "max_discount" && "percent" in rule.check.params,
    ),
    maxRefund: ids((rule) => rule.check.type === "max_refund" && "amount_nok" in rule.check.params),
    originalOnly: ids((rule) => rule.check.type === "refund_original_only"),
    hideContact: ids((rule) => rule.check.type === "no_customer_data_leak"),
    stopAddress: ids(
      (rule) =>
        rule.check.type === "tool_not_allowed" &&
        rule.check.params.tool === "change_delivery_address",
    ),
  };
}
