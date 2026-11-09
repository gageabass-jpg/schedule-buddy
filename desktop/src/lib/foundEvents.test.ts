import { describe, expect, it } from "vitest";
import type { Event } from "../state";
import { foundInEmail, type FoundEntry } from "./foundEvents";

const ev = (id: string, over: Partial<Event> = {}): Event => ({ id, date: "2026-11-12", title: `Event ${id}`, who: "G", ...over });
const entry = (id: string, at: number, over: Partial<FoundEntry> = {}): FoundEntry => ({ id, title: `Found ${id}`, date: "2026-11-12", who: "G", at, ...over });

describe("foundInEmail", () => {
  it("lists the scans' events in the order they were kept, as the calendar has them now", () => {
    const out = foundInEmail(
      [entry("a", 300, { title: "Vet Appointment" }), entry("b", 200)],
      [ev("b", { title: "Dentist Cleaning", date: "2026-11-20", startTime: "09:30", who: "K" }), ev("a", { title: "Vet Appointment (moved)", date: "2026-11-14" })],
    );
    expect(out).toEqual([
      { id: "a", title: "Vet Appointment (moved)", date: "2026-11-14", who: "G", foundAt: 300 },
      { id: "b", title: "Dentist Cleaning", date: "2026-11-20", who: "K", startTime: "09:30", foundAt: 200 },
    ]);
  });

  it("drops an event that's no longer on the calendar (deleted, or undone)", () => {
    expect(foundInEmail([entry("a", 1), entry("gone", 2)], [ev("a")]).map((e) => e.id)).toEqual(["a"]);
  });

  it("shows an event once, even if it was recorded twice", () => {
    expect(foundInEmail([entry("a", 2), entry("a", 1)], [ev("a")])).toHaveLength(1);
  });

  it("copes with no list, and with bad entries", () => {
    expect(foundInEmail(undefined, [ev("a")])).toEqual([]);
    expect(foundInEmail([null, { id: 7 } as unknown as FoundEntry], [ev("a")])).toEqual([]);
  });
});
