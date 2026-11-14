import { useMemo, type ReactNode } from "react";
import { ArrowRight, Flag, FolderKanban, Plus } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { TriangleAlertIcon } from "@nucleus/ui/ui/triangle-alert";
import type { Task } from "@shared/types";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { dashboard, projectProgress } from "@/lib/derive";
import { formatLong, formatShort, relativeDay } from "@/lib/dates";
import { projectColor } from "@/lib/colors";
import { timeAgo } from "@/lib/time";
import { EmptyState, PageHeader, ProgressBar, Section } from "@/components/kit";
import { GlassButton } from "@/components/GlassButton";
import { ScanGithubButton } from "@/components/PageTools";
import { ProjectCard } from "@/components/ProjectCard";
import { TaskRow } from "@/components/TaskRow";

/** The overview. Restrained on purpose: what is late, what is next, what is moving. */
export function Dashboard() {
  const { snapshot, today, now } = useData();
  const { newProject, newTask, go } = useUi();
  const d = useMemo(() => dashboard(snapshot, today, now), [snapshot, today, now]);
  const empty = snapshot.projects.length === 0 && snapshot.tasks.length === 0;

  const bits = [
    formatLong(today),
    `${d.activeProjects.length} active ${d.activeProjects.length === 1 ? "project" : "projects"}`,
    `${d.openTasks} open ${d.openTasks === 1 ? "task" : "tasks"}`,
    ...(d.overdue.length ? [`${d.overdue.length} overdue`] : []),
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={bits.join(" · ")}
        actions={<>
          <ScanGithubButton />
          <GlassButton onClick={() => newTask()}><Plus size={15} />New task</GlassButton>
          <GlassButton tone="primary" onClick={newProject}><Plus size={15} />New project</GlassButton>
        </>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {empty ? (
          <EmptyState
            icon={<FolderKanban size={20} />}
            title="Start with a project"
            body="A project holds its tasks, milestones and notes. Capture loose ideas in the inbox and file them later."
            action={<GlassButton tone="primary" onClick={newProject}><Plus size={15} />New project</GlassButton>}
          />
        ) : (
          <div className="ww-rise grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,1fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              <Section title="Active projects" count={d.activeProjects.length} action={<LinkButton onClick={() => go({ name: "projects" })}>All projects</LinkButton>}>
                {d.activeProjects.length ? (
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(270px,1fr))]">
                    {d.activeProjects.slice(0, 6).map((p) => <ProjectCard key={p.id} project={p} />)}
                  </div>
                ) : <Card><EmptyState compact icon={<FolderKanban size={18} />} title="No active projects" action={<GlassButton onClick={newProject}>New project</GlassButton>} /></Card>}
              </Section>

              {d.recent.length > 0 && (
                <Section title="Recently updated">
                  <Card>
                    {d.recent.map((p) => {
                      const prog = projectProgress(p.id, snapshot.tasks);
                      return (
                        <button key={p.id} type="button" onClick={() => go({ name: "project", id: p.id })} className="ww-row flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left">
                          <i className="size-2.5 shrink-0 rounded-full" style={{ background: projectColor(p.color) }} />
                          <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{p.name}</span>
                          <span className="hidden w-28 sm:block"><ProgressBar pct={prog.pct} color={p.color} /></span>
                          <span className="w-32 shrink-0 text-right text-[12.5px] text-ink-3">{timeAgo(p.updatedAt, now)}</span>
                        </button>
                      );
                    })}
                  </Card>
                </Section>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-6">
              {d.overdue.length > 0 && (
                <Section title="Overdue" count={d.overdue.length}>
                  <TaskCard tasks={d.overdue} tone="danger" icon={<TriangleAlertIcon size={14} isAnimated={false} />} />
                </Section>
              )}
              <Section title="Due soon" count={d.dueSoon.length} action={<LinkButton onClick={() => go({ name: "tasks" })}>All tasks</LinkButton>}>
                {d.dueSoon.length ? <TaskCard tasks={d.dueSoon} /> : <Card><p className="px-4 py-5 text-[13.5px] text-ink-3">Nothing due in the next two weeks.</p></Card>}
              </Section>
              {d.attention.length > 0 && (
                <Section title="Needs attention" count={d.attention.length}>
                  <Card>
                    {d.attention.slice(0, 5).map((a) => (
                      <div key={a.task.id}>
                        <TaskRow task={a.task} />
                        <p className="-mt-1.5 pb-2 pl-[3.1rem] text-[12px] font-medium text-warn">{a.reason}</p>
                      </div>
                    ))}
                  </Card>
                </Section>
              )}
              <Section title="Upcoming milestones" count={d.milestones.length}>
                {d.milestones.length ? (
                  <Card>
                    {d.milestones.map((m) => {
                      const p = snapshot.projects.find((x) => x.id === m.projectId);
                      const late = m.targetDate < today;
                      return (
                        <button key={m.id} type="button" onClick={() => go({ name: "project", id: m.projectId, tab: "milestones" })} className="ww-row flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left">
                          <Flag size={15} className={late ? "text-danger" : "text-warn"} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium">{m.name}</span>
                            <span className="block truncate text-[12.5px] text-ink-3">{p?.name}</span>
                          </span>
                          <span className={cn("shrink-0 text-right text-[12.5px]", late ? "font-semibold text-danger" : "text-ink-2")}>{formatShort(m.targetDate, today)}<br /><span className="text-ink-3">{relativeDay(m.targetDate, today).toLowerCase()}</span></span>
                        </button>
                      );
                    })}
                  </Card>
                ) : <Card><p className="px-4 py-5 text-[13.5px] text-ink-3">No open milestones.</p></Card>}
              </Section>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="glass-card flex flex-col p-1.5">{children}</div>;
}

function TaskCard({ tasks, tone, icon }: { tasks: Task[]; tone?: "danger"; icon?: ReactNode }) {
  const { go } = useUi();
  const shown = tasks.slice(0, 6);
  return (
    <div className={cn("glass-card flex flex-col p-1.5", tone === "danger" && "!border-danger/20")}>
      {shown.map((t) => <TaskRow key={t.id} task={t} />)}
      {tasks.length > shown.length && (
        <button type="button" onClick={() => go({ name: "tasks" })} className="ww-row flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold text-ink-2">
          {icon}{tasks.length - shown.length} more <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-2 hover:text-foreground">{children}<ArrowRight size={13} /></button>;
}
