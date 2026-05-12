import type { ReactNode } from "react";
import type { Palette, ThemeTokens } from "../theme";
import { BrandMark } from "./BrandMark";
import { MiniMonth } from "./MiniMonth";
import { PhotoAv } from "./PhotoAv";

interface SidebarProps {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  viewYear: number;
  viewMonth: number;
  selected: string;
  onSelectDate: (key: string) => void;
}

export function Sidebar({ palette, t, dark, viewYear, viewMonth, selected, onSelectDate }: SidebarProps) {
  return (
    <div
      style={{
        background: dark ? "rgba(28,28,30,0.6)" : "rgba(246,246,248,0.7)",
        borderRight: `0.5px solid ${t.sep}`,
        padding: "12px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px" }}>
        <BrandMark size={20} palette={palette} dark={dark} />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>Schedule Buddy</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: palette.G, letterSpacing: "-0.005em" }}>Manager</span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
          borderRadius: 6,
          background: dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.05)",
          fontSize: 12,
          color: t.text3,
        }}
      >
        <span>⌘K</span>
        <span style={{ flex: 1 }}>Quick add or search…</span>
      </div>

      <div style={{ padding: "0 4px" }}>
        <MiniMonth y={viewYear} mo={viewMonth} palette={palette} t={t} dark={dark} selected={selected} onSelect={onSelectDate} />
      </div>

      <SidebarSection label="Views" t={t}>
        <ListRow icon="📅" label="All shifts" count={42} active t={t} />
        <ListRow icon="◐" label="This week" count={5} t={t} />
        <ListRow icon="↻" label="Both working" count={9} t={t} />
        <ListRow icon="✺" label="Couple time" count={13} t={t} />
      </SidebarSection>

      <SidebarSection label="People" t={t}>
        <ListRow color={palette.G} label="Gage" count={28} t={t} />
        <ListRow color={palette.K} label="Kaylene" count={14} t={t} />
        <ListRow color={palette.BOTH} label="Overlap" count={6} t={t} />
      </SidebarSection>

      <SidebarSection label="Schedules" t={t}>
        <ListRow icon="◧" label="Spring rotation" t={t} />
        <ListRow icon="◧" label="MBU nights" t={t} />
      </SidebarSection>

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderRadius: 8,
          background: t.bgElev,
          border: `0.5px solid ${t.sep}`,
        }}
      >
        <div style={{ display: "flex" }}>
          <PhotoAv who="G" size={22} palette={palette} dark={dark} />
          <div style={{ marginLeft: -6 }}>
            <PhotoAv who="K" size={22} palette={palette} dark={dark} />
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: t.text }}>Bass household</div>
          <div style={{ fontSize: 10, color: t.text3 }}>2 members · synced</div>
        </div>
        <span style={{ color: t.text3, fontSize: 14 }}>⚙</span>
      </div>
    </div>
  );
}

function SidebarSection({ label, t, children }: { label: string; t: ThemeTokens; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px 4px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: t.text3, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {label}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

interface ListRowProps {
  icon?: string;
  label: string;
  count?: number;
  active?: boolean;
  color?: string;
  t: ThemeTokens;
}

function ListRow({ icon, label, count, active, color, t }: ListRowProps) {
  const lightSurface = t.bg === "#F2F2F7" || t.bg === "#ECECEE";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px",
        borderRadius: 6,
        background: active ? (lightSurface ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)") : "transparent",
        cursor: "pointer",
        fontSize: 13,
        color: t.text,
        fontWeight: 500,
        letterSpacing: "-0.01em",
      }}
    >
      {color ? (
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
      ) : (
        <span style={{ width: 16, display: "inline-flex", justifyContent: "center", color: t.text2 }}>{icon}</span>
      )}
      <span style={{ flex: 1 }}>{label}</span>
      {count != null && (
        <span style={{ fontSize: 11, color: t.text3, fontVariantNumeric: "tabular-nums" }}>{count}</span>
      )}
    </div>
  );
}
