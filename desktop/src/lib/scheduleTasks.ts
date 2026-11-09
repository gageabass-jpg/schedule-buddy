// The to-do list the sidebar shows as a schedule period ends.
//
// A schedule runs in 4-week periods, Saturday to Friday, anchored on the
// alternating-weekend reference Saturday (state.alt.refSat): the same cycle the
// Friday "schedule is wrapping up" reminder counts from. When a period is about
// to end there are up to three things to do before the next one starts:
//
//   Upload Kaylene's Schedule   done once her schedule reaches a week into the next period
//   Upload Gage's Schedule      the same for him
//   Reconcile Childcare Gaps    there only while days need a caregiver lined up
//
// The list is for the last week of a period, and stays after it ends for up to
// two more weeks, so a late upload isn't forgotten when the period rolls over.
// Once every task is done it stays a day (TASKS_LINGER_MS) to be seen, then the
// sidebar shows its empty state until the next period nears its end.
// Pure: the caller passes in what it knows.

export type TaskId = "upload-K" | "upload-G" | "gaps";

export interface ScheduleTask {
  id: TaskId;
  title: string;
  status: "pending" | "completed";
  /** Small text at the end of the row ("3 days"). */
  detail?: string;
}

export interface ScheduleTasks {
  /** The last day of the period the tasks are for (YYYY-MM-DD). */
  periodEnd: string;
  /** True once that day has passed. */
  ended: boolean;
  /** Every task done (and no childcare gaps left). */
  allComplete: boolean;
  items: ScheduleTask[];
}

/** When every task of a period was finished, so the list can retire a day later. */
export interface TasksDone { periodEnd: string; at: number }

/** How long a finished list stays before it turns into the empty state. */
export const TASKS_LINGER_MS = 24 * 60 * 60 * 1000;

export interface ScheduleTasksInput {
  /** state.alt.refSat: a Saturday that starts one of the 4-week periods. */
  refSat: string | undefined;
  today: string;
  /** The last day each person has a dated shift, or null when they have none. */
  gEnd: string | null;
  kEnd: string | null;
  hasPartner: boolean;
  /** Whether the household uses childcare coverage at all. */
  childcare: boolean;
  /** Days from today on that need a caregiver and don't have one lined up. */
  gapDays: number;
  names: { G: string; K: string };
}

/** Days before a period ends that its list appears. */
export const LEAD_DAYS = 7;
/** Days after it ends that an unfinished list stays. */
export const GRACE_DAYS = 14;
const PERIOD_DAYS = 28;
/** How far into the next period someone's schedule must reach to count as uploaded.
 *  Not just "past the end": a schedule can spill a day over (a Saturday shift after a
 *  Friday period end) without being the next one. */
export const NEXT_PERIOD_DAYS = 7;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** Whole days since the epoch for a date (dates here are UTC calendar days, so no daylight saving to trip on). */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function isoOf(day: number): string {
  const d = new Date(day * MS_PER_DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** The first and last day of the 4-week period that `today` falls in. */
export function periodOf(refSat: string, today: string): { start: string; end: string } {
  const ref = dayNumber(refSat);
  const start = ref + Math.floor((dayNumber(today) - ref) / PERIOD_DAYS) * PERIOD_DAYS;
  return { start: isoOf(start), end: isoOf(start + PERIOD_DAYS - 1) };
}

function tasksFor(periodEnd: string, input: ScheduleTasksInput): ScheduleTask[] {
  const uploadedBy = isoOf(dayNumber(periodEnd) + NEXT_PERIOD_DAYS);
  const upload = (id: "upload-G" | "upload-K", name: string, end: string | null): ScheduleTask => ({
    id, title: `Upload ${name}'s Schedule`, status: end !== null && end >= uploadedBy ? "completed" : "pending",
  });
  const items: ScheduleTask[] = [];
  if (input.hasPartner) items.push(upload("upload-K", input.names.K, input.kEnd));
  items.push(upload("upload-G", input.names.G, input.gEnd));
  if (input.childcare && input.gapDays > 0) {
    items.push({ id: "gaps", title: "Reconcile Childcare Gaps", status: "pending", detail: `${input.gapDays} ${input.gapDays === 1 ? "day" : "days"}` });
  }
  return items;
}

function listFor(periodEnd: string, ended: boolean, input: ScheduleTasksInput): ScheduleTasks {
  const items = tasksFor(periodEnd, input);
  return { periodEnd, ended, allComplete: items.every((i) => i.status === "completed"), items };
}

/** The list for today, or null when no period is near its end (or there's nothing to anchor on). */
export function scheduleTasks(input: ScheduleTasksInput): ScheduleTasks | null {
  if (!input.refSat || !ISO.test(input.refSat) || !ISO.test(input.today)) return null;
  const { start, end } = periodOf(input.refSat, input.today);
  const todayN = dayNumber(input.today);

  // The last week of a period.
  if (dayNumber(end) - todayN < LEAD_DAYS) return listFor(end, false, input);

  // The first weeks of the next one, for what wasn't finished in time.
  const prevEnd = isoOf(dayNumber(start) - 1);
  if (todayN - dayNumber(prevEnd) <= GRACE_DAYS) return listFor(prevEnd, true, input);
  return null;
}

/**
 * What the sidebar shows: the list, or null for the empty state. A finished
 * list stays for TASKS_LINGER_MS after it was finished (`done`), then retires.
 */
export function visibleTasks(tasks: ScheduleTasks | null, done: TasksDone | null, now: number): ScheduleTasks | null {
  if (!tasks) return null;
  if (tasks.allComplete && done && done.periodEnd === tasks.periodEnd && now - done.at >= TASKS_LINGER_MS) return null;
  return tasks;
}
