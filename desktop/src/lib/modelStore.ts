// The any-household model's data layer, bound to this app's Firestore
// (shared/store.ts, docs/data-model.md). Not used by any screen yet.

import {
  collection, doc, getDoc, getDocs, onSnapshot, query, where, writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { modularStore } from "../../../shared/store";

export const modelStore = modularStore(db, {
  doc, getDoc, collection, query, where, getDocs, writeBatch, onSnapshot,
});

export * from "../../../shared/store";
export * from "../../../shared/model";
export { resolveShifts, coverageGaps, caregiverDayRanges } from "../../../shared/resolve";
export type { PersonShift, PersonShiftMap, PersonShiftSource } from "../../../shared/resolve";
