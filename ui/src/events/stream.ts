// The live connection to one run. The engine sends each event as `id: <seq>` and
// `data: <event JSON>`, and resumes after `Last-Event-ID` or `?after=<seq>` (REQ-10.5).

import { isRunEvent, type RunEvent } from "./types";

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
 * It keeps trying while the engine is away, and `onConnection` tells the UI about it.
 */
export function openRun(
  runId: string,
  onEvent: (ev: RunEvent) => void,
  onConnection?: (connected: boolean) => void,
): () => void {
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSeq: number | null = null;

  function connect() {
    const current = new EventSource(eventsUrl(runId, lastSeq));
    source = current;

    current.onopen = () => onConnection?.(true);

    current.onmessage = (message) => {
      const ev = parseEvent(message.data);
      if (!ev) return;
      lastSeq = ev.seq;
      onEvent(ev);
      if (ev.type === "run_finished") current.close();
    };

    // While the browser retries by itself, it sends Last-Event-ID. It gives up on some errors,
    // such as a bad gateway from the dev proxy. Then we open a new connection.
    current.onerror = () => {
      onConnection?.(false);
      if (current.readyState === EventSource.CLOSED) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };
  }

  connect();

  return () => {
    clearTimeout(reconnectTimer);
    source?.close();
  };
}
