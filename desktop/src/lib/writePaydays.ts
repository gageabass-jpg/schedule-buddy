import type { PaydaySchedule } from "../state";
import { readHouseholdState, writeHouseholdState } from "./householdState";

export class PaydayError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PaydayError";
  }
}

function validate(s: PaydaySchedule | null | undefined): string | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.anchor)) return "Anchor must be YYYY-MM-DD.";
  if (s.freq !== "weekly" && s.freq !== "biweekly") return "Frequency must be weekly or biweekly.";
  return null;
}

export async function setPaydaySchedule(
  householdId: string,
  who: "G" | "K",
  schedule: PaydaySchedule | null,
): Promise<void> {
  if (!householdId) throw new PaydayError("No household linked.");
  if (schedule) {
    const err = validate(schedule);
    if (err) throw new PaydayError(err);
  }
  const current = await readHouseholdState(householdId);
  if (!current) throw new PaydayError("Schedule document doesn't exist yet.");
  const paydays = { ...(current.paydays ?? {}) };
  if (schedule) {
    paydays[who] = { anchor: schedule.anchor, freq: schedule.freq };
  } else {
    delete paydays[who];
  }
  try {
    await writeHouseholdState(householdId, current, { ...current, paydays });
  } catch (e) {
    throw new PaydayError("Couldn't save payday schedule.", e);
  }
}
