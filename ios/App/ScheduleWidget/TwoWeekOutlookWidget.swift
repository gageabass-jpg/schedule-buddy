import WidgetKit
import SwiftUI

// Concept 2a — "Two-week outlook" (systemLarge): 14 rolling days from today as
// a 2-row grid. Each cell shows the date over two stacked bars (Gage on top,
// Kaylene below). Childcare gaps are flagged in dashed amber, today is ringed.
//
// The grid is 14 days starting TODAY — not calendar weeks — so the weekday
// header letters are derived from the actual dates rather than fixed.
struct TwoWeekOutlookWidget: Widget {
    let kind = "TwoWeekOutlookWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            TwoWeekOutlookView(entry: entry)
        }
        .configurationDisplayName("Two-week outlook")
        .description("The next 14 days, with childcare gaps flagged.")
        .supportedFamilies([.systemLarge])
    }
}

struct TwoWeekOutlookView: View {
    var entry: ScheduleEntry

    private let cellRadius: CGFloat = 14
    private let gridGap: CGFloat = 6
    private let labelWidth: CGFloat = 32
    private let barHeight: CGFloat = 17

    /// 14 days starting today. The snapshot covers 21 days from the Sunday of
    /// the current week, so today + 13 always falls inside it.
    private var days: [WidgetSnapshot.Day] {
        guard let snap = entry.snapshot else { return [] }
        let cal = Calendar.current
        let start = cal.startOfDay(for: entry.date)
        return (0..<14).compactMap { i -> WidgetSnapshot.Day? in
            guard let d = cal.date(byAdding: .day, value: i, to: start) else { return nil }
            let key = WidgetSnapshot.iso.string(from: d)
            return snap.days.first { $0.date == key }
                ?? WidgetSnapshot.Day(date: key, shifts: [], childcare: nil, coupleHours: nil, life: nil)
        }
    }

    private func works(_ day: WidgetSnapshot.Day, _ who: String) -> Bool {
        day.shifts.contains { $0.who == who }
    }
    private func isGap(_ day: WidgetSnapshot.Day) -> Bool { day.childcare == "gap" }

    /// Working → the person's color. On a gap day the person who ISN'T working
    /// gets the amber bar instead of plain "off" grey, so the cell reads as a
    /// coverage problem rather than a quiet day.
    private func barColor(_ day: WidgetSnapshot.Day, _ who: String) -> Color {
        if works(day, who) { return Palette.color(for: who) }
        return isGap(day) ? Palette.gapBar : Palette.offBar
    }

    private func dayCell(_ day: WidgetSnapshot.Day, isToday: Bool) -> some View {
        let gap = isGap(day)
        let d = WidgetDate.parse(day.date)
        return VStack(spacing: 3) {
            Text(d.map(WidgetDate.dayNumber) ?? "")
                .font(.system(size: 15, weight: isToday ? .heavy : .bold))
                .foregroundColor(isToday ? Palette.gage : (gap ? Palette.gapText : Palette.ink))
            RoundedRectangle(cornerRadius: 5).fill(barColor(day, "G")).frame(height: barHeight)
            RoundedRectangle(cornerRadius: 5).fill(barColor(day, "K")).frame(height: barHeight)
        }
        .padding(EdgeInsets(top: 7, leading: 5, bottom: 8, trailing: 5))
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: cellRadius).fill(gap ? Palette.gapBg : Palette.cellBg))
        .overlay(todayOrGapBorder(isToday: isToday, gap: gap))
    }

    @ViewBuilder
    private func todayOrGapBorder(isToday: Bool, gap: Bool) -> some View {
        if isToday {
            RoundedRectangle(cornerRadius: cellRadius)
                .strokeBorder(Palette.gage, lineWidth: 1.5)
        } else if gap {
            RoundedRectangle(cornerRadius: cellRadius)
                .strokeBorder(Palette.gap, style: StrokeStyle(lineWidth: 1.5, dash: [3.5, 2.5]))
        }
    }

    private func weekRow(_ label: String, _ slice: ArraySlice<WidgetSnapshot.Day>, todayKey: String) -> some View {
        HStack(spacing: gridGap) {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .tracking(0.4)
                .foregroundColor(Palette.subtle)
                .frame(width: labelWidth, alignment: .leading)
            ForEach(Array(slice), id: \.date) { day in
                dayCell(day, isToday: day.date == todayKey)
            }
        }
    }

    private func legendItem(_ label: String, _ color: Color, dashed: Bool = false) -> some View {
        HStack(spacing: 5) {
            Group {
                if dashed {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Palette.gapBg)
                        .overlay(
                            RoundedRectangle(cornerRadius: 3)
                                .strokeBorder(Palette.gap, style: StrokeStyle(lineWidth: 1.2, dash: [2, 1.5]))
                        )
                } else {
                    RoundedRectangle(cornerRadius: 3).fill(color)
                }
            }
            .frame(width: 9, height: 9)
            Text(label)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundColor(Palette.subtle)
        }
    }

    var body: some View {
        let all = days
        let todayKey = WidgetSnapshot.iso.string(from: entry.date)
        let dates = all.compactMap { WidgetDate.parse($0.date) }
        let gapCount = all.filter { isGap($0) }.count

        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Next two weeks")
                        .font(.system(size: 19, weight: .bold))
                        .tracking(-0.4)
                        .foregroundColor(Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(WidgetDate.rangeLabel(dates))
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundColor(Palette.subtle)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                if gapCount > 0 {
                    Text("\(gapCount) gap\(gapCount == 1 ? "" : "s")")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Palette.gapText)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Palette.gapBadgeBg))
                        .fixedSize()
                }
                HStack(spacing: -8) {
                    PersonAvatar(who: "G")
                    PersonAvatar(who: "K")
                }
            }
            .padding(.bottom, 12)

            // Weekday letters, derived from the first week's actual dates.
            HStack(spacing: gridGap) {
                Color.clear.frame(width: labelWidth, height: 1)
                ForEach(Array(all.prefix(7)), id: \.date) { day in
                    Text(WidgetDate.parse(day.date).map(WidgetDate.weekdayInitial) ?? "")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Palette.quaternary)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.bottom, 8)

            VStack(spacing: gridGap) {
                weekRow("WK 1", all.prefix(7), todayKey: todayKey)
                weekRow("WK 2", all.dropFirst(7).prefix(7), todayKey: todayKey)
            }

            Spacer(minLength: 8)

            // Footer legend
            Rectangle().fill(Palette.hairline).frame(height: 1)
            HStack(spacing: 14) {
                legendItem("Gage", Palette.gage)
                legendItem("Kaylene", Palette.kaylene)
                legendItem("off", Palette.offBar)
                legendItem("gap", Palette.gapBg, dashed: true)
                Spacer(minLength: 0)
            }
            .padding(.top, 10)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(EdgeInsets(top: 18, leading: 18, bottom: 16, trailing: 18))
        .widgetCard()
    }
}
