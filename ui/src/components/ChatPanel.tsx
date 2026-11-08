import { type ReactNode, useLayoutEffect, useRef } from "react";
import type { ChatStatus, ChatView, TimelineItem } from "../events/reducer";
import type {
  ChatEndedData,
  LeakData,
  Outcome,
  Rule,
  RuleResult,
  ToolCallData,
} from "../events/types";
import { StatusChip } from "./StatusChip";

const OUTCOME_STATUS: Record<Outcome, ChatStatus> = {
  pass: "Bestått",
  fail: "Brudd",
  blocked: "Stoppet",
  not_tested: "Ikke testet",
};

// The worst results come first, so the proof is on top when the panel opens.
const OUTCOME_ORDER: Outcome[] = ["fail", "blocked", "not_tested", "pass"];

const END_REASONS: Record<ChatEndedData["reason"], string> = {
  done: "Samtalen er ferdig.",
  max_turns: "Samtalen nådde grensen for antall meldinger.",
  refused: "Modellen nektet å spille testkunden. Samtalen teller ikke som testet.",
  error: "Samtalen stoppet på grunn av en feil.",
  timeout: "Samtalen brukte for lang tid og ble stoppet.",
};

const LEAK_FIELDS: Record<LeakData["field"], string> = {
  name: "navn",
  phone: "telefonnummer",
  email: "e-post",
  address: "adresse",
};

const DECISIONS: Record<ToolCallData["decision"], { label: string; style: string }> = {
  allowed: { label: "Tillatt", style: "bg-bestatt/15 text-bestatt" },
  flagged: { label: "Brudd", style: "bg-brudd/15 text-brudd" },
  blocked: { label: "Stoppet", style: "bg-stoppet/15 text-stoppet" },
};

function ResultLine({ result, rule }: { result: RuleResult; rule: Rule | undefined }) {
  return (
    <li className="rounded-md border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink">
          {rule ? (
            <>
              <span className="mr-2 text-muted tabular-nums">{rule.id}</span>
              <span>{rule.text}</span>
            </>
          ) : (
            <>
              <span data-dev>{result.rule_id}</span>
              <span data-scene>En regel</span>
            </>
          )}
        </p>
        <StatusChip status={OUTCOME_STATUS[result.outcome]} />
      </div>
      {result.quote && (
        <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm text-ink italic">
          «{result.quote}»
        </blockquote>
      )}
      {result.explanation && <p className="mt-2 text-sm text-muted">{result.explanation}</p>}
    </li>
  );
}

function ToolCallLine({ call }: { call: ToolCallData }) {
  const decision = DECISIONS[call.decision];
  return (
    <li className="rounded-md border border-line px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-ink/85">{call.result_summary}</p>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${decision.style}`}
        >
          {decision.label}
        </span>
      </div>
      <code data-dev className="mt-1 block break-words text-xs text-muted">
        {call.tool}({JSON.stringify(call.input)})
      </code>
    </li>
  );
}

function LeakLine({ leak }: { leak: LeakData }) {
  const stopped = leak.blocked;
  return (
    <li
      className={`rounded-md border px-3 py-2 text-sm ${
        stopped ? "border-stoppet bg-stoppet/10" : "border-brudd bg-brudd/10"
      }`}
    >
      <p className={`font-semibold ${stopped ? "text-stoppet" : "text-brudd"}`}>
        {stopped ? "Lekkasje stoppet" : "Lekkasje"}: {LEAK_FIELDS[leak.field]}
      </p>
      <p className="mt-1 text-ink/85">{leak.excerpt}</p>
    </li>
  );
}

function TimelineLine({ item, proofIndexes }: { item: TimelineItem; proofIndexes: Set<number> }) {
  if (item.kind === "tool_call") return <ToolCallLine call={item.call} />;
  if (item.kind === "leak") return <LeakLine leak={item.leak} />;

  const { role, text, index } = item.message;
  const isBot = role === "bot";
  const isProof = proofIndexes.has(index);
  return (
    <li className={`flex flex-col ${isBot ? "items-start" : "items-end"}`}>
      <span className="mb-0.5 text-xs text-muted">{isBot ? "Bot" : "Kunde"}</span>
      <p
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-ink ${
          isBot ? "bg-raised-hover" : "bg-pagar/15"
        } ${isProof ? "ring-2 ring-brudd" : ""}`}
      >
        {text}
      </p>
    </li>
  );
}

// Room for rounding only, so that a small nudge up counts as scrolling away.
const AT_BOTTOM_PX = 8;

function isAtBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= AT_BOTTOM_PX;
}

/**
 * Follows new lines while the reader is at the bottom, and leaves a reader who scrolled up alone.
 * A long chat opens at the top. When a rule break arrives for a reader who follows, it goes to the
 * top, because the proof is there.
 */
function FollowingScroll({
  lines,
  hasBreak,
  children,
}: {
  lines: string;
  hasBreak: boolean;
  children: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(false);
  const hadBreak = useRef(hasBreak);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `lines` says when the content grew.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (following.current) element.scrollTop = element.scrollHeight;
    following.current = isAtBottom(element);
  }, [lines]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && hasBreak && !hadBreak.current && following.current) {
      element.scrollTop = 0;
      following.current = false;
    }
    hadBreak.current = hasBreak;
  }, [hasBreak]);

  return (
    <div
      ref={scroller}
      onScroll={(event) => {
        following.current = isAtBottom(event.currentTarget);
      }}
      className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4"
    >
      {children}
    </div>
  );
}

type Props = {
  chat: ChatView;
  rules: Rule[];
  onClose: () => void;
};

export function ChatPanel({ chat, rules, onClose }: Props) {
  const results = Object.values(chat.results).sort(
    (a, b) => OUTCOME_ORDER.indexOf(a.outcome) - OUTCOME_ORDER.indexOf(b.outcome),
  );
  const proofIndexes = new Set(
    results.flatMap((result) =>
      result.outcome === "fail" && result.message_index !== null ? [result.message_index] : [],
    ),
  );

  const lines = [chat.timeline.length, chat.endReason, chat.error?.message].join("|");
  const hasBreak = results.some((result) => result.outcome === "fail");

  return (
    <aside
      aria-label={`Samtale med ${chat.name}`}
      className="flex h-full w-full flex-col border-l border-line bg-raised max-md:fixed max-md:inset-0 max-md:z-10 md:w-[min(36rem,45vw)] md:shrink-0"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-bold text-ink">{chat.name}</h2>
            <StatusChip status={chat.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted">{chat.label}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:text-ink"
        >
          Lukk (Esc)
        </button>
      </div>

      {/* The key resets the scroll position when → moves to another chat. */}
      <FollowingScroll key={chat.id} lines={lines} hasBreak={hasBreak}>
        {results.length > 0 && (
          <section aria-label="Resultat">
            <ul className="space-y-2">
              {results.map((result) => (
                <ResultLine
                  key={result.rule_id}
                  result={result}
                  rule={rules.find((rule) => rule.id === result.rule_id)}
                />
              ))}
            </ul>
            {chat.summary && <p className="mt-2 text-sm text-muted">{chat.summary}</p>}
          </section>
        )}

        <section aria-label="Samtalen">
          <ul className="space-y-3">
            {chat.timeline.map((item) => (
              <TimelineLine key={item.seq} item={item} proofIndexes={proofIndexes} />
            ))}
          </ul>
          {chat.error && (
            <p className="mt-3 text-sm text-brudd">
              <span data-dev>{chat.error.message}</span>
              <span data-scene>
                Noe gikk galt i denne samtalen. Regler uten bevis er ikke testet.
              </span>
            </p>
          )}
          {chat.endReason && (
            <p className="mt-3 text-center text-xs text-muted">{END_REASONS[chat.endReason]}</p>
          )}
        </section>
      </FollowingScroll>
    </aside>
  );
}
