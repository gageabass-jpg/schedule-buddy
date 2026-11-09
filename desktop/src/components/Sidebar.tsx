import { useState, type ReactNode } from "react";
import { Pencil, Upload } from "lucide-react";
import type { ShiftMap } from "../data";
import type { ViewFilter } from "../App";
import type { Palette, ThemeTokens } from "../theme";
import { MiniMonth } from "./MiniMonth";
import { PhotoAv } from "./PhotoAv";
import { BrandMark, BRAND_FONT, BRAND_TEAL, BRAND_TEAL_LIGHT } from "./BrandMark";
import { TwinOrbit } from "./ui/twin-orbit";
import { SCHEDULE_IMPORTS, type ImportTarget } from "../scheduleImports";
import { useHouseholdLook } from "../lib/householdLook";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { EmailFoundMenu } from "./EmailFoundMenu";
import { ScheduleTasksCard } from "./ScheduleTasksCard";
import { ScheduleTasksEmpty } from "./ScheduleTasksEmpty";
import type { Event } from "../state";
import type { ScheduleTasks } from "../lib/scheduleTasks";

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
  viewCounts: { all: number; week: number; g: number; k: number };
  onSetViewFilter: (f: ViewFilter) => void;
  onToggleThisWeek: () => void;
  onOpenScheduleImport: (id: string) => void;
  /** Right-click (two-finger click) a schedule row to edit that person's week. */
  onEditSchedule: (id: string) => void;
  onOpenFamilyConsole: () => void;
  onOpenCoverageRequests: () => void;
  onOpenChildcare: () => void;
  pendingCoverageCount: number;
  householdId: string | null;
  /** The calendar's events, for matching what the email scans found. */
  events: ReadonlyArray<Event>;
  /** The end-of-period to-do list, or null for its empty state. */
  tasks: ScheduleTasks | null;
  /** Open the caregiver requests for the days that still need cover. */
  onReconcileGaps: () => void;
}

export function Sidebar({
  palette, t, dark, shifts, viewYear, viewMonth, selected, onSelectDate,
  householdName, memberCount, syncStatus, onRefresh, refreshing, onOpenImprovements: _onOpenImprovements,
  viewFilter, viewCounts, onSetViewFilter, onToggleThisWeek, onOpenScheduleImport, onEditSchedule,
  onOpenFamilyConsole, onOpenCoverageRequests, onOpenChildcare: _onOpenChildcare, pendingCoverageCount,
  householdId, events, tasks, onReconcileGaps,
}: SidebarProps) {
  const look = useHouseholdLook();
  return (
    <div
      className="glass-panel"
      style={{
        // Top pad matches the calendar toolbar so the wordmark lines up with
        // the "September 2026" title (both below the teal titlebar).
        padding: "14px 10px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
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
        <BrandMark size={22} color={dark ? BRAND_TEAL_LIGHT : BRAND_TEAL} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 15, lineHeight: 1, letterSpacing: "-0.02em", fontFamily: BRAND_FONT, whiteSpace: "nowrap" }}>
          <span style={{ fontWeight: 600, color: t.text }}>nucleus</span>
          <span style={{ fontWeight: 400, color: t.text2 }}> manager</span>
        </span>
        {/* While a refresh runs, two dots orbit beside the lockup. The slot
            is the orbit's full sweep (5px dot, 155% radius ≈ 21px). */}
        {refreshing && (
          <span
            aria-hidden="true"
            style={{
              width: 22, height: 22, flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              color: dark ? BRAND_TEAL_LIGHT : BRAND_TEAL,
            }}
          >
            <TwinOrbit className="size-[5px]" />
          </span>
        )}
      </button>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: 8,
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
        {look.childcare && <ListRow
          label="Coverage"
          count={pendingCoverageCount > 0 ? pendingCoverageCount : undefined}
          active={viewFilter === "coverage"}
          onClick={() => onSetViewFilter(viewFilter === "coverage" ? "all" : "coverage")}
          onContextMenu={(e) => { e.preventDefault(); onOpenCoverageRequests(); }}
          title="Right-click to see the coverage requests list"
          t={t}
        />}
      </SidebarSection>

      {/* One list for everyone. Click filters the calendar to that person; hover
          swaps the count for Import / Edit-week icons (right-click edits too).
          Daisy has no calendar filter, so her row click opens her import. */}
      <SidebarSection label="People" t={t}>
        <PersonRow
          color={palette.G}
          label={look.names.G}
          count={viewCounts.g}
          active={viewFilter === "g"}
          onClick={() => onSetViewFilter(viewFilter === "g" ? "all" : "g")}
          onImport={() => slotFor("self-ot", onOpenScheduleImport)}
          onEdit={() => slotFor("self-ot", onEditSchedule)}
          title={`Click to filter to ${look.names.G} · right-click to edit their week`}
          t={t}
        />
        {look.hasPartner && (
          <PersonRow
            color={palette.K}
            label={look.names.K}
            count={viewCounts.k}
            active={viewFilter === "k"}
            onClick={() => onSetViewFilter(viewFilter === "k" ? "all" : "k")}
            onImport={() => slotFor("partner", onOpenScheduleImport)}
            onEdit={() => slotFor("partner", onEditSchedule)}
            title={`Click to filter to ${look.names.K} · right-click to edit their week`}
            t={t}
          />
        )}
        {look.hasCaregiver && (
          <PersonRow
            label={look.names.D}
            // Her class schedule; anyone else's caregiver's is just theirs.
            tag={look.familyPhotos ? "SCHOOL" : "SCHEDULE"}
            onClick={() => slotFor("dependent-daisy", onOpenScheduleImport)}
            onImport={() => slotFor("dependent-daisy", onOpenScheduleImport)}
            onEdit={() => slotFor("dependent-daisy", onEditSchedule)}
            title={`Click to import ${look.names.D}'s schedule · right-click to edit their week`}
            t={t}
          />
        )}
      </SidebarSection>

      {/* What the email scans found, then the schedule to-do list: always here,
          as the list while a period is ending and an empty state otherwise.
          marginTop auto sits them at the foot of the sidebar, just above the
          Console card, when there's room, and right under People when there
          isn't (the column then scrolls). flexShrink 0: the cards clip their
          own overflow, so without it this column would squash them instead. */}
      {householdId && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0, padding: "0 2px", marginTop: "auto" }}>
          <EmailFoundMenu householdId={householdId} events={events} palette={palette} onSelectDate={onSelectDate} />
          {tasks ? (
            <ScheduleTasksCard
              tasks={tasks}
              onUpload={(who) => slotFor(who === "G" ? "self-ot" : "partner", onOpenScheduleImport)}
              onReconcile={onReconcileGaps}
            />
          ) : (
            <ScheduleTasksEmpty />
          )}
        </div>
      )}

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
            borderRadius: 14,
            background: "var(--glass-fill-soft)",
            border: "1px solid var(--glass-line)",
            boxShadow: "inset 0 1px 0 var(--glass-edge)",
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
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 8px 4px" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: t.text3, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {label}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

/** Run `run` with the schedule-import slot id that belongs to this person. */
function slotFor(target: ImportTarget, run: (id: string) => void) {
  const slot = SCHEDULE_IMPORTS.find((s) => s.target === target);
  if (slot) run(slot.id);
}

/** Highlight behind the row whose filter is active. */
function activeBackground(t: ThemeTokens): string {
  const lightSurface = t.bg === "#F7F6F3" || t.bg === "#F2F2F7" || t.bg === "#ECECEE";
  return lightSurface ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)";
}

interface PersonRowProps {
  /** Person colour bar; omit for someone with no calendar colour (a spacer keeps names aligned). */
  color?: string;
  label: string;
  /** Shift count shown at rest. */
  count?: number;
  /** Small caps chip shown at rest instead of a count (e.g. SCHOOL). */
  tag?: string;
  active?: boolean;
  t: ThemeTokens;
  /** Click on the row body (filter, or import when there is no filter). */
  onClick: () => void;
  onImport: () => void;
  onEdit: () => void;
  title?: string;
}

/**
 * One row per person. At rest it shows the count (or tag); on hover or keyboard
 * focus the count swaps for Import / Edit-week icon buttons. Right-click edits
 * the week too. The icons are siblings of the row button, never nested in it.
 */
function PersonRow({ color, label, count, tag, active, t, onClick, onImport, onEdit, title }: PersonRowProps) {
  return (
    <div
      className="group relative"
      onContextMenu={(e) => { e.preventDefault(); onEdit(); }}
      style={{ borderRadius: 6, background: active ? activeBackground(t) : "transparent" }}
    >
      <button
        type="button"
        onClick={onClick}
        title={title}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "5px 8px",
          borderRadius: 6,
          background: "transparent",
          border: 0,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: t.text,
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <span style={{ width: 3.5, height: 14, borderRadius: 2, background: color ?? "transparent", flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{label}</span>
        <span className="inline-flex transition-opacity duration-150 group-hover:opacity-0 group-has-[:focus-visible]:opacity-0">
          {tag ? (
            <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", color: t.text3, padding: "2px 6px", borderRadius: 4, background: t.bgElev2 }}>{tag}</span>
          ) : count != null ? (
            <span style={{ fontSize: 11, color: t.text3, fontVariantNumeric: "tabular-nums" }}>{count}</span>
          ) : null}
        </span>
      </button>
      <span className="pointer-events-none absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100">
        <RowAction label={`Import ${label}'s schedule`} onClick={onImport} t={t}>
          <Upload size={13} strokeWidth={2} />
        </RowAction>
        <RowAction label={`Edit ${label}'s week`} onClick={onEdit} t={t}>
          <Pencil size={13} strokeWidth={2} />
        </RowAction>
      </span>
    </div>
  );
}

function RowAction({ label, onClick, t, children }: { label: string; onClick: () => void; t: ThemeTokens; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            width: 22,
            height: 22,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: 0,
            borderRadius: 5,
            cursor: "pointer",
            background: hover ? t.bgElev2 : "transparent",
            color: hover ? t.text : t.text2,
          }}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" size="sm">{label}</TooltipContent>
    </Tooltip>
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
        background: active ? activeBackground(t) : "transparent",
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
