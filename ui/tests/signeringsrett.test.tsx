import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLimits, type Limits, putLimits } from "../src/api/limits";
import Signeringsrett, { screen as meta } from "../src/screens/Signeringsrett";
import { getSession, updateSession } from "../src/state/session";

const SAVED: Limits = {
  max_discount_percent: 10,
  max_refund_nok: null,
  refund_original_only: true,
  hide_address_phone: true,
  allow_address_change: false,
  extra_instructions: [],
};

const PLAN_RULES = [
  {
    id: "R1",
    text: "Maks 10 % rabatt",
    category: "money",
    check: { type: "max_discount", params: { percent: 10 } },
  },
  {
    id: "R2",
    text: "Aldri gi ut kundedata",
    category: "privacy",
    check: { type: "no_customer_data_leak", params: {} },
  },
  {
    id: "R3",
    text: "Refusjon bare til opprinnelig betalingsmåte",
    category: "money",
    check: { type: "refund_original_only", params: {} },
  },
  {
    id: "R7",
    text: "Aldri endre leveringsadressen",
    category: "privacy",
    check: { type: "tool_not_allowed", params: { tool: "change_delivery_address" } },
  },
];

type Call = { url: string; method: string; body: unknown };

let calls: Call[];

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

type RunRow = { run_id: string; plan_id: string; mode: string; finished: boolean };

function stubEngine(
  options: {
    limits?: Limits;
    run?: number;
    put?: number;
    get?: number;
    runs?: RunRow[];
    listStatus?: number;
    plan?: number;
  } = {},
) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === "/api/limits" && method === "GET") {
        return jsonResponse(options.limits ?? SAVED, options.get ?? 200);
      }
      if (url.startsWith("/api/limits") && method === "PUT")
        return jsonResponse(body, options.put ?? 200);
      if (url === "/api/runs" && method === "GET") {
        return jsonResponse(options.runs ?? [], options.listStatus ?? 200);
      }
      if (url === "/api/runs") return jsonResponse({ run_id: "r2" }, options.run ?? 200);
      if (url.startsWith("/api/plans/") && method === "GET") {
        return jsonResponse(
          { id: "demo", job_ad: "", rules: PLAN_RULES, customers: [] },
          options.plan ?? 200,
        );
      }
      throw new Error(`Uventet kall: ${url}`);
    }),
  );
}

async function openScreen() {
  render(<Signeringsrett />);
  return screen.findByRole("button", { name: "Kjør intervjuet igjen" });
}

function runCall() {
  return calls.find((call) => call.url === "/api/runs" && call.method === "POST");
}

function discount() {
  return screen.getByLabelText("Maks rabatt (prosent)");
}

beforeEach(() => {
  stubEngine();
  updateSession({ currentRunId: null, beforeRunId: null, afterRunId: null });
  window.history.replaceState(null, "", "/#/signeringsrett");
});

afterEach(() => {
  vi.unstubAllGlobals();
  updateSession({ currentRunId: null, beforeRunId: null, afterRunId: null });
  window.history.replaceState(null, "", "/");
});

describe("the screen", () => {
  it("is step 4", () => {
    expect(meta).toEqual({ path: "/signeringsrett", step: 4, title: "Signeringsrett" });
  });

  it("shows every lock of REQ-5.6 with the saved values", async () => {
    await openScreen();
    expect(discount()).toHaveValue("10");
    expect(screen.getByLabelText("Maks refusjon (kroner)")).toHaveValue("");
    expect(screen.getByLabelText("Refusjon bare til opprinnelig betaling")).toBeChecked();
    expect(screen.getByLabelText("Skjul adresse og telefonnummer")).toBeChecked();
    expect(screen.getByLabelText("Stopp adresseendringer")).toBeChecked();
  });

  it("describes what the limits do, never the bot as a person with rights", async () => {
    await openScreen();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Signeringsrett");
    expect(text).not.toMatch(/rettigheter|ansatt med/i);
  });
});

describe("locks and rules", () => {
  it("ticks every lock the same way: ticked means locked", async () => {
    await openScreen();
    for (const name of [
      "Refusjon bare til opprinnelig betaling",
      "Skjul adresse og telefonnummer",
      "Stopp adresseendringer",
    ]) {
      expect(screen.getByLabelText(name)).toBeChecked();
    }
  });

  it("names the rules each lock enforces", async () => {
    await openScreen();
    await waitFor(() =>
      expect(screen.getByLabelText("Maks rabatt (prosent)")).toHaveAccessibleDescription(
        "Gjelder R1",
      ),
    );
    expect(
      screen.getByLabelText("Refusjon bare til opprinnelig betaling"),
    ).toHaveAccessibleDescription("Gjelder R3");
    expect(screen.getByLabelText("Skjul adresse og telefonnummer")).toHaveAccessibleDescription(
      "Gjelder R2",
    );
    expect(screen.getByLabelText("Stopp adresseendringer")).toHaveAccessibleDescription(
      "Gjelder R7",
    );
    expect(screen.getByLabelText("Maks refusjon (kroner)")).not.toHaveAccessibleDescription(
      /Gjelder/,
    );
  });

  it("sends address changes as allowed or stopped, both ways", async () => {
    stubEngine({ limits: { ...SAVED, allow_address_change: true } });
    const run = await openScreen();
    const stop = screen.getByLabelText("Stopp adresseendringer");
    expect(stop).not.toBeChecked();
    fireEvent.click(stop);
    fireEvent.click(run);
    await waitFor(() => expect(runCall()).toBeDefined());
    expect(runCall()?.body).toMatchObject({ limits: { allow_address_change: false } });
  });

  it("still shows the locks when the plan cannot be fetched", async () => {
    stubEngine({ plan: 500 });
    await openScreen();
    expect(screen.getByLabelText("Stopp adresseendringer")).toBeChecked();
    expect(screen.queryByText(/Gjelder/)).toBeNull();
  });
});

describe("«Kjør intervjuet igjen»", () => {
  it("sends the new discount and mode enforce in the run request", async () => {
    const run = await openScreen();
    fireEvent.change(discount(), { target: { value: "5" } });
    fireEvent.click(run);
    await waitFor(() => expect(runCall()).toBeDefined());
    expect(runCall()?.method).toBe("POST");
    expect(runCall()?.body).toMatchObject({
      plan_id: "demo",
      mode: "enforce",
      limits: { ...SAVED, max_discount_percent: 5 },
    });
  });

  it("saves the limits only after the run has started", async () => {
    const run = await openScreen();
    fireEvent.change(discount(), { target: { value: "5" } });
    fireEvent.click(run);
    await waitFor(() => expect(window.location.hash).toBe("#/intervju"));
    const put = calls.findIndex((call) => call.method === "PUT");
    const start = calls.findIndex((call) => call === runCall());
    expect(put).toBeGreaterThan(start);
    expect(calls[put].body).toMatchObject({ max_discount_percent: 5 });
  });

  it("sends each lock the owner changed", async () => {
    const run = await openScreen();
    fireEvent.change(screen.getByLabelText("Maks refusjon (kroner)"), { target: { value: "500" } });
    fireEvent.click(screen.getByLabelText("Refusjon bare til opprinnelig betaling"));
    fireEvent.click(screen.getByLabelText("Skjul adresse og telefonnummer"));
    fireEvent.click(screen.getByLabelText("Stopp adresseendringer"));
    fireEvent.click(run);
    await waitFor(() => expect(runCall()).toBeDefined());
    expect(runCall()?.body).toMatchObject({
      limits: {
        max_refund_nok: 500,
        refund_original_only: false,
        hide_address_phone: false,
        allow_address_change: true,
      },
    });
  });

  it("sends an empty field as no limit", async () => {
    const run = await openScreen();
    fireEvent.change(discount(), { target: { value: "" } });
    fireEvent.click(run);
    await waitFor(() => expect(runCall()).toBeDefined());
    expect(runCall()?.body).toMatchObject({ limits: { max_discount_percent: null } });
  });

  it("opens the Intervju screen on the new run, with an observe run as the before run", async () => {
    stubEngine({ runs: [{ run_id: "r1", plan_id: "demo", mode: "observe", finished: true }] });
    updateSession({ currentRunId: "r1" });
    const run = await openScreen();
    fireEvent.click(run);
    await waitFor(() => expect(window.location.hash).toBe("#/intervju"));
    expect(getSession()).toEqual({
      currentRunId: "r2",
      beforeRunId: "r1",
      afterRunId: "r2",
      planId: "demo",
    });
  });

  it("never makes a run with limits the before run", async () => {
    stubEngine({ runs: [{ run_id: "r1", plan_id: "demo", mode: "enforce", finished: true }] });
    updateSession({ currentRunId: "r1" });
    const run = await openScreen();
    fireEvent.click(run);
    await waitFor(() => expect(window.location.hash).toBe("#/intervju"));
    expect(getSession()).toEqual({
      currentRunId: "r2",
      beforeRunId: null,
      afterRunId: "r2",
      planId: "demo",
    });
  });

  it("leaves the before run empty when it cannot tell the mode, and still starts", async () => {
    stubEngine({ listStatus: 500 });
    updateSession({ currentRunId: "r1" });
    const run = await openScreen();
    fireEvent.click(run);
    await waitFor(() => expect(window.location.hash).toBe("#/intervju"));
    expect(getSession().beforeRunId).toBeNull();
  });

  it("keeps the first before run when the owner runs it a third time", async () => {
    updateSession({ currentRunId: "r2", beforeRunId: "r1", afterRunId: "r2" });
    const run = await openScreen();
    fireEvent.click(run);
    await waitFor(() => expect(window.location.hash).toBe("#/intervju"));
    expect(getSession().beforeRunId).toBe("r1");
  });

  it("starts one run when the driver clicks twice", async () => {
    const run = await openScreen();
    fireEvent.click(run);
    fireEvent.click(run);
    await waitFor(() => expect(window.location.hash).toBe("#/intervju"));
    expect(calls.filter((call) => call === runCall() || call.method === "POST")).toHaveLength(1);
  });

  it("stays on the screen and says so when the run cannot start", async () => {
    stubEngine({ run: 404 });
    const run = await openScreen();
    fireEvent.click(run);
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunne ikke starte intervjuet");
    expect(window.location.hash).toBe("#/signeringsrett");
    expect(getSession().currentRunId).toBeNull();
    expect(run).toBeEnabled();
  });

  it("saves nothing when the run cannot start, so a failed click freezes no limits", async () => {
    stubEngine({ run: 404 });
    const run = await openScreen();
    fireEvent.click(run);
    await screen.findByRole("alert");
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("still opens the run when only the save fails", async () => {
    stubEngine({ put: 500 });
    const run = await openScreen();
    fireEvent.click(run);
    await waitFor(() => expect(window.location.hash).toBe("#/intervju"));
    expect(getSession().currentRunId).toBe("r2");
  });
});

describe("invalid values", () => {
  it.each([
    ["Maks rabatt (prosent)", "-1"],
    ["Maks rabatt (prosent)", "101"],
    ["Maks rabatt (prosent)", "2.5"],
    ["Maks refusjon (kroner)", "-1"],
    ["Maks refusjon (kroner)", "1.5"],
    ["Maks rabatt (prosent)", "5e"],
    ["Maks rabatt (prosent)", "-"],
    ["Maks rabatt (prosent)", "mye"],
    ["Maks refusjon (kroner)", "1e3"],
    ["Maks refusjon (kroner)", "9".repeat(400)],
    ["Maks refusjon (kroner)", "9007199254740993"],
  ])("%s with %s blocks the run and says why", async (label, value) => {
    const run = await openScreen();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(run).toBeDisabled();
    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(/heltall/);
    fireEvent.click(run);
    expect(runCall()).toBeUndefined();
  });

  it("never turns text that is no number into no limit", async () => {
    const run = await openScreen();
    fireEvent.change(discount(), { target: { value: "5e" } });
    expect(discount()).toHaveValue("5e");
    expect(run).toBeDisabled();
  });

  it("accepts the edges, 0 and 100", async () => {
    const run = await openScreen();
    fireEvent.change(discount(), { target: { value: "100" } });
    expect(run).toBeEnabled();
    fireEvent.change(discount(), { target: { value: "0" } });
    expect(run).toBeEnabled();
  });
});

describe("the sentences", () => {
  const AI = "Si at du er en AI når noen spør.";

  it("has a toggle for each suggested sentence, off when none is saved", async () => {
    await openScreen();
    for (const sentence of [
      "Send reklamasjoner videre til eieren.",
      "Si at kunden har 14 dagers angrerett ved kjøp på nett.",
      AI,
    ]) {
      expect(screen.getByLabelText(sentence)).not.toBeChecked();
    }
  });

  it("sends the sentences that are on", async () => {
    const run = await openScreen();
    fireEvent.click(screen.getByLabelText(AI));
    fireEvent.click(run);
    await waitFor(() => expect(runCall()).toBeDefined());
    expect(runCall()?.body).toMatchObject({ limits: { extra_instructions: [AI] } });
  });

  it("shows a saved sentence as on, and turning it off removes it", async () => {
    stubEngine({ limits: { ...SAVED, extra_instructions: [AI] } });
    const run = await openScreen();
    expect(screen.getByLabelText(AI)).toBeChecked();
    fireEvent.click(screen.getByLabelText(AI));
    fireEvent.click(run);
    await waitFor(() => expect(runCall()).toBeDefined());
    expect(runCall()?.body).toMatchObject({ limits: { extra_instructions: [] } });
  });

  it("gets a toggle for a saved sentence from elsewhere, such as the report card, and keeps it", async () => {
    const other = "Vær høflig og kort.";
    stubEngine({ limits: { ...SAVED, extra_instructions: [other] } });
    const run = await openScreen();
    expect(screen.getByLabelText(other)).toBeChecked();
    fireEvent.click(screen.getByLabelText(AI));
    fireEvent.click(run);
    await waitFor(() => expect(runCall()).toBeDefined());
    expect(runCall()?.body).toMatchObject({ limits: { extra_instructions: [other, AI] } });
  });
});

describe("when there is no engine", () => {
  it("says so when the limits cannot load, and offers no run", async () => {
    stubEngine({ get: 500 });
    render(<Signeringsrett />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Fikk ikke kontakt med motoren");
    expect(screen.queryByRole("button", { name: "Kjør intervjuet igjen" })).not.toBeInTheDocument();
  });

  it("says that the screen needs the engine during a replay, and calls nothing", async () => {
    window.history.replaceState(null, "", "/?replay=before#/signeringsrett");
    render(<Signeringsrett />);
    await act(async () => {});
    expect(screen.getByText(/ikke tilgjengelig under avspilling/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Kjør intervjuet igjen" })).not.toBeInTheDocument();
  });
});

describe("the API client", () => {
  it("reads and writes the limits", async () => {
    await expect(getLimits()).resolves.toEqual(SAVED);
    await putLimits({ ...SAVED, max_discount_percent: 5 }, "egen");
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("/api/limits?plan_id=egen");
    expect(put?.body).toMatchObject({ max_discount_percent: 5 });
  });
});

describe("per plan", () => {
  const OTHER: Limits = { ...SAVED, max_discount_percent: 3 };

  function stubPlans(gone: string[] = []) {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, method, body });
        if (url.startsWith("/api/limits") && method === "GET") {
          const plan = new URLSearchParams(url.split("?")[1]).get("plan_id") ?? "demo";
          if (gone.includes(plan)) return jsonResponse({}, 404);
          return jsonResponse(plan === "demo" ? SAVED : OTHER);
        }
        if (url.startsWith("/api/limits")) return jsonResponse(body);
        if (url === "/api/runs" && method === "GET") return jsonResponse([]);
        if (url === "/api/runs") return jsonResponse({ run_id: "r2" });
        throw new Error(`Uventet kall: ${url}`);
      }),
    );
  }

  afterEach(() => updateSession({ planId: "demo" }));

  it("loads and saves the limits of the active plan", async () => {
    stubPlans();
    updateSession({ planId: "egen" });
    const run = await openScreen();
    expect(discount()).toHaveValue("3");
    expect(calls[0].url).toBe("/api/limits?plan_id=egen");
    fireEvent.click(run);
    await waitFor(() => expect(window.location.hash).toBe("#/intervju"));
    const put = calls.find((call) => call.method === "PUT");
    expect(put?.url).toBe("/api/limits?plan_id=egen");
  });

  it("falls back to the demo plan when the stored plan is gone", async () => {
    stubPlans(["borte"]);
    updateSession({ planId: "borte", currentRunId: "r9", beforeRunId: "r8", afterRunId: "r9" });
    await openScreen();
    expect(discount()).toHaveValue("10");
    expect(getSession()).toEqual({
      currentRunId: null,
      beforeRunId: null,
      afterRunId: null,
      planId: "demo",
    });
  });

  it("does not fall back on an error that is not a 404", async () => {
    stubEngine({ get: 500 });
    updateSession({ planId: "egen" });
    render(<Signeringsrett />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Fikk ikke kontakt med motoren");
    expect(getSession().planId).toBe("egen");
  });
});
