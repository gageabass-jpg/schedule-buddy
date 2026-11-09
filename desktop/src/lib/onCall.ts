// On call: the asterisk on Kaylene's schedule. A day-level mark kept in
// state.partner.onCall, independent of her shifts (she can be on call on a day
// off), so it is looked up by date rather than read off a Shift.

import type { HouseholdState, OnCallDay } from "../state";

/** The on-call entry for `date`, if the partner is on call that day. */
export function onCallOn(state: HouseholdState | null | undefined, date: string): OnCallDay | undefined {
  return state?.partner?.onCall?.find((o) => o.date === date);
}

/** "Kaylene is on call" — the words behind the phone mark. */
export function onCallLabel(name: string, entry: OnCallDay): string {
  return `${name} is on call${entry.pending ? " (pending)" : ""}`;
}
