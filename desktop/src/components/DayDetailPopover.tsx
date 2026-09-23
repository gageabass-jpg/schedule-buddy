import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { dayKindFromShifts, MONTHS_LONG, WEEKDAYS_3, type Shift } from "../data";
import { compactTime, type Event as SbEvent, type HouseholdState } from "../state";
import { personColor, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";
import { BrandMark } from "./BrandMark";
import { computePopoverPos, tailStyleFor, type PopoverPos } from "../lib/popoverPos";

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
  selfName, partnerName, isCoverageGap, onOpenShift, onNewShift, onAsk,
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

  const section: CSSProperties = { padding: "14px 16px" };
  const rule: CSSProperties = { height: 1, background: t.sep };
  const hairlineBtn: CSSProperties = {
    height: 32, padding: "0 12px", borderRadius: 4,
    border: `1px solid ${t.sep}`, background: t.bgElev, color: t.text,
    fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  };

  const lifeEvents = events.filter((e) => !e.healthId);

  // Transparent full-screen catcher: keeps click-outside-to-close, no dimming.
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      <div style={wrapperStyle} onClick={(e) => e.stopPropagation()}>
        {anchored && pos && <div aria-hidden="true" style={tailStyleFor(pos, t.bgElev)} />}
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

          {/* Shifts on this day — each row drills into the shift popover. */}
          {dayShifts.length > 0 ? (
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
                    </div>
                    <span style={{ fontSize: 13, color: t.text2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {timeText}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ ...section, fontSize: 13, color: t.text2 }}>Nothing scheduled.</div>
          )}

          {/* Life events + coverage. */}
          {(lifeEvents.length > 0 || isCoverageGap) && (
            <>
              <div style={rule} />
              <div style={{ ...section, display: "flex", flexDirection: "column", gap: 8 }}>
                {isCoverageGap && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 3, alignSelf: "stretch", minHeight: 16, borderRadius: 2, background: CLAY, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: t.text }}>Nobody has the kids.</span>
                  </div>
                )}
                {lifeEvents.map((ev) => (
                  <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 3, alignSelf: "stretch", minHeight: 16, borderRadius: 2, background: BRAND_TEAL, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: t.text2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(ev.title || "Event").replace(PAREN_RANGE, "").replace(TIME_RANGE, "").trim()}
                    </span>
                  </div>
                ))}
              </div>
            </>
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
            <button type="button" onClick={onNewShift} style={{ ...hairlineBtn, marginLeft: "auto" }}>New shift</button>
          </div>
        </div>
      </div>
    </div>
  );
}
