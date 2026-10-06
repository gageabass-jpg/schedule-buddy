// Notification history for the bell: households/{hid}/notifications.
//
// Written server-side by recordNotification (functions/src/index.ts) whenever
// something notable happens, whether or not a push went out, so the list is
// complete even for changes made while this Mac was closed. Each doc says
// which roles it's for; each member marks their own read state in readBy.

import {
  collection, doc, limit, onSnapshot, orderBy, query, updateDoc, writeBatch,
  type Timestamp, type Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebase";

export type HouseholdRole = "admin" | "partner" | "supporting";

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  roles: HouseholdRole[];
  /** The day it's about, when it's about one (YYYY-MM-DD). */
  date?: string;
  requestId?: string;
  readBy: Record<string, boolean>;
  /** Null briefly while the server timestamp resolves. */
  createdAt: Timestamp | null;
}

/** How many of the newest notifications are loaded. */
export const NOTIFICATION_HISTORY = 100;

/** The household's newest notifications meant for `role`, live, newest first. */
export function subscribeNotifications(
  householdId: string,
  role: HouseholdRole,
  onChange: (items: AppNotification[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, "households", householdId, "notifications"),
    orderBy("createdAt", "desc"),
    limit(NOTIFICATION_HISTORY),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: AppNotification[] = [];
      snap.forEach((d) => {
        const data = d.data() as Omit<AppNotification, "id">;
        if (!Array.isArray(data.roles) || !data.roles.includes(role)) return;
        items.push({ ...data, id: d.id, readBy: data.readBy ?? {} });
      });
      onChange(items);
    },
    () => onChange([]),
  );
}

export async function markNotificationRead(householdId: string, id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, "households", householdId, "notifications", id), { [`readBy.${uid}`]: true });
}

export async function markAllNotificationsRead(householdId: string, ids: string[], uid: string): Promise<void> {
  // Firestore batches cap at 500 writes; the history is capped at 100.
  const batch = writeBatch(db);
  for (const id of ids) batch.update(doc(db, "households", householdId, "notifications", id), { [`readBy.${uid}`]: true });
  await batch.commit();
}
