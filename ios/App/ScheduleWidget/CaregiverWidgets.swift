import WidgetKit
import SwiftUI

// Caregiver (Daisy) widgets — concepts 1b / 3a / 3b / 3c.
//
// These read the caregiver-shaped snapshot (`caregiver`), which the web app
// writes only when the signed-in user's role is "supporting". They show HER
// coverage days and nothing about the parents' shifts.
//
// IMPORTANT: `start` is already her ARRIVAL time — the 2h lead is folded in
// when the request is created. The original concept derived "arrive by" as
// start − 2h; doing that here would show a time two hours too early. One time
// only, everywhere.

// MARK: - Shared pieces

private typealias CGShift = WidgetSnapshot.Caregiver.CoverageShift

private extension WidgetSnapshot.Caregiver {
    /// Shifts on/after `date`, chronological.
    func upcoming(from date: Date) -> [CGShift] {
        let key = WidgetSnapshot.iso.string(from: date)
        return shifts.filter { $0.date >= key }
    }
    func shift(on date: Date) -> CGShift? {
        let key = WidgetSnapshot.iso.string(from: date)
        return shifts.first { $0.date == key }
    }
}

private extension CGShift {
    var hours: Double { WidgetDate.hours(start, end) }
    var isConfirmed: Bool { status == "confirmed" }
    var isChange: Bool { status == "change" }
    /// Green when settled, amber when it needs her answer (a proposed time
    /// change, or a request she hasn't accepted yet).
    var dotColor: Color { isConfirmed ? Palette.covered : Palette.gap }
    var statusLabel: String {
        switch status {
        case "change":  return "Change requested"
        case "pending": return "Needs reply"
        default:        return "Confirmed"
        }
    }
}

/// Daisy's initial-in-a-circle avatar (the concept uses no photo here).
private struct DaisyAvatar: View {
    var size: CGFloat = 24
    var initial: String = "D"
    var body: some View {
        Circle().fill(Palette.daisy)
            .frame(width: size, height: size)
            .overlay(
                Text(initial)
                    .font(.system(size: size * 0.46, weight: .bold))
                    .foregroundColor(.white)
            )
    }
}

/// Shown when no caregiver snapshot exists yet (e.g. a manager's phone, or
/// before the app has been opened once).
private struct CaregiverEmpty: View {
    var body: some View {
        VStack(spacing: 6) {
            DaisyAvatar(size: 26)
            Text("Open Schedule Buddy\nto load your shifts")
                .font(.system(size: 11.5, weight: .medium))
                .multilineTextAlignment(.center)
                .foregroundColor(Palette.subtle)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetCard()
    }
}

private func initial(of name: String?) -> String {
    guard let c = name?.trimmingCharacters(in: .whitespaces).first else { return "D" }
    return String(c).uppercased()
}

// MARK: - 1b · Next shift (systemSmall)

struct CaregiverNextShiftWidget: Widget {
    let kind = "CaregiverNextShiftWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            CaregiverNextShiftView(entry: entry)
        }
        .configurationDisplayName("Next shift")
        .description("Your next childcare shift.")
        .supportedFamilies([.systemSmall])
    }
}

struct CaregiverNextShiftView: View {
    var entry: ScheduleEntry

    var body: some View {
        if let cg = entry.snapshot?.caregiver, let next = cg.upcoming(from: entry.date).first {
            let d = WidgetDate.parse(next.date)
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("NEXT SHIFT")
                        .font(.system(size: 10, weight: .bold))
                        .tracking(0.6)
                        .foregroundColor(Palette.subtle)
                    Spacer()
                    DaisyAvatar(size: 20, initial: initial(of: cg.name))
                }
                Spacer(minLength: 0)
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text(d.map(WidgetDate.monthShort) ?? "")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Palette.daisy)
                    Text(d.map(WidgetDate.dayNumber) ?? "")
                        .font(.system(size: 44, weight: .heavy))
                        .tracking(-1.2)
                        .foregroundColor(Palette.ink)
                }
                HStack(spacing: 6) {
                    Text(next.start).font(.system(size: 16, weight: .semibold)).foregroundColor(Palette.ink)
                    Text("→").font(.system(size: 14, weight: .semibold)).foregroundColor(Palette.muted)
                    Text(next.end).font(.system(size: 16, weight: .semibold)).foregroundColor(Palette.ink)
                }
                .padding(.top, 8)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                HStack(spacing: 5) {
                    Text(WidgetDate.hoursText(next.hours))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Palette.greenText)
                    + Text(" hrs")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Palette.greenText.opacity(0.75))
                    Spacer(minLength: 0)
                    Circle().fill(next.dotColor).frame(width: 7, height: 7)
                    Text(next.isConfirmed ? "Confirmed" : (next.isChange ? "Change" : "Reply"))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(Palette.subtle)
                        .lineLimit(1)
                }
                .padding(.top, 9)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(16)
            .widgetCard()
        } else {
            CaregiverEmpty()
        }
    }
}

// MARK: - 3a · On duty today (systemMedium)

struct CaregiverTodayWidget: Widget {
    let kind = "CaregiverTodayWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            CaregiverTodayView(entry: entry)
        }
        .configurationDisplayName("On duty today")
        .description("Today's childcare shift at a glance.")
        .supportedFamilies([.systemMedium])
    }
}

struct CaregiverTodayView: View {
    var entry: ScheduleEntry

    var body: some View {
        if let cg = entry.snapshot?.caregiver {
            let today = cg.shift(on: entry.date)
            let next = cg.upcoming(from: entry.date).first
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    DaisyAvatar(size: 24, initial: initial(of: cg.name))
                    Text(today != nil ? "You're on" : "You're off")
                        .font(.system(size: 16, weight: .bold))
                        .tracking(-0.3)
                        .foregroundColor(Palette.ink)
                    Text("· today")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Palette.subtle)
                    Spacer(minLength: 4)
                    if let s = today {
                        Text(s.isConfirmed ? "CONFIRMED" : (s.isChange ? "CHANGE REQ." : "NEEDS REPLY"))
                            .font(.system(size: 11, weight: .bold))
                            .tracking(0.4)
                            .foregroundColor(s.isConfirmed ? Palette.greenText : Palette.gapText)
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .background(Capsule().fill(s.isConfirmed ? Palette.greenPillBg : Palette.gapBadgeBg))
                            .fixedSize()
                    }
                }
                Spacer(minLength: 0)
                if let s = today {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(WidgetDate.clock12(s.start))
                            .font(.system(size: 34, weight: .heavy))
                            .tracking(-0.8)
                            .foregroundColor(Palette.ink)
                        Text("→").font(.system(size: 18, weight: .bold)).foregroundColor(Palette.muted)
                        Text(WidgetDate.clock12(s.end))
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(Palette.secondary)
                        Spacer(minLength: 0)
                    }
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    Text("Arrive \(WidgetDate.clock12(s.start)) · \(WidgetDate.hoursText(s.hours)) hrs")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Palette.subtle)
                        .padding(.top, 3)
                } else if let n = next, let d = WidgetDate.parse(n.date) {
                    Text("Next: \(WidgetDate.weekdayShort(d).capitalized) \(WidgetDate.monthShort(d)) \(WidgetDate.dayNumber(d))")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundColor(Palette.ink)
                    Text("\(WidgetDate.clock12(n.start)) → \(WidgetDate.clock12(n.end))")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Palette.subtle)
                        .padding(.top, 3)
                } else {
                    Text("No shifts scheduled")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Palette.muted)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(EdgeInsets(top: 16, leading: 18, bottom: 16, trailing: 18))
            .widgetCard()
        } else {
            CaregiverEmpty()
        }
    }
}

// MARK: - 3b · Your week (systemLarge)

struct CaregiverWeekWidget: Widget {
    let kind = "CaregiverWeekWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            CaregiverWeekView(entry: entry)
        }
        .configurationDisplayName("Your week")
        .description("Your childcare shifts for the week.")
        .supportedFamilies([.systemLarge])
    }
}

struct CaregiverWeekView: View {
    var entry: ScheduleEntry

    /// 7 days starting today — a rolling week, so the widget never wastes rows
    /// on days already past.
    private func weekDates() -> [Date] {
        let cal = Calendar.current
        let start = cal.startOfDay(for: entry.date)
        return (0..<7).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
    }

    var body: some View {
        if let cg = entry.snapshot?.caregiver {
            let dates = weekDates()
            let todayKey = WidgetSnapshot.iso.string(from: entry.date)
            let rows = dates.map { (date: $0, shift: cg.shift(on: $0)) }
            let worked = rows.compactMap { $0.shift }
            let totalHours = worked.reduce(0.0) { $0 + $1.hours }
            let nextOff = rows.first { $0.shift == nil }?.date

            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Your week")
                            .font(.system(size: 19, weight: .bold))
                            .tracking(-0.4)
                            .foregroundColor(Palette.ink)
                        Text("\(WidgetDate.rangeLabel(dates)) · \(worked.count) shift\(worked.count == 1 ? "" : "s") · \(WidgetDate.hoursText(totalHours))h")
                            .font(.system(size: 12.5, weight: .medium))
                            .foregroundColor(Palette.subtle)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                    }
                    Spacer(minLength: 4)
                    DaisyAvatar(size: 26, initial: initial(of: cg.name))
                }
                .padding(.bottom, 8)

                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { idx, row in
                        let isToday = WidgetSnapshot.iso.string(from: row.date) == todayKey
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(WidgetDate.weekdayShort(row.date))
                                    .font(.system(size: 10, weight: .bold))
                                    .tracking(0.5)
                                    .foregroundColor(isToday ? Palette.daisy : Palette.subtle)
                                Text(WidgetDate.dayNumber(row.date))
                                    .font(.system(size: 16, weight: .bold))
                                    .foregroundColor(isToday ? Palette.daisy : Palette.ink)
                            }
                            .frame(width: 34, alignment: .leading)

                            if let s = row.shift {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("\(WidgetDate.clock12(s.start)) → \(WidgetDate.clock12(s.end))")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundColor(Palette.ink)
                                        .lineLimit(1)
                                    HStack(spacing: 4) {
                                        Circle().fill(s.dotColor).frame(width: 6, height: 6)
                                        Text(s.statusLabel)
                                            .font(.system(size: 11.5, weight: .medium))
                                            .foregroundColor(Palette.subtle)
                                    }
                                }
                                Spacer(minLength: 0)
                                Text("\(WidgetDate.hoursText(s.hours))h")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundColor(isToday ? Palette.daisy : Palette.secondary)
                            } else {
                                Text("Off")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundColor(Palette.muted)
                                Spacer(minLength: 0)
                            }
                        }
                        .padding(.vertical, 7)
                        .padding(.horizontal, 10)
                        .background(
                            isToday
                                ? RoundedRectangle(cornerRadius: 14).fill(Palette.daisyBg)
                                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.daisyBorder, lineWidth: 1))
                                : nil
                        )
                        if idx < rows.count - 1 && !isToday {
                            Rectangle().fill(Palette.hairline).frame(height: 1)
                        }
                    }
                }

                Spacer(minLength: 6)
                Rectangle().fill(Palette.hairline).frame(height: 1)
                HStack {
                    Text("Next day off")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Palette.subtle)
                    Spacer()
                    Text(nextOff.map { "\(WidgetDate.weekdayShort($0).capitalized) \(WidgetDate.monthShort($0)) \(WidgetDate.dayNumber($0))" } ?? "—")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Palette.couple)
                }
                .padding(.top, 9)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(EdgeInsets(top: 18, leading: 18, bottom: 16, trailing: 18))
            .widgetCard()
        } else {
            CaregiverEmpty()
        }
    }
}

// MARK: - 3c · Two-week outlook (systemLarge)

struct CaregiverOutlookWidget: Widget {
    let kind = "CaregiverOutlookWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            CaregiverOutlookView(entry: entry)
        }
        .configurationDisplayName("Your two weeks")
        .description("Your next 14 days of childcare.")
        .supportedFamilies([.systemLarge])
    }
}

struct CaregiverOutlookView: View {
    var entry: ScheduleEntry

    private let cellRadius: CGFloat = 12
    private let gridGap: CGFloat = 5

    private func legendItem(_ label: String, swatch: AnyView) -> some View {
        HStack(spacing: 5) {
            swatch.frame(width: 9, height: 9)
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(Palette.subtle)
        }
    }

    private func cell(_ date: Date, _ shift: CGShift?, isToday: Bool) -> some View {
        VStack(spacing: 3) {
            Text(WidgetDate.dayNumber(date))
                .font(.system(size: 12, weight: isToday ? .heavy : .bold))
                .foregroundColor(isToday ? Palette.daisy : (shift != nil ? Palette.ink : Palette.muted))
            if let s = shift {
                Text(WidgetDate.compact12(s.start))
                    .font(.system(size: 9.5, weight: .bold))
                    .foregroundColor(Palette.daisy)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Circle().fill(s.dotColor).frame(width: 7, height: 7)
            }
        }
        .padding(EdgeInsets(top: 6, leading: 3, bottom: 7, trailing: 3))
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: cellRadius).fill(shift != nil ? Palette.daisyBg : Palette.cellBg))
        .overlay(
            isToday
                ? RoundedRectangle(cornerRadius: cellRadius).strokeBorder(Palette.daisy, lineWidth: 1.5)
                : (shift != nil
                    ? RoundedRectangle(cornerRadius: cellRadius).strokeBorder(Palette.daisyBorder, lineWidth: 1)
                    : nil)
        )
    }

    var body: some View {
        if let cg = entry.snapshot?.caregiver {
            let cal = Calendar.current
            let start = cal.startOfDay(for: entry.date)
            let dates = (0..<14).compactMap { cal.date(byAdding: .day, value: $0, to: start) }
            let todayKey = WidgetSnapshot.iso.string(from: entry.date)
            let pairs = dates.map { (date: $0, shift: cg.shift(on: $0)) }
            let mine = pairs.compactMap { $0.shift }
            let hours = mine.reduce(0.0) { $0 + $1.hours }
            let pending = cg.pending ?? 0

            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Next two weeks")
                            .font(.system(size: 19, weight: .bold))
                            .tracking(-0.4)
                            .foregroundColor(Palette.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Text("\(WidgetDate.rangeLabel(dates)) · \(mine.count) shift\(mine.count == 1 ? "" : "s") · \(WidgetDate.hoursText(hours))h")
                            .font(.system(size: 12.5, weight: .medium))
                            .foregroundColor(Palette.subtle)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                    }
                    Spacer(minLength: 2)
                    // Inbox with a badge counting everything awaiting her reply,
                    // including items beyond these 14 days.
                    ZStack(alignment: .topTrailing) {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Palette.neutralFill)
                            .frame(width: 26, height: 26)
                            .overlay(
                                Image(systemName: "tray")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(Palette.secondary)
                            )
                        if pending > 0 {
                            Text("\(pending)")
                                .font(.system(size: 10, weight: .heavy))
                                .foregroundColor(.white)
                                .padding(.horizontal, 4)
                                .frame(minWidth: 16, minHeight: 16)
                                .background(Capsule().fill(Palette.gap))
                                .overlay(Capsule().strokeBorder(Color.white, lineWidth: 2))
                                .offset(x: 6, y: -6)
                        }
                    }
                    DaisyAvatar(size: 26, initial: initial(of: cg.name))
                }
                .padding(.bottom, 12)

                HStack(spacing: gridGap) {
                    ForEach(Array(dates.prefix(7).enumerated()), id: \.offset) { _, d in
                        Text(WidgetDate.weekdayInitial(d))
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(Palette.quaternary)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.bottom, 6)

                VStack(spacing: gridGap) {
                    ForEach(0..<2, id: \.self) { row in
                        HStack(spacing: gridGap) {
                            ForEach(Array(pairs[(row * 7)..<(row * 7 + 7)].enumerated()), id: \.offset) { _, p in
                                cell(p.date, p.shift, isToday: WidgetSnapshot.iso.string(from: p.date) == todayKey)
                            }
                        }
                    }
                }

                Spacer(minLength: 8)
                Rectangle().fill(Palette.hairline).frame(height: 1)
                HStack(spacing: 12) {
                    legendItem("your shift", swatch: AnyView(
                        RoundedRectangle(cornerRadius: 3).fill(Palette.daisyBg)
                            .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(Palette.daisyBorder, lineWidth: 1))
                    ))
                    legendItem("off", swatch: AnyView(RoundedRectangle(cornerRadius: 3).fill(Palette.cellBg)))
                    legendItem("confirmed", swatch: AnyView(Circle().fill(Palette.covered)))
                    legendItem("needs reply", swatch: AnyView(Circle().fill(Palette.gap)))
                    Spacer(minLength: 0)
                }
                .padding(.top, 10)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(EdgeInsets(top: 18, leading: 18, bottom: 16, trailing: 18))
            .widgetCard()
        } else {
            CaregiverEmpty()
        }
    }
}
