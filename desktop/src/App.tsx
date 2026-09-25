import { useEffect, useMemo, useState } from "react";
import { getPalette, themeTokens, type PaletteName } from "./theme";
import { fmtDate, DEMO_SHIFTS, type ShiftMap, type Shift } from "./data";

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
import { useAuth, doSignOut } from "./hooks/useAuth";
import { useHousehold } from "./hooks/useHousehold";
import { useScheduleReminder } from "./hooks/useScheduleReminder";
import { useWvuGames } from "./hooks/useWvuGames";
import { pendingCoverageNeeds, coverageNeedsSignature } from "./lib/pendingCoverageNeeds";
import { buildShiftMap, expandCustomTemplateTypes, type Event, type HouseholdState } from "./state";

export type EventMap = Record<string, Event[]>;
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { MonthGrid } from "./components/MonthGrid";
import { Inspector } from "./components/Inspector";
import { ScheduleBlockModal } from "./components/ScheduleBlockModal";
import { CleanerModal } from "./components/CleanerModal";
import { SignIn } from "./components/SignIn";
import { JoinHousehold } from "./components/JoinHousehold";
import { BrandMark, BRAND_TEAL, BRAND_TEAL_LIGHT } from "./components/BrandMark";
import { NewShiftModal } from "./components/NewShiftModal";
import { TemplateEditor } from "./components/TemplateEditor";
import { EditShiftModal, type EditShiftTarget } from "./components/EditShiftModal";
import { ShiftTypesEditor } from "./components/ShiftTypesEditor";
import { ScheduleImportModal } from "./components/ScheduleImportModal";
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
import type { Event as SbEvent, EventWho, CaregiverRequest } from "./state";
import { deleteShift } from "./lib/writeShift";
import { toggleChildcareOff } from "./lib/writeChildcareOff";

const PALETTE: PaletteName = "nucleus";
const FLAT = false;

export function App() {
  const [themePref, setThemePref] = useState<ThemePref>(readThemePref);
  const [dark, setDark] = useState<boolean>(() => resolveDark(readThemePref()));

  useEffect(() => {
    try { localStorage.setItem(THEME_PREF_KEY, themePref); } catch { /* ignore */ }
    setDark(resolveDark(themePref));
  }, [themePref]);

  // Track OS preference changes while the user is in "system" mode.
  useEffect(() => {
    if (themePref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [themePref]);

  const auth = useAuth();

  if (auth.status === "loading") return <Splash message="Connecting…" dark={dark} />;
  if (auth.status === "signed-out") return <SignIn dark={dark} />;
  return <ManagerApp dark={dark} themePref={themePref} onSetThemePref={setThemePref} />;
}

interface ManagerAppProps {
  dark: boolean;
  themePref: ThemePref;
  onSetThemePref: (pref: ThemePref) => void;
}

function ManagerApp({ dark, themePref, onSetThemePref }: ManagerAppProps) {
  const auth = useAuth();
  const user = auth.status === "signed-in" ? auth.user : null;
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const householdStatus = useHousehold(user, refreshNonce);

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

  // ⌘K opens nucleusAI — the shortcut the panel advertises in its footer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAskClaudeOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [shiftDetail, setShiftDetail] = useState<{ date: string; shift: Shift; anchor?: DOMRect | null } | null>(null);
  const [dayDetail, setDayDetail] = useState<{ date: string; anchor?: DOMRect | null } | null>(null);
  /** Overrides New Shift's default date when it is opened from a day popover. */
  const [newShiftDate, setNewShiftDate] = useState<string | null>(null);

  const palette = getPalette(PALETTE);
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

  // View → Coverage Requests (Cmd+Shift+C).
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

  const householdName = state?.householdName || "Bass Household";
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
  const handleRefresh = () => {
    // Bumping the nonce re-subscribes the Firestore listeners (fresh server
    // read). Re-subscribing fires near-instantly, so keep the spinner up for a
    // beat so the tap registers visually even when nothing changed.
    setRefreshing(true);
    setRefreshNonce((n) => n + 1);
    window.setTimeout(() => setRefreshing(false), 700);
  };

  const householdId = householdStatus.status === "ready" ? householdStatus.household.id : null;

  // "Send caregiver requests" is condition-driven, not calendar-driven: it
  // shows whenever upcoming both-working days have no coverage lined up, so
  // being LATE keeps it on screen instead of it vanishing with its Friday.
  // `today` is an explicit dependency so the count can't outlive the day it
  // was computed on — and so this and the modal always resolve the same date.
  const coverageNeeds = useMemo(() => pendingCoverageNeeds(state, today), [state, today]);
  const coverageNeedsSig = coverageNeedsSignature(coverageNeeds);
  const coverageDates = useMemo(() => new Set(coverageNeeds.map((c) => c.date)), [coverageNeeds]);

  // The "Update the schedule" card stays calendar-driven (4-week cadence).
  // See functions/src/index.ts::checkScheduleCadence.
  const scheduleReminder = useScheduleReminder(householdId, coverageNeedsSig, today);
  const wvuGames = useWvuGames();

  const handleEditShift = (date: string, shift: Shift) => {
    // Daisy's cells are read-only (no source); editing is for Gage/Kaylene.
    if (shift.who === "D" || !shift.source || !shift.shiftTypeId) return;
    if (shift.source.kind === "template" || shift.source.kind === "alt-weekend") {
      // Edit recurring shift for one date → write an override for this date.
      setEditTarget({
        date,
        source: shift.source,
        initialShiftTypeId: shift.shiftTypeId,
        initialLabel: "",
        who: shift.who,
      });
      return;
    }
    setEditTarget({
      date,
      source: shift.source,
      initialShiftTypeId: shift.shiftTypeId,
      initialLabel: "",
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

  if (householdStatus.status === "no-household") {
    return <JoinHousehold dark={dark} />;
  }

  return (
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
        onOpenChildcare={() => setChildcareOpen(true)}
        pendingCoverageCount={pendingCoverageCount}
        viewFilter={viewFilter}
        viewCounts={viewCounts}
        onSetViewFilter={setViewFilter}
        onOpenScheduleImport={(id) => setImportScheduleId(id)}
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
        onSelectDate={setSelected}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onNewShift={() => setNewShiftOpen(true)}
        viewFilter={viewFilter}
        coverageDates={coverageDates}
        onOpenShiftDetail={(date, s, anchor) => { setDayDetail(null); setShiftDetail({ date, shift: s, anchor }); }}
        onOpenDayDetail={(date, anchor) => { setShiftDetail(null); setDayDetail({ date, anchor }); }}
        calLayout={calLayout}
        onSetCalLayout={setCalLayout}
        eventsByDate={eventsByDate}
        onEditEvent={(ev) => { setEventEditTarget(ev); setEventModalOpen(true); }}
        onOpenAskClaude={() => setAskClaudeOpen(true)}
        onOpenChatManager={() => setChatManagerOpen(true)}
        wvuGames={wvuGames}
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
        onAsk={() => setAskClaudeOpen(true)}
      />
      </div>{/* /column grid */}
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
      <TemplateEditor
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        palette={palette}
        t={t}
        dark={dark}
        householdId={householdId}
        state={state}
      />
      <EditShiftModal
        target={editTarget}
        onClose={() => setEditTarget(null)}
        palette={palette}
        t={t}
        dark={dark}
        householdId={householdId}
        state={state}
      />
      <ShiftTypesEditor
        open={shiftTypesOpen}
        onClose={() => setShiftTypesOpen(false)}
        palette={palette}
        t={t}
        dark={dark}
        householdId={householdId}
        state={state}
      />
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
      <ApiKeySettings
        open={apiKeyOpen}
        onClose={() => setApiKeyOpen(false)}
        palette={palette}
        t={t}
      />
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
      />
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
      <CoverageRequestsPanel
        open={coverageRequestsOpen}
        onClose={() => setCoverageRequestsOpen(false)}
        palette={palette}
        t={t}
        dark={dark}
        householdId={householdId}
        state={state}
      />
      <ImprovementsModal
        open={improvementsOpen}
        onClose={() => setImprovementsOpen(false)}
        t={t}
        dark={dark}
      />
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
      <ChatManagerPanel
        open={chatManagerOpen}
        onClose={() => setChatManagerOpen(false)}
        palette={palette}
        t={t}
        dark={dark}
        householdId={householdId}
        household={householdStatus.status === "ready" ? householdStatus.household : null}
      />
      <AskClaudePanel
        open={askClaudeOpen}
        onClose={() => setAskClaudeOpen(false)}
        palette={palette}
        t={t}
        dark={dark}
      />
      <NewRequestModal
        open={newRequestOpen}
        onClose={() => { setNewRequestOpen(false); setNewRequestPrefill(null); }}
        palette={palette}
        t={t}
        householdId={householdId}
        defaultDate={selected}
        prefill={newRequestPrefill}
      />
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
          wvuGame={wvuGames.get(dayDetail.date)}
          onOpenShift={(s, anchor) => { const d = dayDetail.date; setDayDetail(null); setShiftDetail({ date: d, shift: s, anchor }); }}
          onNewShift={() => { setNewShiftDate(dayDetail.date); setDayDetail(null); setNewShiftOpen(true); }}
          onAsk={() => { setDayDetail(null); setAskClaudeOpen(true); }}
        />
      )}
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
          onAsk={() => setAskClaudeOpen(true)}
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
    </div>
  );
}

function Splash({ title, message, showSignOut, dark = true }: { title?: string; message: string; showSignOut?: boolean; dark?: boolean }) {
  const t = themeTokens(dark);
  const palette = getPalette(PALETTE);
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: t.bg,
        color: t.text,
        padding: 24,
        gap: 14,
        textAlign: "center",
      }}
    >
      <BrandMark size={48} color={dark ? BRAND_TEAL_LIGHT : BRAND_TEAL} />
      {title && <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</div>}
      <div style={{ fontSize: 13, color: t.text2, maxWidth: 380, lineHeight: 1.5 }}>{message}</div>
      {showSignOut && (
        <button
          type="button"
          onClick={() => { void doSignOut(); }}
          style={{
            marginTop: 6,
            padding: "7px 14px",
            border: `0.5px solid ${t.sep}`,
            borderRadius: 8,
            background: t.bgElev,
            color: t.text,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Sign out
        </button>
      )}
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  return fmtDate(d.getFullYear(), d.getMonth(), d.getDate());
}
