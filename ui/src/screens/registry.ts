// Finds the screens: every file in this folder that exports `screen` and a default component.
// A new screen needs no change anywhere else.
//
// The routes live in the URL hash (#/intervju). A replay must play from a plain file server with
// the engine stopped (REQ-8.6), and a plain file server cannot answer a path like /intervju.

import type { ComponentType } from "react";

export type ScreenMeta = {
  path: string;
  step: 1 | 2 | 3 | 4 | 5 | null;
  title: string;
};

export type RegisteredScreen = {
  meta: ScreenMeta;
  Component: ComponentType;
};

type ScreenModule = {
  screen?: ScreenMeta;
  default?: ComponentType;
};

const modules = import.meta.glob<ScreenModule>("./*.tsx", { eager: true });

export const screens: RegisteredScreen[] = Object.values(modules).flatMap((module) =>
  module.screen && module.default ? [{ meta: module.screen, Component: module.default }] : [],
);

export function pathFromHash(hash: string): string {
  const path = hash.replace(/^#/, "").split("?")[0];
  return path === "" ? "/" : path;
}

/** The screen for a path. The root path opens the earliest step that exists. */
export function findScreen(path: string, list = screens): RegisteredScreen | undefined {
  if (path !== "/") return list.find((candidate) => candidate.meta.path === path);
  const steps = list.filter((candidate) => candidate.meta.step !== null);
  return steps.sort((a, b) => (a.meta.step ?? 0) - (b.meta.step ?? 0))[0];
}
