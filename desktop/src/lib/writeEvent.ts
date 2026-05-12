import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { Event, EventWho, HouseholdState } from "../state";
import { generateEventId, generateSeriesId } from "../state";

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

export async function deleteSeries(householdId: string, seriesId: string): Promise<number> {
  const current = await readState(householdId);
  const before = (current.events ?? []).length;
  const list = (current.events ?? []).filter((e) => e.seriesId !== seriesId);
  await writeState(householdId, { ...current, events: list });
  return before - list.length;
}

/**
 * Add a batch of events in one Firestore write.
 *
 * Used by the EventModal when the user picks multiple dates and/or checks
 * "Recurring": we expand the list weekly through the end date (each base
 * date stays on the same day-of-week), de-dupe, sort, then create one
 * Event per resulting date. All share a generated seriesId so the user
 * can later "Delete series" in one tap.
 *
 * Returns the seriesId (if a batch was created) and every individual id.
 */
export async function addEvents(
  householdId: string,
  baseInput: Omit<EventInput, "date">,
  dates: string[],
  untilWeekly?: string,           // YYYY-MM-DD, optional weekly recurrence end
): Promise<{ seriesId: string | null; ids: string[] }> {
  if (dates.length === 0) throw new WriteEventError("Add at least one date.");
  for (const d of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new WriteEventError(`Bad date: "${d}".`);
  }
  if (untilWeekly && !/^\d{4}-\d{2}-\d{2}$/.test(untilWeekly)) {
    throw new WriteEventError("Repeat-until must be YYYY-MM-DD.");
  }
  const baseErr = validate({ ...baseInput, date: dates[0] });
  if (baseErr) throw new WriteEventError(baseErr);

  const expanded = expandWeekly(dates, untilWeekly);
  if (expanded.length > 365) {
    throw new WriteEventError(`That would create ${expanded.length} events. Tighten the end date.`);
  }

  const isBatch = expanded.length > 1;
  const seriesId = isBatch ? generateSeriesId() : null;
  const current = await readState(householdId);
  const list = [...(current.events ?? [])];
  const ids: string[] = [];

  for (const date of expanded) {
    const id = generateEventId();
    ids.push(id);
    const ev: Event = { id, ...cleanInput({ ...baseInput, date }) };
    if (seriesId) ev.seriesId = seriesId;
    list.push(ev);
  }

  await writeState(householdId, { ...current, events: list });
  return { seriesId, ids };
}

/**
 * Take each base date and, if untilWeekly is set, also add the same day-of-week
 * each subsequent week through untilWeekly. Returns the unique, sorted set.
 */
function expandWeekly(baseDates: string[], untilWeekly?: string): string[] {
  const out = new Set<string>();
  if (!untilWeekly) {
    for (const d of baseDates) out.add(d);
    return [...out].sort();
  }
  const endTime = new Date(untilWeekly + "T00:00:00").getTime();
  for (const base of baseDates) {
    const start = new Date(base + "T00:00:00").getTime();
    if (Number.isNaN(start)) continue;
    for (let t = start; t <= endTime; t += 7 * 24 * 60 * 60 * 1000) {
      const d = new Date(t);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.add(iso);
    }
  }
  return [...out].sort();
}
