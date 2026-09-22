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

/// Nucleus palette shared across the widgets. A person owns a hue: Gage Teal,
/// Kaylene Clay, Daisy Ink-Muted; the couple/household is Ink. No red/amber/green
/// — Clay is the alarm, Teal is "fine".
enum Palette {
    static let gage    = Color(hex: "#0F6E64")   // Teal
    static let kaylene = Color(hex: "#8A4B38")   // Clay
    static let couple  = Color(hex: "#14201E")   // Ink
    static let covered = Color(hex: "#0F6E64")   // Teal
    static let gap     = Color(hex: "#8A4B38")   // Clay (attention)
    static let ink     = Color(hex: "#14201E")   // Ink
    static let subtle  = Color(hex: "#5A6663")   // Ink-Muted

    // Two-week outlook (concept 2a) tokens.
    static let quaternary  = Color(hex: "#6E6B64")   // Ink-Dim — weekday letters
    static let cellBg      = Color(hex: "#FFFFFF")   // Surface — day cell background
    static let offBar      = Color(hex: "#EFEDE7")   // Track — not working
    static let gapText     = Color(hex: "#8A4B38")   // Clay
    static let gapBg       = Color(hex: "#EFDFDB")   // Clay-Tint
    static let gapBadgeBg  = Color(hex: "#EFDFDB")   // Clay-Tint
    static let gapBar      = Color(hex: "#D78F77")   // Clay-Light — uncovered person's bar
    static let hairline    = Color(hex: "#E2E0DA")   // Line

    // Caregiver (Daisy) widget tokens — concepts 1b / 3a / 3b / 3c.
    static let daisy        = Color(hex: "#5A6663")  // Ink-Muted
    static let daisyBg       = Color(hex: "#EFEDE7") // Track
    static let daisyBorder   = Color(hex: "#E2E0DA") // Line
    static let greenText     = Color(hex: "#0F6E64") // Teal
    static let greenPillBg   = Color(hex: "#D8E7E4") // Teal-Tint
    static let secondary     = Color(hex: "#5A6663") // Ink-Muted
    static let muted         = Color(hex: "#A9B3B0") // Grey
    static let neutralFill   = Color(hex: "#EFEDE7") // Track

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
