import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { HouseholdState, ShiftType } from "../state";

export class ShiftTypeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ShiftTypeError";
  }
}

export interface ShiftTypeInput {
  name: string;
  start: string;        // "HH:MM"
  end: string;          // "HH:MM"
  /** Hours of post-shift sleep — used by the coverage engine. 0 / omit = no sleep window. */
  sleepHours?: number;
}

export function generateShiftTypeId(existing: ShiftType[]): string {
  // 6-char random suffix, retry on collision (vanishingly unlikely).
  for (let i = 0; i < 5; i++) {
    const id = `st_${Math.random().toString(36).slice(2, 8)}`;
    if (!existing.some((t) => t.id === id)) return id;
  }
  throw new ShiftTypeError("Couldn't generate a unique shift-type id.");
}

export function crossesMidnight(start: string, end: string): boolean {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return eh * 60 + em <= sh * 60 + sm;
}

function validate(input: ShiftTypeInput): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!/^\d{2}:\d{2}$/.test(input.start)) return "Start time must be HH:MM.";
  if (!/^\d{2}:\d{2}$/.test(input.end)) return "End time must be HH:MM.";
  if (input.sleepHours !== undefined) {
    if (!Number.isFinite(input.sleepHours) || input.sleepHours < 0 || input.sleepHours > 24) {
      return "Sleep hours must be between 0 and 24.";
    }
  }
  return null;
}

function cleanSleep(h: number | undefined): number | undefined {
  if (h === undefined || h === null) return undefined;
  if (!Number.isFinite(h) || h <= 0) return undefined;
  return h;
}

async function readState(householdId: string): Promise<HouseholdState> {
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (e) {
    throw new ShiftTypeError("Couldn't read the household schedule.", e);
  }
  if (!snap.exists()) {
    throw new ShiftTypeError("Schedule document doesn't exist yet.");
  }
  return snap.data() as HouseholdState;
}

async function writeState(householdId: string, next: HouseholdState): Promise<void> {
  const ref = doc(db, "households", householdId, "state", "main");
  try {
    await setDoc(ref, next);
  } catch (e) {
    throw new ShiftTypeError("Couldn't save the change. Check your connection.", e);
  }
}

export async function addShiftType(householdId: string, input: ShiftTypeInput): Promise<string> {
  const err = validate(input);
  if (err) throw new ShiftTypeError(err);

  const current = await readState(householdId);
  const list = [...(current.shiftTypes ?? [])];
  const id = generateShiftTypeId(list);
  const sleep = cleanSleep(input.sleepHours);
  list.push({
    id,
    name: input.name.trim(),
    start: input.start,
    end: input.end,
    crossesMidnight: crossesMidnight(input.start, input.end),
    ...(sleep !== undefined ? { sleepHours: sleep } : {}),
  });
  await writeState(householdId, { ...current, shiftTypes: list });
  return id;
}

export async function updateShiftType(
  householdId: string,
  id: string,
  input: ShiftTypeInput,
): Promise<void> {
  const err = validate(input);
  if (err) throw new ShiftTypeError(err);

  const current = await readState(householdId);
  const list = [...(current.shiftTypes ?? [])];
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) throw new ShiftTypeError("That shift type no longer exists.");
  const sleep = cleanSleep(input.sleepHours);
  list[idx] = {
    ...list[idx],
    name: input.name.trim(),
    start: input.start,
    end: input.end,
    crossesMidnight: crossesMidnight(input.start, input.end),
    ...(sleep !== undefined ? { sleepHours: sleep } : { sleepHours: undefined }),
  };
  // Drop the field entirely when zero so Firestore docs stay clean.
  if (sleep === undefined) delete (list[idx] as Partial<ShiftType>).sleepHours;
  await writeState(householdId, { ...current, shiftTypes: list });
}

export interface ShiftTypeUsage {
  inTemplate: boolean;
  inAltWeekend: boolean;
  otCount: number;
  overrideCount: number;
  partnerCount: number;
  /** Total references — > 0 means the type is in use somewhere. */
  total: number;
}

export function shiftTypeUsage(state: HouseholdState, id: string): ShiftTypeUsage {
  const inTemplate = (state.template ?? []).some((t) => t === id);
  const inAltWeekend = state.alt?.sat === id || state.alt?.sun === id;
  const otCount = (state.ot ?? []).filter((o) => o.shiftTypeId === id).length;
  const overrideCount = (state.overrides ?? []).filter((o) => o.shiftTypeId === id).length;
  const partnerCount = (state.partner?.shifts ?? []).filter((p) => p.shiftTypeId === id).length;
  const total =
    (inTemplate ? 1 : 0) +
    (inAltWeekend ? 1 : 0) +
    otCount +
    overrideCount +
    partnerCount;
  return { inTemplate, inAltWeekend, otCount, overrideCount, partnerCount, total };
}

export async function deleteShiftType(householdId: string, id: string): Promise<void> {
  const current = await readState(householdId);
  const usage = shiftTypeUsage(current, id);
  if (usage.total > 0) {
    const parts: string[] = [];
    if (usage.inTemplate) parts.push("the weekly template");
    if (usage.inAltWeekend) parts.push("alt-weekend pattern");
    if (usage.otCount) parts.push(`${usage.otCount} OT shift${usage.otCount === 1 ? "" : "s"}`);
    if (usage.overrideCount) parts.push(`${usage.overrideCount} override${usage.overrideCount === 1 ? "" : "s"}`);
    if (usage.partnerCount) parts.push(`${usage.partnerCount} partner shift${usage.partnerCount === 1 ? "" : "s"}`);
    throw new ShiftTypeError(
      `In use by ${parts.join(", ")}. Remove or change those before deleting.`,
    );
  }
  const list = (current.shiftTypes ?? []).filter((t) => t.id !== id);
  await writeState(householdId, { ...current, shiftTypes: list });
}
