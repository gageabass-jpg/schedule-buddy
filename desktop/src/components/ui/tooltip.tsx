// Tooltip from HextaUI by Preet Suthar — https://hextaui.com
// Listed on 21st.dev as @preetsuthar17/tooltip. Colours come from the shadcn
// variables in src/index.css (card = Surface, border = Line), and
// `rounded-ele` is defined there as the house 4px corner.
// One change: the content renders through a Radix Portal, with 8px collision
// padding. As supplied it rendered in place, so a tooltip inside a scroll
// container that clips overflow (the right rail) was sliced at its edge.

"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";

const tooltipVariants = cva(
  "z-50 overflow-hidden rounded-ele border border-border bg-card px-3 py-1.5 text-xs text-card-foreground shadow-sm/2 ",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        dark: "bg-foreground text-background border-foreground",
        light: "bg-background text-foreground border-border",
        destructive:
          "bg-destructive text-primary-foreground border-destructive",
      },
      size: {
        sm: "px-2 py-1 text-xs",
        md: "px-3 py-1.5 text-sm",
        lg: "px-4 py-2 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

const Tooltip: React.FC<
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>
> = ({ delayDuration = 300, ...props }) => (
  <TooltipPrimitive.Root delayDuration={delayDuration} {...props} />
);

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipProvider: React.FC<
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>
> = ({ delayDuration = 300, skipDelayDuration = 100, ...props }) => (
  <TooltipPrimitive.Provider
    delayDuration={delayDuration}
    skipDelayDuration={skipDelayDuration}
    {...props}
  />
);

// Quick tooltip with minimal delay
const QuickTooltipProvider: React.FC<
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>
> = ({ delayDuration = 100, skipDelayDuration = 50, ...props }) => (
  <TooltipPrimitive.Provider
    delayDuration={delayDuration}
    skipDelayDuration={skipDelayDuration}
    {...props}
  />
);

interface TooltipContentProps
  extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
    VariantProps<typeof tooltipVariants> {}

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, variant, size, sideOffset = 4, collisionPadding = 8, ...props }, ref) => {
  const [isVisible, setIsVisible] = React.useState(false);

  return (
    <TooltipPrimitive.Portal>
    <AnimatePresence>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("relative", className)}
        onAnimationStart={() => setIsVisible(true)}
        onAnimationEnd={() => setIsVisible(false)}
        asChild
        {...props}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 5 }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 20,
            duration: 0.1,
          }}
          className={cn(tooltipVariants({ variant, size }), className)}
        >
          {props.children}
        </motion.div>
      </TooltipPrimitive.Content>
    </AnimatePresence>
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  QuickTooltipProvider,
  tooltipVariants,
  type TooltipContentProps,
};
