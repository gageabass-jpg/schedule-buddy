import WidgetKit
import SwiftUI

// Concept 1c — medium "Week strip": a 7-day mini grid of shift chips, today ringed.
struct WeekStripWidget: Widget {
    let kind = "WeekStripWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            WeekStripView(entry: entry)
        }
        .configurationDisplayName("Week strip")
        .description("Every shift this week, today ringed.")
        .supportedFamilies([.systemMedium])
    }
}

struct WeekStripView: View {
    var entry: ScheduleEntry

    /// Photo avatar ringed in the person's color. The outer white ring keeps
    /// the two readable where they overlap (HStack spacing is negative).
    private func avatarDot(_ who: String) -> some View {
        Image(who == "G" ? "Gage" : "Kaylene")
            .resizable()
            .scaledToFill()
            .frame(width: 22, height: 22)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(Palette.color(for: who), lineWidth: 2))
            .padding(1.5)
            .background(Circle().fill(Color.white))
    }

    private func dayColumn(_ day: WidgetSnapshot.Day, isToday: Bool) -> some View {
        let d = WidgetDate.parse(day.date)
        return VStack(spacing: 4) {
            Text(d.map(WidgetDate.weekdayInitial) ?? "")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(isToday ? Palette.gage : Color(hex: "#A0A0A8"))
            Text(d.map(WidgetDate.dayNumber) ?? "")
                .font(.system(size: 13, weight: isToday ? .heavy : .bold))
                .foregroundColor(isToday ? Palette.gage : Palette.ink)
            VStack(spacing: 3) {
                ForEach(Array(day.shifts.enumerated()), id: \.offset) { _, s in
                    Text(s.label)
                        .font(.system(size: 9.5, weight: .bold))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 15)
                        .background(RoundedRectangle(cornerRadius: 5).fill(Palette.color(for: s.who)))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .overlay(
            isToday
                ? RoundedRectangle(cornerRadius: 12).stroke(Palette.gage, lineWidth: 1.5)
                    .padding(.horizontal, -3).padding(.vertical, -5)
                : nil
        )
    }

    var body: some View {
        let snap = entry.snapshot
        let week = snap?.week(of: entry.date) ?? []
        let todayKey = WidgetSnapshot.iso.string(from: entry.date)
        let dates = week.compactMap { WidgetDate.parse($0.date) }

        VStack(spacing: 0) {
            HStack(alignment: .center) {
                Text("This week").font(.system(size: 16, weight: .bold)).tracking(-0.3).foregroundColor(Palette.ink)
                    + Text("  ·  \(WidgetDate.rangeLabel(dates))").font(.system(size: 13, weight: .medium)).foregroundColor(Palette.subtle)
                Spacer()
                HStack(spacing: -8) { avatarDot("G"); avatarDot("K") }
            }
            .padding(.bottom, 14)

            HStack(alignment: .top, spacing: 6) {
                ForEach(week, id: \.date) { day in
                    dayColumn(day, isToday: day.date == todayKey)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(EdgeInsets(top: 16, leading: 18, bottom: 16, trailing: 18))
        .widgetCard()
    }
}
