import { useEffect, useState } from "react";
import { initialState, type RunState, reduce } from "./reducer";
import { openRun } from "./stream";

/** The live state of a run. It starts over when `runId` changes. */
export function useRun(runId: string | null): { state: RunState; connectionLost: boolean } {
  const [state, setState] = useState(initialState);
  const [connectionLost, setConnectionLost] = useState(false);

  useEffect(() => {
    setState(initialState());
    setConnectionLost(false);
    if (runId === null) return;
    return openRun(
      runId,
      (ev) => setState((current) => reduce(current, ev)),
      (connected) => setConnectionLost(!connected),
    );
  }, [runId]);

  return { state, connectionLost };
}
