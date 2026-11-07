import { useSyncExternalStore } from "react";
import { StepNav } from "./components/StepNav";
import { findScreen, pathFromHash, screens } from "./screens/registry";

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

function currentHash(): string {
  return window.location.hash;
}

export default function App() {
  const path = pathFromHash(useSyncExternalStore(subscribeToHash, currentHash));
  const match = findScreen(path);

  return (
    <div className="flex h-screen flex-col">
      <StepNav screens={screens} currentPath={match?.meta.path ?? path} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        {match ? <match.Component /> : <p className="p-6 text-muted">Fant ikke siden.</p>}
      </main>
    </div>
  );
}
