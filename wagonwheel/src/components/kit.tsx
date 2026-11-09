import { type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nucleus/ui/ui/tooltip";
import { PRIORITY_LABEL, PROJECT_STATUS_LABEL, TASK_STATUS_LABEL, type Priority, type ProjectStatus, type TaskStatus } from "@shared/types";

// Small building blocks every view shares. Nothing here knows about projects or tasks
// beyond their labels and colours.

// ── Colour by meaning ───────────────────────────────────────────────────────

export type Tone = "neutral" | "crimson" | "ok" | "warn" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-white/[0.07] text-ink-2 border-white/10",
  crimson: "bg-crimson/20 text-[#f4b1be] border-[rgba(217,139,155,0.28)]",
  ok: "bg-ok/15 text-ok border-ok/25",
  warn: "bg-warn/15 text-warn border-warn/25",
  danger: "bg-danger/15 text-danger border-danger/30",
};

export function Chip({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold leading-4", TONES[tone], className)}
    >
      {children}
    </span>
  );
}

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = { planning: "neutral", active: "crimson", on_hold: "warn", completed: "ok" };
export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = { not_started: "neutral", in_progress: "crimson", done: "ok" };

export const ProjectStatusChip = ({ status }: { status: ProjectStatus }) => <Chip tone={PROJECT_STATUS_TONE[status]}>{PROJECT_STATUS_LABEL[status]}</Chip>;
export const TaskStatusChip = ({ status }: { status: TaskStatus }) => <Chip tone={TASK_STATUS_TONE[status]}>{TASK_STATUS_LABEL[status]}</Chip>;

export const PRIORITY_COLOR: Record<Priority, string> = { high: "#f0728a", medium: "#e6ae5c", low: "#9a8a90" };

export function PriorityMark({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PRIORITY_COLOR[priority] }} title={`${PRIORITY_LABEL[priority]} priority`}>
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 3a1 1 0 0 1 1 1v1h12.4a1 1 0 0 1 .8 1.6L17 10l2.2 3.4a1 1 0 0 1-.8 1.6H6v6a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1z" /></svg>
      {withLabel ? PRIORITY_LABEL[priority] : <span className="sr-only">{PRIORITY_LABEL[priority]} priority</span>}
    </span>
  );
}

// ── Progress ────────────────────────────────────────────────────────────────

export function ProgressBar({ pct, color, className }: { pct: number; color?: string | null; className?: string }) {
  return (
    <div
      role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-black/35 shadow-[inset_0_1px_1px_rgba(0,0,0,0.4)]", className)}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color ?? "#c62845"}, ${color ? color : "#e0546d"})`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)" }}
      />
    </div>
  );
}

export function ProgressRing({ pct, size = 44, color, label }: { pct: number; size?: number; color?: string | null; label?: string }) {
  const stroke = 4.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label ?? `${pct}% complete`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(0,0,0,0.38)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? "#e0546d"} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] font-bold">{pct}%</span>
    </div>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="flex shrink-0 items-end justify-between gap-4 px-8 pb-4 pt-7">
      <div className="min-w-0">
        {back}
        <h1 className="truncate font-display text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[14px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, count, action, children, className }: { title: string; count?: number; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.09em] text-ink-3">
          {title}
          {count != null && <span className="rounded-full bg-white/[0.07] px-1.5 text-[11px] font-semibold tracking-normal text-ink-2">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, body, action, compact }: { icon: ReactNode; title: string; body?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-6" : "px-6 py-14")}>
      <div className="mb-3 grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-rose shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">{icon}</div>
      <p className="text-[15px] font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-[34ch] text-[13.5px] leading-snug text-ink-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function IconButton({ label, onClick, children, className, disabled }: { label: string; onClick?: (e: React.MouseEvent) => void; children: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button" aria-label={label} onClick={onClick} disabled={disabled}
          className={cn("grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-40", className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent size="sm">{label}</TooltipContent>
    </Tooltip>
  );
}

// ── Forms ───────────────────────────────────────────────────────────────────

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">{message}</p>;
}

// ── Dialog ──────────────────────────────────────────────────────────────────

export function Modal({
  open, onOpenChange, title, description, children, footer, width = 540,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string;
  children: ReactNode; footer?: ReactNode; width?: number;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(8,4,7,0.55)] backdrop-blur-[4px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={description ? undefined : undefined}
          style={{ width: `min(${width}px, calc(100vw - 40px))` }}
          className="glass-panel fixed left-1/2 top-1/2 z-50 flex max-h-[min(86vh,820px)] -translate-x-1/2 -translate-y-1/2 flex-col bg-[rgba(36,25,32,0.9)] outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
            <div>
              <Dialog.Title className="font-display text-[19px] font-semibold tracking-tight">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-[13.5px] text-ink-2">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-white/10 hover:text-foreground"><X size={16} /></button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-white/[0.07] px-6 py-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
