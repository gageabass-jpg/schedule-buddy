import SwiftUI
// ContainerBackgroundPlacement.widget (used by widgetCard below) is defined in
// WidgetKit. Swift 6 requires the defining module to be imported explicitly
// rather than picked up transitively.
import WidgetKit

extension Color {
    /// "#RRGGBB" → Color.
    init(hex: String) {
        var s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        self.init(
            .sRGB,
            red:   Double((v >> 16) & 0xff) / 255,
            green: Double((v >> 8) & 0xff) / 255,
            blue:  Double(v & 0xff) / 255,
            opacity: 1
        )
    }
}

/// Brand palette shared across the widgets.
enum Palette {
    static let gage    = Color(hex: "#30D158")   // green
    static let kaylene = Color(hex: "#BF5AF2")   // purple
    static let couple  = Color(hex: "#AF52DE")   // purple
    static let covered = Color(hex: "#34C759")   // green
    static let gap     = Color(hex: "#E8890C")   // amber
    static let ink     = Color(hex: "#16161A")
    static let subtle  = Color(hex: "#9A9AA2")

    // Two-week outlook (concept 2a) tokens.
    static let quaternary  = Color(hex: "#A0A0A8")   // weekday letters
    static let cellBg      = Color(hex: "#F7F8FA")   // day cell background
    static let offBar      = Color(hex: "#EDEDF0")   // not working
    static let gapText     = Color(hex: "#C67A0A")
    static let gapBg       = Color(hex: "#FFF6EC")
    static let gapBadgeBg  = Color(hex: "#FFF1DC")
    static let gapBar      = Color(hex: "#FBE2C0")   // uncovered person's bar
    static let hairline    = Color(hex: "#F0F0F3")

    // Caregiver (Daisy) widget tokens — concepts 1b / 3a / 3b / 3c.
    static let daisy        = Color(hex: "#FF3B5C")
    static let daisyBg      = Color(hex: "#FFF0F3")
    static let daisyBorder  = Color(hex: "#FFD9E0")
    static let greenText    = Color(hex: "#1F9D57")
    static let greenPillBg  = Color(hex: "#E4F7EC")
    static let secondary    = Color(hex: "#6E6E76")
    static let muted        = Color(hex: "#B4B4BC")
    static let neutralFill  = Color(hex: "#F2F2F5")

    static func color(for who: String) -> Color { who == "G" ? gage : kaylene }
}

/// Photo avatar ringed in the person's color, with a white outer ring so
/// overlapping pairs stay readable.
struct PersonAvatar: View {
    let who: String
    var size: CGFloat = 24

    var body: some View {
        Image(who == "G" ? "Gage" : "Kaylene")
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(Palette.color(for: who), lineWidth: 2))
            .padding(1.5)
            .background(Circle().fill(Color.white))
    }
}

/// White card background. iOS 17 requires `containerBackground`; older falls
/// back to a plain background.
struct WidgetCardBackground: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(Color.white, for: .widget)
        } else {
            content.background(Color.white)
        }
    }
}
extension View {
    func widgetCard() -> some View { modifier(WidgetCardBackground()) }

    /// Small pill used for shift chips.
    func chip(_ bg: Color) -> some View {
        self.padding(.horizontal, 10).padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 8).fill(bg))
    }
}

enum WidgetDate {
    static func parse(_ iso: String) -> Date? {
        WidgetSnapshot.iso.date(from: iso)
    }
    /// "FRI", "SAT" …
    static func weekdayShort(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "EEE"
        return f.string(from: date).uppercased()
    }
    /// "S", "M", "T" …
    static func weekdayInitial(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "EEEEE"   // narrow
        return f.string(from: date).uppercased()
    }
    /// "JUL"
    static func monthShort(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "MMM"
        return f.string(from: date).uppercased()
    }
    static func dayNumber(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "d"
        return f.string(from: date)
    }
    /// "07/22"
    static func monthDay(_ date: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "MM/dd"
        return f.string(from: date)
    }
    private static func hm(_ t: String) -> (h: Int, m: Int)? {
        let p = t.split(separator: ":").compactMap { Int($0) }
        return p.count == 2 ? (p[0], p[1]) : nil
    }
    /// "11:00a" / "7:00p" — always shows minutes.
    static func clock12(_ t: String) -> String {
        guard let v = hm(t) else { return t }
        let suffix = v.h < 12 ? "a" : "p"
        var h12 = v.h % 12; if h12 == 0 { h12 = 12 }
        return String(format: "%d:%02d%@", h12, v.m, suffix)
    }
    /// "11a" / "7:30p" — minutes only when non-zero.
    static func compact12(_ t: String) -> String {
        guard let v = hm(t) else { return t }
        let suffix = v.h < 12 ? "a" : "p"
        var h12 = v.h % 12; if h12 == 0 { h12 = 12 }
        return v.m == 0 ? "\(h12)\(suffix)" : String(format: "%d:%02d%@", h12, v.m, suffix)
    }
    /// "6.5" / "8" — trims a trailing .0 so hour counts read cleanly.
    static func hoursText(_ h: Double) -> String {
        h == h.rounded() ? String(format: "%.0f", h) : String(format: "%.1f", h)
    }
    /// Hours between two "HH:MM" times, wrapping past midnight.
    static func hours(_ start: String?, _ end: String?) -> Double {
        guard let start = start, let end = end else { return 0 }
        func mins(_ t: String) -> Int? {
            let p = t.split(separator: ":").compactMap { Int($0) }
            return p.count == 2 ? p[0] * 60 + p[1] : nil
        }
        guard let s = mins(start), let e = mins(end) else { return 0 }
        var d = e - s
        if d <= 0 { d += 24 * 60 }
        return Double(d) / 60.0
    }

    /// "Jul 16 – 22" within a month, "Jul 19 – Aug 1" across one. Repeating the
    /// month matters for the 14-day window, which usually straddles two —
    /// without it the label reads "Jul 19 – 1".
    static func rangeLabel(_ days: [Date]) -> String {
        guard let first = days.first, let last = days.last else { return "" }
        let m = DateFormatter(); m.dateFormat = "MMM d"
        let d = DateFormatter(); d.dateFormat = "d"
        let cal = Calendar.current
        let sameMonth = cal.component(.month, from: first) == cal.component(.month, from: last)
            && cal.component(.year, from: first) == cal.component(.year, from: last)
        return "\(m.string(from: first)) – \(sameMonth ? d.string(from: last) : m.string(from: last))"
    }
}
