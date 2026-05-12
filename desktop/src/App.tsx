import { useEffect, useMemo, useState } from "react";
import { getPalette, themeTokens, type PaletteName } from "./theme";
import { fmtDate, DEMO_SHIFTS, type ShiftMap, type Shift } from "./data";

export type ViewFilter = "all" | "this-week" | "both" | "couple" | "g" | "k";
export type CalLayout = "day" | "week" | "month" | "year";
import { useAuth, doSignOut } from "./hooks/useAuth";
import { useHousehold } from "./hooks/useHousehold";
import { buildShiftMap, type Event, type HouseholdState } from "./state";

export type EventMap = Record<string, Event[]>;
import { Sidebar } from "./components/Sidebar";
import { MonthGrid } from "./components/MonthGrid";
import { Inspector } from "./components/Inspector";
import { SignIn } from "./components/SignIn";
import { JoinHousehold } from "./components/JoinHousehold";
import { BrandMark } from "./components/BrandMark";
import { NewShiftModal } from "./components/NewShiftModal";
import { TemplateEditor } from "./components/TemplateEditor";
import { EditShiftModal, type EditShiftTarget } from "./components/EditShiftModal";
import { ShiftTypesEditor } from "./components/ShiftTypesEditor";
import { ScheduleImportModal } from "./components/ScheduleImportModal";
import { ApiKeySettings } from "./components/ApiKeySettings";
import { EventModal } from "./components/EventModal";
import { FamilyConsole } from "./components/FamilyConsole";
import type { Event as SbEvent } from "./state";
import { deleteShift } from "./lib/writeShift";

const PALETTE: PaletteName = "modern";
const DARK = true;
const FLAT = false;

export function App() {
  const auth = useAuth();

  if (auth.status === "loading") return <Splash message="Connecting…" />;
  if (auth.status === "signed-out") return <SignIn />;
  return <ManagerApp />;
}

function ManagerApp() {
  const auth = useAuth();
  const user = auth.status === "signed-in" ? auth.user : null;
  const householdStatus = useHousehold(user);

  const today = todayISO();
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
  const [eventEditTarget, setEventEditTarget] = useState<SbEvent | null>(null);
  const [familyConsoleOpen, setFamilyConsoleOpen] = useState(false);

  const palette = getPalette(PALETTE);
  const t = themeTokens(DARK);

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

  // Live state if available, otherwise demo data (so we never render an empty
  // calendar — useful for first-run before a household has any shifts saved).
  const state: HouseholdState | null =
    householdStatus.status === "ready" ? householdStatus.state : null;

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

  const householdId = householdStatus.status === "ready" ? householdStatus.household.id : null;

  const handleEditShift = (date: string, shift: Shift) => {
    if (!shift.source || !shift.shiftTypeId) return;
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
    return <JoinHousehold />;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px 1fr 320px",
        height: "100vh",
        background: t.bg,
        color: t.text,
      }}
    >
      <Sidebar
        palette={palette}
        t={t}
        dark={DARK}
        shifts={shifts}
        viewYear={viewYear}
        viewMonth={viewMonth}
        selected={selected}
        onSelectDate={setSelected}
        householdName={householdName}
        memberCount={memberCount}
        syncStatus={syncStatus}
        onOpenFamilyConsole={() => setFamilyConsoleOpen(true)}
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
        dark={DARK}
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
        onEditTemplate={() => setTemplateOpen(true)}
        onEditShiftTypes={() => setShiftTypesOpen(true)}
        viewFilter={viewFilter}
        calLayout={calLayout}
        onSetCalLayout={setCalLayout}
        eventsByDate={eventsByDate}
        onNewEvent={() => { setEventEditTarget(null); setEventModalOpen(true); }}
        onEditEvent={(ev) => { setEventEditTarget(ev); setEventModalOpen(true); }}
      />
      <Inspector
        selected={selected}
        palette={palette}
        t={t}
        dark={DARK}
        shifts={shifts}
        selfName={selfName}
        partnerName={partnerName}
        onEditShift={handleEditShift}
        onDeleteShift={handleDeleteShift}
        events={eventsByDate[selected] ?? []}
        onAddEvent={() => { setEventEditTarget(null); setEventModalOpen(true); }}
        onEditEvent={(ev) => { setEventEditTarget(ev); setEventModalOpen(true); }}
      />
      <NewShiftModal
        open={newShiftOpen}
        onClose={() => setNewShiftOpen(false)}
        palette={palette}
        t={t}
        dark={DARK}
        householdId={householdId}
        state={state}
        defaultDate={selected}
      />
      <TemplateEditor
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        palette={palette}
        t={t}
        dark={DARK}
        householdId={householdId}
        state={state}
      />
      <EditShiftModal
        target={editTarget}
        onClose={() => setEditTarget(null)}
        palette={palette}
        t={t}
        dark={DARK}
        householdId={householdId}
        state={state}
      />
      <ShiftTypesEditor
        open={shiftTypesOpen}
        onClose={() => setShiftTypesOpen(false)}
        palette={palette}
        t={t}
        dark={DARK}
        householdId={householdId}
        state={state}
      />
      <ScheduleImportModal
        scheduleId={importScheduleId}
        onClose={() => setImportScheduleId(null)}
        onNeedApiKey={() => setApiKeyOpen(true)}
        palette={palette}
        t={t}
        dark={DARK}
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
        dark={DARK}
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
        dark={DARK}
        householdId={householdId}
        household={householdStatus.status === "ready" ? householdStatus.household : null}
        state={state}
      />
    </div>
  );
}

function Splash({ title, message, showSignOut }: { title?: string; message: string; showSignOut?: boolean }) {
  const t = themeTokens(DARK);
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
      <BrandMark size={48} palette={palette} dark={DARK} />
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
