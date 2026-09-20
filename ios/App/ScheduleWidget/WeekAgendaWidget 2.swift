import WidgetKit
import SwiftUI

// Concept 1e — large "Week agenda": per-day rows for both partners with
// coverage dots and weekly totals.
struct WeekAgendaWidget: Widget {
    let kind = "WeekAgendaWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            WeekAgendaView(entry: entry)
        }
        .configurationDisplayName("Week agenda")
        .description("Both partners, per-day coverage and weekly totals.")
        .supportedFamilies([.systemLarge])
    }
}

struct WeekAgendaView: View {
    var entry: ScheduleEntry

    private func avatarDot(_ who: String, size: CGFloat) -> some View {
        Circle().fill(Palette.color(for: who))
            .frame(width: size, height: size)
            .overlay(Circle().stroke(Color.white, lineWidth: 2))
    }

    private func shiftChip(_ s: WidgetSnapshot.Shift) -> some View {
        Text("\(s.who) \(s.label)")
            .font(.system(size: 12, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(RoundedRectangle(cornerRadius: 8).fill(Palette.color(for: s.who)))
    }

    private func row(_ day: WidgetSnapshot.Day, isLast: Bool) -> some View {
        let d = WidgetDate.parse(day.date)
        let isGap = day.childcare == "gap"
        let needsPlan = isGap || day.childcare == "solo"
        return VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: -1) {
                    Text(d.map(WidgetDate.weekdayShort) ?? "")
                        .font(.system(size: 10, weight: .bold)).tracking(0.4)
                        .foregroundColor(needsPlan ? Palette.gap : Palette.subtle)
                    Text(d.map(WidgetDate.dayNumber) ?? "")
                        .font(.system(size: 16, weight: .bold)).foregroundColor(Palette.ink)
                }
                .frame(width: 38, alignment: .leading)

                HStack(spacing: 6) {
                    ForEach(Array(day.shifts.enumerated()), id: \.offset) { _, s in shiftChip(s) }
                    if isGap {
                        Text("gap")
                            .font(.system(size: 11, weight: .semibold)).foregroundColor(Color(hex: "#C67A0A"))
                            .padding(.horizontal, 9).padding(.vertical, 3)
                            .background(RoundedRectangle(cornerRadius: 8).stroke(Palette.gap, style: StrokeStyle(lineWidth: 1, dash: [3])))
                    }
                    Spacer(minLength: 0)
                }

                Circle().fill(needsPlan ? Palette.gap : Palette.covered)
                    .frame(width: 9, height: 9)
            }
            .padding(.vertical, 9)
            if !isLast {
                Rectangle().fill(Color(hex: "#F4F4F6")).frame(height: 1)
            }
        }
    }

    var body: some View {
        let snap = entry.snapshot
        let week = (snap?.week(of: entry.date) ?? []).filter { !$0.shifts.isEmpty || $0.childcare == "gap" }
        let allWeek = snap?.week(of: entry.date) ?? []
        let dates = allWeek.compactMap { WidgetDate.parse($0.date) }

        // Weekly totals.
        let gageHours = allWeek.reduce(0.0) { acc, day in
            acc + day.shifts.filter { $0.who == "G" }.reduce(0.0) { $0 + WidgetDate.hours($1.start, $1.end) }
        }
        let coupleHours = allWeek.reduce(0.0) { $0 + ($1.coupleHours ?? 0) }

        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("This week").font(.system(size: 19, weight: .bold)).tracking(-0.3).foregroundColor(Palette.ink)
                    Text(WidgetDate.rangeLabel(dates)).font(.system(size: 12.5)).foregroundColor(Palette.subtle)
                }
                Spacer()
                HStack(spacing: -9) { avatarDot("G", size: 26); avatarDot("K", size: 26) }
            }
            .padding(.bottom, 12)

            VStack(spacing: 0) {
                let rows = week.isEmpty ? allWeek : week
                ForEach(Array(rows.enumerated()), id: \.element.date) { idx, day in
                    row(day, isLast: idx == rows.count - 1)
                }
            }

            Spacer(minLength: 8)

            Divider().overlay(Color(hex: "#F0F0F3"))
            HStack {
                totalLabel(color: Palette.gage, name: snap?.person("G").name ?? "Gage",
                           value: String(format: "%.1fh", gageHours))
                Spacer()
                totalLabel(color: Palette.couple, name: "Couple",
                           value: String(format: "%.1fh", coupleHours))
            }
            .padding(.top, 12)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(20)
        .widgetCard()
    }

    private func totalLabel(color: Color, name: String, value: String) -> some View {
        HStack(spacing: 7) {
            RoundedRectangle(cornerRadius: 3).fill(color).frame(width: 9, height: 9)
            Text(name).font(.system(size: 13)).foregroundColor(Color(hex: "#6E6E76"))
            Text(value).font(.system(size: 13, weight: .bold)).foregroundColor(Palette.ink)
        }
    }
}
