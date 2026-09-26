import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MONTHS_LONG, WEEKDAYS_3 } from "../data";
import { BRAND_FONT, type ThemeTokens } from "../theme";
import { computePopoverPos, tailStyleFor, type PopoverPos } from "../lib/popoverPos";
import { removeDayFlag, saveDayFlag, type DayFlag } from "../lib/dayFlags";
import { Flag3FilledIcon } from "@/components/ui/flag-3-filled";

/** The flag's red. Nucleus keeps red out of its palette; a flag is the one
 *  place it's wanted, and the flag shape carries the meaning on its own. */
export const FLAG_RED = "#DC2626";

interface Props {
  date: string;                  // YYYY-MM-DD
  /** The day cell it was opened from; the card sits beside it. */
  anchor?: DOMRect | null;
  flag?: DayFlag;
  householdId: string | null;
  authorName: string;
  t: ThemeTokens;
  dark: boolean;
  onClose: () => void;
}

/**
 * Flag a day and say why. Same chrome as the day and shift cards (anchored
 * beside the cell, tail, pop-in), with a red top rule in place of Clay.
 */
export function DayFlagPopover({ date, anchor, flag, householdId, authorName, t, dark, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPos | null>(() => (anchor ? computePopoverPos(anchor, 320, 240) : null));
  const [remarks, setRemarks] = useState(flag?.remarks ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const card = cardRef.current;
    if (card) setPos(computePopoverPos(anchor, card.offsetWidth, card.offsetHeight));
  }, [anchor]);

  const [y, mo, d] = date.split("-").map(Number);
  const dow = new Date(y, mo - 1, d).getDay();

  const run = async (fn: () => Promise<void>) => {
    if (!householdId) { setErr("No household linked."); return; }
    setBusy(true);
    setErr(null);
    try { await fn(); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  };
  const onSave = () => run(() => saveDayFlag(householdId!, date, remarks, authorName));
  const onRemove = () => run(() => removeDayFlag(householdId!, date));

  const width = "min(320px, calc(100vw - 32px))";
  const anchored = !!anchor && !!pos;
  const wrapperStyle: CSSProperties = anchored
    ? { position: "fixed", left: pos!.left, top: pos!.top, width, overflow: "visible", zIndex: 1001 }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width, overflow: "visible", zIndex: 1001 };
  const popIn: CSSProperties = {
    animation: "nucleus-pop-in 170ms cubic-bezier(.2,.8,.2,1) both",
    transformOrigin: anchored && pos ? `${pos.side === "right" ? "left" : "right"} ${pos.tailTop}px` : "center",
  };
  const btn: CSSProperties = {
    height: 32, padding: "0 12px", borderRadius: 4, border: `1px solid ${t.sep}`,
    background: t.bgElev, color: t.text, fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600,
    cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      <div data-motion="" style={{ ...wrapperStyle, ...popIn }} onClick={(e) => e.stopPropagation()}>
        {anchored && pos && <div aria-hidden="true" style={tailStyleFor(pos, t.bgElev)} />}
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Flag this day"
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
          style={{
            position: "relative", background: t.bgElev, color: t.text,
            border: `1px solid ${t.sep}`, borderTop: `2px solid ${FLAG_RED}`, borderRadius: 4,
            boxShadow: dark ? "0 18px 48px rgba(0,0,0,0.6)" : "0 18px 48px rgba(20,32,30,0.22)",
          }}
        >
          <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 10 }}>
            <Flag3FilledIcon size={18} style={{ color: FLAG_RED, flexShrink: 0 }} aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: t.text3, textTransform: "uppercase" }}>
                {WEEKDAYS_3[dow]} · {MONTHS_LONG[mo - 1]} {d}
              </div>
              <div style={{ fontFamily: BRAND_FONT, fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 2 }}>
                {flag ? "Flagged" : "Flag this day"}
              </div>
            </div>
          </div>

          <div style={{ padding: "0 16px 12px" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: t.text2, marginBottom: 6 }} htmlFor="day-flag-remarks">
              Remarks
            </label>
            <textarea
              id="day-flag-remarks"
              autoFocus
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void onSave(); } }}
              placeholder="What should the household know about this day?"
              maxLength={1000}
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box", resize: "vertical",
                padding: "8px 10px", borderRadius: 4, border: `1px solid ${t.sep}`,
                background: dark ? "rgba(255,255,255,0.04)" : "#F7F6F3", color: t.text,
                fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.45, outline: "none",
              }}
            />
            {flag && (
              <div style={{ fontSize: 11.5, color: t.text3, marginTop: 6 }}>Flagged by {flag.flaggedByName}</div>
            )}
            {err && <div style={{ fontSize: 12, color: "#8A4B38", marginTop: 6 }}>{err}</div>}
          </div>

          <div style={{ height: 1, background: t.sep }} />
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
            {flag && (
              <button type="button" onClick={onRemove} disabled={busy} style={{ ...btn, color: FLAG_RED }}>
                Remove flag
              </button>
            )}
            <button type="button" onClick={onClose} disabled={busy} style={{ ...btn, marginLeft: "auto" }}>Cancel</button>
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              style={{ ...btn, border: 0, background: FLAG_RED, color: "#fff" }}
            >
              {busy ? "Saving…" : flag ? "Save" : "Flag day"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
