// Plays a saved run through the same reducer as a live run (D2), with no engine (REQ-8.6).

import { isRunEvent, type RunEvent } from "./types";

export type ReplaySpeed = 1 | 2 | 3;

export type ReplayControls = {
  pause(): void;
  resume(): void;
  setSpeed(speed: ReplaySpeed): void;
  stop(): void;
};

export type ReplayStatus = "replay_missing" | "abandoned";

const SAFE_NAME = /^[A-Za-z0-9_-]+$/;

/** The replay asked for in the URL (`?replay=before`), also if the name is not a valid one. */
export function replayName(): string | null {
  return new URLSearchParams(window.location.search).get("replay") || null;
}

export function replaySpeed(): ReplaySpeed {
  const speed = new URLSearchParams(window.location.search).get("speed");
  return speed === "2" ? 2 : speed === "3" ? 3 : 1;
}

/** One event from a line of text, or `null` if the line is not a valid event. */
export function parseEvent(raw: string): RunEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRunEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseEvents(text: string): RunEvent[] {
  // A line that is no event is skipped. A dev server can answer a missing file with an HTML page.
  return text
    .split("\n")
    .flatMap((line) => parseEvent(line) ?? [])
    .sort((a, b) => a.seq - b.seq);
}

/** The events of a file, or `null` if it cannot be read or holds none, such as an HTML page. */
async function fetchEvents(url: string): Promise<RunEvent[] | null> {
  try {
    // A plain file server sends no cache rules. A pinned file must never be replayed stale.
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return null;
    const events = parseEvents(await response.text());
    return events.length > 0 ? events : null;
  } catch {
    return null;
  }
}

/** All events of a pinned file at once, for a screen that needs the result and not the timing. */
export async function loadReplay(name: string): Promise<RunEvent[] | null> {
  return SAFE_NAME.test(name) ? fetchEvents(`/replays/${name}.jsonl`) : null;
}

/**
 * Delivers the events of a saved run with their original timing, divided by the speed.
 * `onFailed` runs when the file cannot be read or holds no events. `onCutOff` runs when the file
 * ends with no `run_finished`.
 */
export function playReplay(
  url: string,
  startSpeed: ReplaySpeed,
  onEvent: (ev: RunEvent) => void,
  onFailed?: () => void,
  onCutOff?: () => void,
): ReplayControls {
  let speed = startSpeed;
  let events: RunEvent[] = [];
  let next = 0;
  let paused = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = 0;
  let timeLeft: number | null = null;

  function waitFor(delay: number) {
    dueAt = Date.now() + delay;
    timer = setTimeout(deliver, delay);
  }

  function deliver() {
    timer = undefined;
    while (!stopped && !paused && next < events.length) {
      const event = events[next];
      next += 1;
      onEvent(event);
      const following = events[next];
      if (!following) {
        if (event.type !== "run_finished") onCutOff?.();
        return;
      }
      const delay = (Math.max(following.t - event.t, 0) * 1000) / speed;
      if (delay > 0) {
        waitFor(delay);
        return;
      }
    }
  }

  async function load() {
    const loaded = await fetchEvents(url);
    if (stopped) return;
    if (loaded === null) {
      onFailed?.();
      return;
    }
    events = loaded;
    if (!paused) deliver();
  }

  void load();

  return {
    pause() {
      if (stopped || paused) return;
      paused = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        timeLeft = Math.max(dueAt - Date.now(), 0);
      }
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      if (timeLeft !== null) {
        waitFor(timeLeft);
        timeLeft = null;
      } else {
        deliver();
      }
    },
    setSpeed(newSpeed) {
      const scale = speed / newSpeed;
      speed = newSpeed;
      if (timer !== undefined) {
        clearTimeout(timer);
        waitFor(Math.max(dueAt - Date.now(), 0) * scale);
      } else if (timeLeft !== null) {
        timeLeft *= scale;
      }
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

// One playback for the whole page, so that moving between screens never restarts it. A screen that
// joins late gets the events so far at once, as a reload of a live run does.

type Subscriber = {
  onEvent: (ev: RunEvent) => void;
  onStatus: (status: ReplayStatus) => void;
};

type SharedReplay = {
  name: string;
  controls: ReplayControls;
  delivered: RunEvent[];
  status: ReplayStatus | null;
  subscribers: Set<Subscriber>;
};

export type ReplayState = {
  paused: boolean;
  /** The speed the driver chose. `null` means the speed in the URL. */
  speed: ReplaySpeed | null;
};

const START_STATE: ReplayState = { paused: false, speed: null };

let shared: SharedReplay | null = null;
let state = START_STATE;
const listeners = new Set<() => void>();

function setState(changes: Partial<ReplayState>) {
  state = { ...state, ...changes };
  for (const listener of listeners) listener();
}

export function getReplayState(): ReplayState {
  return state;
}

export function subscribeToReplay(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A pause before playback starts is kept: the playback then starts paused (see `startShared`). */
export function pauseReplay(): void {
  shared?.controls.pause();
  setState({ paused: true });
}

export function resumeReplay(): void {
  shared?.controls.resume();
  setState({ paused: false });
}

export function setReplaySpeed(speed: ReplaySpeed): void {
  const params = new URLSearchParams(window.location.search);
  params.set("speed", String(speed));
  window.history.replaceState(null, "", `?${params}${window.location.hash}`);
  shared?.controls.setSpeed(speed);
  setState({ speed });
}

export function stopSharedReplay(): void {
  shared?.controls.stop();
  shared = null;
  setState(START_STATE); // tell the badge, so it never shows a pause that is gone
}

function startShared(name: string): SharedReplay {
  const report = (status: ReplayStatus) => {
    created.status = status;
    for (const subscriber of created.subscribers) subscriber.onStatus(status);
  };
  const created: SharedReplay = {
    name,
    delivered: [],
    status: null,
    subscribers: new Set(),
    controls: playReplay(
      `/replays/${name}.jsonl`,
      replaySpeed(),
      (ev) => {
        created.delivered.push(ev);
        for (const subscriber of created.subscribers) subscriber.onEvent(ev);
      },
      () => report("replay_missing"),
      () => report("abandoned"),
    ),
  };
  if (state.paused) created.controls.pause(); // the driver paused before anything played
  return created;
}

/** Joins the page's playback of this replay. The returned function leaves it, and it plays on. */
export function joinReplay(
  name: string,
  onEvent: (ev: RunEvent) => void,
  onStatus: (status: ReplayStatus) => void,
): () => void {
  if (!SAFE_NAME.test(name)) {
    onStatus("replay_missing");
    return () => {};
  }
  if (shared?.name !== name) {
    // Only a playback that exists is stopped: stopping resets the state, and with it a pause
    // that the driver made before anything played.
    if (shared) stopSharedReplay();
    shared = startShared(name);
  }
  const current = shared;
  for (const ev of current.delivered) onEvent(ev);
  if (current.status) onStatus(current.status);
  const subscriber = { onEvent, onStatus };
  current.subscribers.add(subscriber);
  return () => current.subscribers.delete(subscriber);
}
