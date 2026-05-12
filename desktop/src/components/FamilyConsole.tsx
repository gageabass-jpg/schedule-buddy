import { useEffect, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdMeta } from "../state";
import type { HouseholdState } from "../state";
import type { ThemePref } from "../App";
import { setHouseholdName } from "../lib/writeHouseholdMeta";
import { createInviteCode } from "../lib/createInviteCode";
import { removeHouseholdMember } from "../lib/removeHouseholdMember";
import { deleteCoverageRequest, statusLabel } from "../lib/writeCoverageRequest";
import { doSignOut } from "../hooks/useAuth";
import { auth } from "../firebase";
import { PhotoAv } from "./PhotoAv";

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [caregiverCode, setCaregiverCode] = useState<string | null>(null);
  const [caregiverCopied, setCaregiverCopied] = useState(false);
  const [caregiverBusy, setCaregiverBusy] = useState(false);
  const [removingUid, setRemovingUid] = useState<string | null>(null);

  const selfUid = auth.currentUser?.uid ?? null;

  useEffect(() => {
    if (!open) return;
    setDraftName(state?.householdName ?? defaultHouseholdName(household));
    setErr(null);
    setCopied(false);
    setCaregiverCode(null);
    setCaregiverCopied(false);
  }, [open, state?.householdName, household]);

  if (!open) return null;

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

  const members = household
    ? household.memberUids.map((uid) => ({
        uid,
        name: household.memberNames[uid] ?? "Member",
        role: household.roles[uid] ?? "partner",
      }))
    : [];

  const daisy = state?.dependents?.daisy;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1100 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Family console"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 64px)",
          background: t.bgElev,
          color: t.text,
          borderRadius: 16,
          padding: "20px 22px 16px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          zIndex: 1101,
          fontFamily: "inherit",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>Family Console</div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: 0, color: t.text2, fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1, fontFamily: "inherit" }}
            aria-label="Close"
          >✕</button>
        </div>
        <div style={{ fontSize: 12, color: t.text2, marginBottom: 14 }}>
          Manage household details, members, and dependents.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, overflow: "auto", paddingRight: 4 }}>
          {/* Household name */}
          <Section title="Household name" t={t}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Bass Household"
                style={{ ...inputStyle(t), flex: 1 }}
              />
              <button
                type="button"
                onClick={onSaveName}
                disabled={busy || draftName === (state?.householdName ?? defaultHouseholdName(household))}
                style={primaryBtn(palette.G, busy)}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </Section>

          {/* Invite code */}
          <Section title="Invite code" t={t} hint="Share with a new member to link their Mac or phone.">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: t.bg,
                  border: `0.5px solid ${t.sep}`,
                  fontFamily: "var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace)",
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  textAlign: "center",
                  userSelect: "all",
                }}
              >
                {household?.inviteCode ?? "——————"}
              </div>
              <button
                type="button"
                onClick={onCopyCode}
                disabled={!household?.inviteCode}
                style={{ ...secondaryBtn(t), background: copied ? "#34C759" : "transparent", color: copied ? "#fff" : t.text, borderColor: copied ? "#34C759" : t.sep }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </Section>

          {/* Caregiver invite */}
          <Section title="Caregiver invite" t={t} hint="Generate a code that lands the redeemer as a Supporting account — they'll only see Coverage Requests, not the full schedule.">
            {caregiverCode ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: t.bg,
                    border: `0.5px solid ${t.sep}`,
                    fontFamily: "var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace)",
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    textAlign: "center",
                    userSelect: "all",
                  }}
                >
                  {caregiverCode}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(caregiverCode); setCaregiverCopied(true); setTimeout(() => setCaregiverCopied(false), 1400); }
                    catch { /* swallow */ }
                  }}
                  style={{ ...secondaryBtn(t), background: caregiverCopied ? "#34C759" : "transparent", color: caregiverCopied ? "#fff" : t.text, borderColor: caregiverCopied ? "#34C759" : t.sep }}
                >
                  {caregiverCopied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => { setCaregiverCode(null); setCaregiverCopied(false); }}
                  style={secondaryBtn(t)}
                >
                  New
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  if (!householdId) { setErr("No household linked."); return; }
                  setErr(null);
                  setCaregiverBusy(true);
                  try {
                    const code = await createInviteCode(householdId, "supporting");
                    setCaregiverCode(code);
                  } catch (e) {
                    setErr(e instanceof Error ? e.message : "Couldn't generate a code.");
                  } finally {
                    setCaregiverBusy(false);
                  }
                }}
                disabled={caregiverBusy || !householdId}
                style={primaryBtn(palette.G, caregiverBusy)}
              >
                {caregiverBusy ? "Generating…" : "Generate caregiver code"}
              </button>
            )}
          </Section>

          {/* Members */}
          <Section title={`Members (${members.length})`} t={t}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {members.length === 0 && (
                <div style={{ fontSize: 12, color: t.text3, padding: "6px 2px" }}>No members yet.</div>
              )}
              {members.map((m) => {
                const isG = m.name.toLowerCase().includes("gage");
                const isK = m.name.toLowerCase().includes("kaylene") || m.name.toLowerCase().includes("kayl");
                const isSelf = !!selfUid && m.uid === selfUid;
                const isBusy = removingUid === m.uid;
                return (
                  <div
                    key={m.uid}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                      border: `0.5px solid ${t.sep}`,
                      opacity: isBusy ? 0.5 : 1,
                    }}
                  >
                    {isG ? <PhotoAv who="G" size={26} palette={palette} dark={dark} /> :
                     isK ? <PhotoAv who="K" size={26} palette={palette} dark={dark} /> :
                     <InitialDisc letter={m.name[0]?.toUpperCase() ?? "?"} color={palette.BOTH} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.name}{isSelf ? <span style={{ color: t.text3, fontWeight: 500, marginLeft: 6 }}>(you)</span> : null}
                      </div>
                      <div style={{ fontSize: 10.5, color: t.text3 }}>
                        {m.role === "admin" ? "Admin" : m.role === "supporting" ? "Supporting" : "Partner"}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background:
                          m.role === "admin"      ? `rgba(10,132,255,0.18)`  :
                          m.role === "supporting" ? `rgba(48,209,88,0.18)`   :
                                                    `rgba(142,142,147,0.18)`,
                        color:
                          m.role === "admin"      ? palette.G  :
                          m.role === "supporting" ? "#30D158"  :
                                                    t.text2,
                      }}
                    >
                      {m.role}
                    </span>
                    {!isSelf && (
                      <button
                        type="button"
                        title={`Remove ${m.name} from this household`}
                        disabled={isBusy}
                        onClick={async () => {
                          if (!householdId) return;
                          const ok = window.confirm(
                            `Remove ${m.name} from this household?\n\n` +
                            `They'll lose access to the schedule, but their Firebase login itself ` +
                            `is not deleted. To fully wipe a test account, sign in as them on iOS ` +
                            `and use "Delete my account" in the Profile tab.`,
                          );
                          if (!ok) return;
                          setErr(null);
                          setRemovingUid(m.uid);
                          try { await removeHouseholdMember(householdId, m.uid); }
                          catch (e) { setErr(e instanceof Error ? e.message : "Couldn't remove."); }
                          finally { setRemovingUid(null); }
                        }}
                        aria-label={`Remove ${m.name}`}
                        style={{
                          background: "transparent",
                          border: 0,
                          color: "#FF453A",
                          fontSize: 16,
                          cursor: isBusy ? "wait" : "pointer",
                          padding: 4,
                          lineHeight: 1,
                          fontFamily: "inherit",
                        }}
                      >✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Dependents */}
          <Section title="Dependents" t={t} hint="Kids and others whose schedule lives in the household.">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {daisy ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 8,
                    background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                    border: `0.5px solid ${t.sep}`,
                  }}
                >
                  <InitialDisc letter="D" color="#30D158" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
                      {daisy.name || "Daisy"}
                    </div>
                    <div style={{ fontSize: 10.5, color: t.text3 }}>
                      {daisy.shifts?.length ?? 0} school day{(daisy.shifts?.length ?? 0) === 1 ? "" : "s"} on file
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: t.text3, padding: "6px 2px" }}>
                  No dependents yet. Import Daisy's school schedule from the sidebar to add her.
                </div>
              )}
            </div>
          </Section>

          {/* Coverage requests */}
          <Section
            title={`Coverage requests (${(state?.coverageRequests ?? []).length})`}
            t={t}
            hint="Right-click Overlap in the sidebar to send a new batch to the caregiver."
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflow: "auto" }}>
              {(state?.coverageRequests ?? []).length === 0 && (
                <div style={{ fontSize: 12, color: t.text3, padding: "6px 2px" }}>
                  None yet. Right-click <em>Overlap</em> in the sidebar to send.
                </div>
              )}
              {(state?.coverageRequests ?? [])
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((req) => {
                  const [y, m, d] = req.date.split("-").map(Number);
                  const dt = new Date(y, m - 1, d);
                  const day = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                  const time = `${req.startTime} – ${req.endTime}${req.endsNextDay ? " +1d" : ""}`;
                  const statusColor =
                    req.status === "confirmed" ? "#30D158" :
                    req.status === "declined"  ? "#FF453A" :
                    req.status === "issue"     ? "#FF9F0A" :
                    palette.G;
                  return (
                    <div
                      key={req.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                        border: `0.5px solid ${t.sep}`,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
                          {day} · {time}
                        </div>
                        <div style={{ fontSize: 10.5, color: t.text3 }}>
                          {req.arriveBy ? `Arrive by ${req.arriveBy}` : "No arrive-by"}
                          {req.notes ? ` · ${req.notes}` : ""}
                          {req.caregiverNote ? ` · "${req.caregiverNote}"` : ""}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: `${statusColor}22`,
                          color: statusColor,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        {statusLabel(req.status)}
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!householdId) return;
                          if (!window.confirm(`Cancel coverage request for ${day}?`)) return;
                          try { await deleteCoverageRequest(householdId, req.id); }
                          catch (e) { window.alert(e instanceof Error ? e.message : "Couldn't cancel."); }
                        }}
                        title="Cancel this request"
                        style={{
                          background: "transparent",
                          border: 0,
                          color: t.text3,
                          fontSize: 14,
                          cursor: "pointer",
                          padding: 4,
                          lineHeight: 1,
                          fontFamily: "inherit",
                        }}
                        aria-label="Cancel request"
                      >✕</button>
                    </div>
                  );
                })}
            </div>
          </Section>

          {/* Appearance */}
          <Section title="Appearance" t={t} hint="Match macOS or pick a fixed mode.">
            <div
              style={{
                display: "flex",
                gap: 4,
                padding: 2,
                borderRadius: 8,
                background: dark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)",
              }}
            >
              {(["system", "light", "dark"] as const).map((pref) => {
                const active = themePref === pref;
                return (
                  <button
                    key={pref}
                    type="button"
                    onClick={() => onSetThemePref(pref)}
                    style={{
                      flex: 1,
                      padding: "7px 10px",
                      border: 0,
                      borderRadius: 6,
                      background: active ? (dark ? "#3A3A3C" : "#fff") : "transparent",
                      color: t.text,
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textTransform: "capitalize",
                      boxShadow: active ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {pref}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* Account / sign out */}
          <Section title="Account" t={t}>
            <button
              type="button"
              onClick={() => { void doSignOut(); }}
              style={{
                width: "100%",
                padding: "10px 14px",
                background: "transparent",
                color: "#FF453A",
                border: `0.5px solid ${t.sep}`,
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Sign out
            </button>
          </Section>

          {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}
        </div>
      </div>
    </>
  );
}

function defaultHouseholdName(household: HouseholdMeta | null): string {
  if (!household) return "Bass Household";
  return "Bass Household";
}

function Section({ title, hint, t, children }: { title: string; hint?: string; t: ThemeTokens; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: t.text3, marginBottom: 6 }}>
        {title}
      </div>
      {hint && <div style={{ fontSize: 11.5, color: t.text2, marginBottom: 6, lineHeight: 1.45 }}>{hint}</div>}
      {children}
    </div>
  );
}

function InitialDisc({ letter, color }: { letter: string; color: string }) {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: `${color}33`,
        color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        flexShrink: 0,
        boxShadow: `0 0 0 1px ${color}80`,
      }}
    >
      {letter}
    </div>
  );
}

function inputStyle(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "9px 12px",
    background: t.bg === "#000" ? "#000" : t.bg,
    border: `0.5px solid ${t.sep}`,
    borderRadius: 8,
    color: t.text,
    fontSize: 13,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
    outline: "none",
    width: "100%",
    colorScheme: t.bg === "#000" ? "dark" : "light",
  };
}

function primaryBtn(color: string, disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 14px",
    border: 0,
    borderRadius: 8,
    background: color,
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}

function secondaryBtn(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "9px 14px",
    border: `0.5px solid ${t.sep}`,
    borderRadius: 8,
    background: "transparent",
    color: t.text,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "-0.01em",
  };
}
