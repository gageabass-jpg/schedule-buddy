// Setting up a new household on the Mac — the same questions as the phone's
// setup wizard, answered before the app opens, and the same result: a
// household on the any-household model holding exactly what was entered
// (shared/onboarding.ts). The partner and caregiver get invite codes at the end.

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { themeTokens, type ThemeTokens } from "../theme";
import { BrandMark } from "./BrandMark";
import { Stepper } from "@/components/ui/stepper";
import { modelStore, newPersonId } from "../lib/modelStore";
import { searchPlaces, type PlaceSuggestion } from "../lib/placesAutocomplete";
import {
  buildHousehold, checkAnswers, createHousehold, randomInviteCode, SHIFT_PRESETS,
  type AdultAnswer, type SetupAnswers,
} from "../../../shared/onboarding";
import { compactTime, type ShiftType } from "../state";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface AdultDraft {
  name: string; employer: string; payFreq: "" | "weekly" | "biweekly"; payAnchor: string;
  changing: boolean; days: Array<string | null>;
  alt: boolean; altSat: string; altSatShift: string | null; altSunShift: string | null;
}
const emptyAdult = (name = ""): AdultDraft => ({
  name, employer: "", payFreq: "", payAnchor: "", changing: false, days: [null, null, null, null, null, null, null],
  alt: false, altSat: "", altSatShift: null, altSunShift: null,
});

type Step = "household" | "you" | "people" | "shifts" | "myWeek" | "partner" | "home" | "review";

export function SetupWizard({ dark = true, onCancel, onDone }: {
  dark?: boolean;
  onCancel: () => void;
  /** Leave the wizard (the household exists by then). */
  onDone: () => void;
}) {
  const t = themeTokens(dark);
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  const first = (auth.currentUser?.displayName ?? "").trim().split(/\s+/)[0] ?? "";

  const [step, setStep] = useState(0);
  const [householdName, setHouseholdName] = useState("");
  const [timeZone, setTimeZone] = useState(detectedTz);
  const [me, setMe] = useState<AdultDraft>(emptyAdult(first));
  const [hasPartner, setHasPartner] = useState(false);
  const [partner, setPartner] = useState<AdultDraft>(emptyAdult());
  const [hasCaregiver, setHasCaregiver] = useState(false);
  const [caregiverName, setCaregiverName] = useState("");
  const [kids, setKids] = useState<string[]>([]);
  const [kidDraft, setKidDraft] = useState("");
  const [presets, setPresets] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<ShiftType[]>([]);
  const [customDraft, setCustomDraft] = useState({ name: "", start: "", end: "" });
  const [home, setHome] = useState<{ placeId: string; label: string } | null>(null);
  const [homeQuery, setHomeQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const session = useRef(Math.random().toString(36).slice(2));
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [codes, setCodes] = useState<{ partner: string; caregiver?: string } | null>(null);

  const shiftTypes = useMemo<ShiftType[]>(
    () => [...SHIFT_PRESETS.filter((p) => presets.has(p.id)).map((p) => ({ ...p })), ...custom],
    [presets, custom],
  );
  const steps = useMemo<Step[]>(() => {
    const s: Step[] = ["household", "you", "people", "shifts"];
    if (shiftTypes.length) s.push("myWeek");
    if (hasPartner) s.push("partner");
    s.push("home", "review");
    return s;
  }, [shiftTypes.length, hasPartner]);
  const current = steps[Math.min(step, steps.length - 1)];
  const title = (s: Step) => ({
    household: "Household", you: "You", people: "People", shifts: "Shifts", myWeek: "Your week",
    partner: `${partner.name.trim() || "Partner"}'s work`, home: "Home", review: "Review",
  })[s];

  // Address search, debounced.
  useEffect(() => {
    if (home || homeQuery.trim().length < 3) { setSuggestions([]); return; }
    const q = homeQuery.trim();
    const timer = setTimeout(() => {
      searchPlaces(q, session.current).then(setSuggestions).catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [homeQuery, home]);

  const adultAnswer = (a: AdultDraft): AdultAnswer => ({
    name: a.name,
    employer: a.employer || undefined,
    payday: a.payFreq && a.payAnchor ? { anchor: a.payAnchor, freq: a.payFreq } : undefined,
    week: !a.changing && shiftTypes.length
      ? { days: a.days.slice(), ...(a.alt && a.altSat ? { altWeekend: { refSat: a.altSat, sat: a.altSatShift, sun: a.altSunShift } } : {}) }
      : undefined,
  });
  const answers = (): SetupAnswers => ({
    householdName, timeZone,
    me: adultAnswer(me),
    partner: hasPartner ? adultAnswer(partner) : undefined,
    caregiver: hasCaregiver ? { name: caregiverName } : undefined,
    kids,
    shiftTypes,
    integrations: home ? { commuteHome: home } : {},
  });

  const checkStep = (s: Step): string => {
    const need = (v: string, msg: string) => (v.trim() ? "" : msg);
    const saturday = (a: AdultDraft) => {
      if (a.changing || !a.alt) return "";
      if (!a.altSat) return "Pick a Saturday for the every-other-weekend pattern.";
      const [y, m, d] = a.altSat.split("-").map(Number);
      return new Date(y, m - 1, d).getDay() === 6 ? "" : "That date isn't a Saturday.";
    };
    if (s === "household") return need(householdName, "Give your household a name.");
    if (s === "you") return need(me.name, "Add your name.") || (me.payFreq && !me.payAnchor ? "Pick a recent payday, or choose Not now." : "");
    if (s === "people") {
      return (hasPartner ? need(partner.name, "Add your partner's name.") : "")
        || (hasCaregiver ? need(caregiverName, "Add your caregiver's name.") : "")
        || (kidDraft.trim() ? `Click Add to include ${kidDraft.trim()}, or clear the box.` : "");
    }
    if (s === "shifts") return customDraft.name || customDraft.start || customDraft.end ? "Click Add shift to keep the custom shift, or clear it." : "";
    if (s === "myWeek") return saturday(me);
    if (s === "partner") return (partner.payFreq && !partner.payAnchor ? "Pick a recent payday, or choose Not now." : "") || saturday(partner);
    return "";
  };

  const onNext = async () => {
    const msg = checkStep(current);
    if (msg) { setErr(msg); return; }
    setErr("");
    if (current !== "review") { setStep(step + 1); return; }
    const a = answers();
    try { checkAnswers(a); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return; }
    const uid = auth.currentUser?.uid;
    if (!uid) { setErr("Sign in first."); return; }
    setCreating(true);
    try {
      const householdId = doc(collection(db, "households")).id;
      const built = buildHousehold(a, {
        householdId, uid,
        accountName: (auth.currentUser?.displayName || a.me.name).trim(),
        now: Date.now(),
        personId: () => newPersonId(),
        inviteCode: () => randomInviteCode(),
      });
      await createHousehold(modelStore, householdId, built, Date.now());
      setCodes(built.codes);
    } catch (e) {
      setErr(`Couldn't create the household: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };
  const onBack = () => {
    setErr("");
    if (step === 0) onCancel();
    else setStep(step - 1);
  };

  // ── Rendering ────────────────────────────────────────────────────────────

  const input: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", height: 36, padding: "0 10px", borderRadius: 8,
    border: `1px solid ${t.sep}`, background: t.bgElev2, color: t.text, fontSize: 13.5, fontFamily: "inherit",
  };
  const label: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: t.text2, margin: "0 0 5px" };
  const field = (lbl: string, el: React.ReactNode) => (
    <label style={{ display: "block", marginBottom: 12 }}><span style={label}>{lbl}</span>{el}</label>
  );
  const check = (lbl: string, on: boolean, set: (v: boolean) => void) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 32, fontSize: 13.5, cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--primary)" }} />
      {lbl}
    </label>
  );
  const typeOptions = (value: string | null, set: (v: string | null) => void, aria: string) => (
    <select value={value ?? ""} onChange={(e) => set(e.target.value || null)} aria-label={aria} style={input}>
      <option value="">Off</option>
      {shiftTypes.map((s) => <option key={s.id} value={s.id}>{s.name} · {compactTime(s.start)}–{compactTime(s.end)}</option>)}
    </select>
  );
  const payday = (a: AdultDraft, set: (a: AdultDraft) => void, you: boolean) => (
    <>
      {field(you ? "How often are you paid?" : "How often are they paid?",
        <select value={a.payFreq} onChange={(e) => set({ ...a, payFreq: e.target.value as AdultDraft["payFreq"] })} style={input}>
          <option value="">Not now</option>
          <option value="weekly">Every week</option>
          <option value="biweekly">Every two weeks</option>
        </select>)}
      {a.payFreq && field("A recent payday", <input type="date" value={a.payAnchor} onChange={(e) => set({ ...a, payAnchor: e.target.value })} style={input} />)}
    </>
  );
  const week = (a: AdultDraft, set: (a: AdultDraft) => void, whose: string, you: boolean) => (
    <>
      {check(`${whose} schedule changes every week`, a.changing, (v) => set({ ...a, changing: v }))}
      {a.changing ? (
        <p style={{ fontSize: 12.5, color: t.text2 }}>No usual week, then. Shifts get added as they're scheduled.</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: "6px 10px", alignItems: "center", margin: "6px 0 10px" }}>
            {DAYS.map((d, i) => (
              <div key={d} style={{ display: "contents" }}>
                <span style={{ fontSize: 13, color: t.text2 }}>{d}</span>
                {typeOptions(a.days[i], (v) => { const days = a.days.slice(); days[i] = v; set({ ...a, days }); }, d)}
              </div>
            ))}
          </div>
          {check("Every other weekend", a.alt, (v) => set({ ...a, alt: v }))}
          {a.alt && (
            <>
              <p style={{ fontSize: 12.5, color: t.text2, margin: "2px 0 10px" }}>
                On working weekends these replace Saturday and Sunday above; the weekends between are off.
              </p>
              {field(you ? "A Saturday you work" : "A Saturday they work",
                <input type="date" value={a.altSat} onChange={(e) => set({ ...a, altSat: e.target.value })} style={input} />)}
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>{field("Saturday", typeOptions(a.altSatShift, (v) => set({ ...a, altSatShift: v }), "Saturday"))}</div>
                <div style={{ flex: 1 }}>{field("Sunday", typeOptions(a.altSunShift, (v) => set({ ...a, altSunShift: v }), "Sunday"))}</div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
  const secondary: React.CSSProperties = {
    height: 36, padding: "0 16px", borderRadius: 8, border: `1px solid ${t.sep}`, background: "transparent",
    color: t.text, fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  const primary: React.CSSProperties = {
    ...secondary, border: 0, background: "var(--primary)", color: "var(--primary-foreground)",
  };
  const listRow = (text: string, onRemove: () => void, action = "Remove") => (
    <li style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, padding: "4px 0" }}>
      <span style={{ flex: 1 }}>{text}</span>
      <button type="button" onClick={onRemove} style={{ ...secondary, height: 28, padding: "0 10px", fontSize: 12 }}>{action}</button>
    </li>
  );

  const at = (id: string | null) => { const s = shiftTypes.find((x) => x.id === id); return s ? compactTime(s.start) : "off"; };
  const weekText = (a: AdultDraft) => {
    if (a.changing) return "Changes every week";
    const days = DAYS.map((d, i) => (a.alt && (i === 0 || i === 6)) || !a.days[i] ? null : `${d} ${at(a.days[i])}`)
      .filter(Boolean).join(", ") || "No usual shifts";
    return a.alt ? `${days}; every other weekend Sat ${at(a.altSatShift)}, Sun ${at(a.altSunShift)}` : days;
  };

  let body: React.ReactNode = null;
  if (current === "household") body = (
    <>
      <h3 style={h3}>Your household</h3>
      <p style={help(t)}>What should Nucleus call it? Once it's saved, the name can't be changed.</p>
      {field("Household name", <input value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder="The Rivera household" maxLength={60} autoFocus style={input} />)}
      {field("Time zone", (
        <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} style={input}>
          {timeZones(detectedTz).map((z) => <option key={z}>{z}</option>)}
        </select>
      ))}
    </>
  );
  else if (current === "you") body = (
    <>
      <h3 style={h3}>About you</h3>
      {field("Your name", <input value={me.name} onChange={(e) => setMe({ ...me, name: e.target.value })} maxLength={60} style={input} />)}
      {field("Where you work (optional)", <input value={me.employer} onChange={(e) => setMe({ ...me, employer: e.target.value })} maxLength={120} style={input} />)}
      {payday(me, setMe, true)}
    </>
  );
  else if (current === "people") body = (
    <>
      <h3 style={h3}>Who else is in your household?</h3>
      {check("A partner", hasPartner, setHasPartner)}
      {hasPartner && field("Their name", <input value={partner.name} onChange={(e) => setPartner({ ...partner, name: e.target.value })} maxLength={60} style={input} />)}
      {check("A caregiver who helps with the kids", hasCaregiver, setHasCaregiver)}
      {hasCaregiver && field("Their name", <input value={caregiverName} onChange={(e) => setCaregiverName(e.target.value)} maxLength={60} style={input} />)}
      <span style={{ ...label, marginTop: 8 }}>Kids</span>
      {kids.length > 0 && <ul style={{ listStyle: "none", margin: "0 0 6px", padding: 0 }}>{kids.map((k, i) => <div key={`${k}-${i}`}>{listRow(k, () => setKids(kids.filter((_, j) => j !== i)))}</div>)}</ul>}
      <form style={{ display: "flex", gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (kidDraft.trim()) { setKids([...kids, kidDraft.trim()]); setKidDraft(""); } }}>
        <input value={kidDraft} onChange={(e) => setKidDraft(e.target.value)} placeholder="Child's name" aria-label="Child's name" maxLength={60} style={input} />
        <button type="submit" style={secondary}>Add</button>
      </form>
      <p style={help(t)}>Nucleus plans who has the kids when there are kids in the household.</p>
    </>
  );
  else if (current === "shifts") body = (
    <>
      <h3 style={h3}>Which shifts does anyone work?</h3>
      <p style={help(t)}>Pick the usual ones, and add any others. Skip this if nobody works shifts.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {SHIFT_PRESETS.map((p) => {
          const on = presets.has(p.id);
          return (
            <button key={p.id} type="button" aria-pressed={on}
              onClick={() => { const next = new Set(presets); if (on) next.delete(p.id); else next.add(p.id); setPresets(next); }}
              style={{ ...secondary, height: 32, borderRadius: 16, display: "inline-flex", alignItems: "center", gap: 7, fontWeight: on ? 600 : 500,
                borderColor: on ? "var(--primary)" : t.sep, background: on ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "transparent" }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", border: `1.6px solid ${on ? "var(--primary)" : "currentColor"}`, background: on ? "var(--primary)" : "transparent" }} />
              {p.name} · {compactTime(p.start)}–{compactTime(p.end)}
            </button>
          );
        })}
      </div>
      {custom.length > 0 && <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0 }}>{custom.map((c, i) => <div key={c.id}>{listRow(`${c.name} · ${compactTime(c.start)}–${compactTime(c.end)}`, () => {
        setCustom(custom.filter((_, j) => j !== i));
        const clear = (a: AdultDraft): AdultDraft => ({ ...a, days: a.days.map((d) => (d === c.id ? null : d)),
          altSatShift: a.altSatShift === c.id ? null : a.altSatShift, altSunShift: a.altSunShift === c.id ? null : a.altSunShift });
        setMe(clear(me)); setPartner(clear(partner));
      })}</div>)}</ul>}
      <span style={label}>Another shift</span>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={customDraft.name} onChange={(e) => setCustomDraft({ ...customDraft, name: e.target.value })} placeholder="Name, e.g. Weekend day" aria-label="Shift name" maxLength={40} style={{ ...input, flex: 2 }} />
        <input type="time" value={customDraft.start} onChange={(e) => setCustomDraft({ ...customDraft, start: e.target.value })} aria-label="Starts" style={{ ...input, flex: 1 }} />
        <input type="time" value={customDraft.end} onChange={(e) => setCustomDraft({ ...customDraft, end: e.target.value })} aria-label="Ends" style={{ ...input, flex: 1 }} />
        <button type="button" style={secondary} onClick={() => {
          const d = customDraft;
          if (!d.name.trim() || !d.start || !d.end) { setErr("Give the shift a name, a start and an end."); return; }
          if (d.start === d.end) { setErr("The shift starts and ends at the same time."); return; }
          setErr("");
          setCustom([...custom, { id: `custom_${Date.now().toString(36)}`, name: d.name.trim(), start: d.start, end: d.end, crossesMidnight: d.end <= d.start }]);
          setCustomDraft({ name: "", start: "", end: "" });
        }}>Add shift</button>
      </div>
    </>
  );
  else if (current === "myWeek") body = (
    <>
      <h3 style={h3}>Your usual week</h3>
      <p style={help(t)}>Pick a shift for each day you normally work.</p>
      {week(me, setMe, "My", true)}
    </>
  );
  else if (current === "partner") body = (
    <>
      <h3 style={h3}>{partner.name.trim()}'s work</h3>
      {field("Where they work (optional)", <input value={partner.employer} onChange={(e) => setPartner({ ...partner, employer: e.target.value })} maxLength={120} style={input} />)}
      {payday(partner, setPartner, false)}
      {shiftTypes.length > 0 && week(partner, setPartner, "Their", false)}
    </>
  );
  else if (current === "home") body = (
    <>
      <h3 style={h3}>Leave-by times</h3>
      <p style={help(t)}>With your home address, Nucleus works out when to leave for each shift and warns about heavy traffic. Optional — you can add it later.</p>
      {home ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{listRow(home.label, () => { setHome(null); setHomeQuery(""); }, "Change")}</ul>
      ) : (
        <>
          {field("Home address", <input value={homeQuery} onChange={(e) => setHomeQuery(e.target.value)} placeholder="Start typing your address" autoComplete="off" style={input} />)}
          {suggestions.length > 0 && (
            <ul style={{ listStyle: "none", margin: "-6px 0 12px", padding: 0, border: `1px solid ${t.sep}`, borderRadius: 8, overflow: "hidden" }}>
              {suggestions.map((s) => (
                <li key={s.placeId}>
                  <button type="button" onClick={() => { setHome({ placeId: s.placeId, label: s.detail ? `${s.name}, ${s.detail}` : s.name }); setSuggestions([]); }}
                    style={{ width: "100%", textAlign: "left", padding: "8px 10px", border: 0, borderBottom: `0.5px solid ${t.sep}`, background: t.bgElev, color: t.text, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
                    {s.name}<div style={{ fontSize: 11.5, color: t.text2 }}>{s.detail}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
  else if (current === "review") {
    const people = [me.name, hasPartner && partner.name, hasCaregiver && `${caregiverName} (caregiver)`, ...kids.map((k) => `${k} (child)`)]
      .filter(Boolean).join(", ");
    const row = (k: string, v: string) => (
      <div style={{ marginBottom: 10 }}><div style={label}>{k}</div><div style={{ fontSize: 13.5 }}>{v}</div></div>
    );
    body = (
      <>
        <h3 style={h3}>Look right?</h3>
        {row("Household", `${householdName.trim()} · ${timeZone}`)}
        {row("People", people)}
        {row("Shifts", shiftTypes.map((s) => s.name).join(", ") || "None")}
        {shiftTypes.length > 0 && row(`${me.name.trim()}'s week`, weekText(me))}
        {hasPartner && shiftTypes.length > 0 && row(`${partner.name.trim()}'s week`, weekText(partner))}
        {row("Home", home?.label ?? "Not set")}
      </>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", background: t.bg, color: t.text, padding: "40px 24px", boxSizing: "border-box", overflowY: "auto" }}>
      <div style={{ width: 720, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <BrandMark size={32} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Set up your household</div>
            <div style={{ fontSize: 12.5, color: t.text2 }}>A few questions so Nucleus knows who's who and when you work. You can change any of it later.</div>
          </div>
        </div>

        {codes ? (
          <div style={card(t)}>
            <h3 style={h3}>{householdName.trim()} is ready</h3>
            <p style={help(t)}>Share these so the others can join from their own phone or Mac.</p>
            <CodeRow t={t} label={hasPartner ? `${partner.name.trim()}'s code` : "Code for a partner"} code={codes.partner} />
            {codes.caregiver && <CodeRow t={t} label={`${caregiverName.trim()}'s code (caregiver)`} code={codes.caregiver} />}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" style={primary} onClick={onDone}>Open Nucleus</button>
            </div>
          </div>
        ) : (
          <>
            <Stepper
              className="mb-5"
              currentStep={Math.min(step, steps.length - 1)}
              steps={steps.map((s) => ({ id: s, title: title(s) }))}
            />
            <div style={card(t)}>
              {body}
              {err && <div role="alert" style={{ fontSize: 12.5, color: t.clayText, marginTop: 8 }}>{err}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
                <button type="button" style={secondary} onClick={onBack}>{step === 0 ? "Cancel" : "Back"}</button>
                <button type="button" style={{ ...primary, opacity: creating ? 0.6 : 1 }} disabled={creating} onClick={() => { void onNext(); }}>
                  {current === "review" ? (creating ? "Creating…" : "Create household") : "Continue"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const h3: React.CSSProperties = { fontSize: 16, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" };
const help = (t: ThemeTokens): React.CSSProperties => ({ fontSize: 12.5, color: t.text2, margin: "0 0 14px", lineHeight: 1.45 });
const card = (t: ThemeTokens): React.CSSProperties => ({ background: t.bgElev, border: `1px solid ${t.sep}`, borderRadius: 12, padding: 20 });

function timeZones(detected: string): string[] {
  let zones: string[] = [];
  try { zones = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { /* older engines */ }
  if (!zones.length) zones = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
  return zones.includes(detected) ? zones : [detected, ...zones];
}

function CodeRow({ t, label, code }: { t: ThemeTokens; label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
      <div style={{ flex: 1, fontSize: 12.5, color: t.text2 }}>{label}</div>
      <div style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 20, fontWeight: 700, letterSpacing: "0.18em" }}>{code}</div>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* ignore */ } }}
        style={{ height: 30, padding: "0 12px", borderRadius: 8, border: `1px solid ${t.sep}`, background: "transparent", color: t.text, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
