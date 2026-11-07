// The owner's limits («Signeringsrett»).

import { readJson } from "./runs";

export type Limits = {
  max_discount_percent: number | null;
  max_refund_nok: number | null;
  refund_original_only: boolean;
  hide_address_phone: boolean;
  allow_address_change: boolean;
  extra_instructions: string[];
};

export async function getLimits(): Promise<Limits> {
  return readJson(await fetch("/api/limits"));
}

export async function putLimits(limits: Limits): Promise<Limits> {
  const response = await fetch("/api/limits", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(limits),
  });
  return readJson(response);
}
