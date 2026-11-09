import type { WagonwheelApi } from "@shared/api";

/** The preload's API. The app only works inside Electron, where it exists. */
export function bridge(): WagonwheelApi {
  const api = window.wagonwheel;
  if (!api) throw new Error("Nucleus Wagonwheel has to run in its own window. Start it with `npm run dev` or open the built app.");
  return api;
}

export const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
