// Cleaner — upload a clean source-of-truth schedule and review a 3-pane
// diff (Add / Remove / Change) with per-row check/X approvals.

import { useEffect, useRef, useState } from "react";
import type { Palette, ThemeTokens } from "../theme";
import type { HouseholdState } from "../state";
import {
  applyCleanerDiffs, cleanSchedule, diffParsedAgainstState,
  type DiffEntry,
} from "../lib/cleanSchedule";
import {
  applyCoverageRewrite, computeCoverageRewrite,
  type CoverageRewriteEntry,
} from "../lib/rewriteCoverage";

interface Props {
  open: boolean;
  onClose: () => void;
  palette: Palette;
  t: ThemeTokens;
  dark: boolean;
  householdId: string | null;
  state: HouseholdState | null;
  selfName: string;
  partnerName: string;
}

type Phase = "pick" | "analyzing" | "review" | "applying" | "done"
  | "rw-review" | "rw-applying";

export function CleanerModal({
  open, onClose, palette, t, dark, householdId, state, selfName, partnerName,
}: Props) {
  const [phase, setPhase]   = useState<Phase>("pick");
  const [who, setWho]       = useState<"G" | "K">("G");
  const [diffs, setDiffs]   = useState<DiffEntry[]>([]);
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [note, setNote]     = useState<string | null>(null);
  const [err, setErr]       = useState<string | null>(null);
  const [info, setInfo]     = useState<string | null>(null);
  const [rwEntries, setRwEntries] = useState<CoverageRewriteEntry[]>([]);
  const [rwApprovals, setRwApprovals] = useState<Record<string, boolean>>({});
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("pick");
    setDiffs([]);
    setApprovals({});
    setNote(null);
    setErr(null);
    setInfo(null);
    setRwEntries([]);
    setRwApprovals({});
    setDoneMsg(null);
  }, [open]);

  if (!open) return null;

  const onPick = () => inputRef.current?.click();

  const onFile = async (file: File) => {
    if (!state) { setErr("State not loaded."); return; }
    if (!file.type.startsWith("image/")) { setErr("Pick an image."); return; }
    setErr(null);
    setPhase("analyzing");
    try {
      const { base64, mediaType } = await fileToBase64(file);
      const result = await cleanSchedule(base64, mediaType, who);
      const computed = diffParsedAgainstState(result.shifts, state);
      // Default every diff to approved.
      const init: Record<string, boolean> = {};
      computed.forEach((d) => { init[diffKey(d)] = true; });
      setDiffs(computed);
      setApprovals(init);
      setNote(result.note ?? null);
      setPhase("review");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Cleaner failed.");
      setPhase("pick");
    }
  };

  const onApply = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setPhase("applying");
    try {
      const approved = diffs.filter((d) => approvals[diffKey(d)]);
      await applyCleanerDiffs(householdId, approved);
      setDoneMsg("Schedule cleaned up.");
      setPhase("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't apply.");
      setPhase("review");
    }
  };

  // ── Rewrite utility: refresh pending coverage requests to the latest
  //    scheduling logic (multi-window engine + arrival-lead starts). ──
  const onRewrite = () => {
    if (!state) { setErr("State not loaded."); return; }
    setErr(null);
    setInfo(null);
    const d = new Date();
    const todayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const entries = computeCoverageRewrite(state, todayIso);
    if (entries.length === 0) {
      setInfo("All pending coverage requests already match the latest logic — nothing to rewrite.");
      return;
    }
    const init: Record<string, boolean> = {};
    entries.forEach((e) => { init[e.key] = true; });
    setRwEntries(entries);
    setRwApprovals(init);
    setPhase("rw-review");
  };

  const onApplyRewrite = async () => {
    if (!householdId) { setErr("No household linked."); return; }
    setErr(null);
    setPhase("rw-applying");
    try {
      const approved = rwEntries.filter((e) => rwApprovals[e.key]);
      const proposed = approved.filter((e) => e.kind === "propose").length;
      await applyCoverageRewrite(householdId, approved);
      setDoneMsg(proposed > 0
        ? `Updated. ${proposed} change request${proposed === 1 ? "" : "s"} sent for approval.`
        : "Coverage requests rewritten to the latest logic.");
      setPhase("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't rewrite.");
      setPhase("rw-review");
    }
  };

  const rwApprovedCount = rwEntries.filter((e) => rwApprovals[e.key]).length;

  const adds    = diffs.filter((d) => d.kind === "add");
  const removes = diffs.filter((d) => d.kind === "remove");
  const changes = diffs.filter((d) => d.kind === "change");

  const approvedCount = diffs.filter((d) => approvals[diffKey(d)]).length;

  const stypeById = new Map((state?.shiftTypes ?? []).map((s) => [s.id, s]));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1000px, 92vw)",
          maxHeight: "85vh",
          background: dark ? "#1C1C1E" : "#FFFFFF",
          color: t.text,
          border: `0.5px solid ${t.sep}`,
          borderRadius: 14,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <WandHero size={22} color={palette.G} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Cleaner
            </div>
            <div style={{ fontSize: 11, color: t.text3, letterSpacing: "0.04em" }}>
              Upload a clean schedule. Approve / deny each change.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={closeBtnStyle(t)}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Pick phase */}
        {phase === "pick" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: t.text3, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Whose schedule is this?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {(["G","K"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setWho(k)}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 9,
                    border: `1px solid ${who === k ? (k === "G" ? palette.G : palette.K) : t.sep}`,
                    background: who === k
                      ? (k === "G" ? `${palette.G}20` : `${palette.K}20`)
                      : t.bgElev,
                    color: t.text,
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {k === "G" ? selfName : partnerName}
                </button>
              ))}
            </div>

            <div
              onClick={onPick}
              style={{
                padding: "28px 16px",
                borderRadius: 12,
                border: `1.5px dashed ${t.sep}`,
                background: t.bgElev,
                textAlign: "center",
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
                Click to pick a schedule image
              </div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 4 }}>
                JPEG · PNG · WebP — works best with a clean, well-lit photo.
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => { if (e.target.files?.[0]) void onFile(e.target.files[0]); e.target.value = ""; }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
              <span style={{ flex: 1, height: 1, background: t.sep }} />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: t.text3, letterSpacing: "0.08em" }}>OR</span>
              <span style={{ flex: 1, height: 1, background: t.sep }} />
            </div>

            <div
              onClick={onRewrite}
              style={{
                padding: "16px 16px",
                borderRadius: 12,
                border: `1px solid ${t.sep}`,
                background: t.bgElev,
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: t.text, letterSpacing: "-0.01em" }}>
                ↻ Rewrite coverage requests
              </div>
              <div style={{ fontSize: 12, color: t.text3, marginTop: 4, lineHeight: 1.45 }}>
                Refresh pending requests using the latest scheduling logic — coverage
                windows and arrival times are recomputed from today's schedule.
                Confirmed and answered requests are never touched.
              </div>
            </div>

            {info && <div style={{ fontSize: 12, color: t.text2 }}>{info}</div>}
            {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}
          </div>
        )}

        {/* Analyzing phase */}
        {phase === "analyzing" && (
          <div style={{ padding: "60px 0", textAlign: "center", color: t.text2 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Reading the schedule…</div>
            <div style={{ fontSize: 12, color: t.text3, marginTop: 6 }}>
              Claude is parsing the image. Usually 10-20 seconds.
            </div>
          </div>
        )}

        {/* Review phase — 3 panes */}
        {phase === "review" && (
          <>
            {note && (
              <div
                style={{
                  fontSize: 12, color: t.text2,
                  background: t.bgElev,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `0.5px solid ${t.sep}`,
                }}
              >
                {note}
              </div>
            )}
            {diffs.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: t.text3 }}>
                No changes — your schedule already matches the upload.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 12,
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <DiffColumn
                  title="Add"
                  count={adds.length}
                  color="#30D158"
                  entries={adds}
                  approvals={approvals}
                  onToggle={(k, v) => setApprovals((a) => ({ ...a, [k]: v }))}
                  stypeById={stypeById}
                  t={t}
                />
                <DiffColumn
                  title="Remove"
                  count={removes.length}
                  color="#FF453A"
                  entries={removes}
                  approvals={approvals}
                  onToggle={(k, v) => setApprovals((a) => ({ ...a, [k]: v }))}
                  stypeById={stypeById}
                  t={t}
                />
                <DiffColumn
                  title="Change"
                  count={changes.length}
                  color="#FF9F0A"
                  entries={changes}
                  approvals={approvals}
                  onToggle={(k, v) => setApprovals((a) => ({ ...a, [k]: v }))}
                  stypeById={stypeById}
                  t={t}
                />
              </div>
            )}

            {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 12, color: t.text3 }}>
                {approvedCount} of {diffs.length} approved
              </div>
              <button
                type="button"
                onClick={onClose}
                style={secondaryBtn(t)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onApply}
                disabled={approvedCount === 0}
                style={{
                  marginLeft: "auto",
                  padding: "9px 18px",
                  borderRadius: 9,
                  border: 0,
                  background: palette.G,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: approvedCount === 0 ? "default" : "pointer",
                  opacity: approvedCount === 0 ? 0.5 : 1,
                  letterSpacing: "-0.01em",
                }}
              >
                Apply {approvedCount > 0 ? `(${approvedCount})` : ""}
              </button>
            </div>
          </>
        )}

        {/* Rewrite review — per-date before → after with approvals */}
        {phase === "rw-review" && (
          <>
            <div
              style={{
                fontSize: 12, color: t.text2,
                background: t.bgElev,
                padding: "8px 12px",
                borderRadius: 8,
                border: `0.5px solid ${t.sep}`,
              }}
            >
              {rwEntries.length} item{rwEntries.length === 1 ? "" : "s"} differ from the
              latest logic. <b>Rewrite</b> replaces unanswered requests outright.
              <b> Change request</b> asks the caregiver to approve a new window —
              the times she already agreed to stand until she does.
            </div>
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, minHeight: 0 }}>
              {rwEntries.map((e) => {
                const approved = rwApprovals[e.key] ?? true;
                const isPropose = e.kind === "propose";
                return (
                  <div
                    key={e.key}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: t.bg,
                      border: `0.5px solid ${t.sep}`,
                      opacity: approved ? 1 : 0.4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
                        {humanDate(e.date)}
                      </div>
                      <span
                        style={{
                          fontSize: 9.5, fontWeight: 700,
                          padding: "1px 7px", borderRadius: 999,
                          background: isPropose ? "rgba(94,92,230,0.18)" : "rgba(255,159,10,0.18)",
                          color: isPropose ? "#5E5CE6" : "#FF9F0A",
                          letterSpacing: "0.04em", textTransform: "uppercase",
                        }}
                      >
                        {isPropose ? "Change request" : "Rewrite"}
                      </span>
                      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          onClick={() => setRwApprovals((a) => ({ ...a, [e.key]: true }))}
                          style={miniBtn(approved ? "#30D158" : t.sep, approved)}
                          title="Approve"
                        >✓</button>
                        <button
                          type="button"
                          onClick={() => setRwApprovals((a) => ({ ...a, [e.key]: false }))}
                          style={miniBtn(!approved ? "#FF453A" : t.sep, !approved)}
                          title="Deny"
                        >✕</button>
                      </div>
                    </div>
                    <div style={{ fontSize: 11.5, color: t.text2, lineHeight: 1.5 }}>
                      <div>
                        <span style={{ color: t.text3 }}>{isPropose ? "agreed" : "was"}</span>{" "}
                        {e.before.length === 0
                          ? "nothing"
                          : e.before.map((b) => `${b.startTime} → ${b.endTime}${b.endsNextDay ? " +1d" : ""}`).join(" · ")}
                      </div>
                      <div>
                        <span style={{ color: t.text3 }}>{isPropose ? "propose" : "now"}</span>{" "}
                        {e.after.length === 0
                          ? "no coverage needed"
                          : e.after.map((a) => `${a.startTime} → ${a.endTime}${a.endsNextDay ? " +1d" : ""}`).join(" · ")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {err && <div style={{ fontSize: 12, color: "#FF453A" }}>{err}</div>}

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ fontSize: 12, color: t.text3 }}>
                {rwApprovedCount} of {rwEntries.length} approved
              </div>
              <button type="button" onClick={() => setPhase("pick")} style={secondaryBtn(t)}>
                Back
              </button>
              <button
                type="button"
                onClick={onApplyRewrite}
                disabled={rwApprovedCount === 0}
                style={{
                  marginLeft: "auto",
                  padding: "9px 18px",
                  borderRadius: 9,
                  border: 0,
                  background: palette.G,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: rwApprovedCount === 0 ? "default" : "pointer",
                  opacity: rwApprovedCount === 0 ? 0.5 : 1,
                  letterSpacing: "-0.01em",
                }}
              >
                Rewrite {rwApprovedCount > 0 ? `(${rwApprovedCount})` : ""}
              </button>
            </div>
          </>
        )}

        {/* Applying / Done */}
        {(phase === "applying" || phase === "rw-applying") && (
          <div style={{ padding: "60px 0", textAlign: "center", color: t.text2 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {phase === "rw-applying" ? "Rewriting requests…" : "Applying changes…"}
            </div>
          </div>
        )}
        {phase === "done" && (
          <div style={{ padding: "30px 0", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
              {doneMsg ?? "Schedule cleaned up."}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ ...secondaryBtn(t), marginTop: 16 }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────── diff column ───────────────────

function DiffColumn({
  title, count, color, entries, approvals, onToggle, stypeById, t,
}: {
  title: string;
  count: number;
  color: string;
  entries: DiffEntry[];
  approvals: Record<string, boolean>;
  onToggle: (key: string, v: boolean) => void;
  stypeById: Map<string, { name: string; start: string; end: string }>;
  t: ThemeTokens;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: t.bgElev,
        border: `0.5px solid ${t.sep}`,
        borderTop: `3px solid ${color}`,
        borderRadius: 10,
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: `0.5px solid ${t.sep}`,
        }}
      >
        <span
          style={{
            fontSize: 10.5, fontWeight: 700,
            color, letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 11, fontWeight: 600, color: t.text3,
            background: t.bg,
            padding: "1px 8px",
            borderRadius: 999,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 8,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {entries.length === 0 ? (
          <div style={{ fontSize: 11, color: t.text3, textAlign: "center", padding: 18 }}>
            Nothing to {title.toLowerCase()}.
          </div>
        ) : entries.map((d) => {
          const k = diffKey(d);
          const approved = approvals[k] ?? true;
          return (
            <div
              key={k}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: t.bg,
                border: `0.5px solid ${t.sep}`,
                opacity: approved ? 1 : 0.4,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
                  {humanDate(d.date)}
                </div>
                <span
                  style={{
                    fontSize: 10, fontWeight: 700,
                    padding: "1px 6px", borderRadius: 4,
                    background: d.who === "G" ? "rgba(127,168,106,0.18)" : "rgba(232,169,60,0.20)",
                    color: d.who === "G" ? "#7FA86A" : "#E8A93C",
                    letterSpacing: "0.04em",
                  }}
                >
                  {d.who}
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => onToggle(k, true)}
                    style={miniBtn(approved ? "#30D158" : t.sep, approved)}
                    title="Approve"
                  >✓</button>
                  <button
                    type="button"
                    onClick={() => onToggle(k, false)}
                    style={miniBtn(!approved ? "#FF453A" : t.sep, !approved)}
                    title="Deny"
                  >✕</button>
                </div>
              </div>

              {/* Body */}
              {d.kind === "add" && d.next && (
                <div style={{ fontSize: 11.5, color: t.text2 }}>
                  + {d.next.label} {timeSpan(stypeById.get(d.next.shiftTypeId))}
                </div>
              )}
              {d.kind === "remove" && d.prev && (
                <div style={{ fontSize: 11.5, color: t.text2 }}>
                  – {d.prev.label} <span style={{ color: t.text3 }}>({d.prev.source})</span>
                </div>
              )}
              {d.kind === "change" && d.prev && d.next && (
                <div style={{ fontSize: 11.5, color: t.text2, lineHeight: 1.5 }}>
                  <div><span style={{ color: t.text3 }}>was</span> {d.prev.label} {timeSpan(stypeById.get(d.prev.shiftTypeId))}</div>
                  <div><span style={{ color: t.text3 }}>now</span> {d.next.label} {timeSpan(stypeById.get(d.next.shiftTypeId))}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────── helpers ───────────────────

function diffKey(d: DiffEntry): string {
  return `${d.kind}:${d.date}:${d.who}`;
}

// Resize-then-base64. iPhone photos hit ~10MB → base64 bloats to ~14MB,
// which blows past Cloud Functions' 10MB request cap. We downscale to
// max 1920px on the longest edge and JPEG-recompress before uploading.
// Vision still reads the schedule cleanly at this resolution.
const CLEANER_MAX_EDGE = 1920;
const CLEANER_QUALITY  = 0.85;

async function fileToBase64(
  file: File,
): Promise<{ base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }> {
  // Decode → draw to canvas at max-edge ratio → toBlob JPEG → re-encode base64.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload  = () => resolve(im);
      im.onerror = () => reject(new Error("Couldn't decode image."));
      im.src = url;
    });
    const ratio = Math.min(1, CLEANER_MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.round(img.width  * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas 2d context");
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error("Canvas toBlob returned null")),
        "image/jpeg",
        CLEANER_QUALITY,
      );
    });

    // Blob → data URL → base64 chunk.
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const dataUrl = String(r.result || "");
        const m = dataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
        if (!m) { reject(new Error("Couldn't re-encode image.")); return; }
        resolve(m[1]);
      };
      r.onerror = () => reject(new Error("Couldn't read resized blob."));
      r.readAsDataURL(blob);
    });

    return { base64, mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return `${DOW[dt.getDay()]} ${MONTHS[m! - 1]} ${d}`;
}
function timeSpan(s?: { start: string; end: string }): string {
  if (!s) return "";
  return `${s.start}–${s.end}`;
}

function closeBtnStyle(t: ThemeTokens): React.CSSProperties {
  return {
    marginLeft: "auto",
    width: 26, height: 26,
    border: `0.5px solid ${t.sep}`,
    background: "transparent",
    color: t.text2,
    borderRadius: 7,
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
function secondaryBtn(t: ThemeTokens): React.CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 8,
    border: `0.5px solid ${t.sep}`,
    background: "transparent",
    color: t.text,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
    letterSpacing: "-0.01em",
  };
}
function miniBtn(color: string, active: boolean): React.CSSProperties {
  return {
    width: 22, height: 22,
    border: `1px solid ${color}`,
    background: active ? color : "transparent",
    color: active ? "#fff" : color,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };
}

function WandHero({ size = 22, color = "#7FA86A" }: { size?: number; color?: string }) {
  // Same sparkles cluster as Inspector's WandIcon — kept in sync so the
  // Utilities row and the Cleaner modal hero feel like the same mark.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      aria-hidden
    >
      {/* Big star — upper-left center */}
      <path d="M8 3.5 L9.5 7.5 L13.5 9 L9.5 10.5 L8 14.5 L6.5 10.5 L2.5 9 L6.5 7.5 Z" />
      {/* Small star — upper-right */}
      <path d="M18 2.5 L18.7 4.3 L20.5 5 L18.7 5.7 L18 7.5 L17.3 5.7 L15.5 5 L17.3 4.3 Z" />
      {/* Medium star — middle-right */}
      <path d="M17 10.5 L18 13 L20.5 14 L18 15 L17 17.5 L16 15 L13.5 14 L16 13 Z" />
      {/* Tiny star — lower-left */}
      <path d="M8 16 L8.5 17.5 L10 18 L8.5 18.5 L8 20 L7.5 18.5 L6 18 L7.5 17.5 Z" />
    </svg>
  );
}
