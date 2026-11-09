import { describe, expect, it } from "vitest";
import { parseMailQuery } from "../../../shared/mailQuery";

describe("parseMailQuery", () => {
  it("reads how far back and what to look for", () => {
    expect(parseMailQuery("newer_than:30d appointment")).toEqual({ sinceDays: 30, terms: ["appointment"] });
  });

  it("takes the alternatives from a grouped OR, phrases whole", () => {
    expect(parseMailQuery("newer_than:2w (appointment OR confirmed OR \"has been scheduled\")")).toEqual({
      sinceDays: 14, terms: ["appointment", "confirmed", "has been scheduled"],
    });
  });

  it("understands days, weeks, months and years", () => {
    expect(parseMailQuery("newer_than:10d x").sinceDays).toBe(10);
    expect(parseMailQuery("newer_than:1m x").sinceDays).toBe(30);
    expect(parseMailQuery("newer_than:1y x").sinceDays).toBe(365);
    expect(parseMailQuery("newer_than:7 x").sinceDays).toBe(7);
  });

  it("looks for what a from: or subject: names, and ignores the other operators", () => {
    expect(parseMailQuery("from:rocklakevet.com subject:booking in:inbox label:unread is:unread category:primary"))
      .toEqual({ terms: ["rocklakevet.com", "booking"] });
  });

  it("drops exclusions, repeats and the AND/OR words themselves", () => {
    expect(parseMailQuery("-unsubscribe school AND School OR conference")).toEqual({ terms: ["school", "conference"] });
  });

  it("stops at eight terms", () => {
    expect(parseMailQuery("a b c d e f g h i j").terms).toHaveLength(8);
  });

  it("is empty for nothing", () => {
    expect(parseMailQuery("")).toEqual({ terms: [] });
    expect(parseMailQuery("   ")).toEqual({ terms: [] });
  });
});
