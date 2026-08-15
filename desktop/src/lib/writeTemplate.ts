import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { HouseholdState, PersonWeeklyTemplate } from "../state";

export class WriteTemplateError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "WriteTemplateError";
  }
}

export type TemplatePerson = "G" | "K" | "daisy";
export type WeeklyTemplates = NonNullable<HouseholdState["weeklyTemplates"]>;

/**
 * Save every person's redesigned weekly template into `weeklyTemplates` in a
 * single document write (no races between people). People with no template are
 * omitted. Whole-document overwrite per BRIDGE.md §5.1; `weeklyTemplates` is a
 * single nested top-level object, so the iOS allowlist needs only the one key.
 *
 * For Gage this supersedes the legacy `template` / `templateEndDate`, which are
 * left in place (ignored once `weeklyTemplates.G` exists).
 */
export async function saveWeeklyTemplates(
  householdId: string,
  templates: WeeklyTemplates,
): Promise<void> {
  for (const p of ["G", "K", "daisy"] as const) {
    const tmpl = templates[p];
    if (tmpl && tmpl.days.length !== 7) {
      throw new WriteTemplateError("Each template must have exactly 7 entries (Sun..Sat).");
    }
  }
  const ref = doc(db, "households", householdId, "state", "main");
  let current: HouseholdState | null;
  try {
    const snap = await getDoc(ref);
    current = snap.exists() ? (snap.data() as HouseholdState) : null;
  } catch (e) {
    throw new WriteTemplateError("Couldn't read the household schedule.", e);
  }
  if (!current) {
    throw new WriteTemplateError("Schedule document doesn't exist yet — open the iOS app once to initialize it.");
  }

  // Keep only non-empty entries with tidy optional dates.
  const wt: WeeklyTemplates = {};
  for (const p of ["G", "K", "daisy"] as const) {
    const tmpl = templates[p];
    if (!tmpl) continue;
    const clean: PersonWeeklyTemplate = { days: tmpl.days };
    if (tmpl.startDate) clean.startDate = tmpl.startDate;
    if (tmpl.endDate) clean.endDate = tmpl.endDate;
    wt[p] = clean;
  }

  const next: HouseholdState = { ...current };
  if (Object.keys(wt).length > 0) next.weeklyTemplates = wt;
  else delete next.weeklyTemplates;

  try {
    await setDoc(ref, next);
  } catch (e) {
    throw new WriteTemplateError("Couldn't save the template. Check your connection and try again.", e);
  }
}
