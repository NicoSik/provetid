import type { ChatStatus } from "../events/reducer";

const CHIP_STYLES: Record<ChatStatus, string> = {
  Pågår: "bg-pagar/15 text-pagar",
  Bestått: "bg-bestatt/15 text-bestatt",
  Brudd: "bg-brudd/15 text-brudd",
  Stoppet: "bg-stoppet/15 text-stoppet",
  "Ikke testet": "bg-ikke-testet/15 text-ikke-testet",
};

export function StatusChip({ status }: { status: ChatStatus }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${CHIP_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
