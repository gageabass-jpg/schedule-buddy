import { useState } from "react";
import { personColor, type Palette, type ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import { writeNewShift, type ShiftTarget } from "../lib/writeShift";
import { compactTime, isCustomType } from "../state";
import { BRAND_FONT } from "./BrandMark";

// Nucleus palette literals used where the board calls for exact values
// (independent of the person-hue tokens on `palette`).
const TEAL = "#0F6E64";       // primary / selection
const TEAL_TINT = "#D8E7E4";  // selected fill (segments, cards, childcare note)
const CLAY = "#8A4B38";       // attention / error text

type RepeatMode = "none" | "weekly" | "biweekly" | "custom";

const REPEAT_OPTS: { id: RepeatMode; label: string }[] = [
  { id: "none", label: "Does not repeat" },
  { id: "weekly", label: "Every week" },
  { id: "biweekly", label: "Every other week" },
  { id: "custom", label: "Custom" },
];

// Recurrence horizon: occurrences are written for the next 12 weeks (84 days).
const HORIZON_DAYS = 84;

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  defaultDate: string;
}

export function NewShiftModal({ open, onClose, palette, t, dark, householdId, state, defaultDate }: Props) {
  const types = (state?.shiftTypes ?? []).filter((s) => !isCustomType(s.id));

  const [target, setTarget] = useState<ShiftTarget>("self-ot");
  const [date, setDate] = useState<string>(defaultDate);
  const [shiftTypeId, setShiftTypeId] = useState<string>(types[0]?.id ?? "");
  const [startT, setStartT] = useState<string>(types[0]?.start ?? "09:00");
  const [endT, setEndT] = useState<string>(types[0]?.end ?? "17:00");
  const [repeat, setRepeat] = useState<RepeatMode>("none");
  const [repeatN, setRepeatN] = useState<number>(4);
  const [where, setWhere] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset form fields when the modal opens for a new entry.
  const openKey = `${open}-${defaultDate}`;
  const [lastOpenKey, setLastOpenKey] = useState(openKey);
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    const first = (state?.shiftTypes ?? []).filter((s) => !isCustomType(s.id))[0];
    setTarget("self-ot");
    setDate(defaultDate);
    setShiftTypeId(first?.id ?? "");
    setStartT(first?.start ?? "09:00");
    setEndT(first?.end ?? "17:00");
    setRepeat("none");
    setRepeatN(4);
    setWhere("");
    setNote("");
    setErr(null);
  }

  if (!open) return null;

  const selType = types.find((s) => s.id === shiftTypeId);
  // Prefill starts/ends from the picked template; the user can then edit them.
  const pickType = (id: string) => {
    setShiftTypeId(id);
    const st = types.find((s) => s.id === id);
    if (st) {
      setStartT(st.start);
      setEndT(st.end);
    }
  };

  // A shift carries a customTime only when the times differ from the template's
  // (or there is no template to key off).
  const timesEdited = !selType || startT !== selType.start || endT !== selType.end;
  const lengthLabel = computeLength(startT, endT);

  const householdLabel = state?.householdName?.trim() || "Your household";
  const dateLabel = fmtLongDate(date);
  const selfName = state?.selfName?.trim() || "Gage";
  const partnerName = state?.partner?.name?.trim() || "Kaylene";
  const daisyName = state?.dependents?.daisy?.name?.trim() || "Daisy";

  // The dates a submit will write, from the Repeats choice.
  const occurrenceDates = (): string[] => {
    if (repeat === "none") return [date];
    if (repeat === "custom") {
      const n = Math.max(2, Math.min(12, Math.round(repeatN || 2)));
      return Array.from({ length: n }, (_, i) => addDaysISO(date, i * 7));
    }
    const step = repeat === "biweekly" ? 14 : 7;
    const out: string[] = [];
    for (let off = 0; off < HORIZON_DAYS; off += step) out.push(addDaysISO(date, off));
    return out;
  };
  const occ = occurrenceDates();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId) {
      setErr("No household linked.");
      return;
    }
    if (!shiftTypeId && !timesEdited) {
      setErr("Pick a template or set a start and end time.");
      return;
    }
    if (timesEdited && startT === endT) {
      setErr("Starts and ends can't be the same.");
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const dates = occurrenceDates();
      await writeNewShift({
        householdId,
        target,
        date,
        shiftTypeId,
        note,
        where,
        customTime: timesEdited ? { start: startT, end: endT } : undefined,
        dates: dates.length > 1 ? dates : undefined,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the shift.");
    } finally {
      setBusy(false);
    }
  };

  const isDaisy = target === "dependent-daisy";

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(20,32,30,0.52)", zIndex: 1100 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New shift"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(600px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          background: t.bgElev,
          color: t.text,
          border: `1px solid ${t.sep}`,
          borderRadius: 6,
          boxShadow: dark ? "0 24px 64px rgba(0,0,0,0.6)" : "0 24px 64px rgba(20,32,30,0.28)",
          zIndex: 1101,
          fontFamily: "inherit",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header — title + subtitle, hairline-box close. */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "20px 22px 16px", borderBottom: `1px solid ${t.sep}` }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <div style={{ fontFamily: BRAND_FONT, fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em", color: t.text }}>
              New shift
            </div>
            <div style={{ fontSize: 13, color: t.text2 }}>
              {dateLabel ? `${dateLabel} · ${householdLabel}` : householdLabel}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 30, height: 30, flexShrink: 0, padding: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              borderRadius: 4, border: `1px solid ${t.sep}`, background: t.bgElev, color: t.text2, cursor: "pointer",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ display: "contents" }}>
          {/* Body */}
          <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
            {/* WHO WORKS IT */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <FieldLabel t={t}>Who works it</FieldLabel>
              <div style={{ display: "flex", gap: 8 }}>
                <PersonCard name={selfName} initial="G" color={palette.G} active={target === "self-ot"} onClick={() => setTarget("self-ot")} t={t} />
                <PersonCard name={partnerName} initial="K" color={palette.K} active={target === "partner"} onClick={() => setTarget("partner")} t={t} />
                <PersonCard name={daisyName} initial="D" color={personColor("D", palette)} active={isDaisy} onClick={() => setTarget("dependent-daisy")} t={t} />
              </div>
            </div>

            {/* DATE + TEMPLATE */}
            <div style={{ display: "flex", gap: 14 }}>
              <Field label="Date" t={t}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={inputStyle(t)} />
              </Field>
              <Field label="Template" t={t}>
                <select value={shiftTypeId} onChange={(e) => pickType(e.target.value)} style={selectStyle(t)}>
                  {types.length === 0 && <option value="">No templates — set a time</option>}
                  {types.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {compactTime(s.start)} – {compactTime(s.end)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* STARTS + ENDS + LENGTH */}
            <div style={{ display: "flex", gap: 14 }}>
              <Field label="Starts" t={t}>
                <input type="time" value={startT} onChange={(e) => setStartT(e.target.value)} style={inputStyle(t)} />
              </Field>
              <Field label="Ends" t={t}>
                <input type="time" value={endT} onChange={(e) => setEndT(e.target.value)} style={inputStyle(t)} />
              </Field>
              <div style={{ width: 116, flexShrink: 0, display: "flex", flexDirection: "column", gap: 7 }}>
                <FieldLabel t={t}>Length</FieldLabel>
                <div style={{ height: 40, display: "flex", alignItems: "center", fontSize: 14, color: t.text2, whiteSpace: "nowrap" }}>
                  {lengthLabel}
                </div>
              </div>
            </div>

            {/* REPEATS — bordered segmented control. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <FieldLabel t={t}>Repeats</FieldLabel>
              <div style={{ display: "flex", border: `1px solid ${t.sep}`, borderRadius: 4, overflow: "hidden", background: t.sep, gap: 1 }}>
                {REPEAT_OPTS.map((opt) => {
                  const on = repeat === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setRepeat(opt.id)}
                      style={{
                        flexGrow: 1, minWidth: 0, height: 36, border: "none", cursor: "pointer",
                        background: on ? TEAL_TINT : t.bgElev,
                        color: on ? t.text : t.text2,
                        fontFamily: "inherit", fontSize: 13, fontWeight: on ? 600 : 400,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 4px",
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {repeat === "custom" && (
                <div style={{ display: "flex" }}>
                  <Field label={`Repeat weekly × ${Math.max(2, Math.min(12, Math.round(repeatN || 2)))}`} t={t}>
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={repeatN}
                      onChange={(e) => setRepeatN(Math.max(2, Math.min(12, Number(e.target.value) || 2)))}
                      style={{ ...inputStyle(t), width: 96, flex: "0 0 auto" }}
                    />
                  </Field>
                </div>
              )}
              {repeat !== "none" && (
                <div style={{ fontSize: 12, color: t.text3 }}>
                  Adds {occ.length} shift{occ.length === 1 ? "" : "s"} — every {repeat === "biweekly" ? "other week" : "week"} through {fmtShort(occ[occ.length - 1])}.
                </div>
              )}
            </div>

            {/* WHERE + NOTE */}
            <div style={{ display: "flex", gap: 14 }}>
              <Field label="Where" t={t}>
                <input type="text" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Thomas Hospital" style={inputStyle(t)} />
              </Field>
              <Field label="Note (optional)" t={t}>
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the household should know" style={inputStyle(t)} />
              </Field>
            </div>

            {/* Childcare block — shown when Daisy is who works it. */}
            {isDaisy && (
              <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "12px 14px", background: TEAL_TINT, border: `1px solid ${TEAL}`, borderRadius: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: TEAL }}>Childcare block</span>
                <span style={{ fontSize: 12, lineHeight: 1.5, color: TEAL }}>
                  This puts {daisyName} on the calendar covering the kids for this time. It's not a work shift.
                </span>
              </div>
            )}

            {err && <div style={{ fontSize: 12, color: CLAY }}>{err}</div>}
          </div>

          {/* Footer — Paper bar, reassurance text, actions. */}
          <div
            style={{
              flexShrink: 0,
              padding: "16px 22px",
              borderTop: `1px solid ${t.sep}`,
              background: t.bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, color: t.text2, flex: "1 1 180px", minWidth: 0 }}>
              Nothing is sent to anyone until you press <strong style={{ color: t.text, fontWeight: 600 }}>Add shift</strong>.
            </div>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              <button type="button" onClick={onClose} style={secondaryBtn(t)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" disabled={busy} style={primaryBtn(TEAL, busy)}>
                {busy ? "Adding…" : "Add shift"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}

function FieldLabel({ t, children }: { t: ThemeTokens; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>
      {children}
    </span>
  );
}

function Field({ label, t, children }: { label: string; t: ThemeTokens; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 7, flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
      <FieldLabel t={t}>{label}</FieldLabel>
      {children}
    </label>
  );
}

function PersonCard({
  name, initial, color, active, onClick, t,
}: {
  name: string;
  initial: string;
  color: string;
  active: boolean;
  onClick: () => void;
  t: ThemeTokens;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 10px",
        textAlign: "left",
        border: `1px solid ${active ? TEAL : t.sep}`,
        borderRadius: 4,
        background: active ? TEAL_TINT : t.bgElev,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          flexShrink: 0,
          borderRadius: 8,
          background: color,
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {initial}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: active ? 600 : 400,
            color: active ? "#14201E" : t.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span style={{ fontSize: 11, color: active ? "#14201E" : t.text2 }}>
          {active ? "Selected" : "Tap to pick"}
        </span>
      </span>
    </button>
  );
}

/** Duration from start→end as "Nh MMm", wrapping past midnight. */
function computeLength(start: string, end: string): string {
  const re = /^(\d{2}):(\d{2})$/;
  const s = re.exec(start);
  const e = re.exec(end);
  if (!s || !e) return "—";
  let mins = (Number(e[1]) * 60 + Number(e[2])) - (Number(s[1]) * 60 + Number(s[2]));
  if (mins <= 0) mins += 24 * 60;
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return `${h}h ${String(mm).padStart(2, "0")}m`;
}

/** Add `days` to an ISO date (local, DST-safe) and reformat as YYYY-MM-DD. */
function addDaysISO(iso: string, days: number): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(y || 1970, (mo || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function fmtLongDate(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  if (!y || !mo || !d) return "";
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function fmtShort(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  if (!y || !mo || !d) return "";
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function inputStyle(t: ThemeTokens): React.CSSProperties {
  return {
    width: "100%",
    height: 40,
    boxSizing: "border-box",
    padding: "0 12px",
    background: t.bgElev,
    border: `1px solid ${t.sep}`,
    borderRadius: 4,
    color: t.text,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    colorScheme: t.bg === "#000" ? "dark" : "light",
  };
}

function selectStyle(t: ThemeTokens): React.CSSProperties {
  // Custom chevron inset 14px from the right edge — gives the option text
  // breathing room and lets us style consistently across OS chrome.
  const stroke = "%23" + (t.bg === "#000" ? "8E8E93" : "6E6E73");
  const chevron =
    `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>")`;
  return {
    ...inputStyle(t),
    paddingRight: 36,
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    backgroundImage: chevron,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 14px center",
    backgroundSize: "12px 12px",
  };
}

function primaryBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    height: 38,
    padding: "0 14px",
    border: 0,
    borderRadius: 4,
    background: color,
    color: "#fff",
    fontFamily: BRAND_FONT,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function secondaryBtn(t: ThemeTokens): React.CSSProperties {
  return {
    height: 38,
    padding: "0 14px",
    border: `1px solid ${t.sep}`,
    borderRadius: 4,
    background: t.bgElev,
    color: t.text,
    fontFamily: BRAND_FONT,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };
}
