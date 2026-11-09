import * as React from "react";
import { Button, type ButtonProps } from "@nucleus/ui/ui/button";
import { cn } from "@nucleus/ui/lib/utils";

/**
 * Wagonwheel's buttons: the shared Button, dressed in glass. The shared component is not
 * edited. It is used with its "ghost" variant (no fill of its own) and the Wagonwheel
 * classes in styles/glass.css supply the look. `hover:bg-transparent` cancels the ghost
 * hover fill so the glass gradient stays.
 */
type Tone = "primary" | "glass" | "ghost" | "danger";

const TONE: Record<Tone, string> = {
  primary: "btn-crimson hover:bg-transparent hover:text-white",
  glass: "btn-glass hover:bg-transparent hover:text-foreground",
  ghost: "text-ink-2 hover:bg-white/10 hover:text-foreground",
  danger: "btn-glass border-danger/30 text-danger hover:bg-danger/15 hover:text-danger",
};

export interface GlassButtonProps extends Omit<ButtonProps, "variant"> {
  tone?: Tone;
}

export const GlassButton = React.forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ tone = "glass", className, size = "sm", ...props }, ref) => (
    <Button ref={ref} variant="ghost" size={size} className={cn("gap-1.5 rounded-[10px] px-3.5 font-semibold", TONE[tone], className)} {...props} />
  ),
);
GlassButton.displayName = "GlassButton";
