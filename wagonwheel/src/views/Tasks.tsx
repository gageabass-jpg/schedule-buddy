import { useMemo, useState, type ReactNode } from "react";
import { ListChecks, Plus, Search } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@nucleus/ui/ui/tabs";
import { PRIORITIES, PRIORITY_LABEL, type Priority, type Task } from "@shared/types";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { compareTasks, isOpen, isOverdue, liveProjects, visibleTasks } from "@/lib/derive";
import { addDays } from "@/lib/dates";
import { EmptyState, PageHeader, Section } from "@/components/kit";
import { GlassButton } from "@/components/GlassButton";
import { TaskRow } from "@/components/TaskRow";

type Show = "open" | "done" | "all";

/** Every task, grouped by when it is due. Filter by state, project, priority or words. */
export function Tasks() {
  const { snapshot, today } = useData();
  const { newTask } = useUi();
  const [show, setShow] = useState<Show>("open");
  const [project, setProject] = useState("");          // "" = all, "inbox" = unsorted, else a project id
  const [priority, setPriority] = useState<"" | Priority>("");
  const [query, setQuery] = useState("");

  const all = useMemo(() => visibleTasks(snapshot), [snapshot]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mine = all.filter((t) =>
      (show === "all" || (show === "open" ? isOpen(t) : !isOpen(t))) &&
      (!project || (project === "inbox" ? !t.projectId : t.projectId === project)) &&
      (!priority || t.priority === priority) &&
      (!q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)),
    ).sort(compareTasks);

    const week = addDays(today, 7);
    const buckets: { title: string; tasks: Task[] }[] = [
      { title: "Overdue", tasks: mine.filter((t) => isOverdue(t, today)) },
      { title: "Today", tasks: mine.filter((t) => isOpen(t) && t.dueDate === today) },
      { title: "Next 7 days", tasks: mine.filter((t) => isOpen(t) && !!t.dueDate && t.dueDate > today && t.dueDate <= week) },
      { title: "Later", tasks: mine.filter((t) => isOpen(t) && !!t.dueDate && t.dueDate > week) },
      { title: "No date", tasks: mine.filter((t) => isOpen(t) && !t.dueDate) },
      { title: "Done", tasks: mine.filter((t) => !isOpen(t)) },
    ];
    return { total: mine.length, buckets: buckets.filter((b) => b.tasks.length) };
  }, [all, show, project, priority, query, today]);

  const filtered = !!project || !!priority || !!query.trim();

  return (
    <>
      <PageHeader
        title="All Tasks"
        subtitle={`${groups.total} ${groups.total === 1 ? "task" : "tasks"}${filtered ? " match" : ""}`}
        actions={<GlassButton tone="primary" onClick={() => newTask()}><Plus size={15} />New task</GlassButton>}
      />
      <div className="flex flex-wrap items-center gap-3 px-8 pb-3">
        <Tabs value={show} onValueChange={(v) => setShow(v as Show)}>
          <TabsList>
            <TabsTrigger value="open">Open</TabsTrigger>
            <TabsTrigger value="done">Done</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" className="ww-field !pl-9" />
        </div>
        <Select label="Project" value={project} onChange={setProject}>
          <option value="">All projects</option>
          <option value="inbox">Inbox (unsorted)</option>
          {liveProjects(snapshot).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select label="Priority" value={priority} onChange={(v) => setPriority(v as "" | Priority)}>
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {groups.total === 0 ? (
          <EmptyState
            icon={<ListChecks size={20} />}
            title={filtered ? "No tasks match" : show === "done" ? "Nothing done yet" : "No tasks"}
            body={filtered ? "Try a different search or clear a filter." : "Add a task, or capture one in the inbox."}
            action={filtered ? <GlassButton onClick={() => { setProject(""); setPriority(""); setQuery(""); }}>Clear filters</GlassButton> : <GlassButton tone="primary" onClick={() => newTask()}><Plus size={15} />New task</GlassButton>}
          />
        ) : (
          <div className="ww-rise flex flex-col gap-5">
            {groups.buckets.map((b) => (
              <Section key={b.title} title={b.title} count={b.tasks.length}>
                <div className="glass-card flex flex-col p-1.5">{b.tasks.map((t) => <TaskRow key={t.id} task={t} />)}</div>
              </Section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="ww-field !w-[170px]">{children}</select>;
}
