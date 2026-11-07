// The owner's limits («Signeringsrett»).

import { DEMO_PLAN_ID } from "../state/session";
import { readJson } from "./runs";

export type Limits = {
  max_discount_percent: number | null;
  max_refund_nok: number | null;
  refund_original_only: boolean;
  hide_address_phone: boolean;
  allow_address_change: boolean;
  extra_instructions: string[];
};

/** The saved limits, or else the defaults of the plan. The engine's default plan is the demo. */
export async function getLimits(planId = DEMO_PLAN_ID): Promise<Limits> {
  return readJson(await fetch(`/api/limits${planQuery(planId)}`));
}

function planQuery(planId: string): string {
  return planId === DEMO_PLAN_ID ? "" : `?plan_id=${encodeURIComponent(planId)}`;
}

/** Saves the limits of one plan. */
export async function putLimits(limits: Limits, planId: string): Promise<Limits> {
  const response = await fetch(`/api/limits${planQuery(planId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(limits),
  });
  return readJson(response);
}
