import WidgetKit
import SwiftUI

@main
struct ScheduleWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()       // 1a · small
        WeekStripWidget()   // 1c · medium
        WeekAgendaWidget()  // 1e · large
    }
}
