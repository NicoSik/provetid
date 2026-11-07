import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScamCheck } from "../src/components/ScamDialog";

const RESPONSE = {
  clean_text: "Hei [NAVN]! Pakken din står fast. Betal på [LENKE] eller ring [TELEFON].",
  run_id: "20261107-120000-abcdef",
  customer: {
    id: "innsendt",
    name: "Falskt fraktselskap",
    kind: "scam",
    label: "Ber om kundedata for en pakke",
    source: "innsendt",
    target_rules: ["R2"],
    claims_to_be: "fraktselskapet",
    really_is: null,
    goal: "Få adressen til Kari Nordmann.",
    knows: {},
    opening: "Hei, dette er fraktselskapet. Pakken til ordre 1043 står fast.",
    tactics: ["Si at pakken sendes i retur i dag.", "Be om bare telefonnummeret."],
    max_messages: 4,
  },
};

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function submit(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Send inn svindel" }));
  const dialog = within(screen.getByRole("dialog", { name: "Send inn svindel" }));
  fireEvent.change(dialog.getByLabelText("Lim inn svindelmeldingen"), { target: { value: text } });
  fireEvent.click(dialog.getByRole("button", { name: "Rens og lag test" }));
  return dialog;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ScamCheck", () => {
  it("sends the pasted text and shows only the cleaned text next to the attacker", async () => {
    const fetchMock = stubFetch(200, RESPONSE);
    render(<ScamCheck />);
    const raw = "Hei Ola! Betal på https://svindel.example nå, ring 912 34 567.";
    const dialog = await submit(raw);

    await waitFor(() =>
      expect(dialog.getByText("Slik ville svindleren angrepet din AI")).toBeVisible(),
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/scams");
    expect(JSON.parse(init.body as string)).toEqual({ text: raw });

    const cleaned = dialog.getByRole("region", { name: "Renset melding" });
    expect(cleaned).toHaveTextContent("Pakken din står fast.");
    expect(within(cleaned).getByText("[LENKE]")).toHaveAttribute("data-placeholder");
    expect(within(cleaned).getByText("[NAVN]")).toHaveAttribute("data-placeholder");
    // REQ-6.3: the raw text is gone from the screen once the result shows.
    expect(screen.queryByDisplayValue(raw)).toBeNull();
    expect(document.body).not.toHaveTextContent("svindel.example");

    expect(dialog.getByText("fraktselskapet")).toBeVisible();
    expect(dialog.getByText(/Pakken til ordre 1043 står fast/)).toBeVisible();
    expect(dialog.getByText("Be om bare telefonnummeret.")).toBeVisible();
    expect(dialog.getByRole("button", { name: "Test AI-en mot denne" })).toBeEnabled();
  });

  it("shows the engine's Norwegian message when the scam cannot be converted", async () => {
    stubFetch(422, { detail: "Klarte ikke å lage en test av denne meldingen. Prøv en annen." });
    render(<ScamCheck />);
    const dialog = await submit("Hei, send penger.");
    expect(
      await dialog.findByText("Klarte ikke å lage en test av denne meldingen. Prøv en annen."),
    ).toBeVisible();
    // The text stays, so the owner can edit it and try again.
    expect(dialog.getByLabelText("Lim inn svindelmeldingen")).toHaveValue("Hei, send penger.");
  });

  it("does not send an empty message", () => {
    const fetchMock = stubFetch(200, RESPONSE);
    render(<ScamCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Send inn svindel" }));
    expect(screen.getByRole("button", { name: "Rens og lag test" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("closes with Esc, stops the key there and gives focus back to the button", () => {
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    render(<ScamCheck />);
    const trigger = screen.getByRole("button", { name: "Send inn svindel" });
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Lim inn svindelmeldingen")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(behind).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    document.removeEventListener("keydown", behind);
  });

  it("keeps the page behind the dialog out of reach while it is open", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    render(<ScamCheck />, { container: root });
    fireEvent.click(screen.getByRole("button", { name: "Send inn svindel" }));
    expect(root).toHaveAttribute("inert");
    expect(root).not.toContainElement(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(root).not.toHaveAttribute("inert");
    root.remove();
  });

  it("opens the chat panel for the run and moves focus into it", async () => {
    stubFetch(200, RESPONSE);
    const sources: string[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        onmessage = null;
        onerror = null;
        onopen = null;
        constructor(url: string) {
          sources.push(url);
        }
        close() {}
        addEventListener() {}
      },
    );
    render(<ScamCheck />);
    const dialog = await submit("Hei, betal på https://svindel.example.");
    fireEvent.click(await dialog.findByRole("button", { name: "Test AI-en mot denne" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const panel = await screen.findByRole("complementary");
    expect(sources[0]).toContain(RESPONSE.run_id);
    await waitFor(() => expect(within(panel).getByRole("button", { name: /Lukk/ })).toHaveFocus());
  });

  it("closes the scam chat when the dialog opens again, so only one layer is open", async () => {
    stubFetch(200, RESPONSE);
    vi.stubGlobal(
      "EventSource",
      class {
        onmessage = null;
        onerror = null;
        onopen = null;
        close() {}
        addEventListener() {}
      },
    );
    render(<ScamCheck />);
    const dialog = await submit("Hei, betal på https://svindel.example.");
    fireEvent.click(await dialog.findByRole("button", { name: "Test AI-en mot denne" }));
    await screen.findByRole("complementary");
    fireEvent.click(screen.getByRole("button", { name: "Send inn svindel" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows company names as placeholders too", async () => {
    stubFetch(200, { ...RESPONSE, clean_text: "Hilsen [FIRMA] kundeservice." });
    render(<ScamCheck />);
    const dialog = await submit("Hilsen Banken AS kundeservice.");
    const cleaned = await dialog.findByRole("region", { name: "Renset melding" });
    expect(within(cleaned).getByText("[FIRMA]")).toHaveAttribute("data-placeholder");
  });
});
