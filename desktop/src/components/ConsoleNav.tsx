// The Admin Console's left column, laid out after the sidebar-nav pattern the user
// supplied from 21st.dev (grouped list with headings, an icon per row, a chevron
// that opens nested items, a pill count, and an actions group pinned at the
// bottom). What was taken and what wasn't:
//  - taken: the groups, icons, nested rows with the guide line, the count pill, the
//    bottom group (their "Log out" is our Sign out / Leave household), and the
//    grid-rows open/close;
//  - not taken: the workspace switcher (the household is fixed), search (⌘K is
//    nucleusAI), the collapse toggle (this is a modal), the mock content;
//  - rebuilt: real <button>s with aria-current / aria-expanded, no shadows, and
//    the app's own tokens, so it follows Light, Dark and the glass look.

import { useState, type ReactNode } from "react";
import {
  CalendarHeart,
  ChevronRight,
  DoorOpen,
  Image as ImageIcon,
  LogOut,
  Monitor,
  Plug,
  SlidersHorizontal,
  Tv,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ThemeTokens } from "../theme";
import { cn } from "@/lib/utils";

export type NavKey = "general" | "people" | "wall" | "integrations";
export type WallSub = "display" | "photos" | "occasions";

type NavEntry = {
  id: string;
  title: string;
  icon: LucideIcon;
  tab: NavKey;
  /** For a nested row: which part of the tab it shows. */
  sub?: WallSub;
  badge?: number;
  children?: NavEntry[];
};

const ROW =
  "group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border-0 bg-transparent py-[7px] pr-2.5 text-left font-[inherit] text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Props = {
  t: ThemeTokens;
  tab: NavKey;
  wallSub: WallSub;
  memberCount: number;
  onSelect: (tab: NavKey, sub?: WallSub) => void;
  onSignOut: () => void;
  onLeaveHousehold: () => void;
  /** Pinned under the actions: the Appearance switch, the caption, the studio button. */
  footer: ReactNode;
};

export function ConsoleNav({ t, tab, wallSub, memberCount, onSelect, onSignOut, onLeaveHousehold, footer }: Props) {
  const groups: Array<{ heading: string; items: NavEntry[] }> = [
    {
      heading: "Household",
      items: [
        { id: "general", title: "General", icon: SlidersHorizontal, tab: "general" },
        { id: "people", title: "People", icon: Users, tab: "people", badge: memberCount > 0 ? memberCount : undefined },
      ],
    },
    {
      heading: "Display",
      items: [
        {
          id: "wall",
          title: "Wall display",
          icon: Tv,
          tab: "wall",
          children: [
            { id: "wall-display", title: "Display", icon: Monitor, tab: "wall", sub: "display" },
            { id: "wall-photos", title: "Photos", icon: ImageIcon, tab: "wall", sub: "photos" },
            { id: "wall-occasions", title: "Occasions", icon: CalendarHeart, tab: "wall", sub: "occasions" },
          ],
        },
      ],
    },
    {
      heading: "Connections",
      items: [{ id: "integrations", title: "Integrations", icon: Plug, tab: "integrations" }],
    },
  ];

  return (
    <>
      <nav aria-label="Console sections" className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.heading} className="flex flex-col gap-0.5">
            <div
              style={{ color: t.text3 }}
              className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
            >
              {group.heading}
            </div>
            {group.items.map((entry) => (
              <NavRow key={entry.id} entry={entry} level={0} t={t} tab={tab} wallSub={wallSub} onSelect={onSelect} />
            ))}
          </div>
        ))}
      </nav>

      {/* Actions — what used to sit in the footer of General. */}
      <div className="mt-3 flex flex-col gap-0.5 pt-3" style={{ borderTop: `1px solid ${t.sep}` }}>
        <button
          type="button"
          onClick={onSignOut}
          className={cn(ROW, "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground")}
          style={{ paddingLeft: 10 }}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <LogOut size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
            <span className="truncate">Sign out</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onLeaveHousehold}
          className={cn(ROW, "font-medium hover:bg-muted/60")}
          style={{ paddingLeft: 10, color: t.clayText }}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <DoorOpen size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
            <span className="truncate">Leave household</span>
          </span>
        </button>
      </div>

      {footer}
    </>
  );
}

function NavRow({
  entry,
  level,
  t,
  tab,
  wallSub,
  onSelect,
}: {
  entry: NavEntry;
  level: number;
  t: ThemeTokens;
  tab: NavKey;
  wallSub: WallSub;
  onSelect: (tab: NavKey, sub?: WallSub) => void;
}) {
  const hasChildren = !!entry.children?.length;
  const inSection = tab === entry.tab;
  const [open, setOpen] = useState(() => hasChildren && inSection);
  // A leaf is current when it's the page shown; a parent only while it's closed (open, its child carries it).
  const active = hasChildren ? inSection && !open : inSection && (!entry.sub || wallSub === entry.sub);
  const Icon = entry.icon;

  const click = () => {
    if (!hasChildren) return onSelect(entry.tab, entry.sub);
    if (!inSection) { onSelect(entry.tab); setOpen(true); }
    else setOpen(!open);
  };

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        onClick={click}
        aria-current={!hasChildren && active ? "page" : undefined}
        aria-expanded={hasChildren ? open : undefined}
        aria-controls={hasChildren ? `${entry.id}-children` : undefined}
        className={cn(
          ROW,
          active
            ? "font-semibold"
            : hasChildren && inSection
              ? "font-semibold text-foreground hover:bg-muted/60"
              : "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
        style={{ paddingLeft: level * 14 + 10, ...(active ? { background: t.tealTint, color: t.text } : null) }}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
          <span className="truncate">{entry.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {entry.badge != null && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {entry.badge}
            </span>
          )}
          {hasChildren && (
            <ChevronRight
              size={14}
              strokeWidth={2}
              aria-hidden
              className={cn("shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")}
            />
          )}
        </span>
      </button>

      {hasChildren && (
        <div
          id={`${entry.id}-children`}
          inert={!open}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="relative mt-0.5 flex min-h-0 flex-col gap-0.5 overflow-hidden">
            <span
              aria-hidden
              className="absolute bottom-0 top-0 border-l border-solid"
              style={{ left: level * 14 + 17.5, borderColor: t.sep }}
            />
            {entry.children!.map((child) => (
              <NavRow key={child.id} entry={child} level={level + 1} t={t} tab={tab} wallSub={wallSub} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
