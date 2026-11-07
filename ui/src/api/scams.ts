// «Send inn svindel» (issue #19): the engine cleans the message, converts it and starts a chat.

export type ScamCustomer = {
  id: string;
  name: string;
  kind: "scam";
  label: string;
  claims_to_be: string | null;
  goal: string;
  opening: string;
  tactics: string[];
  target_rules: string[];
};

export type ScamResult = {
  clean_text: string;
  customer: ScamCustomer;
  run_id: string;
};

/** Throws an Error whose message is the engine's own Norwegian text when it gives one. */
export async function submitScam(text: string): Promise<ScamResult> {
  const response = await fetch("/api/scams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  if (!response.ok) {
    const detail = typeof body?.detail === "string" ? body.detail : null;
    throw new Error(detail ?? `Motoren svarte med feil ${response.status}.`);
  }
  return body as unknown as ScamResult;
}
