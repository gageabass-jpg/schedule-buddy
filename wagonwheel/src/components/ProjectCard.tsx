import { CalendarDays, GitBranch } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import type { Project } from "@shared/types";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { projectProgress } from "@/lib/derive";
import { projectColor } from "@/lib/colors";
import { formatShort, relativeDay } from "@/lib/dates";
import { ProgressBar, ProjectStatusChip } from "./kit";

/** A project as a glass card: its colour, status, progress and next date. */
export function ProjectCard({ project }: { project: Project }) {
  const { snapshot, today } = useData();
  const { go } = useUi();
  const { done, total, pct } = projectProgress(project.id, snapshot.tasks);
  const color = projectColor(project.color);
  const late = !!project.targetDate && project.targetDate < today && project.status !== "completed";

  return (
    <button
      type="button"
      onClick={() => go({ name: "project", id: project.id })}
      data-interactive="true"
      className={cn("glass-card group flex w-full flex-col gap-3 overflow-hidden p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", project.archivedAt && "opacity-60")}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <i className="size-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}88` }} />
            <h3 className="truncate text-[15.5px] font-semibold tracking-tight">{project.name}</h3>
          </div>
          {project.description && <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-2">{project.description}</p>}
        </div>
        <ProjectStatusChip status={project.status} />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
          <span className="text-ink-2">{total ? `${done} of ${total} tasks` : "No tasks yet"}</span>
          <span className="font-semibold">{total ? `${pct}%` : ""}</span>
        </div>
        <ProgressBar pct={pct} color={color} />
      </div>
      {project.targetDate && (
        <div className={cn("flex items-center gap-1.5 text-[12.5px]", late ? "font-semibold text-danger" : "text-ink-3")}>
          <CalendarDays size={13} />
          Target {formatShort(project.targetDate, today)} · {relativeDay(project.targetDate, today).toLowerCase()}
        </div>
      )}
      {project.githubRepo && (
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-3" title={`Connected to ${project.githubRepo} on GitHub`}>
          <GitBranch size={13} className="shrink-0" />
          <span className="truncate">{project.githubRepo}</span>
        </div>
      )}
    </button>
  );
}
