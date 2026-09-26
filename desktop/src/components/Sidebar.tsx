import type { ReactNode } from "react";
import type { ShiftMap } from "../data";
import type { ViewFilter } from "../App";
import type { Palette, ThemeTokens } from "../theme";
import { MiniMonth } from "./MiniMonth";
import { PhotoAv } from "./PhotoAv";
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
  /** Right-click (two-finger click) a schedule row to edit that person's week. */
  onEditSchedule: (id: string) => void;
  onOpenFamilyConsole: () => void;
  onSendCoverage: () => void;
  onOpenCoverageRequests: () => void;
  onOpenChildcare: () => void;
  pendingCoverageCount: number;
}

export function Sidebar({
  palette, t, dark, shifts, viewYear, viewMonth, selected, onSelectDate,
  householdName, memberCount, syncStatus, onRefresh, refreshing, onOpenImprovements: _onOpenImprovements,
  viewFilter, viewCounts, onSetViewFilter, onToggleThisWeek, onOpenScheduleImport, onEditSchedule,
  onOpenFamilyConsole, onSendCoverage, onOpenCoverageRequests, onOpenChildcare: _onOpenChildcare, pendingCoverageCount,
}: SidebarProps) {
  return (
    <div
      style={{
        background: dark ? "rgba(28,28,30,0.6)" : "rgba(246,246,248,0.7)",
        borderRight: `0.5px solid ${t.sep}`,
        // Top pad matches the calendar toolbar so the wordmark lines up with
        // the "September 2026" title (both below the teal titlebar).
        padding: "16px 10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Nucleus Manager lockup: mark leading, "nucleus" 600 + "manager" 400.
          This is the one place the lockup appears; clicking it re-syncs. */}
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
          height: 32,
          padding: "0 6px",
          background: "transparent",
          border: 0,
          borderRadius: 8,
          cursor: refreshing ? "default" : "pointer",
          fontFamily: "inherit",
          textAlign: "left",
          width: "100%",
        }}
      >
        <BrandMark
          size={22}
          color={dark ? BRAND_TEAL_LIGHT : BRAND_TEAL}
          style={{ flexShrink: 0, animation: refreshing ? "sbmSpin 0.6s linear" : undefined }}
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
          label="All shifts"
          count={viewCounts.all}
          active={viewFilter === "all"}
          onClick={() => onSetViewFilter("all")}
          t={t}
        />
        <ListRow
          label="This week"
          count={viewCounts.week}
          active={viewFilter === "this-week"}
          onClick={onToggleThisWeek}
          t={t}
        />
        <ListRow
          label="Both working"
          count={viewCounts.both}
          active={viewFilter === "both"}
          onClick={() => onSetViewFilter(viewFilter === "both" ? "all" : "both")}
          t={t}
        />
        <ListRow
          label="Couple time"
          count={viewCounts.couple}
          active={viewFilter === "couple"}
          onClick={() => onSetViewFilter(viewFilter === "couple" ? "all" : "couple")}
          t={t}
        />
        <ListRow
          label="Coverage"
          count={pendingCoverageCount > 0 ? pendingCoverageCount : undefined}
          active={viewFilter === "coverage"}
          onClick={() => onSetViewFilter(viewFilter === "coverage" ? "all" : "coverage")}
          onContextMenu={(e) => { e.preventDefault(); onOpenCoverageRequests(); }}
          title="Right-click to see the coverage requests list"
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
            label={s.label}
            tag={s.target === "dependent-daisy" ? "SCHOOL" : "WORK"}
            onClick={() => onOpenScheduleImport(s.id)}
            onContextMenu={(e) => { e.preventDefault(); onEditSchedule(s.id); }}
            title={`Click to import ${s.personLabel}'s schedule · right-click to edit their week`}
            t={t}
          />
        ))}
      </SidebarSection>

      </div>{/* /scrollable middle */}

      {/* Household → Console. Hovering sweeps the card in Teal from the
          bottom-left, the same sweep the calendar's shift chips use, and swaps
          the household for "Console"; clicking opens it. */}
      <div>
        <button
          type="button"
          onClick={onOpenFamilyConsole}
          title="Open the console"
          aria-label="Open the console"
          className="group relative overflow-hidden"
          style={{
            width: "100%",
            height: 46,
            padding: "6px 8px",
            borderRadius: 8,
            background: t.bgElev,
            border: `1px solid ${t.sep}`,
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            alignItems: "center",
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 size-[22rem] -translate-x-full translate-y-full rotate-[-40deg] rounded mb-6 ml-6 transition-all duration-500 ease-out group-hover:mb-[9rem] group-hover:ml-0 group-hover:translate-x-0 motion-reduce:transition-none"
            style={{ background: BRAND_TEAL }}
          />
          {/* Resting: the household. */}
          <span className="relative flex min-w-0 flex-1 items-center gap-2 transition-opacity duration-200 group-hover:opacity-0">
            <span style={{ display: "flex" }}>
              <PhotoAv who="G" size={22} palette={palette} dark={dark} />
              <span style={{ marginLeft: -6 }}>
                <PhotoAv who="K" size={22} palette={palette} dark={dark} />
              </span>
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{householdName}</span>
              <span style={{ display: "block", fontSize: 10, color: t.text3 }}>{memberCount} members · {syncStatus}</span>
            </span>
            <span style={{ color: t.text3, fontSize: 14 }}>›</span>
          </span>
          {/* Hovered: "Console". */}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-white opacity-0 transition-opacity delay-150 duration-200 group-hover:opacity-100">
            <BrandMark size={16} color="#FFFFFF" />
            <span style={{ fontFamily: BRAND_FONT, fontWeight: 600, fontSize: 14, letterSpacing: "-0.01em" }}>Console</span>
          </span>
        </button>
      </div>
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
  icon?: React.ReactNode;
  label: string;
  count?: number;
  /** Small caps chip on the right (e.g. WORK / SCHOOL). */
  tag?: string;
  active?: boolean;
  color?: string;
  t: ThemeTokens;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
}

function ListRow({ icon, label, count, tag, active, color, t, onClick, onContextMenu, title }: ListRowProps) {
  const lightSurface = t.bg === "#F7F6F3" || t.bg === "#F2F2F7" || t.bg === "#ECECEE";
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
        <span style={{ width: 3.5, height: 14, borderRadius: 2, background: color, flexShrink: 0 }} />
      ) : icon ? (
        <span style={{ width: 16, display: "inline-flex", justifyContent: "center", color: t.text2 }}>{icon}</span>
      ) : null}
      <span style={{ flex: 1 }}>{label}</span>
      {tag && (
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", color: t.text3, padding: "2px 6px", borderRadius: 4, background: t.bgElev2 }}>{tag}</span>
      )}
      {count != null && (
        <span style={{ fontSize: 11, color: t.text3, fontVariantNumeric: "tabular-nums" }}>{count}</span>
      )}
    </button>
  );
}
