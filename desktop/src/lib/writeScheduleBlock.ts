// Schedule blocks — date-range markers (vacation, travel, etc.) that
// render as red diagonal stripes on calendar cells. Drawn from the
// Inspector's Utilities → Schedule Block tool.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import type { HouseholdState, ScheduleBlock } from "../state";

export class WriteScheduleBlockError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteScheduleBlockError";
  }
}

export interface ScheduleBlockInput {
  startDate: string;     // YYYY-MM-DD
  endDate: string;       // YYYY-MM-DD
  label?: string;
  notes?: string;
}

function validate(i: ScheduleBlockInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.startDate)) return "Start date must be YYYY-MM-DD.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.endDate))   return "End date must be YYYY-MM-DD.";
  if (i.endDate < i.startDate) return "End date can't be before start date.";
  if ((i.label?.length ?? 0) > 80) return "Keep the label under 80 characters.";
  return null;
}

function genBlockId(): string {
  return "blk_" + Math.random().toString(36).slice(2, 10);
}

async function readState(householdId: string): Promise<HouseholdState> {
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try { snap = await getDoc(ref); }
  catch (e) { throw new WriteScheduleBlockError("Couldn't read household state.", e); }
  if (!snap.exists()) throw new WriteScheduleBlockError("State document doesn't exist yet.");
  return snap.data() as HouseholdState;
}

async function writeState(householdId: string, next: HouseholdState): Promise<void> {
  const ref = doc(db, "households", householdId, "state", "main");
  try { await setDoc(ref, next); }
  catch (e) { throw new WriteScheduleBlockError("Couldn't save the schedule block.", e); }
}

export async function addScheduleBlock(householdId: string, input: ScheduleBlockInput): Promise<string> {
  const err = validate(input);
  if (err) throw new WriteScheduleBlockError(err);
  if (!auth.currentUser) throw new WriteScheduleBlockError("Not signed in.");
  const current = await readState(householdId);
  const block: ScheduleBlock = {
    id: genBlockId(),
    startDate: input.startDate,
    endDate: input.endDate,
    createdAt: Date.now(),
    createdBy: auth.currentUser.uid,
  };
  if (input.label?.trim()) block.label = input.label.trim();
  if (input.notes?.trim()) block.notes = input.notes.trim();
  await writeState(householdId, {
    ...current,
    scheduleBlocks: [...(current.scheduleBlocks ?? []), block],
  });
  return block.id;
}

export async function removeScheduleBlock(householdId: string, id: string): Promise<void> {
  const current = await readState(householdId);
  const list = (current.scheduleBlocks ?? []).filter((b) => b.id !== id);
  await writeState(householdId, { ...current, scheduleBlocks: list });
}

/** Returns the first schedule block (if any) that contains the given date. */
export function blockForDate(
  blocks: ScheduleBlock[] | undefined,
  iso: string,
): ScheduleBlock | undefined {
  if (!blocks) return undefined;
  return blocks.find((b) => iso >= b.startDate && iso <= b.endDate);
}
