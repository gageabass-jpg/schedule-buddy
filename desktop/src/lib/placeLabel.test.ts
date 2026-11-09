import { describe, expect, it } from "vitest";
import { shortPlaceLabel } from "./placeLabel";

describe("shortPlaceLabel", () => {
  it("shortens the workplace to what the card says", () => {
    expect(shortPlaceLabel("WVU Medicine - Thomas Memorial Hospital")).toBe("Thomas Hospital");
    expect(shortPlaceLabel("Thomas Memorial Hospital")).toBe("Thomas Hospital");
  });

  it("drops a health system's name in front of a dash, whichever dash", () => {
    expect(shortPlaceLabel("WVU Medicine – Thomas Hospital")).toBe("Thomas Hospital");
    expect(shortPlaceLabel("WVU Medicine — Thomas Hospital")).toBe("Thomas Hospital");
  });

  it("leaves a name that starts with Memorial alone", () => {
    expect(shortPlaceLabel("Memorial Hospital")).toBe("Memorial Hospital");
    expect(shortPlaceLabel("Charleston Area Medical Center - Memorial Hospital")).toBe("Memorial Hospital");
  });

  it("leaves other places as they are, and keeps hyphens inside words", () => {
    expect(shortPlaceLabel("Charleston Area Medical Center")).toBe("Charleston Area Medical Center");
    expect(shortPlaceLabel("Wal-Mart Supercenter")).toBe("Wal-Mart Supercenter");
    expect(shortPlaceLabel("  Home  ")).toBe("Home");
  });

  it("copes with an empty label", () => {
    expect(shortPlaceLabel("")).toBe("");
  });
});
