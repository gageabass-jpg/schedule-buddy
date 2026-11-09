import { describe, expect, it } from "vitest";
import { routeChips } from "./routeChips";

describe("routeChips", () => {
  it("labels a lone route with its time and no 'Fastest'", () => {
    expect(routeChips([15])).toEqual({ show: [0], fastestLabel: false });
  });

  it("labels an alternative that takes a different time, and says which is fastest", () => {
    expect(routeChips([21, 24])).toEqual({ show: [0, 1], fastestLabel: true });
  });

  it("gives an alternative that ties the fastest no chip of its own, so '21 min' isn't said twice", () => {
    // Gage's commute: two routes, both 21 minutes.
    expect(routeChips([21, 21])).toEqual({ show: [0], fastestLabel: false });
  });

  it("keeps a slower alternative when another one ties the fastest", () => {
    expect(routeChips([21, 21, 25])).toEqual({ show: [0, 2], fastestLabel: true });
  });

  it("says each distinct time once", () => {
    expect(routeChips([21, 24, 24, 24])).toEqual({ show: [0, 1], fastestLabel: true });
    expect(routeChips([21, 24, 27])).toEqual({ show: [0, 1, 2], fastestLabel: true });
  });

  it("has no chips for no routes", () => {
    expect(routeChips([])).toEqual({ show: [], fastestLabel: false });
  });
});
