// Shiny button, from 21st.dev. A 1px gradient border whose bright side follows
// the pointer around the button. Colours and the face come in as props; the
// shadcn variables in src/index.css cover the rest.
// Changes from the supplied component:
//  - its pointer handlers are composed with any passed in, not replaced by
//    them: inside a Radix TooltipTrigger the trigger's onPointerMove used to
//    override the one that steers the shine, so it stopped following;
//  - the hover wash is a prop (overlayClassName), since the supplied grey
//    dulled a coloured face;
//  - the border width is a prop (borderWidth, px), so the shine can be made
//    more visible than the supplied 1px;
//  - the gradient angle is turned so its bright end sits under the pointer.
//    The supplied maths measured the pointer from the right (Math.atan2) but
//    fed it to CSS, which measures from the top, so the bright side landed a
//    quarter-turn away from the cursor.
"use client";

import * as React from "react";
import { motion, useMotionValue } from "motion/react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const shinyButtonStyles = cva(
  "relative inline-flex items-center justify-center overflow-hidden rounded-md text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
);

export interface ShinyButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof shinyButtonStyles> {
  asChild?: boolean;
  gradientFrom?: string;
  gradientTo?: string;
  gradientOpacity?: number;
  gradientAngle?: number;
  /** The wash laid over the face on hover. */
  overlayClassName?: string;
  /** How thick the shining border is, in px. */
  borderWidth?: number;
}

export const ShinyButton = React.forwardRef<
  HTMLButtonElement,
  ShinyButtonProps
>(
  (
    {
      asChild = false,
      size = "default",
      className,
      children,
      gradientFrom = "#9E7AFF",
      gradientTo = "#FE8BBB",
      gradientOpacity = 0.8,
      gradientAngle = 0,
      overlayClassName = "bg-neutral-200/40 dark:bg-neutral-800/60",
      borderWidth = 1,
      onPointerEnter,
      onPointerMove,
      onPointerLeave,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const [isHovered, setIsHovered] = React.useState(false);
    const [currentAngle, setCurrentAngle] = React.useState(gradientAngle);
    const [isTouch, setIsTouch] = React.useState(false);
    const angle = useMotionValue(gradientAngle);

    const reset = React.useCallback(() => {
      angle.set(gradientAngle);
      setCurrentAngle(gradientAngle);
      setIsHovered(false);
    }, [angle, gradientAngle]);

    const handlePointerMove = React.useCallback(
      (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "touch") {
          setIsTouch(true);
          return;
        }
        setIsTouch(false);
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - rect.width / 2;
        const dy = y - rect.height / 2;
        const radians = Math.atan2(dy, dx);
        // atan2 is 0° at the right; a CSS gradient's 0° points up, and its
        // first colour (the bright one) sits at the start, opposite the
        // direction. Pointing it away from the pointer puts the bright end there.
        const deg = (radians * 180) / Math.PI - 90;
        angle.set(deg);
        setCurrentAngle(deg);
      },
      [angle],
    );

    React.useEffect(() => {
      reset();
    }, [reset]);

    const gradientStyle = React.useMemo(
      () => ({
        background: `linear-gradient(${currentAngle}deg, ${gradientFrom}, ${gradientTo} 30%, transparent 80%)`,
        opacity: gradientOpacity,
      }),
      [currentAngle, gradientFrom, gradientTo, gradientOpacity],
    );

    return (
      <Comp
        ref={ref}
        className={cn(shinyButtonStyles({ size }))}
        {...props}
        onPointerEnter={(e: React.PointerEvent<HTMLButtonElement>) => { setIsHovered(true); onPointerEnter?.(e); }}
        onPointerMove={(e: React.PointerEvent<HTMLButtonElement>) => { handlePointerMove(e); onPointerMove?.(e); }}
        onPointerLeave={(e: React.PointerEvent<HTMLButtonElement>) => { reset(); onPointerLeave?.(e); }}
      >
        {isTouch ? (
          <div
            className="absolute inset-0 rounded-[inherit]"
            style={{
              background: `linear-gradient(${gradientAngle}deg, ${gradientFrom}, ${gradientTo} 30%, transparent 80%)`,
              opacity: gradientOpacity,
            }}
          />
        ) : (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={gradientStyle}
            animate={{ opacity: gradientOpacity }}
            transition={{
              type: "spring",
              stiffness: 150,
              damping: 20,
              mass: 0.5,
            }}
          />
        )}

        <div
          className={cn(
            "absolute rounded-[inherit] bg-neutral-100 dark:bg-neutral-900",
            className,
          )}
          style={{ inset: borderWidth }}
        />
        <div
          style={{ inset: borderWidth }}
          className={cn(
            "absolute rounded-[inherit] transition-opacity duration-300",
            overlayClassName,
            isHovered ? "opacity-100" : "opacity-0",
          )}
        />
        <span className="relative z-10">{children}</span>
      </Comp>
    );
  },
);
ShinyButton.displayName = "ShinyButton";

export { shinyButtonStyles };

export default ShinyButton;
