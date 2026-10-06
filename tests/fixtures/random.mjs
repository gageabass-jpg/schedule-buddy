// Random legacy households for the model and bridge tests: every field the
// converter and resolver care about, shaped the way real records can be.

import { SHIFT_TYPES } from "./household.mjs";

export const FROM = "2026-09-01";
export const TO = "2026-11-30";

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

export function randomState(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const typeIds = SHIFT_TYPES.map((t) => t.id);
  const slot = () => (r() < 0.4 ? null : r() < 0.85 ? pick(typeIds) : { start: pick(["06:00", "08:30", "15:00", "22:00"]), end: pick(["14:00", "18:30", "02:00", "07:00"]) });
  const week = () => Array.from({ length: 7 }, slot);
  // The legacy `template` only ever held preset ids; custom times came with
  // weeklyTemplates.
  const presetWeek = () => Array.from({ length: 7 }, () => (r() < 0.4 ? null : pick(typeIds)));
  const date = () => addDays(FROM, Math.floor(r() * 95) - 2);
  const n = (max) => Math.floor(r() * (max + 1));
  const s = {
    shiftTypes: SHIFT_TYPES,
    template: r() < 0.5 ? presetWeek() : undefined,
    templateEndDate: r() < 0.3 ? date() : undefined,
    alt: { enabled: r() < 0.5, refSat: pick(["2026-09-05", "2026-09-12"]), sat: pick([...typeIds, null]), sun: pick([...typeIds, null]) },
    ot: Array.from({ length: n(6) }, () => ({ date: date(), shiftTypeId: pick(typeIds), label: "OT", coworkers: r() < 0.5 ? "Sam" : "" })),
    otOpportunities: [],
    overrides: Array.from({ length: n(8) }, () => ({ date: date(), shiftTypeId: r() < 0.3 ? null : pick(typeIds), label: "x" })),
    range: { from: FROM, to: TO },
    calName: "c", calView: "schedule", selfName: "Gage",
    partner: { name: "Kaylene", shifts: Array.from({ length: n(10) }, () => ({ date: date(), shiftTypeId: pick(typeIds), label: "p" })) },
    caregiverBlackouts: [],
    ui: { calLayout: "month", viewMonth: "2026-09", viewWeekStart: "2026-09-06" },
    employers: r() < 0.5 ? { G: "A", K: "B", D: "C" } : undefined,
    weeklyTemplates: {
      G: r() < 0.6 ? { days: week(), startDate: r() < 0.3 ? date() : undefined, endDate: r() < 0.3 ? date() : undefined } : undefined,
      K: r() < 0.8 ? { days: week(), startDate: r() < 0.3 ? date() : undefined } : undefined,
      daisy: r() < 0.6 ? { days: week() } : undefined,
    },
    dependents: r() < 0.7 ? { daisy: { name: "Daisy", shifts: Array.from({ length: n(6) }, () => (r() < 0.7 ? { date: date(), shiftTypeId: pick(typeIds), label: "c" } : { date: date(), label: "trip" })) } } : undefined,
    _migrations: [],
  };
  return JSON.parse(JSON.stringify(s)); // drop the undefineds, as Firestore would
}
