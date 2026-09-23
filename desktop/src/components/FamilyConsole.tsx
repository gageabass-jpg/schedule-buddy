import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdMeta } from "../state";
import type { HouseholdState } from "../state";
import type { DependentBlock } from "../state";
import type { ThemePref } from "../App";
import { setHouseholdName } from "../lib/writeHouseholdMeta";
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
}

export function FamilyConsole({
  open, onClose, palette, t, dark, householdId, household, state,
  themePref, onSetThemePref,
}: Props) {
  const [draftName, setDraftName] = useState("");
  const [tz, setTz] = useState("Eastern · Charleston, WV");
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
  }, [open, state?.householdName, household]);

  if (!open) return null;

  const hhName = state?.householdName ?? defaultHouseholdName(household);

  const onSaveName = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setBusy(true);
    try { await setHouseholdName(householdId, draftName); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); }
    finally { setBusy(false); }
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
        position: "fixed",
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
        style={{
          width: "min(1200px, 94vw)",
          height: "min(860px, 92vh)",
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
                    padding: "10px 12px",
                    borderRadius: 4,
                    border: 0,
                    background: on ? TEAL_TINT : "transparent",
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
          <div style={{ marginTop: "auto", paddingTop: 16, fontSize: 11, color: t.text3 }}>
            Changes save as you make them.
          </div>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 28px",
            background: t.bgElev,
            minWidth: 0,
          }}
        >
          <div style={{ maxWidth: 1000 }}>
            {tab === "general" && (
              <GeneralTab
                t={t} dark={dark}
                hhName={hhName}
                draftName={draftName} setDraftName={setDraftName}
                tz={tz} setTz={setTz}
                busy={busy} onSaveName={onSaveName}
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
              />
            )}

            {tab === "wall" && (
              <WallTab t={t} palette={palette} householdId={householdId} state={state} />
            )}

            {tab === "integrations" && (
              <IntegrationsTab t={t} palette={palette} householdId={householdId} state={state} />
            )}

            {tab === "notifications" && <NotificationsTab t={t} />}

            {tab === "billing" && <BillingTab t={t} hhName={hhName} />}

            {err && <div style={{ fontSize: 12.5, color: CLAY, marginTop: 16 }}>{err}</div>}
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
  draftName: string; setDraftName: (v: string) => void;
  tz: string; setTz: (v: string) => void;
  busy: boolean; onSaveName: () => void;
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
  const nameDirty = p.draftName !== p.hhName;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, minHeight: "100%" }}>
      {/* HOUSEHOLD */}
      <Section t={t} label="Household">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <FieldLabel t={t}>Name</FieldLabel>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={p.draftName}
                onChange={(e) => p.setDraftName(e.target.value)}
                placeholder="Bass Household"
                style={inputStyle(t)}
              />
              <button
                type="button"
                onClick={p.onSaveName}
                disabled={p.busy || !nameDirty}
                style={{ ...primaryBtn, opacity: p.busy || !nameDirty ? 0.5 : 1, cursor: p.busy || !nameDirty ? "not-allowed" : "pointer" }}
              >
                {p.busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <FieldLabel t={t}>Time zone</FieldLabel>
            <input
              type="text"
              value={p.tz}
              onChange={(e) => p.setTz(e.target.value)}
              placeholder="Eastern · Charleston, WV"
              style={inputStyle(t)}
            />
          </div>
        </div>
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
          paddingTop: 20,
          borderTop: `1px solid ${t.sep}`,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={p.onSignOut} style={secondaryBtn(t)}>Sign out</button>
          <button type="button" onClick={p.onLeaveHousehold} style={destructiveBtn}>Leave household</button>
        </div>
        <div style={{ fontSize: 12, color: t.text3 }}>Nucleus Manager {APP_VERSION}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PEOPLE
// ════════════════════════════════════════════════════════════════════════════

function PeopleTab(p: {
  t: ThemeTokens; dark: boolean; palette: Palette;
  members: Array<{ uid: string; name: string; role: "admin" | "partner" | "supporting" }>;
  selfUid: string | null;
  removingUid: string | null;
  onRemoveMember: (uid: string, name: string) => void;
  daisy: DependentBlock | undefined;
  state: HouseholdState | null;
  householdId: string | null;
}) {
  const { t, palette, dark } = p;

  // WHAT NUCLEUSAI MAY DO — local per-person permission (TODO wire).
  const [aiPerms, setAiPerms] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const m of p.members) init[m.uid] = m.role === "supporting" ? "read" : "draft";
    return init;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* MEMBERS */}
      <Section t={t} label={`Members (${p.members.length})`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {p.members.length === 0 && (
            <div style={{ fontSize: 12.5, color: t.text3 }}>No members yet.</div>
          )}
          {p.members.map((m) => {
            const isG = m.name.toLowerCase().includes("gage");
            const isK = m.name.toLowerCase().includes("kaylene") || m.name.toLowerCase().includes("kayl");
            const isSelf = !!p.selfUid && m.uid === p.selfUid;
            const isBusy = p.removingUid === m.uid;
            const summary = m.role === "admin" ? "Full schedule · overrides"
              : m.role === "supporting" ? "Coverage requests only"
              : "Full schedule";
            return (
              <div key={m.uid} style={{ ...rowCard(t), opacity: isBusy ? 0.5 : 1 }}>
                {isG ? <PhotoAv who="G" size={34} palette={palette} dark={dark} /> :
                 isK ? <PhotoAv who="K" size={34} palette={palette} dark={dark} /> :
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
                <button
                  type="button"
                  aria-label={`Edit ${m.name}`}
                  title="Edit"
                  onClick={() => { /* TODO wire member edit */ }}
                  style={iconBtn(t)}
                >
                  <PencilIcon />
                </button>
                {!isSelf && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    title="Remove"
                    disabled={isBusy}
                    onClick={() => p.onRemoveMember(m.uid, m.name)}
                    style={{ ...iconBtn(t), color: CLAY }}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* DEPENDENTS */}
      <Section t={t} label="Dependents" desc="Kids and others whose schedule lives in the household.">
        {p.daisy ? (
          <div style={rowCard(t)}>
            <InitialSquare letter="D" color="#5A6663" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{p.daisy.name || "Daisy"}</div>
              <div style={{ fontSize: 12, color: t.text2 }}>
                School schedule · {p.daisy.shifts?.length ?? 0} class day{(p.daisy.shifts?.length ?? 0) === 1 ? "" : "s"} on file
              </div>
            </div>
            <RoleChip t={t} role="dependent" />
            <button type="button" aria-label="Edit Daisy" title="Edit" onClick={() => { /* TODO wire dependent edit */ }} style={iconBtn(t)}>
              <PencilIcon />
            </button>
            <button type="button" aria-label="Remove Daisy" title="Remove" onClick={() => { /* TODO wire dependent remove */ }} style={{ ...iconBtn(t), color: CLAY }}>
              <TrashIcon />
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: t.text3 }}>
            No dependents yet. Import Daisy's class schedule from the sidebar to add her.
          </div>
        )}
      </Section>

      {/* PAYDAYS */}
      <Section t={t} label="Paydays" desc="A $ chip appears on the calendar on each member's payday.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <PaydayRow who="G" label="Gage" color={palette.G} schedule={p.state?.paydays?.G ?? null} householdId={p.householdId} t={t} />
          <PaydayRow who="K" label="Kaylene" color={palette.K} schedule={p.state?.paydays?.K ?? null} householdId={p.householdId} t={t} />
          <button type="button" onClick={() => { /* TODO wire add-a-person */ }} style={{ ...secondaryBtn(t), alignSelf: "flex-start" }}>
            Add a person
          </button>
        </div>
      </Section>

      {/* WHAT NUCLEUSAI MAY DO — placeholder */}
      <Section
        t={t}
        label="What NucleusAI may do"
        desc="This is the most each person may allow the assistant to do on their behalf."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {p.members.map((m) => (
            <div key={m.uid} style={{ ...rowCard(t), gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.name}
              </div>
              <select
                value={aiPerms[m.uid] ?? "draft"}
                onChange={(e) => setAiPerms((s) => ({ ...s, [m.uid]: e.target.value }))}
                style={{ ...inputStyle(t), width: 160, cursor: "pointer" }}
              >
                <option value="draft">Draft</option>
                <option value="read">Read only</option>
                <option value="off">Off</option>
              </select>
            </div>
          ))}
        </div>
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
        <Section t={t} label="Wall display" desc="The wall shows today and tomorrow in large type, then the photos rotate in. The page auto-refreshes every 30s.">
          <WallDisplaySection householdId={p.householdId} t={t} palette={p.palette} />
        </Section>
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
    { key: "apple", name: "Apple Calendar", desc: "Writes shifts to the Bass Household calendar", icon: <CalendarIcon /> },
    { key: "google", name: "Google Calendar", desc: "Two-way, for anyone not on an iPhone", icon: <CalendarIcon /> },
  ];

  const [limit, setLimit] = useState("200");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* AI PROVIDER API */}
      <Section t={t} label="AI provider API" desc="Used to parse schedule photos with Claude Vision. The key is encrypted locally (macOS Keychain).">
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
                  style={on ? destructiveBtn : secondaryBtn(t)}
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
        <a href={API_KEYS_URL} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: BRAND_TEAL, fontWeight: 600, textDecoration: "none" }}>
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
  const [feeds, setFeeds] = useState<FeedRow[]>([
    { id: "kcs", name: "Kanawha County Schools", url: "kcs.k12.wv.us/feed/closings.xml", where: "WALL & CALENDAR", checked: "checked 6 minutes ago" },
    { id: "th", name: "Thomas Hospital notices", url: "thomashealth.org/news/rss", where: "WALL", checked: "checked 6 minutes ago" },
    { id: "wx", name: "Weather alerts · Charleston", url: "alerts.weather.gov/cap/wv.php", where: "WALL", checked: "checked 2 minutes ago" },
  ]);
  const [addr, setAddr] = useState("");
  const [name, setName] = useState("");
  const [showOn, setShowOn] = useState<FeedRow["where"]>("WALL");

  const feedChip: React.CSSProperties = {
    fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
    padding: "2px 8px", borderRadius: 4, background: t.bgElev2, color: t.text2, whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <Section t={t} label="Feeds" desc="A feed puts school closings, weather and notices on the wall beside the schedule.">
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
              <button type="button" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => setFeeds((fs) => fs.filter((x) => x.id !== f.id))} style={{ ...iconBtn(t), color: CLAY }}><TrashIcon /></button>
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
        <button type="button" onClick={onClear} disabled={busy} style={destructiveBtn}>Remove</button>
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
      {err && <div style={{ fontSize: 12.5, color: CLAY }}>{err}</div>}
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

function Section({ label, desc, t, children }: { label: string; desc?: string; t: ThemeTokens; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: t.text3, marginBottom: 8 }}>
        {label}
      </div>
      {desc && <div style={{ fontSize: 12.5, color: t.text2, marginBottom: 12, lineHeight: 1.5 }}>{desc}</div>}
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
    <div style={{ display: "flex", gap: 20, borderBottom: `1px solid ${t.sep}`, marginBottom: 20 }}>
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
              background: on ? TEAL_TINT : t.bgElev,
              color: on ? BRAND_TEAL : t.text2,
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
    admin: { bg: TEAL_TINT, fg: BRAND_TEAL, label: "ADMIN" },
    partner: { bg: CLAY_TINT, fg: CLAY, label: "PARTNER" },
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
        background: on ? TEAL_TINT : t.bgElev2, color: on ? BRAND_TEAL : t.text2, flexShrink: 0,
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
function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2m-9 0v14a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6" />
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
    boxSizing: "border-box",
    padding: "10px 12px",
    border: `1px solid ${t.sep}`,
    borderRadius: 4,
    background: t.bgElev,
    color: t.text,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    colorScheme: t.bg === "#000" ? "dark" : "light",
  };
}

const primaryBtn: React.CSSProperties = {
  height: 38,
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
  height: 38,
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
    height: 38,
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

const destructiveBtn: React.CSSProperties = {
  height: 38,
  padding: "0 16px",
  border: `1px solid ${CLAY}`,
  borderRadius: 4,
  background: "transparent",
  color: CLAY,
  fontFamily: BRAND_FONT,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

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
    padding: "12px 14px",
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
  return "Bass Household";
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
        padding: "12px 14px",
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
      {err && <div style={{ gridColumn: "1 / -1", fontSize: 12, color: CLAY }}>{err}</div>}
    </div>
  );
}
