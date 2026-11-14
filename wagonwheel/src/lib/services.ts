import type { ServiceKind, ServiceProvider } from "@shared/types";
import { MONTHS, diffDays } from "./dates";

// The Services screen's helpers. The sums themselves (totals, "higher than usual", the next bill date)
// live in shared/service-costs.ts, so the Claude Code connector uses exactly the same ones; they are
// re-exported here so the screen imports everything from one place.

export {
  dollars, flaggedServices, higherThanUsual, monthOf, monthTotals, nextBillDate, owedNow, serviceMonth, shiftMonth, spentSoFar, yearlyEstimate,
  type MonthTotals, type OwedBill, type ServiceMonth, type SpentSoFar, type YearlyRow,
} from "@shared/service-costs";

// ── Money ───────────────────────────────────────────────────────────────────

/** What a person types ("25", "$1,200", "12.5") as whole cents, or null when it is not an amount. */
export function parseDollars(text: string): number | null {
  const t = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Cents as the plain number a text box shows: "25" or "12.50". */
export const dollarsField = (cents: number): string => (cents === 0 ? "" : cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

// ── Months ──────────────────────────────────────────────────────────────────

/** "November 2026". */
export function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "November" (this year's month, no year). */
export const monthOnly = (month: string): string => MONTHS[Number(month.slice(5, 7)) - 1];

// ── Billing day ─────────────────────────────────────────────────────────────

/** "today", "tomorrow" or "in 5 days" for a date on or after today. */
export function inDays(iso: string, today: string): string {
  const n = diffDays(iso, today);
  return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
}

/** 1 → "1st", 2 → "2nd", 11 → "11th". */
export function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

// ── Starting points for "Add a service" ─────────────────────────────────────

export interface ServicePreset {
  key: string;
  name: string;
  kind: ServiceKind;
  provider: ServiceProvider | null;
  billingUrl: string;
  /** One line on how this service bills, shown in the dialog. */
  hint: string;
}

// Prices are left blank on purpose: they change, and a wrong one would look like a fact.
export const SERVICE_PRESETS: ServicePreset[] = [
  { key: "supabase", name: "Supabase", kind: "usage", provider: null, billingUrl: "https://supabase.com/dashboard", hint: "A flat plan fee plus anything over the plan's included usage." },
  { key: "vercel", name: "Vercel", kind: "usage", provider: "vercel", billingUrl: "https://vercel.com/account/billing", hint: "Per-seat plan fee plus usage. Wagonwheel can check the usage beyond your plan; the invoice amount is typed in." },
  { key: "github", name: "GitHub", kind: "flat", provider: null, billingUrl: "https://github.com/settings/billing", hint: "A flat plan fee; Copilot and Actions minutes can add to it." },
  { key: "workspace", name: "Google Workspace", kind: "flat", provider: null, billingUrl: "https://admin.google.com/ac/billing/subscriptions", hint: "A flat fee per user, billed monthly or yearly." },
  { key: "cursor", name: "Cursor", kind: "flat", provider: null, billingUrl: "https://cursor.com/dashboard", hint: "A flat plan fee; usage beyond what the plan includes can add to it." },
  { key: "claude", name: "Claude Code", kind: "flat", provider: null, billingUrl: "https://claude.ai/settings/billing", hint: "A flat Claude plan fee. If it runs on the API instead, switch the type to usage-based." },
  { key: "firebase", name: "Firebase / Google Cloud", kind: "usage", provider: null, billingUrl: "https://console.cloud.google.com/billing", hint: "Usage-based on the Blaze plan. Flat plans like Google Earth can appear here too." },
];
