// The pure half of useScheduleChangeToasts: what counts as a change between
// two snapshots of the household, and how a caregiver's answers are worded.
// Kept free of React so the wording is tested directly
// (changeNotices.test.ts).

import type { HouseholdState } from "../state";

/**
 * One key per dated shift entry. Two entries that look the same (two
 * overtime shifts of one type on one date) get #0 and #1, so adding or
 * removing one of them counts as one. The number comes from the content, not
 * a fresh id, so an unchanged schedule gives the same keys every time.
 */
export function shiftKeysOf(state: HouseholdState): Set<string> {
  const keys = new Set<string>();
  const add = (base: string) => {
    let n = 0;
    while (keys.has(`${base}#${n}`)) n++;
    keys.add(`${base}#${n}`);
  };
  for (const o of state.ot ?? []) add(`ot:${o.date}:${o.shiftTypeId}`);
  for (const p of state.partner?.shifts ?? []) add(`k:${p.date}:${p.shiftTypeId}`);
  for (const d of state.dependents?.daisy?.shifts ?? []) add(`d:${d.date}:${d.shiftTypeId ?? d.label}`);
  for (const ov of state.overrides ?? []) add(`ov:${ov.date}:${ov.shiftTypeId ?? "off"}`);
  return keys;
}

/** The date (YYYY-MM-DD) in a shift key. */
export const shiftKeyDate = (key: string): string => key.split(":")[1];

/** Requests the caregiver confirmed or declined between two snapshots
 *  (request id → status). */
export function coverageAnswered(
  before: Map<string, string>,
  next: Map<string, string>,
): { confirmed: number; declined: number } {
  let confirmed = 0;
  let declined = 0;
  for (const [id, status] of next) {
    if (before.get(id) === status) continue;
    if (status === "confirmed") confirmed++;
    else if (status === "declined") declined++;
  }
  return { confirmed, declined };
}

/** What the caregiver just did, in a sentence — or null when nothing. */
export function coverageAnswerText(caregiver: string, confirmed: number, declined: number): string | null {
  const request = (n: number) => (n === 1 ? "coverage request" : "coverage requests");
  if (confirmed > 0 && declined > 0) {
    return `${caregiver} confirmed ${confirmed} and declined ${declined} ${request(declined)}.`;
  }
  if (confirmed > 0) {
    return confirmed === 1
      ? `${caregiver} confirmed a coverage request.`
      : `${caregiver} confirmed ${confirmed} coverage requests.`;
  }
  if (declined > 0) {
    return declined === 1
      ? `${caregiver} declined a coverage request.`
      : `${caregiver} declined ${declined} coverage requests.`;
  }
  return null;
}
