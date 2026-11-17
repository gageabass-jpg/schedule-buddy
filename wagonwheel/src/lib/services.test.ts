import { describe, expect, it } from "vitest";
import type { Service, ServiceCharge } from "@shared/types";
import { dollars, dollarsField, flaggedServices, higherThanUsual, inDays, monthName, monthOf, monthTotals, nextBillDate, ordinal, owedNow, parseDollars, serviceMonth, shiftMonth, spentSoFar, yearlyEstimate } from "./services";

const NOV = Date.UTC(2026, 10, 3);   // 3 Nov 2026
let n = 0;
const svc = (o: Partial<Service> = {}): Service => ({
  id: `s${++n}`, name: "S", plan: "", kind: "flat", provider: null, amountCents: 0, billingDay: null, billingUrl: null,
  notes: "", status: "active", lastSyncedAt: null, createdAt: Date.UTC(2026, 0, 5), updatedAt: NOV, ...o,
});
const charge = (serviceId: string, month: string, amountCents: number, paid = true): ServiceCharge => ({
  id: `c${++n}`, serviceId, month, amountCents, source: "manual", paid, createdAt: NOV, updatedAt: NOV,
});

describe("money", () => {
  it("shows whole dollars without cents", () => {
    expect(dollars(2500)).toBe("$25");
    expect(dollars(1250)).toBe("$12.50");
    expect(dollars(120000)).toBe("$1,200");
    expect(dollars(0)).toBe("$0");
    expect(dollars(5)).toBe("$0.05");
  });

  it("reads what a person types", () => {
    expect(parseDollars("25")).toBe(2500);
    expect(parseDollars(" $1,200 ")).toBe(120000);
    expect(parseDollars("12.5")).toBe(1250);
    expect(parseDollars("0.07")).toBe(7);
    for (const bad of ["", "abc", "-5", "1.234", "12 dollars", "$"]) expect(parseDollars(bad)).toBeNull();
  });

  it("fills a text box from cents", () => {
    expect(dollarsField(0)).toBe("");
    expect(dollarsField(2500)).toBe("25");
    expect(dollarsField(1250)).toBe("12.50");
  });
});

describe("months", () => {
  it("moves across a year end", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-11", -11)).toBe("2025-12");
    expect(shiftMonth("2026-11", 0)).toBe("2026-11");
  });
  it("names and cuts", () => {
    expect(monthName("2026-11")).toBe("November 2026");
    expect(monthOf("2026-11-09")).toBe("2026-11");
  });
});

describe("what a month costs", () => {
  it("uses the recorded figure, and the usual fee when none is recorded", () => {
    const a = svc({ amountCents: 2500 });
    const b = svc({ amountCents: 400 });
    const charges = [charge(a.id, "2026-11", 3100)];
    expect(serviceMonth(a, charges, "2026-11")).toMatchObject({ amountCents: 3100, estimated: false });
    expect(serviceMonth(b, charges, "2026-11")).toMatchObject({ amountCents: 400, estimated: true });
    const t = monthTotals([a, b], charges, "2026-11");
    expect(t.totalCents).toBe(3500);
    expect(t.estimatedCount).toBe(1);
  });

  it("does not count a service in a past month before it existed, but always counts it in the current month", () => {
    const old = svc({ amountCents: 1000, createdAt: Date.UTC(2026, 0, 15) });
    const fresh = svc({ amountCents: 9900, createdAt: Date.UTC(2026, 10, 12) });
    expect(monthTotals([old, fresh], [], "2026-10", "2026-11").totalCents).toBe(1000);       // last month: fresh was not there
    expect(monthTotals([old, fresh], [], "2026-11", "2026-11").totalCents).toBe(10900);      // this month: both
    expect(monthTotals([old, fresh], [], "2026-11").totalCents).toBe(10900);                 // asking only about "now"
    // a clock that says it is earlier than the service's creation (a frozen test clock, say) still counts it now
    expect(monthTotals([fresh], [], "2026-06", "2026-06").totalCents).toBe(9900);
  });

  it("counts a past month's recorded figure even for a service added later", () => {
    const fresh = svc({ amountCents: 9900, createdAt: Date.UTC(2026, 10, 12) });
    expect(monthTotals([fresh], [charge(fresh.id, "2026-10", 500)], "2026-10", "2026-11").totalCents).toBe(500);
  });

  it("keeps a cancelled service in the months it was charged, and out of the ones it was not", () => {
    const gone = svc({ amountCents: 1000, status: "cancelled" });
    const charges = [charge(gone.id, "2026-10", 1000)];
    expect(monthTotals([gone], charges, "2026-10").totalCents).toBe(1000);
    expect(monthTotals([gone], charges, "2026-11").totalCents).toBe(0);
  });
});

describe("higher than usual", () => {
  it("flags a charge well over the usual fee", () => {
    const s = svc({ amountCents: 2500 });
    expect(higherThanUsual(s, [charge(s.id, "2026-11", 4000)], "2026-11")).toBe(1500);
  });
  it("ignores small drift and anything under $10", () => {
    const s = svc({ amountCents: 2500 });
    expect(higherThanUsual(s, [charge(s.id, "2026-11", 2650)], "2026-11")).toBeNull();   // +$1.50
    const small = svc({ amountCents: 100 });
    expect(higherThanUsual(small, [charge(small.id, "2026-11", 800)], "2026-11")).toBeNull();   // +$7: under $10
  });
  it("falls back to last month when no usual fee is set, and says nothing without a baseline", () => {
    const s = svc();
    expect(higherThanUsual(s, [charge(s.id, "2026-10", 2000), charge(s.id, "2026-11", 15000)], "2026-11")).toBe(13000);
    expect(higherThanUsual(s, [charge(s.id, "2026-11", 15000)], "2026-11")).toBeNull();
  });
  it("is null when nothing is recorded", () => {
    expect(higherThanUsual(svc({ amountCents: 100 }), [], "2026-11")).toBeNull();
  });
});

describe("flagged services", () => {
  it("lists the active ones over their usual fee, biggest first, and skips cancelled ones", () => {
    const a = svc({ amountCents: 2000 });
    const b = svc({ amountCents: 1000 });
    const quiet = svc({ amountCents: 1000 });
    const gone = svc({ amountCents: 1000, status: "cancelled" });
    const charges = [charge(a.id, "2026-11", 5000), charge(b.id, "2026-11", 6000), charge(quiet.id, "2026-11", 1100), charge(gone.id, "2026-11", 9000)];
    expect(flaggedServices([a, b, quiet, gone], charges, "2026-11").map((f) => [f.service.id, f.extraCents])).toEqual([[b.id, 5000], [a.id, 3000]]);
    expect(flaggedServices([a], [], "2026-11")).toEqual([]);
  });
});

describe("what is owed", () => {
  it("adds up the unpaid bills, oldest first, and leaves paid ones out", () => {
    const sb = svc({ name: "Supabase" });
    const vc = svc({ name: "Vercel" });
    const gh = svc({ name: "GitHub" });
    const charges = [charge(vc.id, "2026-11", 2120, false), charge(sb.id, "2026-11", 3465, false), charge(gh.id, "2026-11", 424), charge(sb.id, "2026-10", 2500, false)];
    const owed = owedNow([sb, vc, gh], charges);
    expect(owed.totalCents).toBe(2120 + 3465 + 2500);
    expect(owed.bills.map((b) => [b.charge.month, b.service.name])).toEqual([["2026-10", "Supabase"], ["2026-11", "Supabase"], ["2026-11", "Vercel"]]);
  });

  it("still counts an unpaid bill from a cancelled service, since the money is owed", () => {
    const gone = svc({ name: "Old", status: "cancelled" });
    expect(owedNow([gone], [charge(gone.id, "2026-10", 900, false)]).totalCents).toBe(900);
  });

  it("is zero when everything is paid, or nothing is recorded", () => {
    const s = svc();
    expect(owedNow([s], [charge(s.id, "2026-10", 900)])).toEqual({ totalCents: 0, bills: [] });
    expect(owedNow([s], [])).toEqual({ totalCents: 0, bills: [] });
  });

  it("an unpaid bill still counts toward its month's total", () => {
    const s = svc({ amountCents: 2500 });
    expect(monthTotals([s], [charge(s.id, "2026-11", 3465, false)], "2026-11").totalCents).toBe(3465);
  });
});

describe("spent so far", () => {
  it("adds up what was paid, in total and per service, and says since when", () => {
    const a = svc({ name: "GitHub" });
    const b = svc({ name: "Vercel" });
    const charges = [charge(a.id, "2026-08", 424), charge(a.id, "2026-09", 424), charge(b.id, "2026-09", 2120), charge(b.id, "2026-10", 2120)];
    const spent = spentSoFar([a, b], charges);
    expect(spent.totalCents).toBe(424 * 2 + 2120 * 2);
    expect(spent.count).toBe(4);
    expect(spent.since).toBe("2026-08");
    expect(spent.perService).toEqual({ [a.id]: { cents: 848, count: 2 }, [b.id]: { cents: 4240, count: 2 } });
  });

  it("leaves unpaid bills out: they are owed, not spent", () => {
    const s = svc();
    const spent = spentSoFar([s], [charge(s.id, "2026-10", 2500), charge(s.id, "2026-11", 3465, false)]);
    expect(spent).toMatchObject({ totalCents: 2500, count: 1, since: "2026-10" });
  });

  it("keeps a cancelled service's history in, and ignores a bill for a service that is gone", () => {
    const gone = svc({ status: "cancelled" });
    const charges = [charge(gone.id, "2026-05", 900), charge("no-such-service", "2026-05", 5000)];
    expect(spentSoFar([gone], charges).totalCents).toBe(900);
  });

  it("is empty with no bills", () => {
    expect(spentSoFar([svc()], [])).toEqual({ totalCents: 0, count: 0, since: null, perService: {} });
  });
});

describe("yearly estimate", () => {
  it("uses the usual fee, or the average of the last three bills when none is set, and times twelve", () => {
    const fee = svc({ name: "GitHub", amountCents: 424 });
    const varies = svc({ name: "Google Cloud" });
    const charges = [charge(varies.id, "2026-08", 9999), charge(varies.id, "2026-09", 478), charge(varies.id, "2026-10", 988), charge(varies.id, "2026-11", 968)];   // August is not among the last three
    const est = yearlyEstimate([fee, varies], charges);
    expect(est.rows.map((r) => [r.service.name, r.monthlyCents, r.basis])).toEqual([["Google Cloud", 811, "recent bills"], ["GitHub", 424, "usual fee"]]);
    expect(est.monthlyCents).toBe(1235);
    expect(est.yearlyCents).toBe(14820);
    expect(est.unknown).toEqual([]);
  });

  it("lists a service with nothing to go on, so a low total is not mistaken for a complete one", () => {
    const known = svc({ name: "Vercel", amountCents: 2120 });
    const blank = svc({ name: "Google Workspace" });
    const est = yearlyEstimate([known, blank], []);
    expect(est.yearlyCents).toBe(2120 * 12);
    expect(est.unknown.map((s) => s.name)).toEqual(["Google Workspace"]);
  });

  it("leaves cancelled services out of a future year", () => {
    const gone = svc({ amountCents: 900, status: "cancelled" });
    expect(yearlyEstimate([gone], [charge(gone.id, "2026-10", 900)])).toMatchObject({ monthlyCents: 0, yearlyCents: 0, rows: [] });
  });
});

describe("billing day", () => {
  it("finds the next bill, today included", () => {
    expect(nextBillDate(15, "2026-11-09")).toBe("2026-11-15");
    expect(nextBillDate(9, "2026-11-09")).toBe("2026-11-09");
    expect(nextBillDate(5, "2026-11-09")).toBe("2026-12-05");
    expect(nextBillDate(5, "2026-12-20")).toBe("2027-01-05");
    expect(nextBillDate(null, "2026-11-09")).toBeNull();
  });
  it("takes the last day of a short month", () => {
    expect(nextBillDate(31, "2026-02-10")).toBe("2026-02-28");
    expect(nextBillDate(30, "2026-02-28")).toBe("2026-02-28");   // the 30th is the 28th in February: still today
    expect(nextBillDate(30, "2026-03-01")).toBe("2026-03-30");
    expect(nextBillDate(31, "2026-04-30")).toBe("2026-04-30");
  });
  it("says how far away it is", () => {
    expect(inDays("2026-11-09", "2026-11-09")).toBe("today");
    expect(inDays("2026-11-10", "2026-11-09")).toBe("tomorrow");
    expect(inDays("2026-11-15", "2026-11-09")).toBe("in 6 days");
  });
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
  });
});
