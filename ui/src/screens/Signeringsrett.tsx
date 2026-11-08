import { useEffect, useState } from "react";
import { startLimitedRun } from "../api/limitedRun";
import { getLimits, type Limits } from "../api/limits";
import { getPlan } from "../api/plans";
import { listRuns } from "../api/runs";
import { CompareButton } from "../components/CompareButton";
import { replayName } from "../events/replay";
import { type LockRules, lockRules } from "../report/lockRules";
import { DEMO_PLAN_ID, getSession, updateSession, useSession } from "../state/session";
import { PAGE, PROSE } from "./layout";
import type { ScreenMeta } from "./registry";

export const screen: ScreenMeta = { path: "/signeringsrett", step: 4, title: "Signeringsrett" };

const MAX_DISCOUNT = 100;
const SUGGESTED_SENTENCES = [
  "Send reklamasjoner videre til eieren.",
  "Si at kunden har 14 dagers angrerett ved kjøp på nett.",
  "Si at du er en AI når noen spør.",
];

/** The number in a field: `null` for empty, `undefined` for anything that is not a valid limit. */
function parseLimit(text: string, max = Number.MAX_SAFE_INTEGER): number | null | undefined {
  if (text.trim() === "") return null;
  if (!/^\d+$/.test(text.trim())) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) && value <= max ? value : undefined;
}

/** The first run counts as «før» only if it ran with no limits (REQ-5.8). */
async function beforeRun(): Promise<string | null> {
  const { beforeRunId, currentRunId } = getSession();
  if (beforeRunId !== null || currentRunId === null) return beforeRunId;
  try {
    const current = (await listRuns()).find((run) => run.run_id === currentRunId);
    return current?.mode === "observe" ? currentRunId : null;
  } catch {
    return null;
  }
}

/** «Gjelder R3»: the rules a lock enforces, so the owner can tie it to the job ad. */
function RulesLine({ id, rules }: { id: string; rules: string[] }) {
  if (rules.length === 0) return null;
  return (
    <p id={id} className="mt-1 text-sm text-muted">
      Gjelder {rules.join(", ")}
    </p>
  );
}

function NumberLock({
  id,
  label,
  value,
  invalid,
  hint,
  rules,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  invalid: boolean;
  hint: string;
  rules: string[];
  onChange: (value: string) => void;
}) {
  const hintId = `${id}-hint`;
  const rulesId = `${id}-rules`;
  const describedBy = [rules.length > 0 ? rulesId : null, invalid ? hintId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div>
      <label htmlFor={id} className="block font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        // A number input reports "" for text it cannot read, which would look like «no limit».
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        placeholder="Ingen grense"
        aria-invalid={invalid}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 w-48 rounded-md border bg-surface px-3 py-1.5 text-ink ${
          invalid ? "border-brudd" : "border-line"
        }`}
      />
      <RulesLine id={rulesId} rules={rules} />
      {invalid && (
        <p id={hintId} className="mt-1 text-sm text-brudd">
          {hint}
        </p>
      )}
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  rules = [],
  onChange,
}: {
  id?: string;
  label: string;
  checked: boolean;
  rules?: string[];
  onChange: () => void;
}) {
  const rulesId = id ? `${id}-rules` : undefined;
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3 text-ink">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          aria-describedby={rulesId && rules.length > 0 ? rulesId : undefined}
          className="mt-1 size-4 shrink-0"
        />
        <span>{label}</span>
      </label>
      {rulesId && (
        <div className="pl-7">
          <RulesLine id={rulesId} rules={rules} />
        </div>
      )}
    </div>
  );
}

const NO_RULES: LockRules = {
  maxDiscount: [],
  maxRefund: [],
  originalOnly: [],
  hideContact: [],
  stopAddress: [],
};

function LimitsForm({ saved }: { saved: Limits }) {
  const [discount, setDiscount] = useState(saved.max_discount_percent?.toString() ?? "");
  const [refund, setRefund] = useState(saved.max_refund_nok?.toString() ?? "");
  const [originalOnly, setOriginalOnly] = useState(saved.refund_original_only);
  const [hideContact, setHideContact] = useState(saved.hide_address_phone);
  const [allowAddress, setAllowAddress] = useState(saved.allow_address_change);
  const [sentences, setSentences] = useState(saved.extra_instructions);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ruleIds, setRuleIds] = useState<LockRules>(NO_RULES);

  useEffect(() => {
    let cancelled = false;
    getPlan(getSession().planId).then(
      (plan) => {
        if (!cancelled) setRuleIds(lockRules(plan.rules));
      },
      () => {}, // Without the plan the locks still work; they just name no rules.
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const maxDiscount = parseLimit(discount, MAX_DISCOUNT);
  const maxRefund = parseLimit(refund);
  const valid = maxDiscount !== undefined && maxRefund !== undefined;
  const offered = [
    ...SUGGESTED_SENTENCES,
    ...saved.extra_instructions.filter((sentence) => !SUGGESTED_SENTENCES.includes(sentence)),
  ];

  function toggleSentence(sentence: string) {
    setSentences((current) =>
      current.includes(sentence)
        ? current.filter((other) => other !== sentence)
        : [...current, sentence],
    );
  }

  async function runAgain() {
    if (maxDiscount === undefined || maxRefund === undefined) return;
    const limits: Limits = {
      max_discount_percent: maxDiscount,
      max_refund_nok: maxRefund,
      refund_original_only: originalOnly,
      hide_address_phone: hideContact,
      allow_address_change: allowAddress,
      extra_instructions: sentences,
    };
    setRunning(true);
    setFailed(false);
    try {
      const before = await beforeRun();
      const run_id = await startLimitedRun(getSession().planId, limits);
      updateSession({ currentRunId: run_id, beforeRunId: before, afterRunId: run_id });
      window.location.hash = "#/intervju";
    } catch {
      setFailed(true);
      setRunning(false);
    }
  }

  return (
    <form
      className={`${PROSE} space-y-8`}
      onSubmit={(event) => {
        event.preventDefault();
        void runAgain();
      }}
    >
      <section aria-labelledby="locks" className="space-y-4">
        <h2 id="locks" className="text-lg font-semibold text-ink">
          Lås
        </h2>
        <p className="text-sm text-muted">
          Låsene håndheves i kode, utenfor boten. De holder selv om noen lurer boten.
        </p>
        <NumberLock
          id="max-discount"
          label="Maks rabatt (prosent)"
          value={discount}
          invalid={maxDiscount === undefined}
          hint="Må være et heltall fra 0 til 100."
          rules={ruleIds.maxDiscount}
          onChange={setDiscount}
        />
        <NumberLock
          id="max-refund"
          label="Maks refusjon (kroner)"
          value={refund}
          invalid={maxRefund === undefined}
          hint="Må være et heltall på 0 eller mer."
          rules={ruleIds.maxRefund}
          onChange={setRefund}
        />
        <Toggle
          id="original-only"
          label="Refusjon bare til opprinnelig betaling"
          checked={originalOnly}
          rules={ruleIds.originalOnly}
          onChange={() => setOriginalOnly(!originalOnly)}
        />
        <Toggle
          id="hide-contact"
          label="Skjul adresse og telefonnummer"
          checked={hideContact}
          rules={ruleIds.hideContact}
          onChange={() => setHideContact(!hideContact)}
        />
        {/* Ticked means locked, like the other locks. The saved limit stays allow_address_change. */}
        <Toggle
          id="stop-address"
          label="Stopp adresseendringer"
          checked={!allowAddress}
          rules={ruleIds.stopAddress}
          onChange={() => setAllowAddress(!allowAddress)}
        />
      </section>

      <section aria-labelledby="sentences" className="space-y-4">
        <h2 id="sentences" className="text-lg font-semibold text-ink">
          Instruks
        </h2>
        <p className="text-sm text-muted">
          Setninger som legges til i botens instruks. De er råd til boten, ikke lås.
        </p>
        {offered.map((sentence) => (
          <Toggle
            key={sentence}
            label={sentence}
            checked={sentences.includes(sentence)}
            onChange={() => toggleSentence(sentence)}
          />
        ))}
      </section>

      {failed && (
        <p role="alert" className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink">
          Kunne ikke starte intervjuet. Sjekk at motoren kjører og at testplanen finnes.
        </p>
      )}

      <button
        type="submit"
        disabled={!valid || running}
        className="rounded-md bg-pagar px-4 py-2 font-semibold text-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Kjør intervjuet igjen
      </button>
    </form>
  );
}

export default function Signeringsrett() {
  const replay = replayName() !== null;
  const { afterRunId } = useSession();
  const [saved, setSaved] = useState<Limits | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (replay) return;
    let cancelled = false;
    // The plan the interview ran with. Only a plan that is gone (404) gives way to the demo plan.
    const active = getSession().planId;
    const load = getLimits(active).then(
      (limits) => ({ limits, planId: active }),
      (error: unknown) => {
        const gone = error instanceof Error && error.message.includes("feil 404");
        if (active === DEMO_PLAN_ID || !gone) throw error;
        return getLimits(DEMO_PLAN_ID).then((limits) => ({ limits, planId: DEMO_PLAN_ID }));
      },
    );
    load.then(
      ({ limits, planId }) => {
        if (cancelled) return;
        // Runs of another plan must not stay as the «before» of this one.
        if (planId !== active) {
          updateSession({ planId, currentRunId: null, beforeRunId: null, afterRunId: null });
        }
        setSaved(limits);
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
    <div className={`${PAGE} space-y-6`}>
      <h1 className="text-xl font-bold text-ink">Signeringsrett</h1>
      {replay && (
        <p className="text-muted">
          Signeringsrett er ikke tilgjengelig under avspilling, fordi den trenger motoren.
        </p>
      )}
      {failed && (
        <p role="alert" className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink">
          Fikk ikke kontakt med motoren, så grensene kunne ikke hentes.
        </p>
      )}
      {!replay && !failed && !saved && <p className="text-muted">Henter grensene …</p>}
      {saved && <LimitsForm saved={saved} />}
      {(replay || afterRunId !== null) && <CompareButton />}
    </div>
  );
}
