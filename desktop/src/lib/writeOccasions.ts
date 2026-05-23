// Occasions — birthdays, anniversaries, holidays. Stored on
// `state.occasions` and surfaced as colored flair on the wall display's
// hero line ("Daisy's birthday today!").
//
// Annual flag means the year is ignored when matching; only month-day
// drives the match. Suits birthdays (every Aug 12) and fixed holidays
// (Dec 25). One-off occasions (e.g., a specific trip) use annual=false.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { HouseholdState, OccasionEntry, OccasionType } from "../state";

export class WriteOccasionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteOccasionError";
  }
}

export interface OccasionInput {
  date: string;          // YYYY-MM-DD
  label: string;
  type: OccasionType;
  annual?: boolean;
}

function validate(input: OccasionInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Date must be YYYY-MM-DD.";
  if (!input.label.trim()) return "Give the occasion a label.";
  if (input.label.length > 80) return "Keep the label under 80 characters.";
  return null;
}

function genOccasionId(): string {
  return "occ_" + Math.random().toString(36).slice(2, 10);
}

async function readState(householdId: string): Promise<HouseholdState> {
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try { snap = await getDoc(ref); }
  catch (e) { throw new WriteOccasionError("Couldn't read household state.", e); }
  if (!snap.exists()) throw new WriteOccasionError("Schedule document doesn't exist yet.");
  return snap.data() as HouseholdState;
}

async function writeState(householdId: string, next: HouseholdState): Promise<void> {
  const ref = doc(db, "households", householdId, "state", "main");
  try { await setDoc(ref, next); }
  catch (e) { throw new WriteOccasionError("Couldn't save.", e); }
}

export async function addOccasion(householdId: string, input: OccasionInput): Promise<string> {
  const err = validate(input);
  if (err) throw new WriteOccasionError(err);
  const current = await readState(householdId);
  const entry: OccasionEntry = {
    id: genOccasionId(),
    date: input.date,
    label: input.label.trim(),
    type: input.type,
  };
  if (input.annual) entry.annual = true;
  await writeState(householdId, {
    ...current,
    occasions: [...(current.occasions ?? []), entry],
  });
  return entry.id;
}

export async function removeOccasion(householdId: string, id: string): Promise<void> {
  const current = await readState(householdId);
  const list = (current.occasions ?? []).filter((o) => o.id !== id);
  await writeState(householdId, { ...current, occasions: list });
}
