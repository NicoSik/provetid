// Which runs the owner is looking at. It survives a page reload in the same tab, so a reload on
// stage rejoins the run: the stream sends all events again and the reducer rebuilds the state.

import { useSyncExternalStore } from "react";

export type Session = {
  currentRunId: string | null;
  beforeRunId: string | null;
  afterRunId: string | null;
};

const STORAGE_KEY = "provetid.session";
const EMPTY: Session = { currentRunId: null, beforeRunId: null, afterRunId: null };

function load(): Session {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? { ...EMPTY, ...JSON.parse(saved) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

let session = load();
const listeners = new Set<() => void>();

export function getSession(): Session {
  return session;
}

export function updateSession(changes: Partial<Session>): void {
  session = { ...session, ...changes };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // The browser blocks storage. The session then lasts until the next reload.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): Session {
  return useSyncExternalStore(subscribe, getSession);
}
