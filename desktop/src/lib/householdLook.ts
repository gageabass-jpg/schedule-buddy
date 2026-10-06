// What a household looks like to the screens that were written for one family:
// the real names in the G / K / D slots, who is actually there, and whether
// the bundled photos belong to it. Screens read it with useHouseholdLook();
// App provides it from the household and its state.

import { createContext, useContext } from "react";
import type { HouseholdMeta, HouseholdState } from "../state";

export interface HouseholdLook {
  names: { G: string; K: string; D: string };
  hasPartner: boolean;
  hasCaregiver: boolean;
  /** There are kids, so childcare coverage applies. */
  childcare: boolean;
  /** The bundled Gage / Kaylene / Daisy photos are this household's. */
  familyPhotos: boolean;
}

/** Outside a household: the one the screens were first built for. */
const ORIGINAL: HouseholdLook = {
  names: { G: "Gage", K: "Kaylene", D: "Daisy" },
  hasPartner: true, hasCaregiver: true, childcare: true, familyPhotos: true,
};

export function lookOf(household: HouseholdMeta | null, state: HouseholdState | null): HouseholdLook {
  if (!household) return ORIGINAL;
  // A new household whose schedule is still loading: nobody's name but yours,
  // never the original family's.
  if (!state) {
    return household.familyPhotos === false
      ? { names: { G: "You", K: "Partner", D: "Caregiver" }, hasPartner: false, hasCaregiver: false,
          childcare: household.childcare !== false, familyPhotos: false }
      : ORIGINAL;
  }
  const partner = state.partner?.name?.trim() ?? "";
  const caregiver = state.dependents?.daisy?.name?.trim() ?? "";
  return {
    names: { G: state.selfName?.trim() || "Me", K: partner || "Partner", D: caregiver || "Caregiver" },
    hasPartner: !!partner,
    hasCaregiver: !!state.dependents?.daisy,
    childcare: household.childcare !== false,
    familyPhotos: household.familyPhotos !== false,
  };
}

export const HouseholdLookContext = createContext<HouseholdLook>(ORIGINAL);

export const useHouseholdLook = (): HouseholdLook => useContext(HouseholdLookContext);
