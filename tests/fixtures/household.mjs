// A household that uses every field of the legacy state/main record, shared
// by the model and store tests.

export const HH = "hh1";
export const META = {
  memberUids: ["uGage", "uKay", "uDaisy"],
  memberNames: { uGage: "Gage", uKay: "Kaylene", uDaisy: "Daisy" },
  roles: { uGage: "admin", uKay: "partner", uDaisy: "supporting" },
  inviteCode: "ABC222",
  createdBy: "uGage",
};

export const SHIFT_TYPES = [
  { id: "d", name: "Day", start: "07:00", end: "19:00", crossesMidnight: false },
  { id: "n", name: "Night", start: "19:00", end: "07:00", crossesMidnight: true, sleepHours: 7, preSleepHours: 6 },
  { id: "e", name: "Early", start: "05:30", end: "14:00", crossesMidnight: false, sleepHours: 0 },
  { id: "c", name: "Class", start: "09:00", end: "13:00", crossesMidnight: false },
];

/** A household that uses every field state/main has. */
export function fullState() {
  return {
    shiftTypes: SHIFT_TYPES,
    template: ["d", null, null, "d", "d", null, null],
    templateEndDate: "2027-01-01",
    alt: { enabled: true, refSat: "2026-09-05", sat: "d", sun: "d" },
    ot: [
      { date: "2026-09-09", shiftTypeId: "n", label: "OT", coworkers: "Sam" },
      { date: "2026-10-14", shiftTypeId: "d", label: "OT", note: "cover for Jo", where: "ER" },
    ],
    otOpportunities: [{ date: "2026-10-20", shiftTypeId: "n", coworkers: "Lee" }],
    overrides: [
      { date: "2026-09-16", shiftTypeId: null, label: "off" },
      { date: "2026-09-17", shiftTypeId: "n", label: "swap", note: "traded" },
      { date: "2026-09-17", shiftTypeId: "d", label: "dupe" },
    ],
    range: { from: "2026-09-01", to: "2026-12-31" },
    calName: "Bass Schedule",
    calView: "childcare",
    selfName: "Gage",
    partner: { name: "Kaylene", shifts: [
      { date: "2026-09-10", shiftTypeId: "n", label: "extra" },
      { date: "2026-09-24", shiftTypeId: "e", label: "early", note: "training" },
    ] },
    caregiverBlackouts: [{ dow: 2, start: "09:00", end: "13:00" }],
    ui: { calLayout: "month", viewMonth: "2026-09", viewWeekStart: "2026-09-27" },
    activeTab: "calendar",
    dependents: { daisy: { name: "Daisy", shifts: [
      { date: "2026-09-12", shiftTypeId: "c", label: "exam" },
      { date: "2026-09-19", label: "field trip" },
    ] } },
    imports: [{ id: "imp1", scheduleId: "g", importedAt: 1, addedDates: [], noteCount: 0, photo: "data:image/jpeg;base64,AAAA" }],
    events: [
      { id: "e1", date: "2026-09-11", title: "Dentist", who: "G" },
      { id: "e2", date: "2026-09-12", title: "Recital", who: "family" },
      { id: "e3", date: "2026-09-13", title: "Lunch", who: "K" },
      { id: "e4", date: "2026-09-14", title: "Exam", who: "Daisy", healthId: "h1" },
    ],
    householdName: "Bass Household",
    employers: { G: "Thomas Hospital", K: "CAMC", D: "BVCTC" },
    timeZone: "America/New_York",
    shareEnabled: true,
    shareToken: "tok",
    coverageRequests: [
      { id: "cov1", date: "2026-09-10", startTime: "17:00", endTime: "09:00", endsNextDay: true, status: "confirmed", createdAt: 1, caregiverUid: "uDaisy" },
      { id: "cov2", date: "2026-09-24", startTime: "03:30", endTime: "15:00", status: "pending", createdAt: 2 },
    ],
    caregiverRequests: [{ id: "cr1", type: "other", date: "2026-09-20", status: "new", createdAt: 3, createdBy: "uDaisy" }],
    childcareOff: [{ date: "2026-09-25", label: "Daisy – Scheduled Off" }],
    paydays: { G: { anchor: "2026-09-04", freq: "biweekly" }, K: { anchor: "2026-09-11", freq: "weekly" } },
    occasions: [{ id: "o1", date: "2026-10-31", label: "Halloween", type: "holiday", annual: true }],
    scheduleBlocks: [
      { id: "b1", startDate: "2026-10-01", endDate: "2026-10-03", label: "Trip", createdAt: 4, createdBy: "uGage" },
      { startDate: "2026-10-08", endDate: "2026-10-08", label: "Daisy: exam" },
    ],
    weeklyTemplates: {
      G: { days: ["d", null, { start: "06:00", end: "14:30" }, "d", "d", null, null], endDate: "2027-01-01" },
      K: { days: [null, "n", "n", null, null, "n", null], startDate: "2026-09-02" },
      daisy: { days: [null, "c", { start: "10:00", end: "15:00" }, "c", null, null, null] },
    },
    _migrations: ["kayleneSeed"],
    mystery: 42,
  };
}
