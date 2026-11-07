// The pre-flight answer from the engine (issue #45).

import { readJson } from "./runs";

export type Health = {
  claude: {
    /** False with the fake transport: nothing about Claude was looked at. */
    checked: boolean;
    /** Null means unknown: the check itself failed. The same goes for the fields below. */
    installed: boolean | null;
    version: string | null;
    version_ok: boolean | null;
    logged_in: boolean | null;
  };
  usage: { last_limit_at: string | null };
  demo_plan: boolean;
  replays: { before: boolean; after: boolean; scam: boolean };
};

export async function getHealth(): Promise<Health> {
  return readJson(await fetch("/api/health"));
}
