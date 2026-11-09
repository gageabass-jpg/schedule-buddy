import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { SPRING_SWAP } from "./ease";

/**
 * A short piece of text that rolls up out of view when `value` changes and the
 * new one rolls in beneath it, like a counter ticking over. `value` is the key
 * that decides when it rolls; `children` is what's drawn.
 */
export function ActionSwapRollText({ value, children }: { value: string; children: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  return (
    <span className="relative inline-flex overflow-hidden tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={reduce ? { opacity: 1 } : { y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: "-100%", opacity: 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="inline-block"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
