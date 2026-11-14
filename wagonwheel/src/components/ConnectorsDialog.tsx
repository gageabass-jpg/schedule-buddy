import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Circle, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { notify } from "@nucleus/ui/lib/toast";
import { cn } from "@nucleus/ui/lib/utils";
import type { ClaudeConnectorStatus, ConnectorsStatus, IcloudCheck } from "@shared/connectors";
import type { GithubStatus } from "@shared/github";
import { useUi } from "@/lib/ui-state";
import { bridge, messageOf } from "@/lib/bridge";
import { Chip, FormError, Modal, type Tone } from "./kit";
import { GlassButton } from "./GlassButton";
import { LoadingState } from "./LoadingState";

// Connectors: how Claude Code and GitHub reach Wagonwheel, and the iCloud Mail connector that sits beside
// it. Everything here is done by the main process (it reads Claude Code's own list of connectors and runs
// `claude mcp`); this window only shows what is in place and asks for changes. No secret is ever shown.

const linkClass = "text-crimson-text underline underline-offset-2 hover:text-white";

export function ConnectorsDialog() {
  const { closeConnectors, openGithub } = useUi();
  const [status, setStatus] = useState<ConnectorsStatus | null>(null);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "connect" | "disconnect" | "check">(null);
  const [allowChanges, setAllowChanges] = useState(true);
  const [check, setCheck] = useState<IcloudCheck | null>(null);

  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** Read how things stand. `keepChoice` leaves the "let Claude Code make changes" box where the person put it. */
  const load = useCallback(async (keepChoice = false) => {
    try {
      const [s, g] = await Promise.all([bridge().connectorsStatus(), bridge().githubStatus()]);
      if (!alive.current) return;
      setStatus(s);
      setGithub(g);
      if (!keepChoice && s.claude.state === "connected") setAllowChanges(!s.claude.readOnly);
    } catch (err) {
      if (alive.current) setError(messageOf(err));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (kind: "connect" | "disconnect", fn: () => Promise<ConnectorsStatus>, done: string) => {
    setBusy(kind);
    setError(null);
    try {
      const s = await fn();
      if (!alive.current) return;
      setStatus(s);
      notify(done, { ttl: 8000 });
    } catch (err) {
      if (alive.current) setError(messageOf(err));
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const connect = (readOnly: boolean) => act("connect", () => bridge().connectorsConnect(readOnly), `Connected to Claude Code${readOnly ? " (read-only)" : ""}. Sessions that are already open pick it up the next time they start.`);
  const disconnect = () => act("disconnect", () => bridge().connectorsDisconnect(), "Disconnected from Claude Code.");

  const toggleChanges = (checked: boolean) => {
    setAllowChanges(checked);
    if (status?.claude.state === "connected") void connect(!checked);   // already connected: the change takes effect now
  };

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); notify(`${what} copied.`, { ttl: 3000 }); } catch { /* it is on screen to select */ }
  };

  const checkIcloud = async () => {
    setBusy("check");
    setError(null);
    setCheck(null);
    try {
      const r = await bridge().connectorsCheckIcloud();
      if (alive.current) setCheck(r);
    } catch (err) {
      if (alive.current) setError(messageOf(err));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const signOutGithub = async () => {
    try { await bridge().githubSignOut(); await load(true); } catch (err) { setError(messageOf(err)); }
  };

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) closeConnectors(); }}
      title="Connectors"
      description="What Claude Code and GitHub can reach, and how."
      width={700}
      footer={<>
        <GlassButton tone="ghost" className="mr-auto" onClick={() => { setCheck(null); void load(true); }}><RefreshCw size={14} />Refresh</GlassButton>
        <GlassButton tone="primary" onClick={closeConnectors}>Done</GlassButton>
      </>}
    >
      <div className="flex flex-col gap-4 pb-1">
        <FormError message={error} />
        {!status ? (
          !error && <div className="grid place-items-center py-10"><LoadingState label="Checking your connectors" variant="Dots" /></div>
        ) : (
          <>
            <ClaudeCard
              s={status.claude} busy={busy} allowChanges={allowChanges}
              onToggle={toggleChanges} onConnect={() => void connect(!allowChanges)} onDisconnect={() => void disconnect()}
              onCopy={() => void copy(allowChanges ? status.claude.command : status.claude.commandReadOnly, "Command")}
            />
            <GithubCard
              g={github}
              onScan={() => { closeConnectors(); openGithub(); }}
              onSignOut={() => void signOutGithub()}
            />
            <IcloudCard
              s={status.icloud} busy={busy} check={check}
              onCheck={() => void checkIcloud()}
              onCopy={(text, what) => void copy(text, what)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Card({ title, chip, children }: { title: string; chip: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-xl border border-white/[0.07] bg-black/15 p-4">
      <header className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {chip}
      </header>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

const Note = ({ children, tone }: { children: ReactNode; tone?: "warn" }) => (
  <p className={cn("text-[13px] leading-relaxed", tone === "warn" ? "text-warn" : "text-ink-2")}>{children}</p>
);

function CommandBox({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-white/[0.08] bg-black/30 p-2.5">
      <code className="min-w-0 flex-1 select-text break-all font-mono text-[12px] leading-snug text-ink-2">{text}</code>
      <GlassButton tone="ghost" className="!h-7 shrink-0 !px-2 !text-[12px]" onClick={onCopy} aria-label="Copy command"><Copy size={13} />Copy</GlassButton>
    </div>
  );
}

function Step({ done, children }: { done: boolean | null; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-[13.5px]">
      {done ? <Check size={15} className="shrink-0 text-ok" aria-label="Done" /> : <Circle size={15} className="shrink-0 text-ink-3" aria-label="Not yet" />}
      <span className={done ? "text-foreground" : "text-ink-2"}>{children}</span>
    </li>
  );
}

// ── Claude Code ─────────────────────────────────────────────────────────────

function ClaudeCard({ s, busy, allowChanges, onToggle, onConnect, onDisconnect, onCopy }: {
  s: ClaudeConnectorStatus; busy: string | null; allowChanges: boolean;
  onToggle: (checked: boolean) => void; onConnect: () => void; onDisconnect: () => void; onCopy: () => void;
}) {
  const chip: { tone: Tone; text: string } =
    s.state === "connected" ? { tone: "ok", text: s.readOnly ? "Connected · read-only" : "Connected · read and update" }
    : s.state === "elsewhere" ? { tone: "warn", text: "Connected to another copy" }
    : s.state === "dev_build" ? { tone: "neutral", text: "Development copy" }
    : { tone: "neutral", text: "Not connected" };
  const working = busy === "connect" || busy === "disconnect";

  return (
    <Card title="Claude Code" chip={<Chip tone={chip.tone}>{chip.text}</Chip>}>
      <Note>
        Lets Claude Code read and update your projects, tasks, milestones and notes: "what's due this week?", "add a task to Wagonwheel". It never deletes anything, and it runs on this app, so nothing else needs installing.
      </Note>

      {s.state === "dev_build" && <Note tone="warn">This is a development copy, which has no fixed location for Claude Code to start. Open the installed Nucleus Wagonwheel to connect it.</Note>}
      {s.state === "elsewhere" && <Note tone="warn">Claude Code is set to use a different copy of Wagonwheel ({s.registeredProgram}). Connect here to switch it to this one.</Note>}

      {s.state !== "dev_build" && (
        <>
          <label className="flex items-start gap-2.5 text-[14px]">
            <input type="checkbox" checked={allowChanges} onChange={(e) => onToggle(e.target.checked)} disabled={working || !s.claudeFound} className="mt-0.5 size-4 accent-[#c62845]" />
            <span>
              Let Claude Code make changes
              <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">Untick it for a connection that can look but not touch.</span>
            </span>
          </label>

          {s.claudeFound ? (
            <div className="flex flex-wrap items-center gap-2">
              {s.state !== "connected" && <GlassButton tone="primary" onClick={onConnect} disabled={working}>{s.state === "elsewhere" ? "Connect this copy" : "Connect to Claude Code"}</GlassButton>}
              {(s.state === "connected" || s.state === "elsewhere") && <GlassButton onClick={onDisconnect} disabled={working}>Disconnect</GlassButton>}
              {working && <LoadingState label={busy === "disconnect" ? "Disconnecting" : "Connecting"} variant="Drive" />}
            </div>
          ) : (
            <Note tone="warn">Claude Code's command-line tool was not found on this Mac. Copy the command and run it in Terminal instead.</Note>
          )}

          {(!s.claudeFound || s.state !== "connected") && <CommandBox text={allowChanges ? s.command : s.commandReadOnly} onCopy={onCopy} />}
          <Note>Claude Code sessions that are already open pick this up the next time they start.</Note>
        </>
      )}
    </Card>
  );
}

// ── GitHub ──────────────────────────────────────────────────────────────────

function GithubCard({ g, onScan, onSignOut }: { g: GithubStatus | null; onScan: () => void; onSignOut: () => void }) {
  const chip: { tone: Tone; text: string } =
    !g ? { tone: "neutral", text: "Checking" }
    : g.signedIn ? { tone: "ok", text: g.login ? `Signed in as @${g.login}` : "Signed in" }
    : g.clientId ? { tone: "neutral", text: "Not signed in" }
    : { tone: "neutral", text: "Not set up" };
  return (
    <Card title="GitHub" chip={<Chip tone={chip.tone}>{chip.text}</Chip>}>
      <Note>
        Scans a repository's issues, pull requests, milestones and README for tasks, and keeps a project connected to its repository. Wagonwheel only reads from GitHub; the sign-in is kept in your Keychain.
      </Note>
      <div className="flex flex-wrap items-center gap-2">
        <GlassButton onClick={onScan}>{g?.signedIn ? "Scan GitHub for tasks…" : "Set up GitHub…"}</GlassButton>
        {g?.signedIn && <GlassButton tone="ghost" onClick={onSignOut}>Sign out</GlassButton>}
      </div>
    </Card>
  );
}

// ── iCloud Mail ─────────────────────────────────────────────────────────────

function IcloudCard({ s, busy, check, onCheck, onCopy }: {
  s: ConnectorsStatus["icloud"]; busy: string | null; check: IcloudCheck | null;
  onCheck: () => void; onCopy: (text: string, what: string) => void;
}) {
  const ready = s.installed && s.registered && s.passwordStored === true;
  const chip: { tone: Tone; text: string } =
    ready ? { tone: "ok", text: "Ready" }
    : s.installed && s.registered ? { tone: "warn", text: "Needs an app password" }
    : s.installed ? { tone: "neutral", text: "Not registered" }
    : { tone: "neutral", text: "Not installed" };

  return (
    <Card title="iCloud Mail, for Claude Code" chip={<Chip tone={chip.tone}>{chip.text}</Chip>}>
      <Note>
        Lets Claude Code search and read your iCloud mail and save drafts. It cannot send, move or delete anything. This one is not part of Wagonwheel: it lives in <code className="font-mono text-[12px]">~/.claude/connectors/icloud-mail</code> and is used by Claude Code on its own.
      </Note>

      <ul className="flex flex-col gap-1.5" aria-label="iCloud Mail setup">
        <Step done={s.installed}>Connector installed on this Mac</Step>
        <Step done={s.registered}>Registered with Claude Code{s.address ? <> for <span className="font-mono text-[12.5px]">{s.address}</span></> : null}</Step>
        <Step done={s.passwordStored}>App-specific password in your Keychain</Step>
      </ul>

      {s.installed && !s.registered && (
        <>
          <Note>Register it with Claude Code, using your own iCloud address:</Note>
          <CommandBox text="claude mcp add icloud-mail --scope user -e ICLOUD_MAIL_ADDRESS=you@icloud.com -- bash ~/.claude/connectors/icloud-mail/run.sh" onCopy={() => onCopy("claude mcp add icloud-mail --scope user -e ICLOUD_MAIL_ADDRESS=you@icloud.com -- bash ~/.claude/connectors/icloud-mail/run.sh", "Command")} />
        </>
      )}

      {s.registered && s.passwordStored === false && s.storeCommand && (
        <>
          <Note>
            Create an app-specific password at{" "}
            <a href="https://account.apple.com" target="_blank" rel="noreferrer" className={`${linkClass} inline-flex items-center gap-0.5`}>account.apple.com<ExternalLink size={11} /></a>{" "}
            (Sign-In and Security, then App-Specific Passwords), then run this in Terminal. It asks for the password and does not show it, so it never passes through this app:
          </Note>
          <CommandBox text={s.storeCommand} onCopy={() => onCopy(s.storeCommand as string, "Command")} />
          <Note>Then press Refresh.</Note>
        </>
      )}

      {ready && (
        <div className="flex flex-wrap items-center gap-2">
          <GlassButton onClick={onCheck} disabled={busy === "check"}>Check sign-in</GlassButton>
          {busy === "check" && <LoadingState label="Signing in to iCloud" variant="Orbit" />}
        </div>
      )}
      {check && (
        <pre
          role="status" aria-label="Sign-in check"
          className={cn("select-text overflow-x-auto whitespace-pre-wrap rounded-lg border p-2.5 font-mono text-[12px] leading-snug", check.ok ? "border-ok/25 bg-ok/10 text-ink-2" : "border-danger/30 bg-danger/10 text-danger")}
        >{check.output}</pre>
      )}
    </Card>
  );
}
