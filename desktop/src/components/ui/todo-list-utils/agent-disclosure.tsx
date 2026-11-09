import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT } from "./ease";

interface AgentDisclosureProps {
  open: boolean;
  id?: string;
  role?: string;
  "aria-labelledby"?: string;
  className?: string;
  children: ReactNode;
}

/**
 * The panel under a disclosure button: grows to its content and fades in when
 * `open`, folds to nothing when not. Closed, it is also hidden from assistive
 * tech and can't take focus, so a collapsed list isn't tabbed through.
 */
export function AgentDisclosure({ open, id, role, "aria-labelledby": labelledBy, className, children }: AgentDisclosureProps) {
  const reduce = useReducedMotion() ?? false;
  return (
    <motion.div
      id={id}
      role={role}
      aria-labelledby={labelledBy}
      aria-hidden={!open}
      inert={!open}
      className={className}
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      transition={
        reduce
          ? { duration: 0 }
          : { height: { duration: 0.26, ease: EASE_OUT }, opacity: { duration: 0.18, ease: EASE_OUT } }
      }
      style={{ overflow: "hidden" }}
    >
      {children}
    </motion.div>
  );
}
