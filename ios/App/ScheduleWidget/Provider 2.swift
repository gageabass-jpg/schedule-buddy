import WidgetKit
import SwiftUI

struct ScheduleEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

/// Reads the App Group snapshot and emits one entry per day so day-based
/// widgets roll over at local midnight without needing a fresh write.
struct ScheduleProvider: TimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry {
        ScheduleEntry(date: Date(), snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> Void) {
        completion(ScheduleEntry(date: Date(), snapshot: SnapshotStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntry>) -> Void) {
        let snap = SnapshotStore.load()
        let cal = Calendar.current
        let now = Date()
        let startOfToday = cal.startOfDay(for: now)

        var entries: [ScheduleEntry] = [ScheduleEntry(date: now, snapshot: snap)]
        // One entry at each of the next several midnights so "today"/"this week"
        // advance on their own between app opens.
        for i in 1...7 {
            if let midnight = cal.date(byAdding: .day, value: i, to: startOfToday) {
                entries.append(ScheduleEntry(date: midnight, snapshot: snap))
            }
        }
        let refreshAt = cal.date(byAdding: .day, value: 1, to: startOfToday) ?? now.addingTimeInterval(3600)
        completion(Timeline(entries: entries, policy: .after(refreshAt)))
    }
}
