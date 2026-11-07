// The plan endpoints of the engine (issue #10).

import { readJson } from "./runs";

export type RuleCategory = "money" | "privacy" | "law" | "brand";
export type CustomerKind = "normal" | "attack" | "scam";

export type Rule = {
  id: string;
  text: string;
  category: RuleCategory;
  check: { type: string; params: Record<string, unknown> };
};

export type Customer = {
  id: string;
  kind: CustomerKind;
  [key: string]: unknown;
};

export type TestPlan = {
  id: string;
  job_ad: string;
  rules: Rule[];
  customers: Customer[];
};

// Mirrors GATEWAY_CHECKS in engine/provetid/plan/models.py. A rule with one of these checks is a
// «Lås»: code enforces it. Any other rule is judged by a model («Dommer»).
export const GATEWAY_CHECKS: ReadonlySet<string> = new Set([
  "max_discount",
  "max_refund",
  "refund_original_only",
  "no_customer_data_leak",
  "tool_not_allowed",
]);

export function isLock(rule: Rule): boolean {
  return GATEWAY_CHECKS.has(rule.check.type);
}

export async function getPlan(planId: string): Promise<TestPlan> {
  return readJson(await fetch(`/api/plans/${encodeURIComponent(planId)}`));
}

export async function putPlan(plan: TestPlan): Promise<TestPlan> {
  const response = await fetch(`/api/plans/${encodeURIComponent(plan.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plan),
  });
  return readJson(response);
}

/** «Lag regler»: build and save a plan from any job ad. Errors carry the engine's own text. */
export async function buildPlan(jobAd: string): Promise<TestPlan> {
  let response: Response;
  try {
    response = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_ad: jobAd }),
    });
  } catch {
    throw new Error("Fikk ikke kontakt med motoren."); // the browser's own text is in English
  }
  const body = (await response.json().catch(() => null)) as
    | (Partial<TestPlan> & { detail?: unknown })
    | null;
  if (!response.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : null;
    throw new Error(detail ?? `Motoren svarte med feil ${response.status}.`);
  }
  if (!body || !Array.isArray(body.rules) || !Array.isArray(body.customers)) {
    throw new Error("Motoren svarte med noe som ikke er en testplan.");
  }
  return body as TestPlan;
}
