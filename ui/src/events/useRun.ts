import { useEffect, useState } from "react";
import { abandonRun, initialState, type RunState, reduce } from "./reducer";
import { type ConnectionStatus, openRun } from "./stream";

/** The live state of a run. It starts over when `runId` changes. */
export function useRun(runId: string | null): { state: RunState; connection: ConnectionStatus } {
  const [state, setState] = useState(initialState);
  const [connection, setConnection] = useState<ConnectionStatus>("connected");

  useEffect(() => {
    setState(initialState());
    setConnection("connected");
    if (runId === null) return;
    return openRun(
      runId,
      (ev) => setState((current) => reduce(current, ev)),
      (status) => {
        setConnection(status);
        if (status === "abandoned") setState((current) => abandonRun(current, runId));
        if (status === "missing") {
          setState((current) => (current.runId === null ? current : abandonRun(current, runId)));
        }
      },
    );
  }, [runId]);

  return { state, connection };
}
