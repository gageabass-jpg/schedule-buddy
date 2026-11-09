import { describe, expect, it } from "vitest";
import { exitFromSteps } from "./driveExit";

const step = (instructions?: string) => ({ navigationInstruction: instructions === undefined ? {} : { instructions } });

describe("exitFromSteps", () => {
  it("reads the exit number and where it leads", () => {
    expect(exitFromSteps([step("Take exit 56 toward Dunbar")])).toEqual({ number: "56", toward: "Dunbar" });
  });

  it("prefers 'toward' over 'for' when a step has both", () => {
    expect(exitFromSteps([step("Take exit 56 for WV-61 toward Dunbar/Montrose")])).toEqual({ number: "56", toward: "Dunbar/Montrose" });
  });

  it("falls back to the road a step names with 'for'", () => {
    expect(exitFromSteps([step("Take exit 54 for MacCorkle Ave")])).toEqual({ number: "54", toward: "MacCorkle Ave" });
  });

  it("keeps a letter on the exit and any wording around it", () => {
    expect(exitFromSteps([step("Keep right to take exit 58a toward Charleston")])).toEqual({ number: "58A", toward: "Charleston" });
  });

  it("gives just the number when the step says no more", () => {
    expect(exitFromSteps([step("Take exit 56")])).toEqual({ number: "56" });
  });

  it("takes the last numbered exit: the interchange before it isn't the one you get off on", () => {
    const exit = exitFromSteps([
      step("Take exit 99 to merge onto I-64 W toward Charleston"),
      step("Continue onto I-64 W"),
      step("Take exit 56 toward Dunbar"),
      step("Turn left onto 1st Ave"),
    ]);
    expect(exit).toEqual({ number: "56", toward: "Dunbar" });
  });

  it("keeps only the first sentence of the destination text", () => {
    expect(exitFromSteps([step("Take exit 56 toward Dunbar. Continue for 0.5 mi")])).toEqual({ number: "56", toward: "Dunbar" });
  });

  it("is null when the route never takes a numbered exit", () => {
    expect(exitFromSteps([step("Head east on Main St"), step("Take the ramp on the right"), step("Take the I-64 W exit toward Dunbar")])).toBeNull();
    expect(exitFromSteps([])).toBeNull();
  });

  it("skips steps with no text, and odd entries", () => {
    expect(exitFromSteps([step(), null, undefined, {}, step("Take exit 7")])).toEqual({ number: "7" });
  });
});
