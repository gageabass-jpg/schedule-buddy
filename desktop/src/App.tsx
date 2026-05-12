import { useEffect, useState } from "react";
import { getPalette, themeTokens, type PaletteName } from "./theme";
import { fmtDate } from "./data";
import { Sidebar } from "./components/Sidebar";
import { MonthGrid } from "./components/MonthGrid";
import { Inspector } from "./components/Inspector";

// Demo-mode anchors — match the design bundle's "today" so it visually lines up.
const DEMO_TODAY = "2026-04-09";
const PALETTE: PaletteName = "modern";
const DARK = true;
const FLAT = false;

export function App() {
  const [selected, setSelected] = useState<string>(DEMO_TODAY);
  const [viewYear, setViewYear] = useState<number>(2026);
  const [viewMonth, setViewMonth] = useState<number>(3); // April (0-indexed)

  const palette = getPalette(PALETTE);
  const t = themeTokens(DARK);

  useEffect(() => {
    document.body.style.background = t.bg;
    document.body.style.color = t.text;
  }, [t]);

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
    const [y, m, d] = DEMO_TODAY.split("-").map(Number);
    setViewYear(y);
    setViewMonth(m - 1);
    setSelected(fmtDate(y, m - 1, d));
  };

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
        viewYear={viewYear}
        viewMonth={viewMonth}
        selected={selected}
        onSelectDate={setSelected}
      />
      <MonthGrid
        palette={palette}
        t={t}
        dark={DARK}
        flat={FLAT}
        viewYear={viewYear}
        viewMonth={viewMonth}
        selected={selected}
        today={DEMO_TODAY}
        onSelectDate={setSelected}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
      />
      <Inspector selected={selected} palette={palette} t={t} dark={DARK} />
    </div>
  );
}
