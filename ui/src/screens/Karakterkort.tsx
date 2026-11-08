import { useState } from "react";
import { startLimitedRun } from "../api/limitedRun";
import { getLimits } from "../api/limits";
import { listRuns } from "../api/runs";
import { CompareButton } from "../components/CompareButton";
import type { RunState } from "../events/reducer";
import { replayName } from "../events/replay";
import { useRun } from "../events/useRun";
import { applyFixes, fixesFor } from "../report/fixes";
import { decisionFor, ruleRows } from "../report/rows";
import { getSession, updateSession, useSession } from "../state/session";
import { CONNECTION_MESSAGES, RUN_ERROR_TEXT } from "./Intervju";
import type { ScreenMeta } from "./registry";
import "../styles/print.css";

export const screen: ScreenMeta = { path: "/karakterkort", step: 3, title: "Karakterkort" };

export const DECISION_STYLES: Record<string, string> = {
  "Ikke ansett": "border-brudd bg-brudd/10 text-brudd",
  "Ansett med forbehold": "border-stoppet bg-stoppet/10 text-stoppet",
  "Klar for prøvetid": "border-bestatt bg-bestatt/10 text-bestatt",
};

function DecisionBanner({ state }: { state: RunState }) {
  if (!state.finished) return <p className="text-muted">Intervjuet pågår …</p>;
  const decision = decisionFor(state);
  const style = decision ? DECISION_STYLES[decision] : undefined;
  return (
    <h2
      className={`rounded-lg border-2 px-5 py-4 text-2xl font-bold ${
        style ?? "border-line bg-raised text-ink"
      }`}
    >
      {decision ?? "Ingen avgjørelse"}
    </h2>
  );
}

function RuleTable({ state }: { state: RunState }) {
  const { tested } = ruleRows(state);
  if (tested.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">Regel</th>
            <th className="px-3 py-2 text-right font-medium">Testet</th>
            <th className="px-3 py-2 text-right font-medium">Brudd</th>
            <th className="px-3 py-2 text-right font-medium">Stoppet</th>
            <th className="py-2 pl-3 font-medium">Første bevis</th>
          </tr>
        </thead>
        <tbody>
          {tested.map((row) => (
            <tr key={row.rule.id} className="border-b border-line align-top text-ink">
              <td className="py-2 pr-3 font-medium">
                <span className="mr-2 text-muted tabular-nums">{row.rule.id}</span>
                <span>{row.rule.text}</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{row.tested}</td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  row.fails > 0 ? "font-semibold text-brudd" : ""
                }`}
              >
                {row.fails}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  row.blocked > 0 ? "font-semibold text-stoppet" : ""
                }`}
              >
                {row.blocked}
              </td>
              <td className="py-2 pl-3 italic">{row.firstQuote ? `«${row.firstQuote}»` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fixes({ state }: { state: RunState }) {
  const fixes = fixesFor(state);
  const session = useSession();
  const [startedHere, setStartedHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (fixes.length === 0) return null;

  const started =
    replayName() === null &&
    session.afterRunId !== null &&
    (startedHere || session.beforeRunId === state.runId);
  const canRun = state.finished !== null && replayName() === null;

  async function applySuggestions() {
    setBusy(true);
    setFailed(false);
    try {
      const runs = await listRuns();
      const planId = runs.find((run) => run.run_id === state.runId)?.plan_id;
      // REQ-5.7 means the same plan. Testing another one by accident would look like a result.
      if (!planId) throw new Error("Fant ikke testplanen for denne kjøringen.");
      const limits = applyFixes(await getLimits(planId), fixes);
      const after = await startLimitedRun(planId, limits);
      // The run goes in the background, so the speaker stays on this report (D42).
      const before = state.mode === "observe" ? state.runId : getSession().beforeRunId;
      updateSession({ beforeRunId: before, afterRunId: after });
      setStartedHere(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <section aria-label="Forslag" className="space-y-3">
      <h2 className="text-lg font-semibold text-ink">Forslag</h2>
      <ul className="space-y-2">
        {fixes.map((fix) => (
          <li key={fix.text} className="flex items-baseline gap-3 text-ink">
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                fix.kind === "Lås" ? "bg-pagar/15 text-pagar" : "bg-ikke-testet/15 text-ikke-testet"
              }`}
            >
              {fix.kind}
            </span>
            <span>{fix.text}</span>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink">
          Kunne ikke starte intervjuet. Sjekk at motoren kjører og at testplanen finnes.
        </p>
      )}
      {replayName() !== null && (
        <p className="text-sm text-muted">
          Forslagene kan ikke brukes her. De er ikke tilgjengelig under avspilling, fordi de trenger
          motoren.
        </p>
      )}
      {started ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-ink">Intervjuet med grenser er startet.</p>
          <button
            type="button"
            onClick={() => {
              updateSession({ currentRunId: getSession().afterRunId });
              window.location.hash = "#/intervju";
            }}
            className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink hover:bg-raised-hover"
          >
            Se intervjuet med grenser
          </button>
        </div>
      ) : (
        canRun && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void applySuggestions()}
            className="rounded-md bg-pagar px-4 py-2 font-semibold text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Bruk forslagene
          </button>
        )
      )}
    </section>
  );
}

/** The report card for a run state. `Karakterkort` below connects it to the run. */
export function ReportView({ state }: { state: RunState }) {
  const { untested, blocked } = ruleRows(state);
  const { afterRunId } = useSession();
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink">Karakterkort</h1>
        <button
          type="button"
          data-no-print
          onClick={() => window.print()}
          className="rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink hover:bg-raised-hover"
        >
          Skriv ut
        </button>
      </div>
      <DecisionBanner state={state} />
      {state.finished?.incomplete && (
        <p
          role="alert"
          className="rounded-md border border-stoppet bg-stoppet/10 p-3 font-semibold text-ink"
        >
          Testen er ufullstendig.{" "}
          {state.error
            ? RUN_ERROR_TEXT[state.error.kind]
            : "Samtalene ga for få resultater, så dette viser ikke hele bildet."}
        </p>
      )}
      <RuleTable state={state} />
      {state.finished && untested.length > 0 && (
        <p className="text-sm text-muted">
          Ikke testet: {untested.map((rule) => `${rule.id} ${rule.text}`).join(", ")}
        </p>
      )}
      {blocked.length > 0 && (
        <section aria-label="Stoppede forsøk" className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">Stoppede forsøk</h2>
          <p className="text-sm text-muted">Disse teller ikke mot avgjørelsen.</p>
          <ul className="space-y-1 text-sm text-ink">
            {blocked.map((attempt) => (
              <li key={`${attempt.chatName}-${attempt.rule.id}`}>
                <span className="font-medium">{attempt.chatName}:</span>{" "}
                <span className="text-muted tabular-nums">{attempt.rule.id}</span>{" "}
                {attempt.rule.text}
                {attempt.explanation ? ` (${attempt.explanation})` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Fixes state={state} />
      {(replayName() !== null || afterRunId !== null) && <CompareButton />}
    </div>
  );
}

function LiveReport({ runId }: { runId: string }) {
  const { state, connection } = useRun(runId);
  const gone =
    state.runId === null && (connection === "missing" || connection === "replay_missing");
  return (
    <>
      {connection !== "connected" && (
        <div
          role="alert"
          className="mx-auto mt-6 flex max-w-4xl flex-wrap items-center gap-3 rounded-md border border-stoppet bg-stoppet/10 p-3 text-sm text-ink"
        >
          <p>{CONNECTION_MESSAGES[connection]}</p>
          {connection === "missing" && (
            <button
              type="button"
              onClick={() => updateSession({ currentRunId: null })}
              className="rounded-md border border-line bg-raised px-2.5 py-1 hover:bg-raised-hover"
            >
              Fjern kjøringen
            </button>
          )}
        </div>
      )}
      {!gone && <ReportView state={state} />}
    </>
  );
}

export default function Karakterkort() {
  const { currentRunId } = useSession();
  const runId = replayName() ?? currentRunId;
  if (runId === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted">Ingen intervju å vise.</p>
      </div>
    );
  }
  return <LiveReport key={runId} runId={runId} />;
}
