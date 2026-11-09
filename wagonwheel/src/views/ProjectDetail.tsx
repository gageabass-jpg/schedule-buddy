import { useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, Flag, ListChecks, Pencil, Plus } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@nucleus/ui/ui/tabs";
import { useData } from "@/lib/store";
import { useUi, type ProjectTab } from "@/lib/ui-state";
import { compareTasks, projectProgress } from "@/lib/derive";
import { formatRange, formatShort, relativeDay } from "@/lib/dates";
import { projectColor } from "@/lib/colors";
import { EmptyState, PageHeader, ProgressRing, ProjectStatusChip } from "@/components/kit";
import { GlassButton } from "@/components/GlassButton";
import { Notes } from "@/components/Notes";
import { TaskRow } from "@/components/TaskRow";
import { TimelineView } from "@/views/TimelineView";

/** One project: its tasks, milestones and notes. */
export function ProjectDetail({ id, tab }: { id: string; tab?: ProjectTab }) {
  const { snapshot, today } = useData();
  const { go, editProject, newTask, newMilestone } = useUi();
  const [picked, setPicked] = useState<ProjectTab | null>(null);
  const current: ProjectTab = picked ?? tab ?? "tasks";
  const project = snapshot.projects.find((p) => p.id === id);
  const prog = useMemo(() => projectProgress(id, snapshot.tasks), [id, snapshot.tasks]);

  if (!project) {
    return <EmptyState icon={<ListChecks size={20} />} title="This project no longer exists" action={<GlassButton tone="primary" onClick={() => go({ name: "projects" })}>Back to projects</GlassButton>} />;
  }

  const color = projectColor(project.color);
  const tasks = snapshot.tasks.filter((t) => t.projectId === id && !t.parentId).sort(compareTasks);
  const milestones = snapshot.milestones.filter((m) => m.projectId === id);
  const notes = snapshot.notes.filter((n) => n.projectId === id);
  const range = formatRange(project.startDate, project.targetDate, today);

  return (
    <>
      <PageHeader
        back={<button type="button" onClick={() => go({ name: "projects" })} className="mb-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-2 hover:text-foreground"><ArrowLeft size={13} />All Projects</button>}
        title={<span className="flex items-center gap-3"><i className="size-3 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}99` }} />{project.name}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><ProjectStatusChip status={project.status} />{project.archivedAt && <span className="text-warn">Archived</span>}{range && <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} />{range}</span>}</span>}
        actions={<>
          <ProgressRing pct={prog.pct} color={color} label={`${prog.done} of ${prog.total} tasks done`} />
          <GlassButton onClick={() => editProject(id)}><Pencil size={14} />Edit</GlassButton>
          <GlassButton tone="primary" onClick={() => newTask({ projectId: id })}><Plus size={15} />New task</GlassButton>
        </>}
      />
      {project.description && <p className="max-w-[78ch] px-8 pb-3 text-[14px] leading-relaxed text-ink-2">{project.description}</p>}

      <div className="px-8 pb-3">
        <Tabs value={current} onValueChange={(v) => setPicked(v as ProjectTab)}>
          <TabsList>
            <TabsTrigger value="tasks">Tasks · {tasks.length}</TabsTrigger>
            <TabsTrigger value="milestones">Milestones · {milestones.length}</TabsTrigger>
            <TabsTrigger value="notes">Notes · {notes.length}</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {current === "tasks" && <TasksTab projectId={id} tasks={tasks} />}
        {current === "milestones" && (
          <div className="ww-rise flex flex-col gap-3">
            <div className="flex justify-end"><GlassButton onClick={() => newMilestone(id)}><Plus size={14} />Add milestone</GlassButton></div>
            {milestones.length === 0 ? (
              <EmptyState icon={<Flag size={20} />} title="No milestones" body="A milestone marks a date that matters: a first build, a launch, a review." action={<GlassButton tone="primary" onClick={() => newMilestone(id)}><Plus size={15} />Add milestone</GlassButton>} />
            ) : (
              <div className="glass-card flex flex-col p-1.5">
                {milestones.map((m) => <MilestoneRow key={m.id} milestoneId={m.id} projectId={id} />)}
              </div>
            )}
          </div>
        )}
        {current === "notes" && <div className="ww-rise max-w-[760px]"><Notes target={{ projectId: id }} /></div>}
        {current === "timeline" && <div className="ww-rise"><TimelineView projectId={id} embedded /></div>}
      </div>
    </>
  );
}

function TasksTab({ projectId, tasks }: { projectId: string; tasks: ReturnType<typeof useData>["snapshot"]["tasks"] }) {
  const { act, attempt } = useData();
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    if (!(await attempt(() => act.createTask({ title, projectId })))) setDraft(title);
    input.current?.focus();
  };
  return (
    <div className="ww-rise flex flex-col gap-3">
      <div className="relative">
        <Plus size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} placeholder="Add a task to this project…  ↵" aria-label="Add a task to this project" maxLength={120} className="ww-field !min-h-11 !pl-10 !text-[15px]" />
      </div>
      {tasks.length === 0 ? (
        <EmptyState compact icon={<ListChecks size={18} />} title="No tasks yet" body="Type above and press Return. Open a task to add subtasks, dates and notes." />
      ) : (
        <div className="glass-card flex flex-col p-1.5">{tasks.map((t) => <TaskRow key={t.id} task={t} showProject={false} />)}</div>
      )}
    </div>
  );
}

function MilestoneRow({ milestoneId, projectId }: { milestoneId: string; projectId: string }) {
  const { snapshot, act, attempt, today } = useData();
  const { editMilestone } = useUi();
  const m = snapshot.milestones.find((x) => x.id === milestoneId);
  if (!m) return null;
  const done = !!m.completedAt;
  const late = !done && m.targetDate < today;
  return (
    <div role="button" tabIndex={0} onClick={() => editMilestone(m.id, projectId)} onKeyDown={(e) => { if (e.key === "Enter") editMilestone(m.id, projectId); }} className="ww-row flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <button
        type="button" role="checkbox" aria-checked={done} aria-label={done ? `Reopen milestone "${m.name}"` : `Complete milestone "${m.name}"`}
        onClick={(e) => { e.stopPropagation(); void attempt(() => act.updateMilestone(m.id, { completed: !done })); }}
        className={cn("grid size-6 shrink-0 place-items-center rounded-md transition-transform hover:scale-110", done ? "text-ok" : late ? "text-danger" : "text-warn")}
      >
        <Flag size={16} fill={done ? "currentColor" : "none"} />
      </button>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[14.5px] font-medium", done && "text-ink-3 line-through decoration-white/25")}>{m.name}</span>
        {m.description && <span className="block truncate text-[12.5px] text-ink-3">{m.description}</span>}
      </span>
      <span className={cn("shrink-0 text-right text-[12.5px]", late ? "font-semibold text-danger" : "text-ink-2")}>
        {formatShort(m.targetDate, today)}<br /><span className="font-normal text-ink-3">{done ? "done" : relativeDay(m.targetDate, today).toLowerCase()}</span>
      </span>
    </div>
  );
}

