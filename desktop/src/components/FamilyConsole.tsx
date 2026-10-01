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
import { migrateToModel, moveBackFromModel, watchDataFormat, type MigrationReport } from "../lib/migrateHousehold";
import { subscribeCommuteConfig, setCommuteHome, setCommuteWork, setCommuteCushion, DEFAULT_CUSHION, type CommuteConfig, type CommutePlace } from "../lib/commute";
import { useHouseholdLook } from "../lib/householdLook";

/** Where the Piper Locke mark in the corner goes (opens in the browser). */
const PIPER_LOCKE_URL = "https://www.piperlocke.studio/";

// ── Brand tokens used only inside this console ──────────────────────────────
const TEAL_TINT = "#D8E7E4";
const CLAY = "#8A4B38";
const CLAY_TINT = "#EFDFDB";
const APP_VERSION = "0.1.0";

const API_KEYS_URL = "https://console.anthropic.com/settings/keys";

type NavKey = "general" | "people" | "wall" | "integrations" | "notifications" | "billing";

const NAV: Array<{ key: NavKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "people", label: "People" },
  { key: "wall", label: "Wall display" },
  { key: "integrations", label: "Integrations" },
  { key: "notifications", label: "Notifications" },
  { key: "billing", label: "Billing" },
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
  onOpenChatManager: () => void;
}

export function FamilyConsole({
  open, onClose, palette, t, dark, householdId, household, state,
  themePref, onSetThemePref, onOpenChatManager,
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
              <WallTab t={t} palette={palette} householdId={householdId} state={state} onOpenChatManager={onOpenChatManager} />
            )}

            {tab === "integrations" && (
              <IntegrationsTab t={t} palette={palette} householdId={householdId} state={state} />
            )}

            {tab === "notifications" && <NotificationsTab t={t} />}

            {tab === "billing" && <BillingTab t={t} hhName={hhName} />}

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
      {p.householdId && <DataFormatSection t={t} householdId={p.householdId} />}

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

  // WHAT NUCLEUSAI MAY DO — per member. Not saved yet (TODO wire to the
  // household doc's aiPermission; see the ai-permission-gate patch).
  const [aiPerms, setAiPerms] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const m of p.members) init[m.uid] = m.role === "supporting" ? "read" : "draft";
    return init;
  });

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

      {memberUid && (
        <div>
          <FieldLabel t={t}>What nucleusAI may do</FieldLabel>
          <div style={{ fontSize: 12, color: t.text2, marginBottom: 8, lineHeight: 1.45 }}>
            The most {name} may let the assistant do on their behalf.
          </div>
          <select
            value={aiPerms[memberUid] ?? "draft"}
            onChange={(e) => setAiPerms((s) => ({ ...s, [memberUid]: e.target.value }))}
            aria-label={`What nucleusAI may do for ${name}`}
            style={{ ...inputStyle(t), width: 200, cursor: "pointer" }}
          >
            <option value="draft">Draft</option>
            <option value="read">Read only</option>
            <option value="off">Off</option>
          </select>
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 6 }}>Not saved yet — this setting is coming soon.</div>
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
              <button type="button" aria-label="Remove Daisy" title="Remove" onClick={() => { /* TODO wire dependent remove */ }} style={{ ...iconBtn(t), color: t.clayText }}>
                <RedTrash />
              </button>
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

function WallTab(p: { t: ThemeTokens; palette: Palette; householdId: string | null; state: HouseholdState | null; onOpenChatManager: () => void }) {
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
          <Section t={t} label="Chat Manager" desc="Post a message to the wall display's in-basket as Manager.">
            <button type="button" onClick={p.onOpenChatManager} style={secondaryBtn(t)}>Open Chat Manager</button>
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
  const [sub, setSub] = useState<"apps" | "feeds">("apps");
  return (
    <div>
      <SubTabBar
        t={t}
        value={sub}
        onChange={(v) => setSub(v as typeof sub)}
        options={[
          { value: "apps", label: "Apps" },
          { value: "feeds", label: "Feeds" },
        ]}
      />
      {sub === "apps" && <AppsSubTab t={t} />}
      {sub === "feeds" && <FeedsSubTab t={t} />}
    </div>
  );
}

function AppsSubTab({ t }: { t: ThemeTokens }) {
  // Connector cards — visual placeholders, no real OAuth (TODO wire).
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const connectors = [
    { key: "slack", name: "Slack", desc: "Posts open shifts to #bass-household", icon: <SlackIcon /> },
    { key: "apple", name: "Apple Calendar", desc: "Writes shifts to your household's calendar", icon: <CalendarIcon /> },
    { key: "google", name: "Google Calendar", desc: "Two-way, for anyone not on an iPhone", icon: <CalendarIcon /> },
  ];

  const [limit, setLimit] = useState("200");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* AI PROVIDER API */}
      <Section t={t} label="AI provider API" desc="An API is required for nucleusAI to function. The key is encrypted locally (macOS Keychain).">
        <AiProviderCard t={t} />
      </Section>

      {/* APPS */}
      <Section t={t} label="Apps">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {connectors.map((c) => {
            const on = !!connected[c.key];
            return (
              <div key={c.key} style={{ ...rowCard(t), gap: 12 }}>
                <div style={{ width: 34, height: 34, borderRadius: 4, border: `1px solid ${t.sep}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: t.text2, flexShrink: 0 }}>
                  {c.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: t.text2 }}>{c.desc}</div>
                </div>
                <StatusChip t={t} on={on} onLabel="CONNECTED" offLabel="OFF" />
                <button
                  type="button"
                  onClick={() => setConnected((s) => ({ ...s, [c.key]: !on }))}
                  style={on ? destructiveBtn(t) : secondaryBtn(t)}
                >
                  {on ? "Disconnect" : "Connect"}
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      {/* API USAGE THIS MONTH — placeholder */}
      <Section t={t} label="API usage this month">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: t.text2 }}>
            <span>47 of 200 photos read in September</span>
            <span style={{ fontWeight: 600, color: t.text }}>24%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: t.bgElev2, overflow: "hidden" }}>
            <div style={{ width: "24%", height: "100%", background: BRAND_TEAL }} />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 6 }}>
            <div>
              <FieldLabel t={t}>Monthly limit</FieldLabel>
              <input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ ...inputStyle(t), width: 140 }} />
            </div>
            <button type="button" onClick={() => { /* TODO wire monthly limit */ }} style={primaryBtn}>Save</button>
          </div>
          <div style={{ fontSize: 11.5, color: t.text3, marginTop: 2 }}>
            NucleusAI pauses reading photos once you hit the limit for the month.
          </div>
        </div>
      </Section>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, paddingTop: 16, borderTop: `1px solid ${t.sep}`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: t.text3 }}>
          Nucleus works without any of these. Each one is off until you turn it on.
        </span>
        <a href={API_KEYS_URL} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: t.tealText, fontWeight: 600, textDecoration: "none" }}>
          Where do I get an API key?
        </a>
      </div>
    </div>
  );
}

interface FeedRow { id: string; name: string; url: string; where: "WALL" | "WALL & CALENDAR"; checked: string; }

// RSS/Atom feeds that surface on the wall beside the schedule. Local/placeholder
// list (TODO wire to a real feed reader) — reads title + date only, never a shift.
function FeedsSubTab({ t }: { t: ThemeTokens }) {
  // These placeholder feeds are one family's local ones; anyone else starts empty.
  const look = useHouseholdLook();
  const [feeds, setFeeds] = useState<FeedRow[]>(() => !look.familyPhotos ? [] : [
    { id: "kcs", name: "Kanawha County Schools", url: "kcs.k12.wv.us/feed/closings.xml", where: "WALL & CALENDAR", checked: "checked 6 minutes ago" },
    { id: "th", name: "Thomas Hospital notices", url: "thomashealth.org/news/rss", where: "WALL", checked: "checked 6 minutes ago" },
    { id: "wx", name: "Weather alerts · Charleston", url: "alerts.weather.gov/cap/wv.php", where: "WALL", checked: "checked 2 minutes ago" },
  ]);
  const [addr, setAddr] = useState("");
  const [name, setName] = useState("");
  const [showOn, setShowOn] = useState<FeedRow["where"]>("WALL");
  const [refreshing, setRefreshing] = useState(false);

  // Re-check every feed. (Real polling isn't wired yet, so this just stamps
  // each row as freshly checked; when a reader is added it triggers that.)
  const onRefreshFeeds = () => {
    if (refreshing) return;
    setRefreshing(true);
    setTimeout(() => {
      setFeeds((fs) => fs.map((f) => ({ ...f, checked: "checked just now" })));
      setRefreshing(false);
    }, 600);
  };

  const feedChip: React.CSSProperties = {
    fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
    padding: "2px 8px", borderRadius: 4, background: t.bgElev2, color: t.text2, whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Section
        t={t}
        label="Feeds"
        desc="A feed puts school closings, weather and notices on the wall beside the schedule."
        action={
          <button
            type="button"
            onClick={onRefreshFeeds}
            disabled={refreshing}
            aria-label="Re-check all feeds"
            title="Re-check all feeds"
            style={{ ...iconBtn(t), cursor: refreshing ? "default" : "pointer" }}
          >
            <RefreshIcon spinning={refreshing} />
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {feeds.map((f) => (
            <div key={f.id} style={{ ...rowCard(t), gap: 12 }}>
              <div style={{ width: 34, height: 34, borderRadius: 4, border: `1px solid ${t.sep}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: t.text2, flexShrink: 0 }}>
                <RssIcon />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                <div style={{ fontSize: 12, color: t.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.url}</div>
              </div>
              <span style={feedChip}>{f.where}</span>
              <span style={{ fontSize: 12, color: t.text3, whiteSpace: "nowrap" }}>{f.checked}</span>
              <button type="button" aria-label={`Edit ${f.name}`} title="Edit" onClick={() => { /* TODO wire feed edit */ }} style={iconBtn(t)}><PencilIcon /></button>
              <button type="button" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => setFeeds((fs) => fs.filter((x) => x.id !== f.id))} style={{ ...iconBtn(t), color: t.clayText }}><RedTrash /></button>
            </div>
          ))}
          {feeds.length === 0 && <div style={{ fontSize: 12.5, color: t.text3 }}>No feeds yet.</div>}
        </div>
      </Section>

      <Section t={t} label="Add a feed" desc="Paste the address of an RSS or Atom feed. Nucleus reads the title and the date, nothing else.">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <FieldLabel t={t}>Feed address</FieldLabel>
            <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="https://school.k12.wv.us/rss" style={inputStyle(t)} />
          </div>
          <div style={{ width: 180 }}>
            <FieldLabel t={t}>Name it</FieldLabel>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="School closings" style={inputStyle(t)} />
          </div>
          <div style={{ width: 170 }}>
            <FieldLabel t={t}>Show it on</FieldLabel>
            <select value={showOn} onChange={(e) => setShowOn(e.target.value as FeedRow["where"])} style={inputStyle(t)}>
              <option value="WALL">Wall display</option>
              <option value="WALL & CALENDAR">Wall &amp; calendar</option>
            </select>
          </div>
          <button
            type="button"
            style={primaryBtn}
            onClick={() => {
              const a = addr.trim(); if (!a) return;
              setFeeds((fs) => [...fs, { id: `f${Date.now()}`, name: name.trim() || a, url: a.replace(/^https?:\/\//, ""), where: showOn, checked: "not checked yet" }]);
              setAddr(""); setName("");
            }}
          >
            Add feed
          </button>
        </div>
      </Section>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, paddingTop: 16, borderTop: `1px solid ${t.sep}`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: t.text3 }}>Feeds are read only. Nucleus never posts to them, and nothing from a feed becomes a shift.</span>
        <span style={{ fontSize: 12, color: t.text3 }}>Checked every 15 minutes</span>
      </div>
    </div>
  );
}

function RssIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
      <circle cx="5" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ animation: spinning ? "sbmSpin 0.6s linear infinite" : undefined }}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v5h-5" />
    </svg>
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
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════════════

function NotificationsTab({ t }: { t: ThemeTokens }) {
  // Local placeholder state (TODO wire).
  const [on, setOn] = useState<Record<string, boolean>>({
    coverage: true, reminders: true, wallOffline: false,
  });
  const rows = [
    { key: "coverage", label: "Coverage requests", desc: "When someone asks for coverage or responds to a request." },
    { key: "reminders", label: "Schedule reminders", desc: "A heads-up the night before a shift you're on." },
    { key: "wallOffline", label: "Wall display offline", desc: "If the kitchen display stops checking in." },
  ];
  return (
    <Section t={t} label="Notifications" desc="What Nucleus lets you know about. These are per-Mac and off until you turn them on.">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ ...rowCard(t), gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{r.label}</div>
              <div style={{ fontSize: 12, color: t.text2 }}>{r.desc}</div>
            </div>
            <Switch t={t} on={!!on[r.key]} onToggle={() => setOn((s) => ({ ...s, [r.key]: !s[r.key] }))} />
          </div>
        ))}
      </div>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// BILLING
// ════════════════════════════════════════════════════════════════════════════

function BillingTab({ t, hhName }: { t: ThemeTokens; hhName: string }) {
  return (
    <Section t={t} label="Plan">
      <div style={rowCard(t)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Nucleus — Free / Household</div>
          <div style={{ fontSize: 12, color: t.text2 }}>{hhName} · Nucleus Manager {APP_VERSION}</div>
        </div>
        <StatusChip t={t} on onLabel="ACTIVE" offLabel="OFF" />
      </div>
      <div style={{ fontSize: 12, color: t.text3, marginTop: 10, lineHeight: 1.5 }}>
        Nucleus is a household app — there's nothing to pay. AI photo parsing bills to your own Anthropic API key
        (see Integrations → Apps).
      </div>
    </Section>
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

// ════════════════════════════════════════════════════════════════════════════
// DATA FORMAT — moving the household to the any-household model and back
// (docs/data-model.md step 4). Everyone sees which format it's in; only the
// admin can move it.
// ════════════════════════════════════════════════════════════════════════════

function DataFormatSection({ t, householdId }: { t: ThemeTokens; householdId: string }) {
  const [info, setInfo] = useState<{ migrated: boolean; isAdmin: boolean; last: MigrationReport | null } | null>(null);
  const [busy, setBusy] = useState<"move" | "back" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => watchDataFormat(householdId, setInfo, auth.currentUser?.uid), [householdId]);
  if (!info) return null;

  const onMove = async () => {
    const ok = window.confirm(
      "Move your household to the new format?\n\n" +
      "Nucleus copies your schedule to a backup, converts it, and checks the new version draws " +
      "exactly the same calendar and coverage before switching. If anything differs, nothing " +
      "changes and you'll see what.\n\n" +
      "Every Mac, Windows PC and phone must be up to date first: an older app won't be able to save.",
    );
    if (!ok) return;
    setErr(null);
    setBusy("move");
    try { await migrateToModel(householdId); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't move the household."); }
    finally { setBusy(null); }
  };
  const onBack = async () => {
    if (!window.confirm("Move your household back to the classic format? Everything done since the move is kept.")) return;
    setErr(null);
    setBusy("back");
    try { await moveBackFromModel(householdId); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't move the household back."); }
    finally { setBusy(null); }
  };

  const last = info.last;
  const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <Section
      t={t}
      label="Data format"
      desc={info.migrated
        ? "New format: each shift, event and request is saved on its own, so edits from different devices never overwrite each other."
        : "Classic format: the whole schedule is saved as one record. The new format saves each shift, event and request on its own."}
    >
      {last && (
        <div style={{ fontSize: 12.5, color: t.text2, marginBottom: 10 }}>
          {last.outcome === "migrated" && `Moved on ${when(last.at)}. The check found no differences.`}
          {last.outcome === "moved back" && `Moved back on ${when(last.at)}.`}
          {last.outcome === "refused" && (
            <>
              <div style={{ color: t.clayText }}>
                On {when(last.at)} the check found differences, so the household stayed in the classic format:
              </div>
              <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                {last.problems.map((pr) => <li key={pr}>{pr}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
      {info.isAdmin ? (
        info.migrated ? (
          <button type="button" onClick={onBack} disabled={!!busy} style={{ ...secondaryBtn(t), opacity: busy ? 0.5 : 1 }}>
            {busy === "back" ? "Moving back…" : "Move back to classic"}
          </button>
        ) : (
          <button type="button" onClick={onMove} disabled={!!busy} style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>
            {busy === "move" ? "Moving and checking…" : "Move to the new format"}
          </button>
        )
      ) : (
        <div style={{ fontSize: 11.5, color: t.text3 }}>Only the household's admin can change this.</div>
      )}
      {err && <div style={{ fontSize: 12, color: t.clayText, marginTop: 6 }}>{err}</div>}
    </Section>
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

function Switch({ t, on, onToggle }: { t: ThemeTokens; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      style={{
        width: 44, height: 26, borderRadius: 999, border: `1px solid ${on ? BRAND_TEAL : t.sep}`,
        background: on ? BRAND_TEAL : t.bgElev2, position: "relative", cursor: "pointer", padding: 0,
        flexShrink: 0, transition: "background .12s",
      }}
    >
      <span
        style={{
          position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: "50%",
          background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.3)", transition: "left .12s",
        }}
      />
    </button>
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
function SlackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="6" height="4" rx="2" />
      <rect x="10" y="4" width="4" height="6" rx="2" />
      <rect x="14" y="10" width="6" height="4" rx="2" />
      <rect x="10" y="14" width="4" height="6" rx="2" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
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
