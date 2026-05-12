import { useEffect, useMemo, useState } from "react";
import { getPalette, themeTokens, type PaletteName } from "./theme";
import { fmtDate, DEMO_SHIFTS, type ShiftMap } from "./data";
import { useAuth, doSignOut } from "./hooks/useAuth";
import { useHousehold } from "./hooks/useHousehold";
import { buildShiftMap, type HouseholdState } from "./state";
import { Sidebar } from "./components/Sidebar";
import { MonthGrid } from "./components/MonthGrid";
import { Inspector } from "./components/Inspector";
import { SignIn } from "./components/SignIn";
import { JoinHousehold } from "./components/JoinHousehold";
import { BrandMark } from "./components/BrandMark";
import { NewShiftModal } from "./components/NewShiftModal";
import { TemplateEditor } from "./components/TemplateEditor";

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

  const palette = getPalette(PALETTE);
  const t = themeTokens(DARK);

  useEffect(() => {
    document.body.style.background = t.bg;
    document.body.style.color = t.text;
  }, [t]);

  // Live state if available, otherwise demo data (so we never render an empty
  // calendar — useful for first-run before a household has any shifts saved).
  const state: HouseholdState | null =
    householdStatus.status === "ready" ? householdStatus.state : null;

  const shifts: ShiftMap = useMemo(() => {
    if (!state) return DEMO_SHIFTS;
    // Build a window slightly bigger than the visible month so the mini month's
    // prev/next month cells render correctly too.
    const from = fmtDate(viewYear, viewMonth - 1, 1);
    const lastOfNext = new Date(viewYear, viewMonth + 2, 0).getDate();
    const to = fmtDate(viewYear, viewMonth + 1, lastOfNext);
    return buildShiftMap(state, from, to);
  }, [state, viewYear, viewMonth]);

  const householdName = state ? `${state.selfName || "Bass"} household` : "Schedule Buddy";
  const selfName = state?.selfName ?? "Self";
  const partnerName = state?.partner?.name ?? "Partner";
  const memberCount = householdStatus.status === "ready" ? householdStatus.household.memberUids.length : 0;
  const syncStatus =
    householdStatus.status === "loading"
      ? "connecting"
      : householdStatus.status === "no-household"
        ? "no household"
        : "synced";

  const handlePrev = () => {
    setViewMonth((m) => {
      if (m === 0) { setViewYear((y) => y - 1); return 11; }
      return m - 1;
    });
  };
  const handleNext = () => {
    setViewMonth((m) => {
      if (m === 11) { setViewYear((y) => y + 1); return 0; }
      return m + 1;
    });
  };
  const handleToday = () => {
    setViewYear(tY);
    setViewMonth(tM - 1);
    setSelected(fmtDate(tY, tM - 1, tD));
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
        onSignOut={() => { void doSignOut(); }}
      />
      <MonthGrid
        palette={palette}
        t={t}
        dark={DARK}
        flat={FLAT}
        shifts={shifts}
        viewYear={viewYear}
        viewMonth={viewMonth}
        selected={selected}
        today={today}
        onSelectDate={setSelected}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onNewShift={() => setNewShiftOpen(true)}
        onEditTemplate={() => setTemplateOpen(true)}
      />
      <Inspector
        selected={selected}
        palette={palette}
        t={t}
        dark={DARK}
        shifts={shifts}
        selfName={selfName}
        partnerName={partnerName}
      />
      <NewShiftModal
        open={newShiftOpen}
        onClose={() => setNewShiftOpen(false)}
        palette={palette}
        t={t}
        dark={DARK}
        householdId={householdStatus.status === "ready" ? householdStatus.household.id : null}
        state={state}
        defaultDate={selected}
      />
      <TemplateEditor
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        palette={palette}
        t={t}
        dark={DARK}
        householdId={householdStatus.status === "ready" ? householdStatus.household.id : null}
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
