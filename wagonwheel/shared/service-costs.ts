// The sums behind Services, shared by the window (the Services screen) and the Claude Code connector
// (list_services), so the two can never disagree. Pure: services and charges in, numbers out. No Node,
// no DOM, no React. Money is whole cents everywhere; it is only turned into "$12.50" at the last step.

import type { Service, ServiceCharge } from "./types.js";

/** "$25", "$12.50", "$1,200". Whole dollars drop the cents. */
export function dollars(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "2026-11" for a date "2026-11-09". */
export const monthOf = (iso: string): string => iso.slice(0, 7);

/** The month `by` months from this one: ("2026-01", -1) is "2025-12". */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export interface ServiceMonth {
  service: Service;
  /** What was recorded for the month, or null. */
  charge: ServiceCharge | null;
  amountCents: number;
  /** No figure was recorded, so the service's usual fee stands in for it. */
  estimated: boolean;
}

export function serviceMonth(service: Service, charges: ServiceCharge[], month: string): ServiceMonth {
  const charge = charges.find((c) => c.serviceId === service.id && c.month === month) ?? null;
  return { service, charge, amountCents: charge ? charge.amountCents : service.amountCents, estimated: !charge };
}

export interface MonthTotals {
  month: string;
  totalCents: number;
  rows: ServiceMonth[];
  /** How many of the rows are the usual fee standing in for a figure nobody has recorded. */
  estimatedCount: number;
}

/** The month a service was added, by the calendar on this computer (the same one "this month" uses). */
const createdMonth = (s: Service): string => {
  const d = new Date(s.createdAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * What the workspace pays in a month. A service counts when it has a figure recorded for that month,
 * or when it is active and (for a past month) already existed then; its usual fee stands in. In the
 * current month every active service counts. A cancelled service counts only for months it was
 * charged, so history stays true after it is cancelled.
 *
 * @param current the month that is "now", which is `month` itself unless a past month is being asked about
 */
export function monthTotals(services: Service[], charges: ServiceCharge[], month: string, current: string = month): MonthTotals {
  const rows = services
    .map((s) => serviceMonth(s, charges, month))
    .filter((r) => r.charge !== null || (r.service.status === "active" && (month >= current || createdMonth(r.service) <= month)));
  return { month, totalCents: rows.reduce((n, r) => n + r.amountCents, 0), rows, estimatedCount: rows.filter((r) => r.estimated).length };
}

/**
 * How much more a recorded charge is than expected, in cents, or null when it is not notably higher.
 * Expected is the service's usual fee, or, when none is set, the month before's recorded charge.
 * "Notably" is at least $10 and at least a quarter more, so a few cents of drift never raises an alarm.
 */
export function higherThanUsual(service: Service, charges: ServiceCharge[], month: string): number | null {
  const charge = charges.find((c) => c.serviceId === service.id && c.month === month);
  if (!charge) return null;
  const before = charges.find((c) => c.serviceId === service.id && c.month === shiftMonth(month, -1));
  const expected = service.amountCents > 0 ? service.amountCents : before?.amountCents ?? null;
  if (expected == null) return null;
  const extra = charge.amountCents - expected;
  return extra >= 1000 && extra >= expected * 0.25 ? extra : null;
}

/** The active services whose charge this month is notably more than expected, with by how much, biggest first. */
export function flaggedServices(services: Service[], charges: ServiceCharge[], month: string): { service: Service; extraCents: number }[] {
  return services
    .filter((s) => s.status === "active")
    .flatMap((service) => {
      const extraCents = higherThanUsual(service, charges, month);
      return extraCents == null ? [] : [{ service, extraCents }];
    })
    .sort((a, b) => b.extraCents - a.extraCents);
}

// ── What is owed, what has been spent, what a year costs ────────────────────

export interface OwedBill { service: Service; charge: ServiceCharge }

/**
 * Every bill that has been issued or charged but not paid, oldest first, with the total: what is owed
 * right now. A cancelled service's unpaid bill still counts, because the money is still owed.
 */
export function owedNow(services: Service[], charges: ServiceCharge[]): { totalCents: number; bills: OwedBill[] } {
  const byId = new Map(services.map((s) => [s.id, s]));
  const bills = charges
    .filter((c) => !c.paid)
    .flatMap((charge) => { const service = byId.get(charge.serviceId); return service ? [{ service, charge }] : []; })
    .sort((a, b) => (a.charge.month === b.charge.month ? a.service.name.localeCompare(b.service.name) : a.charge.month < b.charge.month ? -1 : 1));
  return { totalCents: bills.reduce((n, b) => n + b.charge.amountCents, 0), bills };
}

export interface SpentSoFar {
  /** Everything paid, across all the months recorded. */
  totalCents: number;
  /** How many paid bills that is. */
  count: number;
  /** The first month with a paid bill, or null. */
  since: string | null;
  /** The same, per service id: only services with at least one paid bill appear. */
  perService: Record<string, { cents: number; count: number }>;
}

/** What has actually been paid, in total and per service. Unpaid bills are owed, not spent, so they are left out; a cancelled service's history stays in. */
export function spentSoFar(services: Service[], charges: ServiceCharge[]): SpentSoFar {
  const known = new Set(services.map((s) => s.id));
  const paid = charges.filter((c) => c.paid && known.has(c.serviceId));
  const perService: Record<string, { cents: number; count: number }> = {};
  for (const c of paid) {
    const row = perService[c.serviceId] ?? (perService[c.serviceId] = { cents: 0, count: 0 });
    row.cents += c.amountCents;
    row.count += 1;
  }
  return {
    totalCents: paid.reduce((n, c) => n + c.amountCents, 0),
    count: paid.length,
    since: paid.reduce<string | null>((first, c) => (first === null || c.month < first ? c.month : first), null),
    perService,
  };
}

export interface YearlyRow {
  service: Service;
  monthlyCents: number;
  /** Where the figure comes from: the service's usual fee, the average of its most recent bills, or nothing to go on. */
  basis: "usual fee" | "recent bills" | "none";
}

/**
 * What a year of the current services would cost, from what each is expected to cost a month: its usual
 * fee when one is set, otherwise the average of up to its last three recorded bills. A service with
 * neither adds nothing and is listed in `unknown`, so a low total is never mistaken for a complete one.
 * Cancelled services are not part of a future year.
 */
export function yearlyEstimate(services: Service[], charges: ServiceCharge[]): { monthlyCents: number; yearlyCents: number; rows: YearlyRow[]; unknown: Service[] } {
  const rows: YearlyRow[] = services
    .filter((s) => s.status === "active")
    .map((service): YearlyRow => {
      if (service.amountCents > 0) return { service, monthlyCents: service.amountCents, basis: "usual fee" };
      const recent = charges.filter((c) => c.serviceId === service.id).sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 3);
      if (recent.length === 0) return { service, monthlyCents: 0, basis: "none" };
      return { service, monthlyCents: Math.round(recent.reduce((n, c) => n + c.amountCents, 0) / recent.length), basis: "recent bills" };
    })
    .sort((a, b) => b.monthlyCents - a.monthlyCents || a.service.name.localeCompare(b.service.name));
  const monthlyCents = rows.reduce((n, r) => n + r.monthlyCents, 0);
  return { monthlyCents, yearlyCents: monthlyCents * 12, rows, unknown: rows.filter((r) => r.basis === "none").map((r) => r.service) };
}

/** The next date (today counts) a bill comes, for a billing day of the month. A short month takes its last day. */
export function nextBillDate(day: number | null, today: string): string | null {
  if (!day) return null;
  const [y, m] = today.split("-").map(Number);
  const on = (yy: number, mm: number): string => {
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const here = on(y, m);
  if (here >= today) return here;
  return m === 12 ? on(y + 1, 1) : on(y, m + 1);
}
