# Schedule Buddy — iOS Widget implementation

Native WidgetKit widgets for concepts **1a (Today · small)**, **1c (Week strip · medium)**,
and **1e (Week agenda · large)**. All the code is written; the remaining work is
**Xcode target setup + signing**, which only you can do.

## How it fits together

The app loads its UI remotely (`schedule-buddy-dd2cf.web.app`), so the schedule
data lives in JS. The pipeline:

```
public/index.html  ──buildWidgetSnapshot()──▶  WidgetBridge (Capacitor plugin)
   (JS, on foreground / render)                     │ writes JSON to
                                                     ▼
                                    App Group container (shared file)
                                                     │ read by
                                                     ▼
                                    ScheduleWidget extension (SwiftUI)
```

- The web app writes a compact JSON snapshot whenever it renders / returns to the
  foreground (`scheduleWidgetPush()` → `WidgetBridge.writeSnapshot`).
- The plugin writes it to a **shared App Group** file and calls
  `WidgetCenter.reloadAllTimelines()`.
- The widget extension reads that file and renders. Its timeline emits one entry
  per upcoming midnight, so "today"/"this week" roll over on their own between
  app opens.

**App Group ID (must match everywhere):** `group.com.gagebass.schedulebuddy`
It's referenced in `WidgetBridge.swift` and `SnapshotModel.swift`.

## Snapshot JSON schema

```jsonc
{
  "generatedAt": 1719960000000,
  "people": {
    "G": { "name": "Gage",    "hex": "#0A84FF" },
    "K": { "name": "Kaylene", "hex": "#FF375F" }
  },
  "days": [                        // Sun of this week … +3 weeks
    {
      "date": "2026-07-16",
      "shifts": [
        { "who": "G", "label": "11a", "start": "11:00", "end": "23:30" },
        { "who": "K", "label": "7p",  "start": "19:00", "end": "07:30" }
      ],
      "childcare": "gap",          // "gap" | "solo" | "ok" | null
      "coupleHours": 0.0
    }
  ]
}
```

## Files

**App target** (`ios/App/App/`)
- `WidgetBridge.swift` — the Capacitor plugin.

**Widget extension** (`ios/App/ScheduleWidget/`)
- `ScheduleWidgetBundle.swift` — `@main`, registers the 3 widgets.
- `SnapshotModel.swift` — Codable model + App Group loader.
- `Provider.swift` — `TimelineProvider`.
- `WidgetHelpers.swift` — colors, date/format helpers, card background.
- `TodayWidget.swift` — 1a (small).
- `WeekStripWidget.swift` — 1c (medium).
- `WeekAgendaWidget.swift` — 1e (large).

**Web** (`public/index.html`) — `buildWidgetSnapshot()` / `pushWidgetSnapshot()` /
`scheduleWidgetPush()`, wired into `renderCalendar()` + `visibilitychange`.
No-op off-device. **Deploy it** (`firebase deploy --only hosting`) so the writer
is live when the widget reads.

## Xcode steps

1. **Open the project:** `ios/App/App.xcodeproj`.

   This app uses **Capacitor's SPM setup** (`ios/App/CapApp-SPM/`), not
   CocoaPods — so there is **no `.xcworkspace`**. Open the `.xcodeproj`
   directly; dependencies resolve as Swift packages.

2. **Add the widget target:** File → New → Target → **Widget Extension**.
   - Product name: `ScheduleWidget`
   - Uncheck "Include Live Activity" / "Include Configuration App Intent".
   - Embed in the `App` target when prompted, **Activate** the new scheme.
   - Delete the sample `ScheduleWidget.swift` Xcode generates.

3. **Add the source files** to the `ScheduleWidget` target: drag the 7 files from
   `ios/App/ScheduleWidget/` into the target (Target Membership = ScheduleWidget).

4. **Add `WidgetBridge.swift`** to the **App** target (Target Membership = App).

   > **Capacitor 8 does NOT auto-register app-local plugins.** Conforming to
   > `CAPBridgedPlugin` is not enough: `CapacitorBridge.registerPlugins()` only
   > loads classes listed in `packageClassList` inside the bundled
   > `capacitor.config.json`, which `cap sync` generates from npm packages. A
   > plugin in the app target is never in that list, so the web app sees no
   > `Capacitor.Plugins.WidgetBridge` and the widget stays empty.
   >
   > `WidgetBridge.swift` therefore also defines `MainViewController`, which
   > overrides `capacitorDidLoad()` and calls `bridge?.registerPluginInstance(...)`.
   > `Main.storyboard` points at it (customClass `MainViewController`, module
   > `App`). Don't revert the storyboard to `CAPBridgeViewController` — that
   > silently unregisters the plugin. (Adding the class to `packageClassList`
   > also works but is wiped by the next `cap sync`.)

5. **App Group on BOTH targets:** select the project → for the **App** target and
   the **ScheduleWidget** target, Signing & Capabilities → **+ Capability → App
   Groups** → add `group.com.gagebass.schedulebuddy`.

6. **Signing:** set your team on the ScheduleWidget target (same as App).

7. **Deploy the web** so the snapshot writer is live:
   `firebase deploy --only hosting`.

8. **Build & run** the `App` scheme on your device. Open the app once (so it
   writes the first snapshot), then long-press the home screen → **+** → search
   "Schedule Buddy" → add the Today / Week / Agenda widgets.

## Notes & tuning

- **iOS 17+** for `containerBackground`; there's a fallback for older, but target
  iOS 17 if you can.
- If a widget shows placeholder/empty: open the app once to write a snapshot, and
  confirm the **App Group id matches** on both targets.
- Colors/sizes are close to the concept but easy to nudge in the SwiftUI files
  (Xcode canvas preview helps). `Palette` in `WidgetHelpers.swift` is the single
  source for the brand colors.
- The `childcare` "gap" flag drives the amber coverage dot + "gap" chip in 1e and
  reflects the same logic as the calendar (confirmed coverage clears it).
