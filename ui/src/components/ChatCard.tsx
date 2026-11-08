import { memo, useEffect, useRef } from "react";
import type { ChatStatus, ChatView } from "../events/reducer";
import type { CustomerKind } from "../events/types";
import { StatusChip } from "./StatusChip";

const KIND_LABELS: Record<CustomerKind, string> = {
  normal: "Vanlig",
  attack: "Angriper",
  scam: "Svindel",
};

const CARD_BORDERS: Record<ChatStatus, string> = {
  Pågår: "border-line",
  Bestått: "border-line",
  Brudd: "border-brudd shadow-[0_0_0_1px_var(--color-brudd)]",
  Stoppet: "border-stoppet",
  "Ikke testet": "border-line border-dashed",
};

type Props = {
  chat: ChatView;
  selected: boolean;
  /** Changes each time the driver presses →, also if the selection stays on this card. */
  scrollSignal?: number;
  /** True when no chat panel is open, so a card that turns Brudd may scroll into view. */
  revealBreak?: boolean;
  onOpen: (id: string) => void;
};

// The reducer keeps an unchanged chat as the same object, so one event redraws one card.
export const ChatCard = memo(function ChatCard({
  chat,
  selected,
  scrollSignal = 0,
  revealBreak = false,
  onOpen,
}: Props) {
  const last = chat.messages[chat.messages.length - 1];
  const card = useRef<HTMLButtonElement>(null);

  // → can select a card below the fold, and a keyboard-only driver must see where it went.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `scrollSignal` is the trigger.
  useEffect(() => {
    if (selected) card.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected, scrollSignal]);

  // On stage, a card below the fold must not turn red unseen (#122). Only in Scene-modus, so a
  // reader who scrolled during a run at the desk stays where they are.
  const shownStatus = useRef(chat.status);
  useEffect(() => {
    const turnedRed = chat.status === "Brudd" && shownStatus.current !== "Brudd";
    shownStatus.current = chat.status;
    const onStage = document.documentElement.classList.contains("scene");
    if (turnedRed && revealBreak && onStage) {
      card.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
  }, [chat.status, revealBreak]);

  return (
    <button
      ref={card}
      type="button"
      aria-pressed={selected}
      onClick={() => onOpen(chat.id)}
      className={`flex h-36 w-full flex-col gap-1.5 rounded-lg border bg-raised p-3 text-left transition-colors hover:bg-raised-hover ${
        CARD_BORDERS[chat.status]
      } ${selected ? "outline-2 outline-offset-2 outline-pagar" : ""}`}
    >
      {/* The name gets the whole row, so the status pill never cuts it off (#138). */}
      <span className="truncate font-semibold text-ink">{chat.name}</span>
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted">
          {KIND_LABELS[chat.kind]} · {chat.label}
        </span>
        <StatusChip status={chat.status} />
      </span>
      <span className="line-clamp-3 text-sm leading-snug text-ink/85">
        {last ? (
          <>
            <span className="text-muted">{last.role === "bot" ? "Bot: " : "Kunde: "}</span>
            {last.text}
          </>
        ) : (
          <span className="text-muted">Venter på første melding …</span>
        )}
      </span>
    </button>
  );
});
