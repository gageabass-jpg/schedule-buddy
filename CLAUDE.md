# Nucleus — Agent Handoff

> Concise operator notes for anyone (human or AI) picking up mid-project.
> For the Firebase/Firestore contract, read **[BRIDGE.md](BRIDGE.md)** first — it's authoritative.

## What this repo is

**Nucleus** (formerly Schedule Buddy) is a household shift-schedule + childcare-coverage app for **Gage** (admin) and **Kaylene** (partner). The Firebase project id, hosting URL, GitHub repo, iOS bundle id, and app group keep the `schedule-buddy` name on purpose — renaming those would create a new app. Three surfaces share one Firestore backend:

| Surface | Path | Deploy |
|---|---|---|
| Web PWA | `public/index.html` (single-file ~4k+ lines) | `firebase deploy --only hosting` |
| iOS app (TestFlight) | Capacitor wrapper in `ios/` — loads live URL via `capacitor.config.json` `server.url` | Web deploy hits iOS instantly. Only archive again for native/plugin/entitlement changes. |
| Mac desktop app (**Nucleus Manager**) | Electron/Vite in `desktop/` — installed to `/Applications` | Rebuild + `ditto` to ship (see [`desktop/README`] or ask user) |

Cloud Functions live in `functions/` (askClaude, **parseSchedule**, cleanSchedule, nowPlaying, piCommand, wallState, plus push triggers).

## Brand (Nucleus)

Source of truth: the Nucleus brand board (Claude Design export). What is applied in code:

| Token | Value | Role |
|---|---|---|
| Teal | `#0F6E64` | The brand. Mark, primary buttons, links. White text passes at 6.1:1. |
| Teal Deep | `#0A4F48` | Pressed / hover. |
| Teal Light | `#56B7A9` | Mark + accent text on the **dark** ground only (7.0:1 on Ink). Never on Paper. |
| Teal Tint | `#D8E7E4` | Fill behind a scheduled shift. |
| Clay / Clay Light / Clay Tint | `#8A4B38` / `#D78F77` / `#EFDFDB` | Open shift, conflict, unfilled. Not yet wired into the calendar. |
| Paper / Surface / Line | `#F7F6F3` / `#FFFFFF` / `#E2E0DA` | Light ground, cards, rules. |
| Ink / Ink Muted | `#14201E` / `#5A6663` | Text, dark ground. |

- **Wordmark:** `nucleus` — always lowercase, Sora 600, `letter-spacing: -0.02em`. Desktop: `nucleus` 600 + ` manager` 400 muted. Never re-set in another face, never stretched.
- **Mark:** the block-knot path (`M40 25 … Z` in a 100×100 box, stroke 9, round caps/joins). Stroke thickens as it shrinks: 9 @ 48px+, 10 @ 32, 11 @ 24, 13 @ 16. Lives inline in `public/index.html` (splash, auth, header), `desktop/src/components/BrandMark.tsx`, and the SVG/PNG icons.
- **Icons:** `public/icons/icon.svg` (web tile, radius 22%), `icon-desktop.svg` (macOS tile inset 100px, radius 22.5%). PNGs (`icon-192/512`, `icon-desktop-1024`, iOS `AppIcon-512@2x.png`, iOS `Splash.imageset`, `desktop/build/icon.png`) were rasterized from the same geometry with headless Chromium — mark at 55% of the tile, one flat Teal, no gradient/shadow.
- **Mac app icon (Liquid Glass):** the source is the Icon Composer document `desktop/build/NM Glass icon.icon` (layer `Assets/icon.svg` is the mark alone; background Teal; dark look uses Teal Light). `desktop/scripts/afterPackIcon.cjs` (electron-builder `afterPack`) compiles it with Xcode's `actool` into the app's `Assets.car` and sets `CFBundleIconName`, which is what macOS 26+ needs to avoid the grey "icon plate"; it needs Xcode. The Dock icon while the app runs comes from `desktop/build/icon.png` / `icon-dark.png` (`electron/main.ts`): after editing the `.icon`, re-render them — light from the installed app's `NSWorkspace` icon, dark with `Icon Composer.app/Contents/Executables/ictool … --rendition Dark --width 824 --height 824`, padded onto a transparent 1024 canvas with a 100 px inset.
- **Glass look (Mac/Windows desktop app):** `desktop/src/index.css` "Glass" section. A coloured ambient backdrop (`--glass-ambient`, on the app root) sits behind three inset, rounded `.glass-panel`s (sidebar, calendar, right rail); cards on them are `.glass-card` or use `var(--glass-fill-soft)`; day cells and shift chips use `--glass-cell` / `--glass-chip`. Modals are matched by their `nucleus-modal-` animation name (every modal spreads `mm.panel`), anchored popovers by `.glass-pop` on their card, tooltips and shadcn popovers by `.glass-tip`. Gotcha: `backdrop-filter` blurs nothing if an ancestor is a "backdrop root", and an element with a *finished animation that still fills forwards* is one, so the entrance animations in `lib/modalMotion.tsx` fill `backwards` only. `prefers-reduced-transparency` swaps every fill for a solid and drops the blur. Fills stay dense enough that text contrast never depends on the blur.
- **Frosted Mac window:** `electron/main.ts` opens the window with `vibrancy: "under-window"` and a clear background on macOS; `src/main.tsx` adds `html.vibrant` (Mac in Electron only), which makes the page background transparent and thins `--glass-ambient` to a wash in `index.css`, so the desktop's blur shows through the gutters and panels. The renderer sends its Light/Dark/System choice with `appearance:set` and main sets `nativeTheme.themeSource` from it, so the material matches the app rather than the OS. `CSS backdrop-filter` can't see the native material, only page pixels. Windows has no equivalent yet (`backgroundMaterial: "mica"` would be the route).
- **Admin Console layout (Mac):** `FamilyConsole.tsx` + `ConsoleNav.tsx`. The left column (`ConsoleNav`, after a 21st.dev sidebar-nav pattern; no switcher/search/collapse) is grouped Household (General, People + member-count pill) / Display (Wall display, which opens to Display · Photos · Occasions, lifted from the old sub-tab bar so `wallSub` lives in FamilyConsole) / Connections (Integrations), then Sign out and Leave household (moved out of General's footer, which now only shows the version), then the Appearance switch, caption and Piper Locke button. General = Household (plain, name locks once saved) + a `ui/accordion.tsx` (ddoemonn's 21st.dev Accordion, re-skinned to the shadcn tokens, hairlines, `glass-card`) with **Commute** and **Sharing** (invite code, caregiver invite, web/ICS link). Integrations = AI provider key (its "Where do I get an API key?" link sits in the section header) + an accordion with **Email inboxes**. Appearance is `ui/theme.tsx` (designali-in's 21st.dev `Theme`, tabs variant only, controlled by `themePref`), stretched to the Piper Locke button's width by the `width:0; min-width:100%` trick (the button alone sizes that stack; the `md` size is tuned to fit three icon+label tabs in ~170px, tabs are `flex-auto`). Accordion panels clip while animating and let overflow out once open, so the address suggestions aren't cut off.
- **Neighbouring-month days** in the Mac month grid are plain grey: the ordinary cell faded to 40% opacity (`MonthGrid.tsx`, `cellOpacity`). Frosted, Liquid Glass and one-piece glass versions of these were built and tried; the user preferred the plain grey, so don't bring them back unasked.
- **No flat panels:** surfaces on the glass panels use the glass tokens, not `t.bgElev`/`t.bg` solids. The calendar's legend strip is `--glass-cell`, the commute card is `.glass-card`, the rail's tab-bar track is `--glass-cell`, and the strip behind the tab bar is `.glass-foot` (a fading backdrop blur, so cards scrolling under it frost out; it goes solid under reduced transparency). `.glass-panel` and `.glass-card` also carry a faint edge glow: a quieter rim along the bottom/right (`--glass-rim-low`) and a soft inner glow (`--glass-inner-glow`) layered into their `box-shadow`. The user was asked and chose to keep it, so leave it.
- **Right rail (Mac):** `Inspector.tsx`. The Month tab's "This week vs 8-week average" half folds under its heading (`MonthWeekDeltas`, a `grid-template-rows` 1fr/0fr ease like ConsoleNav; state lives in `Inspector` and is remembered in `localStorage` `sbm.rail.weekOpen`). The rail is `overflow-y: auto`, so it only scrolls when it must; the commute `RouteMap` is the one part that gives way first (map 200 → 130px, card floor 224px, and it re-fits the routes on resize). The route map shows on the Month tab only, not Childcare or Life. The **day card slides**: `DayCard` for the selected day, then one for the day after it (headed "Tomorrow", or "Today" when the selection is yesterday), in a `.day-pager` scroll-snap row (`index.css`), so a two-finger trackpad swipe drags it; the corner button ("Tomorrow ›" / "‹ Today") does the same for mouse and keyboard (focus follows to the arriving card; the other card is `inert`). The strip's height is set from the card in view (ResizeObserver), and the route maps, schedule block and appointments under it stay on the selected day while the cards slide (the user chose that over having them follow the card). Picking another date resets to the first card (state is keyed by `selected`).
- **Holiday labels (Mac month grid):** centred on the bottom row of the cell, in flow under the chips and footer (`MonthGrid.tsx`, `holidayRow`). It takes one chip row, and the corner marks (care check, on-call, stretch, game logo) ride up by `markBottom` to clear it; on a no-childcare day it also clears the dashed pill (`noCareLift`).
- **CSS tokens** in `public/index.html`: `--brand` (Teal Light in dark, Teal in light), `--brand-fill` (Teal, for filled buttons on both grounds), `--accent` now aliases `--brand`. Person colors (Gage/Kaylene/Daisy) are functional and unchanged.
- **Typography:** only the wordmark switched to Sora. Body still uses the system font; the brand's Source Sans 3 / IBM Plex Mono system and the Paper light UI from the "Schedule screen" board are a separate restyle, not done.

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
- **Timeline view (Nucleus Manager)** — `timeline` tab in the calendar layout picker (`desktop/src/components/TimelineView.tsx`, math in `desktop/src/lib/timelineAxis.ts`). One horizontal axis; zoom is pixels-per-day. Day / Week / Month presets glide, pinch or ⌘-scroll zooms around the cursor, drag/scroll pans, double-click a day header zooms to it. The centre of the view is the selected day (panning selects on stop). Lanes: Gage, Kaylene, Daisy (school + shifts), Coverage, Events. Builds its own shift window from `state` — App's `shifts` only covers the visible month. Desktop only; the web/iOS app is unchanged.

## Scope (decided Oct 2026)

Nucleus is a **fixed Gage / Kaylene / Daisy household app**. The any-household data model (people/shifts records, setup wizard, create-household, migration, edit log, the phone's `NucleusModel` bundle) was built and then **removed**; state lives in `households/{id}/state/main` and the code reads and writes it directly. Joining by invite code stays (a new device or account for one of the three).

Also cut in the same pass: the phone's Insights pane and Monthly Changes, the fatigue and couple-time heatmap views, the retired phone Week/Day views, the weekly-template and alternating-weekend editors on the phone, Preview & Export, overtime opportunities and their approval flow, in-basket chat (phone, Mac Chat Manager, `onChatMessageCreate`, `chat`/`chatRead`/`feedback`/`otApprovals` rules), the schedule cleaner (Mac + `cleanSchedule` function), the Mac Year view, and the Mac console's placeholder tabs (Notifications, Billing, fake connectors and feeds).

Kept on purpose: kitchen wall display (+ Pi keypad, now playing, photos, occasions), WVU football, "leave by" commute alerts, health calendar sync, public share link + ICS feed (redesign is on the distant to-do list: `docs/TODO.md`), the improvements light-bulb.

**Mac schedule upload** (sidebar → a person's row) takes an `.xlsx` only and *compares* it with what the app already has for that person (`lib/compareSchedule.ts`), listing days that differ, are only on the sheet, or are only in the app (plus Kaylene's on-call asterisks). Each row is set to Sheet or App; Apply writes the Sheet rows in one go (`applyScheduleComparison`). The photo/vision upload was removed from the Mac modal (the phone still has its own `parseSchedule` import).

**On call** (the asterisk on Kaylene's schedule) is `state.partner.onCall = [{date, pending?, importId?}]`: a day-level mark independent of her shifts. Photo import (`parseSchedule` and the Mac's vision call) and the Mac `.xlsx` reader detect asterisks; nucleusAI has `add_partner_on_call` / `remove_partner_on_call`.

## Firebase

- **Project ID:** `schedule-buddy-dd2cf`
- **Console:** https://console.firebase.google.com/project/schedule-buddy-dd2cf
- **Live URL:** https://schedule-buddy-dd2cf.web.app
- Auth providers: Apple, Google, Email/Password. iOS uses `@capacitor-firebase/authentication` with `skipNativeAuth: true` (native sheets → `signInWithCredential`).
- Security rules: `firestore.rules` (households, state/main, caregiverView, inviteCodes, …) and `storage.rules`

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
**Always rebuild and install after any change under `desktop/`** — don't wait to be asked or leave it for the user. They run the installed `/Applications` build, not the dev server, so an edit isn't done until it's installed:
```bash
cd desktop && npm run dist                      # tsc + vite + electron-builder → release/mac-arm64/
osascript -e 'tell application "Nucleus Manager" to quit'
ditto "release/mac-arm64/Nucleus Manager.app" "/Applications/Nucleus Manager.app"
open "/Applications/Nucleus Manager.app"
```
Typecheck (`npx tsc --noEmit -p .`) first; say in the reply that the app was rebuilt and relaunched.

## Key gotchas (from user memory)

- **iOS is fed by `firebase deploy --only hosting`** — the Capacitor app loads live URL. Do not assume you need to re-archive for JS/CSS/HTML changes.
- **New top-level `state.main` fields must be added to iOS's allowlist** or they're dropped (contract-check blocks deploy). Nested fields are safe. `public/index.html` IS the iOS app.
- **Web sign-in bounces** — known bug. iOS sign-in works fine.
- **Weekly template is PAUSED going forward** — `TEMPLATE_PAUSED` flag in state; new schedules use dated entries only.
- **WVU football icon** — transparent Flying WV on game days. Data is static in `public/wvu-football.json` (baked from wvusports.com RSS, NOT live). To refresh: paste new RSS, redeploy hosting + rebuild Mac.
- **Wall keypad** — physical 3-key pad on wall display: F7 cycle scenes, F8 refresh, F9 (OS-level) YouTube Music.
- **Improvements log** — Nucleus Manager light-bulb logs ideas to `userData/improvements.json` (now `~/Library/Application Support/Nucleus Manager/`; the file is copied from the old `Schedule Buddy Manager` folder on first launch). Read when asked to "update the app". The Anthropic API key in the Mac app must be re-entered once after the rename (macOS ties the safeStorage keychain entry to the app name).
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
