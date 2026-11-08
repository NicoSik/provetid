import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type ScamResult, submitScam } from "../api/scams";
import { useRun } from "../events/useRun";
import { BUTTON } from "./buttons";
import { ChatPanel } from "./ChatPanel";

const PLACEHOLDER = /(\[(?:LENKE|TELEFON|E-POST|KONTONUMMER|KORTNUMMER|NAVN|FIRMA)\])/;

/**
 * Handles keys before the screens do (capture phase), and stops them there, so Esc and → reach
 * only the dialog or the panel that is on top. The Intervju screen listens on `document` too.
 */
function useTopLayerKeys(onEscape: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onEscape();
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.stopImmediatePropagation(); // the screen behind must not move its own panel
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onEscape]);
}

/** While the dialog is open, the page behind it can be neither clicked nor reached with Tab. */
function useInertApp() {
  useEffect(() => {
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => root?.removeAttribute("inert");
  }, []);
}

/** The cleaned text, with each removed item shown as a token, so the owner sees what went. */
function CleanText({ text }: { text: string }) {
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">
      {text.split(PLACEHOLDER).map((part, index) =>
        PLACEHOLDER.test(part) ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder
            key={index}
            data-placeholder
            className="mx-0.5 rounded border border-stoppet/60 bg-stoppet/15 px-1 py-px text-xs font-semibold text-stoppet"
          >
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function Column({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <h3 id={id} className="mb-3 text-sm font-semibold text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Attacker({ result }: { result: ScamResult }) {
  const { customer } = result;
  return (
    <div className="space-y-3 text-sm">
      {customer.claims_to_be && (
        <p>
          <span className="text-muted">Utgir seg for å være </span>
          <span className="font-semibold text-ink">{customer.claims_to_be}</span>
        </p>
      )}
      <p className="text-muted">{customer.goal}</p>
      <blockquote className="border-l-2 border-stoppet pl-3 text-ink">
        «{customer.opening}»
      </blockquote>
      {customer.tactics.length > 0 && (
        <div>
          <p className="mb-1 text-muted">Hvis boten sier nei:</p>
          <ul className="list-disc space-y-1 pl-5 text-ink">
            {customer.tactics.map((tactic, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two tactics can read the same
              <li key={index}>{tactic}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type DialogProps = {
  result: ScamResult | null;
  onResult: (result: ScamResult | null) => void;
  onClose: () => void;
  onTest: (result: ScamResult) => void;
};

function ScamDialog({ result, onResult, onClose, onTest }: DialogProps) {
  const titleId = useId();
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const testButton = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useTopLayerKeys(onClose);
  useInertApp();

  useEffect(() => {
    (result ? testButton : field).current?.focus();
  }, [result]);

  async function send() {
    setSending(true);
    setError(null);
    try {
      onResult(await submitScam(text));
      setText(""); // REQ-6.3: only the cleaned text stays on screen
    } catch (e) {
      setError(e instanceof Error ? e.message : "Noe gikk galt. Prøv igjen.");
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-surface/80 p-4 md:p-10">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-4xl rounded-xl border border-line bg-raised p-5 shadow-2xl md:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-ink">
              Send inn svindel
            </h2>
            <p className="mt-1 max-w-prose text-sm text-muted">
              Lenker, telefonnumre, e-post, kontonumre og kortnumre fjernes før noe lagres eller
              sendes videre. Lenkene åpnes aldri.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:text-ink"
          >
            Lukk (Esc)
          </button>
        </div>

        {result === null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim() && !sending) void send();
            }}
            className="space-y-3"
          >
            <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
              Lim inn svindelmeldingen
            </label>
            <textarea
              id={fieldId}
              ref={field}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={7}
              maxLength={5000}
              placeholder="For eksempel en SMS om en pakke som står fast."
              className="w-full rounded-md border border-line bg-surface p-3 text-sm text-ink placeholder:text-muted/60 focus:border-pagar focus:outline-none"
            />
            {error && (
              <p
                role="alert"
                className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink"
              >
                {error}
              </p>
            )}
            <button type="submit" disabled={!text.trim() || sending} className={BUTTON.scam}>
              {sending ? "Renser og lager test …" : "Rens og lag test"}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Column title="Renset melding">
                <CleanText text={result.clean_text} />
              </Column>
              <Column title="Slik ville svindleren angrepet din AI">
                <Attacker result={result} />
              </Column>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                ref={testButton}
                type="button"
                onClick={() => onTest(result)}
                className={BUTTON.scam}
              >
                Test AI-en mot denne
              </button>
              <button type="button" onClick={() => onResult(null)} className={BUTTON.secondary}>
                Send inn en annen
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The chat against the submitted scam, in the right-hand panel, while it runs live. */
function ScamChat({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { state } = useRun(runId);
  const chatId = state.order[0];
  const chat = chatId ? state.chats[chatId] : undefined;
  const panel = useRef<HTMLDivElement>(null);

  useTopLayerKeys(onClose);

  // Focus the panel's «Lukk» when it opens, and again when the chat replaces the waiting text.
  const shown = chat ? "chat" : "waiting";
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shown` is the trigger
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [shown]);

  return createPortal(
    <div ref={panel} className="fixed inset-y-0 right-0 z-20 flex max-md:inset-x-0">
      {chat ? (
        <ChatPanel chat={chat} rules={state.rules} onClose={onClose} />
      ) : (
        <aside
          aria-label="Samtalen starter"
          className="flex w-full flex-col items-center justify-center gap-3 border-l border-line bg-raised p-6 md:w-[min(36rem,45vw)]"
        >
          <p className="text-sm text-muted">Samtalen med svindleren starter …</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:text-ink"
          >
            Lukk (Esc)
          </button>
        </aside>
      )}
    </div>,
    document.body,
  );
}

/** «Send inn svindel» in the step bar: the button, the dialog and the chat panel (REQ-6.7). */
export function ScamCheck() {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Kept here, so closing the dialog does not lose a result whose run has already started.
  const [result, setResult] = useState<ScamResult | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const returnFocus = useRef(false);

  // When the dialog or the panel closes, focus goes back to the button. This runs after the
  // dialog's own cleanup, so the page is no longer inert.
  useEffect(() => {
    if (!open && runId === null && returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [open, runId]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          setRunId(null); // one layer at a time: the dialog replaces an open scam chat
          setOpen(true);
        }}
        className="rounded-md border border-stoppet/70 px-2.5 py-1 text-sm font-medium text-stoppet hover:bg-stoppet/10"
      >
        Send inn svindel
      </button>
      {open && (
        <ScamDialog
          result={result}
          onResult={setResult}
          onClose={() => {
            returnFocus.current = true;
            setOpen(false);
          }}
          onTest={(tested) => {
            setOpen(false);
            setResult(null);
            setRunId(tested.run_id);
          }}
        />
      )}
      {runId && (
        <ScamChat
          key={runId}
          runId={runId}
          onClose={() => {
            returnFocus.current = true;
            setRunId(null);
          }}
        />
      )}
    </>
  );
}
