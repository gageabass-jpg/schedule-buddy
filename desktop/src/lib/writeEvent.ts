import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { Event, EventWho, HouseholdState } from "../state";
import { generateEventId } from "../state";

export class WriteEventError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteEventError";
  }
}

export interface EventInput {
  date: string;          // YYYY-MM-DD
  startTime?: string;    // HH:MM
  endTime?: string;      // HH:MM
  title: string;
  who: EventWho;
  notes?: string;
}

function validate(input: EventInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Date must be YYYY-MM-DD.";
  if (!input.title.trim()) return "Give the event a title.";
  if (input.startTime && !/^\d{2}:\d{2}$/.test(input.startTime)) return "Start time must be HH:MM.";
  if (input.endTime && !/^\d{2}:\d{2}$/.test(input.endTime)) return "End time must be HH:MM.";
  return null;
}

async function readState(householdId: string): Promise<HouseholdState> {
  const ref = doc(db, "households", householdId, "state", "main");
  let snap;
  try { snap = await getDoc(ref); }
  catch (e) { throw new WriteEventError("Couldn't read the household schedule.", e); }
  if (!snap.exists()) throw new WriteEventError("Schedule document doesn't exist yet.");
  return snap.data() as HouseholdState;
}

async function writeState(householdId: string, next: HouseholdState): Promise<void> {
  const ref = doc(db, "households", householdId, "state", "main");
  try { await setDoc(ref, next); }
  catch (e) { throw new WriteEventError("Couldn't save the change.", e); }
}

function cleanInput(input: EventInput): Omit<Event, "id"> {
  const ev: Omit<Event, "id"> = {
    date: input.date,
    title: input.title.trim(),
    who: input.who,
  };
  if (input.startTime) ev.startTime = input.startTime;
  if (input.endTime)   ev.endTime   = input.endTime;
  if (input.notes && input.notes.trim()) ev.notes = input.notes.trim();
  return ev;
}

export async function addEvent(householdId: string, input: EventInput): Promise<string> {
  const err = validate(input);
  if (err) throw new WriteEventError(err);
  const current = await readState(householdId);
  const id = generateEventId();
  const next: HouseholdState = {
    ...current,
    events: [...(current.events ?? []), { id, ...cleanInput(input) }],
  };
  await writeState(householdId, next);
  return id;
}

export async function updateEvent(householdId: string, id: string, input: EventInput): Promise<void> {
  const err = validate(input);
  if (err) throw new WriteEventError(err);
  const current = await readState(householdId);
  const list = [...(current.events ?? [])];
  const idx = list.findIndex((e) => e.id === id);
  if (idx < 0) throw new WriteEventError("That event no longer exists.");
  list[idx] = { id, ...cleanInput(input) };
  await writeState(householdId, { ...current, events: list });
}

export async function deleteEvent(householdId: string, id: string): Promise<void> {
  const current = await readState(householdId);
  const list = (current.events ?? []).filter((e) => e.id !== id);
  await writeState(householdId, { ...current, events: list });
}
