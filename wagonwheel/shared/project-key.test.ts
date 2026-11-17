import { describe, expect, it } from "vitest";
import { isValidKey, normalizeKey, suggestProjectKey } from "./project-key.js";
import { taskCode } from "./types.js";

const none = new Set<string>();

describe("suggestProjectKey", () => {
  it("takes the initials of a name of several words", () => {
    expect(suggestProjectKey("Nucleus Manager", none)).toBe("NM");
    expect(suggestProjectKey("piper-locke", none)).toBe("PL");
    expect(suggestProjectKey("Nucleus Wagonwheel Desktop", none)).toBe("NWD");
  });

  it("takes the first three letters of a one-word name, not splitting it by its capitals", () => {
    expect(suggestProjectKey("RxManager", none)).toBe("RXM");
    expect(suggestProjectKey("Atlas", none)).toBe("ATL");
  });

  it("is always capitals and digits, 2 to 5 of them", () => {
    for (const name of ["a", "Ünïcode ñame", "  spaced   out  ", "1 2 3 4 5 6 7 8", "x-y", "!!!", ""]) {
      expect(isValidKey(suggestProjectKey(name, none)), name).toBe(true);
    }
  });

  it("moves to another spelling when the first is taken, and never repeats one", () => {
    expect(suggestProjectKey("Nucleus Manager", new Set(["NM"]))).toBe("NUC");
    expect(suggestProjectKey("Nucleus Manager", new Set(["NM", "NUC"]))).toBe("NUCL");
    const taken = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const key = suggestProjectKey("Same Name", taken);
      expect(taken.has(key), key).toBe(false);
      taken.add(key);
    }
    expect(taken.size).toBe(40);
  });

  it("still finds a key for a name with no letters at all", () => {
    expect(suggestProjectKey("???", none)).toBe("PRJ2");
    expect(suggestProjectKey("???", new Set(["PRJ2"]))).toBe("PRJ3");
  });
});

describe("normalizeKey and isValidKey", () => {
  it("uppercases, drops everything but letters and digits, and stops at five", () => {
    expect(normalizeKey("rx-m")).toBe("RXM");
    expect(normalizeKey("abcdefgh")).toBe("ABCDE");
  });
  it("accepts 2 to 5 capitals or digits only", () => {
    for (const ok of ["RX", "RXM", "A1B2C"]) expect(isValidKey(ok), ok).toBe(true);
    for (const no of ["", "R", "ABCDEF", "rxm", "RX M", "RX-M"]) expect(isValidKey(no), no).toBe(false);
  });
});

describe("taskCode", () => {
  it("joins the key and the number", () => {
    expect(taskCode({ number: 4 }, { key: "RXM" })).toBe("RXM-4");
  });
  it("is null with no project, no key or no number", () => {
    expect(taskCode({ number: 4 }, undefined)).toBeNull();
    expect(taskCode({ number: 4 }, { key: "" })).toBeNull();
    expect(taskCode({ number: null }, { key: "RXM" })).toBeNull();
  });
});
