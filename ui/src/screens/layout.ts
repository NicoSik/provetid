// One frame for every step except the interview grid, so the heading and the left edge stay put
// when the owner moves between steps (#121). The frame is wide enough for the report-card table and
// the two columns of «Før og etter».
export const PAGE = "mx-auto w-full max-w-4xl p-6";

// Forms and running text inside the frame keep a readable line length, aligned to the frame's left.
export const PROSE = "max-w-2xl";
