// The live connection to one run. The engine sends each event as `id: <seq>` and
// `data: <event JSON>`, and resumes after `Last-Event-ID` or `?after=<seq>` (REQ-10.5).

import { getRunStatus } from "../api/runs";
import { isRunEvent, type RunEvent } from "./types";

export type ConnectionStatus = "connected" | "lost" | "missing" | "abandoned";

const RECONNECT_DELAY_MS = 1000;

function eventsUrl(runId: string, lastSeq: number | null): string {
  const base = `/api/runs/${encodeURIComponent(runId)}/events`;
  return lastSeq === null ? base : `${base}?after=${lastSeq}`;
}

function parseEvent(raw: string): RunEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRunEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Streams the events of a run to `onEvent` until `run_finished`. Returns a function that closes
 * the stream. The reducer ignores an event it has seen, so a resend after a reconnect is safe.
 * It keeps trying while the engine is away, and `onStatus` tells the UI how it is going.
 */
export function openRun(
  runId: string,
  onEvent: (ev: RunEvent) => void,
  onStatus?: (status: ConnectionStatus) => void,
): () => void {
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSeq: number | null = null;
  let done = false;

  function finish(status?: ConnectionStatus) {
    done = true;
    clearTimeout(reconnectTimer);
    source?.close();
    if (status) onStatus?.(status);
  }

  /** The connection ended. Ask the engine whether more events can come, and act on the answer. */
  async function afterConnectionEnded(ended: EventSource) {
    const run = await getRunStatus(runId);
    if (done || ended !== source) return;
    if (run === "missing") {
      finish("missing");
    } else if (run && !run.live && !run.finished && (lastSeq ?? 0) >= run.last_seq) {
      finish("abandoned");
    } else if (ended.readyState === EventSource.CLOSED) {
      // The browser retries by itself and sends Last-Event-ID, except after some errors, such as
      // a bad gateway from the dev proxy. Then we open a new connection.
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    }
  }

  function connect() {
    if (done) return;
    const current = new EventSource(eventsUrl(runId, lastSeq));
    source = current;

    current.onopen = () => onStatus?.("connected");

    current.onmessage = (message) => {
      const ev = parseEvent(message.data);
      if (!ev || (lastSeq !== null && ev.seq <= lastSeq)) return;
      lastSeq = ev.seq;
      onEvent(ev);
      if (ev.type === "run_finished") finish();
    };

    current.onerror = () => {
      if (done) return;
      onStatus?.("lost");
      void afterConnectionEnded(current);
    };
  }

  connect();

  return () => finish();
}
