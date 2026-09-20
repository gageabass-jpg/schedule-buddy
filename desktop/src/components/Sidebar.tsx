import type { ReactNode } from "react";
import type { ShiftMap } from "../data";
import type { ViewFilter } from "../App";
import type { HouseholdState } from "../state";
import { MANAGER_ORANGE, type Palette, type ThemeTokens } from "../theme";
import { MiniMonth } from "./MiniMonth";
import { PhotoAv } from "./PhotoAv";
import { LightBulb } from "./ImprovementsModal";
import { ShareButton } from "./ShareButton";
import { BrandMark, BRAND_FONT, BRAND_TEAL, BRAND_TEAL_LIGHT } from "./BrandMark";
import { SCHEDULE_IMPORTS } from "../scheduleImports";

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
  onRefresh: () => void;
  refreshing?: boolean;
  onOpenImprovements: () => void;
  viewFilter: ViewFilter;
  viewCounts: { all: number; both: number; couple: number; week: number; g: number; k: number };
  onSetViewFilter: (f: ViewFilter) => void;
  onToggleThisWeek: () => void;
  onOpenScheduleImport: (id: string) => void;
  onOpenFamilyConsole: () => void;
  onSendCoverage: () => void;
  onOpenChildcare: () => void;
  pendingCoverageCount: number;
  householdId: string | null;
  state: HouseholdState | null;
}

export function Sidebar({
  palette, t, dark, shifts, viewYear, viewMonth, selected, onSelectDate,
  householdName, memberCount, syncStatus, onRefresh, refreshing, onOpenImprovements,
  viewFilter, viewCounts, onSetViewFilter, onToggleThisWeek, onOpenScheduleImport,
  onOpenFamilyConsole, onSendCoverage, onOpenChildcare, pendingCoverageCount,
  householdId, state,
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
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        title="Refresh — re-sync schedule data"
        aria-label="Refresh schedule data"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "2px 6px",
          background: "transparent",
          border: 0,
          borderRadius: 8,
          cursor: refreshing ? "default" : "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          width: "100%",
        }}
      >
        {/* Nucleus Manager lockup: mark leading, "nucleus" 600 + "manager" 400.
            This is the one place the lockup appears; the mark alone carries
            every other surface. */}
        <BrandMark
          size={22}
          color={dark ? BRAND_TEAL_LIGHT : BRAND_TEAL}
          style={{
            flexShrink: 0,
            // Spin the mark once on refresh for visual feedback.
            animation: refreshing ? "sbmSpin 0.6s linear" : undefined,
          }}
        />
        <span style={{ fontSize: 15, lineHeight: 1, letterSpacing: "-0.02em", fontFamily: BRAND_FONT, whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 600, color: t.text }}>nucleus</span>
          <span style={{ fontWeight: 400, color: t.text2 }}> manager</span>
        </span>
      </button>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          // Slight inset so the scrollbar doesn't clip section labels
          marginRight: -4,
          paddingRight: 4,
        }}
      >
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
        <ListRow
          color={palette.G}
          label="Gage"
          count={viewCounts.g}
          active={viewFilter === "g"}
          onClick={() => onSetViewFilter(viewFilter === "g" ? "all" : "g")}
          t={t}
        />
        <ListRow
          color={palette.K}
          label="Kaylene"
          count={viewCounts.k}
          active={viewFilter === "k"}
          onClick={() => onSetViewFilter(viewFilter === "k" ? "all" : "k")}
          t={t}
        />
        <ListRow
          color={palette.BOTH}
          label="Overlap"
          count={viewCounts.both}
          active={viewFilter === "both"}
          onClick={() => onSetViewFilter(viewFilter === "both" ? "all" : "both")}
          onContextMenu={(e) => { e.preventDefault(); onSendCoverage(); }}
          title="Right-click to send coverage requests to caregiver"
          t={t}
        />
      </SidebarSection>

      <SidebarSection label="Schedules" t={t}>
        {SCHEDULE_IMPORTS.map((s) => (
          <ListRow
            key={s.id}
            icon="◧"
            label={s.label}
            onClick={() => onOpenScheduleImport(s.id)}
            t={t}
          />
        ))}
      </SidebarSection>

      <SidebarSection label="Care" t={t}>
        <ListRow
          icon="🧒"
          label="Childcare coverage"
          count={pendingCoverageCount > 0 ? pendingCoverageCount : undefined}
          onClick={onOpenChildcare}
          title="View all sent coverage requests and caregiver responses"
          t={t}
        />
      </SidebarSection>
      </div>{/* /scrollable middle */}

      {/* Bottom stack: Share row on top, then Family Console + idea bulb. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <ShareButton householdId={householdId} state={state} t={t} dark={dark} palette={palette} fullWidth />

      <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
        <button
          type="button"
          onClick={onOpenFamilyConsole}
          title="Open Family Console"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            borderRadius: 8,
            background: t.bgElev,
            border: `0.5px solid ${t.sep}`,
            cursor: "pointer",
            fontFamily: "inherit",
            textAlign: "left",
            flex: 1,
            minWidth: 0,
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
          <span style={{ color: t.text3, fontSize: 14 }}>›</span>
        </button>
        <button
          type="button"
          onClick={onOpenImprovements}
          title="Improvements — what can we do better?"
          aria-label="Suggest an improvement"
          style={{
            flexShrink: 0,
            width: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            background: t.bgElev,
            border: `0.5px solid ${t.sep}`,
            cursor: "pointer",
            color: t.text2,
            fontFamily: "inherit",
            transition: "opacity 0.15s ease",
          }}
        >
          <LightBulb size={17} color={MANAGER_ORANGE} />
        </button>
      </div>
      </div>{/* /bottom stack */}
    </div>
  );
}

// Inject the refresh-spin keyframes once.
if (typeof document !== "undefined" && !document.getElementById("sbm-spin-keyframes")) {
  const style = document.createElement("style");
  style.id = "sbm-spin-keyframes";
  style.textContent = "@keyframes sbmSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }";
  document.head.appendChild(style);
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
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
}

function ListRow({ icon, label, count, active, color, t, onClick, onContextMenu, title }: ListRowProps) {
  const lightSurface = t.bg === "#F2F2F7" || t.bg === "#ECECEE";
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
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
