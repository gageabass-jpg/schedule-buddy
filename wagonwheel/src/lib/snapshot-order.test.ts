import { describe, expect, it } from "vitest";
import type { Snapshot } from "@shared/types";
import { isStale } from "./snapshot-order";

const snap = (revision?: number): Snapshot => ({
  projects: [], tasks: [], milestones: [], notes: [], services: [], serviceCharges: [], settings: {},
  ...(revision === undefined ? {} : { revision }),
});

describe("isStale", () => {
  it("drops a snapshot read before one already shown", () => {
    expect(isStale(snap(4), 5)).toBe(true);
  });

  it("shows a newer one, and the same one again", () => {
    expect(isStale(snap(6), 5)).toBe(false);
    expect(isStale(snap(5), 5)).toBe(false);
  });

  it("shows the first one, whatever its number", () => {
    expect(isStale(snap(1), -1)).toBe(false);
  });

  it("never drops a snapshot that has no revision", () => {
    expect(isStale(snap(), 99)).toBe(false);
  });

  it("lets a late reply be dropped while the newest stays on screen", () => {
    // The order the replies land in: 7, then 5 (read earlier, arrived later), then 8.
    let newest = -1;
    const shown: number[] = [];
    for (const rev of [7, 5, 8]) {
      const s = snap(rev);
      if (isStale(s, newest)) continue;
      newest = s.revision as number;
      shown.push(rev);
    }
    expect(shown).toEqual([7, 8]);
  });
});
