# Nucleus — iOS Widget Plan

Status: **design only** (no code yet). Chosen content: *Who's working today* + a *today + tomorrow* medium widget.

---

## 1. The architectural reality

The iOS app is a **Capacitor wrapper** — it loads the hosted web app
(`https://schedule-buddy-dd2cf.web.app`) inside a WebView. Widgets **cannot be
web**: iOS Home Screen / Lock Screen widgets must be a native **WidgetKit
extension written in SwiftUI**, added as a *new target* in `ios/App` (Xcode).

So the widget is genuinely native Swift work, living alongside — not inside —
the React codebase. The hard part isn't the SwiftUI; it's **getting data to the
extension**, because a widget extension is a separate process that can't reach
the WebView, Firebase JS SDK, or the web app's in-memory state.

---

## 2. Data delivery — recommended approach

Two viable paths:

### Option A — App Group snapshot (recommended for v1)
The web app already computes everything the widget needs (`buildShiftMap`, the
overlap engine). On launch / foreground / data change, the web app hands a small
JSON snapshot of the **next ~7 days** to a tiny native Capacitor plugin, which:
1. writes it to a file in a shared **App Group** container, and
2. calls `WidgetCenter.shared.reloadAllTimelines()`.

The widget reads that file and builds a 7-day timeline from it.

- **Pros:** reuses all existing TS shift/overlap logic; no new backend; works
  offline from the last snapshot; cheap.
- **Cons:** data only refreshes **when the app is opened**. Mitigated by writing
  7 days ahead — the timeline advances day-by-day on its own between opens. For a
  schedule planned days in advance, this is acceptable.
- **New pieces:** App Group entitlement on both the app and the widget target; a
  ~40-line Swift Capacitor plugin (`writeWidgetSnapshot(json)`).

### Option B — Cloud Function fetch (later, if background refresh matters)
The widget's `TimelineProvider` fetches the next few days from a Firebase Cloud
Function on a schedule, authenticating with a token stored in the shared App
Group keychain.

- **Pros:** refreshes without opening the app.
- **Cons:** needs a backend endpoint that re-implements the shift/overlap logic
  server-side; token refresh handling; more moving parts.

**Plan: ship Option A first.** Revisit B only if "must update without opening the
app" becomes a real need.

---

## 3. Snapshot JSON schema (written by the app, read by the widget)

```jsonc
{
  "generatedAt": 1719600000000,        // epoch ms — for staleness display
  "householdName": "Bass Household",
  "people": {                          // colors so SwiftUI matches the app
    "G": { "name": "Gage",    "hex": "#..." },
    "K": { "name": "Kaylene", "hex": "#..." }
  },
  "days": [                            // next 7 days, ascending
    {
      "date": "2026-06-29",
      "shifts": [
        { "who": "G", "label": "7p", "start": "19:00", "end": "07:00", "endsNextDay": true },
        { "who": "K", "label": "day", "start": "07:00", "end": "19:00", "endsNextDay": false }
      ],
      "overlap": "both-working",       // null | "both-working" | "couple-time" | ...
      "childcareCovered": true         // optional, for a future variant
    }
    // ... 6 more
  ]
}
```

The web app builds this from the same data it already renders, so there's no new
business logic — just a serialize + handoff step.

---

## 4. Widget families & layouts

### Small (`systemSmall`) — "Today"
```
┌─────────────────┐
│ MON JUN 29      │   ← date, muted
│                 │
│ ● Gage   7p–7a  │   ← colored dot per person + shift label
│ ● Kaylene day   │
│                 │
│ Both working    │   ← overlap badge (or "Couple time" / "—")
└─────────────────┘
```
- No shifts → "Nobody scheduled" / "Couple time ✦".
- One person → single row.

### Medium (`systemMedium`) — "Today + Tomorrow"
```
┌──────────────────────────┬──────────────────────────┐
│ TODAY · Mon Jun 29       │ TOMORROW · Tue Jun 30     │
│ ● Gage    7p–7a          │ ● Gage    off             │
│ ● Kaylene day            │ ● Kaylene 7p–7a           │
│ Both working             │ Solo: Kaylene             │
└──────────────────────────┴──────────────────────────┘
```
- Two equal columns; same row treatment as the small widget.

### (Optional later) Lock Screen `accessoryRectangular`
One line: "Tonight: Gage 7p–7a" — cheap to add once the data path exists.

---

## 5. Timeline / refresh behavior

- `TimelineProvider` reads the snapshot file and emits **one entry per day** at
  local midnight for the days present (so "Today"/"Tomorrow" roll over correctly
  without an app open).
- Policy: `.after(nextMidnight)`; also reloaded immediately whenever the app
  writes a fresh snapshot (`reloadAllTimelines()`).
- Staleness guard: if `generatedAt` is older than ~3 days, show a subtle "Open
  app to refresh" hint instead of confidently wrong data.

---

## 6. Build steps (Xcode, done by you)

1. **Add target:** Xcode → File → New → Target → *Widget Extension*
   (e.g. `ScheduleBuddyWidget`), embedded in the `App` target.
2. **App Group:** add the same `group.com.gagebass.schedulebuddy` capability to
   *both* the `App` target and the widget target.
3. **Capacitor plugin:** add a small Swift plugin in `ios/App` exposing
   `writeWidgetSnapshot({ json })` → writes to the App Group container +
   `WidgetCenter.shared.reloadAllTimelines()`. Register it with Capacitor.
4. **Web side:** a thin TS wrapper that builds the snapshot (reusing
   `buildShiftMap` / overlap logic) and calls the plugin on foreground + on
   household-state change. No-ops on desktop/web where the plugin is absent.
5. **SwiftUI:** `Provider` (TimelineProvider), `Entry`, and the small + medium
   views per the layouts above; pull colors from the snapshot.
6. Run on device, add the widget, verify rollover at midnight.

---

## 7. Phasing / effort

- **Phase 1 (data path):** App Group + Capacitor plugin + snapshot writer +
  decode in Swift. This is the real work; layouts are easy once data flows.
- **Phase 2 (UI):** small + medium SwiftUI widgets.
- **Phase 3 (polish):** Lock Screen variant, childcare-coverage variant,
  staleness states, deep-link tap → opens app to that day.

I can write all the Swift + the TS snapshot writer when you're ready to move from
plan → scaffold; you'd handle the Xcode target creation, entitlements, and
signing.
```
