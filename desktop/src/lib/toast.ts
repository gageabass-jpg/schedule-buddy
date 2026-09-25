// Transient notices, shown bottom-left beside the sidebar.
//
// A module-level emitter rather than a context: anything that changes the
// schedule can say so with one import, without threading a prop through the
// component tree. The host subscribes; nothing else needs to know it exists.

export interface Toast {
  id: string;
  text: string;
  /** Shown as a quiet affordance; the whole toast is the target. */
  actionLabel?: string;
  /** What "Tap to view" does — usually jump the calendar to the date. */
  onAction?: () => void;
  /** Milliseconds before it fades on its own. */
  ttl: number;
}

type Listener = (t: Toast) => void;

const listeners = new Set<Listener>();
let seq = 0;

/** A window during which snapshot diffs stay quiet, so a local action that
 *  already announced itself doesn't get announced again when the write
 *  round-trips through Firestore. */
let mutedUntil = 0;

export function notify(
  text: string,
  opts: { actionLabel?: string; onAction?: () => void; ttl?: number } = {},
): void {
  const toast: Toast = {
    id: `t${++seq}_${Date.now().toString(36)}`,
    text,
    actionLabel: opts.actionLabel,
    onAction: opts.onAction,
    ttl: opts.ttl ?? 7000,
  };
  for (const l of listeners) l(toast);
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Call right after a local write that has already told the user about itself. */
export function muteChangeNotices(ms = 8000): void {
  mutedUntil = Date.now() + ms;
}

export function changeNoticesMuted(): boolean {
  return Date.now() < mutedUntil;
}
