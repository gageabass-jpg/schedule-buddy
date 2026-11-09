import { useMemo, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Flag, Plus } from "lucide-react";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { dayContents } from "@/lib/derive";
import { addDays, formatLong, relativeDay } from "@/lib/dates";
import { projectColor } from "@/lib/colors";
import { EmptyState, IconButton, PageHeader, Section } from "@/components/kit";
import { GlassButton } from "@/components/GlassButton";
import { TaskRow } from "@/components/TaskRow";

/** One day's agenda: what is due, what starts, which milestones and project deadlines fall on it.
 *  Opened by picking a date in the sidebar calendar. */
export function DayView({ date }: { date: string }) {
  const { snapshot, today } = useData();
  const { newTask, go, selectDate } = useUi();
  const c = useMemo(() => dayContents(snapshot, date, today), [snapshot, date, today]);
  const nothing = !c.due.length && !c.starting.length && !c.milestones.length && !c.deadlines.length && !c.overdue.length;

  return (
    <>
      <PageHeader
        title={formatLong(date)}
        subtitle={relativeDay(date, today)}
        actions={<>
          <IconButton label="Previous day" onClick={() => selectDate(addDays(date, -1))}><ChevronLeft size={17} /></IconButton>
          <GlassButton onClick={() => selectDate(today)} disabled={date === today}>Today</GlassButton>
          <IconButton label="Next day" onClick={() => selectDate(addDays(date, 1))}><ChevronRight size={17} /></IconButton>
          <GlassButton tone="primary" onClick={() => newTask({ dueDate: date })}><Plus size={15} />Add task</GlassButton>
        </>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {nothing ? (
          <EmptyState icon={<CalendarDays size={20} />} title="Nothing scheduled" body="No tasks, milestones or deadlines fall on this day." action={<GlassButton tone="primary" onClick={() => newTask({ dueDate: date })}><Plus size={15} />Add a task for this day</GlassButton>} />
        ) : (
          <div className="ww-rise flex flex-col gap-5">
            {c.overdue.length > 0 && <Section title="Overdue" count={c.overdue.length}><Card>{c.overdue.map((t) => <TaskRow key={t.id} task={t} />)}</Card></Section>}
            {c.due.length > 0 && <Section title="Due" count={c.due.length}><Card>{c.due.map((t) => <TaskRow key={t.id} task={t} />)}</Card></Section>}
            {c.starting.length > 0 && <Section title="Starting" count={c.starting.length}><Card>{c.starting.map((t) => <TaskRow key={t.id} task={t} />)}</Card></Section>}
            {c.milestones.length > 0 && (
              <Section title="Milestones" count={c.milestones.length}>
                <Card>
                  {c.milestones.map((m) => (
                    <button key={m.id} type="button" onClick={() => go({ name: "project", id: m.projectId, tab: "milestones" })} className="ww-row flex items-center gap-3 rounded-xl px-3 py-2.5 text-left">
                      <Flag size={15} className="text-warn" />
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{m.name}</span>
                      <span className="text-[12.5px] text-ink-3">{snapshot.projects.find((p) => p.id === m.projectId)?.name}</span>
                    </button>
                  ))}
                </Card>
              </Section>
            )}
            {c.deadlines.length > 0 && (
              <Section title="Project deadlines" count={c.deadlines.length}>
                <Card>
                  {c.deadlines.map((p) => (
                    <button key={p.id} type="button" onClick={() => go({ name: "project", id: p.id })} className="ww-row flex items-center gap-3 rounded-xl px-3 py-2.5 text-left">
                      <i className="size-2.5 rounded-full" style={{ background: projectColor(p.color) }} />
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{p.name}</span>
                      <span className="text-[12.5px] text-ink-3">Target date</span>
                    </button>
                  ))}
                </Card>
              </Section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

const Card = ({ children }: { children: ReactNode }) => <div className="glass-card flex flex-col p-1.5">{children}</div>;
