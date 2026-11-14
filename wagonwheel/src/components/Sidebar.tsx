import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArchiveRestore, ChartGantt, Check, ChevronDown, ChevronUp, CreditCard, DatabaseBackup, FileJson, FileSpreadsheet,
  FolderKanban, FolderOpen, Inbox, LayoutDashboard, ListChecks, Plug, Plus,
} from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { NucleusMark } from "@nucleus/ui/brand/nucleusMark";
import { Popover, PopoverContent, PopoverTrigger } from "@nucleus/ui/ui/popover";
import type { DataInfo } from "@shared/types";
import { useData } from "@/lib/store";
import { useUi, type View } from "@/lib/ui-state";
import { inboxTasks, isOpen, liveProjects, visibleTasks } from "@/lib/derive";
import { flaggedServices, monthOf, owedNow } from "@/lib/services";
import { bridge, messageOf } from "@/lib/bridge";
import { backupDatabase, exportCsv, exportJson, restoreBackup, revealDataFolder } from "@/lib/tools";
import { MiniCalendar } from "./MiniCalendar";
import { GlassButton } from "./GlassButton";

const MARK = "#f0728a";   // the mark on a dark ground: the red that passes as text (6.2:1)

/** The sidebar: a floating glass pane. Brand, calendar and navigation scroll if the
 *  window is short; the inbox and the workspace stay pinned at the bottom. */
export function Sidebar() {
  return (
    <aside className="glass-panel flex w-[252px] shrink-0 flex-col gap-3 p-3.5" style={{ ["--ww-r" as string]: "22px" }} aria-label="Sidebar">
      <BrandLockup />
      {/* Calendar, navigation and inbox scroll together if the window is short, so nothing is
          ever out of reach. On a tall window the inbox sits at the bottom of this region. */}
      <div className="-mr-1.5 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1.5">
        <MiniCalendar />
        <Nav />
        <div className="mt-auto"><InboxSection /></div>
      </div>
      <WorkspaceMenu />
    </aside>
  );
}

function BrandLockup() {
  const { go } = useUi();
  return (
    <button type="button" onClick={() => go({ name: "dashboard" })} aria-label="Nucleus Wagonwheel: go to the dashboard" className="ww-row flex h-9 w-full items-center gap-2.5 rounded-xl px-1.5 text-left">
      <NucleusMark size={24} color={MARK} />
      {/* Lowercase Sora: "nucleus" 600, the product name 400 and softer. Never stacked. */}
      <span className="whitespace-nowrap font-display text-[15px] leading-none tracking-[-0.02em]">
        <span className="font-semibold text-foreground">nucleus</span>
        <span className="font-normal text-ink-2"> wagonwheel</span>
      </span>
    </button>
  );
}

// ── Navigation ──────────────────────────────────────────────────────────────

function Nav() {
  const { snapshot, today } = useData();
  const { view, go } = useUi();
  const counts = useMemo(() => ({
    projects: liveProjects(snapshot).length,
    tasks: visibleTasks(snapshot).filter(isOpen).length,
    services: snapshot.services.filter((s) => s.status === "active").length,
    // A bill that is higher than usual, or one that is owed and unpaid, turns the Services count red, so it is seen without opening the screen.
    flagged: flaggedServices(snapshot.services, snapshot.serviceCharges, monthOf(today)).length + owedNow(snapshot.services, snapshot.serviceCharges).bills.length,
  }), [snapshot, today]);

  const items: { label: string; to: View; icon: ReactNode; count?: number; hot?: boolean; match: (v: View) => boolean }[] = [
    { label: "Dashboard", to: { name: "dashboard" }, icon: <LayoutDashboard size={16} />, match: (v) => v.name === "dashboard" },
    { label: "All Projects", to: { name: "projects" }, icon: <FolderKanban size={16} />, count: counts.projects, match: (v) => v.name === "projects" || v.name === "project" },
    { label: "All Tasks", to: { name: "tasks" }, icon: <ListChecks size={16} />, count: counts.tasks, match: (v) => v.name === "tasks" },
    { label: "Timeline", to: { name: "timeline" }, icon: <ChartGantt size={16} />, match: (v) => v.name === "timeline" },
    { label: "Services", to: { name: "services" }, icon: <CreditCard size={16} />, count: counts.services || undefined, hot: counts.flagged > 0, match: (v) => v.name === "services" },
  ];

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {items.map((it) => {
        const active = it.match(view);
        return (
          <button
            key={it.label}
            type="button"
            onClick={() => go(it.to)}
            data-active={active}
            aria-current={active ? "page" : undefined}
            className="ww-row flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium tracking-[-0.01em]"
          >
            <span className={cn("shrink-0", active ? "text-crimson-text" : "text-ink-2")}>{it.icon}</span>
            <span className="flex-1 text-left">{it.label}</span>
            {it.count != null && (
              <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold", it.hot ? "bg-crimson text-white" : "text-ink-3")}>{it.count}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

// ── Inbox ───────────────────────────────────────────────────────────────────

/** Unsorted tasks. A pill that opens into a capture box and the list; below it a card that
 *  says what is waiting, or that nothing is. Picking a project in a row files the task. */
function InboxSection() {
  const { snapshot, act, attempt } = useData();
  const { go, inboxOpen, setInboxOpen, captureTick } = useUi();
  const items = useMemo(() => inboxTasks(snapshot.tasks), [snapshot.tasks]);
  const projects = useMemo(() => liveProjects(snapshot), [snapshot]);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (captureTick > 0) input.current?.focus(); }, [captureTick]);

  const capture = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const id = await attempt(() => act.createTask({ title }));
    if (!id) setDraft(title);   // refused: give the text back
    input.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setInboxOpen(!inboxOpen)}
        aria-expanded={inboxOpen}
        className="glass-inset flex h-11 w-full items-center gap-3 px-3.5 text-left"
        style={{ ["--ww-r" as string]: "16px" }}
      >
        <Inbox size={18} className="text-ink-2" />
        <span className="flex-1 text-[13.5px] font-medium">Unsorted tasks</span>
        <span className={cn("text-[12.5px] font-semibold", items.length ? "text-crimson-text" : "text-ink-3")}>{items.length}</span>
        {inboxOpen ? <ChevronUp size={15} className="text-ink-3" /> : <ChevronDown size={15} className="text-ink-3" />}
      </button>

      {inboxOpen && (
        <div className="glass-inset flex flex-col gap-2 p-2.5" style={{ ["--ww-r" as string]: "16px" }}>
          <div className="relative">
            <Plus size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void capture(); if (e.key === "Escape") setInboxOpen(false); }}
              placeholder="Capture a task…  ↵"
              aria-label="Capture a task to the inbox"
              maxLength={120}
              className="ww-field !min-h-8 !pl-8 !text-[13px]"
            />
          </div>
          {items.length > 0 && (
            <ul className="-mr-1 flex max-h-[148px] flex-col gap-1 overflow-y-auto pr-1">
              {items.map((t) => (
                <li key={t.id} className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px]" title={t.title}>{t.title}</span>
                  <select
                    aria-label={`Move "${t.title}" to a project`}
                    value=""
                    onChange={(e) => { if (e.target.value) void attempt(() => act.updateTask(t.id, { projectId: e.target.value })); }}
                    className="ww-field !min-h-6 !w-[84px] shrink-0 !rounded-md !py-0 !pl-2 !pr-5 !text-[11.5px]"
                    disabled={projects.length === 0}
                    title={projects.length === 0 ? "Create a project first" : "Move to a project"}
                  >
                    <option value="">{projects.length ? "Move to…" : "No projects"}</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* While the list is open and has things in it, the list says it all: the card steps aside. */}
      {!(inboxOpen && items.length > 0) && (
      <div className="glass-card flex flex-col items-center gap-1.5 px-3.5 py-3.5 text-center" style={{ ["--ww-r" as string]: "18px" }}>
        <div className="grid size-8 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-rose">
          {items.length === 0 ? <Check size={16} /> : <Inbox size={16} />}
        </div>
        {items.length === 0 ? (
          <>
            <p className="text-[14px] font-semibold">You're all caught up</p>
            <p className="ww-hide-short text-[12.5px] leading-snug text-ink-2">Nothing to organize right now.</p>
            <GlassButton className="mt-1 !h-8 !text-[12.5px]" onClick={() => go({ name: "tasks" })}>View All Tasks</GlassButton>
          </>
        ) : (
          <>
            <p className="text-[14px] font-semibold">{items.length} to organize</p>
            <p className="ww-hide-short text-[12.5px] leading-snug text-ink-2">{items.length === 1 ? "This task has" : "These tasks have"} no project yet.</p>
            <div className="mt-1 flex gap-1.5">
              <GlassButton tone="primary" className="!h-8 !text-[12.5px]" onClick={() => go({ name: "inbox" })}>Organize</GlassButton>
              <GlassButton className="!h-8 !text-[12.5px]" onClick={() => go({ name: "tasks" })}>View All Tasks</GlassButton>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}

// ── Workspace ───────────────────────────────────────────────────────────────

/** The workspace card, and its menu: rename it, and look after the data. */
function WorkspaceMenu() {
  const { workspaceName, snapshot, act, attemptOk, adopt } = useData();
  const { openConnectors } = useUi();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(workspaceName);
  const [info, setInfo] = useState<DataInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);

  useEffect(() => { if (!open) setName(workspaceName); }, [workspaceName, open]);
  useEffect(() => {
    if (!open) return;
    setInfoError(null);
    bridge().dataInfo().then(setInfo).catch((e) => setInfoError(messageOf(e)));
  }, [open, snapshot]);

  const save = async () => {
    const next = name.trim();
    if (!next || next === workspaceName) { setName(workspaceName); return; }
    // On success the store's new name flows back in; on a refusal, put the old one back.
    if (!(await attemptOk(() => act.renameWorkspace(next)))) setName(workspaceName);
  };

  const run = (fn: () => Promise<unknown>) => () => { setOpen(false); void fn(); };
  const restore = async () => { setOpen(false); const s = await restoreBackup(); if (s) adopt(s); };
  const initial = (workspaceName.trim()[0] ?? "W").toUpperCase();
  const live = liveProjects(snapshot).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${workspaceName}: workspace menu`} className="glass-inset flex h-[52px] w-full items-center gap-2.5 px-2.5 text-left" style={{ ["--ww-r" as string]: "16px" }}>
          <span className="grid size-8 shrink-0 place-items-center rounded-full font-display text-[14px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]" style={{ background: "linear-gradient(145deg, #e0546d, #8f1834)" }}>{initial}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight">{workspaceName}</span>
            <span className="block truncate text-[11.5px] leading-tight text-ink-3">{live} {live === 1 ? "project" : "projects"} · on this Mac</span>
          </span>
          <ChevronUp size={15} className="text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="glass-panel w-[272px] border-0 bg-[rgba(40,27,34,0.94)] p-3 text-foreground" style={{ ["--ww-r" as string]: "18px" }}>
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-3">Workspace name</span>
          <input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setName(workspaceName); (e.target as HTMLInputElement).blur(); } }}
            className="ww-field"
          />
        </label>
        <div className="my-2.5 h-px bg-white/[0.08]" />
        <MenuItem icon={<Plug size={15} />} onClick={run(async () => openConnectors())}>Connectors…</MenuItem>
        <MenuItem icon={<DatabaseBackup size={15} />} onClick={run(backupDatabase)}>Back up database…</MenuItem>
        <MenuItem icon={<FileJson size={15} />} onClick={run(exportJson)}>Export as JSON…</MenuItem>
        <MenuItem icon={<FileSpreadsheet size={15} />} onClick={run(exportCsv)}>Export as CSV…</MenuItem>
        <MenuItem icon={<ArchiveRestore size={15} />} onClick={() => void restore()}>Restore from backup…</MenuItem>
        <MenuItem icon={<FolderOpen size={15} />} onClick={run(revealDataFolder)}>Show data folder</MenuItem>
        <div className="mt-2 rounded-lg bg-black/25 px-2.5 py-2 text-[11.5px] leading-snug text-ink-3">
          {infoError ? <span className="text-danger">{infoError}</span> : info ? (
            <>Stored only on this Mac, in SQLite.<br /><span className="break-all">{info.path}</span><br />{formatBytes(info.sizeBytes)} · schema {info.schemaVersion}</>
          ) : "Reading…"}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({ icon, children, onClick }: { icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ww-row flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13.5px]">
      <span className="text-ink-2">{icon}</span>{children}
    </button>
  );
}

const formatBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
