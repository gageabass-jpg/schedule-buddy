import { useMemo, useState } from "react";
import { Pencil, StickyNote } from "lucide-react";
import { TrashIcon } from "@nucleus/ui/ui/trash";
import { useData } from "@/lib/store";
import { GlassButton } from "./GlassButton";
import { EmptyState, FormError, IconButton } from "./kit";
import { messageOf } from "@/lib/bridge";

/** Short notes on a project or a task, newest first. Plain text: no editor, on purpose. */
export function Notes({ target }: { target: { projectId: string } | { taskId: string } }) {
  const { snapshot, act, attempt } = useData();
  const mine = useMemo(
    () => snapshot.notes
      .filter((n) => ("projectId" in target ? n.projectId === target.projectId : n.taskId === target.taskId))
      .sort((a, b) => b.createdAt - a.createdAt),
    [snapshot.notes, target],
  );
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!draft.trim()) return;
    try { await act.createNote({ ...target, body: draft }); setDraft(""); setError(null); } catch (e) { setError(messageOf(e)); }
  };
  const saveEdit = async () => {
    if (!editing) return;
    try { await act.updateNote(editing.id, editing.body); setEditing(null); setError(null); } catch (e) { setError(messageOf(e)); }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void add(); } }}
          placeholder="Write a note…"
          aria-label="New note"
          rows={2}
          className="ww-field"
        />
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-ink-3">⌘↵ to add</span>
          <GlassButton onClick={() => void add()} disabled={!draft.trim()}>Add note</GlassButton>
        </div>
        <FormError message={error} />
      </div>

      {mine.length === 0 ? (
        <EmptyState compact icon={<StickyNote size={18} />} title="No notes yet" body="Jot down decisions, links or anything you want to remember." />
      ) : (
        <ul className="flex flex-col gap-2">
          {mine.map((n) => (
            <li key={n.id} className="glass-card p-3" style={{ ["--ww-r" as string]: "12px" }}>
              {editing?.id === n.id ? (
                <div className="flex flex-col gap-2">
                  <textarea value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} rows={3} autoFocus className="ww-field" aria-label="Edit note" />
                  <div className="flex justify-end gap-2">
                    <GlassButton tone="ghost" onClick={() => setEditing(null)}>Cancel</GlassButton>
                    <GlassButton tone="primary" onClick={() => void saveEdit()}>Save</GlassButton>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{n.body}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[12px] text-ink-3">{new Date(n.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}{n.updatedAt > n.createdAt ? " · edited" : ""}</span>
                    <span className="flex gap-0.5">
                      <IconButton label="Edit note" onClick={() => setEditing({ id: n.id, body: n.body })}><Pencil size={14} /></IconButton>
                      <IconButton label="Delete note" onClick={() => void attempt(() => act.deleteNote(n.id))}><TrashIcon size={15} /></IconButton>
                    </span>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
