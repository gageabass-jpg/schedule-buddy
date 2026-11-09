import { useRef, useState } from "react";
import { Check, Inbox as InboxIcon, Plus } from "lucide-react";
import { TrashIcon } from "@nucleus/ui/ui/trash";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { inboxTasks, liveProjects } from "@/lib/derive";
import { EmptyState, IconButton, PageHeader } from "@/components/kit";
import { TaskCheck } from "@/components/TaskRow";

/** Capture now, organize later. Each unsorted task can get a project and a date right here. */
export function Inbox() {
  const { snapshot, act, attempt } = useData();
  const { editTask } = useUi();
  const items = inboxTasks(snapshot.tasks);
  const projects = liveProjects(snapshot);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const capture = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    if (!(await attempt(() => act.createTask({ title })))) setDraft(title);
    input.current?.focus();
  };

  return (
    <>
      <PageHeader title="Inbox" subtitle={items.length ? `${items.length} unsorted ${items.length === 1 ? "task" : "tasks"}. Give each a project and it leaves the inbox.` : "Capture first. Organize later."} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        <div className="relative mb-4">
          <Plus size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void capture(); }}
            placeholder="Capture a task or an idea…  ↵"
            aria-label="Capture a task to the inbox"
            maxLength={120}
            className="ww-field !min-h-11 !pl-10 !text-[15px]"
          />
        </div>

        {items.length === 0 ? (
          <EmptyState icon={<Check size={20} />} title="You're all caught up" body="Nothing to organize right now. New captures land here until you give them a project." />
        ) : (
          <ul className="ww-rise glass-card flex flex-col p-1.5">
            {items.map((t) => (
              <li key={t.id} className="ww-row flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5">
                <TaskCheck task={t} />
                <button type="button" onClick={() => editTask(t.id)} className="min-w-[160px] flex-1 truncate text-left text-[14.5px] font-medium hover:underline decoration-white/30 underline-offset-2">{t.title}</button>
                <input
                  type="date"
                  value={t.dueDate ?? ""}
                  onChange={(e) => void attempt(() => act.updateTask(t.id, { dueDate: e.target.value || null }))}
                  aria-label={`Due date for "${t.title}"`}
                  className="ww-field !min-h-8 !w-[148px] !text-[13px]"
                />
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) void attempt(() => act.updateTask(t.id, { projectId: e.target.value })); }}
                  aria-label={`Move "${t.title}" to a project`}
                  disabled={projects.length === 0}
                  className="ww-field !min-h-8 !w-[180px] !text-[13px]"
                >
                  <option value="">{projects.length ? "Move to project…" : "Create a project first"}</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <IconButton label="Delete task" onClick={() => void attempt(() => act.deleteTask(t.id))}><TrashIcon size={15} /></IconButton>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-ink-3"><InboxIcon size={13} />Tip: ⌘L captures a task from anywhere.</p>
      </div>
    </>
  );
}
