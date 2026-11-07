import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestPlan } from "../src/api/plans";
import Signeringsrett from "../src/screens/Signeringsrett";
import Stillingsannonse from "../src/screens/Stillingsannonse";
import { getSession, updateSession } from "../src/state/session";

const LIMITS = {
  max_discount_percent: 10,
  max_refund_nok: null,
  refund_original_only: true,
  hide_address_phone: true,
  allow_address_change: false,
  extra_instructions: [],
};

function plan(id: string, text: string): TestPlan {
  return {
    id,
    job_ad: `Annonse ${id}`,
    rules: [
      {
        id: "R1",
        text,
        category: "brand",
        check: { type: "judge_only", params: {} },
      },
    ],
    customers: [{ id: "A01", kind: "attack" }],
  };
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

function stubEngine(plans: Record<string, TestPlan>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === "/api/runs" && method === "POST") {
        return new Response(JSON.stringify({ run_id: "r9" }), { status: 200 });
      }
      if (url === "/api/runs") return new Response("[]", { status: 200 });
      if (url.startsWith("/api/limits")) return new Response(JSON.stringify(LIMITS));
      const found = plans[decodeURIComponent(url.replace("/api/plans/", ""))];
      return found
        ? new Response(JSON.stringify(found), { status: 200 })
        : new Response("{}", { status: 404 });
    }),
  );
}

beforeEach(() => {
  updateSession({ currentRunId: null, beforeRunId: null, afterRunId: null, planId: "demo" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  updateSession({ currentRunId: null, beforeRunId: null, afterRunId: null, planId: "demo" });
  window.history.replaceState(null, "", "/");
});

describe("the active plan", () => {
  it("is the one Signeringsrett runs again in enforce mode", async () => {
    stubEngine({});
    updateSession({ planId: "egen" });
    render(<Signeringsrett />);
    fireEvent.click(await screen.findByRole("button", { name: "Kjør intervjuet igjen" }));
    await waitFor(() => expect(getSession().afterRunId).toBe("r9"));
    const run = calls.find((call) => call.url === "/api/runs" && call.method === "POST");
    expect(run?.body).toMatchObject({ plan_id: "egen", mode: "enforce" });
    expect(calls.some((call) => call.url === "/api/limits?plan_id=egen")).toBe(true);
  });

  it("is shown by Stillingsannonse after a reload", async () => {
    stubEngine({ demo: plan("demo", "Demo-regel"), egen: plan("egen", "Egen regel") });
    updateSession({ planId: "egen" });
    render(<Stillingsannonse />);
    expect(await screen.findByDisplayValue("Egen regel")).toBeInTheDocument();
  });

  it("falls back to the demo plan when the active plan is missing", async () => {
    stubEngine({ demo: plan("demo", "Demo-regel") });
    updateSession({ planId: "borte" });
    render(<Stillingsannonse />);
    expect(await screen.findByDisplayValue("Demo-regel")).toBeInTheDocument();
    expect(getSession().planId).toBe("demo");
  });

  it("is set when Stillingsannonse builds rules", async () => {
    stubEngine({ demo: plan("demo", "Demo-regel") });
    render(<Stillingsannonse />);
    await screen.findByDisplayValue("Demo-regel");
    const built = plan("egen", "Egen regel");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(built), { status: 200 })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Lag regler" }));
    await screen.findByDisplayValue("Egen regel");
    expect(getSession().planId).toBe("egen");
  });
});

describe("a change of the active plan", () => {
  it("clears the runs, so the enforce run is not compared with a before run of another plan", async () => {
    stubEngine({ demo: plan("demo", "Demo-regel") });
    updateSession({ currentRunId: "r1", beforeRunId: "r1", afterRunId: null });
    render(<Stillingsannonse />);
    await screen.findByDisplayValue("Demo-regel");
    const built = plan("egen", "Egen regel");
    stubEngine({ egen: built });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && url === "/api/plans") {
          return new Response(JSON.stringify(built), { status: 200 });
        }
        return new Response("[]", { status: 200 });
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Lag regler" }));
    await screen.findByDisplayValue("Egen regel");
    expect(getSession()).toEqual({
      currentRunId: null,
      beforeRunId: null,
      afterRunId: null,
      planId: "egen",
    });
  });

  it("clears the runs when a missing plan gives way to the demo plan", async () => {
    stubEngine({ demo: plan("demo", "Demo-regel") });
    updateSession({ planId: "borte", currentRunId: "r1", beforeRunId: "r1" });
    render(<Stillingsannonse />);
    await screen.findByDisplayValue("Demo-regel");
    expect(getSession()).toMatchObject({ planId: "demo", currentRunId: null, beforeRunId: null });
  });
});

describe("loading the active plan", () => {
  it("keeps the active plan and shows the error when the engine fails, not a 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/plans/egen"
          ? new Response("{}", { status: 500 })
          : new Response(JSON.stringify(plan("demo", "Demo-regel")), { status: 200 }),
      ),
    );
    updateSession({ planId: "egen" });
    render(<Stillingsannonse />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(getSession().planId).toBe("egen");
  });
});
