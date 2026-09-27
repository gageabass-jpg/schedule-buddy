import { describe, expect, it } from "vitest";
import { assignLanes } from "./lanes";

describe("assignLanes", () => {
  it("gives a lone block the whole width", () => {
    expect(assignLanes([{ id: "a", top: 0, bottom: 100 }]).get("a")).toEqual({ lane: 0, lanes: 1 });
  });

  it("puts overlapping blocks side by side and reuses a freed lane", () => {
    // Kaylene 6a–2:30p, Daisy's class 10a–2p, coverage 2p–6p.
    const lanes = assignLanes([
      { id: "k", top: 0, bottom: 510 },
      { id: "d", top: 240, bottom: 480 },
      { id: "cov", top: 480, bottom: 720 },
    ]);
    expect(lanes.get("k")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("d")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("cov")).toEqual({ lane: 1, lanes: 2 });
  });

  it("keeps separate groups independent", () => {
    const lanes = assignLanes([
      { id: "a", top: 0, bottom: 100 },
      { id: "b", top: 50, bottom: 120 },
      { id: "c", top: 200, bottom: 300 },
    ]);
    expect(lanes.get("c")).toEqual({ lane: 0, lanes: 1 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
  });
});
