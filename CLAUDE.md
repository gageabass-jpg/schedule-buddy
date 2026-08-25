# Schedule Buddy — Agent Handoff

> Concise operator notes for anyone (human or AI) picking up mid-project.
> For the Firebase/Firestore contract, read **[BRIDGE.md](BRIDGE.md)** first — it's authoritative.

## What this repo is

A household shift-schedule + childcare-coverage + overtime-management app for **Gage** (admin) and **Kaylene** (partner). Three surfaces share one Firestore backend:

| Surface | Path | Deploy |
|---|---|---|
| Web PWA | `public/index.html` (single-file ~4k+ lines) | `firebase deploy --only hosting` |
| iOS app (TestFlight) | Capacitor wrapper in `ios/` — loads live URL via `capacitor.config.json` `server.url` | Web deploy hits iOS instantly. Only archive again for native/plugin/entitlement changes. |
| Mac desktop app | Electron/Vite in `desktop/` — installed to `/Applications` | Rebuild + `ditto` to ship (see [`desktop/README`] or ask user) |

Cloud Functions live in `functions/` (askClaude, **parseSchedule**, cleanSchedule, nowPlaying, piCommand, wallState, plus push triggers).

## Recent additions (this session)

- **Day view** in the calendar layout picker (Month / Week / **Day** / Agenda) — single-date hour rail (6a–12a) with shifts, overnight tails, coverage, events, now-line. `renderDayView()` + `state.ui.viewDayDate`.
- **Swipe navigation** — swipe left/right on Month/Week/Day changes the period (`initCalendarSwipeNav`, `shiftViewWeek/Month/Day`). Agenda excluded.
- **Agenda life-event pills** — life events render as themed pills (person color + avatar + leaf) on the right of each agenda row; tap → bottom sheet (`openEventSheet` / `#eventSheet`), swipe-down or tap-above to dismiss.
- **Brand wordmark** never stacks on mobile (`clamp()` sizing + `white-space:nowrap`).
- **Import schedule from photo** — static "+" FAB above the Claude square (`#parseFab`, Schedule-tab only) → `#parseModal`. Picks a photo, calls the **`parseSchedule`** vision Cloud Function, shows a preview (per-row shift-type dropdown auto-mapped by hours; **unmatched hours auto-create a "＋ New" shift type** materialized on confirm). Function returns parsed shifts only — client writes via `saveState()`.
  - **Gage** imports add directly (overrides).
  - **Kaylene / Daisy** imports land as **pending** (`pending:true` + `importId` on partner.shifts / dependents.daisy.shifts) and render **yellow "(pending)"** across month/week/day/agenda. A record (photo + days) goes to `state.imports`.
  - **Approve / Reject** live in **Profile → Manager** section (`renderManagerRequests`): shows the original photo + parsed days. Approve clears the pending flags → confirmed; Reject removes the pending entries + any unreferenced auto-created shift types. `state.imports` (allowlisted top-level array) holds the pending records incl. a downscaled photo dataURL.
  - Verified end-to-end in the simulator (Gage direct + Kaylene pending + Manager approve/reject).
  - NOTE: one stray shift type ("6:45PM-7:15AM") from an early test may linger in Settings → Shift Types; safe to delete.

## Firebase

- **Project ID:** `schedule-buddy-dd2cf`
- **Console:** https://console.firebase.google.com/project/schedule-buddy-dd2cf
- **Live URL:** https://schedule-buddy-dd2cf.web.app
- Auth providers: Apple, Google, Email/Password. iOS uses `@capacitor-firebase/authentication` with `skipNativeAuth: true` (native sheets → `signInWithCredential`).
- Security rules: `firestore.rules` (households, state/main, otApprovals, feedback, inviteCodes) and `storage.rules`

## Repo layout

```
schedule-buddy/
├── public/
│   ├── index.html          ← THE WEB + iOS APP (single-file)
│   ├── assets/wvu.png      ← WVU Flying WV overlay
│   ├── wvu-football.json   ← Static schedule baked from wvusports.com RSS
│   ├── manifest.json, sw.js, icons/
├── desktop/                ← Mac Electron app (React/Vite)
│   ├── src/                 ← DayView, WeekView, MonthGrid, Inspector, App.tsx
│   └── public/              ← Shares WVU assets/schedule with web
├── ios/                    ← Capacitor Xcode project
├── functions/              ← Cloud Functions (TypeScript)
│   └── src/{index,askClaude,cleanSchedule,nowPlaying,piCommand,wallState}.ts
├── k-schedule/, scripts/, docs/
├── firebase.json, firestore.rules, storage.rules, .firebaserc
├── capacitor.config.json   ← server.url → live Firebase URL (KEY DETAIL)
├── BRIDGE.md               ← Firebase contract (READ FIRST)
└── CLAUDE.md               ← this file
```

## Deploy commands

### Web (also updates iOS app on next launch)
```bash
firebase deploy --only hosting
```

### Firestore rules only
```bash
firebase deploy --only firestore:rules
```

### Cloud Functions
```bash
firebase deploy --only functions
# or a single function:
firebase deploy --only functions:askClaude
```

### iOS TestFlight rebuild (only for native/plugin/entitlement/config changes)
```bash
npx cap sync ios
npx cap open ios
# Xcode: bump Build number → Any iOS Device (arm64) → Product → Archive
# → Organizer → Distribute App → TestFlight & App Store → Upload
```

### Mac desktop rebuild
User handles this — they run the installed `/Applications` build, not the dev server. Ask before rebuilding.

## Key gotchas (from user memory)

- **iOS is fed by `firebase deploy --only hosting`** — the Capacitor app loads live URL. Do not assume you need to re-archive for JS/CSS/HTML changes.
- **New top-level `state.main` fields must be added to iOS's allowlist** or they're dropped (contract-check blocks deploy). Nested fields are safe. `public/index.html` IS the iOS app.
- **Web sign-in bounces** — known bug. iOS sign-in works fine.
- **Weekly template is PAUSED going forward** — `TEMPLATE_PAUSED` flag in state; new schedules use dated entries only.
- **WVU football icon** — transparent Flying WV on game days. Data is static in `public/wvu-football.json` (baked from wvusports.com RSS, NOT live). To refresh: paste new RSS, redeploy hosting + rebuild Mac.
- **Wall keypad** — physical 3-key pad on wall display: F7 cycle scenes, F8 refresh, F9 (OS-level) YouTube Music.
- **Improvements log** — SB Manager light-bulb logs ideas to `userData/improvements.json`; read when asked to "update the app".
- **Day detail sheet** — iOS/web day card is a redesigned bottom sheet; opens on `touchend` (iOS `:hover` causes double-tap). Don't revert to click-only.
- **Calendar people** — Daisy is a first-class person alongside Gage/Kaylene with her own cells and school-schedule coverage timeline.
- **Billing** — if wall shows "Network error" + all functions 503, project fell off Blaze to Spark; fix is re-upgrade to Blaze (user-only). Hosting stays up.

## Where the current session picked up

The user's uncommitted changes are:
```
modified:  public/index.html
modified:  desktop/{App.tsx, package.json, components/{DayView,WeekView,MonthGrid,Inspector}.tsx}
untracked: public/assets/wvu.png, public/wvu-football.json
           desktop/public/assets/wvu.png, desktop/public/wvu-football.json
           desktop/src/hooks/useWvuGames.ts, desktop/src/lib/wvuSchedule.ts
```

The user asked to "bake the new changes into iOS." Since `capacitor.config.json` uses `server.url`, the answer is:

```bash
firebase deploy --only hosting
```

That's it. iOS pulls from live URL on next app open. No Capacitor sync, no Xcode archive, no TestFlight upload. For desktop, they rebuild separately (their workflow).

## Older session context (Apr–Aug 2026)

We built the app from scratch in an earlier session:
1. Started as macOS drag-drop `.ics` generator (Python + AppleScript droplet — see sibling `schedule2ics.py`)
2. Pivoted to standalone HTML with `localStorage`
3. Grew into full household dashboard (calendar views, tooltips, analysis, tabs)
4. Migrated to Firebase (Auth + Firestore real-time sync + PWA)
5. Wrapped in Capacitor → TestFlight
6. Added Apple + Google sign-in (native via `@capacitor-firebase/authentication`)
7. Added Cloud Functions, desktop Mac app, WVU game-day icon, wall display, etc.

The single-file HTML pattern is deliberate — one file is what iOS + web both render. The desktop app is a separate React/Vite build that shares Firestore state via the same rules.
