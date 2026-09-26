import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { dayKindFromShifts, MONTHS_LONG, WEEKDAYS_3, type Shift } from "../data";
import { compactTime, type Event as SbEvent, type HouseholdState } from "../state";
import { personColor, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";
import { BrandMark } from "./BrandMark";
import { computePopoverPos, tailStyleFor, type PopoverPos } from "../lib/popoverPos";
import { wvuGameLabel, type WvuGame } from "../lib/wvuSchedule";
import { CircleCheckIcon, type CircleCheckIconHandle } from "@/components/ui/circle-check";
import { Flag3FilledIcon } from "@/components/ui/flag-3-filled";
import { FLAG_RED } from "./DayFlagPopover";
import type { DayFlag } from "../lib/dayFlags";

const BRAND_TEAL = "#0F6E64";
const CLAY = "#8A4B38";

const TIME_RANGE = /\s*\d{1,2}:?\d{0,2}\s?[ap]\.?m?\.?\s*[-–]\s*\d{1,2}:?\d{0,2}\s?[ap]\.?m?\.?\s*$/i;
const PAREN_RANGE = /\s*\(\s*\d{3,4}\s*[-–]\s*\d{3,4}\s*\)\s*$/;

interface Props {
  onClose: () => void;
  date: string;                 // YYYY-MM-DD
  dayShifts: Shift[];
  events: SbEvent[];
  /** On-screen rect of the clicked day cell; anchors the popover + tail. */
  anchor?: DOMRect | null;
  t: ThemeTokens;
  palette: Palette;
  dark: boolean;
  state: HouseholdState | null;
  selfName: string;
  partnerName: string;
  isCoverageGap: boolean;
  /** Childcare confirmed for the day (same rule as the calendar's check). */
  careConfirmed: boolean;
  /** The day's flag, if it has one. */
  flag?: DayFlag;
  /** Open the flag editor for this day. */
  onFlag: () => void;
  /** WVU game on this day, if any — surfaced as a game-day row (Saturdays). */
  wvuGame?: WvuGame;
  /** Drill from a row into the existing shift-detail popover. */
  onOpenShift: (shift: Shift, anchor: DOMRect) => void;
  onNewShift: () => void;
  onAsk: () => void;
}

/**
 * "Day detail" popover — what a click on a month cell opens. Same chrome as
 * the shift-detail card (Clay top rule, near-square corners, anchored tail),
 * but scoped to the whole day: every shift on it, the life events, and the
 * coverage line. Clicking a row drills into that shift's own popover.
 */
export function DayDetailPopover({
  onClose, date, dayShifts, events, anchor, t, palette, dark, state,
  selfName, partnerName, isCoverageGap, careConfirmed, flag, onFlag, wvuGame, onOpenShift, onNewShift, onAsk,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Position from an estimate so the card is visible on the first paint, then
  // refine once the real height is known (it varies with the shift count).
  const [pos, setPos] = useState<PopoverPos | null>(() => (anchor ? computePopoverPos(anchor, 340, 300) : null));

  useLayoutEffect(() => {
    if (!anchor) return;
    const card = cardRef.current;
    if (card) setPos(computePopoverPos(anchor, card.offsetWidth, card.offsetHeight));
  }, [anchor]);

  const [y, mo, d] = date.split("-").map(Number);
  const dow = new Date(y, mo - 1, d).getDay();
  const daisyName = state?.dependents?.daisy?.name || "Daisy";

  const kind = dayKindFromShifts(dayShifts);
  const title =
    kind === "off" ? "Both off"
      : kind === "both" ? "Both working"
        : kind === "g" ? `${selfName} works`
          : `${partnerName} works`;

  const width = "min(340px, calc(100vw - 32px))";
  const anchored = !!anchor && !!pos;
  const wrapperStyle: CSSProperties = anchored
    ? { position: "fixed", left: pos!.left, top: pos!.top, width, overflow: "visible", zIndex: 1001 }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width, overflow: "visible", zIndex: 1001 };

  // Pop in from the side the tail points to (centered cards grow from the middle).
  const popIn: CSSProperties = {
    animation: "nucleus-pop-in 170ms cubic-bezier(.2,.8,.2,1) both",
    transformOrigin: anchored && pos ? `${pos.side === "right" ? "left" : "right"} ${pos.tailTop}px` : "center",
  };

  const section: CSSProperties = { padding: "14px 16px" };
  const rule: CSSProperties = { height: 1, background: t.sep };
  const hairlineBtn: CSSProperties = {
    height: 32, padding: "0 12px", borderRadius: 4,
    border: `1px solid ${t.sep}`, background: t.bgElev, color: t.text,
    fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  };

  // Everything planned on the day — life events and appointments alike, so
  // the card never reads "Nothing scheduled." while an event sits on the cell.
  const dayEvents = events;

  // Transparent full-screen catcher: keeps click-outside-to-close, no dimming.
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      <div data-motion="" style={{ ...wrapperStyle, ...popIn }} onClick={(e) => e.stopPropagation()}>
        {anchored && pos && <div aria-hidden="true" style={tailStyleFor(pos, t.bgElev)} />}
        {careConfirmed && <CoveredRibbon />}
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Day detail"
          style={{
            position: "relative",
            maxHeight: "calc(100vh - 32px)", overflowY: "auto",
            background: t.bgElev, border: `1px solid ${t.sep}`,
            borderTop: `2px solid ${CLAY}`, borderRadius: 4,
            boxShadow: dark ? "0 18px 48px rgba(0,0,0,0.6)" : "0 18px 48px rgba(20,32,30,0.22)",
            color: t.text,
          }}
        >
          {/* Header — matches the right-panel day card. */}
          <div style={section}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: t.text3, textTransform: "uppercase" }}>
              {WEEKDAYS_3[dow]} · {MONTHS_LONG[mo - 1]} {d}
            </div>
            <div style={{ fontFamily: BRAND_FONT, fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4, lineHeight: 1.15 }}>
              {title}
            </div>
          </div>

          <div style={rule} />

          {/* The day's flag and why. */}
          {flag && (
            <>
              <div
                style={{ ...section, display: "flex", gap: 10, cursor: "pointer" }}
                onClick={onFlag}
                title="Edit flag"
              >
                <Flag3FilledIcon size={15} style={{ color: FLAG_RED, flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: t.text, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {flag.remarks || "Flagged."}
                  </div>
                  <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2 }}>{flag.flaggedByName}</div>
                </div>
              </div>
              <div style={rule} />
            </>
          )}

          {/* Shifts on this day — each row drills into the shift popover. */}
          {dayShifts.length > 0 && (
            <div style={{ padding: "4px 16px 12px" }}>
              {dayShifts.map((s, i) => {
                const c = personColor(s.who, palette);
                const stype = state?.shiftTypes.find((x) => x.id === s.shiftTypeId);
                const timeText = stype
                  ? `${compactTime(stype.start)} – ${compactTime(stype.end)}`
                  : (s.label || "");
                const name = s.who === "G" ? selfName : s.who === "K" ? partnerName : daisyName;
                return (
                  <div
                    key={i}
                    onClick={(e) => onOpenShift(s, e.currentTarget.getBoundingClientRect())}
                    title="Shift details"
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 2px", cursor: "pointer",
                      borderTop: i === 0 ? "none" : `1px solid ${t.sep}`,
                    }}
                  >
                    <span style={{ width: 4, alignSelf: "stretch", minHeight: 20, borderRadius: 2, background: c, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {name}
                      {/* Whatever the source said beyond the hours — usually who
                          else is on. Bracketed because the note is typically a
                          name too, and "Kaylene Lacey" reads as one person. */}
                      {s.note && (
                        <span style={{ fontWeight: 400, color: t.text3, marginLeft: 7 }}>[{s.note}]</span>
                      )}
                    </div>
                    <span style={{ fontSize: 13, color: t.text2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {timeText}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Life events + appointments + coverage on this day. */}
          {(dayEvents.length > 0 || isCoverageGap) && (
            <>
              {dayShifts.length > 0 && <div style={rule} />}
              <div style={{ ...section, display: "flex", flexDirection: "column", gap: 8 }}>
                {isCoverageGap && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 3, alignSelf: "stretch", minHeight: 16, borderRadius: 2, background: CLAY, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: t.text }}>Nobody has the kids.</span>
                  </div>
                )}
                {dayEvents.map((ev) => (
                  <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 3, alignSelf: "stretch", minHeight: 16, borderRadius: 2, background: ev.healthId ? CLAY : BRAND_TEAL, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(ev.title || "Event").replace(PAREN_RANGE, "").replace(TIME_RANGE, "").trim()}
                    </span>
                    {ev.startTime && (
                      <span style={{ fontSize: 13, color: t.text2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {compactTime(ev.startTime)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* WVU game day — the same static schedule the calendar mark reads. */}
          {wvuGame && (
            <>
              {(dayShifts.length > 0 || dayEvents.length > 0 || isCoverageGap) && <div style={rule} />}
              <div style={{ ...section, display: "flex", alignItems: "center", gap: 10 }}>
                <img
                  src="assets/wvu.png"
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0 }}
                />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {wvuGameLabel(wvuGame)}
                </span>
                {wvuGame.tv && (
                  <span style={{ fontSize: 12, color: t.text2, whiteSpace: "nowrap", flexShrink: 0 }}>{wvuGame.tv}</span>
                )}
              </div>
            </>
          )}

          {/* Truly empty day — no shifts, no events, no coverage gap, no game. */}
          {dayShifts.length === 0 && dayEvents.length === 0 && !isCoverageGap && !wvuGame && (
            <div style={{ ...section, fontSize: 13, color: t.text2 }}>Nothing scheduled.</div>
          )}

          <div style={rule} />

          {/* Footer actions. */}
          <div style={{ ...section, display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={onAsk}
              style={{
                height: 32, padding: "0 12px", borderRadius: 4, border: `1px solid ${BRAND_TEAL}`,
                background: "#D8E7E4", color: BRAND_TEAL, fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600,
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
              }}
            >
              <BrandMark size={15} color={BRAND_TEAL} />
              Ask
            </button>
            <button type="button" onClick={onFlag} style={{ ...hairlineBtn, marginLeft: "auto", color: flag ? FLAG_RED : t.text }}>
              <Flag3FilledIcon size={13} style={{ color: FLAG_RED }} aria-hidden="true" />
              {flag ? "Edit flag" : "Flag"}
            </button>
            <button type="button" onClick={onNewShift} style={hairlineBtn}>New shift</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * "Covered ✓" — a rectangular tag beside the day's title that grows out of
 * the card's right edge. It lives on the popover's wrapper, not the card,
 * because the card scrolls and would clip anything that pokes past its edge.
 * The check draws in once it's out.
 */
function CoveredRibbon() {
  const check = useRef<CircleCheckIconHandle | null>(null);
  useEffect(() => {
    const id = window.setTimeout(() => check.current?.startAnimation(), 360);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      role="status"
      aria-label="Childcare covered"
      data-motion=""
      style={{
        position: "absolute", zIndex: 2,
        // Straddles the card's right edge: 10px of it hangs outside.
        right: -10, top: 31, height: 26,
        display: "flex", alignItems: "center", gap: 6,
        padding: "0 10px 0 12px",
        background: "#0F6E64", color: "#fff", borderRadius: 3,
        fontFamily: BRAND_FONT, fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.01em",
        animation: "nucleus-tab-out 320ms cubic-bezier(.2,.8,.2,1) 140ms both",
      }}
    >
      Covered
      <CircleCheckIcon ref={check} size={15} color="#fff" />
    </div>
  );
}
