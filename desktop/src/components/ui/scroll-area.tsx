import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A scrolling container. Horizontal scrolls sideways (the timeline's
 * horizontal layout); vertical, the default, scrolls down.
 */
export function ScrollArea({
  orientation = "vertical",
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { orientation?: "vertical" | "horizontal" }) {
  return (
    <div
      className={cn(orientation === "horizontal" ? "overflow-x-auto overflow-y-hidden" : "overflow-y-auto", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export default ScrollArea;
