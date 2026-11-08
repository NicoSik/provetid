import { useEffect, useRef, useState } from "react";
import { type DismissState, dismiss, getDismissed } from "../api/dismiss";
import { BUTTON } from "../components/buttons";
import { replayName } from "../events/replay";
import { PAGE } from "./layout";
import type { ScreenMeta } from "./registry";

export const screen: ScreenMeta = { path: "/proevetid", step: 5, title: "Prøvetid" };

const OFFLINE = "Får ikke kontakt med motoren. Sjekk at den kjører, og prøv igjen.";

/** The term comes first in the markup, as `<dl>` needs; `flex-col-reverse` puts the value on top. */
function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-2xl font-bold text-ink tabular-nums">{value}</dd>
    </div>
  );
}

type Step = "idle" | "confirming";

export default function Proevetid() {
  const replay = replayName() !== null;
  const [state, setState] = useState<DismissState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [busy, setBusy] = useState(false);
  // Where focus goes after the next render, so a keyboard driver never lands on <body>.
  const focusNext = useRef<"cancel" | "action" | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (replay) return;
    let alive = true;
    getDismissed()
      .then((next) => alive && setState(next))
      .catch(() => alive && setError(OFFLINE));
    return () => {
      alive = false;
    };
  }, [replay]);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "cancel") cancelButton.current?.focus();
    if (target === "action") actionButton.current?.focus();
  });

  async function set(value: boolean) {
    setBusy(true);
    setError(null);
    try {
      setState(await dismiss(value));
      setStep("idle");
      focusNext.current = "action";
    } catch {
      setError(OFFLINE);
      focusNext.current = value ? "cancel" : "action"; // the pressed button was disabled
    } finally {
      setBusy(false);
    }
  }

  const dismissed = state?.dismissed ?? false;

  return (
    <div className={`${PAGE} space-y-8`}>
      <h1 className="text-xl font-bold text-ink">Prøvetid</h1>

      {replay && (
        <p className="text-muted">
          Prøvetid er ikke tilgjengelig under avspilling, fordi den trenger motoren.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink">
          {error}
        </p>
      )}
      {!replay && !error && !state && <p className="text-muted">Henter status …</p>}

      {state && (
        <>
          <section aria-label="Status" aria-live="polite" className="space-y-2">
            <p className="text-sm text-muted">AI-en er</p>
            <p
              className={`text-5xl font-bold tracking-tight ${dismissed ? "text-brudd" : "text-bestatt"}`}
            >
              {dismissed ? "Sagt opp" : "Ansatt"}
            </p>
            {dismissed && (
              <p className="max-w-prose text-sm text-muted">
                Boten svarer ikke lenger. Alle kunder får nå denne beskjeden: {state.closed_message}
              </p>
            )}
          </section>

          <section aria-label="Tall fra intervjuene">
            <dl className="flex flex-wrap gap-x-10 gap-y-4">
              <Figure value={state.summary.runs} label="kjøringer" />
              <Figure value={state.summary.chats} label="samtaler sjekket" />
              <Figure value={state.summary.incidents} label="brudd og stoppede forsøk" />
            </dl>
          </section>

          <section aria-label="Handling" className="border-t border-line pt-6">
            {dismissed ? (
              <button
                ref={actionButton}
                type="button"
                disabled={busy}
                onClick={() => void set(false)}
                className={BUTTON.secondary}
              >
                Ansett igjen
              </button>
            ) : step === "confirming" ? (
              <div className="space-y-3">
                <p className="text-sm text-ink">
                  Boten stopper før neste svar, også i samtaler som pågår.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void set(true)}
                    className={BUTTON.danger}
                  >
                    Ja, si opp nå
                  </button>
                  <button
                    ref={cancelButton}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setStep("idle");
                      focusNext.current = "action";
                    }}
                    className={BUTTON.secondary}
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            ) : (
              <button
                ref={actionButton}
                type="button"
                onClick={() => {
                  setStep("confirming");
                  focusNext.current = "cancel";
                }}
                className={BUTTON.danger}
              >
                Si opp
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
