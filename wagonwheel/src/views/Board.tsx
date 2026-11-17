import { useMemo, useState } from "react";
import { Check, Plus, Table2 } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@nucleus/ui/ui/popover";
import { TASK_STATUSES, TASK_STATUS_HINT, TASK_STATUS_LABEL, taskCode, type Project, type Task, type TaskStatus } from "@shared/types";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { buildBoard, CELL_LIMIT, isClosedColumn, visibleInCell, type BoardRow } from "@/lib/board";
import { dueLabel, isOpen, isOverdue, subtaskProgress } from "@/lib/derive";
import { projectColor } from "@/lib/colors";
import { EmptyState, IconButton, PageHeader, PriorityMark, TASK_STATUS_TONE } from "@/components/kit";
import { TONES } from "@/lib/tones";
import { GlassButton } from "@/components/GlassButton";
import { StatusLine } from "@/components/StatusLine";

// The Board: every project down the left, every status across the top, a small box with the task's identifier in the
// cell where it stands. The tracker above the table counts each status and colours its column. A closed column (Complete,
// Discontinued) keeps only the latest few boxes until it is opened, so a project that has finished a hundred tasks
// does not push the live ones off the screen.

const LABEL_W = 232;
const COL_MIN = 150;

/** The colour of each status, as a solid: the tracker's top edge and the dot in the status menu. */
const ACCENT: Record<TaskStatus, string> = {
  not_started: "bg-white/35",
  in_progress: "bg-crimson",
  stalled: "bg-warn",
  done: "bg-ok",
  discontinued: "bg-white/15",
};

const gridStyle = { gridTemplateColumns: `${LABEL_W}px repeat(${TASK_STATUSES.length}, minmax(${COL_MIN}px, 1fr))` } as const;

export function Board() {
  const { snapshot } = useData();
  const { newProject } = useUi();
  const board = useMemo(() => buildBoard(snapshot), [snapshot]);
  const [showAllClosed, setShowAllClosed] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string) => setExpanded((cur) => {
    const next = new Set(cur);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  return (
    <>
      <PageHeader
        title="Board"
        subtitle={`${board.tasks} ${board.tasks === 1 ? "task" : "tasks"} across ${board.rows.length} ${board.rows.length === 1 ? "project" : "projects"}`}
        // No New task here: with no project to put it in, it would go to the inbox, which the Board does not show.
        // A task is added from its project's row instead.
        actions={
          <Switch
            checked={showAllClosed}
            onChange={setShowAllClosed}
            label="Show all closed"
            title="Open the Complete and Discontinued columns in full, instead of the latest few"
          />
        }
      />
      {board.rows.length === 0 ? (
        <EmptyState
          icon={<Table2 size={20} />}
          title="No projects yet"
          body="The board has a row for each project and a column for each status. Make a project to start filling it."
          action={<GlassButton tone="primary" onClick={newProject}><Plus size={15} />New project</GlassButton>}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-8 pb-8">
          <div role="table" aria-label="Tasks by project and status" className="ww-rise flex flex-col gap-3" style={{ minWidth: LABEL_W + COL_MIN * TASK_STATUSES.length }}>
            <div role="row" className="sticky top-0 z-10 grid items-stretch gap-2 pb-1" style={gridStyle}>
              <div role="columnheader" className="flex flex-col justify-end px-1 pb-1 text-[12px] leading-snug text-ink-3">
                <span className="font-semibold uppercase tracking-[0.09em]">Projects</span>
                <span>{board.rows.length} {board.rows.length === 1 ? "row" : "rows"}</span>
              </div>
              {TASK_STATUSES.map((s) => <Tracker key={s} status={s} count={board.totals[s]} />)}
            </div>
            {board.rows.map((row) => (
              <Row key={row.project.id} row={row} showAllClosed={showAllClosed} expanded={expanded} onToggle={toggle} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** One status in the tracker: its colour, its name, how many tasks are in it, and what it means. */
function Tracker({ status, count }: { status: TaskStatus; count: number }) {
  return (
    <div role="columnheader" className="glass-card relative flex flex-col gap-1 overflow-hidden px-3 pb-2.5 pt-3">
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-[3px]", ACCENT[status])} />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold uppercase tracking-[0.09em] text-ink-2">{TASK_STATUS_LABEL[status]}</span>
        <span className="font-display text-[22px] font-semibold leading-none tabular-nums" aria-label={`${count} ${count === 1 ? "task" : "tasks"}`}>{count}</span>
      </div>
      <p className="text-[12px] leading-snug text-ink-3">{TASK_STATUS_HINT[status]}</p>
    </div>
  );
}

function Row({ row, showAllClosed, expanded, onToggle }: { row: BoardRow; showAllClosed: boolean; expanded: ReadonlySet<string>; onToggle: (key: string) => void }) {
  const { go, newTask } = useUi();
  const { project } = row;
  const color = projectColor(project.color);
  return (
    <div role="row" className="grid items-stretch gap-2" style={gridStyle}>
      <div role="rowheader" className="glass-card sticky left-0 z-[5] flex min-w-0 flex-col gap-1.5 p-3">
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" onClick={() => go({ name: "project", id: project.id })} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Open the project">
            <i className="size-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}88` }} />
            <span className="truncate text-[14.5px] font-semibold tracking-tight">{project.name}</span>
          </button>
          {/* Adds the task to this project, so it lands in this row's Queued cell. */}
          <IconButton label={`Add a task to ${project.name}`} onClick={() => newTask({ projectId: project.id })} className="-my-1 -mr-1.5 size-7"><Plus size={14} /></IconButton>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <span className="rounded border border-white/10 bg-white/[0.05] px-1.5 font-mono text-[11px] font-semibold text-ink-2" title="The project's key: the front of its task identifiers">{project.key || "—"}</span>
          <span>{row.open} open · {row.closed} closed</span>
        </div>
        <StatusLine project={project} lines={2} />
      </div>
      {TASK_STATUSES.map((status) => {
        const key = `${project.id}:${status}`;
        const all = row.cells[status];
        const held = isClosedColumn(status) && showAllClosed;   // the switch holds a closed column open
        const { shown, hidden } = visibleInCell(all, status, held || expanded.has(key));
        const canFold = expanded.has(key) && !held && all.length > CELL_LIMIT[status];
        return (
          <div
            key={status}
            role="cell"
            aria-label={`${project.name}, ${TASK_STATUS_LABEL[status]}`}
            className={cn("flex min-h-[76px] flex-wrap content-start gap-1.5 rounded-xl border border-white/[0.06] p-2.5", isClosedColumn(status) ? "bg-black/[0.14]" : "bg-white/[0.025]")}
          >
            {shown.map((t) => <TaskBox key={t.id} task={t} project={project} />)}
            {hidden > 0 && <MoreButton onClick={() => onToggle(key)}>+{hidden} more</MoreButton>}
            {canFold && <MoreButton onClick={() => onToggle(key)}>Show fewer</MoreButton>}
          </div>
        );
      })}
    </div>
  );
}

const MoreButton = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex h-6 items-center rounded-md border border-dashed border-white/20 px-1.5 text-[11.5px] font-semibold text-ink-3 outline-none transition-colors hover:border-white/35 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
  >
    {children}
  </button>
);

/** A task as a small box with its identifier. Click it to see the task and change its status. */
function TaskBox({ task, project }: { task: Task; project: Project }) {
  const { today } = useData();
  const [open, setOpen] = useState(false);
  const code = taskCode(task, project);
  const overdue = isOverdue(task, today);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${code ? `${code} · ` : ""}${task.title}`}
          aria-label={`${code ?? "Task"}: ${task.title}, ${TASK_STATUS_LABEL[task.status]}${overdue ? ", overdue" : ""}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 font-mono text-[11.5px] font-semibold tracking-tight outline-none transition-[filter,box-shadow] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring",
            TONES[TASK_STATUS_TONE[task.status]],
            overdue && "border-danger/60",
          )}
        >
          {code ?? "—"}
          {overdue && <i aria-hidden="true" className="size-1.5 rounded-full bg-danger" />}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" sideOffset={6} className="glass-panel w-[300px] border-0 bg-[rgba(40,27,34,0.96)] p-3 text-foreground" style={{ ["--ww-r" as string]: "18px" }}>
        <TaskPeek task={task} project={project} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** What the box opens: the task, and the five statuses to move it to. */
function TaskPeek({ task, project, close }: { task: Task; project: Project; close: () => void }) {
  const { snapshot, today, act, attempt } = useData();
  const { editTask } = useUi();
  const code = taskCode(task, project);
  const subs = subtaskProgress(task.id, snapshot.tasks);
  const closed = !isOpen(task);
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
          {code && <span className="font-mono font-semibold text-ink-2">{code}</span>}
          <span className="truncate">{project.name}</span>
        </div>
        <p className={cn("mt-0.5 text-[14.5px] font-semibold leading-snug", closed && "text-ink-2")}>{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
          {task.priority !== "medium" && !closed && <PriorityMark priority={task.priority} withLabel />}
          {task.dueDate && (
            <span className={cn(isOverdue(task, today) && "font-semibold text-danger")}>{isOverdue(task, today) ? "Overdue · " : "Due "}{dueLabel(task.dueDate, today)}</span>
          )}
          {subs.total > 0 && <span>{subs.done}/{subs.total} subtasks</span>}
        </div>
      </div>
      <div role="radiogroup" aria-label="Status" className="flex flex-col gap-0.5">
        {TASK_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={task.status === s}
            onClick={() => { if (s !== task.status) void attempt(() => act.updateTask(task.id, { status: s })); close(); }}
            className={cn("ww-row flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", task.status === s && "bg-white/[0.07]")}
          >
            <i aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", ACCENT[s])} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium leading-tight">{TASK_STATUS_LABEL[s]}</span>
              <span className="block text-[11.5px] leading-snug text-ink-3">{TASK_STATUS_HINT[s]}</span>
            </span>
            {task.status === s && <Check size={14} className="shrink-0 text-ink-2" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <GlassButton className="self-start" onClick={() => { close(); editTask(task.id); }}>Open task</GlassButton>
    </div>
  );
}

/** A labelled on/off switch. */
function Switch({ checked, onChange, label, title }: { checked: boolean; onChange: (on: boolean) => void; label: string; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] font-semibold text-ink-2 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className={cn("relative h-[18px] w-8 rounded-full border transition-colors", checked ? "border-crimson-text/50 bg-crimson" : "border-white/15 bg-white/10")}>
        <span className={cn("absolute top-[2px] size-3 rounded-full bg-white transition-[left]", checked ? "left-[16px]" : "left-[2px]")} />
      </span>
      {label}
    </button>
  );
}
