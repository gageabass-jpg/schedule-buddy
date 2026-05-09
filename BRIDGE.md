# Schedule Buddy — Bridge Spec

**Audience:** anyone (or any agent) building a separate client — desktop Mac app, second mobile app, web admin, etc. — that needs to read or write the same household data the iOS app uses.

This doc describes the contract: Firebase project, auth, Firestore collections, the state document schema, sync mechanics, and gotchas. If you respect what's in here, both clients will stay consistent and the iOS app will pick up your changes in real time via its existing `onSnapshot` listener.

---

## 1. Firebase project

```
projectId:         schedule-buddy-dd2cf
authDomain:        schedule-buddy-dd2cf.firebaseapp.com
storageBucket:     schedule-buddy-dd2cf.firebasestorage.app
messagingSenderId: 751719086344
appId (web):       1:751719086344:web:d831238f5039d29d17d4bd
apiKey:            AIzaSyDgRavOYvAYbw2nVmOUG_CT8Klifl24Xbk
```

The web `apiKey` is **not a secret** — Firebase keys are public identifiers; access is controlled by the Security Rules below, not by hiding the key. You can drop the same config into a desktop app.

For a Mac/Electron client: add a new web app inside the Firebase console (or reuse the existing web app id above). For a native macOS app: register a macOS app and download the `GoogleService-Info.plist` for the macOS bundle id.

**Existing iOS bundle id:** `com.gagebass.schedulebuddy` (don't reuse for the Mac app — pick e.g. `com.gagebass.schedulebuddy.mac`).

---

## 2. Authentication

Both clients must authenticate the same human to the same `auth.uid` so household membership matches.

- **Providers enabled:** Apple, Google, Email/password.
- **iOS app uses:** the `@capacitor-firebase/authentication` plugin with `skipNativeAuth: true`. The plugin runs the native Apple/Google sheet, returns a credential, and the JS Firebase SDK calls `signInWithCredential(credential)` to actually sign in. This means **the JS Firebase Auth state is what matters** (not native iOS Firebase Auth).
- **Desktop app:** use Firebase Auth's standard web SDK. `signInWithPopup` works in Electron and on macOS (unlike inside iOS WKWebView). Apple sign-in on Mac requires the Service ID + return URL to be configured in your Apple Developer account.

**uid is stable across providers** as long as the user signs in with the same provider. If they sign in with Google on Mac and Apple on iOS, those will be different uids and they'll appear as different people.

**Recommendation:** when Kaylene first signs in on the desktop tool (or admin signs in there), use the same provider she'll use on her phone. Document which provider you used per user in case you need to debug membership later.

---

## 3. Firestore data model

```
inviteCodes/{code}                         — flat lookup of code → householdId
households/{householdId}                    — household root doc
households/{householdId}/state/main         — the shared schedule state (the big one)
households/{householdId}/otApprovals/{id}   — overtime decisions
households/{householdId}/feedback/{id}      — (legacy: chat messages — feature removed in iOS app, but rules still allow it)
```

### 3.1 `households/{householdId}` — root doc

```js
{
  memberUids:  [string],                    // Firestore Security Rules use this for access control
  memberNames: { [uid]: string },           // display names by uid (cached for UI)
  roles:       { [uid]: "admin" | "partner" },
  inviteCode:  string,                      // 6 chars, A-Z 2-9 (no confusing chars)
  createdBy:   string,                      // uid of the original admin
  createdAt:   Timestamp,                   // serverTimestamp()
}
```

**Important for the desktop app**: when adding a member, `arrayUnion` into `memberUids` AND set the corresponding `memberNames.<uid>` and `roles.<uid>` entries. If `memberUids` ever drifts from the rest, the rules will lock the user out of their own household.

Roles:
- `"admin"` — original creator. Can edit shift types, weekly template, alt weekends, blackouts.
- `"partner"` — joined via invite code. Currently has same write access in the rules, but the app applies UI-level restrictions via `applyRoleRestrictions()`.

### 3.2 `households/{householdId}/state/main` — the shared state document

This is the heart of the system. Both clients read/write the **whole document** (no field-level atomic writes). The iOS app uses `set()` (full overwrite) on every save with a 300ms debounce.

The live JS shape (also see `defaultState()` in `public/index.html`):

```js
{
  // ---- Shift type catalog (admin defines these) ----
  shiftTypes: [
    {
      id: "st_day12",                       // stable string id; preserve when editing
      name: "Day (12hr) 7a-730p",
      start: "07:00",                       // "HH:MM" 24h
      end:   "19:30",
      crossesMidnight: false,
    },
    // ...
  ],

  // ---- Self's recurring weekly template ----
  template: [null|shiftTypeId, ...7],       // index 0 = Sun ... index 6 = Sat
                                            // null means "off"

  // ---- Alternating weekend pattern ----
  alt: {
    enabled: true,
    refSat:  "YYYY-MM-DD",                  // a Saturday self IS scheduled to work
                                            // (every other Sat from this date)
    sat:     shiftTypeId | null,            // shift on the working Saturday
    sun:     shiftTypeId | null,            // shift on the working Sunday
  },

  // ---- Self's accepted overtime shifts (committed) ----
  ot: [
    {
      date:        "YYYY-MM-DD",
      shiftTypeId: string,
      label:       string,                  // free text, e.g. "with K"
      // (occasionally) coworkers: string
    },
    // ...
  ],

  // ---- Available OT (offered, awaiting partner approval) ----
  // Joined to otApprovals subcollection by index — see §3.3
  otOpportunities: [
    {
      date:        "YYYY-MM-DD",
      shiftTypeId: string,
      coworkers:   string,
    },
    // ...
  ],

  // ---- One-off changes that override the recurring template ----
  overrides: [
    {
      date:        "YYYY-MM-DD",
      shiftTypeId: string | null,           // null = "this day is off"
      label:       string,
    },
    // ...
  ],

  // ---- Active visible / exportable date range ----
  range: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" },

  calName:   "Work schedule",
  calView:   "schedule" | "fatigue" | "childcare" | "couple",  // visualization mode

  // ---- Self / partner identity ----
  selfName: "Gage",
  partner: {
    name: "Kaylene",
    shifts: [                               // partner is a manual list of dated shifts
      { date: "YYYY-MM-DD", shiftTypeId: string, label: string },
      // ...
    ],
  },

  // ---- Times caregiver is unavailable (recurring weekly windows) ----
  caregiverBlackouts: [
    { dow: 0..6, start: "HH:MM", end: "HH:MM" },
    // ...
  ],

  // ---- Calendar UI prefs (mobile + desktop view layout) ----
  ui: {
    calLayout:     "month" | "week" | "agenda",
    viewMonth:     "YYYY-MM-DD",            // first day of visible month
    viewWeekStart: "YYYY-MM-DD",            // Sunday of visible week
  },

  // ---- Migration audit trail ----
  _migrations: [string],                    // list of applied migration ids
}
```

**Default values** are produced by `defaultState()` and `builtInShiftTypes()` in `public/index.html`. The default `shiftTypes` includes 6 builtins (`day12`, `day8`, `evening`, `night12`, `night8`, `morning4`) — each has a stable id like `st_day12`. Admins may add custom types alongside.

### 3.3 `households/{householdId}/otApprovals/{otop_<index>}`

One doc per OT opportunity (at index `<index>` in `state.main.otOpportunities`). Doc id pattern is literally `otop_0`, `otop_1`, etc.

```js
{
  status:        "pending" | "approved" | "denied",
  comment:       string,                    // optional
  decidedBy:     string,                    // uid
  decidedByName: string,
  decidedAt:     Timestamp,
}
```

### 3.4 `households/{householdId}/feedback/{msgId}` — (legacy)

The household chat feature was removed from the iOS app, but the collection and security rules still exist. The desktop app should **ignore** this collection unless you choose to revive chat.

### 3.5 `inviteCodes/{code}`

Flat lookup so a partner can join by code without scanning the whole `households` collection.

```js
{ householdId: string }
```

Only `read` and `create` are allowed. No update / delete in the rules — once a code is created, it lives forever (even after partners join).

---

## 4. Security rules — abridged

(See `firestore.rules` for source of truth.)

- **Household root doc:** any signed-in user can `read` / `update` / `delete` only if their uid is in `memberUids`. `create` requires their uid in the new doc's `memberUids`. `update` also allows joining (someone adding their own uid for the first time).
- **`state/{any}`, `otApprovals/{any}`, `feedback/{any}`:** read+write iff the caller's uid is in the parent household's `memberUids` (verified via a `get()` lookup at rule eval time — slightly more expensive but secure).
- **`inviteCodes/{code}`:** any authenticated user can `read` and `create`. Cannot modify or delete.

**Implication for the desktop app:** as long as your authenticated user is a member of the household, you can read and write everything that matters. There is no separate "admin write, partner read-only" enforcement at the rules layer — that's a UI convention. If you want to enforce admin-only writes server-side, tighten the rules first (let me know if you want this and I'll author the change).

---

## 5. Sync mechanics & gotchas

### 5.1 Whole-document writes
The iOS app does `ref.set(JSON.parse(JSON.stringify(state)))` — a full overwrite of `state/main`. **Don't try to do field-level atomic merges from the desktop app or you risk dropping fields.** Read-modify-write the whole document.

```js
// Pseudocode for safe concurrent writes from the desktop app:
const ref = db.collection("households").doc(householdId).collection("state").doc("main");
const snap = await ref.get();
const next = mutate(snap.data());     // your edit
await ref.set(next);                   // full overwrite
```

If two clients write near-simultaneously, last-write-wins. There's no Firestore transaction or locking. This is fine in practice because:
- The iOS app debounces writes by 300ms after every edit.
- Only one human is doing meaningful edits at a time on the desktop tool (you).
- Read-time deltas are tiny so the chance of conflict is low.

If conflicts ever bite, switch to a Firestore transaction (`db.runTransaction`) on the desktop side and the iOS side will still work fine — its own writes don't need to coordinate with desktop reads.

### 5.2 The iOS allowlist
On read, the iOS app passes Firestore data through `mergeStateFromFirestore(data)` which is a **strict allowlist**. Fields not in the allowlist are dropped. The current allowlist is:

```
shiftTypes, template, alt, ot, otOpportunities, overrides,
range, calName, calView, activeTab, selfName, partner,
caregiverBlackouts, ui, _migrations
```

**If the desktop app introduces new fields**, the iOS app will silently strip them. To keep something in the document round-tripping, either:
- Add the field to `mergeStateFromFirestore` in `public/index.html` (preferred — makes the iOS app aware of the new field), OR
- Store it in a separate Firestore subcollection so it doesn't pass through this filter.

### 5.3 The migrations system
On every load, `applyMigrations(state)` runs over an in-order list of named migrations (each with an `id`). Migrations marked as applied are stored in `state._migrations`. If you change the schema in a backward-incompatible way:
1. Add a new migration in `public/index.html` (`MIGRATIONS` array).
2. Push it from the desktop app side too if you're materially editing schema there.
3. Old data will be rewritten on first read.

### 5.4 Avoiding feedback loops
The iOS app uses a `_remoteUpdate` flag to suppress its own write trigger when the snapshot listener fires from a remote change. The desktop app does **not** need to do this if it's using the same SDK pattern — Firestore's own listener won't loop on its own writes by default. The flag exists only because `saveState()` is called eagerly on every UI tick.

### 5.5 Time zone
All dates are stored as **plain `YYYY-MM-DD` strings** in the user's local time zone (no UTC, no offset). Times are `HH:MM` 24-hour, no zone. The `crossesMidnight` flag on a shift type means the `end` time is on the *next* day.

iCalendar export (.ics) uses `LOCAL_TZ` from the iOS app — currently `America/Chicago`. If your desktop app needs to export, copy that constant or read the user's system tz.

---

## 6. Onboarding flow (so the desktop app fits in)

If you're starting fresh on a new household:

1. Sign in with the same auth provider you'll use on the phone.
2. From the desktop app, create the household:
   ```js
   const code = generateInviteCode();           // 6 chars, A-Z2-9
   const docRef = await db.collection("households").add({
     memberUids: [auth.currentUser.uid],
     memberNames: { [auth.currentUser.uid]: auth.currentUser.displayName || "Admin" },
     roles: { [auth.currentUser.uid]: "admin" },
     inviteCode: code,
     createdBy: auth.currentUser.uid,
     createdAt: firebase.firestore.FieldValue.serverTimestamp(),
   });
   await db.collection("inviteCodes").doc(code).set({ householdId: docRef.id });
   ```
3. Initialize `state/main` with `defaultState()`'s shape (or import existing data).
4. Share the code with Kaylene; she enters it on her phone in the Join Household screen.

If the household already exists (your case): just sign in on the desktop app with the same uid that's already a member. You'll have full read/write access immediately.

---

## 7. Recommended split of responsibilities (your plan)

> "Mac desktop app pushes edits; iOS app stays read-only."

To honor that split cleanly:

**On the Mac side (write surfaces):**
- Shift type CRUD
- Weekly template editor
- Alt-weekends config
- Caregiver blackouts
- One-off overrides (`overrides`)
- Partner's dated shifts (`partner.shifts`)
- OT decisions (`ot`, `otOpportunities`, `otApprovals`)
- Date range (`range`) and calendar name (`calName`)

**On the iOS side (read-only after split):**
- Calendar (Month/Week/Agenda) views
- Today ribbon
- Stats (analysis) screen
- Notifications / OT approval prompts
- Sign-in / household join

When you're ready, ask me to add a "read-only mode" toggle to the iOS app — it's a small change: hide the settings drawer's edit pages, the partner drawer's edit form, the analysis tab bar's edit buttons. The data and security model don't have to change at all; it's purely a UI shrink.

---

## 8. Quick-reference constants

```js
// Default shift type ids (preserve when editing — referenced by template/overrides/etc.)
const SHIFT_IDS = {
  day12:    "st_day12",
  day8:     "st_day8",
  evening:  "st_evening",
  night12:  "st_night12",
  night8:   "st_night8",
  morning4: "st_morning4",
};

// Day-of-week index: 0 = Sun ... 6 = Sat (matches JS Date.getDay())

// Invite code alphabet (avoids 0/O, 1/I confusion):
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
```

---

## 9. Where the source of truth lives

| Concern                          | File                                                |
|----------------------------------|-----------------------------------------------------|
| Web app + state schema + sync    | `public/index.html` (`firebaseConfig`, `defaultState`, `mergeStateFromFirestore`, `saveStateToFirestore`, `initFirestoreSync`, `MIGRATIONS`) |
| Security rules                   | `firestore.rules`                                   |
| Firebase project config          | `firebase.json`, `.firebaserc`                      |
| Capacitor (iOS) wiring           | `capacitor.config.json`, `ios/`                     |
| Native auth plugin               | `@capacitor-firebase/authentication` (npm)          |
| User photos (avatar fallbacks)   | `public/assets/gage.jpg`, `public/assets/kaylene.jpeg` |

---

## 10. Open questions / future considerations

- **Conflict-free editing:** if both clients are writing to `state/main` concurrently, last-write-wins. Promote to transactions if it ever causes problems.
- **Audit trail:** no edit history is kept. If you want one, add `households/{id}/edits/{id}` write-once docs from the desktop app.
- **Photo upload:** today the avatars are static files baked into the iOS bundle. If the desktop app should let admins set avatars at runtime, store them in Firebase Storage at `households/{id}/avatars/{uid}.jpg` and add `photoURL` to `memberNames` (or replace `memberNames` with a richer member object).
- **Push notifications from desktop edits:** the iOS app subscribes via `onSnapshot`, so changes appear instantly when the app is foregrounded. For background push, you'd add a Cloud Function that watches `state/main` writes and sends an FCM push. Out of scope for now.

---

*Last updated: 2026-05-09 — covers the codebase as committed in `1767cb4 Initial commit: Schedule Buddy facelift`.*
