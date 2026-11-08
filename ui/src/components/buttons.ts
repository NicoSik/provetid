// One small set of action buttons (#138). Every variant has the same size, so the colour alone
// says what a button does: blue to go on, outline for a side step, red only to dismiss the AI,
// and orange only inside the scam flow. The step bar's own «Send inn svindel» and small utility
// buttons such as «Lukk (Esc)» are header controls, not action buttons, and stay smaller.
const BASE =
  "inline-flex items-center justify-center rounded-md px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50";

export const BUTTON = {
  primary: `${BASE} bg-pagar text-surface hover:opacity-90`,
  secondary: `${BASE} border border-line bg-raised text-ink hover:bg-raised-hover`,
  danger: `${BASE} bg-brudd text-surface hover:opacity-90`,
  scam: `${BASE} bg-stoppet text-surface hover:opacity-90`,
} as const;
