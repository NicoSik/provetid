import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestPlan } from "../src/api/plans";
import Stillingsannonse from "../src/screens/Stillingsannonse";
import { getSession } from "../src/state/session";

const DEMO: TestPlan = {
  id: "demo",
  job_ad: "Gir & Kjede søker en AI-medarbeider.",
  rules: [
    {
      id: "R1",
      text: "Maks 10 % rabatt",
      category: "money",
      check: { type: "max_discount", params: { percent: 10 } },
    },
  ],
  customers: [{ id: "A01", kind: "attack" }],
};

const BUILT: TestPlan = {
  id: "egen",
  job_ad: "Blomsterbutikken søker en AI. Gi aldri ut kundenes adresser.",
  rules: [
    {
      id: "R1",
      text: "Aldri gi ut kundenes adresser",
      category: "privacy",
      check: { type: "no_customer_data_leak", params: {} },
    },
    {
      id: "R2",
      text: "Vær hyggelig",
      category: "brand",
      check: { type: "judge_only", params: {} },
    },
  ],
  customers: [{ id: "A01", kind: "attack" }],
};

type Call = { url: string; method: string; body: unknown };

function stubEngine(build: { status: number; body: unknown } = { status: 200, body: BUILT }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url, method, body });
      if (method === "POST" && url === "/api/plans") {
        return new Response(JSON.stringify(build.body), { status: build.status });
      }
      if (method === "PUT") return new Response(JSON.stringify(body), { status: 200 });
      if (method === "POST" && url === "/api/runs") {
        return new Response(JSON.stringify({ run_id: "r1" }), { status: 200 });
      }
      return new Response(JSON.stringify(DEMO), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("«Lag regler» on Stillingsannonse", () => {
  it("builds rules from the edited job ad and shows them for approval", async () => {
    const calls = stubEngine();
    render(<Stillingsannonse />);
    const ad = await screen.findByRole("textbox", { name: "Annonseteksten" });
    fireEvent.change(ad, { target: { value: BUILT.job_ad } });
    fireEvent.click(screen.getByRole("button", { name: "Lag regler" }));

    expect(await screen.findByDisplayValue("Aldri gi ut kundenes adresser")).toBeVisible();
    expect(screen.getByDisplayValue("Vær hyggelig")).toBeVisible();
    expect(screen.queryByDisplayValue("Maks 10 % rabatt")).toBeNull();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ job_ad: BUILT.job_ad });
    // REQ-1.4: the owner approves the new rules before the interview can start.
    expect(screen.getByRole("button", { name: "Start intervju" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Godkjenn planen" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start intervju" })).toBeEnabled(),
    );
    expect(calls.find((c) => c.method === "PUT")?.url).toBe("/api/plans/egen");
  });

  it("starts the interview with the built plan", async () => {
    const calls = stubEngine();
    render(<Stillingsannonse />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Annonseteksten" }), {
      target: { value: BUILT.job_ad },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lag regler" }));
    await screen.findByDisplayValue("Aldri gi ut kundenes adresser");
    fireEvent.click(screen.getByRole("button", { name: "Godkjenn planen" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start intervju" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start intervju" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/runs")).toBe(true));
    expect(calls.find((c) => c.url === "/api/runs")?.body).toMatchObject({ plan_id: "egen" });
  });

  it("keeps the interview as the «før» run, so «Før og etter» finds it (#143)", async () => {
    stubEngine();
    render(<Stillingsannonse />);
    fireEvent.click(await screen.findByRole("button", { name: "Godkjenn planen" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start intervju" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start intervju" }));
    await waitFor(() => expect(getSession().currentRunId).not.toBeNull());
    const { currentRunId, beforeRunId, afterRunId } = getSession();
    expect(beforeRunId).toBe(currentRunId);
    expect(afterRunId).toBeNull();
  });

  it("shows the engine's message when no rules could be made, and keeps the old ones", async () => {
    stubEngine({
      status: 422,
      body: { detail: "Klarte ikke å lage regler fra denne annonsen. Prøv å skrive den om." },
    });
    render(<Stillingsannonse />);
    await screen.findByRole("textbox", { name: "Annonseteksten" });
    fireEvent.click(screen.getByRole("button", { name: "Lag regler" }));
    expect(
      await screen.findByText(
        "Klarte ikke å lage regler fra denne annonsen. Prøv å skrive den om.",
      ),
    ).toBeVisible();
    expect(screen.getByDisplayValue("Maks 10 % rabatt")).toBeVisible();
  });

  it("blocks the start while the ad is edited but not built, and says why", async () => {
    stubEngine();
    render(<Stillingsannonse />);
    const ad = await screen.findByRole("textbox", { name: "Annonseteksten" });
    fireEvent.change(ad, { target: { value: "En helt annen annonse." } });
    expect(screen.getByRole("button", { name: "Start intervju" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Godkjenn planen" })).toBeDisabled();
    expect(screen.getByText(/Lag regler på nytt, eller angre endringen/)).toBeVisible();
    fireEvent.change(ad, { target: { value: DEMO.job_ad } });
    expect(screen.getByRole("button", { name: "Start intervju" })).toBeEnabled();
  });

  it("says in Norwegian when the engine cannot be reached", async () => {
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (first) {
          first = false;
          return new Response(JSON.stringify(DEMO), { status: 200 });
        }
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<Stillingsannonse />);
    await screen.findByRole("textbox", { name: "Annonseteksten" });
    fireEvent.click(screen.getByRole("button", { name: "Lag regler" }));
    expect(await screen.findByText("Fikk ikke kontakt med motoren.")).toBeVisible();
  });

  it("locks the plan buttons and tells screen readers while it builds", async () => {
    let release: (value: Response) => void = () => {};
    let first = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (first) {
          first = false;
          return new Response(JSON.stringify(DEMO), { status: 200 });
        }
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    render(<Stillingsannonse />);
    const ad = await screen.findByRole("textbox", { name: "Annonseteksten" });
    fireEvent.click(screen.getByRole("button", { name: "Lag regler" }));
    expect(screen.getByRole("button", { name: "Lager regler …" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Godkjenn planen" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start intervju" })).toBeDisabled();
    expect(ad).toHaveAttribute("aria-busy", "true");
    expect(ad).toHaveAttribute("readonly");
    release(new Response(JSON.stringify(BUILT), { status: 200 }));
    expect(await screen.findByText("2 nye regler. Godkjenn dem før du starter.")).toBeVisible();
  });

  it("cannot build from an empty ad", async () => {
    stubEngine();
    render(<Stillingsannonse />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Annonseteksten" }), {
      target: { value: " " },
    });
    expect(screen.getByRole("button", { name: "Lag regler" })).toBeDisabled();
  });
});
