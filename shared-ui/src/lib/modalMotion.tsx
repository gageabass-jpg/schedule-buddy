// Shared motion for every modal and popover.
//
// On the way in the backdrop fades and the panel rises and settles; on the way
// out the panel fades and sinks a touch instead of vanishing. Escape closes the
// topmost one. The keyframes (nucleus-backdrop-*, nucleus-modal-*,
// nucleus-pop-*) live in src/index.css.
//
// A modal has to stay on screen for its exit, but closing one unmounts it or
// makes it return null. <ModalPresence> covers that: while `open` it renders its
// children and remembers them; when `open` goes false it keeps rendering the
// remembered ones for EXIT_MS with `leaving` set, then lets go.
//
//   <ModalPresence open={!!target}>
//     {target && <EditShiftModal target={target} … />}
//   </ModalPresence>
//
// Inside, the modal calls useModalMotion(open, onClose) and spreads the styles
// it returns onto its backdrop and panel (or popover card).

import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

export const EXIT_MS = 180;

const LeavingContext = createContext(false);

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function ModalPresence({ open, children }: { open: boolean; children: ReactNode }) {
  const held = useRef<ReactNode>(children);
  // eslint-disable-next-line react-hooks/refs -- remembering the last open render is the point
  if (open) held.current = children;

  const [prevOpen, setPrevOpen] = useState(open);
  const [leaving, setLeaving] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setLeaving(!open && !prefersReducedMotion());
  }
  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => setLeaving(false), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [leaving]);

  // Always inside the provider, so opening and closing never remount the
  // modal (a closed one keeps its state, as it did before).
  return (
    <LeavingContext.Provider value={leaving}>
      {/* eslint-disable-next-line react-hooks/refs */}
      {open || !leaving ? children : held.current}
    </LeavingContext.Provider>
  );
}

// Escape closes only the modal opened last, so a modal opened from another
// (an API key prompt over an import) doesn't take its parent down with it.
const escapeStack: string[] = [];

function useEscape(active: boolean, onClose: () => void) {
  const id = useId();
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!active) return;
    escapeStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (escapeStack[escapeStack.length - 1] !== id) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = escapeStack.lastIndexOf(id);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active, id]);
}

export interface ModalMotion {
  leaving: boolean;
  /** The dimmed layer behind a modal. */
  backdrop: CSSProperties;
  /** The modal itself. */
  panel: CSSProperties;
  /** An anchored popover card (pops from its tail). */
  popover: CSSProperties;
}

export function useModalMotion(open: boolean, onClose: () => void): ModalMotion {
  const leaving = useContext(LeavingContext);
  useEscape(open && !leaving, onClose);
  if (prefersReducedMotion()) return { leaving, backdrop: {}, panel: {}, popover: {} };
  const inert: CSSProperties = leaving ? { pointerEvents: "none" } : {};
  return {
    leaving,
    backdrop: {
      ...inert,
      animation: leaving ? `nucleus-backdrop-out ${EXIT_MS}ms ease both` : "nucleus-backdrop-in 220ms ease both",
    },
    panel: {
      ...inert,
      animation: leaving
        ? `nucleus-modal-out ${EXIT_MS}ms cubic-bezier(.4,0,1,1) both`
        : "nucleus-modal-in 320ms cubic-bezier(.16,1,.3,1) both",
    },
    popover: {
      ...inert,
      animation: leaving
        ? `nucleus-pop-out ${EXIT_MS - 40}ms cubic-bezier(.4,0,1,1) both`
        : "nucleus-pop-in 170ms cubic-bezier(.2,.8,.2,1) both",
    },
  };
}
