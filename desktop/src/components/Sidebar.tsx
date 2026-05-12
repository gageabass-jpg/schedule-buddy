import type { ReactNode } from "react";
import type { ShiftMap } from "../data";
import type { ViewFilter } from "../App";
import { MANAGER_ORANGE, type Palette, type ThemeTokens } from "../theme";
import { MiniMonth } from "./MiniMonth";
import { PhotoAv } from "./PhotoAv";

interface SidebarProps {
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  shifts: ShiftMap;
  viewYear: number;
  viewMonth: number;
  selected: string;
  onSelectDate: (key: string) => void;
  householdName: string;
  memberCount: number;
  syncStatus: string;
  onSignOut: () => void;
  viewFilter: ViewFilter;
  viewCounts: { all: number; both: number; couple: number; week: number };
  onSetViewFilter: (f: ViewFilter) => void;
  onToggleThisWeek: () => void;
}

export function Sidebar({
  palette, t, dark, shifts, viewYear, viewMonth, selected, onSelectDate,
  householdName, memberCount, syncStatus, onSignOut,
  viewFilter, viewCounts, onSetViewFilter, onToggleThisWeek,
}: SidebarProps) {
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
        position: "relative",
      }}
    >
      {/* Draggable strip behind the macOS traffic-light buttons.
          Pushes brand content below them and lets the user grab the
          window from this area. */}
      <div
        style={{
          height: 22,
          flexShrink: 0,
          ...({ WebkitAppRegion: "drag" } as React.CSSProperties),
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 6px" }}>
        <img
          src="icon.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          style={{ display: "block", borderRadius: 6, flexShrink: 0 }}
        />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>Schedule Buddy</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: MANAGER_ORANGE, letterSpacing: "-0.01em" }}>Manager</span>
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
        <MiniMonth y={viewYear} mo={viewMonth} palette={palette} t={t} dark={dark} shifts={shifts} selected={selected} onSelect={onSelectDate} />
      </div>

      <SidebarSection label="Views" t={t}>
        <ListRow
          icon="📅"
          label="All shifts"
          count={viewCounts.all}
          active={viewFilter === "all"}
          onClick={() => onSetViewFilter("all")}
          t={t}
        />
        <ListRow
          icon="◐"
          label="This week"
          count={viewCounts.week}
          active={viewFilter === "this-week"}
          onClick={onToggleThisWeek}
          t={t}
        />
        <ListRow
          icon="↻"
          label="Both working"
          count={viewCounts.both}
          active={viewFilter === "both"}
          onClick={() => onSetViewFilter(viewFilter === "both" ? "all" : "both")}
          t={t}
        />
        <ListRow
          icon="✺"
          label="Couple time"
          count={viewCounts.couple}
          active={viewFilter === "couple"}
          onClick={() => onSetViewFilter(viewFilter === "couple" ? "all" : "couple")}
          t={t}
        />
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
          <div style={{ fontSize: 11.5, fontWeight: 600, color: t.text }}>{householdName}</div>
          <div style={{ fontSize: 10, color: t.text3 }}>{memberCount} members · {syncStatus}</div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          title="Sign out"
          style={{
            border: 0,
            background: "transparent",
            color: t.text3,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            padding: "2px 4px",
            letterSpacing: "-0.01em",
          }}
        >
          ⎋
        </button>
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
  onClick?: () => void;
}

function ListRow({ icon, label, count, active, color, t, onClick }: ListRowProps) {
  const lightSurface = t.bg === "#F2F2F7" || t.bg === "#ECECEE";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px",
        borderRadius: 6,
        background: active ? (lightSurface ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)") : "transparent",
        cursor: onClick ? "pointer" : "default",
        fontSize: 13,
        color: t.text,
        fontWeight: 500,
        letterSpacing: "-0.01em",
        border: 0,
        fontFamily: "inherit",
        textAlign: "left",
        width: "100%",
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
    </button>
  );
}
