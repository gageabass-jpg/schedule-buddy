import { describe, expect, it } from "vitest";
import { buildShiftMap, type HouseholdState } from "../state";

/**
 * A shift's note is what the day popover shows under NOTE. It used to be lost
 * for Gage's one-off days (overrides had no note) — these pin that each kind
 * of dated entry carries its note through to the calendar.
 */
const DAY = { id: "day", name: "Day", start: "07:00", end: "19:30" };

function state(): HouseholdState {
  return {
    shiftTypes: [DAY],
    template: ["day", null, null, null, null, null, null],
    overrides: [{ date: "2026-10-06", shiftTypeId: "day", label: "", note: "bring badge" }],
    ot: [{ date: "2026-10-07", shiftTypeId: "day", label: "", note: "ER float" }],
    partner: { name: "Kaylene", shifts: [{ date: "2026-10-08", shiftTypeId: "day", label: "", note: "covering for Sam" }] },
  } as unknown as HouseholdState;
}

describe("shift notes", () => {
  const map = buildShiftMap(state(), "2026-10-04", "2026-10-08");

  it("carries a one-off day's note for Gage", () => {
    expect(map["2026-10-06"].find((s) => s.who === "G")?.note).toBe("bring badge");
  });

  it("carries overtime and partner notes", () => {
    expect(map["2026-10-07"].find((s) => s.who === "G")?.note).toBe("ER float");
    expect(map["2026-10-08"].find((s) => s.who === "K")?.note).toBe("covering for Sam");
  });

  it("leaves template days without a note", () => {
    // 2026-10-04 is a Sunday, the template's one working day.
    const sun = map["2026-10-04"].find((s) => s.who === "G");
    expect(sun?.source?.kind).toBe("template");
    expect(sun?.note).toBeUndefined();
  });
});
