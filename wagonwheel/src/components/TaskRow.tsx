import { useRef } from "react";
import { CircleSlash, ListChecks } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { CircleCheckIcon, type CircleCheckIconHandle } from "@nucleus/ui/ui/circle-check";
import { TriangleAlertIcon } from "@nucleus/ui/ui/triangle-alert";
import { TASK_STATUS_LABEL, taskCode, type Task } from "@shared/types";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { dueLabel, isOverdue, subtaskProgress } from "@/lib/derive";
import { projectColor } from "@/lib/colors";
import { Chip, PriorityMark, TASK_STATUS_TONE } from "./kit";

/** The round tick at a task's left. Complete is the shared animated circle-check, in green. A Discontinued task shows a struck circle instead, and the tick reopens it. */
export function TaskCheck({ task }: { task: Task }) {
  const { act, attempt } = useData();
  const icon = useRef<CircleCheckIconHandle>(null);
  const done = task.status === "done";
  const dropped = task.status === "discontinued";
  const label = dropped ? `Reopen "${task.title}"` : done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      title={dropped ? "Discontinued. Click to reopen." : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!done && !dropped) icon.current?.startAnimation();
        void attempt(() => act.updateTask(task.id, { status: done || dropped ? "not_started" : "done" }));
      }}
      className="grid size-6 shrink-0 place-items-center rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {done
        ? <CircleCheckIcon ref={icon} size={20} color="#6cc49a" isAnimated={false} />
        : dropped
          ? <CircleSlash size={19} className="text-ink-3" aria-hidden="true" />
          : <span className="size-[18px] rounded-full border-[1.5px] border-white/35 transition-colors hover:border-rose hover:bg-white/10" />}
    </button>
  );
}

/** A task as one row. Click it to open the task. Used in every list. */
export function TaskRow({ task, showProject = true, className }: { task: Task; showProject?: boolean; className?: string }) {
  const { snapshot, today } = useData();
  const { editTask, go } = useUi();
  const project = task.projectId ? snapshot.projects.find((p) => p.id === task.projectId) : undefined;
  const parent = task.parentId ? snapshot.tasks.find((t) => t.id === task.parentId) : undefined;
  const subs = subtaskProgress(task.id, snapshot.tasks);
  const done = task.status === "done";
  const closed = done || task.status === "discontinued";
  const code = taskCode(task, project);
  const overdue = isOverdue(task, today);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => editTask(task.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); editTask(task.id); } }}
      className={cn("ww-row group flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
    >
      <TaskCheck task={task} />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-[14.5px] font-medium", closed && "text-ink-3 line-through decoration-white/25")}>{task.title}</div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-3">
          {code && <span className="font-mono text-[11.5px] tracking-tight text-ink-2" title="Task identifier">{code}</span>}
          {parent && <span className="truncate">in {parent.title}</span>}
          {showProject && project && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); go({ name: "project", id: project.id }); }}
              className="inline-flex items-center gap-1.5 truncate hover:text-foreground"
            >
              <i className="size-2 shrink-0 rounded-full" style={{ background: projectColor(project.color) }} />{project.name}
            </button>
          )}
          {showProject && !project && !parent && <span className="inline-flex items-center gap-1"><ListChecks size={12} />Inbox</span>}
          {task.dueDate && (
            overdue
              ? <span className="inline-flex items-center gap-1 font-semibold text-danger"><TriangleAlertIcon size={12} isAnimated={false} />Overdue · {dueLabel(task.dueDate, today)}</span>
              : <span className={cn(task.dueDate === today && !closed && "font-semibold text-warn")}>{dueLabel(task.dueDate, today)}</span>
          )}
          {subs.total > 0 && <span title="Subtasks done">{subs.done}/{subs.total} subtasks</span>}
        </div>
      </div>
      {task.status !== "not_started" && task.status !== "done" && <Chip tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</Chip>}
      {!closed && task.priority !== "medium" && <PriorityMark priority={task.priority} />}
    </div>
  );
}
