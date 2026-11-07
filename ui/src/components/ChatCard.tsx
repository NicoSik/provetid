import { memo } from "react";
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
  onOpen: (id: string) => void;
};

// The reducer keeps an unchanged chat as the same object, so one event redraws one card.
export const ChatCard = memo(function ChatCard({ chat, selected, onOpen }: Props) {
  const last = chat.messages[chat.messages.length - 1];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onOpen(chat.id)}
      className={`flex h-36 w-full flex-col gap-1.5 rounded-lg border bg-raised p-3 text-left transition-colors hover:bg-raised-hover ${
        CARD_BORDERS[chat.status]
      } ${selected ? "outline-2 outline-offset-2 outline-pagar" : ""}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-ink">{chat.name}</span>
        <StatusChip status={chat.status} />
      </span>
      <span className="truncate text-xs text-muted">
        {KIND_LABELS[chat.kind]} · {chat.label}
      </span>
      <span className="mt-auto line-clamp-3 text-sm leading-snug text-ink/85">
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
