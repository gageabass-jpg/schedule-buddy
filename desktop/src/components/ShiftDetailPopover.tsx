import type { CSSProperties } from "react";
import { MONTHS_LONG, type Shift, type Who } from "../data";
import { compactTime, type Event as SbEvent, type HouseholdState } from "../state";
import { personColor, BRAND_FONT, type Palette, type ThemeTokens } from "../theme";

const BRAND_TEAL = "#0F6E64";
const CLAY = "#8A4B38";

interface Props {
  open: boolean;
  onClose: () => void;
  shift: Shift;
  date: string;                 // YYYY-MM-DD
  who: Who;
  t: ThemeTokens;
  palette: Palette;
  dark: boolean;
  state: HouseholdState | null;
  /** The selected day's events (already scoped to `date`). */
  events: SbEvent[];
  householdName: string;
  selfName: string;
  partnerName: string;
  /** Whether `date` is a both-working coverage gap (nobody home). */
  isCoverageGap: boolean;
  onEdit: () => void;
  onHandOff: () => void;
  onAsk: () => void;
  onDelete: () => void;
}

const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));

/** Pull a created/entered timestamp off the shift if the source carries one. */
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

/**
 * Read-first "Shift detail" popover: a centered modal-style card that shows a
 * single shift with who owns it, the day's context, and quick actions. The
 * card floats, so it may carry a drop shadow; a dim backdrop closes it.
 */
export function ShiftDetailPopover({
  open, onClose, shift, date, who, t, palette, dark, state, events,
  householdName, selfName, partnerName, isCoverageGap,
  onEdit, onHandOff, onAsk, onDelete,
}: Props) {
  if (!open) return null;

  const personCol = personColor(who, palette);
  const daisyName = state?.dependents?.daisy?.name || "Daisy";
  const personName = who === "G" ? selfName : who === "K" ? partnerName : daisyName;

  const [, mo, d] = date.split("-").map(Number);
  const dayLabel = `${MONTHS_LONG[mo - 1]} ${d}`;

  const stype = state?.shiftTypes.find((x) => x.id === shift.shiftTypeId);
  const bigLine = shift.label || (stype ? compactTime(stype.start) : "Shift");

  const where = (shift as { where?: string }).where;
  const note = shift.label;

  const entered = enteredDate(shift);

  const lifeCount = events.filter((e) => !e.healthId).length;
  const lifeText = lifeCount === 0
    ? "Nothing else booked."
    : `${lifeCount} life event${lifeCount === 1 ? "" : "s"} booked.`;
  const coverageText = isCoverageGap
    ? "Coverage needed — nobody is home."
    : "No coverage needed.";

  const hairlineBtn: CSSProperties = {
    minHeight: 36,
    padding: "0 14px",
    borderRadius: 9,
    border: `1px solid ${t.sep}`,
    background: t.bgElev,
    color: t.text,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-label="Shift detail"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(360px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: t.bgElev,
          border: `1px solid ${t.sep}`,
          borderRadius: 14,
          padding: 18,
          boxShadow: dark
            ? "0 18px 48px rgba(0,0,0,0.6)"
            : "0 18px 48px rgba(20,32,30,0.22)",
          color: t.text,
        }}
      >
        {/* Header: person tick + name, optional ENTERED chip. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 3, height: 16, borderRadius: 2, background: personCol, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: personCol }}>{personName}</span>
          {entered && (
            <span
              style={{
                marginLeft: "auto",
                padding: "3px 8px",
                borderRadius: 6,
                background: t.bgElev2,
                color: t.text2,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
                whiteSpace: "nowrap",
              }}
            >
              ENTERED {fmtEntered(entered)}
            </span>
          )}
        </div>

        {/* Big line + subtitle. */}
        <div
          style={{
            fontFamily: BRAND_FONT,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginTop: 12,
            color: t.text,
          }}
        >
          {bigLine}
        </div>
        <div style={{ fontSize: 12, color: t.text2, marginTop: 3 }}>
          {dayLabel} · {householdName}
        </div>

        {/* Detail rows. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          <DetailRow label="WHERE" value={where || "—"} t={t} />
          <DetailRow label="TYPE" value="Shift" t={t} />
          <DetailRow label="NOTE" value={note || "—"} t={t} />
        </div>

        {/* Meanwhile at home. */}
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: t.text3, marginTop: 18 }}>
          MEANWHILE AT HOME
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          <MeanwhileRow text={lifeText} tick={t.sep} t={t} />
          <MeanwhileRow text={coverageText} tick={isCoverageGap ? CLAY : t.sep} t={t} />
        </div>

        {/* Footer actions. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
          <button
            type="button"
            onClick={onAsk}
            style={{
              minHeight: 36,
              padding: "0 14px",
              borderRadius: 999,
              border: `1px solid ${BRAND_TEAL}`,
              background: "transparent",
              color: BRAND_TEAL,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <img src="/assets/nucleus-mark.svg" width={15} height={15} alt="" aria-hidden="true" style={{ display: "block" }} />
            Ask
          </button>
          <button type="button" onClick={onEdit} style={hairlineBtn}>Edit</button>
          <button type="button" onClick={onHandOff} style={hairlineBtn}>Hand it off</button>
          <button
            type="button"
            aria-label="Delete shift"
            onClick={onDelete}
            style={{ ...hairlineBtn, marginLeft: "auto", padding: 0, width: 36, minWidth: 36 }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6"
                stroke={t.text2}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, t }: { label: string; value: string; t: ThemeTokens }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <span style={{ width: 58, flexShrink: 0, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: t.text3 }}>
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.text }}>{value}</span>
    </div>
  );
}

function MeanwhileRow({ text, tick, t }: { text: string; tick: string; t: ThemeTokens }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 2, alignSelf: "stretch", minHeight: 16, borderRadius: 2, background: tick, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: t.text2 }}>{text}</span>
    </div>
  );
}
