import { useEffect, useState } from "react";
import { ChatCard } from "../components/ChatCard";
import { ChatPanel } from "../components/ChatPanel";
import type { RunState } from "../events/reducer";
import type { ConnectionStatus } from "../events/stream";
import { useRun } from "../events/useRun";
import { updateSession, useSession } from "../state/session";
import type { ScreenMeta } from "./registry";

export const screen: ScreenMeta = { path: "/intervju", step: 2, title: "Intervju" };

const CONNECTION_MESSAGES: Record<Exclude<ConnectionStatus, "connected">, string> = {
  lost: "Mistet kontakten med motoren. Prøver igjen …",
  missing: "Fant ikke denne kjøringen. Den kan være slettet.",
  abandoned: "Kjøringen ble avbrutt før den var ferdig. Kortene viser det som ble registrert.",
};

/** The next chat with Brudd after `currentId`, wrapping round to the first. */
function nextBreach(state: RunState, currentId: string | null): string | null {
  const start = currentId === null ? -1 : state.order.indexOf(currentId);
  const count = state.order.length;
  for (let step = 1; step <= count; step += 1) {
    const id = state.order[(start + step + count) % count];
    if (state.chats[id].status === "Brudd") return id;
  }
  return currentId;
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function RunSummaryBar({ state }: { state: RunState }) {
  const chats = state.order.map((id) => state.chats[id]);
  const countOf = (status: string) => chats.filter((chat) => chat.status === status).length;
  const total = state.chatCount ?? chats.length;
  const done = chats.filter((chat) => chat.ended).length;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
      <h1 className="text-xl font-bold text-ink">Intervju</h1>
      {state.mode && <span>{state.mode === "enforce" ? "Med grenser" : "Uten grenser"}</span>}
      <span className="tabular-nums">
        {done} av {total} samtaler ferdige
      </span>
      <span className="font-semibold text-brudd tabular-nums">{countOf("Brudd")} brudd</span>
      <span className="font-semibold text-stoppet tabular-nums">{countOf("Stoppet")} stoppet</span>
      {state.finished &&
        (state.finished.incomplete ? (
          <span className="font-semibold text-stoppet">Testen er ufullstendig</span>
        ) : (
          <span className="font-semibold text-ink">Intervjuet er ferdig</span>
        ))}
      <span className="ml-auto text-xs">→ neste brudd · Esc lukker</span>
    </div>
  );
}

/** The grid and the panel for a run state. `Intervju` below connects it to the live stream. */
export function InterviewView({
  state,
  connection = "connected",
  onForgetRun,
}: {
  state: RunState;
  connection?: ConnectionStatus;
  onForgetRun?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openChat = openId === null ? undefined : state.chats[openId];
  const waiting = state.finished ? 0 : Math.max((state.chatCount ?? 0) - state.order.length, 0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTextField(event.target)) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setOpenId((current) => nextBreach(state, current));
      } else if (event.key === "Escape") {
        setOpenId(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [state]);

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 space-y-4 overflow-y-auto p-6">
        <RunSummaryBar state={state} />
        {connection !== "connected" && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-md border border-stoppet bg-stoppet/10 p-3 text-sm text-ink"
          >
            <p>{CONNECTION_MESSAGES[connection]}</p>
            {connection === "missing" && onForgetRun && (
              <button
                type="button"
                onClick={onForgetRun}
                className="rounded-md border border-line bg-raised px-2.5 py-1 hover:bg-raised-hover"
              >
                Fjern kjøringen
              </button>
            )}
          </div>
        )}
        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-brudd bg-brudd/10 p-3 text-sm text-ink"
          >
            {state.error.message}
          </p>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
          {state.order.map((id) => (
            <ChatCard key={id} chat={state.chats[id]} selected={id === openId} onOpen={setOpenId} />
          ))}
          {Array.from({ length: waiting }, (_, slot) => `venter-${slot}`).map((key) => (
            <div
              key={key}
              aria-hidden="true"
              data-empty-slot
              className="h-36 rounded-lg border border-dashed border-line"
            />
          ))}
        </div>
      </div>
      {openChat && (
        <ChatPanel chat={openChat} rules={state.rules} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function LiveInterview({ runId }: { runId: string }) {
  const { state, connection } = useRun(runId);
  return (
    <InterviewView
      state={state}
      connection={connection}
      onForgetRun={() => updateSession({ currentRunId: null })}
    />
  );
}

export default function Intervju() {
  const { currentRunId } = useSession();

  if (currentRunId === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted">Ingen intervju er i gang.</p>
      </div>
    );
  }
  // The key starts a new run from a clean slate: no open panel and no old cards.
  return <LiveInterview key={currentRunId} runId={currentRunId} />;
}
