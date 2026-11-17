// What the window knows about checking a provider's usage. Types only: no Node, no DOM.
// The token never appears here; it stays in the main process.

import type { ServiceProvider, Snapshot } from "./types.js";

export interface ProviderStatus {
  provider: ServiceProvider;
  /** A token is saved for this provider. */
  connected: boolean;
  /** The team the token reads (Vercel), or null for the personal account. */
  teamId: string | null;
}

export interface ServicesStatus {
  providers: ProviderStatus[];
  /** False when the Mac's keychain cannot keep the token: it is held in memory until the app quits. */
  canKeepToken: boolean;
}

/** Usage billed beyond the plan, from the provider, for this month so far and the month before. Dollars, and often a fraction of a cent. */
export interface UsageReport {
  /** "YYYY-MM". */
  month: string;
  billedUsd: number;
  previousMonth: string;
  previousBilledUsd: number;
  /** Notably more than a quiet month, so worth a look at the provider's usage page. */
  high: boolean;
}

/** The result of checking one service's usage: the workspace (only its "last checked" time changes; no bill is ever written), one sentence to show, and the numbers. */
export interface UsageOutcome {
  snapshot: Snapshot;
  summary: string;
  usage: UsageReport;
}
