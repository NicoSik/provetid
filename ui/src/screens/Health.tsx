import { useEffect, useState } from "react";
import { getHealth, type Health as HealthAnswer } from "../api/health";
import { replayName } from "../events/replay";
import type { ScreenMeta } from "./registry";

export const screen: ScreenMeta = { path: "/health", step: null, title: "Klarsjekk" };

const OFFLINE = "Får ikke kontakt med motoren. Sjekk at den kjører, og last siden på nytt.";
// A limit this fresh means that a live run would stop now. Each check of Claude renews it.
const LIMIT_NOW_MS = 5 * 60_000;
// Claude's rolling usage window is about five hours. A weekly or model cap can last longer, and
// the engine's login call uses Haiku, so a green row does not rule those out.
const LIMIT_WINDOW_MS = 5 * 3_600_000;

type State = "ok" | "warn" | "fail" | "off";
type Check = { name: string; state: State; detail: string };

const STATES: Record<State, { label: string; dot: string; text: string }> = {
  ok: { label: "OK", dot: "bg-bestatt", text: "text-bestatt" },
  warn: { label: "Sjekk", dot: "bg-stoppet", text: "text-stoppet" },
  fail: { label: "Feil", dot: "bg-brudd", text: "text-brudd" },
  off: { label: "Ikke sjekket", dot: "bg-ikke-testet", text: "text-ikke-testet" },
};

const REPLAY_NAMES = { before: "før", after: "etter", scam: "svindel" } as const;

function claudeCheck({
  checked,
  installed,
  version,
  version_ok,
  logged_in,
}: HealthAnswer["claude"]) {
  const part = (state: State, detail: string) => ({ name: "Claude", state, detail });
  if (!checked) return part("off", "Motoren kjører i testmodus, så ingen modell kalles.");
  if (installed === false) return part("fail", "Claude Code er ikke installert.");
  if (installed === null) return part("warn", "Kunne ikke lese versjonen av Claude Code.");
  if (version_ok === false) {
    return part("fail", `Versjon ${version} er for gammel. Oppdater Claude Code.`);
  }
  if (logged_in === false) return part("fail", "Claude Code er ikke logget inn.");
  if (logged_in === null)
    return part("warn", "Kunne ikke bekrefte innloggingen. Last siden på nytt.");
  return part("ok", `Versjon ${version}, logget inn.`);
}

function usageCheck(lastLimitAt: string | null): Check {
  const part = (state: State, detail: string) => ({ name: "Bruksgrense", state, detail });
  if (lastLimitAt === null) return part("ok", "Ingen bruksgrense i de siste kjøringene.");
  const at = new Date(lastLimitAt);
  const date = at.toLocaleDateString("nb-NO");
  const time = at.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
  const when = `${date} kl. ${time}`;
  const age = Date.now() - at.getTime();
  if (age < LIMIT_NOW_MS) return part("fail", `Nådd ${when}. En live-kjøring stopper nå.`);
  if (age < LIMIT_WINDOW_MS) return part("warn", `Nådd ${when} og kan fortsatt gjelde.`);
  return part("ok", `Sist nådd ${when}.`);
}

function replaysCheck(replays: HealthAnswer["replays"]): Check {
  const missing = (Object.keys(REPLAY_NAMES) as (keyof typeof REPLAY_NAMES)[])
    .filter((name) => !replays[name])
    .map((name) => REPLAY_NAMES[name]);
  return missing.length === 0
    ? { name: "Avspillinger", state: "ok", detail: "Før, etter og svindel finnes." }
    : { name: "Avspillinger", state: "warn", detail: `Mangler: ${missing.join(", ")}` };
}

function checks(health: HealthAnswer): Check[] {
  return [
    claudeCheck(health.claude),
    usageCheck(health.usage.last_limit_at),
    health.demo_plan
      ? { name: "Demoplan", state: "ok", detail: "Demoplanen kan leses." }
      : { name: "Demoplan", state: "fail", detail: "Demoplanen mangler eller er ugyldig." },
    replaysCheck(health.replays),
  ];
}

function CheckRow({ name, state, detail }: Check) {
  const style = STATES[state];
  return (
    <li className="flex items-start gap-4 rounded-md border border-line bg-raised p-4">
      <span aria-hidden="true" className={`mt-1.5 size-3 shrink-0 rounded-full ${style.dot}`} />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-ink">{name}</h2>
        <p className="text-sm text-muted">{detail}</p>
      </div>
      <span className={`shrink-0 text-sm font-semibold ${style.text}`}>{style.label}</span>
    </li>
  );
}

export default function Health() {
  const replay = replayName() !== null;
  const [health, setHealth] = useState<HealthAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (replay) return;
    let alive = true;
    getHealth()
      .then((next) => alive && setHealth(next))
      .catch(() => alive && setError(OFFLINE));
    return () => {
      alive = false;
    };
  }, [replay]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-xl font-bold text-ink">Klarsjekk</h1>

      {replay && (
        <p className="text-muted">
          Klarsjekken er ikke tilgjengelig under avspilling fordi den trenger motoren.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink">
          {error}
        </p>
      )}
      {!replay && !error && !health && <p className="text-muted">Sjekker …</p>}

      {health && (
        <ul className="space-y-3">
          {checks(health).map((check) => (
            <CheckRow key={check.name} {...check} />
          ))}
        </ul>
      )}
    </div>
  );
}
