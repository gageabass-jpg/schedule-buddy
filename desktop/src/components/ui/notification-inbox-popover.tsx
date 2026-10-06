// Notification inbox popover, from 21st.dev. Kept: the bell with its unread
// badge, the All / Unread tabs, "Mark all as read", the list rows with an icon
// and unread dot, and the footer. Changed:
//  - it shows real notifications passed in as props (the supplied one had a
//    hard-coded sample list and its own state);
//  - a row's text is the notification's title and detail, not
//    "user action target", and the icon comes from its kind;
//  - clicking a row marks it read and hands it to onOpen (the app jumps to
//    its day); "View all notifications" expands past the newest 20 instead of
//    doing nothing;
//  - the bell is 32px to sit beside New shift, and the dot is Teal (primary).
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell,
  CalendarPlus,
  CalendarClock,
  CircleCheck,
  CircleX,
  CircleAlert,
  Clock,
  CalendarSync,
  type LucideIcon,
} from "lucide-react";

export interface InboxNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  unread: boolean;
  /** Epoch ms, or null while the server time is still arriving. */
  at: number | null;
  date?: string;
}

const ICONS: Record<string, LucideIcon> = {
  schedule_added: CalendarPlus,
  new_pending: CalendarClock,
  status_confirmed: CircleCheck,
  status_declined: CircleX,
  status_issue: CircleAlert,
  change_proposed: Clock,
  change_resolved: Clock,
  schedule_reminder: CalendarSync,
};

/** "Just now", "10 minutes ago", "2 hours ago", "3 days ago", then the date. */
function timeAgo(at: number | null): string {
  if (at == null) return "Just now";
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "Just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const FIRST_PAGE = 20;

function NotificationInboxPopover({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onOpen,
}: {
  notifications: InboxNotification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpen?: (n: InboxNotification) => void;
}) {
  const [tab, setTab] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(false);
  const unreadCount = notifications.filter((n) => n.unread).length;

  const filtered = tab === "unread" ? notifications.filter((n) => n.unread) : notifications;
  const shown = showAll ? filtered : filtered.slice(0, FIRST_PAGE);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setShowAll(false); }}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="outline" className="relative size-8 cursor-pointer text-foreground" aria-label="Open notifications">
          <Bell size={16} strokeWidth={2} aria-hidden="true" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-2 left-full min-w-5 -translate-x-1/2 px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        {/* Header with Tabs + Mark All */}
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <TabsList className="bg-transparent">
              <TabsTrigger value="all" className="text-sm">All</TabsTrigger>
              <TabsTrigger value="unread" className="text-sm">
                Unread {unreadCount > 0 && <Badge className="ml-1">{unreadCount}</Badge>}
              </TabsTrigger>
            </TabsList>
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="cursor-pointer text-xs font-medium text-muted-foreground hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="max-h-80 overflow-y-auto">
            {shown.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {tab === "unread" ? "You're all caught up" : "No notifications yet"}
              </div>
            ) : (
              shown.map((n) => {
                const Icon = ICONS[n.kind] ?? Bell;
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      if (n.unread) onMarkRead(n.id);
                      if (onOpen && n.date) { setOpen(false); onOpen(n); }
                    }}
                    className="flex w-full cursor-pointer items-start gap-3 border-b px-3 py-3 text-left hover:bg-accent"
                  >
                    <div className="mt-1 text-muted-foreground">
                      <Icon size={18} />
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className={`text-sm ${n.unread ? "font-semibold text-foreground" : "text-foreground/80"}`}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-sm text-foreground/80">{n.body}</p>}
                      <p className="text-xs text-muted-foreground">{timeAgo(n.at)}</p>
                    </div>
                    {n.unread && (
                      <span className="mt-1 inline-block size-2 rounded-full bg-primary" aria-label="Unread" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </Tabs>

        {/* Footer */}
        {filtered.length > FIRST_PAGE && (
          <div className="px-3 py-2 text-center">
            <Button variant="ghost" size="sm" className="w-full cursor-pointer" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `View all notifications (${filtered.length})`}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { NotificationInboxPopover };
