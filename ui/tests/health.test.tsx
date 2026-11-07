import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Health as HealthAnswer } from "../src/api/health";
import Health, { screen as meta } from "../src/screens/Health";

const HOUR_MS = 3_600_000;

const READY: HealthAnswer = {
  claude: {
    checked: true,
    installed: true,
    version: "2.1.319",
    version_ok: true,
    logged_in: true,
  },
  usage: { last_limit_at: null },
  demo_plan: true,
  replays: { before: true, after: true, scam: true },
};

function stubEngine(answer: Partial<HealthAnswer>) {
  const fetchMock = vi.fn(
    async (_url: string) => new Response(JSON.stringify({ ...READY, ...answer }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function claude(fields: Partial<HealthAnswer["claude"]>) {
  return { claude: { ...READY.claude, ...fields } };
}

/** The row with this name: its state word and its detail line. */
async function row(name: string) {
  return within((await screen.findByRole("heading", { name })).closest("li") as HTMLElement);
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Health page", () => {
  it("is at /health and stays out of the step bar", () => {
    expect(meta).toEqual({ path: "/health", step: null, title: "Klarsjekk" });
  });

  it("reads /api/health and shows four OK rows on a ready laptop", async () => {
    const fetchMock = stubEngine({});
    render(<Health />);
    for (const name of ["Claude", "Bruksgrense", "Demoplan", "Avspillinger"]) {
      expect((await row(name)).getByText("OK")).toBeVisible();
    }
    expect(fetchMock.mock.calls[0][0]).toBe("/api/health");
    expect((await row("Claude")).getByText(/2\.1\.319/)).toBeVisible();
  });

  it("says that Claude was not checked with the fake transport", async () => {
    stubEngine(
      claude({
        checked: false,
        installed: null,
        version: null,
        version_ok: null,
        logged_in: null,
      }),
    );
    render(<Health />);
    const claudeRow = await row("Claude");
    expect(claudeRow.getByText("Ikke sjekket")).toBeVisible();
    expect(claudeRow.getByText(/testmodus/i)).toBeVisible();
  });

  it.each([
    ["not installed", { installed: false, version: null, version_ok: null }, /ikke installert/i],
    ["too old", { version: "2.1.300", version_ok: false }, /2\.1\.300.*for gammel/i],
    ["logged out", { logged_in: false }, /ikke logget inn/i],
  ])("marks Claude as a failure when %s", async (_name, fields, detail) => {
    stubEngine(claude(fields));
    render(<Health />);
    const claudeRow = await row("Claude");
    expect(claudeRow.getByText("Feil")).toBeVisible();
    expect(claudeRow.getByText(detail)).toBeVisible();
  });

  it("warns when the version could not be read, and does not blame the login", async () => {
    stubEngine(claude({ installed: null, version: null, version_ok: null, logged_in: null }));
    render(<Health />);
    const claudeRow = await row("Claude");
    expect(claudeRow.getByText("Sjekk")).toBeVisible();
    expect(claudeRow.getByText(/kunne ikke lese versjonen/i)).toBeVisible();
  });

  it("warns when the login could not be confirmed", async () => {
    stubEngine(claude({ logged_in: null }));
    render(<Health />);
    const claudeRow = await row("Claude");
    expect(claudeRow.getByText("Sjekk")).toBeVisible();
    expect(claudeRow.getByText(/kunne ikke bekrefte/i)).toBeVisible();
  });

  it("marks a usage limit from the last minutes as a failure", async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    stubEngine({ usage: { last_limit_at: at } });
    render(<Health />);
    const usage = await row("Bruksgrense");
    expect(usage.getByText("Feil")).toBeVisible();
    expect(usage.getByText(/live-kjøring stopper/i)).toBeVisible();
  });

  it("warns about a usage limit from the last five hours", async () => {
    const at = new Date(Date.now() - HOUR_MS).toISOString();
    stubEngine({ usage: { last_limit_at: at } });
    render(<Health />);
    const usage = await row("Bruksgrense");
    expect(usage.getByText("Sjekk")).toBeVisible();
    expect(usage.getByText(/kan fortsatt gjelde/i)).toBeVisible();
  });

  it("does not warn about an older usage limit, but still shows it", async () => {
    const at = new Date(Date.now() - 6 * HOUR_MS).toISOString();
    stubEngine({ usage: { last_limit_at: at } });
    render(<Health />);
    const usage = await row("Bruksgrense");
    expect(usage.getByText("OK")).toBeVisible();
    expect(usage.getByText(/sist nådd/i)).toBeVisible();
  });

  it("marks a missing demo plan as a failure", async () => {
    stubEngine({ demo_plan: false });
    render(<Health />);
    const plan = await row("Demoplan");
    expect(plan.getByText("Feil")).toBeVisible();
    expect(plan.getByText(/mangler/i)).toBeVisible();
  });

  it("names each missing replay", async () => {
    stubEngine({ replays: { before: true, after: false, scam: false } });
    render(<Health />);
    const replays = await row("Avspillinger");
    expect(replays.getByText("Sjekk")).toBeVisible();
    expect(replays.getByText("Mangler: etter, svindel")).toBeVisible();
  });

  it("says so when the engine does not answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(<Health />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/får ikke kontakt med motoren/i);
    expect(screen.queryByRole("heading", { name: "Claude" })).toBeNull();
  });

  it("calls no engine during a replay", () => {
    const fetchMock = stubEngine({});
    window.history.replaceState(null, "", "/?replay=before");
    render(<Health />);
    expect(screen.getByText(/ikke tilgjengelig under avspilling/i)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
