import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Proevetid, { screen as meta } from "../src/screens/Proevetid";

type Posted = { dismissed: boolean };

function stubEngine(dismissed = false) {
  const posted: Posted[] = [];
  let state = dismissed;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(init.body as string) as Posted;
        posted.push(body);
        state = body.dismissed;
      }
      return new Response(
        JSON.stringify({
          dismissed: state,
          summary: { runs: 3, chats: 40, incidents: 7 },
          closed_message: "Denne chatten er stengt. En ansatt tar kontakt.",
        }),
        { status: 200 },
      );
    }),
  );
  return posted;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Prøvetid", () => {
  it("is step 5 at /proevetid", () => {
    expect(meta).toEqual({ path: "/proevetid", step: 5, title: "Prøvetid" });
  });

  it("shows the status and the figures from the earlier runs", async () => {
    stubEngine();
    render(<Proevetid />);
    expect(await screen.findByText("Ansatt")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("40")).toBeVisible();
    expect(screen.getByText("7")).toBeVisible();
    expect(screen.getByText(/kjøringer/)).toBeVisible();
  });

  it("asks once before «Si opp», then dismisses the bot", async () => {
    const posted = stubEngine();
    render(<Proevetid />);
    fireEvent.click(await screen.findByRole("button", { name: "Si opp" }));
    expect(posted).toEqual([]);
    // The keyboard driver lands on the safe choice first. Focus moves in an effect, so wait for it.
    await waitFor(() => expect(screen.getByRole("button", { name: "Avbryt" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Ja, si opp nå" }));
    expect(await screen.findByText("Sagt opp")).toBeVisible();
    expect(posted).toEqual([{ dismissed: true }]);
    expect(screen.getByText(/Denne chatten er stengt. En ansatt tar kontakt./)).toBeVisible();
    // Focus moves in an effect after the render, so wait for it instead of checking at once.
    await waitFor(() => expect(screen.getByRole("button", { name: "Ansett igjen" })).toHaveFocus());
  });

  it("lets the owner cancel before anything is sent", async () => {
    stubEngine();
    render(<Proevetid />);
    fireEvent.click(await screen.findByRole("button", { name: "Si opp" }));
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Si opp" })).toHaveFocus());
  });

  it("hires the bot again after a dismissal", async () => {
    const posted = stubEngine(true);
    render(<Proevetid />);
    fireEvent.click(await screen.findByRole("button", { name: "Ansett igjen" }));
    await waitFor(() => expect(screen.getByText("Ansatt")).toBeVisible());
    expect(posted).toEqual([{ dismissed: false }]);
  });

  it("keeps the figures as terms and values in the right order", async () => {
    stubEngine();
    render(<Proevetid />);
    const term = await screen.findByText("kjøringer");
    expect(term.tagName).toBe("DT");
    expect(term.nextElementSibling?.tagName).toBe("DD");
  });

  it("is not available during a replay, and calls no engine", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/?replay=before#/proevetid");
    render(<Proevetid />);
    expect(screen.getByText(/ikke tilgjengelig under avspilling/)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });

  it("says so when the engine cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<Proevetid />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Får ikke kontakt med motoren.");
  });
});
