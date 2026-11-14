import { useMemo } from "react";
import { GitBranch, Inbox } from "lucide-react";
import { cn } from "@nucleus/ui/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nucleus/ui/ui/tooltip";
import { inboxTasks } from "@/lib/derive";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { GlassButton } from "./GlassButton";

// The two buttons that used to sit in the sidebar and now live in the page header, with New task and New project.

/**
 * The inbox: an icon with the number of unsorted tasks, in the same corner of every page header (PageHeader adds
 * it, so no view has to remember to). It is a place, not an action, so it sits apart from the buttons that make
 * things, behind a thin divider. On the Inbox page itself it shows as the current page.
 */
export function InboxButton() {
  const { snapshot } = useData();
  const { view, go } = useUi();
  const count = useMemo(() => inboxTasks(snapshot.tasks).length, [snapshot.tasks]);
  const here = view.name === "inbox";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <GlassButton
          onClick={() => go({ name: "inbox" })}
          aria-label={count > 0 ? `Inbox, ${count} unsorted` : "Inbox"}
          aria-current={here ? "page" : undefined}
          className={cn("relative w-9 shrink-0 !px-0", here && "!border-white/25 !bg-white/15 !text-foreground")}
        >
          <Inbox size={17} />
          {count > 0 && (
            <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-crimson px-1 text-center text-[10.5px] font-bold leading-[18px] text-white shadow-[0_0_0_2px_rgba(20,8,12,0.9)]">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </GlassButton>
      </TooltipTrigger>
      <TooltipContent size="sm">Inbox (⌘5)</TooltipContent>
    </Tooltip>
  );
}

/**
 * Opens the GitHub scan (the same dialog as File → Scan GitHub for Tasks…, ⇧⌘G). It is an action, so it sits beside
 * New task and New project on the pages that have them. Below the xl width the label drops and the icon stays, so
 * the header still has room for its title at the window's smallest size.
 */
export function ScanGithubButton() {
  const { openGithub } = useUi();
  return (
    <GlassButton onClick={() => openGithub()} aria-label="Scan GitHub" title="Scan your GitHub repositories for tasks (⇧⌘G)" className="!px-2.5 xl:!px-3.5">
      <GitBranch size={15} />
      <span className="hidden xl:inline">Scan GitHub</span>
    </GlassButton>
  );
}
