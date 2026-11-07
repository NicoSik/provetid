// The run endpoints of the engine (issue #7).

import type { Mode, RunEvent } from "../events/types";

export type StartRunBody = {
  plan_id: string;
  mode: Mode;
  limits?: Record<string, unknown> | null;
  extra_instructions?: string[];
};

export type RunSummary = {
  run_id: string;
  plan_id: string;
  mode: Mode;
  finished: boolean;
};

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Motoren svarte med feil ${response.status}.`);
  }
  return (await response.json()) as T;
}

export async function startRun(body: StartRunBody): Promise<{ run_id: string }> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(response);
}

export async function getRun(runId: string): Promise<RunEvent[]> {
  return readJson(await fetch(`/api/runs/${encodeURIComponent(runId)}`));
}

export async function listRuns(): Promise<RunSummary[]> {
  return readJson(await fetch("/api/runs"));
}

const STATUS_TIMEOUT_MS = 3000;

export type RunStatus = {
  live: boolean;
  finished: boolean;
  last_seq: number;
};

/** What the engine knows about a run: "missing" if it is gone, `null` if the engine cannot answer. */
export async function getRunStatus(runId: string): Promise<RunStatus | "missing" | null> {
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/status`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (response.status === 404) return "missing";
    return await readJson<RunStatus>(response);
  } catch {
    return null;
  }
}
