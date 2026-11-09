import { describe, expect, it } from "vitest";
import { isVetEvent } from "./vetEvent";

describe("isVetEvent", () => {
  it("recognises vet visits by their title", () => {
    for (const title of ["Catthew's Vet Appointment", "Annual vet visit", "Vet", "Pet Vets Clinic", "Veterinary Checkup", "Veterinarian Follow-Up", "Take Catthew to the VET"]) {
      expect(isVetEvent({ title }), title).toBe(true);
    }
  });

  it("leaves other events alone, including words that only look like it", () => {
    for (const title of ["Veterans Day Parade", "Velvet Underground Concert", "Dentist Cleaning", "Evette's Birthday", "Investigation", ""]) {
      expect(isVetEvent({ title }), title).toBe(false);
    }
  });

  it("copes with a missing title", () => {
    expect(isVetEvent({})).toBe(false);
    expect(isVetEvent({ title: null })).toBe(false);
  });
});
