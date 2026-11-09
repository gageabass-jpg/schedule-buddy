// Which calendar events are vet appointments. The month grid marks them with a
// cat instead of counting them in a cell's "+N".

const VET = /\b(?:vets?|veterinar(?:y|ians?))\b/i;

/** A vet visit, going by its title ("Catthew's Vet Appointment", "Annual vet visit"). */
export function isVetEvent(ev: { title?: string | null }): boolean {
  return VET.test(ev.title ?? "");
}
