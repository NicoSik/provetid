import { useEffect, useState } from "react";
import { buildPlan, getPlan, isLock, putPlan, type TestPlan } from "../api/plans";
import { startRun } from "../api/runs";
import { replayName } from "../events/replay";
import { DEMO_PLAN_ID, getSession, updateSession } from "../state/session";
import type { ScreenMeta } from "./registry";

export const screen: ScreenMeta = { path: "/stillingsannonse", step: 1, title: "Stillingsannonse" };

function countKinds(plan: TestPlan): string {
  const count = (kind: string) => plan.customers.filter((c) => c.kind === kind).length;
  return `${plan.customers.length} testkunder: ${count("normal")} vanlige · ${count("attack")} angripere · ${count("scam")} svindel`;
}

function PlanView({ initial }: { initial: TestPlan }) {
  const [plan, setPlan] = useState(initial);
  const [approved, setApproved] = useState(false);
  // The run uses the plan saved on the server, so edits count only after «Godkjenn planen».
  const [unsaved, setUnsaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ad, setAd] = useState(initial.job_ad);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  function editRule(id: string, text: string) {
    setApproved(false);
    setUnsaved(true);
    setPlan((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === id ? { ...rule, text } : rule)),
    }));
  }

  const emptyRule = plan.rules.some((rule) => rule.text.trim() === "");
  // An edited ad counts only once its rules are made: the run uses the rules, not the ad text.
  const adChanged = ad.trim() !== plan.job_ad.trim();
  const locked = busy || building || adChanged;

  async function approve() {
    setBusy(true);
    setFailed(false);
    try {
      setPlan(await putPlan(plan));
      setApproved(true);
      setUnsaved(false);
      setAnnouncement("");
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  async function makeRules() {
    setBuilding(true);
    setBuildError(null);
    setAnnouncement("");
    try {
      const built = await buildPlan(ad);
      setPlan(built);
      updateSession({ planId: built.id, currentRunId: null, beforeRunId: null, afterRunId: null });
      setAd(built.job_ad);
      // REQ-1.4: new rules are shown for approval before the interview can start.
      setApproved(false);
      setUnsaved(true);
      setAnnouncement(`${built.rules.length} nye regler. Godkjenn dem før du starter.`);
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : "Klarte ikke å lage regler.");
    }
    setBuilding(false);
  }

  async function start() {
    setBusy(true);
    setFailed(false);
    try {
      const { run_id } = await startRun({ plan_id: plan.id, mode: "observe" });
      updateSession({
        planId: plan.id,
        currentRunId: run_id,
        beforeRunId: null,
        afterRunId: null,
      });
      window.location.hash = "#/intervju";
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="annonse" className="space-y-2">
        <h2 id="annonse" className="text-lg font-semibold text-ink">
          Stillingsannonsen
        </h2>
        <textarea
          aria-labelledby="annonse"
          aria-describedby="annonse-hint"
          aria-busy={building}
          readOnly={building}
          value={ad}
          onChange={(event) => setAd(event.target.value)}
          rows={8}
          maxLength={10000}
          className="w-full rounded-md border border-line bg-surface p-4 text-ink focus:border-pagar focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void makeRules()}
            disabled={building || busy || !ad.trim()}
            className="rounded-md border border-line px-4 py-2 font-semibold text-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {building ? "Lager regler …" : "Lag regler"}
          </button>
          <p id="annonse-hint" className="text-sm text-muted">
            Lim inn en annen annonse for å lage nye regler fra den.
          </p>
        </div>
        {adChanged && !building && (
          <p className="text-sm text-stoppet">
            Annonsen er endret. Lag regler på nytt, eller angre endringen.
          </p>
        )}
        <p aria-live="polite" className="text-sm text-ink">
          {announcement}
        </p>
        {buildError && (
          <p
            role="alert"
            className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink"
          >
            {buildError}
          </p>
        )}
      </section>

      <section aria-labelledby="regler" className="space-y-3">
        <h2 id="regler" className="text-lg font-semibold text-ink">
          Reglene
        </h2>
        <p className="text-sm text-muted">
          «Lås» håndheves i kode, utenfor boten. «Dommer» vurderes av en modell.
        </p>
        <ul className="space-y-3">
          {plan.rules.map((rule) => {
            const lock = isLock(rule);
            return (
              <li key={rule.id} className="flex items-center gap-3">
                <span className="w-8 shrink-0 font-mono text-sm text-muted">{rule.id}</span>
                <input
                  aria-label={`Regel ${rule.id}`}
                  type="text"
                  value={rule.text}
                  onChange={(event) => editRule(rule.id, event.target.value)}
                  disabled={building}
                  className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-ink"
                />
                <span className="w-16 shrink-0 rounded-md border border-line px-2 py-0.5 text-center text-xs font-semibold text-ink">
                  {lock ? "Lås" : "Dommer"}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="font-medium text-ink">{countKinds(plan)}</p>

      {failed && (
        <p role="alert" className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink">
          Fikk ikke kontakt med motoren. Sjekk at den kjører og prøv igjen.
        </p>
      )}
      {unsaved && <p className="text-sm text-muted">Godkjenn endringene før du starter.</p>}
      {approved && <p className="text-sm text-ink">Planen er godkjent og lagret.</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => void approve()}
          disabled={locked || emptyRule}
          className="rounded-md border border-line px-4 py-2 font-semibold text-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Godkjenn planen
        </button>
        <button
          type="button"
          onClick={() => void start()}
          disabled={locked || emptyRule || unsaved}
          className="rounded-md bg-pagar px-4 py-2 font-semibold text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start intervju
        </button>
      </div>
    </div>
  );
}

export default function Stillingsannonse() {
  const replay = replayName() !== null;
  const [plan, setPlan] = useState<TestPlan | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (replay) return;
    let cancelled = false;
    // The plan the interview ran with. Only a plan that is gone (404) gives way to the demo plan.
    const active = getSession().planId;
    const load = getPlan(active).catch((error: unknown) => {
      const gone = error instanceof Error && error.message.includes("feil 404");
      if (active === DEMO_PLAN_ID || !gone) throw error;
      return getPlan(DEMO_PLAN_ID);
    });
    load.then(
      (loaded) => {
        if (cancelled) return;
        // Runs of another plan must not stay as the «before» of this one.
        if (loaded.id !== active) {
          updateSession({
            planId: loaded.id,
            currentRunId: null,
            beforeRunId: null,
            afterRunId: null,
          });
        }
        setPlan(loaded);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [replay]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-bold text-ink">Stillingsannonse</h1>
      {replay && (
        <p className="text-muted">
          Stillingsannonsen er ikke tilgjengelig under avspilling, fordi den trenger motoren.
        </p>
      )}
      {failed && (
        <p role="alert" className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink">
          Fikk ikke kontakt med motoren, så testplanen kunne ikke hentes.
        </p>
      )}
      {!replay && !failed && !plan && <p className="text-muted">Henter testplanen …</p>}
      {plan && <PlanView initial={plan} />}
    </div>
  );
}
