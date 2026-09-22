import Foundation

/// Mirror of the JSON produced by `buildWidgetSnapshot()` in public/index.html.
struct WidgetSnapshot: Codable {
    let generatedAt: Double
    /// Manager-shaped payload. Absent in a caregiver snapshot.
    let people: [String: Person]?
    let days: [Day]?
    /// Caregiver-shaped payload (Daisy's own coverage days). Absent for
    /// managers. Exactly one of `days` / `caregiver` is populated, decided by
    /// role when the app writes the snapshot.
    let caregiver: Caregiver?

    /// Daisy's view: her shifts only, plus what's awaiting her reply.
    struct Caregiver: Codable {
        let name: String?
        /// Change requests + unanswered requests, across ALL dates — not just
        /// the widget's visible window.
        let pending: Int?
        let shifts: [CoverageShift]

        struct CoverageShift: Codable {
            let date: String       // YYYY-MM-DD
            /// When she should ARRIVE. The 2h lead is already folded in, so
            /// widgets must never subtract it again.
            let start: String      // "HH:MM"
            let end: String        // "HH:MM"
            let endsNextDay: Bool?
            let status: String     // "confirmed" | "pending" | "change"
        }
    }

    struct Person: Codable {
        let name: String
        let hex: String
    }

    struct Shift: Codable {
        let who: String        // "G" | "K"
        let label: String      // compact, e.g. "11a", "7p"
        let start: String?     // "HH:MM"
        let end: String?       // "HH:MM"
    }

    struct Day: Codable {
        let date: String       // "YYYY-MM-DD"
        let shifts: [Shift]
        let childcare: String? // "gap" | "solo" | "ok"/"covered" | nil
        let coupleHours: Double?
        /// Count of life items (non-work commitments) on this day. Optional so
        /// snapshots written before this field existed still decode.
        let life: Int?
        /// Titles of those life items, for widgets that list them rather than
        /// just flagging the day. Also optional for the same reason.
        let lifeItems: [String]?

        /// Stand-in for a date the snapshot doesn't cover. Use this instead of
        /// the memberwise init so adding a field doesn't break every caller.
        static func empty(_ date: String) -> Day {
            Day(date: date, shifts: [], childcare: nil, coupleHours: nil, life: nil, lifeItems: nil)
        }
    }

    // Convenience lookups ---------------------------------------------------

    func person(_ who: String) -> Person {
        people?[who] ?? Person(name: who == "G" ? "Gage" : "Kaylene",
                              hex: who == "G" ? "#0F6E64" : "#8A4B38")
    }

    func day(on date: Date) -> Day? {
        let key = Self.iso.string(from: date)
        return (days ?? []).first { $0.date == key }
    }

    /// The 7 days (Sun…Sat) of the week containing `date`, always length 7
    /// (missing days become empty stand-ins).
    func week(of date: Date) -> [Day] {
        let cal = Calendar.current
        let start = cal.date(from: cal.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date))
            ?? cal.startOfDay(for: date)
        return (0..<7).map { i -> Day in
            let d = cal.date(byAdding: .day, value: i, to: start) ?? date
            let key = Self.iso.string(from: d)
            return (days ?? []).first { $0.date == key } ?? Day.empty(key)
        }
    }

    static let iso: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

/// Reads the snapshot the app wrote into the shared App Group container.
enum SnapshotStore {
    /// Must match `WidgetBridgePlugin.appGroup` and the App Group capability
    /// enabled on both targets.
    static let appGroup = "group.com.gagebass.schedulebuddy"
    static let fileName = "widget-snapshot.json"

    static func load() -> WidgetSnapshot? {
        guard let dir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        let url = dir.appendingPathComponent(fileName)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }
}
