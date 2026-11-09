/**
 * A place's name as short as it reads naturally, for the commute card's
 * "To …" line. Google names the workplace "WVU Medicine - Thomas Memorial
 * Hospital"; the card says "To Thomas Hospital".
 *
 *  - A health system's name in front of a dash is dropped ("WVU Medicine - ").
 *  - "Memorial" between a name and "Hospital" (or a medical centre) is dropped.
 *    A name that starts with it ("Memorial Hospital") is left alone.
 */
export function shortPlaceLabel(label: string): string {
  const parts = label.trim().split(/\s+[-–—]\s+/).filter(Boolean);
  const place = parts.length > 1 ? parts[parts.length - 1] : label.trim();
  return place.replace(/\s+Memorial(?=\s+(?:Hospital|Medical Center|Health)\b)/i, "");
}
