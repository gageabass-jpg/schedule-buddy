import { describe, expect, it } from "vitest";
import {
  cleanHHMM, cleanNotes, cleanTitle, dateInWindow, decodeBase64Url, extractEmailText, headerOf, isDuplicateEvent,
  senderName, shortDate, sourceNote, stripHtml, titleCase, validIsoDate, type GmailPart,
} from "./emailEvents";

const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("decodeBase64Url", () => {
  it("reads Gmail's url-safe base64 as UTF-8, accents and all", () => {
    expect(decodeBase64Url(b64url("Cleaning at 2:30pm — Café Dr. Müller"))).toBe("Cleaning at 2:30pm — Café Dr. Müller");
  });

  it("gives an empty string for something that isn't base64", () => {
    expect(decodeBase64Url("!!!not base64!!!")).toBe("");
  });
});

describe("stripHtml", () => {
  it("keeps the words and the line breaks, drops tags, scripts and entities", () => {
    const html = "<style>p{color:red}</style><p>Your visit is <b>Tue&nbsp;Nov 10</b></p><div>Bring &amp; arrive early</div><script>x()</script>";
    expect(stripHtml(html)).toBe("Your visit is Tue Nov 10\nBring & arrive early");
  });
});

describe("headerOf", () => {
  it("finds a header whatever its case", () => {
    const part: GmailPart = { headers: [{ name: "SUBJECT", value: " Appointment reminder " }, { name: "From", value: "Dr Lee <lee@x.com>" }] };
    expect(headerOf(part, "Subject")).toBe("Appointment reminder");
    expect(headerOf(part, "from")).toBe("Dr Lee <lee@x.com>");
    expect(headerOf(part, "Date")).toBe("");
    expect(headerOf(undefined, "Date")).toBe("");
  });
});

describe("extractEmailText", () => {
  it("prefers the plain-text part of a multipart message", () => {
    const payload: GmailPart = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("Plain: see you Tuesday") } },
        { mimeType: "text/html", body: { data: b64url("<p>HTML: see you Tuesday</p>") } },
      ],
    };
    expect(extractEmailText(payload)).toBe("Plain: see you Tuesday");
  });

  it("falls back to the HTML part with its tags removed", () => {
    const payload: GmailPart = { mimeType: "multipart/alternative", parts: [{ mimeType: "text/html", body: { data: b64url("<p>Visit on <b>Nov 10</b></p>") } }] };
    expect(extractEmailText(payload)).toBe("Visit on Nov 10");
  });

  it("reads a single-part message and finds text nested in other parts", () => {
    expect(extractEmailText({ mimeType: "text/plain", body: { data: b64url("Just text") } })).toBe("Just text");
    const nested: GmailPart = { mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64url("Deep") } }] }] };
    expect(extractEmailText(nested)).toBe("Deep");
  });

  it("cuts a long message to the limit and handles none at all", () => {
    const long: GmailPart = { mimeType: "text/plain", body: { data: b64url("x".repeat(50)) } };
    expect(extractEmailText(long, 10)).toBe(`${"x".repeat(10)}…`);
    expect(extractEmailText(undefined)).toBe("");
  });
});

describe("what the model may propose", () => {
  it("accepts only real calendar dates", () => {
    expect(validIsoDate("2026-12-31")).toBe(true);
    expect(validIsoDate("2026-02-30")).toBe(false);
    expect(validIsoDate("12/31/2026")).toBe(false);
    expect(validIsoDate(20261231)).toBe(false);
  });

  it("keeps dates between yesterday and about 18 months out", () => {
    expect(dateInWindow("2026-11-06", "2026-11-07")).toBe(true);    // yesterday
    expect(dateInWindow("2026-11-05", "2026-11-07")).toBe(false);   // past
    expect(dateInWindow("2029-01-01", "2026-11-07")).toBe(false);   // far off
    expect(dateInWindow("2028-04-01", "2026-11-07")).toBe(true);    // 511 days: inside the ~18 months
    expect(dateInWindow("2027-11-07", "2026-11-07")).toBe(true);
  });

  it("accepts a 24-hour time and nothing else", () => {
    expect(cleanHHMM("14:30")).toBe("14:30");
    expect(cleanHHMM(" 09:05 ")).toBe("09:05");
    expect(cleanHHMM("2:30pm")).toBeUndefined();
    expect(cleanHHMM("24:00")).toBeUndefined();
    expect(cleanHHMM(1430)).toBeUndefined();
  });
});

describe("isDuplicateEvent", () => {
  const existing = [
    { date: "2026-11-10", title: "Dentist appointment - Dr. Lee", startTime: "14:30" },
    { date: "2026-11-12", title: "Parent-teacher conference" },
  ];

  it("recognises the same event worded differently", () => {
    expect(isDuplicateEvent(existing, { date: "2026-11-10", title: "Dentist" })).toBe(true);
    expect(isDuplicateEvent(existing, { date: "2026-11-10", title: "dentist appointment — dr lee" })).toBe(true);
  });

  it("recognises the same start time with mostly the same words", () => {
    expect(isDuplicateEvent(existing, { date: "2026-11-10", title: "Dr. Lee cleaning appointment", startTime: "14:30" })).toBe(true);
  });

  it("lets through a different day, or a different thing on the same day", () => {
    expect(isDuplicateEvent(existing, { date: "2026-11-11", title: "Dentist appointment" })).toBe(false);
    expect(isDuplicateEvent(existing, { date: "2026-11-10", title: "Soccer practice", startTime: "17:00" })).toBe(false);
    expect(isDuplicateEvent([], { date: "2026-11-10", title: "Anything" })).toBe(false);
  });

  it("doesn't match very short titles by containment", () => {
    expect(isDuplicateEvent([{ date: "2026-11-10", title: "Go" }], { date: "2026-11-10", title: "Google review meeting" })).toBe(false);
  });
});

describe("cleanTitle", () => {
  it("single-spaces a title and leaves a short one alone", () => {
    expect(cleanTitle("  Catthew's   vet appointment ")).toBe("Catthew's vet appointment");
  });

  it("cuts a long title at a word, with an ellipsis", () => {
    const t = cleanTitle("Catthew vet appointment with Dr. Laura Slack for a microchip at Rock Lake Veterinary Care");
    expect(t).toBe("Catthew vet appointment with Dr. Laura Slack for a…");
    expect(t.length).toBeLessThanOrEqual(60);
  });

  it("copes with nothing", () => {
    expect(cleanTitle(undefined)).toBe("");
  });
});

describe("titleCase", () => {
  it("capitalises the first letter of each word", () => {
    expect(titleCase("catthew's vet appointment")).toBe("Catthew's Vet Appointment");
    expect(titleCase("dentist - dr. lee")).toBe("Dentist - Dr. Lee");
  });

  it("starts a word after a hyphen, slash, bracket or quote, but not after an apostrophe", () => {
    expect(titleCase("parent-teacher conference")).toBe("Parent-Teacher Conference");
    expect(titleCase("pickup/dropoff (microchip) \"vet\"")).toBe("Pickup/Dropoff (Microchip) \"Vet\"");
    expect(titleCase("kaylene's")).toBe("Kaylene's");
  });

  it("leaves the rest of each word as written, so acronyms and numbers survive", () => {
    expect(titleCase("MRI at WVU medicine, 3pm")).toBe("MRI At WVU Medicine, 3pm");
  });

  it("handles accents and nothing at all", () => {
    expect(titleCase("école maternelle")).toBe("École Maternelle");
    expect(titleCase("")).toBe("");
  });
});

describe("cleanNotes", () => {
  it("keeps the model's lines, drops blanks, and stops at three", () => {
    expect(cleanNotes("Rock Lake Veterinary Care\n\n5330 Maccorkle Avenue SW\n  Dr. Slack  \nand a fourth")).toBe(
      "Rock Lake Veterinary Care\n5330 Maccorkle Avenue SW\nDr. Slack",
    );
  });

  it("trims a runaway line, and gives nothing for non-text", () => {
    const line = cleanNotes("x".repeat(300));
    expect(line.length).toBe(120);
    expect(line.endsWith("…")).toBe(true);
    expect(cleanNotes(undefined)).toBe("");
    expect(cleanNotes(42)).toBe("");
  });
});

describe("senderName", () => {
  it("uses the display name, without the address tucked after it", () => {
    expect(senderName("\"Samantha Church (management@rocklakevet.com)\" <no-reply@app.rocklakevet.com>")).toBe("Samantha Church");
    expect(senderName("Dr Lee <lee@x.com>")).toBe("Dr Lee");
  });

  it("falls back to the domain when there's no name", () => {
    expect(senderName("no-reply@app.rocklakevet.com")).toBe("app.rocklakevet.com");
    expect(senderName("\"lee@x.com\" <lee@x.com>")).toBe("x.com");
    expect(senderName("")).toBe("email");
  });
});

describe("shortDate", () => {
  it("dates an email in the household's own time zone", () => {
    expect(shortDate("Fri, 30 Oct 2026 20:09:18 +0000", "America/New_York")).toBe("Oct 30");
    expect(shortDate("Sat, 31 Oct 2026 01:30:00 +0000", "America/New_York")).toBe("Oct 30");   // still the 30th at home
    expect(shortDate("Sat, 31 Oct 2026 01:30:00 +0000")).toBe("Oct 31");
  });

  it("is empty for a date it can't read", () => {
    expect(shortDate("sometime last week")).toBe("");
  });
});

describe("sourceNote", () => {
  const from = "\"Samantha Church (management@rocklakevet.com)\" <no-reply@app.rocklakevet.com>";

  it("ends the model's lines with one short line saying where it came from", () => {
    expect(sourceNote(from, "Fri, 30 Oct 2026 20:09:18 +0000", "Rock Lake Veterinary Care\n5330 Maccorkle Avenue SW", "America/New_York"))
      .toBe("Rock Lake Veterinary Care\n5330 Maccorkle Avenue SW\nFrom email · Samantha Church · Oct 30");
  });

  it("is just that line when the model had no notes, and skips a date it can't read", () => {
    expect(sourceNote("Dr Lee <lee@x.com>", "Mon, 9 Nov 2026 13:00:00 +0000", undefined, "America/New_York")).toBe("From email · Dr Lee · Nov 9");
    expect(sourceNote("Dr Lee <lee@x.com>", "")).toBe("From email · Dr Lee");
  });
});
