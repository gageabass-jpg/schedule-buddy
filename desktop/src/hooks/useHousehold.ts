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
import { isMigrated } from "../lib/householdState";
import { modelStore } from "../lib/modelStore";
import { watchHousehold } from "../../../shared/store";
import { toLegacy } from "../../../shared/toLegacy";

export type HouseholdStatus =
  | { status: "loading" }
  | { status: "no-household" }
  | { status: "ready"; household: HouseholdMeta; state: HouseholdState | null };

/**
 * Resolves the user's household (via memberUids array contains query) and
 * subscribes to its state/main document. Mirrors the iOS app's
 * initFirestoreSync — see BRIDGE.md §5.
 *
 * A household already on the any-household model (schemaVersion ≥ 2) has no
 * state/main: its records are watched instead and handed to the screens in
 * the same legacy shape (toLegacy), until each screen reads the model itself
 * (docs/data-model.md, step 3).
 *
 * `refreshNonce` is a manual-refresh trigger: bumping it re-runs the effect,
 * which tears down the live listeners and re-subscribes, forcing a fresh read
 * from the server. Used by the sidebar's refresh button.
 */
export function useHousehold(user: User | null, refreshNonce = 0): HouseholdStatus {
  const [result, setResult] = useState<HouseholdStatus>({ status: "loading" });

  useEffect(() => {
    if (!user) {
      setResult({ status: "loading" });
      return;
    }

    let stateUnsub: Unsubscribe | null = null;
    let watching = ""; // "<householdId>:<legacy|model>" currently subscribed
    let latestHousehold: HouseholdMeta | null = null;
    let modelState: HouseholdState | null | undefined; // undefined = not loaded yet
    let retry: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let generation = 0; // the current watchModel attempt; older ones are ignored

    // Watch a migrated household's records. A brand-new household is seen
    // here the moment its record is saved on this Mac, before the server has
    // it, so the first subscriptions can be refused; try again shortly rather
    // than showing no schedule until a refresh.
    const watchModel = (id: string, attempt = 0) => {
      const gen = ++generation;
      stateUnsub = watchHousehold(
        modelStore,
        id,
        (model) => {
          if (gen !== generation) return;
          modelState = model ? toLegacy(model).state : null;
          if (latestHousehold) setResult({ status: "ready", household: latestHousehold, state: modelState });
        },
        (err) => {
          // Several listeners can fail together; act once per attempt.
          if (gen !== generation) return;
          generation++;
          if (stateUnsub) { stateUnsub(); stateUnsub = null; }
          if (!cancelled && attempt < 5) {
            retry = setTimeout(() => { if (!cancelled && watching === `${id}:model`) watchModel(id, attempt + 1); }, 800 * (attempt + 1));
            return;
          }
          console.error("household model subscription error:", err);
          if (latestHousehold) setResult({ status: "ready", household: latestHousehold, state: null });
        },
      );
    };

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
          ...(data.wvuFootball === false ? { wvuFootball: false } : {}),
          ...(data.familyPhotos === false ? { familyPhotos: false } : {}),
          ...(data.childcare === false ? { childcare: false } : {}),
        };

        latestHousehold = household;
        if (isMigrated(data)) {
          // The model's own listeners follow every record; resubscribe only
          // when the household or its storage changes. Membership changes
          // still reach the screens, with the state already loaded.
          const key = `${doc0.id}:model`;
          if (watching === key) {
            if (modelState !== undefined) setResult({ status: "ready", household, state: modelState });
            return;
          }
          if (stateUnsub) stateUnsub();
          if (retry) { clearTimeout(retry); retry = null; }
          watching = key;
          modelState = undefined;
          watchModel(doc0.id);
          return;
        }

        // (Re)subscribe to state/main inside this household.
        if (stateUnsub) stateUnsub();
        watching = `${doc0.id}:legacy`;
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
      cancelled = true;
      if (retry) clearTimeout(retry);
      householdUnsub();
      if (stateUnsub) stateUnsub();
    };
  }, [user, refreshNonce]);

  return result;
}
