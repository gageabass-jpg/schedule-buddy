import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MONTHS_LONG, type Shift, type Who } from "../data";
import { compactTime, type Event as SbEvent, type HouseholdState } from "../state";
import { personColor, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";
import { BrandMark } from "./BrandMark";
import { computePopoverPos, tailStyleFor, type PopoverPos } from "../lib/popoverPos";

const BRAND_TEAL = "#0F6E64";
const CLAY = "#8A4B38";

const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));

const TIME_RANGE = /\s*\d{1,2}:?\d{0,2}\s?[ap]\.?m?\.?\s*[-–]\s*\d{1,2}:?\d{0,2}\s?[ap]\.?m?\.?\s*$/i;
const PAREN_RANGE = /\s*\(\s*\d{3,4}\s*[-–]\s*\d{3,4}\s*\)\s*$/;

interface Props {
  open: boolean;
  onClose: () => void;
  shift: Shift;
  date: string;                 // YYYY-MM-DD
  who: Who;
  /** Every shift on `date`, so "meanwhile" can name who is home. */
  dayShifts: Shift[];
  /** On-screen rect of the clicked chip; anchors the popover + tail. */
  anchor?: DOMRect | null;
  t: ThemeTokens;
  palette: Palette;
  dark: boolean;
  state: HouseholdState | null;
  events: SbEvent[];
  householdName: string;
  selfName: string;
  partnerName: string;
  isCoverageGap: boolean;
  onEdit: () => void;
  onHandOff: () => void;
  onAsk: () => void;
  onDelete: () => void;
}

function enteredDate(shift: Shift): Date | null {
  const raw = (shift as { createdAt?: number; enteredAt?: number }).createdAt
    ?? (shift as { createdAt?: number; enteredAt?: number }).enteredAt;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
function fmtEntered(d: Date): string {
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}
function toMin(s: string): number { const [h, m] = (s || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); }
function durStr(min: number): string { const h = Math.floor(min / 60), m = min % 60; return m ? `${h}h ${m}m` : `${h}h`; }

/**
 * "Shift detail" popover. When given the clicked chip's `anchor` rect it opens
 * beside the chip with a tail pointing at it — flipping to the chip's left (and
 * moving the tail to the popover's right edge) when there isn't room on the
 * right, e.g. the Saturday column. With no anchor it falls back to a centered card.
 */
export function ShiftDetailPopover({
  open, onClose, shift, date, who, dayShifts, anchor, t, palette, dark, state, events,
  householdName, selfName, partnerName, isCoverageGap,
  onEdit, onHandOff, onAsk, onDelete,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Position synchronously from an estimate so the box is visible on the first
  // paint, then refine once the real card size is known.
  const [pos, setPos] = useState<PopoverPos | null>(() => (open && anchor ? computePopoverPos(anchor, 380, 440) : null));

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const card = cardRef.current;
    if (card) setPos(computePopoverPos(anchor, card.offsetWidth, card.offsetHeight));
  }, [open, anchor]);

  if (!open) return null;

  const personCol = personColor(who, palette);
  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  const personName = who === "G" ? selfName : who === "K" ? partnerName : daisyName;

  const [y, mo, d] = date.split("-").map(Number);
  const dow = new Date(y, mo - 1, d).getDay();

  const stype = state?.shiftTypes.find((x) => x.id === shift.shiftTypeId);

  let bigLine: string;
  let durationMin = 0;
  let crossesMidnight = false;
  if (stype) {
    bigLine = `${compactTime(stype.start)} – ${compactTime(stype.end)}`;
    durationMin = toMin(stype.end) - toMin(stype.start);
    crossesMidnight = !!stype.crossesMidnight || durationMin <= 0;
    if (crossesMidnight) durationMin += 1440;
  } else {
    bigLine = shift.label || "Shift";
  }
  const subtitleParts = [`${WEEKDAYS_LONG[dow]}, ${MONTHS_LONG[mo - 1]} ${d}`];
  if (durationMin > 0) subtitleParts.push(durStr(durationMin));
  if (crossesMidnight) subtitleParts.push(`ends ${WEEKDAYS_LONG[(dow + 1) % 7]}`);
  const subtitle = subtitleParts.join(" · ");

  const where = (shift as { where?: string }).where;
  const typeName = stype ? (stype.name.replace(PAREN_RANGE, "").replace(TIME_RANGE, "").trim() || "Shift") : "Shift";
  const note = (shift as { note?: string }).note;
  const entered = enteredDate(shift);

  const other: Who | null = who === "K" ? "G" : who === "G" ? "K" : null;
  const otherName = other === "G" ? selfName : other === "K" ? partnerName : "";
  const otherWorks = other ? dayShifts.some((s) => s.who === other) : false;
  const daisyHome = who !== "D" && !dayShifts.some((s) => s.who === "D");
  const homeParts: string[] = [];
  if (other) homeParts.push(otherWorks ? `${otherName} also works.` : `${otherName} is off.`);
  if (daisyHome) homeParts.push(`${daisyName} is home.`);
  const homeText = homeParts.join(" ") || "Home is clear.";
  const homeTick = otherWorks ? CLAY : BRAND_TEAL;

  const lifeCount = events.filter((e) => !e.healthId).length;
  const row2Text = isCoverageGap
    ? "Nobody has the kids."
    : lifeCount > 0
      ? `${lifeCount} life event${lifeCount === 1 ? "" : "s"} booked.`
      : "Nobody else works tonight.";
  const row2Tick = isCoverageGap ? CLAY : t.sep;

  const hairlineBtn: CSSProperties = {
    height: 34, padding: "0 14px", borderRadius: 4,
    border: `1px solid ${t.sep}`, background: t.bgElev, color: t.text,
    fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  };
  const section: CSSProperties = { padding: "16px 18px" };
  const rule: CSSProperties = { height: 1, background: t.sep };

  const width = "min(380px, calc(100vw - 32px))";
  const anchored = !!anchor && !!pos;
  const wrapperStyle: CSSProperties = anchored
    ? { position: "fixed", left: pos!.left, top: pos!.top, width, overflow: "visible", zIndex: 1001 }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width, overflow: "visible", zIndex: 1001 };

  // Transparent full-screen catcher: keeps click-outside-to-close, no dimming.
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000 }}>
      <div style={wrapperStyle} onClick={(e) => e.stopPropagation()}>
        {anchored && pos && <div aria-hidden="true" style={tailStyleFor(pos, t.bgElev)} />}
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Shift detail"
          style={{
            position: "relative",
            maxHeight: "calc(100vh - 32px)", overflowY: "auto",
            background: t.bgElev, border: `1px solid ${t.sep}`,
            borderTop: `2px solid ${CLAY}`, borderRadius: 4,
            boxShadow: dark ? "0 18px 48px rgba(0,0,0,0.6)" : "0 18px 48px rgba(20,32,30,0.22)",
            color: t.text,
          }}
        >
          {/* Header + headline. */}
          <div style={section}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 3, height: 16, borderRadius: 2, background: personCol, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{personName}</span>
              {entered && (
                <span style={{
                  marginLeft: "auto", padding: "3px 8px", borderRadius: 4, background: t.bgElev2, color: t.text2,
                  fontSize: 10, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap",
                }}>
                  Entered {fmtEntered(entered)}
                </span>
              )}
            </div>
            <div style={{ fontFamily: BRAND_FONT, fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 10, color: t.text }}>
              {bigLine}
            </div>
            <div style={{ fontSize: 13, color: t.text2, marginTop: 4 }}>{subtitle} · {householdName}</div>
          </div>

          <div style={rule} />

          {/* Detail rows. */}
          <div style={{ ...section, display: "flex", flexDirection: "column", gap: 10 }}>
            <DetailRow label="WHERE" value={where || "—"} t={t} />
            <DetailRow label="TYPE" value={typeName} t={t} />
            <DetailRow label="NOTE" value={note || "—"} t={t} />
          </div>

          <div style={rule} />

          {/* Meanwhile at home. */}
          <div style={section}>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: t.text3 }}>MEANWHILE AT HOME</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              <MeanwhileRow text={homeText} tick={homeTick} strong t={t} />
              <MeanwhileRow text={row2Text} tick={row2Tick} t={t} />
            </div>
          </div>

          <div style={rule} />

          {/* Footer actions. */}
          <div style={{ ...section, display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={onAsk}
              style={{
                height: 34, padding: "0 14px", borderRadius: 4, border: `1px solid ${BRAND_TEAL}`,
                background: "#D8E7E4", color: BRAND_TEAL, fontFamily: BRAND_FONT, fontSize: 13, fontWeight: 600,
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7,
              }}
            >
              <BrandMark size={15} color={BRAND_TEAL} />
              Ask
            </button>
            <button type="button" onClick={onEdit} style={hairlineBtn}>Edit</button>
            <button type="button" onClick={onHandOff} style={hairlineBtn}>Hand it off</button>
            <button
              type="button"
              aria-label="Delete shift"
              onClick={onDelete}
              style={{ ...hairlineBtn, marginLeft: "auto", padding: 0, width: 34, minWidth: 34 }}
            >
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6"
                  stroke={CLAY} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, t }: { label: string; value: string; t: ThemeTokens }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <span style={{ width: 74, flexShrink: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: t.text3 }}>
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: t.text }}>{value}</span>
    </div>
  );
}

function MeanwhileRow({ text, tick, strong, t }: { text: string; tick: string; strong?: boolean; t: ThemeTokens }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 3, alignSelf: "stretch", minHeight: 16, borderRadius: 2, background: tick, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: strong ? t.text : t.text2 }}>{text}</span>
    </div>
  );
}
