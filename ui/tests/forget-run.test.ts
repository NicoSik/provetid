import { afterEach, describe, expect, it } from "vitest";
import { forgetRun, getSession, updateSession } from "../src/state/session";

// #143: «Fjern kjøringen» must not leave «Før og etter» pointing at the run it removed.
afterEach(() => updateSession({ currentRunId: null, beforeRunId: null, afterRunId: null }));

describe("forgetRun", () => {
  it("clears the run everywhere it is used", () => {
    updateSession({ currentRunId: "r1", beforeRunId: "r1", afterRunId: null });
    forgetRun();
    expect(getSession()).toMatchObject({ currentRunId: null, beforeRunId: null, afterRunId: null });
  });

  it("keeps another run as «før» when the removed run was the «etter» run", () => {
    updateSession({ currentRunId: "r2", beforeRunId: "r1", afterRunId: "r2" });
    forgetRun();
    expect(getSession()).toMatchObject({ currentRunId: null, beforeRunId: "r1", afterRunId: null });
  });
});
