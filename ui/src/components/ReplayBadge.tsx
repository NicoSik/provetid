import { useSyncExternalStore } from "react";
import {
  getReplayState,
  pauseReplay,
  type ReplaySpeed,
  replayName,
  replaySpeed,
  resumeReplay,
  setReplaySpeed,
  subscribeToReplay,
} from "../events/replay";

const SPEEDS: ReplaySpeed[] = [1, 2, 3];

/** Always visible during a replay (REQ-8.5), so nobody takes a saved run for a live one. */
export function ReplayBadge() {
  const { paused, speed } = useSyncExternalStore(subscribeToReplay, getReplayState);
  if (!replayName()) return null;
  const current = speed ?? replaySpeed();

  return (
    <div className="flex items-center gap-2 rounded-full border border-stoppet bg-stoppet/15 px-3 py-1 text-sm">
      <span className="font-semibold text-stoppet">Avspilling</span>
      {SPEEDS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === current}
          onClick={() => setReplaySpeed(option)}
          className={option === current ? "font-semibold text-ink" : "text-muted hover:text-ink"}
        >
          {option}×
        </button>
      ))}
      <button
        type="button"
        onClick={paused ? resumeReplay : pauseReplay}
        className="rounded-full border border-line bg-raised px-2.5 py-0.5 text-ink hover:bg-raised-hover"
      >
        {paused ? "Fortsett" : "Pause"}
      </button>
    </div>
  );
}
