import { useEffect, useRef, useState } from "react";
import type { ThemeTokens } from "../theme";
import { subscribeToasts, type Toast } from "../lib/toast";
import { BRAND_FONT, BRAND_TEAL } from "./BrandMark";

/**
 * Where transient notices land: the bottom-left of the calendar, clear of the
 * sidebar so it never covers the schedule list. Newest sits lowest, nearest
 * the eye, and each one fades on its own.
 */
export function ToastHost({ t, dark, sidebarWidth = 240 }: {
  t: ThemeTokens;
  dark: boolean;
  /** So the stack clears the left panel rather than overlapping it. */
  sidebarWidth?: number;
}) {
  const [items, setItems] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    return subscribeToasts((toast) => {
      setItems((prev) => [...prev.slice(-3), toast]);   // at most four on screen
      const handle = setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== toast.id));
        timers.current.delete(toast.id);
      }, toast.ttl);
      timers.current.set(toast.id, handle);
    });
  }, []);

  // Don't leave timers running if the window closes mid-fade.
  useEffect(() => {
    const running = timers.current;
    return () => { for (const h of running.values()) clearTimeout(h); running.clear(); };
  }, []);

  const dismiss = (id: string) => {
    const handle = timers.current.get(id);
    if (handle) { clearTimeout(handle); timers.current.delete(id); }
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  if (items.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed", left: sidebarWidth + 20, bottom: 20, zIndex: 1200,
        display: "flex", flexDirection: "column", gap: 10,
        width: "min(360px, calc(100vw - 32px))", pointerEvents: "none",
      }}
    >
      {items.map((toast) => (
        <div
          key={toast.id}
          role="status"
          onClick={() => { toast.onAction?.(); dismiss(toast.id); }}
          style={{
            pointerEvents: "auto",
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "12px 14px", borderRadius: 6,
            background: dark ? "#1B2A27" : "#FFFFFF",
            border: `1px solid ${t.sep}`,
            borderLeft: `3px solid ${BRAND_TEAL}`,
            boxShadow: dark ? "0 12px 32px rgba(0,0,0,0.55)" : "0 12px 32px rgba(20,32,30,0.18)",
            cursor: toast.onAction ? "pointer" : "default",
            animation: "nucleusToastIn 0.22s ease-out",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, color: t.text, lineHeight: 1.45 }}>{toast.text}</div>
            {toast.actionLabel && toast.onAction && (
              <div style={{ fontFamily: BRAND_FONT, fontSize: 12.5, fontWeight: 600, color: t.tealText, marginTop: 5 }}>
                {toast.actionLabel}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
            style={{
              flexShrink: 0, width: 22, height: 22, padding: 0, border: 0, borderRadius: 4,
              background: "transparent", color: t.text3, cursor: "pointer", fontSize: 13, lineHeight: 1,
            }}
          >✕</button>
        </div>
      ))}
    </div>
  );
}

// Injected once — the entry animation is the only thing that needs keyframes.
if (typeof document !== "undefined" && !document.getElementById("nucleus-toast-keyframes")) {
  const style = document.createElement("style");
  style.id = "nucleus-toast-keyframes";
  style.textContent = `@keyframes nucleusToastIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }`;
  document.head.appendChild(style);
}
