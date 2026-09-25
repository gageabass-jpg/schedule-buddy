import { useEffect, useRef } from "react";
import type { HouseholdState } from "../state";
import { MONTHS_LONG } from "../data";
import { changeNoticesMuted, notify } from "../lib/toast";

/**
 * Announce changes to the schedule as they land.
 *
 * The household document streams in live, so a change made on another device
 * — Kaylene importing her roster, Daisy answering a coverage request — arrives
 * here as a new snapshot. Diffing consecutive snapshots is what lets the app
 * say "Daisy added a life event in October" rather than silently redrawing.
 *
 * The first snapshot after sign-in is the baseline and never announces
 * anything, or opening the app would replay the whole schedule at you.
 */

type Nav = {
  /** Jump the calendar to a date and select it. */
  goToDate: (iso: string) => void;
  /** Show the coverage view in the left rail. */
  showCoverage: () => void;
};

interface Snapshot {
  shiftKeys: Set<string>;
  eventKeys: Map<string, { date: string; title: string; who: string }>;
  coverage: Map<string, string>;   // request id → status
}

function snapshotOf(state: HouseholdState | null): Snapshot | null {
  if (!state) return null;
  const shiftKeys = new Set<string>();
  for (const o of state.ot ?? []) shiftKeys.add(`ot:${o.date}:${o.shiftTypeId}`);
  for (const p of state.partner?.shifts ?? []) shiftKeys.add(`k:${p.date}:${p.shiftTypeId}`);
  for (const d of state.dependents?.daisy?.shifts ?? []) shiftKeys.add(`d:${d.date}:${d.shiftTypeId ?? d.label}`);
  for (const ov of state.overrides ?? []) shiftKeys.add(`ov:${ov.date}:${ov.shiftTypeId ?? "off"}`);

  const eventKeys = new Map<string, { date: string; title: string; who: string }>();
  for (const e of state.events ?? []) eventKeys.set(e.id, { date: e.date, title: e.title, who: String(e.who) });

  const coverage = new Map<string, string>();
  for (const r of state.coverageRequests ?? []) coverage.set(r.id, r.status);

  return { shiftKeys, eventKeys, coverage };
}

/** "October" when every date shares a month, otherwise nothing. */
function monthPhrase(dates: string[]): string {
  const months = new Set(dates.map((d) => d.slice(0, 7)));
  if (months.size !== 1) return "";
  const [, mm] = [...months][0].split("-").map(Number);
  return ` in ${MONTHS_LONG[(mm || 1) - 1]}`;
}

function personLabel(who: string, state: HouseholdState | null): string {
  if (who === "G") return state?.selfName?.trim() || "Gage";
  if (who === "K") return state?.partner?.name?.trim() || "Kaylene";
  if (who === "Daisy" || who === "D") return state?.dependents?.daisy?.name?.trim() || "Daisy";
  return "Someone";
}

export function useScheduleChangeToasts(state: HouseholdState | null, nav: Nav): void {
  const prev = useRef<Snapshot | null>(null);
  const navRef = useRef(nav);
  // Kept current in an effect rather than during render, so the render stays
  // free of side effects.
  useEffect(() => { navRef.current = nav; });

  useEffect(() => {
    const next = snapshotOf(state);
    if (!next) return;

    const before = prev.current;
    prev.current = next;
    // First snapshot is the baseline, and a local action that already spoke
    // for itself asked for quiet.
    if (!before || changeNoticesMuted()) return;

    // ── Shifts ────────────────────────────────────────────────────────────
    const addedShifts = [...next.shiftKeys].filter((k) => !before.shiftKeys.has(k));
    const removedShifts = [...before.shiftKeys].filter((k) => !next.shiftKeys.has(k));
    const dateOf = (key: string) => key.split(":")[1];

    if (addedShifts.length > 0) {
      const dates = addedShifts.map(dateOf).sort();
      notify(
        `${addedShifts.length} shift${addedShifts.length === 1 ? "" : "s"} added${monthPhrase(dates)}.`,
        { actionLabel: "Tap to view", onAction: () => navRef.current.goToDate(dates[0]) },
      );
    }
    if (removedShifts.length > 0) {
      const dates = removedShifts.map(dateOf).sort();
      notify(
        `${removedShifts.length} shift${removedShifts.length === 1 ? "" : "s"} removed${monthPhrase(dates)}.`,
        { actionLabel: "Tap to view", onAction: () => navRef.current.goToDate(dates[0]) },
      );
    }

    // ── Life events ───────────────────────────────────────────────────────
    for (const [id, ev] of next.eventKeys) {
      if (before.eventKeys.has(id)) continue;
      notify(
        `${personLabel(ev.who, state)} added a life event${monthPhrase([ev.date])}. Tap to view.`,
        { onAction: () => navRef.current.goToDate(ev.date) },
      );
    }
    for (const [id, ev] of before.eventKeys) {
      if (next.eventKeys.has(id)) continue;
      notify(`A life event was removed${monthPhrase([ev.date])}: ${ev.title}.`);
    }

    // ── Coverage answers ──────────────────────────────────────────────────
    // Only announce once the caregiver has actually answered something new.
    const answeredNow = [...next.coverage].filter(([id, status]) => {
      const was = before.coverage.get(id);
      return was !== status && (status === "confirmed" || status === "declined");
    });
    if (answeredNow.length > 0) {
      const caregiver = state?.dependents?.daisy?.name?.trim() || "Daisy";
      const thisMonth = (state?.coverageRequests ?? []).filter((r) => r.date.slice(0, 7) === new Date().toISOString().slice(0, 7));
      const approved = thisMonth.filter((r) => r.status === "confirmed").length;
      const declined = answeredNow.filter(([, s]) => s === "declined").length;
      notify(
        declined > 0 && approved === 0
          ? `${caregiver} declined ${declined} coverage request${declined === 1 ? "" : "s"}. Review coverage matrix now.`
          : `${caregiver} approved ${approved}/${thisMonth.length} coverage requests this month. Review coverage matrix now.`,
        { actionLabel: "Review coverage", onAction: () => navRef.current.showCoverage() },
      );
    }
  }, [state]);
}
