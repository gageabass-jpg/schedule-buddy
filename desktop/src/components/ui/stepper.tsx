import type { CSSProperties } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export type StepperItem = {
  id: string;
  title: string;
  description?: string;
};

/**
 * Numbered milestones for a multi-step flow (the setup wizard). Square
 * markers; a done step shows a check, the current one a heavier outline and a
 * bold title — so the three states read without colour.
 */
export function Stepper({
  steps,
  currentStep,
  orientation = "horizontal",
  className,
}: {
  steps: StepperItem[];
  currentStep: number;
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return (
    <ol
      className={cn(
        orientation === "vertical"
          ? "grid gap-4"
          : "grid gap-4 sm:grid-cols-[repeat(var(--step-count),minmax(0,1fr))]",
        className,
      )}
      style={{ "--step-count": steps.length } as CSSProperties}
    >
      {steps.map((step, index) => {
        const complete = index < currentStep;
        const active = index === currentStep;

        return (
          <li
            key={step.id}
            aria-current={active ? "step" : undefined}
            className={cn(
              "relative flex gap-3",
              orientation === "horizontal" && "sm:flex-col",
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-[5px] text-xs font-medium tabular-nums transition-colors",
                  complete && "border border-primary bg-primary text-primary-foreground",
                  active && "border-2 border-primary text-primary",
                  !complete && !active && "border border-border text-muted-foreground",
                )}
              >
                {complete ? <Check className="size-3.5" aria-label="Done" /> : index + 1}
              </div>
              {index < steps.length - 1 ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    "bg-border",
                    orientation === "vertical"
                      ? "absolute top-8 bottom-[-1rem] left-3.5 w-px"
                      : "hidden h-px flex-1 sm:block",
                    complete && "bg-primary",
                  )}
                />
              ) : null}
            </div>
            <div className="min-w-0">
              <div className={cn("text-sm", active ? "font-semibold" : "font-medium", !complete && !active && "text-muted-foreground")}>
                {step.title}
              </div>
              {step.description ? (
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {step.description}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default Stepper;
