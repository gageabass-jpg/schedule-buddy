import { dayKindFromShifts, MONTHS_LONG, WEEKDAYS_3, type Shift, type ShiftMap } from "../data";
import type { CoverageStatus, Event as SbEvent, HouseholdState } from "../state";
import { dayColors, eventColor, personColor, rgba, type Palette, type ThemeTokens } from "../theme";
import { PhotoAv } from "./PhotoAv";
import { EventAvatar } from "./EventAvatar";
import { FatigueHeatmap } from "./FatigueHeatmap";

interface Props {
  selected: string;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  shifts: ShiftMap;
  state: HouseholdState | null;
  selfName: string;
  partnerName: string;
  onEditShift?: (date: string, shift: Shift) => void;
  onDeleteShift?: (date: string, shift: Shift) => void;
  events: SbEvent[];
  onAddEvent: () => void;
  onEditEvent: (ev: SbEvent) => void;
  onSendCoverageForDay: (date: string) => void;
  onToggleChildcareOff: (date: string, off: boolean) => void;
  onSelectDate?: (date: string) => void;
  onOpenScheduleBlock: () => void;
  onOpenCleaner: () => void;
}

const COVERAGE_STATUS_COLOR: Record<CoverageStatus, string> = {
  pending:   "#5E5CE6",
  confirmed: "#30D158",
  declined:  "#FF453A",
  issue:     "#FF9F0A",
};
const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  pending:   "Pending",
  confirmed: "Confirmed",
  declined:  "Declined",
  issue:     "Issue",
};

export function Inspector({
  selected, palette, t, dark, shifts: allShifts, state, selfName, partnerName,
  onEditShift, onDeleteShift, events, onAddEvent, onEditEvent, onSendCoverageForDay,
  onToggleChildcareOff, onSelectDate,
  onOpenScheduleBlock, onOpenCleaner,
}: Props) {
  const [y, m, d] = selected.split("-").map(Number);
  const shifts = allShifts[selected];
  const kind = dayKindFromShifts(shifts);
  const colors = dayColors(kind, palette, dark);
  const accent = colors.accent;
  const dayLabel = `${WEEKDAYS_3[new Date(y, m - 1, d).getDay()]} · ${MONTHS_LONG[m - 1]} ${d}`;

  // Coverage requests on the selected day.
  const dayCoverage = (state?.coverageRequests ?? []).filter((r) => r.date === selected);
  // A "gap" worth flagging = both partners working with no caregiver request yet.
  const isGapDay = kind === "both" && dayCoverage.length === 0;
  // Has this day been explicitly marked "no childcare" (caregiver off)?
  const isChildcareOff = (state?.childcareOff ?? []).some((c) => c.date === selected);

  return (
    <div
      style={{
        background: dark ? "rgba(20,20,22,0.5)" : "rgba(255,255,255,0.6)",
        borderLeft: `0.5px solid ${t.sep}`,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflowY: "auto",
        overflowX: "hidden",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* Selected day card */}
      <div
        style={{
          borderRadius: 12,
          padding: 14,
          background: kind === "off" ? t.bgElev : rgba(accent, dark ? 0.18 : 0.10),
          border: `0.5px solid ${kind === "off" ? t.sep : rgba(accent, 0.35)}`,
        }}
      >
        <div style={subhead(t)}>{dayLabel}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: t.text, letterSpacing: "-0.02em", marginTop: 2 }}>
          {kind === "off"
            ? "Both off"
            : kind === "both"
              ? "Both working"
              : kind === "g"
                ? `${selfName} works`
                : `${partnerName} works`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {(shifts ?? []).map((s, i) => {
            const c = personColor(s.who, palette);
            const editable = !!s.source && !!s.shiftTypeId && !!onEditShift;
            const deletable = !!s.source && !!onDeleteShift;
            const recurring = s.source?.kind === "template" || s.source?.kind === "alt-weekend";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px",
                  borderRadius: 8,
                  background: t.bgElev,
                }}
              >
                <PhotoAv who={s.who} size={26} palette={palette} dark={dark} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>
                    {s.who === "G" ? selfName : partnerName}
                  </div>
                  <div style={{ fontSize: 10.5, color: t.text3 }}>
                    {s.label}{recurring ? " · recurring" : ""}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 7px",
                    borderRadius: 999,
                    background: rgba(c, 0.18),
                    color: c,
                    fontWeight: 600,
                  }}
                >
                  {s.label}
                </span>
                {editable && (
                  <button
                    type="button"
                    aria-label="Edit shift"
                    onClick={() => onEditShift?.(selected, s)}
                    style={iconBtnStyle(t)}
                    title={recurring ? "Edit this date (creates an override)" : "Edit"}
                  >
                    ✎
                  </button>
                )}
                {deletable && (
                  <button
                    type="button"
                    aria-label="Delete shift"
                    onClick={() => onDeleteShift?.(selected, s)}
                    style={iconBtnStyle(t)}
                    title={recurring ? "Mark this date off" : "Delete"}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          {(!shifts || shifts.length === 0) && (
            <div style={{ fontSize: 12, color: t.text3, padding: 8 }}>Free day. Plan something together.</div>
          )}
        </div>
      </div>

      {/* Childcare coverage for the selected day */}
      <div>
        <div style={{ ...subhead(t), marginBottom: 6 }}>Childcare</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {isChildcareOff && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: rgba("#FF453A", dark ? 0.14 : 0.1),
                border: `0.5px solid ${rgba("#FF453A", 0.5)}`,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: t.text, lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: "#FF453A" }}>No childcare</span>
                {" "}— caregiver scheduled off this day.
              </div>
              <button
                type="button"
                onClick={() => onToggleChildcareOff(selected, false)}
                style={{
                  alignSelf: "flex-start",
                  padding: "6px 12px",
                  border: `0.5px solid ${t.sep}`,
                  borderRadius: 7,
                  background: t.bgElev,
                  color: t.text,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                }}
              >
                Childcare available again
              </button>
            </div>
          )}

          {!isChildcareOff && dayCoverage.length === 0 && !isGapDay && (
            <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>
              No coverage needed — not a both-working day.
            </div>
          )}

          {!isChildcareOff && isGapDay && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: rgba("#FF9F0A", dark ? 0.14 : 0.1),
                border: `0.5px solid ${rgba("#FF9F0A", 0.5)}`,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: t.text, lineHeight: 1.4 }}>
                <span style={{ fontWeight: 700, color: "#FF9F0A" }}>Both working</span>
                {" "}— no caregiver lined up for this day.
              </div>
              <button
                type="button"
                onClick={() => onSendCoverageForDay(selected)}
                style={{
                  alignSelf: "flex-start",
                  padding: "6px 12px",
                  border: 0,
                  borderRadius: 7,
                  background: palette.G,
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.01em",
                }}
              >
                Send to caregiver
              </button>
            </div>
          )}

          {dayCoverage.map((req) => {
            const sc = COVERAGE_STATUS_COLOR[req.status];
            return (
              <div
                key={req.id}
                style={{
                  padding: "9px 11px",
                  borderRadius: 9,
                  background: t.bgElev,
                  border: `0.5px solid ${t.sep}`,
                  borderLeft: `3px solid ${sc}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: rgba(sc, 0.18),
                      color: sc,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    {COVERAGE_STATUS_LABEL[req.status]}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: t.text, fontVariantNumeric: "tabular-nums" }}>
                    {req.startTime} → {req.endTime}{req.endsNextDay ? " +1d" : ""}
                  </span>
                </div>
                {req.arriveBy && (
                  <div style={{ fontSize: 10.5, color: t.text3 }}>
                    Arrive by <span style={{ color: t.text2, fontWeight: 600 }}>{req.arriveBy}</span>
                  </div>
                )}
                {req.notes && (
                  <div style={{ fontSize: 11.5, color: t.text2, lineHeight: 1.4 }}>{req.notes}</div>
                )}
                {req.caregiverNote && (
                  <div style={{ fontSize: 11.5, color: t.text2, lineHeight: 1.4, fontStyle: "italic" }}>
                    <span style={{ fontStyle: "normal", fontWeight: 600, color: t.text }}>
                      {req.status === "declined" ? "Caregiver said:" :
                       req.status === "issue"    ? "Caregiver reported:" :
                                                    "Caregiver noted:"}
                    </span>{" "}
                    {req.caregiverNote}
                  </div>
                )}
              </div>
            );
          })}

          {!isChildcareOff && (
            <button
              type="button"
              onClick={() => onToggleChildcareOff(selected, true)}
              title="Mark this day as having no childcare (caregiver off)"
              style={{
                alignSelf: "flex-start",
                marginTop: 2,
                padding: "5px 10px",
                border: `0.5px solid ${t.sep}`,
                borderRadius: 7,
                background: "transparent",
                color: t.text2,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
              }}
            >
              Mark no childcare
            </button>
          )}
        </div>
      </div>

      {/* Events for the selected day */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <span style={subhead(t)}>Events</span>
          <button
            type="button"
            onClick={onAddEvent}
            style={{
              background: "transparent",
              border: 0,
              color: palette.G,
              fontSize: 11.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              padding: 0,
              letterSpacing: "-0.01em",
            }}
          >
            + Add event
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {events.length === 0 && (
            <div style={{ fontSize: 12, color: t.text3, padding: "4px 2px" }}>
              No events yet. Add a doctor visit, rehab, or anything else.
            </div>
          )}
          {events.map((ev) => {
            const color = eventColor(ev.who, palette);
            const timeLabel = ev.startTime
              ? `${ev.startTime}${ev.endTime ? ` – ${ev.endTime}` : ""}`
              : "All day";
            const personName =
              ev.who === "G" ? selfName :
              ev.who === "K" ? partnerName :
              ev.who === "Daisy" ? "Daisy" : "Family";
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => onEditEvent(ev)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: t.bgElev,
                  border: `1px dashed ${rgba(color, 0.55)}`,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  color: t.text,
                  width: "100%",
                }}
              >
                <EventAvatar who={ev.who} size={26} palette={palette} dark={dark} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{ev.title}</div>
                  <div style={{ fontSize: 10.5, color: t.text3 }}>
                    {timeLabel} · {personName}{ev.seriesId ? " · series" : ""}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fatigue heatmap */}
      <FatigueHeatmap
        shifts={allShifts}
        state={state}
        anchorDate={selected}
        t={t}
        onSelectDate={onSelectDate}
      />

      {/* Utilities — Schedule Block + Cleaner */}
      <div>
        <div style={{ ...subhead(t), display: "flex", alignItems: "center", gap: 6 }}>
          <WrenchIcon size={11} color={t.text3} />
          <span>Utilities</span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: t.bgElev,
            border: `0.5px solid ${t.sep}`,
            borderRadius: 10,
            overflow: "hidden",
            marginTop: 4,
          }}
        >
          <UtilityRow
            icon={<StopOctagonInline size={14} />}
            label="Schedule Block"
            hint="Block a day or range with red diagonal stripes."
            onClick={onOpenScheduleBlock}
            t={t}
          />
          <div style={{ height: 0.5, background: t.sep, marginLeft: 38 }} />
          <UtilityRow
            icon={<WandIcon size={14} color={palette.G} />}
            label="Cleaner"
            hint="Upload a clean schedule. Review add / remove / change."
            onClick={onOpenCleaner}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────── Utilities helpers ───────────────────

function UtilityRow({ icon, label, hint, onClick, t }: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  t: ThemeTokens;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: "transparent",
        border: 0,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        color: t.text,
      }}
    >
      <div style={{ width: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>{label}</div>
        <div style={{ fontSize: 11, color: t.text3, marginTop: 1 }}>{hint}</div>
      </div>
      <span style={{ color: t.text3, fontSize: 13 }}>›</span>
    </button>
  );
}

function WrenchIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  // Subtle gray wrench — simplified silhouette.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M22 7a5 5 0 0 1-6.5 4.77L5.83 21.46a2.83 2.83 0 1 1-4-4L11.5 7.83A5 5 0 0 1 18 1.31l-3.18 3.18 2.7 2.7L20.7 4Z"
        fill={color}
        opacity={0.65}
      />
    </svg>
  );
}

function StopOctagonInline({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 2 H16 L22 8 V16 L16 22 H8 L2 16 V8 Z" fill="#FF453A" />
    </svg>
  );
}

function WandIcon({ size = 14, color = "#7FA86A" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      {/* tip star */}
      <path d="M19 3 l1 2 l2 1 l-2 1 l-1 2 l-1-2 l-2-1 l2-1 z" fill={color} />
      {/* wand body */}
      <path
        d="M3 21 L15 9 L17 11 L5 23 z"
        fill={color}
        transform="translate(0,-2)"
        opacity={0.85}
      />
    </svg>
  );
}

function iconBtnStyle(t: ThemeTokens): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    border: `0.5px solid ${t.sep}`,
    background: "transparent",
    color: t.text2,
    borderRadius: 6,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function subhead(t: ThemeTokens): React.CSSProperties {
  return {
    fontSize: 10.5,
    fontWeight: 700,
    color: t.text3,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: 4,
  };
}

