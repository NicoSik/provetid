import { useLayoutEffect, useState } from "react";

const STORAGE_KEY = "provetid.scene";

function remembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // The browser blocks storage. The choice then lasts until the next reload.
  }
}

export function SceneToggle() {
  const [on, setOn] = useState(remembered);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("scene", on);
  }, [on]);

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        remember(!on);
        setOn(!on);
      }}
      className={`rounded-md border px-2.5 py-1 text-sm ${
        on ? "border-pagar bg-pagar/15 text-ink" : "border-line text-muted hover:text-ink"
      }`}
    >
      Scene-modus
    </button>
  );
}
