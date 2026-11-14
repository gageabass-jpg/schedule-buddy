import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { TrashIcon } from "@nucleus/ui/ui/trash";
import {
  PRIORITIES, PRIORITY_LABEL, PROJECT_STATUSES, PROJECT_STATUS_LABEL, TASK_STATUSES, TASK_STATUS_LABEL,
  type Priority, type ProjectStatus, type TaskStatus,
} from "@shared/types";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { messageOf } from "@/lib/bridge";
import { liveProjects, subtasksOf } from "@/lib/derive";
import { PROJECT_COLORS, projectColor } from "@/lib/colors";
import { cn } from "@nucleus/ui/lib/utils";
import { Field, FormError, IconButton, Modal } from "./kit";
import { GlassButton } from "./GlassButton";
import { ConnectorsDialog } from "./ConnectorsDialog";
import { ServiceDialog } from "./ServiceDialog";
import { GithubDialog } from "./GithubDialog";
import { Notes } from "./Notes";
import { TaskCheck } from "./TaskRow";

// Every dialog in the app. Each saves through the store, which sends the change to SQLite;
// a refusal (a bad date range, say) is shown inside the dialog, in words.

const nullIfBlank = (v: string): string | null => (v.trim() === "" ? null : v);

export function Dialogs() {
  const ui = useUi();
  return (
    <>
      {ui.taskDialog && <TaskDialog key={ui.taskDialog.id ?? "new"} />}
      {ui.projectDialog && <ProjectDialog key={ui.projectDialog.id ?? "new"} />}
      {ui.milestoneDialog && <MilestoneDialog key={ui.milestoneDialog.id ?? "new"} />}
      {ui.serviceDialog && <ServiceDialog key={ui.serviceDialog.id ?? "new"} />}
      {ui.connectorsDialog && <ConnectorsDialog />}
      {ui.githubDialog && <GithubDialog key={ui.githubDialog.mode === "scan" ? "scan" : `${ui.githubDialog.mode}:${ui.githubDialog.projectId}`} state={ui.githubDialog} />}
      <ConfirmDialog />
    </>
  );
}

// ── Confirm ─────────────────────────────────────────────────────────────────

function ConfirmDialog() {
  const { confirming } = useUi();
  const [shown, setShown] = useState(confirming);
  useEffect(() => { if (confirming) setShown(confirming); }, [confirming]);
  if (!shown) return null;
  const answer = (ok: boolean) => { shown.resolve(ok); setShown(null); };
  return (
    <Modal
      open={!!confirming}
      onOpenChange={(open) => { if (!open) answer(false); }}
      title={shown.title}
      width={440}
      footer={<>
        <GlassButton tone="ghost" onClick={() => answer(false)}>Cancel</GlassButton>
        <GlassButton tone={shown.danger ? "danger" : "primary"} onClick={() => answer(true)}>{shown.confirmLabel}</GlassButton>
      </>}
    >
      <p className="text-[14.5px] leading-relaxed text-ink-2">{shown.body}</p>
    </Modal>
  );
}

// ── Task ────────────────────────────────────────────────────────────────────

function TaskDialog() {
  const { taskDialog, closeTask, confirm } = useUi();
  const { snapshot, act, attempt, attemptOk, today } = useData();
  const existing = taskDialog?.id ? snapshot.tasks.find((t) => t.id === taskDialog.id) : undefined;
  const defaults = taskDialog?.id === null ? taskDialog.defaults : undefined;
  const parent = (existing?.parentId ?? defaults?.parentId) ? snapshot.tasks.find((t) => t.id === (existing?.parentId ?? defaults?.parentId)) : undefined;
  const isSub = !!parent;

  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [projectId, setProjectId] = useState(existing?.projectId ?? defaults?.projectId ?? "");
  const [status, setStatus] = useState<TaskStatus>(existing?.status ?? "not_started");
  const [priority, setPriority] = useState<Priority>(existing?.priority ?? "medium");
  const [startDate, setStartDate] = useState(existing?.startDate ?? "");
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? defaults?.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subDraft, setSubDraft] = useState("");

  const projects = useMemo(() => {
    const live = liveProjects(snapshot);
    const own = existing?.projectId ? snapshot.projects.find((p) => p.id === existing.projectId) : undefined;
    return own && own.archivedAt ? [own, ...live] : live;
  }, [snapshot, existing]);
  const subtasks = existing ? subtasksOf(snapshot.tasks, existing.id) : [];

  // The task can vanish under the dialog (deleted elsewhere). Close rather than show stale data.
  useEffect(() => { if (taskDialog?.id && !existing) closeTask(); }, [taskDialog, existing, closeTask]);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fields = { title, description, priority, status, startDate: nullIfBlank(startDate), dueDate: nullIfBlank(dueDate) };
      if (existing) await act.updateTask(existing.id, { ...fields, projectId: isSub ? undefined : projectId || null });
      else await act.createTask({ ...fields, projectId: projectId || null, parentId: defaults?.parentId ?? null });
      closeTask();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const n = subtasks.length;
    const ok = await confirm({
      title: "Delete this task?",
      body: `"${existing.title}"${n ? ` and its ${n} ${n === 1 ? "subtask" : "subtasks"}` : ""} will be deleted, with their notes. This cannot be undone.`,
      confirmLabel: "Delete task",
      danger: true,
    });
    if (!ok) return;
    if (await attemptOk(() => act.deleteTask(existing.id))) closeTask();
  };

  const addSub = async () => {
    const t = subDraft.trim();
    if (!t || !existing) return;
    setSubDraft("");
    const id = await attempt(() => act.createTask({ title: t, parentId: existing.id }));
    if (!id) setSubDraft(t);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) closeTask(); }}
      title={existing ? (isSub ? "Subtask" : "Task") : isSub ? "New subtask" : "New task"}
      description={parent ? `Part of "${parent.title}"` : undefined}
      width={isSub ? 520 : 620}
      footer={<>
        {existing && <GlassButton tone="danger" className="mr-auto" onClick={() => void remove()}><TrashIcon size={14} />Delete</GlassButton>}
        <GlassButton tone="ghost" onClick={closeTask}>Cancel</GlassButton>
        <GlassButton tone="primary" onClick={() => void save()} disabled={busy || !title.trim()}>{existing ? "Save" : "Add task"}</GlassButton>
      </>}
    >
      <form onSubmit={save} className="flex flex-col gap-4 pb-1">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus maxLength={120} className="ww-field !min-h-10 !text-[15px]" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {!isSub && (
            <Field label="Project">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="ww-field">
                <option value="">Inbox (no project)</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archivedAt ? " (archived)" : ""}</option>)}
              </select>
            </Field>
          )}
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="ww-field">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="ww-field">
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Start date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="ww-field" />
          </Field>
          <Field label="Due date" hint={dueDate && dueDate < today && status !== "done" ? "This date has passed." : undefined}>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="ww-field" />
          </Field>
        </div>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(); }} rows={3} placeholder="Details, context, links…" className="ww-field" />
        </Field>
        <FormError message={error} />
        <button type="submit" hidden />
      </form>

      {existing && !isSub && (
        <section className="mt-3 border-t border-white/[0.07] pt-4" aria-label="Subtasks">
          <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-3">Subtasks {subtasks.length ? `· ${subtasks.filter((s) => s.status === "done").length}/${subtasks.length}` : ""}</h3>
          <ul className="mb-2 flex flex-col">
            {subtasks.map((s) => (
              <li key={s.id} className="ww-row flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                <TaskCheck task={s} />
                <span className={cn("min-w-0 flex-1 truncate text-[14px]", s.status === "done" && "text-ink-3 line-through decoration-white/25")}>{s.title}</span>
                <IconButton label="Delete subtask" onClick={() => void attempt(() => act.deleteTask(s.id))}><TrashIcon size={14} /></IconButton>
              </li>
            ))}
          </ul>
          <div className="relative">
            <Plus size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={subDraft}
              onChange={(e) => setSubDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addSub(); } }}
              placeholder="Add a subtask…  ↵"
              aria-label="Add a subtask"
              maxLength={120}
              className="ww-field !pl-8"
            />
          </div>
        </section>
      )}

      {existing && (
        <section className="mt-4 border-t border-white/[0.07] pt-4" aria-label="Notes">
          <h3 className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-3">Notes</h3>
          <Notes target={{ taskId: existing.id }} />
        </section>
      )}
    </Modal>
  );
}

// ── Project ─────────────────────────────────────────────────────────────────

function ProjectDialog() {
  const { projectDialog, closeProject, confirm, go } = useUi();
  const { snapshot, act, attemptOk } = useData();
  const existing = projectDialog?.id ? snapshot.projects.find((p) => p.id === projectDialog.id) : undefined;

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(existing?.status ?? "active");
  const [color, setColor] = useState<string>(projectColor(existing?.color));
  const [startDate, setStartDate] = useState(existing?.startDate ?? "");
  const [targetDate, setTargetDate] = useState(existing?.targetDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (projectDialog?.id && !existing) closeProject(); }, [projectDialog, existing, closeProject]);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fields = { name, description, status, color, startDate: nullIfBlank(startDate), targetDate: nullIfBlank(targetDate) };
      if (existing) await act.updateProject(existing.id, fields);
      else { const id = await act.createProject(fields); go({ name: "project", id }); }
      closeProject();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  const toggleArchive = async () => {
    if (!existing) return;
    if (await attemptOk(() => act.updateProject(existing.id, { archived: !existing.archivedAt }))) closeProject();
  };

  const remove = async () => {
    if (!existing) return;
    const own = snapshot.tasks.filter((t) => t.projectId === existing.id).length;
    const ms = snapshot.milestones.filter((m) => m.projectId === existing.id).length;
    const ok = await confirm({
      title: "Delete this project?",
      body: `"${existing.name}" will be deleted with its ${own} ${own === 1 ? "task" : "tasks"}, ${ms} ${ms === 1 ? "milestone" : "milestones"} and all its notes. This cannot be undone. To keep them, archive the project instead.`,
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    if (!(await attemptOk(() => act.deleteProject(existing.id)))) return;
    closeProject();
    go({ name: "projects" });
  };

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) closeProject(); }}
      title={existing ? "Edit project" : "New project"}
      width={560}
      footer={<>
        {existing && <GlassButton tone="danger" onClick={() => void remove()}><TrashIcon size={14} />Delete</GlassButton>}
        {existing && <GlassButton className="mr-auto" onClick={() => void toggleArchive()}>{existing.archivedAt ? "Unarchive" : "Archive"}</GlassButton>}
        <GlassButton tone="ghost" onClick={closeProject}>Cancel</GlassButton>
        <GlassButton tone="primary" onClick={() => void save()} disabled={busy || !name.trim()}>{existing ? "Save" : "Create project"}</GlassButton>
      </>}
    >
      <form onSubmit={save} className="flex flex-col gap-4 pb-1">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" autoFocus maxLength={120} className="ww-field !min-h-10 !text-[15px]" />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What is this project for?" className="ww-field" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className="ww-field">
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Start date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="ww-field" /></Field>
          <Field label="Target date"><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="ww-field" /></Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-3">Colour</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Project colour">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c.hex} type="button" role="radio" aria-checked={color.toUpperCase() === c.hex} aria-label={c.name} title={c.name}
                onClick={() => setColor(c.hex)}
                className={cn("size-7 rounded-full border-2 transition-transform hover:scale-110", color.toUpperCase() === c.hex ? "border-white" : "border-transparent")}
                style={{ background: c.hex, boxShadow: color.toUpperCase() === c.hex ? `0 0 12px ${c.hex}aa` : undefined }}
              />
            ))}
          </div>
        </fieldset>
        <FormError message={error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ── Milestone ───────────────────────────────────────────────────────────────

function MilestoneDialog() {
  const { milestoneDialog, closeMilestone, confirm } = useUi();
  const { snapshot, act, attemptOk } = useData();
  const existing = milestoneDialog?.id ? snapshot.milestones.find((m) => m.id === milestoneDialog.id) : undefined;
  const projectId = milestoneDialog?.projectId ?? "";

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [targetDate, setTargetDate] = useState(existing?.targetDate ?? "");
  const [completed, setCompleted] = useState(!!existing?.completedAt);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (milestoneDialog?.id && !existing) closeMilestone(); }, [milestoneDialog, existing, closeMilestone]);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (existing) await act.updateMilestone(existing.id, { name, description, targetDate, completed });
      else await act.createMilestone({ projectId, name, description, targetDate, completed });
      closeMilestone();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({ title: "Delete this milestone?", body: `"${existing.name}" will be deleted. This cannot be undone.`, confirmLabel: "Delete milestone", danger: true });
    if (!ok) return;
    if (await attemptOk(() => act.deleteMilestone(existing.id))) closeMilestone();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) closeMilestone(); }}
      title={existing ? "Edit milestone" : "New milestone"}
      width={500}
      footer={<>
        {existing && <GlassButton tone="danger" className="mr-auto" onClick={() => void remove()}><TrashIcon size={14} />Delete</GlassButton>}
        <GlassButton tone="ghost" onClick={closeMilestone}>Cancel</GlassButton>
        <GlassButton tone="primary" onClick={() => void save()} disabled={busy || !name.trim() || !targetDate}>{existing ? "Save" : "Add milestone"}</GlassButton>
      </>}
    >
      <form onSubmit={save} className="flex flex-col gap-4 pb-1">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. First working build" autoFocus maxLength={120} className="ww-field !min-h-10 !text-[15px]" /></Field>
        <Field label="Target date"><input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="ww-field" /></Field>
        <Field label="Description (optional)"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="ww-field" /></Field>
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} className="size-4 accent-[#c62845]" />
          Completed
        </label>
        <FormError message={error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
