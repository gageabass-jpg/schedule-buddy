import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "../firebase";
import type { HouseholdMeta, HouseholdState } from "../state";

export type HouseholdStatus =
  | { status: "loading" }
  | { status: "no-household" }
  | { status: "ready"; household: HouseholdMeta; state: HouseholdState | null };

/**
 * Resolves the user's household (via memberUids array contains query) and
 * subscribes to its state/main document. Mirrors the iOS app's
 * initFirestoreSync — see BRIDGE.md §5.
 */
export function useHousehold(user: User | null): HouseholdStatus {
  const [result, setResult] = useState<HouseholdStatus>({ status: "loading" });

  useEffect(() => {
    if (!user) {
      setResult({ status: "loading" });
      return;
    }

    let stateUnsub: Unsubscribe | null = null;

    const householdsRef = collection(db, "households");
    const q = query(householdsRef, where("memberUids", "array-contains", user.uid));

    const householdUnsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setResult({ status: "no-household" });
          return;
        }
        const doc0 = snap.docs[0];
        const data = doc0.data();
        const household: HouseholdMeta = {
          id: doc0.id,
          memberUids: data.memberUids ?? [],
          memberNames: data.memberNames ?? {},
          roles: data.roles ?? {},
          inviteCode: data.inviteCode ?? "",
          createdBy: data.createdBy ?? "",
        };

        // (Re)subscribe to state/main inside this household.
        if (stateUnsub) stateUnsub();
        const stateRef = doc(db, "households", doc0.id, "state", "main");
        stateUnsub = onSnapshot(
          stateRef,
          (stateSnap) => {
            const state = (stateSnap.exists() ? stateSnap.data() : null) as HouseholdState | null;
            setResult({ status: "ready", household, state });
          },
          (err) => {
            console.error("state/main subscription error:", err);
            setResult({ status: "ready", household, state: null });
          },
        );
      },
      (err) => {
        console.error("household subscription error:", err);
        setResult({ status: "no-household" });
      },
    );

    return () => {
      householdUnsub();
      if (stateUnsub) stateUnsub();
    };
  }, [user]);

  return result;
}
