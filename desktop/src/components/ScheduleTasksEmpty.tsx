// What the sidebar's task list becomes when there's nothing to do: no schedule
// period is ending, or every task was finished a day ago. Built from the Empty
// block as given, boxed like the cards above it (a solid rounded border), with
// tighter padding, a one-line description and a small button to fit the slot.
// The button is there for a later "all tasks" menu and does nothing until it's
// given an `onViewAll`.

import { RiInboxLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from "@/components/ui/empty";

export function ScheduleTasksEmpty({ onViewAll }: { onViewAll?: () => void }) {
  return (
    <Empty className="glass-card gap-1.5 rounded-2xl border border-solid border-border/70 px-3 py-2">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon" className="mb-1">
          <RiInboxLine className="size-4" />
        </EmptyMedia>
        <EmptyTitle>You&apos;re all caught up</EmptyTitle>
        <EmptyDescription>
          Nothing to upload or reconcile right now.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={onViewAll}>
          View All Tasks
        </Button>
      </EmptyContent>
    </Empty>
  );
}
