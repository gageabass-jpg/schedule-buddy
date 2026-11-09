// Light / Dark / System switch, the "tabs" variant of designali-in's `Theme`
// (listed on 21st.dev as "theme", used there as "theme-tabs").
// Changes for Nucleus:
//  - only the tabs variant is kept; the button, switch, dropdown, grid and radial
//    variants (and the dropdown / radio-group parts they need) aren't used here;
//  - the choice is controlled (`value` / `onValueChange`) rather than read from
//    next-themes, because the app owns its own Light/Dark/System preference and
//    tells the window about it;
//  - framer-motion is `motion/react`, and the sliding pill's layoutId is scoped per
//    instance so two switches on one screen don't pull each other's pill across;
//  - the pill is outlined with a hairline rather than a shadow, the label stays on
//    one line, and the row can be made to fill the width it's given.

"use client";

import { useId } from "react";
import { motion } from "motion/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type Theme = "light" | "dark" | "system";
export type ThemeToggleSize = "sm" | "md" | "lg";

export const themeConfigs: Record<Theme, { label: string }> = {
  light: { label: "Light" },
  dark: { label: "Dark" },
  system: { label: "System" },
};

const themeIcons = { light: Sun, dark: Moon, system: Monitor } as const;

const TRIGGER_SIZE: Record<ThemeToggleSize, string> = {
  sm: "h-6 px-2",
  md: "h-7 px-1.5",
  lg: "h-8 px-4",
};
const ICON_SIZE: Record<ThemeToggleSize, number> = { sm: 12, md: 12, lg: 16 };
// "md" is tuned to sit in a ~170px row with all three labels (icon + word each).
const TEXT_SIZE: Record<ThemeToggleSize, string> = { sm: "text-xs", md: "text-[11px]", lg: "text-xs" };

interface ThemeToggleProps {
  value: Theme;
  onValueChange: (value: Theme) => void;
  size?: ThemeToggleSize;
  showLabel?: boolean;
  themes?: Theme[];
  /** Stretch the row to the width of its container. */
  fill?: boolean;
  className?: string;
}

export function ThemeTabs({
  value,
  onValueChange,
  size = "md",
  showLabel = false,
  themes = ["light", "dark", "system"],
  fill = false,
  className,
}: ThemeToggleProps) {
  const pillId = useId();
  return (
    <Tabs value={value} onValueChange={(v) => onValueChange(v as Theme)} className={cn(fill && "w-full", className)}>
      <TabsList
        aria-label="Appearance"
        className={cn(
          "inline-flex h-auto items-center rounded-lg border border-solid p-[3px]",
          "border-[var(--color-border)] bg-[var(--color-muted)]",
          fill && "w-full",
        )}
      >
        {themes.map((themeOption) => {
          const Icon = themeIcons[themeOption];
          const isSelected = value === themeOption;
          return (
            <TabsTrigger
              key={themeOption}
              value={themeOption}
              aria-label={showLabel ? undefined : themeConfigs[themeOption].label}
              className={cn(
                // flex-auto, not the base flex-1: each tab is as wide as its own icon + word,
                // and only the leftover is shared out, so "System" isn't squeezed and "Light"
                // isn't left floating in a wide cell.
                "relative inline-flex min-w-0 flex-auto items-center justify-center gap-1 rounded-md border-0 font-medium transition-all",
                TEXT_SIZE[size],
                // the pill is drawn by the motion layer below, not by the trigger
                "data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent",
                TRIGGER_SIZE[size],
                isSelected ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]",
              )}
            >
              {isSelected && (
                <motion.div
                  layoutId={`${pillId}-pill`}
                  // Raised off the track in both grounds (on Ink the card colour is darker than
                  // the track, which made the pill read as a hole).
                  className="absolute inset-0 rounded-md border border-solid border-[var(--color-border)] bg-[var(--color-card)] dark:border-white/15 dark:bg-white/[0.09]"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
              <div className={cn("relative z-10 flex items-center", size === "md" ? "gap-[3px]" : "gap-1")}>
                <Icon size={ICON_SIZE[size]} />
                {showLabel && <span>{themeConfigs[themeOption].label}</span>}
              </div>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
