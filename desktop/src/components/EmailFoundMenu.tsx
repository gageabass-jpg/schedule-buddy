// "Found in email" — the sidebar menu of events the email scans have added.
//
// Fed by the running list the scan functions keep in meta/emailScan; each entry
// is matched to its event on the calendar (lib/foundEvents.ts), so an event that
// has since been deleted or undone leaves the menu. Clicking one jumps the
// calendar to its day. Styled to sit above the schedule to-do list: the same
// rounded card, header and disclosure.

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, Mail } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Palette } from "../theme";
import type { Event } from "../state";
import { subscribeEmailScan, type EmailScanMeta } from "../lib/emailInboxes";
import { foundInEmail, type FoundEvent } from "../lib/foundEvents";
import { AgentDisclosure } from "./ui/todo-list-utils/agent-disclosure";
import { SPRING_SWAP } from "./ui/todo-list-utils/ease";

interface Props {
  householdId: string | null;
  /** The calendar's events: what the menu's entries are matched against. */
  events: ReadonlyArray<Event>;
  palette: Palette;
  onSelectDate: (date: string) => void;
}

interface ViewProps {
  found: ReadonlyArray<FoundEvent>;
  palette: Palette;
  onSelectDate: (date: string) => void;
}

const MAX_HEIGHT = 232;

const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
};
const foundLabel = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function colorFor(who: FoundEvent["who"], palette: Palette): string {
  return who === "G" ? palette.G : who === "K" ? palette.K : "var(--muted-foreground)";
}

/** The menu, fed live from what the email scans have recorded. */
export function EmailFoundMenu({ householdId, events, palette, onSelectDate }: Props) {
  const [meta, setMeta] = useState<EmailScanMeta>({});

  useEffect(() => {
    if (!householdId) return;
    return subscribeEmailScan(householdId, setMeta);
  }, [householdId]);

  const found = useMemo(() => foundInEmail(householdId ? meta.found : undefined, events), [householdId, meta.found, events]);
  return <FoundMenu found={found} palette={palette} onSelectDate={onSelectDate} />;
}

/** The menu itself: a card with the found events under a collapsible header. */
export function FoundMenu({ found, palette, onSelectDate }: ViewProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  // null = the person hasn't touched it: open when there is something to see.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? found.length > 0;

  return (
    <section aria-label="Events found in email" className="glass-card w-full overflow-hidden rounded-2xl border border-border/70">
      <button
        id={`${baseId}-trigger`}
        type="button"
        aria-expanded={open}
        aria-controls={`${baseId}-content`}
        onClick={() => setUserOpen(!open)}
        className="group flex h-11 w-full items-center gap-2.5 rounded-2xl px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center text-muted-foreground">
          <Mail className="size-4" />
        </span>
        <h3 className="m-0 min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">Found in email</h3>
        <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{found.length}</span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure id={`${baseId}-content`} role="region" aria-labelledby={`${baseId}-trigger`} open={open}>
        <div className="scrollbar-hide overflow-y-auto px-2 pb-2" style={{ maxHeight: MAX_HEIGHT }}>
          {found.length ? (
            <ul className="m-0 list-none space-y-0 p-0">
              {found.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onSelectDate(e.date)}
                    title={`Found ${foundLabel(e.foundAt)} · show ${dayLabel(e.date)} on the calendar`}
                    className="flex min-h-9 w-full items-center gap-2.5 rounded-xl px-1.5 py-1 text-left outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span aria-hidden="true" className="h-3.5 w-[3px] shrink-0 rounded-sm" style={{ background: colorFor(e.who, palette) }} />
                    <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground/90">{e.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{dayLabel(e.date)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 px-1.5 py-2 text-[13px] leading-[18px] text-muted-foreground">
              Nothing yet. Events the Sunday email scan finds are listed here.
            </p>
          )}
        </div>
      </AgentDisclosure>
    </section>
  );
}
