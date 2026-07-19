import WidgetKit
import SwiftUI

@main
struct ScheduleWidgetBundle: WidgetBundle {
    var body: some Widget {
        // Parents
        TodayWidget()                 // 1a · small
        WeekStripWidget()             // 1c · medium
        WeekAgendaWidget()            // 1e · large
        TwoWeekOutlookWidget()        // 2a · large
        // Caregiver (Daisy)
        CaregiverNextShiftWidget()    // 1b · small
        CaregiverTodayWidget()        // 3a · medium
        CaregiverWeekWidget()         // 3b · large
        CaregiverOutlookWidget()      // 3c · large
    }
}
