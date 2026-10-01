import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPalette, themeTokens, type PaletteName } from "./theme";
import { fmtDate, DEMO_SHIFTS, dayKindFromShifts, type ShiftMap, type Shift } from "./data";

export type ViewFilter = "all" | "this-week" | "both" | "couple" | "g" | "k" | "coverage";
export type CalLayout = "day" | "week" | "month" | "year" | "agenda";
export type ThemePref = "system" | "light" | "dark";

const THEME_PREF_KEY = "sbm.theme";

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_PREF_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* ignore */ }
  return "system";
}
function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && !!window.matchMedia
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function resolveDark(pref: ThemePref): boolean {
  if (pref === "dark") return true;
  if (pref === "light") return false;
  return systemPrefersDark();
}
import { useAuth } from "./hooks/useAuth";
import { useHousehold } from "./hooks/useHousehold";
import { useScheduleReminder } from "./hooks/useScheduleReminder";
import { useWvuGames } from "./hooks/useWvuGames";
import type { WvuGame } from "./lib/wvuSchedule";

const NO_WVU_GAMES: Map<string, WvuGame> = new Map();
import { pendingCoverageNeeds, coverageNeedsSignature } from "./lib/pendingCoverageNeeds";
import { buildShiftMap, compactTime, expandCustomTemplateTypes, type Event, type HouseholdState } from "./state";

export type EventMap = Record<string, Event[]>;
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { MonthGrid } from "./components/MonthGrid";
import { Inspector } from "./components/Inspector";
import { ScheduleBlockModal } from "./components/ScheduleBlockModal";
import { CleanerModal } from "./components/CleanerModal";
import { SignIn } from "./components/SignIn";
import { JoinHousehold } from "./components/JoinHousehold";
import { HouseholdLookContext, lookOf } from "./lib/householdLook";
import { SetupWizard } from "./components/SetupWizard";
import { LoadingScreen } from "./components/LoadingScreen";
import { NewShiftModal } from "./components/NewShiftModal";
import { TemplateEditor } from "./components/TemplateEditor";
import { EditShiftModal, type EditShiftTarget } from "./components/EditShiftModal";
import { ShiftTypesEditor } from "./components/ShiftTypesEditor";
import { ScheduleImportModal } from "./components/ScheduleImportModal";
import { ToastHost } from "./components/ToastHost";
import { findScheduleImport } from "./scheduleImports";
import type { TemplatePerson } from "./lib/writeTemplate";
import { useScheduleChangeToasts } from "./hooks/useScheduleChangeToasts";
import { ApiKeySettings } from "./components/ApiKeySettings";
import { EventModal } from "./components/EventModal";
import { FamilyConsole } from "./components/FamilyConsole";
import { CoverageRequestModal } from "./components/CoverageRequestModal";
import { CoverageRequestsPanel } from "./components/CoverageRequestsPanel";
import { ImprovementsModal } from "./components/ImprovementsModal";
import { ChildcarePanel } from "./components/ChildcarePanel";
import { ChatManagerPanel } from "./components/ChatManagerPanel";
import { AskClaudePanel } from "./components/AskClaudePanel";
import { NewRequestModal } from "./components/NewRequestModal";
import { ShiftDetailPopover } from "./components/ShiftDetailPopover";
import { DayDetailPopover } from "./components/DayDetailPopover";
import type { Event as SbEvent } from "./state";
import { deleteShift } from "./lib/writeShift";
import { toggleChildcareOff } from "./lib/writeChildcareOff";
import { DayFlagPopover } from "./components/DayFlagPopover";
import type { AskContext } from "./components/AskClaudePanel";
import { subscribeDayFlags, type DayFlag } from "./lib/dayFlags";
import { subscribeCommuteResults, type CommuteResult } from "./lib/commute";
import { computeOverlapCandidates } from "./lib/computeOverlap";
import { blockForDate } from "./lib/writeScheduleBlock";
import type { CoverageMark } from "./components/MonthGrid";
import { NotificationInboxPopover, type InboxNotification } from "@/components/ui/notification-inbox-popover";
import { markAllNotificationsRead, markNotificationRead, subscribeNotifications, type AppNotification } from "./lib/notifications";
import { ModalPresence } from "./lib/modalMotion";
import { stretchesFor } from "./lib/stretch";
import { holidayOn } from "../../shared/holidays";

const PALETTE: PaletteName = "nucleus";
const FLAT = false;

export function App() {
  const [themePref, setThemePref] = useState<ThemePref>(readThemePref);
  const [dark, setDark] = useState<boolean>(() => resolveDark(readThemePref()));

  useEffect(() => {
    try { localStorage.setItem(THEME_PREF_KEY, themePref); } catch { /* ignore */ }
    setDark(resolveDark(themePref));
  }, [themePref]);

  // shadcn-style components read light/dark from a class on <html>, and the
  // Dock icon swaps to its dark variant to match.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    window.sbm?.setAppearance?.(dark);
  }, [dark]);

  // Track OS preference changes while the user is in "system" mode.
  useEffect(() => {
    if (themePref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themePref]);

  const auth = useAuth();

  // One loading screen from launch until the household's first snapshot, so
  // the placeholder calendar never shows. It sits over the app and fades out;
  // after 10s it gives way regardless, and the top bar's "connecting" says
  // the rest. It stays up for at least 3s even when everything is ready
  // sooner, so the dots get to run through their split and merge.
  const [minShown, setMinShown] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMinShown(true), 3000);
    return () => window.clearTimeout(id);
  }, []);
  const [appReady, setAppReady] = useState(false);
  const markReady = useCallback(() => setAppReady(true), []);
  useEffect(() => {
    if (auth.status !== "signed-in" || appReady) return;
    const id = window.setTimeout(markReady, 10_000);
    return () => window.clearTimeout(id);
  }, [auth.status, appReady, markReady]);
  const booting = !minShown || auth.status === "loading" || (auth.status === "signed-in" && !appReady);

  return (
    <>
      {auth.status === "signed-out" && <SignIn dark={dark} />}
      {auth.status === "signed-in" && (
        <ManagerApp dark={dark} themePref={themePref} onSetThemePref={setThemePref} onReady={markReady} />
      )}
      <LoadingScreen visible={booting} dark={dark} />
    </>
  );
}

interface ManagerAppProps {
  dark: boolean;
  themePref: ThemePref;
  onSetThemePref: (pref: ThemePref) => void;
  /** Called once the household has loaded (or turned out not to exist). */
  onReady: () => void;
}

function ManagerApp({ dark, themePref, onSetThemePref, onReady }: ManagerAppProps) {
  const palette = getPalette(PALETTE);
  const auth = useAuth();
  const user = auth.status === "signed-in" ? auth.user : null;
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const householdStatus = useHousehold(user, refreshNonce);
  // Setting up a new household. Kept here, not in the join screen: the
  // household exists (and the join screen goes away) before the wizard has
  // shown the invite codes.
  const [settingUp, setSettingUp] = useState(false);
  useEffect(() => {
    if (householdStatus.status !== "loading") onReady();
  }, [householdStatus.status, onReady]);

  // Ticking, not per-render: this is a long-running Electron app that can sit
  // open across midnight with no re-render. A frozen `today` made the coverage
  // card count a day that could no longer be staffed (and disagree with the
  // modal, which recomputes on open). Also rolls the calendar's today-highlight.
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const id = window.setInterval(() => {
      setToday((prev) => { const now = todayISO(); return now === prev ? prev : now; });
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  const [tY, tM, tD] = today.split("-").map(Number);
  const [selected, setSelected] = useState<string>(today);
  const [viewYear, setViewYear] = useState<number>(tY);
  const [viewMonth, setViewMonth] = useState<number>(tM - 1);
  const [newShiftOpen, setNewShiftOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  /** Whose week the template editor opens on. */
  const [templatePerson, setTemplatePerson] = useState<TemplatePerson>("G");
  const [shiftTypesOpen, setShiftTypesOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditShiftTarget | null>(null);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [importScheduleId, setImportScheduleId] = useState<string | null>(null);
  const [apiKeyOpen, setApiKeyOpen] = useState(false);
  const [calLayout, setCalLayout] = useState<CalLayout>("month");
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [scheduleBlockOpen, setScheduleBlockOpen] = useState(false);
  const [cleanerOpen, setCleanerOpen] = useState(false);
  const [eventEditTarget, setEventEditTarget] = useState<SbEvent | null>(null);
  const [familyConsoleOpen, setFamilyConsoleOpen] = useState(false);
  const [coverageModalOpen, setCoverageModalOpen] = useState(false);
  const [coverageRequestsOpen, setCoverageRequestsOpen] = useState(false);
  const [improvementsOpen, setImprovementsOpen] = useState(false);
  const [childcareOpen, setChildcareOpen] = useState(false);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [newRequestPrefill, setNewRequestPrefill] = useState<{
    date?: string;
    startTime?: string;
    endTime?: string;
    notes?: string;
  } | null>(null);
  const [chatManagerOpen, setChatManagerOpen] = useState(false);
  const [askClaudeOpen, setAskClaudeOpen] = useState(false);
  // The day nucleusAI was opened about (Ask on a popover); null = no day.
  const [askContext, setAskContext] = useState<AskContext | null>(null);
  const openAsk = (context: AskContext | null = null) => {
    setAskContext(context);
    setAskClaudeOpen(true);
  };

  // ⌘K opens nucleusAI — the shortcut the panel advertises in its footer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openAsk();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [shiftDetail, setShiftDetail] = useState<{ date: string; shift: Shift; anchor?: DOMRect | null } | null>(null);
  const [dayDetail, setDayDetail] = useState<{ date: string; anchor?: DOMRect | null } | null>(null);
  // A popover points at a day cell; once the month moves (a swipe, the arrows)
  // that cell is gone, so close it rather than leave it pointing at nothing.
  const [flagEditor, setFlagEditor] = useState<{ date: string; anchor?: DOMRect | null } | null>(null);
  useEffect(() => {
    setDayDetail(null);
    setShiftDetail(null);
    setFlagEditor(null);
  }, [viewYear, viewMonth]);
  /** Overrides New Shift's default date when it is opened from a day popover. */
  const [newShiftDate, setNewShiftDate] = useState<string | null>(null);

  const t = themeTokens(dark);

  useEffect(() => {
    document.body.style.background = t.bg;
    document.body.style.color = t.text;
  }, [t]);

  // Wire the macOS App menu's "Settings…" item (Cmd+,) to the API-key modal.
  useEffect(() => {
    const unsub = window.sbm?.onMenuOpenApiKey(() => setApiKeyOpen(true));
    return () => { unsub?.(); };
  }, []);

  // File → New Event… (Cmd+E).
  useEffect(() => {
    const unsub = window.sbm?.onMenuNewEvent(() => {
      setEventEditTarget(null);
      setEventModalOpen(true);
    });
    return () => { unsub?.(); };
  }, []);

  // File → New Shift… (Cmd+N).
  useEffect(() => {
    const unsub = window.sbm?.onMenuNewShift(() => setNewShiftOpen(true));
    return () => { unsub?.(); };
  }, []);

  // File → Edit Shift Types… (Cmd+Shift+T).
  useEffect(() => {
    const unsub = window.sbm?.onMenuEditShiftTypes(() => setShiftTypesOpen(true));
    return () => { unsub?.(); };
  }, []);

  // File → Edit Weekly Template… (Cmd+Shift+W).
  useEffect(() => {
    const unsub = window.sbm?.onMenuEditTemplate(() => setTemplateOpen(true));
    return () => { unsub?.(); };
  }, []);

  // View → Childcare Matrix (Cmd+Shift+C).
  useEffect(() => {
    const unsub = window.sbm?.onMenuOpenCoverageRequests(() => setCoverageRequestsOpen(true));
    return () => { unsub?.(); };
  }, []);

  // Tools → Schedule Block (Cmd+Shift+B) and Cleaner. These utilities moved off
  // the Inspector rail into the native menu bar.
  useEffect(() => {
    const unsub = window.sbm?.onMenuOpenScheduleBlock(() => setScheduleBlockOpen(true));
    return () => { unsub?.(); };
  }, []);
  useEffect(() => {
    const unsub = window.sbm?.onMenuOpenCleaner(() => setCleanerOpen(true));
    return () => { unsub?.(); };
  }, []);

  // Live state if available, otherwise demo data (so we never render an empty
  // calendar — useful for first-run before a household has any shifts saved).
  // Normalized so custom template slots resolve to synthetic shift types every
  // renderer can look up by id; the synthetic types never persist (writes read
  // raw from Firestore) and are filtered out of the type-picker lists.
  const rawState: HouseholdState | null =
    householdStatus.status === "ready" ? householdStatus.state : null;
  const state: HouseholdState | null = rawState ? expandCustomTemplateTypes(rawState) : null;
  // Who's really in the household, for the screens first built for one family.
  const look = useMemo(
    () => lookOf(householdStatus.status === "ready" ? householdStatus.household : null, state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [householdStatus, rawState],
  );

  // A notice whenever the schedule changes — including changes someone else
  // made, which arrive here as a new snapshot.
  useScheduleChangeToasts(state, {
    goToDate: (iso) => {
      const [y, m] = iso.split("-").map(Number);
      setViewYear(y);
      setViewMonth((m || 1) - 1);
      setSelected(iso);
    },
    showCoverage: () => setViewFilter("coverage"),
  });


  const pendingCoverageCount = (state?.coverageRequests ?? []).filter((r) => r.status === "pending").length;

  const eventsByDate: EventMap = useMemo(() => {
    const out: EventMap = {};
    for (const e of state?.events ?? []) {
      (out[e.date] ??= []).push(e);
    }
    return out;
  }, [state?.events]);

  const shifts: ShiftMap = useMemo(() => {
    if (!state) return DEMO_SHIFTS;
    // Build a window slightly bigger than the visible month so the mini month's
    // prev/next month cells render correctly too.
    const from = fmtDate(viewYear, viewMonth - 1, 1);
    const lastOfNext = new Date(viewYear, viewMonth + 2, 0).getDate();
    const to = fmtDate(viewYear, viewMonth + 1, lastOfNext);
    return buildShiftMap(state, from, to);
  }, [state, viewYear, viewMonth]);

  // Kaylene's stretches (runs of consecutive days she works), for the fire
  // mark. Built two weeks wider than the shift window so a run crossing its
  // edge still counts every day ("3/4", not "1/2").
  const kStretches = useMemo(() => {
    if (!state) return stretchesFor(DEMO_SHIFTS, "K");
    const iso = (d: Date) => fmtDate(d.getFullYear(), d.getMonth(), d.getDate());
    const from = iso(new Date(viewYear, viewMonth - 1, 1 - 14));
    const to = iso(new Date(viewYear, viewMonth + 2, 14));
    return stretchesFor(buildShiftMap(state, from, to), "K");
  }, [state, viewYear, viewMonth]);

  // Counts shown next to the Views entries in the sidebar.
  // All / Both / Couple are scoped to the visible month; This week scans the
  // calendar week (Sun..Sat) containing today.
  const viewCounts = useMemo(() => {
    let all = 0;
    let both = 0;
    let couple = 0;
    let g = 0;
    let k = 0;
    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      const key = fmtDate(viewYear, viewMonth, d);
      const list = shifts[key];
      if (!list || list.length === 0) {
        couple++;
        continue;
      }
      all += list.length;
      const hasG = list.some((s) => s.who === "G");
      const hasK = list.some((s) => s.who === "K");
      if (hasG) g++;
      if (hasK) k++;
      if (hasG && hasK) both++;
      // Both parents off is couple time even when Daisy has class.
      if (!hasG && !hasK) couple++;
    }

    let week = 0;
    const today = new Date(tY, tM - 1, tD);
    const dow = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dow);
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const key = fmtDate(d.getFullYear(), d.getMonth(), d.getDate());
      week += (shifts[key] ?? []).length;
    }
    return { all, both, couple, week, g, k };
  }, [shifts, viewYear, viewMonth, tY, tM, tD]);

  const householdName = state?.householdName || "Your household";
  const selfName = state?.selfName ?? "Self";
  const partnerName = state?.partner?.name ?? "Partner";
  const memberCount = householdStatus.status === "ready" ? householdStatus.household.memberUids.length : 0;
  const syncStatus =
    householdStatus.status === "loading"
      ? "connecting"
      : householdStatus.status === "no-household"
        ? "no household"
        : "synced";

  const shiftSelectedBy = (deltaDays: number) => {
    const [y, m, d] = selected.split("-").map(Number);
    const next = new Date(y, m - 1, d + deltaDays);
    const ny = next.getFullYear();
    const nm = next.getMonth();
    const nd = next.getDate();
    setSelected(fmtDate(ny, nm, nd));
    setViewYear(ny);
    setViewMonth(nm);
  };

  const handlePrev = () => {
    switch (calLayout) {
      case "month":
        setViewMonth((m) => {
          if (m === 0) { setViewYear((y) => y - 1); return 11; }
          return m - 1;
        });
        break;
      case "year":
        setViewYear((y) => y - 1);
        break;
      case "week":
        shiftSelectedBy(-7);
        break;
      case "day":
        shiftSelectedBy(-1);
        break;
    }
  };
  const handleNext = () => {
    switch (calLayout) {
      case "month":
        setViewMonth((m) => {
          if (m === 11) { setViewYear((y) => y + 1); return 0; }
          return m + 1;
        });
        break;
      case "year":
        setViewYear((y) => y + 1);
        break;
      case "week":
        shiftSelectedBy(7);
        break;
      case "day":
        shiftSelectedBy(1);
        break;
    }
  };
  const handleToday = () => {
    setViewYear(tY);
    setViewMonth(tM - 1);
    setSelected(fmtDate(tY, tM - 1, tD));
  };
  const refreshTimer = useRef<number | undefined>(undefined);
  const handleRefresh = () => {
    // Bumping the nonce re-subscribes the Firestore listeners (fresh server
    // read). Re-subscribing fires near-instantly, so the orbit beside the
    // lockup stays up for 3s, long enough to be seen turning; a second tap
    // restarts the 3s rather than cutting the first one short.
    setRefreshing(true);
    setRefreshNonce((n) => n + 1);
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => setRefreshing(false), 3000);
  };

  const householdId = householdStatus.status === "ready" ? householdStatus.household.id : null;
  // Day flags live in their own subcollection (see lib/dayFlags.ts).
  const [dayFlags, setDayFlags] = useState<Map<string, DayFlag>>(new Map());
  useEffect(() => {
    if (!householdId) { setDayFlags(new Map()); return; }
    return subscribeDayFlags(householdId, setDayFlags);
  }, [householdId]);
  // "Leave by" results from the checkCommutes function (lib/commute.ts).
  const [commute, setCommute] = useState<Map<string, CommuteResult>>(new Map());
  useEffect(() => {
    if (!householdId) { setCommute(new Map()); return; }
    return subscribeCommuteResults(householdId, today, setCommute);
  }, [householdId, today]);
  // The bell: notification history kept server-side (lib/notifications.ts),
  // the items meant for this member's role.
  const myRole = householdStatus.status === "ready" && user
    ? householdStatus.household.roles?.[user.uid] ?? "partner"
    : null;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  useEffect(() => {
    if (!householdId || !myRole) { setNotifications([]); return; }
    return subscribeNotifications(householdId, myRole, setNotifications);
  }, [householdId, myRole]);
  // When each day's childcare was confirmed, from the confirmation in the
  // notification history (the request itself carries no timestamp for it).
  // Newest first, so the first one seen per day is the latest confirmation.
  const careConfirmedAt = useMemo(() => {
    const out = new Map<string, number>();
    for (const n of notifications) {
      if (n.kind !== "status_confirmed" || !n.date || !n.createdAt || out.has(n.date)) continue;
      out.set(n.date, n.createdAt.toMillis());
    }
    return out;
  }, [notifications]);
  const inbox: InboxNotification[] = notifications.map((n) => ({
    id: n.id, kind: n.kind, title: n.title, body: n.body, date: n.date,
    unread: !!user && !n.readBy[user.uid],
    at: n.createdAt ? n.createdAt.toMillis() : null,
  }));

  const flagAuthorName =
    (householdStatus.status === "ready" && user ? householdStatus.household.memberNames?.[user.uid] : undefined)
    || state?.selfName || "Member";

  // What Ask on a popover tells nucleusAI: the day as the popover shows it.
  const nameOf = (who: Shift["who"]) =>
    who === "G" ? selfName : who === "K" ? partnerName : (state?.dependents?.daisy?.name || "Caregiver");
  const hoursOf = (s: Shift) => {
    const st = state?.shiftTypes.find((x) => x.id === s.shiftTypeId);
    return st ? `${compactTime(st.start)}–${compactTime(st.end)}` : s.label;
  };
  const dateOf = (iso: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
  };
  const longDate = (iso: string) => dateOf(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const shortDate = (iso: string) => dateOf(iso, { weekday: "short", month: "short", day: "numeric" });

  const dayAskContext = (date: string): AskContext => {
    const day = shifts[date] ?? [];
    const kind = dayKindFromShifts(day);
    const headline = kind === "off" ? "Both off" : kind === "both" ? "Both working" : kind === "g" ? `${selfName} works` : `${partnerName} works`;
    const parts: string[] = [];
    parts.push(day.length
      ? day.map((s) => `${nameOf(s.who)}: ${hoursOf(s)}${s.note ? ` (note: ${s.note})` : ""}.`).join(" ")
      : "Nobody has a shift.");
    const events = eventsByDate[date] ?? [];
    if (events.length) {
      parts.push(`Events: ${events.map((e) => `${e.title}${e.startTime ? ` at ${compactTime(e.startTime)}` : ""}`).join("; ")}.`);
    }
    const holiday = holidayOn(date);
    if (holiday) {
      const paid = [...new Set(day.filter((s) => s.who === "G" || s.who === "K").map((s) => nameOf(s.who)))];
      parts.push(`It's ${holiday.name}, a federal holiday${paid.length ? `; ${paid.join(" and ")} get${paid.length === 1 ? "s" : ""} holiday pay for working it` : ""}.`);
    }
    const flag = dayFlags.get(date);
    if (flag) parts.push(`The day is flagged${flag.remarks ? `: "${flag.remarks}"` : ""}.`);
    if (coverageNeeds.some((c) => c.date === date)) parts.push("Nobody has the kids for part of the day.");
    else if ((state?.coverageRequests ?? []).some((r) => r.date === date && r.status === "confirmed")) parts.push("Childcare is confirmed.");
    return {
      id: `day:${date}`,
      label: `${shortDate(date)} · ${headline}`,
      details: `(Context: this question is about ${longDate(date)}, ${date}. ${parts.join(" ")} Look the day up with summarize_period if you need more.)`,
    };
  };

  const shiftAskContext = (date: string, shift: Shift): AskContext => ({
    id: `shift:${date}:${shift.who}:${shift.shiftTypeId ?? shift.label}`,
    label: `${nameOf(shift.who)} · ${shortDate(date)}`,
    details: `(Context: this question is about ${nameOf(shift.who)}'s shift on ${longDate(date)}, ${date}: ${hoursOf(shift)}${shift.note ? `, note: ${shift.note}` : ""}. Look the day up with summarize_period if you need more.)`,
  });

  // "Send caregiver requests" is condition-driven, not calendar-driven: it
  // shows whenever upcoming both-working days have no coverage lined up, so
  // being LATE keeps it on screen instead of it vanishing with its Friday.
  // `today` is an explicit dependency so the count can't outlive the day it
  // was computed on — and so this and the modal always resolve the same date.
  const coverageNeeds = useMemo(() => pendingCoverageNeeds(state, today), [state, today]);
  const coverageNeedsSig = coverageNeedsSignature(coverageNeeds);
  // The Coverage view: every day in the loaded months that involves childcare
  // cover, and where it stands. Not coverageNeeds: that list is today-forward
  // and drops any day already asked about (it drives "Ask for more days"), so
  // the view went blank exactly where Daisy had been asked.
  //   - gaps the overlap engine finds (nobody home), unless the day is blocked;
  //   - every coverage request, which wins over the engine's window because
  //     it is what was actually asked. Worst state wins on a day with several.
  const coverageByDate = useMemo(() => {
    const out = new Map<string, CoverageMark>();
    if (!state) return out;
    const rank: Record<CoverageMark["kind"], number> = { has: 0, waiting: 1, nobody: 2 };
    const put = (date: string, mark: CoverageMark) => {
      const prev = out.get(date);
      if (!prev || rank[mark.kind] >= rank[prev.kind]) out.set(date, mark);
    };
    const st: HouseholdState = { ...state, template: state.template ?? [], overrides: state.overrides ?? [], ot: state.ot ?? [] };
    const requested = new Set((state.coverageRequests ?? []).map((r) => r.date));
    for (const c of computeOverlapCandidates(shifts, st)) {
      if (requested.has(c.date) || blockForDate(state.scheduleBlocks, c.date)) continue;
      put(c.date, { kind: "nobody", startTime: c.startTime, endTime: c.endTime, requested: false });
    }
    for (const r of state.coverageRequests ?? []) {
      const kind = r.status === "confirmed" ? "has" : r.status === "pending" ? "waiting" : "nobody";
      put(r.date, { kind, startTime: r.startTime, endTime: r.endTime, requested: true });
    }
    return out;
  }, [state, shifts]);
  const coverageDates = useMemo(() => new Set(coverageByDate.keys()), [coverageByDate]);

  // The "Update the schedule" card stays calendar-driven (4-week cadence).
  // See functions/src/index.ts::checkScheduleCadence.
  const scheduleReminder = useScheduleReminder(householdId, coverageNeedsSig, today);
  const allWvuGames = useWvuGames();
  const wvuGames = householdStatus.status === "ready" && householdStatus.household.wvuFootball === false
    ? NO_WVU_GAMES : allWvuGames;

  const handleEditShift = (date: string, shift: Shift) => {
    // Daisy's cells are read-only (no source); editing is for Gage/Kaylene.
    if (shift.who === "D" || !shift.source || !shift.shiftTypeId) return;
    if (shift.source.kind === "template" || shift.source.kind === "alt-weekend") {
      // Edit recurring shift for one date → write an override for this date.
      setEditTarget({
        date,
        source: shift.source,
        initialShiftTypeId: shift.shiftTypeId,
        initialNote: shift.note ?? "",
        who: shift.who,
      });
      return;
    }
    setEditTarget({
      date,
      source: shift.source,
      initialShiftTypeId: shift.shiftTypeId,
      initialNote: shift.note ?? "",
      who: shift.who,
    });
  };

  const handleToggleChildcareOff = (date: string, off: boolean) => {
    if (!householdId) return;
    toggleChildcareOff(householdId, date, off).catch((e) => {
      window.alert(e instanceof Error ? e.message : "Couldn't update childcare.");
    });
  };

  const handleDeleteShift = async (date: string, shift: Shift) => {
    if (!householdId || !shift.source) return;
    const recurring = shift.source.kind === "template" || shift.source.kind === "alt-weekend";
    const verb = recurring ? "Mark this date off" : "Delete this shift";
    const ok = window.confirm(`${verb}?`);
    if (!ok) return;
    try {
      await deleteShift(householdId, date, shift.source);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't update the shift.");
    }
  };

  if (settingUp) {
    return <SetupWizard dark={dark} onCancel={() => setSettingUp(false)} onDone={() => setSettingUp(false)} />;
  }
  if (householdStatus.status === "no-household") {
    return <JoinHousehold dark={dark} onCreate={() => setSettingUp(true)} />;
  }

  return (
    <HouseholdLookContext.Provider value={look}>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: t.bg,
        color: t.text,
      }}
    >
      <TopBar />
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "240px 1fr 320px" }}>
      <Sidebar
        palette={palette}
        t={t}
        dark={dark}
        shifts={shifts}
        viewYear={viewYear}
        viewMonth={viewMonth}
        selected={selected}
        onSelectDate={setSelected}
        householdName={householdName}
        memberCount={memberCount}
        syncStatus={syncStatus}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onOpenImprovements={() => setImprovementsOpen(true)}
        onOpenFamilyConsole={() => setFamilyConsoleOpen(true)}
        onSendCoverage={() => setCoverageModalOpen(true)}
        onOpenCoverageRequests={() => setCoverageRequestsOpen(true)}
        onOpenChildcare={() => setChildcareOpen(true)}
        pendingCoverageCount={pendingCoverageCount}
        viewFilter={viewFilter}
        viewCounts={viewCounts}
        onSetViewFilter={setViewFilter}
        onOpenScheduleImport={(id) => setImportScheduleId(id)}
        onEditSchedule={(id) => {
          const def = findScheduleImport(id);
          setTemplatePerson(def?.target === "partner" ? "K" : def?.target === "dependent-daisy" ? "daisy" : "G");
          setTemplateOpen(true);
        }}
        onToggleThisWeek={() => {
          if (viewFilter === "this-week") {
            setViewFilter("all");
            return;
          }
          // Filter to this-week AND jump the calendar to today so the
          // highlighted week is in view.
          setViewFilter("this-week");
          setViewYear(tY);
          setViewMonth(tM - 1);
          setSelected(fmtDate(tY, tM - 1, tD));
        }}
      />
      <MonthGrid
        palette={palette}
        t={t}
        dark={dark}
        flat={FLAT}
        shifts={shifts}
        state={state}
        viewYear={viewYear}
        viewMonth={viewMonth}
        selected={selected}
        today={today}
        selfName={selfName}
        partnerName={partnerName}
        stretches={kStretches}
        careConfirmedAt={careConfirmedAt}
        onSelectDate={setSelected}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onNewShift={() => setNewShiftOpen(true)}
        viewFilter={viewFilter}
        coverageDates={coverageDates}
        coverageMarks={coverageByDate}
        onOpenShiftDetail={(date, s, anchor) => { setDayDetail(null); setShiftDetail({ date, shift: s, anchor }); }}
        onOpenDayDetail={(date, anchor) => { setShiftDetail(null); setDayDetail({ date, anchor }); }}
        calLayout={calLayout}
        onSetCalLayout={setCalLayout}
        eventsByDate={eventsByDate}
        onEditEvent={(ev) => { setEventEditTarget(ev); setEventModalOpen(true); }}
        onOpenAskClaude={() => openAsk()}
        wvuGames={wvuGames}
        toolbarEnd={
          <NotificationInboxPopover
            notifications={inbox}
            onMarkRead={(id) => { if (householdId && user) markNotificationRead(householdId, id, user.uid).catch(() => {}); }}
            onMarkAllRead={() => {
              if (!householdId || !user) return;
              markAllNotificationsRead(householdId, inbox.filter((n) => n.unread).map((n) => n.id), user.uid).catch(() => {});
            }}
            onOpen={(n) => {
              if (!n.date) return;
              const [y, m] = n.date.split("-").map(Number);
              setViewYear(y);
              setViewMonth((m || 1) - 1);
              setSelected(n.date);
            }}
          />
        }
        dayFlags={dayFlags}
        onFlagDay={(date, anchor) => { setDayDetail(null); setShiftDetail(null); setFlagEditor({ date, anchor }); }}
      />
      <Inspector
        selected={selected}
        wvuGames={wvuGames}
        palette={palette}
        t={t}
        dark={dark}
        shifts={shifts}
        state={state}
        selfName={selfName}
        partnerName={partnerName}
        stretches={kStretches}
        commute={commute}
        onEditShift={handleEditShift}
        onDeleteShift={handleDeleteShift}
        onOpenShiftDetail={(date, s, anchor) => setShiftDetail({ date, shift: s, anchor })}
        events={eventsByDate[selected] ?? []}
        eventsByDate={eventsByDate}
        onAddEvent={() => { setEventEditTarget(null); setEventModalOpen(true); }}
        onEditEvent={(ev) => { setEventEditTarget(ev); setEventModalOpen(true); }}
        onSendCoverageForDay={(date) => {
          setNewRequestPrefill({ date });
          setNewRequestOpen(true);
        }}
        onToggleChildcareOff={handleToggleChildcareOff}
        onSelectDate={(iso) => setSelected(iso)}
        onOpenScheduleBlock={() => setScheduleBlockOpen(true)}
        onOpenCleaner={() => setCleanerOpen(true)}
        reminderUpdate={scheduleReminder.showUpdate}
        reminderCaregiver={scheduleReminder.showCaregiver}
        coverageNeedsCount={new Set(coverageNeeds.map((c) => c.date)).size}
        onDismissReminder={scheduleReminder.dismiss}
        onSendCaregiverRequests={() => setCoverageModalOpen(true)}
        onAsk={() => openAsk()}
      />
      </div>{/* /column grid */}
      <ModalPresence open={scheduleBlockOpen}>
        <ScheduleBlockModal
          open={scheduleBlockOpen}
          onClose={() => setScheduleBlockOpen(false)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
          defaultDate={selected}
        />
      </ModalPresence>
      <ModalPresence open={cleanerOpen}>
        <CleanerModal
          open={cleanerOpen}
          onClose={() => setCleanerOpen(false)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
          selfName={selfName}
          partnerName={partnerName}
        />
      </ModalPresence>
      <ModalPresence open={newShiftOpen}>
        <NewShiftModal
          open={newShiftOpen}
          onClose={() => { setNewShiftOpen(false); setNewShiftDate(null); }}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
          defaultDate={newShiftDate ?? selected}
        />
      </ModalPresence>
      <ModalPresence open={templateOpen}>
        <TemplateEditor
          open={templateOpen}
          initialPerson={templatePerson}
          onClose={() => setTemplateOpen(false)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
        />
      </ModalPresence>
      <ModalPresence open={!!editTarget}>
        <EditShiftModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
        />
      </ModalPresence>
      <ModalPresence open={shiftTypesOpen}>
        <ShiftTypesEditor
          open={shiftTypesOpen}
          onClose={() => setShiftTypesOpen(false)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
        />
      </ModalPresence>
      <ModalPresence open={!!importScheduleId}>
        <ScheduleImportModal
          scheduleId={importScheduleId}
          onClose={() => setImportScheduleId(null)}
          onNeedApiKey={() => setApiKeyOpen(true)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
          today={today}
          contextMonth={`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`}
        />
      </ModalPresence>
      <ModalPresence open={apiKeyOpen}>
        <ApiKeySettings
          open={apiKeyOpen}
          onClose={() => setApiKeyOpen(false)}
          palette={palette}
          t={t}
        />
      </ModalPresence>
      <ModalPresence open={eventModalOpen}>
        <EventModal
          open={eventModalOpen}
          onClose={() => setEventModalOpen(false)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
          defaultDate={selected}
          editing={eventEditTarget}
        />
      </ModalPresence>
      <ModalPresence open={familyConsoleOpen}>
        <FamilyConsole
          open={familyConsoleOpen}
          onClose={() => setFamilyConsoleOpen(false)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          household={householdStatus.status === "ready" ? householdStatus.household : null}
          state={state}
          themePref={themePref}
          onSetThemePref={onSetThemePref}
          onOpenChatManager={() => { setFamilyConsoleOpen(false); setChatManagerOpen(true); }}
        />
      </ModalPresence>
      <ModalPresence open={coverageModalOpen}>
        <CoverageRequestModal
          open={coverageModalOpen}
          onClose={() => setCoverageModalOpen(false)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
          today={today}
        />
      </ModalPresence>
      <ModalPresence open={coverageRequestsOpen}>
        <CoverageRequestsPanel
          open={coverageRequestsOpen}
          onClose={() => setCoverageRequestsOpen(false)}
          onAskForMore={() => setCoverageModalOpen(true)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
        />
      </ModalPresence>
      <ModalPresence open={improvementsOpen}>
        <ImprovementsModal
          open={improvementsOpen}
          onClose={() => setImprovementsOpen(false)}
          t={t}
          dark={dark}
        />
      </ModalPresence>
      <ModalPresence open={childcareOpen}>
        <ChildcarePanel
          open={childcareOpen}
          onClose={() => setChildcareOpen(false)}
          palette={palette}
          t={t}
          dark={dark}
          householdId={householdId}
          state={state}
          onSendBatch={() => setCoverageModalOpen(true)}
          onSendSingle={() => setNewRequestOpen(true)}
        />
      </ModalPresence>
      <ChatManagerPanel
        open={chatManagerOpen}
        onClose={() => setChatManagerOpen(false)}
        palette={palette}
        t={t}
        dark={dark}
        householdId={householdId}
        household={householdStatus.status === "ready" ? householdStatus.household : null}
      />
      <ModalPresence open={askClaudeOpen}>
        <AskClaudePanel
          context={askContext}
          open={askClaudeOpen}
          onClose={() => setAskClaudeOpen(false)}
          palette={palette}
          t={t}
          dark={dark}
        />
      </ModalPresence>
      <ModalPresence open={newRequestOpen}>
        <NewRequestModal
          open={newRequestOpen}
          onClose={() => { setNewRequestOpen(false); setNewRequestPrefill(null); }}
          palette={palette}
          t={t}
          householdId={householdId}
          defaultDate={selected}
          prefill={newRequestPrefill}
        />
      </ModalPresence>
      <ModalPresence open={!!dayDetail}>
        {dayDetail && (
          <DayDetailPopover
            onClose={() => setDayDetail(null)}
            date={dayDetail.date}
            dayShifts={shifts[dayDetail.date] ?? []}
            events={eventsByDate[dayDetail.date] ?? []}
            anchor={dayDetail.anchor}
            t={t}
            palette={palette}
            dark={dark}
            state={state}
            selfName={selfName}
            partnerName={partnerName}
            isCoverageGap={coverageNeeds.some((c) => c.date === dayDetail.date)}
            careConfirmed={
              (state?.coverageRequests ?? []).some((r) => r.date === dayDetail.date && r.status === "confirmed")
              && !(state?.childcareOff ?? []).some((c) => c.date === dayDetail.date)
            }
            wvuGame={wvuGames.get(dayDetail.date)}
          stretch={kStretches.get(dayDetail.date)}
            flag={dayFlags.get(dayDetail.date)}
            onFlag={() => { const d = dayDetail; setDayDetail(null); setFlagEditor({ date: d.date, anchor: d.anchor }); }}
            onOpenShift={(s, anchor) => { const d = dayDetail.date; setDayDetail(null); setShiftDetail({ date: d, shift: s, anchor }); }}
            onNewShift={() => { setNewShiftDate(dayDetail.date); setDayDetail(null); setNewShiftOpen(true); }}
            onAsk={() => { const d = dayDetail.date; setDayDetail(null); openAsk(dayAskContext(d)); }}
          />
        )}
      </ModalPresence>
      <ModalPresence open={!!flagEditor}>
        {flagEditor && (
          <DayFlagPopover
            key={flagEditor.date}
            date={flagEditor.date}
            anchor={flagEditor.anchor}
            flag={dayFlags.get(flagEditor.date)}
            householdId={householdId}
            authorName={flagAuthorName}
            t={t}
            dark={dark}
            onClose={() => setFlagEditor(null)}
          />
        )}
      </ModalPresence>
      {/* Transient notices, bottom-left beside the 240px sidebar. */}
      <ToastHost t={t} dark={dark} sidebarWidth={240} />

      <ModalPresence open={!!shiftDetail}>
        {shiftDetail && (
          <ShiftDetailPopover
            open
            onClose={() => setShiftDetail(null)}
            shift={shiftDetail.shift}
            date={shiftDetail.date}
            who={shiftDetail.shift.who}
            dayShifts={shifts[shiftDetail.date] ?? []}
            anchor={shiftDetail.anchor}
            t={t}
            palette={palette}
            dark={dark}
            state={state}
            events={eventsByDate[shiftDetail.date] ?? []}
            householdName={householdName}
            selfName={selfName}
            partnerName={partnerName}
            isCoverageGap={coverageNeeds.some((c) => c.date === shiftDetail.date)}
            onAsk={() => { const target = shiftDetail; setShiftDetail(null); openAsk(shiftAskContext(target.date, target.shift)); }}
            onEdit={() => { const target = shiftDetail; setShiftDetail(null); handleEditShift(target.date, target.shift); }}
            onHandOff={() => {
              const target = shiftDetail;
              setShiftDetail(null);
              setNewRequestPrefill({ date: target.date });
              setNewRequestOpen(true);
            }}
            onDelete={() => { const target = shiftDetail; setShiftDetail(null); void handleDeleteShift(target.date, target.shift); }}
          />
        )}
      </ModalPresence>
    </div>
    </HouseholdLookContext.Provider>
  );
}

function todayISO(): string {
  const d = new Date();
  return fmtDate(d.getFullYear(), d.getMonth(), d.getDate());
}
