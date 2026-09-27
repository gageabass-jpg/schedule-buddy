import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The hover card on a block in the week and day views: the person's avatar on
 * the left, their name on top and the shift (or window, or event time)
 * beneath. The block itself is the trigger.
 */
export function BlockTip({ avatar, name, detail, children }: {
  avatar: ReactNode;
  name: string;
  detail: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" size="sm" className="max-w-72">
        <div className="flex items-center gap-2.5 py-0.5">
          {avatar}
          <div className="min-w-0">
            <div className="truncate font-semibold">{name}</div>
            <div className="text-muted-foreground truncate">{detail}</div>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
