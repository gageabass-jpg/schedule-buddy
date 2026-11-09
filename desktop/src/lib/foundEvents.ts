// The events the email scans have added, for the sidebar's "Found in email" menu.
//
// The scan functions keep a running list in meta/emailScan (`found`, newest
// first). The calendar is the source of truth for what an event is now, so each
// entry is matched to its event by id: a title or date changed since shows as
// it is, and an event that's been deleted or undone drops out of the list.

import type { Event } from "../state";

/** One entry of the scans' list, as the functions write it. */
export interface FoundEntry {
  id: string;
  title: string;
  date: string;
  who?: Event["who"];
  startTime?: string;
  /** When the scan found it (epoch ms). */
  at: number;
  trigger?: "weekly" | "manual";
}

export interface FoundEvent {
  id: string;
  title: string;
  date: string;
  who: Event["who"];
  startTime?: string;
  foundAt: number;
}

export function foundInEmail(found: ReadonlyArray<FoundEntry | null> | undefined, events: ReadonlyArray<Event>): FoundEvent[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: FoundEvent[] = [];
  for (const f of found ?? []) {
    if (!f || typeof f.id !== "string" || seen.has(f.id)) continue;
    const ev = byId.get(f.id);
    if (!ev) continue;
    seen.add(f.id);
    out.push({ id: ev.id, title: ev.title, date: ev.date, who: ev.who, ...(ev.startTime ? { startTime: ev.startTime } : {}), foundAt: f.at });
  }
  return out;
}
