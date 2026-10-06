// Setting up a new household on the Mac — the same questions as the phone's
// setup wizard, answered before the app opens, and the same result: a
// household on the any-household model holding exactly what was entered
// (shared/onboarding.ts). The steps run down a timeline on the left; the
// questions sit on the right. The invite codes come at the end.

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { collection, doc } from "firebase/firestore";
import { ArrowRight } from "lucide-react";
import { auth, db } from "../firebase";
import { themeTokens, type ThemeTokens } from "../theme";
import { BrandMark } from "./BrandMark";
import { Button } from "@/components/ui/button";
import { Timeline, type TimelineItem } from "@/components/ui/timeline";
import { EmployerField } from "./EmployerField";
import { modelStore, newPersonId, type Describes } from "../lib/modelStore";
import { searchPlaces, type PlaceSuggestion } from "../lib/placesAutocomplete";
import {
  buildHousehold, checkAnswers, createHousehold, DESCRIBES, OTHER_KINDS, randomInviteCode,
  SHIFT_PRESETS, timeZoneChoices, timeZoneLabel,
  type OtherKind, type PlaceAnswer, type SetupAnswers, type WorkAnswer,
} from "../../../shared/onboarding";
import { compactTime, type ShiftType } from "../state";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The arrow Next slides in on hover, as New shift does. */
const NextArrow = () => <ArrowRight className="size-4" />;

interface WorkDraft {
  employer: string; workplace: PlaceAnswer | null; payFreq: "" | "weekly" | "biweekly"; payAnchor: string;
  changing: boolean; days: Array<string | null>;
  alt: boolean; altSat: string; altSatShift: string | null; altSunShift: string | null;
}
const emptyWork = (): WorkDraft => ({
  employer: "", workplace: null, payFreq: "", payAnchor: "", changing: false, days: [null, null, null, null, null, null, null],
  alt: false, altSat: "", altSatShift: null, altSunShift: null,
});

interface OtherDraft { key: string; kind: OtherKind; name: string; work: WorkDraft }

type Step = "household" | "you" | "people" | "shifts" | "myWeek" | `partner:${string}` | "home" | "review";

const placeLabel = (s: PlaceSuggestion) => (s.detail ? `${s.name}, ${s.detail}` : s.name);
const kindLabel = (k: OtherKind) => OTHER_KINDS.find((o) => o.value === k)?.label ?? k;

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
  const [meName, setMeName] = useState(first);
  const [describes, setDescribes] = useState<Describes | "">("");
  const [me, setMe] = useState<WorkDraft>(emptyWork());
  const [others, setOthers] = useState<OtherDraft[]>([]);
  const [draftKind, setDraftKind] = useState<OtherKind>("partner");
  const [draftName, setDraftName] = useState("");
  const [kids, setKids] = useState(0);
  const [presets, setPresets] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState<ShiftType[]>([]);
  const [customDraft, setCustomDraft] = useState({ name: "", start: "", end: "" });
  const [home, setHome] = useState<PlaceAnswer | null>(null);
  const [homeQuery, setHomeQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [session] = useState(() => Math.random().toString(36).slice(2));
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [codes, setCodes] = useState<{ partner: string; caregiver?: string } | null>(null);
  const zones = useMemo(() => timeZoneChoices(detectedTz), [detectedTz]);

  const shiftTypes = useMemo<ShiftType[]>(
    () => [...SHIFT_PRESETS.filter((p) => presets.has(p.id)).map((p) => ({ ...p })), ...custom],
    [presets, custom],
  );
  const partners = others.filter((o) => o.kind === "partner");
  const steps = useMemo<Step[]>(() => {
    const s: Step[] = ["household", "you", "people", "shifts"];
    if (shiftTypes.length) s.push("myWeek");
    for (const p of partners) s.push(`partner:${p.key}`);
    s.push("home", "review");
    return s;
  }, [shiftTypes.length, partners]);
  const at = Math.min(step, steps.length - 1);
  const current = steps[at];
  const partnerOf = (s: Step) => (s.startsWith("partner:") ? others.find((o) => `partner:${o.key}` === s) : undefined);
  const stepTitle = (s: Step): { title: string; description: string } => {
    const p = partnerOf(s);
    if (p) return { title: `${p.name.trim() || "Partner"}'s work`, description: "Their job and usual week" };
    return ({
      household: { title: "Household", description: "Its name and time zone" },
      you: { title: "You", description: "Your name, role and work" },
      people: { title: "People", description: "Who else lives there" },
      shifts: { title: "Shifts", description: "The shifts anyone works" },
      myWeek: { title: "Your week", description: "Your usual schedule" },
      home: { title: "Home", description: "For leave-by times" },
      review: { title: "Review", description: "Check it over and create" },
    } as Record<string, { title: string; description: string }>)[s];
  };

  // Home address search, debounced.
  useEffect(() => {
    if (home || homeQuery.trim().length < 3) { setSuggestions([]); return; }
    const q = homeQuery.trim();
    const timer = setTimeout(() => {
      searchPlaces(q, session).then(setSuggestions).catch(() => setSuggestions([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [homeQuery, home]);

  const workAnswer = (w: WorkDraft): WorkAnswer => ({
    employer: w.employer || undefined,
    workplace: w.workplace ?? undefined,
    payday: w.payFreq && w.payAnchor ? { anchor: w.payAnchor, freq: w.payFreq } : undefined,
    week: !w.changing && shiftTypes.length
      ? { days: w.days.slice(), ...(w.alt && w.altSat ? { altWeekend: { refSat: w.altSat, sat: w.altSatShift, sun: w.altSunShift } } : {}) }
      : undefined,
  });
  const answers = (): SetupAnswers => ({
    householdName, timeZone,
    me: { name: meName, describes: describes as Describes, ...workAnswer(me) },
    others: others.map((o) => ({ kind: o.kind, name: o.name, ...(o.kind === "partner" ? workAnswer(o.work) : {}) })),
    kids,
    shiftTypes,
    integrations: home ? { commuteHome: home } : {},
  });

  const checkStep = (s: Step): string => {
    const need = (v: string, msg: string) => (v.trim() ? "" : msg);
    const workCheck = (w: WorkDraft) => {
      if (w.payFreq && !w.payAnchor) return "Pick a recent payday, or choose Not now.";
      if (w.changing || !w.alt) return "";
      if (!w.altSat) return "Pick a Saturday for the every-other-weekend pattern.";
      const [y, m, d] = w.altSat.split("-").map(Number);
      return new Date(y, m - 1, d).getDay() === 6 ? "" : "That date isn't a Saturday.";
    };
    if (s === "household") return need(householdName, "Give your household a name.");
    if (s === "you") return need(meName, "Add your name.") || (describes ? "" : "Pick what best describes you.") || workCheck(me);
    if (s === "people") return draftName.trim() ? `Click Add to include ${draftName.trim()}, or clear the box.` : "";
    if (s === "shifts") return customDraft.name || customDraft.start || customDraft.end ? "Click Add shift to keep the custom shift, or clear it." : "";
    if (s === "myWeek") return workCheck({ ...me, payFreq: "" });
    const p = partnerOf(s);
    if (p) return workCheck(p.work);
    return "";
  };

  const onNext = async () => {
    const msg = checkStep(current);
    if (msg) { setErr(msg); return; }
    setErr("");
    if (current !== "review") { setStep(at + 1); return; }
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
    if (at === 0) onCancel();
    else setStep(at - 1);
  };

  // ── Pieces ───────────────────────────────────────────────────────────────

  const input: CSSProperties = {
    width: "100%", boxSizing: "border-box", height: 44, padding: "0 14px", borderRadius: 10,
    border: `1px solid ${t.sep}`, background: t.bgElev2, color: t.text, fontSize: 15, fontFamily: "inherit",
  };
  const labelStyle: CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: t.text2, margin: "0 0 7px" };
  const field = (lbl: string, el: ReactNode) => (
    <label style={{ display: "block", marginBottom: 16 }}><span style={labelStyle}>{lbl}</span>{el}</label>
  );
  const check = (lbl: string, on: boolean, set: (v: boolean) => void) => (
    <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, fontSize: 15, cursor: "pointer" }}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--primary)" }} />
      {lbl}
    </label>
  );
  const typeOptions = (value: string | null, set: (v: string | null) => void, aria: string) => (
    <select value={value ?? ""} onChange={(e) => set(e.target.value || null)} aria-label={aria} style={input}>
      <option value="">Off</option>
      {shiftTypes.map((s) => <option key={s.id} value={s.id}>{s.name} · {compactTime(s.start)}–{compactTime(s.end)}</option>)}
    </select>
  );
  const secondary: CSSProperties = {
    height: 44, padding: "0 20px", borderRadius: 8, border: `1px solid ${t.sep}`, background: "transparent",
    color: t.text, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  };
  const small: CSSProperties = { ...secondary, height: 34, padding: "0 12px", fontSize: 13 };
  const listRow = (text: ReactNode, onRemove: () => void, action = "Remove") => (
    <li style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, padding: "6px 0" }}>
      <span style={{ flex: 1 }}>{text}</span>
      <button type="button" onClick={onRemove} style={small}>{action}</button>
    </li>
  );
  const help = (text: ReactNode) => <p style={{ fontSize: 14, color: t.text2, margin: "0 0 18px", lineHeight: 1.5 }}>{text}</p>;
  const heading = (text: string) => <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-0.02em" }}>{text}</h2>;

  const workFields = (w: WorkDraft, set: (w: WorkDraft) => void, you: boolean) => (
    <>
      <div style={{ marginBottom: 16 }}>
        <span style={labelStyle}>{you ? "Where you work (optional)" : "Where they work (optional)"}</span>
        <EmployerField
          value={w.employer}
          onChange={(v) => set({ ...w, employer: v, workplace: null })}
          onPick={(p) => set({ ...w, employer: p.name, workplace: { placeId: p.placeId, label: placeLabel(p) } })}
          placeholder="Start typing to search"
          ariaLabel={you ? "Where you work" : "Where they work"}
          t={t}
          inputStyle={input}
        />
        {w.workplace && <div style={{ fontSize: 12.5, color: t.text2, marginTop: 6 }}>{w.workplace.label} — used for leave-by times</div>}
      </div>
      {field(you ? "How often are you paid?" : "How often are they paid?",
        <select value={w.payFreq} onChange={(e) => set({ ...w, payFreq: e.target.value as WorkDraft["payFreq"] })} style={input}>
          <option value="">Not now</option>
          <option value="weekly">Every week</option>
          <option value="biweekly">Every two weeks</option>
        </select>)}
      {w.payFreq && field("A recent payday", <input type="date" value={w.payAnchor} onChange={(e) => set({ ...w, payAnchor: e.target.value })} style={input} />)}
    </>
  );
  const week = (w: WorkDraft, set: (w: WorkDraft) => void, whose: string, you: boolean) => (
    <>
      {check(`${whose} schedule changes every week`, w.changing, (v) => set({ ...w, changing: v }))}
      {w.changing ? (
        help("No usual week, then. Shifts get added as they're scheduled.")
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: "8px 12px", alignItems: "center", margin: "8px 0 14px" }}>
            {DAYS.map((d, i) => (
              <div key={d} style={{ display: "contents" }}>
                <span style={{ fontSize: 15, color: t.text2 }}>{d}</span>
                {typeOptions(w.days[i], (v) => { const days = w.days.slice(); days[i] = v; set({ ...w, days }); }, d)}
              </div>
            ))}
          </div>
          {check("Every other weekend", w.alt, (v) => set({ ...w, alt: v }))}
          {w.alt && (
            <>
              {help("On working weekends these replace Saturday and Sunday above; the weekends between are off.")}
              {field(you ? "A Saturday you work" : "A Saturday they work",
                <input type="date" value={w.altSat} onChange={(e) => set({ ...w, altSat: e.target.value })} style={input} />)}
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>{field("Saturday", typeOptions(w.altSatShift, (v) => set({ ...w, altSatShift: v }), "Saturday"))}</div>
                <div style={{ flex: 1 }}>{field("Sunday", typeOptions(w.altSunShift, (v) => set({ ...w, altSunShift: v }), "Sunday"))}</div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );

  const shiftAt = (id: string | null) => { const s = shiftTypes.find((x) => x.id === id); return s ? compactTime(s.start) : "off"; };
  const weekText = (w: WorkDraft) => {
    if (w.changing) return "Changes every week";
    const days = DAYS.map((d, i) => (w.alt && (i === 0 || i === 6)) || !w.days[i] ? null : `${d} ${shiftAt(w.days[i])}`)
      .filter(Boolean).join(", ") || "No usual shifts";
    return w.alt ? `${days}; every other weekend Sat ${shiftAt(w.altSatShift)}, Sun ${shiftAt(w.altSunShift)}` : days;
  };

  // ── Steps ────────────────────────────────────────────────────────────────

  let body: ReactNode = null;
  const partner = partnerOf(current);
  if (current === "household") body = (
    <>
      {heading("Your household")}
      {help("What should Nucleus call it? Once it's saved, the name can't be changed.")}
      {field("Household name", <input value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder="The Rivera household" maxLength={60} autoFocus style={input} />)}
      {field("Time zone", (
        <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} style={input}>
          {zones.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
        </select>
      ))}
    </>
  );
  else if (current === "you") body = (
    <>
      {heading("About you")}
      {field("Your name", <input value={meName} onChange={(e) => setMeName(e.target.value)} maxLength={60} style={input} />)}
      {field("What best describes you?", (
        <select value={describes} onChange={(e) => setDescribes(e.target.value as Describes)} style={input}>
          <option value="" disabled>Choose one</option>
          {DESCRIBES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      ))}
      {workFields(me, setMe, true)}
    </>
  );
  else if (current === "people") body = (
    <>
      {heading("Who else lives there?")}
      {help("Add everyone else in the household. Skip this if it's just you.")}
      {others.length > 0 && (
        <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0 }}>
          {others.map((o) => (
            <div key={o.key}>
              {listRow(<>{o.name} <span style={{ color: t.text2 }}>· {kindLabel(o.kind)}</span></>, () => setOthers(others.filter((x) => x.key !== o.key)))}
            </div>
          ))}
        </ul>
      )}
      <form
        style={{ display: "flex", gap: 10, marginBottom: 22 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!draftName.trim()) { setErr("Add their name."); return; }
          setErr("");
          setOthers([...others, { key: Math.random().toString(36).slice(2, 8), kind: draftKind, name: draftName.trim(), work: emptyWork() }]);
          setDraftName("");
        }}
      >
        <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as OtherKind)} aria-label="Who they are" style={{ ...input, width: 190, flex: "none" }}>
          {OTHER_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Their name" aria-label="Their name" maxLength={60} style={input} />
        <button type="submit" style={secondary}>Add</button>
      </form>
      <span style={labelStyle}>How many kids live there?</span>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="button" aria-label="One fewer" onClick={() => setKids(Math.max(0, kids - 1))} style={{ ...secondary, width: 44, padding: 0 }}>−</button>
        <span aria-live="polite" style={{ minWidth: 28, textAlign: "center", fontSize: 18, fontWeight: 600 }}>{kids}</span>
        <button type="button" aria-label="One more" onClick={() => setKids(Math.min(20, kids + 1))} style={{ ...secondary, width: 44, padding: 0 }}>+</button>
      </div>
      <div style={{ marginTop: 10 }}>{help("With kids in the household, Nucleus plans who has them while the adults work.")}</div>
    </>
  );
  else if (current === "shifts") body = (
    <>
      {heading("Which shifts does anyone work?")}
      {help("Pick the usual ones, and add any others. Skip this if nobody works shifts.")}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        {SHIFT_PRESETS.map((p) => {
          const on = presets.has(p.id);
          return (
            <button key={p.id} type="button" aria-pressed={on}
              onClick={() => { const next = new Set(presets); if (on) next.delete(p.id); else next.add(p.id); setPresets(next); }}
              style={{ ...secondary, height: 40, borderRadius: 20, display: "inline-flex", alignItems: "center", gap: 8, fontWeight: on ? 600 : 500,
                borderColor: on ? "var(--primary)" : t.sep, background: on ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "transparent" }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", border: `1.8px solid ${on ? "var(--primary)" : "currentColor"}`, background: on ? "var(--primary)" : "transparent" }} />
              {p.name} · {compactTime(p.start)}–{compactTime(p.end)}
            </button>
          );
        })}
      </div>
      {custom.length > 0 && <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0 }}>{custom.map((c, i) => <div key={c.id}>{listRow(`${c.name} · ${compactTime(c.start)}–${compactTime(c.end)}`, () => {
        setCustom(custom.filter((_, j) => j !== i));
        const clear = (w: WorkDraft): WorkDraft => ({ ...w, days: w.days.map((d) => (d === c.id ? null : d)),
          altSatShift: w.altSatShift === c.id ? null : w.altSatShift, altSunShift: w.altSunShift === c.id ? null : w.altSunShift });
        setMe(clear(me));
        setOthers(others.map((o) => ({ ...o, work: clear(o.work) })));
      })}</div>)}</ul>}
      <span style={labelStyle}>Another shift</span>
      <div style={{ display: "flex", gap: 10 }}>
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
      {heading("Your usual week")}
      {help("Pick a shift for each day you normally work.")}
      {week(me, setMe, "My", true)}
    </>
  );
  else if (partner) {
    const setWork = (w: WorkDraft) => setOthers(others.map((o) => (o.key === partner.key ? { ...o, work: w } : o)));
    body = (
      <>
        {heading(`${partner.name}'s work`)}
        {workFields(partner.work, setWork, false)}
        {shiftTypes.length > 0 && week(partner.work, setWork, "Their", false)}
      </>
    );
  }
  else if (current === "home") body = (
    <>
      {heading("Leave-by times")}
      {help("With your home address, Nucleus works out when to leave for each shift and warns about heavy traffic. Optional — you can add it later.")}
      {home ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{listRow(home.label, () => { setHome(null); setHomeQuery(""); }, "Change")}</ul>
      ) : (
        <>
          {field("Home address", <input value={homeQuery} onChange={(e) => setHomeQuery(e.target.value)} placeholder="Start typing your address" autoComplete="off" style={input} />)}
          {suggestions.length > 0 && (
            <ul style={{ listStyle: "none", margin: "-8px 0 16px", padding: 0, border: `1px solid ${t.sep}`, borderRadius: 10, overflow: "hidden" }}>
              {suggestions.map((s) => (
                <li key={s.placeId}>
                  <button type="button" onClick={() => { setHome({ placeId: s.placeId, label: placeLabel(s) }); setSuggestions([]); }}
                    style={{ width: "100%", textAlign: "left", padding: "10px 14px", border: 0, borderBottom: `0.5px solid ${t.sep}`, background: t.bgElev, color: t.text, cursor: "pointer", fontFamily: "inherit", fontSize: 14.5 }}>
                    {s.name}<div style={{ fontSize: 12.5, color: t.text2 }}>{s.detail}</div>
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
    const people = [
      `${meName.trim()} (${DESCRIBES.find((d) => d.value === describes)?.label.toLowerCase() ?? "you"})`,
      ...others.map((o) => `${o.name} (${kindLabel(o.kind).toLowerCase()})`),
    ].join(", ");
    const row = (k: string, v: string) => (
      <div style={{ marginBottom: 14 }}><div style={labelStyle}>{k}</div><div style={{ fontSize: 15 }}>{v}</div></div>
    );
    body = (
      <>
        {heading("Look right?")}
        {row("Household", `${householdName.trim()} · ${timeZoneLabel(timeZone)}`)}
        {row("People", people)}
        {row("Kids", kids === 0 ? "None" : String(kids))}
        {row("Shifts", shiftTypes.map((s) => s.name).join(", ") || "None")}
        {shiftTypes.length > 0 && row(`${meName.trim()}'s week`, weekText(me))}
        {shiftTypes.length > 0 && partners.map((p) => <div key={p.key}>{row(`${p.name}'s week`, weekText(p.work))}</div>)}
        {row("Home", home?.label ?? "Not set")}
      </>
    );
  }

  // The steps down the left: done ones show a check, the current one a clock,
  // the rest their number.
  const timeline: TimelineItem[] = steps.map((s, i) => ({
    id: s,
    ...stepTitle(s),
    status: i < at ? "completed" : i === at ? "active" : "pending",
    icon: i > at ? <span className="text-[11px] font-semibold tabular-nums">{i + 1}</span> : undefined,
  }));

  const background = dark
    ? "radial-gradient(1200px 700px at 12% -10%, rgba(15,110,100,0.38), transparent 60%), radial-gradient(900px 600px at 100% 110%, rgba(10,79,72,0.45), transparent 60%), #0F1715"
    : "radial-gradient(1200px 700px at 12% -10%, rgba(15,110,100,0.16), transparent 60%), radial-gradient(900px 600px at 100% 110%, rgba(86,183,169,0.22), transparent 60%), #F7F6F3";

  return (
    <div style={{ minHeight: "100vh", background, color: t.text, padding: "48px 32px", boxSizing: "border-box", overflowY: "auto" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 36 }}>
          <BrandMark size={40} />
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>Set up your household</div>
            <div style={{ fontSize: 15, color: t.text2, marginTop: 2 }}>A few questions so Nucleus knows who's who and when you work. You can change any of it later.</div>
          </div>
        </div>

        {codes ? (
          <div style={{ ...card(t), maxWidth: 640 }}>
            {heading(`${householdName.trim()} is ready`)}
            {help("Share these so the others can join from their own phone or Mac.")}
            <CodeRow t={t} label="Household code (partner, roommate or family)" code={codes.partner} />
            {codes.caregiver && <CodeRow t={t} label="Caregiver's code" code={codes.caregiver} />}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
              <NextButton onClick={onDone}>Open Nucleus</NextButton>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 40, alignItems: "start" }}>
            <nav aria-label="Setup steps" style={{ position: "sticky", top: 24 }}>
              <Timeline items={timeline} showTimestamps={false} className="[&_h3]:m-0 [&_h3]:text-[16px] [&_p]:m-0 [&_p]:text-[13.5px]" />
            </nav>
            <div style={card(t)}>
              {body}
              {err && <div role="alert" style={{ fontSize: 14, color: t.clayText, marginTop: 10 }}>{err}</div>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 26 }}>
                <button type="button" style={secondary} onClick={onBack}>{at === 0 ? "Cancel" : "Back"}</button>
                <NextButton disabled={creating} onClick={() => { void onNext(); }}>
                  {current === "review" ? (creating ? "Creating…" : "Create household") : "Next"}
                </NextButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The toolbar's New shift button, larger, saying Next — in the theme's Teal. */
function NextButton({ disabled, onClick, children }: {
  disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      variant="expandIcon"
      Icon={NextArrow}
      iconPlacement="right"
      className="h-11 rounded-md px-5 text-[15px] font-semibold leading-none cursor-pointer"
    >
      {children}
    </Button>
  );
}

const card = (t: ThemeTokens): CSSProperties => ({
  background: t.bgElev, border: `1px solid ${t.sep}`, borderRadius: 14, padding: 32,
  boxShadow: "0 12px 40px rgba(0,0,0,0.10)",
});

function CodeRow({ t, label, code }: { t: ThemeTokens; label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
      <div style={{ flex: 1, fontSize: 14, color: t.text2 }}>{label}</div>
      <div style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 24, fontWeight: 700, letterSpacing: "0.18em" }}>{code}</div>
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* ignore */ } }}
        style={{ height: 36, padding: "0 14px", borderRadius: 8, border: `1px solid ${t.sep}`, background: "transparent", color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
