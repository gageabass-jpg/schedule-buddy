import { useEffect, useRef, useState } from "react";
import { subscribeToasts, type Toast } from "@nucleus/ui/lib/toast";

const MAX_ON_SCREEN = 4;

/** Transient notices, bottom-left of the main pane, clear of the sidebar. The emitter
 *  is the shared one (shared-ui/lib/toast), so any module can say something with notify(). */
export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const running = timers.current;
    const off = subscribeToasts((toast) => {
      setItems((prev) => [...prev.slice(-(MAX_ON_SCREEN - 1)), toast]);
      running.set(toast.id, setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== toast.id));
        running.delete(toast.id);
      }, toast.ttl));
    });
    return () => { off(); for (const h of running.values()) clearTimeout(h); running.clear(); };
  }, []);

  const dismiss = (id: string) => {
    const h = timers.current.get(id);
    if (h) { clearTimeout(h); timers.current.delete(id); }
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 left-[282px] z-[60] flex w-[min(380px,calc(100vw-300px))] flex-col gap-2.5" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className="glass-panel pointer-events-auto animate-in fade-in-0 slide-in-from-bottom-2 flex items-start gap-3 bg-[rgba(40,27,34,0.94)] px-4 py-3 text-[13.5px] leading-snug"
          style={{ ["--ww-r" as string]: "14px" }}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.actionLabel && t.onAction && (
            <button type="button" onClick={() => { t.onAction?.(); dismiss(t.id); }} className="shrink-0 font-semibold text-crimson-text hover:underline">{t.actionLabel}</button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="shrink-0 text-ink-3 hover:text-foreground">✕</button>
        </div>
      ))}
    </div>
  );
}
