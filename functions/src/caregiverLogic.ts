// What a caregiver (a "supporting" member) may see and change, as pure
// functions over the state/main document — no Firebase here, so it's tested
// directly (tests/caregiverLogic.test.mjs).
//
// A caregiver never reads or writes state/main itself (firestore.rules).
// They read caregiverView/main, which buildCaregiverView() fills from it, and
// they change things only through the caregiverAction function, which runs
// applyCaregiverAction() inside a transaction.

type Obj = Record<string, unknown>;

/**
 * The slice of the household a caregiver's screen shows: the coverage
 * requests and the names it greets people by. Field names match state/main so
 * the phone reads it with the same code. Nothing else — no health events,
 * paydays, employers, overtime, notes or import photos.
 */
export interface CaregiverView {
  householdName?: string;
  selfName?: string;
  partner?: { name?: string };
  dependents?: { daisy?: { name?: string } };
  coverageRequests: unknown[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function buildCaregiverView(state: Obj | undefined): CaregiverView {
  const s = state ?? {};
  const partner = (s.partner ?? {}) as Obj;
  const daisy = (((s.dependents ?? {}) as Obj).daisy ?? {}) as Obj;
  const view: CaregiverView = {
    coverageRequests: Array.isArray(s.coverageRequests) ? s.coverageRequests : [],
  };
  if (str(s.householdName)) view.householdName = str(s.householdName);
  if (str(s.selfName)) view.selfName = str(s.selfName);
  if (str(partner.name)) view.partner = { name: str(partner.name) };
  if (str(daisy.name)) view.dependents = { daisy: { name: str(daisy.name) } };
  return view;
}

export class CaregiverInputError extends Error {}
/** The caller is a member but this isn't theirs to answer. */
export class CaregiverForbiddenError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EVENT_WHO = ["G", "K", "Daisy", "family"];
const MAX_TEXT = 1000;

function text(v: unknown, field: string, { required = false, max = MAX_TEXT } = {}): string | undefined {
  if (v == null || v === "") {
    if (required) throw new CaregiverInputError(`${field} is required.`);
    return undefined;
  }
  if (typeof v !== "string") throw new CaregiverInputError(`${field} must be text.`);
  const t = v.trim();
  if (required && !t) throw new CaregiverInputError(`${field} is required.`);
  if (t.length > max) throw new CaregiverInputError(`${field} is too long.`);
  return t || undefined;
}

export interface ActionContext {
  uid: string;
  nowIso: string;
  nowMs: number;
  /** A fresh id for a new event. */
  newId: string;
  /**
   * The people records whose `uid` is the caller, on a household that has
   * moved to the any-household model; undefined on one still on state/main,
   * which has no people records. Requests there name a person (`caregiverId`).
   */
  callerPersonIds?: string[];
}

/**
 * A coverage request is for one caregiver. It names them as `caregiverUid`
 * (set once someone has answered it, and on a household still on state/main)
 * and, on the any-household model, as `caregiverId` (a person). A request
 * that names nobody yet belongs to the household's single caregiver, as before.
 * Without this, any caregiver in the household could answer any request, and
 * one could overwrite another's answer.
 */
function assertAddressedToCaller(req: Obj, ctx: ActionContext): void {
  const uid = typeof req.caregiverUid === "string" ? req.caregiverUid : "";
  const person = typeof req.caregiverId === "string" ? req.caregiverId : "";
  const wrongUid = uid !== "" && uid !== ctx.uid;
  const wrongPerson = person !== "" && ctx.callerPersonIds !== undefined && !ctx.callerPersonIds.includes(person);
  if (wrongUid || wrongPerson) throw new CaregiverForbiddenError("That request is for someone else.");
}

/**
 * One caregiver change, applied to the current state/main. Returns only the
 * top-level fields it changes (for a transaction `update`), or throws
 * CaregiverInputError for bad input or a request that doesn't exist, or
 * CaregiverForbiddenError for a request addressed to another caregiver.
 *
 *   respond       — accept / decline / flag an issue on a coverage request
 *   resolveChange — approve or reject a manager-proposed change of times
 *   addEvent      — a life event on the calendar
 *   addBlock      — a one-day schedule block
 */
export function applyCaregiverAction(state: Obj, input: unknown, ctx: ActionContext): Obj {
  if (!input || typeof input !== "object") throw new CaregiverInputError("Nothing to do.");
  const a = input as Obj;

  if (a.action === "respond" || a.action === "resolveChange") {
    const id = text(a.id, "Request", { required: true, max: 200 })!;
    const list = Array.isArray(state.coverageRequests) ? (state.coverageRequests as Obj[]).slice() : [];
    const idx = list.findIndex((r) => r && r.id === id);
    if (idx < 0) throw new CaregiverInputError("That request no longer exists.");
    const cur = list[idx];
    assertAddressedToCaller(cur, ctx);

    if (a.action === "respond") {
      const status = a.status;
      if (status !== "confirmed" && status !== "declined" && status !== "issue") {
        throw new CaregiverInputError("Unknown answer.");
      }
      // A decline or an issue says why, so the family knows before scrambling.
      const note = text(a.note, "A reason", { required: status !== "confirmed" });
      const updated: Obj = { ...cur, status, caregiverUid: ctx.uid, caregiverActedAt: ctx.nowIso };
      if (note !== undefined) updated.caregiverNote = note;
      list[idx] = updated;
      return { coverageRequests: list };
    }

    const pc = cur.proposedChange as Obj | undefined;
    if (!pc) throw new CaregiverInputError("That change was already resolved.");
    const updated: Obj = { ...cur, caregiverUid: ctx.uid, caregiverActedAt: ctx.nowIso };
    delete updated.proposedChange;
    if (a.approve === true) {
      updated.startTime = pc.startTime;
      updated.endTime = pc.endTime;
      if (pc.endsNextDay) updated.endsNextDay = true;
      else delete updated.endsNextDay;
      if (pc.reason) updated.reason = pc.reason;
      updated.changeAppliedAt = ctx.nowMs;
    } else if (a.approve !== false) {
      throw new CaregiverInputError("Say whether to approve the change.");
    }
    list[idx] = updated;
    return { coverageRequests: list };
  }

  if (a.action === "addEvent") {
    const date = text(a.date, "Date", { required: true, max: 10 })!;
    if (!DATE.test(date)) throw new CaregiverInputError("Pick a date.");
    const title = text(a.title, "What it is", { required: true, max: 200 })!;
    if (typeof a.who !== "string" || !EVENT_WHO.includes(a.who)) throw new CaregiverInputError("Pick who it's for.");
    const startTime = text(a.startTime, "Start time", { max: 5 });
    const endTime = text(a.endTime, "End time", { max: 5 });
    if ((startTime && !TIME.test(startTime)) || (endTime && !TIME.test(endTime))) {
      throw new CaregiverInputError("Times are HH:MM.");
    }
    const evt: Obj = { id: ctx.newId, date, title, who: a.who };
    if (startTime) evt.startTime = startTime;
    if (endTime) evt.endTime = endTime;
    const events = Array.isArray(state.events) ? (state.events as Obj[]).slice() : [];
    events.push(evt);
    return { events };
  }

  if (a.action === "addBlock") {
    const date = text(a.date, "Date", { required: true, max: 10 })!;
    if (!DATE.test(date)) throw new CaregiverInputError("Pick a date.");
    const label = text(a.label, "Label", { required: true, max: 200 })!;
    const blocks = Array.isArray(state.scheduleBlocks) ? (state.scheduleBlocks as Obj[]).slice() : [];
    blocks.push({ startDate: date, endDate: date, label });
    return { scheduleBlocks: blocks };
  }

  throw new CaregiverInputError("Unknown action.");
}
