import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Intervju from "../src/screens/Intervju";
import Karakterkort from "../src/screens/Karakterkort";
import { updateSession } from "../src/state/session";

// #121: an empty step keeps its heading and says where to start, in the shared frame.
beforeEach(() => {
  updateSession({ currentRunId: null, beforeRunId: null, afterRunId: null });
  window.history.replaceState(null, "", "/");
});
afterEach(() => updateSession({ currentRunId: null, beforeRunId: null, afterRunId: null }));

describe.each([
  ["Intervju", Intervju, "Ingen intervju er i gang."],
  ["Karakterkort", Karakterkort, "Ingen intervju å vise."],
])("%s with no run", (title, Screen, empty) => {
  it("keeps its heading and points to where an interview starts", () => {
    render(<Screen />);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Start et intervju på Stillingsannonse" }),
    ).toHaveAttribute("href", "#/stillingsannonse");
  });
});
