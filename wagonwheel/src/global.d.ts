import type { WagonwheelApi } from "@shared/api";

declare global {
  interface Window {
    /** Put there by electron/preload.mts. Absent in a plain browser. */
    wagonwheel?: WagonwheelApi;
  }
}
export {};
