import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateSession, useSession } from "../src/state/session";

function ShowRun() {
  return <p>{useSession().currentRunId ?? "ingen"}</p>;
}

/** Load a fresh copy of the store, as a page reload does. */
async function loadStore() {
  vi.resetModules();
  return import("../src/state/session");
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("the session store", () => {
  it("starts empty", async () => {
    const { getSession } = await loadStore();
    expect(getSession()).toEqual({
      currentRunId: null,
      beforeRunId: null,
      afterRunId: null,
      planId: "demo",
    });
  });

  it("keeps the active plan through a page reload", async () => {
    const first = await loadStore();
    first.updateSession({ planId: "egen" });
    const second = await loadStore();
    expect(second.getSession().planId).toBe("egen");
  });

  it("updates the components that use it", () => {
    updateSession({ currentRunId: null });
    render(<ShowRun />);
    expect(screen.getByText("ingen")).toBeInTheDocument();
    act(() => updateSession({ currentRunId: "r1" }));
    expect(screen.getByText("r1")).toBeInTheDocument();
  });

  it("keeps the run through a page reload, so a reload on stage rejoins the run", async () => {
    const first = await loadStore();
    first.updateSession({ currentRunId: "r1", beforeRunId: "r1" });
    const second = await loadStore();
    expect(second.getSession().currentRunId).toBe("r1");
    expect(second.getSession().beforeRunId).toBe("r1");
  });

  it("still works when the browser blocks storage or holds broken data", async () => {
    sessionStorage.setItem("provetid.session", "ikke json");
    const broken = await loadStore();
    expect(broken.getSession().currentRunId).toBeNull();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blokkert");
    });
    broken.updateSession({ currentRunId: "r2" });
    expect(broken.getSession().currentRunId).toBe("r2");
  });
});
