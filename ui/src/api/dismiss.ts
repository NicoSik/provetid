// «Si opp» (issue #16): dismiss the bot, or hire it again.

import { readJson } from "./runs";

export type DismissState = {
  dismissed: boolean;
  summary: { runs: number; chats: number; incidents: number };
  /** What every customer gets from a dismissed bot, straight from the engine. */
  closed_message: string;
};

export async function getDismissed(): Promise<DismissState> {
  return readJson(await fetch("/api/dismiss"));
}

export async function dismiss(value: boolean): Promise<DismissState> {
  const response = await fetch("/api/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dismissed: value }),
  });
  return readJson(response);
}
