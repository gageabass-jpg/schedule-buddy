import { useEffect, useState } from "react";
import { personColor, type Palette, type ThemeTokens } from "../theme";
import type { HouseholdMeta } from "../state";
import type { HouseholdState } from "../state";
import type { DependentBlock } from "../state";
import type { ThemePref } from "../App";
import { setHouseholdName, setEmployer } from "../lib/writeHouseholdMeta";
import { setPaydaySchedule } from "../lib/writePaydays";
import type { PaydaySchedule } from "../state";
import { createInviteCode } from "../lib/createInviteCode";
import { removeHouseholdMember } from "../lib/removeHouseholdMember";
import { doSignOut } from "../hooks/useAuth";
import { auth } from "../firebase";
import { PhotoAv } from "./PhotoAv";
import { WallDisplaySection } from "./WallDisplaySection";
import { ShareLinkSection } from "./ShareLinkSection";
import { WallPhotosSection } from "./WallPhotosSection";
import { OccasionsSection } from "./OccasionsSection";
import { BrandMark, BRAND_TEAL, BRAND_FONT } from "./BrandMark";
import { Button01 } from "@/components/ui/nextjsshop-button";
import { useModalMotion } from "../lib/modalMotion";
import { RedTrash } from "./RedTrash";
import { EmployerField } from "./EmployerField";
import { subscribeCommuteConfig, setCommuteHome, setCommuteWork, setCommuteCushion, DEFAULT_CUSHION, type CommuteConfig, type CommutePlace } from "../lib/commute";

/** Where the Piper Locke mark in the corner goes (opens in the browser). */
const PIPER_LOCKE_URL = "https://www.piperlocke.studio/";

// ── Brand tokens used only inside this console ──────────────────────────────
const TEAL_TINT = "#D8E7E4";
const CLAY = "#8A4B38";
const CLAY_TINT = "#EFDFDB";
const APP_VERSION = "0.1.0";

const API_KEYS_URL = "https://console.anthropic.com/settings/keys";

type NavKey = "general" | "people" | "wall" | "integrations";

const NAV: Array<{ key: NavKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "people", label: "People" },
  { key: "wall", label: "Wall display" },
  { key: "integrations", label: "Integrations" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  household: HouseholdMeta | null;
  state: HouseholdState | null;
  themePref: ThemePref;
  onSetThemePref: (pref: ThemePref) => void;
  /** Opens the Chat Manager panel (closes the console first). */
}

export function FamilyConsole({
  open, onClose, palette, t, dark, householdId, household, state,
  themePref, onSetThemePref,
}: Props) {
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Caregiver invite — the underlying logic generates a redeem code; the
  // prototype frames it as an email + Send invite, so we collect an email
  // (informational, TODO wire to an email delivery path) and, on send,
  // generate the code to hand off.
  const [caregiverEmail, setCaregiverEmail] = useState("");
  const [caregiverCode, setCaregiverCode] = useState<string | null>(null);
  const [caregiverCopied, setCaregiverCopied] = useState(false);
  const [caregiverBusy, setCaregiverBusy] = useState(false);

  // Who each person works for — a shift shows this as its "where" unless the
  // shift names its own location.
  const [employers, setEmployers] = useState<{ G: string; K: string; D: string }>({ G: "", K: "", D: "" });
  const [employerBusy, setEmployerBusy] = useState<"G" | "K" | "D" | null>(null);
  // An employer picked from the Google list, per person, until it's saved.
  // Saving it also sets where that person drives for traffic alerts.
  const [employerPicks, setEmployerPicks] = useState<Partial<Record<"G" | "K" | "D", CommutePlace>>>({});
  const [commute, setCommute] = useState<CommuteConfig>({});
  useEffect(() => {
    if (!open || !householdId) return;
    return subscribeCommuteConfig(householdId, setCommute);
  }, [open, householdId]);

  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [tab, setTab] = useState<NavKey>("general");

  const selfUid = auth.currentUser?.uid ?? null;

  useEffect(() => {
    if (!open) return;
    setDraftName(state?.householdName ?? defaultHouseholdName(household));
    setErr(null);
    setCopied(false);
    setCaregiverCode(null);
    setCaregiverCopied(false);
    setCaregiverEmail("");
    setEmployers({
      G: state?.employers?.G ?? "",
      K: state?.employers?.K ?? "",
      D: state?.employers?.D ?? "",
    });
  }, [open, state?.householdName, state?.employers, household]);

  // Fade and rise in, sink out, Escape to close (shared with every modal).
  const mm = useModalMotion(open, onClose);

  if (!open) return null;

  const hhName = state?.householdName ?? defaultHouseholdName(household);

  // A household is named once. Until a name is saved the field is open (the
  // console shows the default in it); saving asks first, then it's display
  // only.
  const onSaveName = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    if (state?.householdName?.trim()) return;
    const name = draftName.trim();
    if (!name) return;
    const ok = window.confirm(`Name your household "${name}"?\n\nOnce it's named, the name can't be changed.`);
    if (!ok) return;
    setErr(null);
    setBusy(true);
    try { await setHouseholdName(householdId, name); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setBusy(false); }
  };

  const onSaveEmployer = async (who: "G" | "K" | "D") => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setEmployerBusy(who);
    try {
      await setEmployer(householdId, who, employers[who]);
      const pick = employerPicks[who];
      if (who !== "D" && pick && pick.label === employers[who].trim()) {
        await setCommuteWork(householdId, who, pick);
      }
      setEmployerPicks((m) => ({ ...m, [who]: undefined }));
    }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setEmployerBusy(null); }
  };

  const onCopyCode = async () => {
    const code = household?.inviteCode;
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch { /* swallow */ }
  };

  const onSendCaregiver = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setCaregiverBusy(true);
    try {
      // Existing logic: mint a supporting-role invite code to hand off. The
      // email is captured for the operator's reference (TODO wire delivery).
      const code = await createInviteCode(householdId, "supporting");
      setCaregiverCode(code);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't generate a code.");
    } finally {
      setCaregiverBusy(false);
    }
  };

  const onLeaveHousehold = async () => {
    if (!householdId || !selfUid) return;
    const ok = window.confirm(
      "Leave this household?\n\nYou'll lose access to the schedule on this Mac. " +
      "Your login itself is not deleted.",
    );
    if (!ok) return;
    setErr(null);
    setBusy(true);
    try { await removeHouseholdMember(householdId, selfUid); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't leave."); }
    finally { setBusy(false); }
  };

  const members = household
    ? household.memberUids.map((uid) => ({
        uid,
        name: household.memberNames[uid] ?? "Member",
        role: household.roles[uid] ?? "partner",
      }))
    : [];

  const daisy = state?.dependents?.daisy;

  return (
    <div
      onClick={onClose}
      style={{
        ...mm.backdrop, position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Admin Console"
        onClick={(e) => e.stopPropagation()}
        style={{ ...mm.panel, 
          width: "min(1200px, 94vw)",
          height: "min(920px, 96vh)",
          background: t.bg,
          color: t.text,
          border: `1px solid ${t.sep}`,
          borderRadius: 10,
          boxShadow: dark ? "0 24px 64px rgba(0,0,0,0.6)" : "0 24px 64px rgba(20,32,30,0.28)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "inherit",
        }}
      >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: `1px solid ${t.sep}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <BrandMark size={24} color={BRAND_TEAL} />
          <span style={{ fontFamily: BRAND_FONT, fontSize: 20, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
            Admin Console
          </span>
          <span style={{ fontSize: 14, color: t.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hhName}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 34, height: 34,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: `1px solid ${t.sep}`, borderRadius: 4, background: t.bgElev,
            color: t.text, cursor: "pointer", flexShrink: 0, padding: 0,
          }}
        >
          <XIcon />
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Nav */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: `1px solid ${t.sep}`,
            padding: "16px 14px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV.map((item) => {
              const on = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  style={{
                    textAlign: "left",
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: 4,
                    border: 0,
                    background: on ? t.tealTint : "transparent",
                    color: on ? t.text : t.text2,
                    fontSize: 14,
                    fontWeight: on ? 600 : 500,
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, color: t.text3 }}>Changes save as you make them.</div>
            <Button01 href={PIPER_LOCKE_URL} label="Piper Locke website">
              <img src="assets/piper-locke.png" alt="" />
            </Button01>
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 22px",
            background: t.bgElev,
            minWidth: 0,
          }}
        >
          <div style={{ maxWidth: 1000 }}>
            {tab === "general" && (
              <GeneralTab
                t={t} dark={dark}
                hhName={hhName}
                nameLocked={!!state?.householdName?.trim()}
                draftName={draftName} setDraftName={setDraftName}
                busy={busy} onSaveName={onSaveName}
                commuteHome={commute.home ?? null}
                commuteCushion={commute.cushion ?? DEFAULT_CUSHION}
                inviteCode={household?.inviteCode ?? null}
                copied={copied} onCopyCode={onCopyCode}
                caregiverEmail={caregiverEmail} setCaregiverEmail={setCaregiverEmail}
                caregiverCode={caregiverCode} caregiverCopied={caregiverCopied}
                caregiverBusy={caregiverBusy}
                onSendCaregiver={onSendCaregiver}
                onCopyCaregiver={async () => {
                  if (!caregiverCode) return;
                  try { await navigator.clipboard.writeText(caregiverCode); setCaregiverCopied(true); setTimeout(() => setCaregiverCopied(false), 1400); }
                  catch { /* swallow */ }
                }}
                onNewCaregiver={() => { setCaregiverCode(null); setCaregiverCopied(false); }}
                themePref={themePref} onSetThemePref={onSetThemePref}
                onSignOut={() => { void doSignOut(); }}
                onLeaveHousehold={onLeaveHousehold}
                householdId={householdId} state={state} palette={palette}
              />
            )}

            {tab === "people" && (
              <PeopleTab
                t={t} dark={dark} palette={palette}
                members={members} selfUid={selfUid}
                removingUid={removingUid}
                onRemoveMember={async (uid, name) => {
                  if (!householdId) return;
                  const ok = window.confirm(
                    `Remove ${name} from this household?\n\n` +
                    `They'll lose access to the schedule, but their Firebase login itself ` +
                    `is not deleted. To fully wipe a test account, sign in as them on iOS ` +
                    `and use "Delete my account" in the Profile tab.`,
                  );
                  if (!ok) return;
                  setErr(null);
                  setRemovingUid(uid);
                  try { await removeHouseholdMember(householdId, uid); }
                  catch (e) { setErr(e instanceof Error ? e.message : "Couldn't remove."); }
                  finally { setRemovingUid(null); }
                }}
                daisy={daisy}
                state={state} householdId={householdId}
                employers={employers} setEmployers={setEmployers}
                savedEmployers={state?.employers ?? {}}
                employerBusy={employerBusy} onSaveEmployer={onSaveEmployer}
                employerPicks={employerPicks}
                onPickEmployer={(who, place) => setEmployerPicks((m) => ({ ...m, [who]: place }))}
                commuteWork={commute.work ?? {}}
              />
            )}

            {tab === "wall" && (
              <WallTab t={t} palette={palette} householdId={householdId} state={state} />
            )}

            {tab === "integrations" && (
              <IntegrationsTab t={t} palette={palette} householdId={householdId} state={state} />
            )}

            {err && <div style={{ fontSize: 12.5, color: t.clayText, marginTop: 16 }}>{err}</div>}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// GENERAL
// ════════════════════════════════════════════════════════════════════════════

function GeneralTab(p: {
  t: ThemeTokens; dark: boolean;
  hhName: string;
  /** A name has been saved; it can't be changed any more. */
  nameLocked: boolean;
  draftName: string; setDraftName: (v: string) => void;
  busy: boolean; onSaveName: () => void;
  commuteHome: CommutePlace | null;
  commuteCushion: { min: number; max: number };
  inviteCode: string | null;
  copied: boolean; onCopyCode: () => void;
  caregiverEmail: string; setCaregiverEmail: (v: string) => void;
  caregiverCode: string | null; caregiverCopied: boolean; caregiverBusy: boolean;
  onSendCaregiver: () => void; onCopyCaregiver: () => void; onNewCaregiver: () => void;
  themePref: ThemePref; onSetThemePref: (v: ThemePref) => void;
  onSignOut: () => void; onLeaveHousehold: () => void;
  householdId: string | null; state: HouseholdState | null; palette: Palette;
}) {
  const { t } = p;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: "100%" }}>
      {/* HOUSEHOLD — named once, then fixed. */}
      <Section t={t} label="Household">
        <FieldLabel t={t}>Name</FieldLabel>
        {p.nameLocked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 420 }}>
            <div
              style={{ ...inputStyle(t), display: "flex", alignItems: "center", gap: 8, background: t.bgElev2, color: t.text, cursor: "default" }}
              aria-readonly="true"
            >
              <LockIcon />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.hhName}</span>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, maxWidth: 420 }}>
            <input
              type="text"
              value={p.draftName}
              onChange={(e) => p.setDraftName(e.target.value)}
              placeholder="Your household's name"
              style={inputStyle(t)}
            />
            <button
              type="button"
              onClick={p.onSaveName}
              disabled={p.busy || !p.draftName.trim()}
              style={{ ...primaryBtn, opacity: p.busy || !p.draftName.trim() ? 0.5 : 1, cursor: p.busy || !p.draftName.trim() ? "not-allowed" : "pointer" }}
            >
              {p.busy ? "Saving…" : "Save"}
            </button>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: t.text3, marginTop: 6 }}>
          {p.nameLocked ? "Your household name cannot be edited." : "Once it's saved, the name can't be changed."}
        </div>
      </Section>

      {/* COMMUTE — home address, for "leave by" times and traffic alerts. */}
      <Section
        t={t}
        label="Commute"
        desc="Your home address, for leave-by times and heavy-traffic alerts before each shift. Only you and your partner can see it."
      >
        <CommuteHome t={t} householdId={p.householdId} home={p.commuteHome} />
        <div style={{ height: 14 }} />
        <CommuteCushion t={t} householdId={p.householdId} cushion={p.commuteCushion} />
      </Section>

      {/* INVITE CODE */}
      <Section t={t} label="Invite code" desc="Share with a new member to link their Mac or phone.">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={codeBox(t)}>{p.inviteCode ?? "——————"}</div>
          <button
            type="button"
            onClick={p.onCopyCode}
            disabled={!p.inviteCode}
            style={p.copied ? primaryBtnShort : secondaryBtn(t)}
          >
            {p.copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={p.onCopyCode} style={secondaryBtn(t)}>New code</button>
        </div>
      </Section>

      {/* INVITE A CAREGIVER */}
      <Section
        t={t}
        label="Invite a caregiver"
        desc="They land as a Supporting account — they only see Coverage Requests, not the full schedule."
      >
        {p.caregiverCode ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={codeBox(t)}>{p.caregiverCode}</div>
            <button type="button" onClick={p.onCopyCaregiver} style={p.caregiverCopied ? primaryBtnShort : secondaryBtn(t)}>
              {p.caregiverCopied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={p.onNewCaregiver} style={secondaryBtn(t)}>New</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <FieldLabel t={t}>Their email</FieldLabel>
              <input
                type="email"
                value={p.caregiverEmail}
                onChange={(e) => p.setCaregiverEmail(e.target.value)}
                placeholder="caregiver@example.com"
                style={inputStyle(t)}
              />
            </div>
            <button
              type="button"
              onClick={p.onSendCaregiver}
              disabled={p.caregiverBusy}
              style={{ ...primaryBtn, opacity: p.caregiverBusy ? 0.5 : 1, cursor: p.caregiverBusy ? "not-allowed" : "pointer" }}
            >
              {p.caregiverBusy ? "Working…" : "Send invite"}
            </button>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: t.text3, marginTop: 8, lineHeight: 1.5 }}>
          Sends a Supporting-role code to hand off. Email delivery is not wired yet — copy the code and share it.
        </div>
      </Section>

      {/* SHARING — read-only web + ICS/webcal link (moved here from Feeds). */}
      <Section t={t} label="Sharing" desc="A read-only web link and a calendar subscription (ICS / webcal). Shifts + event titles only. Revoke any time.">
        <ShareLinkSection householdId={p.householdId} state={p.state} t={t} palette={p.palette} />
      </Section>

      {/* DATA FORMAT — the move to the any-household model. */}

      {/* APPEARANCE */}
      <Section t={t} label="Appearance" desc="Match macOS or pick a fixed mode.">
        <Segmented
          t={t}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          value={p.themePref}
          onChange={(v) => p.onSetThemePref(v as ThemePref)}
        />
      </Section>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: "auto",
          paddingTop: 16,
          borderTop: `1px solid ${t.sep}`,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={p.onSignOut} style={secondaryBtn(t)}>Sign out</button>
          <button type="button" onClick={p.onLeaveHousehold} style={destructiveBtn(t)}>Leave household</button>
        </div>
        <div style={{ fontSize: 12, color: t.text3 }}>Nucleus Manager {APP_VERSION}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PEOPLE
// ════════════════════════════════════════════════════════════════════════════

type PersonKey = "G" | "K" | "D";

/** Which schedule a member is: Gage, Kaylene, Daisy, or someone else. */
function personKeyFor(name: string): PersonKey | null {
  const n = name.toLowerCase();
  if (n.includes("gage")) return "G";
  if (n.includes("kayl")) return "K";
  if (n.includes("daisy")) return "D";
  return null;
}

const EMPLOYER_PLACEHOLDER: Record<PersonKey, string> = {
  G: "Where they work",
  K: "Where they work",
  D: "School or college",
};

function PeopleTab(p: {
  t: ThemeTokens; dark: boolean; palette: Palette;
  members: Array<{ uid: string; name: string; role: "admin" | "partner" | "supporting" }>;
  selfUid: string | null;
  removingUid: string | null;
  onRemoveMember: (uid: string, name: string) => void;
  daisy: DependentBlock | undefined;
  state: HouseholdState | null;
  householdId: string | null;
  employers: { G: string; K: string; D: string };
  setEmployers: (v: { G: string; K: string; D: string }) => void;
  savedEmployers: { G?: string; K?: string; D?: string };
  employerBusy: PersonKey | null;
  onSaveEmployer: (who: PersonKey) => void;
  employerPicks: Partial<Record<PersonKey, CommutePlace>>;
  onPickEmployer: (who: PersonKey, place: CommutePlace) => void;
  commuteWork: Partial<Record<"G" | "K", CommutePlace | null>>;
}) {
  const { t, palette, dark } = p;

  // Which row's editor is open: a member uid, or "dependent:daisy".
  const [editing, setEditing] = useState<string | null>(null);
  const toggle = (id: string) => setEditing((cur) => (cur === id ? null : id));

  // The fields behind each person's Edit.
  const editor = (key: PersonKey | null, name: string, memberUid: string | null) => (
    <div
      style={{
        margin: "-2px 0 4px", padding: "14px 16px 16px", borderRadius: 4,
        border: `1px solid ${t.sep}`, borderTop: `2px solid ${key ? personColor(key, palette) : t.sep}`,
        background: t.bg, display: "flex", flexDirection: "column", gap: 14,
      }}
    >
      {key && (
        <div>
          <FieldLabel t={t}>Employer</FieldLabel>
          <div style={{ fontSize: 12, color: t.text2, marginBottom: 8, lineHeight: 1.45 }}>
            Search for the business, or type any name. Shown as a shift's location when the shift doesn't name one itself.
          </div>
          {(() => {
            const pick = p.employerPicks[key];
            const savedPlace = key !== "D" ? p.commuteWork[key] : null;
            // A new pick of the same name still needs saving: it sets the place.
            const newPlace = !!pick && pick.label === p.employers[key].trim() && pick.placeId !== savedPlace?.placeId;
            const dirty = (p.employers[key] ?? "") !== (p.savedEmployers[key] ?? "") || newPlace;
            const saving = p.employerBusy === key;
            return (
              <div style={{ display: "flex", gap: 8, maxWidth: 460 }}>
                <EmployerField
                  value={p.employers[key]}
                  onChange={(v) => p.setEmployers({ ...p.employers, [key]: v })}
                  onPick={(s) => p.onPickEmployer(key, { placeId: s.placeId, label: s.name })}
                  placeholder={EMPLOYER_PLACEHOLDER[key]}
                  ariaLabel={`${name}'s employer`}
                  t={t}
                  inputStyle={inputStyle(t)}
                />
                <button
                  type="button"
                  onClick={() => p.onSaveEmployer(key)}
                  disabled={saving || !dirty}
                  style={{ ...primaryBtn, opacity: saving || !dirty ? 0.5 : 1, cursor: saving || !dirty ? "not-allowed" : "pointer" }}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            );
          })()}
          {key !== "D" && (
            p.commuteWork[key]
              ? <div style={{ fontSize: 11.5, color: t.tealText, marginTop: 6 }}>Traffic alerts: drive to {p.commuteWork[key]!.label}.</div>
              : <div style={{ fontSize: 11.5, color: t.text3, marginTop: 6 }}>Pick the employer from the list to get traffic alerts before shifts.</div>
          )}
        </div>
      )}

      {(key === "G" || key === "K") && (
        <div>
          <FieldLabel t={t}>Payday</FieldLabel>
          <div style={{ fontSize: 12, color: t.text2, marginBottom: 8, lineHeight: 1.45 }}>
            Any one payday and how often it repeats. A $ chip marks each one on the calendar.
          </div>
          <PaydayRow who={key} label={name} color={personColor(key, palette)} schedule={p.state?.paydays?.[key] ?? null} householdId={p.householdId} t={t} />
        </div>
      )}

      {!key && !memberUid && (
        <div style={{ fontSize: 12.5, color: t.text3 }}>Nothing to edit for this person yet.</div>
      )}
    </div>
  );

  const editBtn = (id: string, name: string) => (
    <button
      type="button"
      aria-label={`Edit ${name}`}
      aria-expanded={editing === id}
      title={editing === id ? "Done" : "Edit"}
      onClick={() => toggle(id)}
      style={{ ...iconBtn(t), ...(editing === id ? { background: t.tealTint, borderColor: t.tealTint, color: t.tealText } : {}) }}
    >
      <PencilIcon />
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* MEMBERS */}
      <Section t={t} label={`Members (${p.members.length})`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {p.members.length === 0 && (
            <div style={{ fontSize: 12.5, color: t.text3 }}>No members yet.</div>
          )}
          {p.members.map((m) => {
            const key = personKeyFor(m.name);
            const isSelf = !!p.selfUid && m.uid === p.selfUid;
            const isBusy = p.removingUid === m.uid;
            const summary = m.role === "admin" ? "Full schedule · overrides"
              : m.role === "supporting" ? "Coverage requests only"
              : "Full schedule";
            return (
              <div key={m.uid} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <div style={{ ...rowCard(t), opacity: isBusy ? 0.5 : 1 }}>
                  {key ? <PhotoAv who={key} size={34} palette={palette} dark={dark} /> :
                   <InitialSquare letter={m.name[0]?.toUpperCase() ?? "?"} color={palette.BOTH} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.name}{isSelf ? <span style={{ color: t.text3, fontWeight: 500, marginLeft: 6 }}>(you)</span> : null}
                    </div>
                    <div style={{ fontSize: 12, color: t.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {summary}
                    </div>
                  </div>
                  <RoleChip t={t} role={m.role} />
                  {editBtn(m.uid, m.name)}
                  {isSelf ? (
                    // You can't remove yourself: the trash is there, greyed out.
                    <button
                      type="button"
                      aria-label="You can't remove yourself"
                      title="You can't remove yourself"
                      disabled
                      style={{ ...iconBtn(t), cursor: "default" }}
                    >
                      <RedTrash disabledColor={t.text3} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove ${m.name}`}
                      title="Remove"
                      disabled={isBusy}
                      onClick={() => p.onRemoveMember(m.uid, m.name)}
                      style={{ ...iconBtn(t), color: t.clayText }}
                    >
                      <RedTrash />
                    </button>
                  )}
                </div>
                {editing === m.uid && editor(key, m.name, m.uid)}
              </div>
            );
          })}
        </div>
      </Section>

      {/* DEPENDENTS */}
      <Section t={t} label="Dependents" desc="Kids and others whose schedule lives in the household.">
        {p.daisy ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <div style={rowCard(t)}>
              <PhotoAv who="D" size={34} palette={palette} dark={dark} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{p.daisy.name || "Caregiver"}</div>
                <div style={{ fontSize: 12, color: t.text2 }}>
                  School schedule · {p.daisy.shifts?.length ?? 0} class day{(p.daisy.shifts?.length ?? 0) === 1 ? "" : "s"} on file
                </div>
              </div>
              <RoleChip t={t} role="dependent" />
              {editBtn("dependent:daisy", p.daisy.name || "Caregiver")}
            </div>
            {editing === "dependent:daisy" && editor("D", p.daisy.name || "Caregiver", null)}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: t.text3 }}>
            No dependents yet. Import Daisy's class schedule from the sidebar to add her.
          </div>
        )}
      </Section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WALL DISPLAY
// ════════════════════════════════════════════════════════════════════════════

function WallTab(p: { t: ThemeTokens; palette: Palette; householdId: string | null; state: HouseholdState | null }) {
  const { t } = p;
  const [sub, setSub] = useState<"display" | "photos" | "occasions">("display");
  return (
    <div>
      <SubTabBar
        t={t}
        value={sub}
        onChange={(v) => setSub(v as typeof sub)}
        options={[
          { value: "display", label: "Display" },
          { value: "photos", label: "Photos" },
          { value: "occasions", label: "Occasions" },
        ]}
      />
      {sub === "display" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <Section t={t} label="Wall display" desc="The wall shows today and tomorrow in large type, then the photos rotate in. The page auto-refreshes every 30s.">
            <WallDisplaySection householdId={p.householdId} t={t} palette={p.palette} />
          </Section>
        </div>
      )}
      {sub === "photos" && (
        <Section t={t} label="Photos" desc="Family photos that rotate in between dashboard views. Resized + compressed on upload.">
          <WallPhotosSection householdId={p.householdId} t={t} palette={p.palette} />
        </Section>
      )}
      {sub === "occasions" && (
        <Section t={t} label="Occasions" desc="Birthdays, anniversaries, and holidays — surfaced on the wall display's greeting line on the day-of.">
          <OccasionsSection householdId={p.householdId} state={p.state} t={t} palette={p.palette} />
        </Section>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// INTEGRATIONS
// ════════════════════════════════════════════════════════════════════════════

function IntegrationsTab(p: { t: ThemeTokens; palette: Palette; householdId: string | null; state: HouseholdState | null }) {
  const { t } = p;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Section t={t} label="AI provider API" desc="An API is required for nucleusAI to function. The key is encrypted locally (macOS Keychain).">
        <AiProviderCard t={t} />
      </Section>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, paddingTop: 16, borderTop: `1px solid ${t.sep}` }}>
        <a href={API_KEYS_URL} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: t.tealText, fontWeight: 600, textDecoration: "none" }}>
          Where do I get an API key?
        </a>
      </div>
    </div>
  );
}

function AiProviderCard({ t }: { t: ThemeTokens }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    window.sbm?.hasApiKey().then(setHasKey).catch(() => setHasKey(false));
  }, []);

  const onSave = async () => {
    if (!window.sbm) { setErr("This feature only works inside the Nucleus Manager app."); return; }
    if (!value.trim()) return;
    setErr(null); setBusy(true);
    try {
      const res = await window.sbm.setApiKey(value);
      if (!res.ok) { setErr(res.error || "Couldn't save the key."); return; }
      setHasKey(true); setValue(""); setEditing(false);
    } finally { setBusy(false); }
  };

  const onClear = async () => {
    if (!window.sbm) return;
    setBusy(true);
    try { await window.sbm.clearApiKey(); setHasKey(false); }
    finally { setBusy(false); }
  };

  if (hasKey && !editing) {
    return (
      <div style={{ ...rowCard(t), gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Anthropic API key</div>
          <div style={{ fontSize: 12, color: t.text2, fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" }}>sk-ant-••••••••••••</div>
        </div>
        <StatusChip t={t} on onLabel="CONNECTED" offLabel="OFF" />
        <button type="button" onClick={() => setEditing(true)} style={secondaryBtn(t)}>Replace</button>
        <button type="button" onClick={onClear} disabled={busy} style={destructiveBtn(t)}>Remove</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <StatusChip t={t} on={false} onLabel="CONNECTED" offLabel="OFF" />
        <span style={{ fontSize: 12.5, color: t.text2 }}>{hasKey === null ? "Checking…" : "No key set"}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-ant-…"
          spellCheck={false}
          style={{ ...inputStyle(t), fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" }}
        />
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !value.trim()}
          style={{ ...primaryBtn, opacity: busy || !value.trim() ? 0.5 : 1, cursor: busy || !value.trim() ? "not-allowed" : "pointer" }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {editing && <button type="button" onClick={() => { setEditing(false); setValue(""); }} style={secondaryBtn(t)}>Cancel</button>}
      </div>
      {err && <div style={{ fontSize: 12.5, color: t.clayText }}>{err}</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED PIECES
// ════════════════════════════════════════════════════════════════════════════

/** The home address, searched through Google like the employers. */
function CommuteHome({ t, householdId, home }: { t: ThemeTokens; householdId: string | null; home: CommutePlace | null }) {
  const [draft, setDraft] = useState(home?.label ?? "");
  const [pick, setPick] = useState<CommutePlace | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(home?.label ?? "");
  // Follow the saved address when it changes elsewhere (state adjusted during render).
  if ((home?.label ?? "") !== shown) { setShown(home?.label ?? ""); setDraft(home?.label ?? ""); setPick(null); }

  const save = async (next: CommutePlace | null) => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setBusy(true);
    try { await setCommuteHome(householdId, next); setPick(null); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setBusy(false); }
  };
  const canSave = !!pick && pick.label === draft && pick.placeId !== home?.placeId;

  return (
    <div>
      <FieldLabel t={t}>Home address</FieldLabel>
      <div style={{ display: "flex", gap: 8, maxWidth: 560 }}>
        <EmployerField
          value={draft}
          onChange={(v) => { setDraft(v); setPick(null); }}
          onPick={(s) => {
            const label = s.detail ? `${s.name}, ${s.detail}` : s.name;
            setDraft(label);
            setPick({ placeId: s.placeId, label });
          }}
          placeholder="Start typing your street address"
          ariaLabel="Home address"
          t={t}
          inputStyle={inputStyle(t)}
        />
        <button
          type="button"
          onClick={() => pick && save(pick)}
          disabled={busy || !canSave}
          style={{ ...primaryBtn, opacity: busy || !canSave ? 0.5 : 1, cursor: busy || !canSave ? "not-allowed" : "pointer" }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {home && (
          <button type="button" onClick={() => save(null)} disabled={busy} style={secondaryBtn(t)}>Clear</button>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: home ? t.tealText : t.text3, marginTop: 6 }}>
        {home ? "Traffic alerts are on for anyone whose employer is picked from the list." : "Pick your address from the list, then save."}
      </div>
      {err && <div style={{ fontSize: 12, color: t.clayText, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

/** How long before a shift the household leaves — the coffee-stop cushion. */
function CommuteCushion({ t, householdId, cushion }: { t: ThemeTokens; householdId: string | null; cushion: { min: number; max: number } }) {
  const [min, setMin] = useState(String(cushion.min));
  const [max, setMax] = useState(String(cushion.max));
  const [saved, setSaved] = useState(`${cushion.min}-${cushion.max}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Follow the saved value when it changes elsewhere (state adjusted during render).
  if (`${cushion.min}-${cushion.max}` !== saved) {
    setSaved(`${cushion.min}-${cushion.max}`); setMin(String(cushion.min)); setMax(String(cushion.max));
  }
  const lo = Number(min), hi = Number(max);
  const valid = Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && hi <= 180 && lo <= hi;
  const dirty = lo !== cushion.min || hi !== cushion.max;
  const onSave = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setBusy(true);
    try { await setCommuteCushion(householdId, { min: lo, max: hi }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setBusy(false); }
  };
  const num: React.CSSProperties = { ...inputStyle(t), width: 72, textAlign: "center" };
  return (
    <div>
      <FieldLabel t={t}>When you leave</FieldLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: t.text }}>
        <span>We leave</span>
        <input type="number" min={0} max={180} value={min} onChange={(e) => setMin(e.target.value)} aria-label="Least minutes before a shift" style={num} />
        <span>to</span>
        <input type="number" min={0} max={180} value={max} onChange={(e) => setMax(e.target.value)} aria-label="Most minutes before a shift" style={num} />
        <span>minutes before a shift.</span>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !valid || !dirty}
          style={{ ...primaryBtn, opacity: busy || !valid || !dirty ? 0.5 : 1, cursor: busy || !valid || !dirty ? "not-allowed" : "pointer" }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: t.text3, marginTop: 6 }}>
        {valid ? "When traffic runs heavy, this window moves earlier and whoever's working gets a heads-up." : "Use whole minutes, 0–180, with the first no bigger than the second."}
      </div>
      {err && <div style={{ fontSize: 12, color: t.clayText, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function Section({ label, desc, t, action, children }: { label: string; desc?: string; t: ThemeTokens; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, minHeight: action ? 28 : undefined }}>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: t.text3 }}>
          {label}
        </div>
        {action}
      </div>
      {desc && <div style={{ fontSize: 12.5, color: t.text2, marginBottom: 10, lineHeight: 1.45 }}>{desc}</div>}
      {children}
    </div>
  );
}

function FieldLabel({ t, children }: { t: ThemeTokens; children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, marginBottom: 6 }}>{children}</div>;
}

function StatusChip({ t, on, onLabel, offLabel }: { t: ThemeTokens; on: boolean; onLabel: string; offLabel: string }) {
  return (
    <span
      style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 4,
        background: on ? t.tealTint : t.bgElev2, color: on ? t.tealText : t.text2, flexShrink: 0,
      }}
    >
      {on ? onLabel : offLabel}
    </span>
  );
}

function SubTabBar({ t, value, onChange, options }: {
  t: ThemeTokens; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div style={{ display: "flex", gap: 14, borderBottom: `1px solid ${t.sep}`, marginBottom: 16 }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              border: 0, background: "transparent", cursor: "pointer", fontFamily: "inherit",
              fontSize: 14, fontWeight: on ? 600 : 500, color: on ? t.text : t.text2,
              padding: "8px 0", marginBottom: -1,
              borderBottom: on ? `2px solid ${BRAND_TEAL}` : "2px solid transparent",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Segmented({ t, options, value, onChange }: {
  t: ThemeTokens; options: Array<{ value: string; label: string }>; value: string; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${t.sep}`, borderRadius: 4, overflow: "hidden" }}>
      {options.map((o, i) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              border: 0,
              borderLeft: i === 0 ? 0 : `1px solid ${t.sep}`,
              background: on ? t.tealTint : t.bgElev,
              color: on ? t.tealText : t.text2,
              fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              padding: "8px 18px", cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RoleChip({ t, role }: { t: ThemeTokens; role: "admin" | "partner" | "supporting" | "dependent" }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    admin: { bg: t.tealTint, fg: t.tealText, label: "ADMIN" },
    partner: { bg: t.clayTint, fg: t.clayText, label: "PARTNER" },
    supporting: { bg: t.bgElev2, fg: t.text2, label: "SUPPORTING" },
    dependent: { bg: t.bgElev2, fg: t.text2, label: "DEPENDENT" },
  };
  const c = map[role];
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 4, background: c.bg, color: c.fg, flexShrink: 0 }}>
      {c.label}
    </span>
  );
}

function InitialSquare({ letter, color }: { letter: string; color: string }) {
  return (
    <div
      style={{
        width: 34, height: 34, borderRadius: 6, background: `${color}22`, color,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 15, fontWeight: 700, flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}

// ── Icons (inline stroke SVG) ───────────────────────────────────────────────

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, opacity: 0.7 }}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
// ── Style helpers (reskin tokens) ───────────────────────────────────────────

function inputStyle(t: ThemeTokens): React.CSSProperties {
  return {
    width: "100%",
    height: 32,
    boxSizing: "border-box",
    padding: "0 11px",
    border: `1px solid ${t.sep}`,
    borderRadius: 4,
    background: t.bgElev,
    color: t.text,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    colorScheme: t.scheme === "dark" ? "dark" : "light",
  };
}

const primaryBtn: React.CSSProperties = {
  height: 32,
  padding: "0 16px",
  border: 0,
  borderRadius: 4,
  background: BRAND_TEAL,
  color: "#fff",
  fontFamily: BRAND_FONT,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

// Short primary — used for the transient "Copied" confirmation.
const primaryBtnShort: React.CSSProperties = {
  height: 32,
  padding: "0 16px",
  border: 0,
  borderRadius: 4,
  background: BRAND_TEAL,
  color: "#fff",
  fontFamily: BRAND_FONT,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

function secondaryBtn(t: ThemeTokens): React.CSSProperties {
  return {
    height: 32,
    padding: "0 16px",
    border: `1px solid ${t.sep}`,
    borderRadius: 4,
    background: t.bgElev,
    color: t.text,
    fontFamily: BRAND_FONT,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}

const destructiveBtn = (t: ThemeTokens): React.CSSProperties => ({
  height: 32,
  padding: "0 16px",
  border: `1px solid ${t.clayText}`,
  borderRadius: 4,
  background: "transparent",
  color: t.clayText,
  fontFamily: BRAND_FONT,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
});

function iconBtn(t: ThemeTokens): React.CSSProperties {
  return {
    width: 34,
    height: 34,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${t.sep}`,
    borderRadius: 4,
    background: t.bgElev,
    color: t.text2,
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
  };
}

function rowCard(t: ThemeTokens): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 11px",
    border: `1px solid ${t.sep}`,
    borderRadius: 4,
    background: t.bgElev,
  };
}

function codeBox(t: ThemeTokens): React.CSSProperties {
  return {
    flex: 1,
    padding: "10px 14px",
    borderRadius: 4,
    background: t.bgElev,
    border: `1px solid ${t.sep}`,
    fontFamily: "var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace)",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "0.18em",
    textAlign: "center" as const,
    userSelect: "all" as const,
    color: t.text,
  };
}

function defaultHouseholdName(_household: HouseholdMeta | null): string {
  return "Your household";
}

// ── PaydayRow (reskinned to the console tokens; logic unchanged) ─────────────

function PaydayRow({
  who, label, color, schedule, householdId, t,
}: {
  who: "G" | "K";
  label: string;
  color: string;
  schedule: PaydaySchedule | null;
  householdId: string | null;
  t: ThemeTokens;
}) {
  const [anchor, setAnchor] = useState<string>(schedule?.anchor ?? "");
  const [freq, setFreq] = useState<"weekly" | "biweekly">(schedule?.freq ?? "biweekly");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setAnchor(schedule?.anchor ?? "");
    setFreq(schedule?.freq ?? "biweekly");
  }, [schedule?.anchor, schedule?.freq]);

  const dirty =
    (schedule?.anchor ?? "") !== anchor ||
    (schedule?.freq ?? "biweekly") !== freq;

  const onSave = async () => {
    if (!householdId) return;
    setErr(null);
    setBusy(true);
    try { await setPaydaySchedule(householdId, who, { anchor, freq }); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setBusy(false); }
  };

  const onClear = async () => {
    if (!householdId) return;
    setBusy(true);
    try { await setPaydaySchedule(householdId, who, null); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't clear."); }
    finally { setBusy(false); }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr 150px auto",
        alignItems: "center",
        gap: 8,
        padding: "8px 11px",
        borderRadius: 4,
        border: `1px solid ${t.sep}`,
        background: t.bgElev,
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: color, padding: "3px 10px", borderRadius: 4, letterSpacing: "0.04em" }}>
        {label}
      </span>
      <input
        type="date"
        value={anchor}
        onChange={(e) => setAnchor(e.target.value)}
        style={{ ...inputStyle(t), padding: "8px 10px", fontSize: 13 }}
        title="Any one payday — usually the next upcoming one"
      />
      <select
        value={freq}
        onChange={(e) => setFreq(e.target.value as "weekly" | "biweekly")}
        style={{ ...inputStyle(t), padding: "8px 10px", fontSize: 13, cursor: "pointer" }}
      >
        <option value="biweekly">Every 2 weeks</option>
        <option value="weekly">Every week</option>
      </select>
      <div style={{ display: "flex", gap: 6 }}>
        {schedule && !dirty ? (
          <button type="button" onClick={onClear} disabled={busy} title="Remove this person's payday schedule" style={secondaryBtn(t)}>
            Clear
          </button>
        ) : (
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !dirty || !anchor || !householdId}
            style={{ ...primaryBtn, background: color, opacity: (busy || !dirty || !anchor) ? 0.5 : 1, cursor: (busy || !dirty || !anchor) ? "not-allowed" : "pointer" }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {err && <div style={{ gridColumn: "1 / -1", fontSize: 12, color: t.clayText }}>{err}</div>}
    </div>
  );
}
