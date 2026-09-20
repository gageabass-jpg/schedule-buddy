import WidgetKit
import SwiftUI

// Concept 1a — small "Today": who's on today and when their shift starts.
struct TodayWidget: Widget {
    let kind = "TodayWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ScheduleProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Who's working today and when their shift starts.")
        .supportedFamilies([.systemSmall])
    }
}

struct TodayWidgetView: View {
    var entry: ScheduleEntry

    private func avatar(_ who: String) -> some View {
        Text(who)
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(.white)
            .frame(width: 22, height: 22)
            .background(Circle().fill(Palette.color(for: who)))
    }

    var body: some View {
        let snap = entry.snapshot
        let day = snap?.day(on: entry.date)
        let g = day?.shifts.first { $0.who == "G" }
        let k = day?.shifts.first { $0.who == "K" }
        let gName = snap?.person("G").name ?? "Gage"
        let kName = snap?.person("K").name ?? "Kaylene"

        VStack(alignment: .leading, spacing: 0) {
            Text("\(WidgetDate.weekdayShort(entry.date)) · \(WidgetDate.monthShort(entry.date)) \(WidgetDate.dayNumber(entry.date))")
                .font(.system(size: 10.5, weight: .bold))
                .tracking(0.6)
                .foregroundColor(Palette.subtle)

            Spacer(minLength: 6)

            if g != nil && k != nil {
                // Both working
                HStack(spacing: -6) { avatar("G"); avatar("K") }
                Text("Both working")
                    .font(.system(size: 20, weight: .bold)).tracking(-0.4)
                    .foregroundColor(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                HStack(spacing: 6) {
                    Text("G \(g!.label)").font(.system(size: 12, weight: .semibold)).foregroundColor(.white).chip(Palette.gage)
                    Text("K \(k!.label)").font(.system(size: 12, weight: .semibold)).foregroundColor(.white).chip(Palette.kaylene)
                }
            } else if let solo = g ?? k {
                // One person working
                let who = g != nil ? "G" : "K"
                let name = who == "G" ? gName : kName
                let otherName = who == "G" ? kName : gName
                HStack(spacing: 7) {
                    avatar(who)
                    Text(name).font(.system(size: 22, weight: .bold)).tracking(-0.4).foregroundColor(Palette.ink)
                }
                Text("works today").font(.system(size: 14)).foregroundColor(Color(hex: "#6E6E76"))
                Spacer(minLength: 10)
                HStack(spacing: 8) {
                    Text("Starts \(solo.label)")
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                        .padding(.horizontal, 11).padding(.vertical, 5)
                        .background(Capsule().fill(Palette.color(for: who)))
                    Text("\(otherName.prefix(1)) off").font(.system(size: 12.5)).foregroundColor(Color(hex: "#B4B4BC"))
                }
            } else {
                // Nobody working
                Text("Day off").font(.system(size: 24, weight: .bold)).tracking(-0.5).foregroundColor(Palette.ink)
                Spacer(minLength: 8)
                Text("Couple time")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                    .padding(.horizontal, 11).padding(.vertical, 5)
                    .background(Capsule().fill(Palette.couple))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
        .widgetCard()
    }
}
