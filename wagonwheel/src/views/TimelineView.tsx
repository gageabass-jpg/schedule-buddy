import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChartGantt, ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { dayIndex, isoFromDayIndex, monthSpans, weekdayOf, zoomedScrollLeft } from "@nucleus/ui/lib/timelineAxis";
import type { Milestone, Project, Task } from "@shared/types";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { bridge } from "@/lib/bridge";
import { compareTasks, isOverdue, liveProjects, projectProgress } from "@/lib/derive";
import { formatShort, parts, WEEKDAYS_3 } from "@/lib/dates";
import { barColor, projectColor } from "@/lib/colors";
import { EmptyState, IconButton, PageHeader } from "@/components/kit";
import { GlassButton } from "@/components/GlassButton";
import { TaskCheck } from "@/components/TaskRow";

/**
 * Projects, tasks and milestones over time.
 *
 * One horizontal axis, scrolled and zoomed. The axis maths is the shared timeline code
 * (day index, month ticks, zoom about the cursor); the limits and the drawing are
 * Wagonwheel's own, because a project runs for months and the shared limits suit a
 * day-by-day view.
 *
 *  - A project is a bar from its start to its target date, filled to its progress.
 *  - Its tasks sit beneath it: a bar from start to due date, or a single day.
 *  - A milestone is a diamond on its project's row.
 *  - Drag a bar to move it, drag an end to resize it, click to open it. ⌥← and ⌥→ nudge a
 *    focused bar by a day.
 *  - ⌘-scroll or pinch zooms about the pointer. The selected date (sidebar) is centred.
 */

const ROW_H = 40;
const GUTTER = 272;
const MIN_PPD = 2.2;      // about 3 years across a 2,400 px track
const MAX_PPD = 120;
const PRESETS = [{ label: "Month", ppd: 26 }, { label: "Quarter", ppd: 9 }, { label: "Year", ppd: 2.6 }] as const;
const DRAG_PX = 4;

const clampPpd = (p: number): number => Math.min(MAX_PPD, Math.max(MIN_PPD, p));
const reduced = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ── The rows ────────────────────────────────────────────────────────────────

interface Span { start: number; end: number }   // day indexes, end inclusive

type Row =
  | { kind: "project"; id: string; project: Project; span: Span | null; pct: number; milestones: Milestone[]; open: boolean; taskCount: number }
  | { kind: "task"; id: string; task: Task; project: Project; span: Span }
  | { kind: "unscheduled"; id: string; project: Project; count: number };

const spanOf = (a: string | null, b: string | null): Span | null => {
  const s = a ?? b;
  const e = b ?? a;
  return s && e ? { start: dayIndex(s), end: Math.max(dayIndex(s), dayIndex(e)) } : null;
};

function buildRows(projects: Project[], tasks: Task[], milestones: Milestone[], collapsed: Set<string>): Row[] {
  const rows: Row[] = [];
  for (const project of projects) {
    const mine = tasks.filter((t) => t.projectId === project.id && !t.parentId).sort(compareTasks);
    const scheduled = mine.filter((t) => t.startDate || t.dueDate);
    let span = spanOf(project.startDate, project.targetDate);
    if (!span && scheduled.length) {
      const idx = scheduled.flatMap((t) => [t.startDate, t.dueDate]).filter((d): d is string => !!d).map(dayIndex);
      span = { start: Math.min(...idx), end: Math.max(...idx) };
    }
    const open = !collapsed.has(project.id);
    rows.push({
      kind: "project", id: `p-${project.id}`, project, span,
      pct: projectProgress(project.id, tasks).pct,
      milestones: milestones.filter((m) => m.projectId === project.id),
      open, taskCount: mine.length,
    });
    if (!open) continue;
    for (const t of scheduled) rows.push({ kind: "task", id: `t-${t.id}`, task: t, project, span: spanOf(t.startDate, t.dueDate) as Span });
    if (mine.length > scheduled.length) rows.push({ kind: "unscheduled", id: `u-${project.id}`, project, count: mine.length - scheduled.length });
  }
  return rows;
}

// ── The view ────────────────────────────────────────────────────────────────

type Drag = { id: string; mode: "move" | "start" | "end"; x0: number; delta: number; moved: boolean };

export function TimelineView({ projectId, embedded }: { projectId?: string; embedded?: boolean }) {
  const { snapshot, today, act, attempt } = useData();
  const { editTask, editMilestone, go, selectedDate, selectDate, newProject } = useUi();
  const scroller = useRef<HTMLDivElement>(null);
  const [ppd, setPpd] = useState<number>(PRESETS[1].ppd);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const projects = useMemo(() => liveProjects(snapshot).filter((p) => !projectId || p.id === projectId), [snapshot, projectId]);
  const rows = useMemo(() => buildRows(projects, snapshot.tasks, snapshot.milestones, collapsed), [projects, snapshot.tasks, snapshot.milestones, collapsed]);
  const shownMilestones = useMemo(() => rows.flatMap((r) => (r.kind === "project" ? r.milestones : [])), [rows]);

  // The axis runs from a little before the earliest date to well after the latest, at least a year.
  const { origin, days } = useMemo(() => {
    const idx: number[] = [dayIndex(today)];
    for (const r of rows) {
      if (r.kind === "project" && r.span) idx.push(r.span.start, r.span.end);
      if (r.kind === "task") idx.push(r.span.start, r.span.end);
    }
    for (const m of shownMilestones) idx.push(dayIndex(m.targetDate));
    const lo = Math.min(...idx) - 28;
    const hi = Math.max(...idx, lo + 364) + 56;
    return { origin: lo, days: hi - lo + 1 };
  }, [rows, shownMilestones, today]);

  const trackW = days * ppd;
  const xOf = useCallback((idx: number): number => (idx - origin) * ppd, [origin, ppd]);
  const todayIdx = dayIndex(today);

  const centerOn = useCallback((iso: string, smooth: boolean) => {
    const el = scroller.current;
    if (!el) return;
    const left = (dayIndex(iso) - origin + 0.5) * ppd - (el.clientWidth - GUTTER) / 2;
    el.scrollTo({ left: Math.max(0, left), behavior: smooth && !reduced() ? "smooth" : "auto" });
  }, [origin, ppd]);

  // First paint: today in the middle. Afterwards: whenever the selected date changes.
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; centerOn(embedded ? today : selectedDate, false); }
  }, [centerOn, embedded, today, selectedDate]);
  const lastSelected = useRef(selectedDate);
  useEffect(() => {
    if (lastSelected.current === selectedDate) return;
    lastSelected.current = selectedDate;
    centerOn(selectedDate, true);
  }, [selectedDate, centerOn]);

  // Zoom about the pointer (⌘-scroll, ctrl-scroll or a trackpad pinch), keeping the date under it still.
  const zoomTo = useCallback((next: number, anchorX?: number) => {
    const el = scroller.current;
    const to = clampPpd(next);
    if (!el || to === ppd) return;
    const vx = anchorX ?? GUTTER + (el.clientWidth - GUTTER) / 2;
    const left = zoomedScrollLeft(el.scrollLeft, vx, GUTTER, ppd, to);
    setPpd(to);
    requestAnimationFrame(() => { el.scrollLeft = Math.max(0, left); });
  }, [ppd]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(ppd * Math.exp(-e.deltaY * 0.01), e.clientX - el.getBoundingClientRect().left);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ppd, zoomTo]);

  // ── Dragging bars ─────────────────────────────────────────────────────────

  // Saves run one after another, and each reads the dates as they are NOW, not as they were
  // when the key was pressed. Holding Alt+Arrow, or two quick nudges, would otherwise each
  // start from the same old dates and lose a step.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const saveDates = useCallback((row: Row, mode: Drag["mode"], delta: number): Promise<void> => {
    if (row.kind === "unscheduled" || delta === 0) return Promise.resolve();
    const job = async (): Promise<void> => {
      const fresh = await bridge().getSnapshot();
      const shift = (iso: string | null): string | null => (iso ? isoFromDayIndex(dayIndex(iso) + delta) : null);
      // The same arithmetic for a task (start / due) and a project (start / target).
      const plan = (startDate: string | null, endDate: string | null): { startDate?: string | null; end?: string | null } | null => {
        if (!startDate && !endDate) return null;
        const startIso = (startDate ?? endDate) as string;
        const endIso = (endDate ?? startDate) as string;
        if (mode === "move") return { ...(startDate ? { startDate: shift(startDate) } : {}), ...(endDate ? { end: shift(endDate) } : {}) };
        if (mode === "start") return { startDate: isoFromDayIndex(Math.min(dayIndex(startIso) + delta, dayIndex(endIso))), ...(endDate ? {} : { end: endIso }) };
        return { end: isoFromDayIndex(Math.max(dayIndex(endIso) + delta, dayIndex(startIso))), ...(startDate ? {} : { startDate: startIso }) };
      };
      if (row.kind === "task") {
        const t = fresh.tasks.find((x) => x.id === row.task.id);
        const p = t && plan(t.startDate, t.dueDate);
        if (t && p) await act.updateTask(t.id, { ...("startDate" in p ? { startDate: p.startDate } : {}), ...("end" in p ? { dueDate: p.end } : {}) });
      } else {
        const pr = fresh.projects.find((x) => x.id === row.project.id);
        const p = pr && plan(pr.startDate, pr.targetDate);
        if (pr && p) await act.updateProject(pr.id, { ...("startDate" in p ? { startDate: p.startDate } : {}), ...("end" in p ? { targetDate: p.end } : {}) });
      }
    };
    const run = queue.current.then(() => attempt(job)).then(() => undefined);
    queue.current = run;
    return run;
  }, [act, attempt]);

  const onBarDown = (e: PointerEvent, row: Row, mode: Drag["mode"]) => {
    if (e.button !== 0 || row.kind === "unscheduled") return;
    if (row.kind === "project" && !row.project.startDate && !row.project.targetDate) return;   // a span worked out from tasks has no dates of its own to move
    e.currentTarget.setPointerCapture(e.pointerId);
    const d: Drag = { id: row.id, mode, x0: e.clientX, delta: 0, moved: false };
    dragRef.current = d;
    setDrag(d);
  };
  const onBarMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const next = { ...d, moved: d.moved || Math.abs(dx) >= DRAG_PX, delta: Math.round(dx / ppd) };
    dragRef.current = next;
    setDrag(next);
  };
  const onBarUp = (row: Row) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    if (d.moved) void saveDates(row, d.mode, d.delta);
    else if (row.kind === "task") editTask(row.task.id);
    else if (row.kind === "project") go({ name: "project", id: row.project.id });
  };
  const onBarKey = (e: KeyboardEvent, row: Row) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (row.kind === "task") editTask(row.task.id);
      else if (row.kind === "project") go({ name: "project", id: row.project.id });
    } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      void saveDates(row, "move", e.key === "ArrowLeft" ? -1 : 1);
    }
  };

  // ── Header ticks ──────────────────────────────────────────────────────────

  const months = useMemo(() => monthSpans(origin, origin + days - 1), [origin, days]);
  const dayTicks = useMemo(() => {
    if (ppd < 5) return [];
    const out: { idx: number; label: string; sub?: string }[] = [];
    for (let i = origin; i < origin + days; i++) {
      const wd = weekdayOf(i);
      if (ppd >= 20) out.push({ idx: i, label: String(parts(isoFromDayIndex(i)).d), sub: ppd >= 44 ? WEEKDAYS_3[wd][0] : undefined });
      else if (wd === 1) out.push({ idx: i, label: String(parts(isoFromDayIndex(i)).d) });
    }
    return out;
  }, [origin, days, ppd]);

  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const body = rows.length * ROW_H;
  const datedAny = rows.some((r) => (r.kind === "project" && r.span) || r.kind === "task") || shownMilestones.length > 0;

  if (!datedAny && !embedded) {
    return (
      <>
        <PageHeader title="Timeline" subtitle="Projects, tasks and milestones over time" />
        <EmptyState
          icon={<ChartGantt size={20} />}
          title="Nothing to plot yet"
          body="Give a project a start and target date, or give its tasks dates, and they appear here as bars."
          action={snapshot.projects.length === 0 ? <GlassButton tone="primary" onClick={newProject}><Plus size={15} />New project</GlassButton> : <GlassButton tone="primary" onClick={() => go({ name: "projects" })}>Open a project</GlassButton>}
        />
      </>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", embedded && "h-[560px] flex-none")}>
      {!embedded && (
        <PageHeader title="Timeline" subtitle={`${projects.length} ${projects.length === 1 ? "project" : "projects"} · drag a bar to move it, drag an end to resize it`} />
      )}
      <div className={cn("flex items-center gap-2 pb-3", embedded ? "" : "px-8")}>
        <div className="glass-inset inline-flex p-0.5" style={{ ["--ww-r" as string]: "10px" }} role="group" aria-label="Zoom level">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => zoomTo(p.ppd)} aria-pressed={Math.abs(ppd - p.ppd) < p.ppd * 0.12}
              className={cn("h-7 rounded-lg px-3 text-[12.5px] font-semibold", Math.abs(ppd - p.ppd) < p.ppd * 0.12 ? "bg-white/15 text-foreground" : "text-ink-2 hover:text-foreground")}>{p.label}</button>
          ))}
        </div>
        <IconButton label="Zoom out" onClick={() => zoomTo(ppd / 1.4)}><Minus size={16} /></IconButton>
        <IconButton label="Zoom in" onClick={() => zoomTo(ppd * 1.4)}><Plus size={16} /></IconButton>
        <GlassButton className="!h-8" onClick={() => (embedded ? centerOn(today, true) : selectDate(today))}>Today</GlassButton>
        <span className="ml-auto hidden text-[12px] text-ink-3 lg:block">⌘-scroll or pinch to zoom</span>
      </div>

      <div ref={scroller} className={cn("relative min-h-0 flex-1 overflow-auto", embedded ? "glass-inset" : "border-t border-white/[0.07]")} style={embedded ? { ["--ww-r" as string]: "14px" } : undefined}>
        <div className="relative" style={{ width: GUTTER + trackW, minHeight: "100%" }}>
          {/* Header: months, then days (or weeks). Sticky to the top. */}
          <div className="sticky top-0 z-30 flex bg-[rgba(30,20,26,0.92)] backdrop-blur-md" style={{ height: 52 }}>
            <div className="sticky left-0 z-40 shrink-0 border-b border-r border-white/[0.07] bg-[rgba(30,20,26,0.96)]" style={{ width: GUTTER }} />
            <div className="relative border-b border-white/[0.07]" style={{ width: trackW }}>
              {months.map((m) => (
                <div key={m.key} className="absolute top-0 h-[26px] truncate border-l border-white/[0.09] px-2 text-[12px] font-semibold leading-[26px] text-ink-2" style={{ left: xOf(m.startIdx), width: m.days * ppd }}>{m.days * ppd > 70 ? m.label : ""}</div>
              ))}
              {dayTicks.map((t) => (
                <button key={t.idx} type="button" onClick={() => selectDate(isoFromDayIndex(t.idx))} title={formatShort(isoFromDayIndex(t.idx), today)}
                  className={cn("absolute top-[26px] h-[26px] text-center text-[11px] leading-[13px] hover:bg-white/10", t.idx === todayIdx ? "font-bold text-crimson-text" : t.idx === dayIndex(selectedDate) ? "font-bold text-foreground" : "text-ink-3")}
                  style={{ left: xOf(t.idx), width: Math.max(ppd, 18) }}>
                  {t.sub && <span className="block text-[9.5px] opacity-80">{t.sub}</span>}{t.label}
                </button>
              ))}
              {/* Today flag in the header. */}
              <div className="pointer-events-none absolute bottom-0 h-[3px] rounded-t bg-crimson" style={{ left: xOf(todayIdx), width: Math.max(ppd, 6) }} />
            </div>
          </div>

          {/* Body. Month lines and the today line sit behind the rows. */}
          <div className="relative flex" style={{ height: body }}>
            <div className="sticky left-0 z-20 shrink-0 border-r border-white/[0.07] bg-[rgba(30,20,26,0.9)]" style={{ width: GUTTER }}>
              {rows.map((r) => <Label key={r.id} row={r} onToggle={toggle} />)}
            </div>
            <div className="relative" style={{ width: trackW, height: body }}>
              {months.map((m) => <div key={m.key} className="absolute inset-y-0 w-px bg-white/[0.06]" style={{ left: xOf(m.startIdx) }} />)}
              <div className="pointer-events-none absolute inset-y-0 z-[5] bg-crimson/[0.07]" style={{ left: xOf(todayIdx), width: Math.max(ppd, 2) }} />
              <div className="pointer-events-none absolute inset-y-0 z-[6] w-[2px] bg-crimson-text/80" style={{ left: xOf(todayIdx) + Math.max(ppd, 2) / 2 - 1 }} />
              {rows.map((r, i) => (
                <div key={r.id} className={cn("absolute inset-x-0 border-b border-white/[0.04]", r.kind === "project" && "bg-white/[0.03]")} style={{ top: i * ROW_H, height: ROW_H }}>
                  {r.kind === "project" && r.span && (
                    <Bar row={r} span={r.span} ppd={ppd} xOf={xOf} drag={drag} label={r.project.name} color={projectColor(r.project.color)} pct={r.pct} project
                      draggable={!!(r.project.startDate || r.project.targetDate)} onDown={onBarDown} onMove={onBarMove} onUp={onBarUp} onKey={onBarKey} today={today} />
                  )}
                  {r.kind === "project" && r.milestones.map((m) => (
                    <button key={m.id} type="button" onClick={() => editMilestone(m.id, m.projectId)} title={`${m.name} · ${formatShort(m.targetDate, today)}${m.completedAt ? " · done" : ""}`}
                      aria-label={`Milestone ${m.name}, ${formatShort(m.targetDate, today)}${m.completedAt ? ", done" : ""}`}
                      className="absolute top-1/2 z-10 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold"
                      style={{ left: xOf(dayIndex(m.targetDate)) + ppd / 2 - 8 }}>
                      <i className={cn("block size-4 rotate-45 rounded-[3px] border-2 border-[#1d1419]", m.completedAt ? "bg-ok" : m.targetDate < today ? "bg-danger" : "bg-warn")} />
                      {ppd >= 6 && <span className="text-ink-2">{m.name}</span>}
                    </button>
                  ))}
                  {r.kind === "task" && (
                    <Bar row={r} span={r.span} ppd={ppd} xOf={xOf} drag={drag} label={r.task.title} color={projectColor(r.project.color)} pct={r.task.status === "done" ? 100 : r.task.status === "in_progress" ? 50 : 0}
                      draggable overdue={isOverdue(r.task, today)} done={r.task.status === "done"} onDown={onBarDown} onMove={onBarMove} onUp={onBarUp} onKey={onBarKey} today={today} />
                  )}
                  {r.kind === "project" && !r.span && r.milestones.length === 0 && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] italic text-ink-3">No dates yet. Set a start and target date, or date its tasks.</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Label({ row, onToggle }: { row: Row; onToggle: (id: string) => void }) {
  const { go, editTask } = useUi();
  const { today } = useData();
  const base = "flex items-center border-b border-white/[0.04]";
  if (row.kind === "project") {
    return (
      <div className={cn(base, "gap-1.5 bg-white/[0.04] pl-2 pr-3")} style={{ height: ROW_H }}>
        <button type="button" onClick={() => onToggle(row.project.id)} aria-label={`${row.open ? "Collapse" : "Expand"} ${row.project.name}`} aria-expanded={row.open} className="grid size-6 place-items-center rounded-md text-ink-2 hover:bg-white/10">
          {row.open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <button type="button" onClick={() => go({ name: "project", id: row.project.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <i className="size-2.5 shrink-0 rounded-full" style={{ background: projectColor(row.project.color) }} />
          <span className="truncate text-[13.5px] font-semibold">{row.project.name}</span>
        </button>
        <span className="shrink-0 text-[11.5px] font-semibold text-ink-3">{row.taskCount ? `${row.pct}%` : ""}</span>
      </div>
    );
  }
  if (row.kind === "task") {
    return (
      <div className={cn(base, "gap-2 pl-8 pr-3")} style={{ height: ROW_H }}>
        <TaskCheck task={row.task} />
        <button type="button" onClick={() => editTask(row.task.id)} className={cn("min-w-0 flex-1 truncate text-left text-[13px]", row.task.status === "done" && "text-ink-3 line-through decoration-white/25")} title={row.task.title}>{row.task.title}</button>
        {row.task.dueDate && <span className={cn("shrink-0 text-[11.5px]", isOverdue(row.task, today) ? "font-semibold text-danger" : "text-ink-3")}>{formatShort(row.task.dueDate, today)}</span>}
      </div>
    );
  }
  return (
    <div className={cn(base, "pl-[3.1rem] pr-3 text-[12px] italic text-ink-3")} style={{ height: ROW_H }}>
      {row.count} {row.count === 1 ? "task has" : "tasks have"} no dates
    </div>
  );
}

interface BarProps {
  row: Row; span: Span; ppd: number; xOf: (idx: number) => number; drag: Drag | null; label: string; color: string; pct: number;
  project?: boolean; draggable: boolean; overdue?: boolean; done?: boolean; today: string;
  onDown: (e: PointerEvent, row: Row, mode: Drag["mode"]) => void; onMove: (e: PointerEvent) => void; onUp: (row: Row) => void; onKey: (e: KeyboardEvent, row: Row) => void;
}

function Bar({ row, span, ppd, xOf, drag, label, color, pct, project, draggable, overdue, done, today, onDown, onMove, onUp, onKey }: BarProps) {
  const mine = drag?.id === row.id ? drag : null;
  const d = mine?.delta ?? 0;
  let s = span.start;
  let e = span.end;
  if (mine?.mode === "move") { s += d; e += d; }
  else if (mine?.mode === "start") s = Math.min(s + d, e);
  else if (mine?.mode === "end") e = Math.max(e + d, s);

  const left = xOf(s);
  const width = Math.max((e - s + 1) * ppd, 8);
  const range = `${formatShort(isoFromDayIndex(s), today)}${e > s ? ` – ${formatShort(isoFromDayIndex(e), today)}` : ""}`;
  const labelInside = width > 90;
  const fill = barColor(color);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${project ? "Project" : "Task"} ${label}, ${range}${draggable ? ". Drag to move, or press Alt and an arrow key." : ""}`}
        title={`${label} · ${range}`}
        onPointerDown={(ev) => onDown(ev, row, "move")}
        onPointerMove={onMove}
        onPointerUp={() => onUp(row)}
        onPointerCancel={() => onUp(row)}
        onKeyDown={(ev) => onKey(ev, row)}
        className={cn(
          "absolute top-1/2 z-10 -translate-y-1/2 select-none whitespace-nowrap rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
          project ? "h-[22px]" : "h-[18px]",
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          mine?.moved && "shadow-[0_6px_20px_rgba(0,0,0,0.5)] ring-1 ring-white/40",
        )}
        style={{
          left, width,
          background: `${fill}${done ? "30" : "44"}`,
          boxShadow: `inset 0 0 0 1px ${overdue ? "#ff8e72" : color}${done ? "66" : "aa"}, inset 0 1px 0 rgba(255,255,255,0.18)`,
        }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
          <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: `linear-gradient(180deg, ${fill}, ${fill}cc)`, opacity: done ? 0.55 : 0.95 }} />
        </div>
        {/* The label sticks to the left edge of what you can see, so a bar that starts off-screen still says what it is. */}
        {labelInside && <span className="sticky z-10 inline-block max-w-full truncate px-2.5 align-top text-[11.5px] font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.65)]" style={{ left: GUTTER + 4, lineHeight: project ? "22px" : "18px" }}>{label}</span>}
        {draggable && width > 20 && (
          <>
            <span onPointerDown={(ev) => { ev.stopPropagation(); onDown(ev, row, "start"); }} onPointerMove={onMove} onPointerUp={() => onUp(row)} className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize hover:bg-white/30" aria-hidden="true" />
            <span onPointerDown={(ev) => { ev.stopPropagation(); onDown(ev, row, "end"); }} onPointerMove={onMove} onPointerUp={() => onUp(row)} className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize hover:bg-white/30" aria-hidden="true" />
          </>
        )}
      </div>
      {!labelInside && <span className="pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 whitespace-nowrap pl-2 text-[11.5px] font-semibold text-ink-2" style={{ left: left + width }}>{label}</span>}
      {mine?.moved && <span className="pointer-events-none absolute z-30 -translate-y-full whitespace-nowrap rounded-md bg-black/80 px-2 py-1 text-[11.5px] font-semibold" style={{ left, top: 4 }}>{range}</span>}
    </>
  );
}
