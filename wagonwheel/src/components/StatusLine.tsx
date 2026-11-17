import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { STATUS_LINE_MAX, type Project } from "@shared/types";
import { useData } from "@/lib/store";

/**
 * A project's status line: one short line on where it stands right now ("Pending App Store review"). Click it to type a
 * new one. Enter, or leaving the box, saves; Esc puts back what was there. A refused change (the app says why, in a toast)
 * leaves the box open with what was typed.
 */
export function StatusLine({ project, className, lines = 1 }: { project: Project; className?: string; lines?: 1 | 2 }) {
  const { act, attemptOk } = useData();
  const [draft, setDraft] = useState<string | null>(null);   // null: not editing
  const cancelled = useRef(false);
  const editing = draft !== null;

  const commit = async () => {
    if (cancelled.current || draft === null) return;
    const next = draft.replace(/\s+/g, " ").trim();
    if (next === project.statusLine) { setDraft(null); return; }
    if (await attemptOk(() => act.updateProject(project.id, { statusLine: next }))) setDraft(null);
  };

  if (editing) {
    return (
      <span className={cn("flex min-w-0 items-center gap-2", className)} onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={draft}
          maxLength={STATUS_LINE_MAX}
          aria-label={`Status line for ${project.name}`}
          placeholder="Pending App Store review"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === "Escape") { cancelled.current = true; setDraft(null); }
          }}
          className="ww-field !min-h-8 min-w-0 flex-1 !px-2.5 !py-1 !text-[13px]"
        />
        <span className={cn("shrink-0 text-[11px] tabular-nums", draft.length >= STATUS_LINE_MAX - 8 ? "text-warn" : "text-ink-3")} aria-hidden="true">{draft.length}/{STATUS_LINE_MAX}</span>
      </span>
    );
  }

  const text = project.statusLine;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); cancelled.current = false; setDraft(text); }}
      title={text ? "Edit the status line" : "Add a status line"}
      className={cn("group/status inline-flex min-w-0 max-w-full items-start gap-1.5 rounded-md text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring", text ? "text-ink-2 hover:text-foreground" : "italic text-ink-3 hover:text-ink-2", className)}
    >
      <i aria-hidden="true" className={cn("mt-[0.45em] size-1.5 shrink-0 rounded-full", text ? "bg-crimson-text" : "bg-white/25")} />
      <span className={cn("min-w-0", lines === 1 ? "truncate" : "line-clamp-2")}>{text || "Add a status line"}</span>
      <Pencil size={11} aria-hidden="true" className="mt-[0.3em] shrink-0 opacity-0 transition-opacity group-hover/status:opacity-70 group-focus-visible/status:opacity-70" />
    </button>
  );
}
