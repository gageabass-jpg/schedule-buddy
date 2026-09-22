import { useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState, PersonWeeklyTemplate, TemplateSlot } from "../state";
import { compactTime, isCustomType } from "../state";
import { saveWeeklyTemplates, type TemplatePerson, type WeeklyTemplates } from "../lib/writeTemplate";
import { DAYS_LONG } from "../data";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
}

type DayMode = "off" | "preset" | "custom";
interface DraftDay { mode: DayMode; presetId: string; start: string; end: string; }
interface PersonDraft {
  days: DraftDay[];            // 7, Sun..Sat
  startEnabled: boolean; startDate: string;
  endEnabled: boolean; endDate: string;
}

const PEOPLE: TemplatePerson[] = ["G", "K", "daisy"];

function emptyDay(defaultPreset: string): DraftDay {
  return { mode: "off", presetId: defaultPreset, start: "09:00", end: "17:00" };
}

/** Read a person's stored template (with Gage's legacy fallback) into a draft. */
function loadDraft(state: HouseholdState | null, who: TemplatePerson, defaultPreset: string): PersonDraft {
  let tmpl: PersonWeeklyTemplate | undefined = state?.weeklyTemplates?.[who];
  if (!tmpl && who === "G" && state?.template) {
    tmpl = { days: state.template, endDate: state.templateEndDate };
  }
  const days: DraftDay[] = Array.from({ length: 7 }, (_, i) => {
    const slot = tmpl?.days?.[i];
    if (slot == null) return emptyDay(defaultPreset);
    if (typeof slot === "string") return { mode: "preset", presetId: slot, start: "09:00", end: "17:00" };
    return { mode: "custom", presetId: defaultPreset, start: slot.start, end: slot.end };
  });
  return {
    days,
    startEnabled: !!tmpl?.startDate, startDate: tmpl?.startDate ?? "",
    endEnabled: !!tmpl?.endDate, endDate: tmpl?.endDate ?? "",
  };
}

/** Draft → stored slot; a preset with no id or an all-off day collapses to null. */
function dayToSlot(d: DraftDay): TemplateSlot {
  if (d.mode === "off") return null;
  if (d.mode === "custom") return { start: d.start, end: d.end };
  return d.presetId || null;
}

export function TemplateEditor({ open, onClose, palette, t, dark, householdId, state }: Props) {
  const presets = (state?.shiftTypes ?? []).filter((s) => !isCustomType(s.id));
  const defaultPreset = presets[0]?.id ?? "";

  const [person, setPerson] = useState<TemplatePerson>("G");
  const [drafts, setDrafts] = useState<Record<TemplatePerson, PersonDraft>>(() => ({
    G: loadDraft(state, "G", defaultPreset),
    K: loadDraft(state, "K", defaultPreset),
    daisy: loadDraft(state, "daisy", defaultPreset),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-seed each open, keyed on the stored templates so external edits show.
  const openKey = `${open}-${JSON.stringify(state?.weeklyTemplates ?? null)}-${JSON.stringify(state?.template ?? null)}`;
  const [lastKey, setLastKey] = useState(openKey);
  if (openKey !== lastKey) {
    setLastKey(openKey);
    setDrafts({
      G: loadDraft(state, "G", defaultPreset),
      K: loadDraft(state, "K", defaultPreset),
      daisy: loadDraft(state, "daisy", defaultPreset),
    });
    setPerson("G");
    setErr(null);
  }

  if (!open) return null;

  const names: Record<TemplatePerson, string> = {
    G: state?.selfName || "Gage",
    K: state?.partner?.name || "Kaylene",
    daisy: state?.dependents?.daisy?.name || "Daisy",
  };
  const draft = drafts[person];
  const setDraft = (patch: Partial<PersonDraft>) =>
    setDrafts((d) => ({ ...d, [person]: { ...d[person], ...patch } }));
  const setDay = (dow: number, patch: Partial<DraftDay>) =>
    setDrafts((d) => {
      const days = [...d[person].days];
      days[dow] = { ...days[dow], ...patch };
      return { ...d, [person]: { ...d[person], days } };
    });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!householdId) { setErr("No household linked."); return; }
    // Validate any enabled dates + custom rows across all people.
    for (const p of PEOPLE) {
      const d = drafts[p];
      if (d.startEnabled && !d.startDate) { setErr(`${names[p]}: pick a start date or uncheck it.`); setPerson(p); return; }
      if (d.endEnabled && !d.endDate) { setErr(`${names[p]}: pick an end date or uncheck it.`); setPerson(p); return; }
      if (d.startEnabled && d.endEnabled && d.startDate && d.endDate && d.endDate < d.startDate) {
        setErr(`${names[p]}: end date is before the start date.`); setPerson(p); return;
      }
      for (let i = 0; i < 7; i++) {
        const day = d.days[i];
        if (day.mode === "custom" && day.start === day.end) {
          setErr(`${names[p]}: ${DAYS_LONG[i]} custom start and end can't match.`); setPerson(p); return;
        }
        if (day.mode === "preset" && !day.presetId) {
          setErr(`${names[p]}: ${DAYS_LONG[i]} needs a shift picked, or set it Off.`); setPerson(p); return;
        }
      }
    }

    const templates: WeeklyTemplates = {};
    for (const p of PEOPLE) {
      const d = drafts[p];
      const days = d.days.map(dayToSlot);
      const hasContent = days.some((s) => s !== null) || d.startEnabled || d.endEnabled;
      if (!hasContent) continue;               // all-off, no dates → no template
      const tmpl: PersonWeeklyTemplate = { days };
      if (d.startEnabled && d.startDate) tmpl.startDate = d.startDate;
      if (d.endEnabled && d.endDate) tmpl.endDate = d.endDate;
      templates[p] = tmpl;
    }

    setErr(null);
    setBusy(true);
    try {
      await saveWeeklyTemplates(householdId, templates);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save the template.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }} />
      <div
        role="dialog" aria-modal="true" aria-label="Weekly template"
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: "min(560px, calc(100vw - 32px))", maxHeight: "calc(100vh - 64px)",
          background: t.bgElev, color: t.text, borderRadius: 16, padding: "20px 22px 16px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)", zIndex: 1101, fontFamily: "inherit",
          display: "flex", flexDirection: "column", gap: 12, overflow: "hidden",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Weekly template</div>
          <div style={{ fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.45 }}>
            Set <b style={{ color: t.text }}>{names[person]}</b>'s recurring shift for each day of the week. Pick <em>Off</em>, choose a saved preset, or enter a custom time.
          </div>
        </div>

        {/* Person tabs */}
        <div style={{ display: "flex", gap: 4, padding: 3, background: dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)", borderRadius: 10 }}>
          {PEOPLE.map((p) => (
            <button key={p} type="button" onClick={() => setPerson(p)}
              style={{
                flex: 1, padding: "7px 10px", border: 0, borderRadius: 7, cursor: "pointer", fontFamily: "inherit",
                fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em",
                background: person === p ? palette.G : "transparent",
                color: person === p ? "#fff" : t.text2,
              }}>
              {names[p]}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "hidden", flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "auto", padding: "2px 0" }}>
            {DAYS_LONG.map((dayName, dow) => {
              const day = draft.days[dow];
              return (
                <div key={dow} style={{ padding: "10px 12px", background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: t.text, letterSpacing: "-0.01em" }}>{dayName}</span>
                    <div style={{ display: "flex", gap: 2, padding: 2, background: dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)", borderRadius: 8 }}>
                      {(["off", "preset", "custom"] as DayMode[]).map((mode) => (
                        <button key={mode} type="button"
                          onClick={() => setDay(dow, { mode, ...(mode === "preset" && !day.presetId ? { presetId: defaultPreset } : {}) })}
                          style={{
                            padding: "4px 12px", border: 0, borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                            fontSize: 12, fontWeight: 600, letterSpacing: "-0.01em", textTransform: "capitalize",
                            background: day.mode === mode ? palette.G : "transparent",
                            color: day.mode === mode ? "#fff" : t.text2,
                          }}>
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                  {day.mode === "preset" && (
                    <select value={day.presetId} onChange={(e) => setDay(dow, { presetId: e.target.value })} style={selectStyle(t)}>
                      {presets.length === 0 && <option value="">No shift types yet</option>}
                      {presets.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} — {compactTime(s.start)} to {compactTime(s.end)}</option>
                      ))}
                    </select>
                  )}
                  {day.mode === "custom" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="time" value={day.start} onChange={(e) => setDay(dow, { start: e.target.value })} style={inputStyle(t)} />
                      <span style={{ color: t.text3 }}>to</span>
                      <input type="time" value={day.end} onChange={(e) => setDay(dow, { end: e.target.value })} style={inputStyle(t)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Per-person start / end dates */}
          <div style={{ padding: "10px 12px", background: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderRadius: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <DateRow label="Set a start date for this schedule" enabled={draft.startEnabled} date={draft.startDate}
              onToggle={(on) => setDraft({ startEnabled: on, ...(on ? {} : { startDate: "" }) })}
              onDate={(v) => setDraft({ startDate: v })} palette={palette} t={t} />
            <DateRow label="Set an end date for this schedule" hint="Stops after" enabled={draft.endEnabled} date={draft.endDate}
              onToggle={(on) => setDraft({ endEnabled: on, ...(on ? {} : { endDate: "" }) })}
              onDate={(v) => setDraft({ endDate: v })} palette={palette} t={t} />
            <div style={{ fontSize: 11, color: t.text2, lineHeight: 1.45 }}>
              Recurring shifts run only within the start and end dates you set. One-off shifts and overtime you've already added still show.
            </div>
          </div>

          {err && <div style={{ fontSize: 12, color: "#8A4B38" }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose} style={secondaryBtn(t)} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy} style={primaryBtn(palette.G, busy)}>
              {busy ? "Saving…" : "Save template"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function DateRow({ label, hint, enabled, date, onToggle, onDate, palette, t }: {
  label: string; hint?: string; enabled: boolean; date: string;
  onToggle: (on: boolean) => void; onDate: (v: string) => void; palette: Palette; t: ThemeTokens;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)}
          style={{ width: 15, height: 15, accentColor: palette.G, cursor: "pointer" }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>{label}</span>
      </label>
      {enabled && (
        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", alignItems: "center", gap: 10, paddingLeft: 24 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: t.text2, letterSpacing: "-0.01em" }}>{hint ?? "Starts on"}</span>
          <input type="date" value={date} onChange={(e) => onDate(e.target.value)} style={inputStyle(t)} />
        </div>
      )}
    </div>
  );
}

function inputStyle(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "7px 10px", background: t.bg === "#000" ? "#000" : t.bg,
    border: `0.5px solid ${t.sep}`, borderRadius: 7, color: t.text, fontSize: 13,
    fontFamily: "inherit", letterSpacing: "-0.01em", outline: "none", width: "100%",
    colorScheme: t.bg === "#000" ? "dark" : "light",
  };
}

function selectStyle(t: ThemeTokens): React.CSSProperties {
  const stroke = "%23" + (t.bg === "#000" ? "8E8E93" : "6E6E73");
  const chevron =
    `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='${stroke}' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>")`;
  return {
    ...inputStyle(t), appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
    paddingRight: 32, backgroundImage: chevron, backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px center", backgroundSize: "12px 12px",
  };
}

function primaryBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 14px", border: 0, borderRadius: 8, background: color, color: "#fff",
    fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1, fontFamily: "inherit", letterSpacing: "-0.01em",
  };
}

function secondaryBtn(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "8px 14px", border: `0.5px solid ${t.sep}`, borderRadius: 8, background: "transparent",
    color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.01em",
  };
}
