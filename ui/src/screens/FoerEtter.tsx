import { useEffect, useState } from "react";
import { dismiss } from "../api/dismiss";
import { abandonRun, initialState, type RunState, reduce } from "../events/reducer";
import { loadReplay, replayName } from "../events/replay";
import type { ConnectionStatus } from "../events/stream";
import { useRun } from "../events/useRun";
import { decisionFor, runCounts } from "../report/rows";
import { useSession } from "../state/session";
import { CONNECTION_MESSAGES, RUN_ERROR_TEXT } from "./Intervju";
import { DECISION_STYLES } from "./Karakterkort";
import { PAGE } from "./layout";
import type { ScreenMeta } from "./registry";

export const screen: ScreenMeta = { path: "/foer-etter", step: null, title: "Før og etter" };

const HIRABLE = ["Klar for prøvetid", "Ansett med forbehold"];
const NO_LIMITED_RUN = "Ingen kjøring med grenser ennå.";

/** The term comes first in the markup, as `<dl>` needs; `flex-col-reverse` puts the value on top. */
function Figure({ value, label, style }: { value: number; label: string; style: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`text-5xl font-bold tabular-nums ${value > 0 ? style : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}

function Outcome({ state }: { state: RunState }) {
  if (!state.finished) return <p className="text-xl font-semibold text-pagar">pågår</p>;
  const decision = decisionFor(state);
  const style = decision ? DECISION_STYLES[decision] : undefined;
  return (
    <>
      <h3
        className={`rounded-lg border-2 px-4 py-3 text-xl font-bold ${
          style ?? "border-line bg-raised text-ink"
        }`}
      >
        {decision ?? "Ingen avgjørelse"}
      </h3>
      {state.finished.incomplete && (
        <p className="font-semibold text-stoppet">Testen er ufullstendig</p>
      )}
      {state.error && <p className="text-sm text-ink">{RUN_ERROR_TEXT[state.error.kind]}</p>}
    </>
  );
}

function Column({
  name,
  state,
  connection,
  empty,
}: {
  name: "FØR" | "ETTER";
  state: RunState;
  connection: ConnectionStatus;
  empty: string;
}) {
  const headingId = `kolonne-${name}`;
  const { fails, blocked } = runCounts(state);
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-lg border border-line bg-raised p-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-2xl font-bold text-ink">
          {name}
        </h2>
        {state.mode && (
          <span className="text-sm text-muted">
            {state.mode === "enforce" ? "Med grenser" : "Uten grenser"}
          </span>
        )}
      </div>
      {connection !== "connected" && (
        <p
          role="alert"
          className="rounded-md border border-stoppet bg-stoppet/10 p-3 text-sm text-ink"
        >
          {CONNECTION_MESSAGES[connection]}
        </p>
      )}
      {state.runId === null ? (
        connection === "connected" && <p className="text-muted">{empty}</p>
      ) : (
        <>
          <dl className="flex gap-10">
            <Figure value={fails} label="Brudd" style="text-brudd" />
            <Figure value={blocked} label="Stoppet" style="text-stoppet" />
          </dl>
          <Outcome state={state} />
        </>
      )}
    </section>
  );
}

/** The rules of a run, whole: a rule can keep its ID and still have been changed. */
function rulesKey(state: RunState): string {
  const rules = [...state.rules].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(rules.map(({ id, text, check }) => [id, text, check]));
}

/** Why the bot cannot start its trial period yet, or `null` if it can. */
function hireBlock(after: RunState, afterLoading: boolean, differentRules: boolean): string | null {
  if (replayName() !== null) return "Prøvetid er ikke tilgjengelig under avspilling.";
  if (after.runId === null) return afterLoading ? "Henter kjøringen med grenser." : NO_LIMITED_RUN;
  if (after.mode !== "enforce") return "Kjøringen under ETTER gikk uten grenser.";
  if (differentRules) return "De to kjøringene har ikke samme regler.";
  if (!after.finished) return "Kjøringen med grenser pågår.";
  if (after.finished.incomplete) return "Testen med grenser er ufullstendig.";
  return HIRABLE.includes(decisionFor(after) ?? "")
    ? null
    : "Kjøringen med grenser har ikke bestått.";
}

/** The two runs side by side. `FoerEtter` below connects them to live runs or pinned files. */
export function CompareView({
  before,
  after,
  beforeConnection = "connected",
  afterConnection = "connected",
  beforeLoading = false,
  afterLoading = false,
}: {
  before: RunState;
  after: RunState;
  beforeConnection?: ConnectionStatus;
  afterConnection?: ConnectionStatus;
  beforeLoading?: boolean;
  afterLoading?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const differentRules =
    before.rules.length > 0 && after.rules.length > 0 && rulesKey(before) !== rulesKey(after);
  const block = hireBlock(after, afterLoading, differentRules);

  async function hire() {
    setBusy(true);
    setFailed(false);
    try {
      // A bot let go in a rehearsal must not stay let go after the owner presses «Ansett».
      await dismiss(false);
      window.location.hash = "#/proevetid";
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className={`${PAGE} space-y-6`}>
      <h1 className="text-xl font-bold text-ink">Før og etter</h1>
      {differentRules && (
        <p role="alert" className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink">
          De to kjøringene har ikke samme regler, så de kan ikke sammenlignes direkte.
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <Column
          name="FØR"
          state={before}
          connection={beforeConnection}
          empty={beforeLoading ? "Henter kjøringen …" : "Ingen kjøring uten grenser ennå."}
        />
        <Column
          name="ETTER"
          state={after}
          connection={afterConnection}
          empty={
            afterLoading
              ? "Henter kjøringen …"
              : `${NO_LIMITED_RUN} Velg «Kjør intervjuet igjen» på Signeringsrett.`
          }
        />
      </div>
      {failed && (
        <p role="alert" className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink">
          Fikk ikke kontakt med motoren, så prøvetiden kunne ikke startes.
        </p>
      )}
      <div className="space-y-2">
        <button
          type="button"
          disabled={block !== null || busy}
          aria-describedby={block ? "ansett-grunn" : undefined}
          onClick={() => void hire()}
          className="rounded-md bg-pagar px-4 py-2 font-semibold text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Ansett og start prøvetid
        </button>
        {block && (
          <p id="ansett-grunn" className="text-sm text-muted">
            {block}
          </p>
        )}
      </div>
    </div>
  );
}

/** A pinned file, read at once: a comparison needs the result, not the timing. */
function usePinnedRun(name: string): {
  state: RunState;
  connection: ConnectionStatus;
  done: boolean;
} {
  const [loaded, setLoaded] = useState<{ state: RunState; connection: ConnectionStatus } | null>(
    null,
  );

  useEffect(() => {
    let alive = true;
    void loadReplay(name).then((events) => {
      if (!alive) return;
      if (events === null) {
        setLoaded({ state: initialState(), connection: "replay_missing" });
        return;
      }
      const state = events.reduce(reduce, initialState());
      setLoaded(
        state.finished
          ? { state, connection: "connected" }
          : { state: abandonRun(state, name), connection: "abandoned" },
      );
    });
    return () => {
      alive = false;
    };
  }, [name]);

  return loaded
    ? { ...loaded, done: true }
    : { state: initialState(), connection: "connected", done: false };
}

function PinnedCompare() {
  const before = usePinnedRun("before");
  const after = usePinnedRun("after");
  return (
    <CompareView
      before={before.state}
      after={after.state}
      beforeConnection={before.connection}
      afterConnection={after.connection}
      beforeLoading={!before.done}
      afterLoading={!after.done}
    />
  );
}

function LiveCompare() {
  const { beforeRunId, afterRunId } = useSession();
  const before = useRun(beforeRunId);
  const after = useRun(afterRunId);
  return (
    <CompareView
      before={before.state}
      after={after.state}
      beforeConnection={before.connection}
      afterConnection={after.connection}
      beforeLoading={beforeRunId !== null}
      afterLoading={afterRunId !== null}
    />
  );
}

export default function FoerEtter() {
  // During a replay the URL names one file, but this screen always needs both.
  return replayName() !== null ? <PinnedCompare /> : <LiveCompare />;
}
