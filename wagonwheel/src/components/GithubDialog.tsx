import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ExternalLink, Lock, LogOut, Search } from "lucide-react";
import { notify } from "@nucleus/ui/lib/toast";
import type { Project, Snapshot } from "@shared/types";
import type { GithubDeviceCode, GithubProposal, GithubRepo, GithubScan, GithubStatus, ProposalKind } from "@shared/github";
import { useData } from "@/lib/store";
import { useUi, type GithubDialogState } from "@/lib/ui-state";
import { bridge, messageOf } from "@/lib/bridge";
import { isImported, milestoneInputFor, newProjectFor, parseRepoRef, projectForRepo, repoShortName, summary, taskInputFor } from "@/lib/github";
import { Chip, Field, FormError, Modal, PriorityMark, type Tone } from "./kit";
import { GlassButton } from "./GlassButton";
import { LoadingState } from "./LoadingState";

// The GitHub dialog. It opens three ways:
//   scan          pick any repositories, review what the scan suggests, add what you tick
//   connect       pick the one repository that belongs to a project (and optionally scan it at once)
//   scan-project  scan the repository a project is already connected to, with no picking
// Each signs in first if it has to. Every GitHub call is made by the main process; this window only shows the result.

type Step = "loading" | "setup" | "connect" | "waiting" | "pick" | "scanning" | "review";

interface RepoResult { fullName: string; scan: GithubScan | null; error: string | null }

const KIND_LABEL: Record<ProposalKind, string> = { issue: "Issue", pull_request: "Pull request", milestone: "Milestone", roadmap: "Roadmap" };
const KIND_TONE: Record<ProposalKind, Tone> = { issue: "neutral", pull_request: "crimson", milestone: "warn", roadmap: "neutral" };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
const linkClass = "text-crimson-text underline underline-offset-2 hover:text-white";

export function GithubDialog({ state }: { state: GithubDialogState }) {
  const { closeGithub, go } = useUi();
  const { snapshot, act } = useData();

  const mode = state.mode;
  const projectId = state.mode === "scan" ? null : state.projectId;
  const project = projectId ? snapshot.projects.find((p) => p.id === projectId) : undefined;

  const [step, setStep] = useState<Step>("loading");
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [clientId, setClientId] = useState("");
  const [includePrivate, setIncludePrivate] = useState(true);
  const [code, setCode] = useState<GithubDeviceCode | null>(null);

  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [results, setResults] = useState<RepoResult[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  /** False once the dialog is gone; a sign-in or scan still in flight then drops its answer. */
  const alive = useRef(true);
  /** Bumped to cancel a sign-in or a scan that is waiting on GitHub. */
  const run = useRef(0);
  const stopRuns = useCallback(() => { run.current++; }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stopRuns(); };
  }, [stopRuns]);

  // A project that goes away (deleted elsewhere) takes its dialog with it.
  useEffect(() => { if (projectId && !project) closeGithub(); }, [projectId, project, closeGithub]);

  const loadRepos = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await bridge().githubListRepos();
      if (!alive.current) return;
      setRepos([...list.filter((r) => !r.archived), ...list.filter((r) => r.archived)]);
      setStep("pick");
    } catch (err) {
      if (!alive.current) return;
      setError(messageOf(err));
      // A sign-in GitHub rejected has already been forgotten, so ask where that leaves us.
      const s = await bridge().githubStatus().catch(() => null);
      if (!alive.current) return;
      if (s) setStatus(s);
      setStep(!s || !s.clientId ? "setup" : s.signedIn ? "pick" : "connect");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);

  // ── Scan ──────────────────────────────────────────────────────────────────

  /** Read each repository and open the review. `projects` is what to match them against: the workspace's
   *  projects, or a copy with a connection that has only just been made. */
  const scanRepos = async (names: string[], projects: Project[] = snapshot.projects) => {
    if (names.length === 0) return;
    const mine = ++run.current;
    setError(null);
    setStep("scanning");
    setProgress({ done: 0, total: names.length, current: names[0] });
    const out: RepoResult[] = [];
    for (const [i, fullName] of names.entries()) {
      setProgress({ done: i, total: names.length, current: fullName });
      try {
        out.push({ fullName, scan: await bridge().githubScanRepo(fullName), error: null });
      } catch (err) {
        out.push({ fullName, scan: null, error: messageOf(err) });
      }
      if (!alive.current || run.current !== mine) return;
    }
    // Everything the workspace does not have yet starts ticked; what it has is left out.
    const fresh = new Set<string>();
    for (const r of out) {
      if (!r.scan) continue;
      const matched = projectForRepo(r.scan.repo, projects)?.id;
      for (const p of r.scan.proposals) if (!isImported(p, matched, snapshot.tasks, snapshot.milestones)) fresh.add(p.id);
    }
    setResults(out);
    setTicked(fresh);
    setStep("review");
  };

  /** What to do once there is a sign-in: scan the project's repository, or list repositories to pick from. */
  const proceed = async (): Promise<void> => {
    if (mode === "scan-project") {
      if (project?.githubRepo) await scanRepos([project.githubRepo]);
      else closeGithub();
    } else {
      await loadRepos();
    }
  };
  // The sign-in and status checks below run long after this render; they call the newest `proceed`.
  const proceedRef = useRef(proceed);
  useEffect(() => { proceedRef.current = proceed; });

  useEffect(() => {
    void (async () => {
      try {
        const s = await bridge().githubStatus();
        if (!alive.current) return;
        setStatus(s);
        setClientId(s.clientId ?? "");
        if (!s.clientId) setStep("setup");
        else if (!s.signedIn) setStep("connect");
        else await proceedRef.current();
      } catch (err) {
        if (!alive.current) return;
        setError(messageOf(err));
        setStep("setup");
      }
    })();
  }, []);

  // ── Setup and sign-in ─────────────────────────────────────────────────────

  const saveClientId = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await bridge().githubSetClientId(clientId);
      setStatus(s);
      setRepos(null);
      if (s.signedIn) await proceed(); else setStep("connect");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const mine = ++run.current;
    const current = (): boolean => alive.current && run.current === mine;
    try {
      const c = await bridge().githubStartSignIn(includePrivate);
      if (!current()) return;
      setCode(c);
      setStep("waiting");
      setBusy(false);
      let wait = c.intervalSeconds;
      for (;;) {
        await sleep(wait * 1000);
        if (!current()) return;
        const r = await bridge().githubPollSignIn();
        if (!current()) return;
        if (r.state === "pending") { wait = r.intervalSeconds; continue; }
        setCode(null);
        if (r.state === "done") { setStatus(r.status); await proceedRef.current(); return; }
        setStep("connect");
        setError(r.state === "denied" ? "You declined the sign-in on GitHub." : "The code expired before it was used. Start again.");
        return;
      }
    } catch (err) {
      if (!current()) return;
      setCode(null);
      setStep("connect");
      setError(messageOf(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const cancelSignIn = () => { stopRuns(); setCode(null); setError(null); setStep("connect"); };

  const signOut = async () => {
    try {
      setStatus(await bridge().githubSignOut());
      setRepos(null);
      setPicked(new Set());
      setStep("connect");
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const copyCode = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code.userCode); notify("Code copied.", { ttl: 3000 }); } catch { /* the code is on screen */ }
  };

  const cancelScan = () => { stopRuns(); if (mode === "scan") setStep("pick"); else closeGithub(); };

  // ── Connect a repository to a project ─────────────────────────────────────

  /** Repositories already connected to a different project, by lower-case name, so they cannot be taken twice. */
  const takenBy = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of snapshot.projects) if (p.githubRepo && p.id !== projectId) m.set(p.githubRepo.toLowerCase(), p.name);
    return m;
  }, [snapshot.projects, projectId]);

  // Until the person chooses, offer the repository named like the project, when there is exactly one and it is free.
  const suggested = useMemo(() => {
    if (mode !== "connect" || !project || !repos) return null;
    const name = project.name.trim().toLowerCase();
    const same = repos.filter((r) => repoShortName(r.fullName).toLowerCase() === name && !takenBy.has(r.fullName.toLowerCase()));
    return same.length === 1 ? same[0].fullName : null;
  }, [mode, project, repos, takenBy]);
  const pickedNow = useMemo(() => (picked.size === 0 && suggested ? new Set([suggested]) : picked), [picked, suggested]);

  const manualRepo = manual.trim() ? parseRepoRef(manual) : null;
  const chosen = manual.trim() ? manualRepo : ([...pickedNow][0] ?? null);
  const chosenTakenBy = chosen ? takenBy.get(chosen.toLowerCase()) : undefined;

  const connect = async (alsoScan: boolean) => {
    if (!project || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      await act.updateProject(project.id, { githubRepo: chosen });
    } catch (err) {
      setError(messageOf(err));   // for example: it is already connected to another project
      setBusy(false);
      return;
    }
    if (!alsoScan) {
      notify(`Connected to ${chosen}.`, { ttl: 6000 });
      closeGithub();
      return;
    }
    setBusy(false);
    await scanRepos([chosen], snapshot.projects.map((p) => (p.id === project.id ? { ...p, githubRepo: chosen } : p)));
  };

  // ── Add ───────────────────────────────────────────────────────────────────

  const apply = async () => {
    setBusy(true);
    setError(null);
    const counts = { tasks: 0, milestones: 0, projects: 0, failed: 0 };
    let only: string | null = null;
    for (const r of results) {
      if (!r.scan) continue;
      const chosenHere = r.scan.proposals.filter((p) => ticked.has(p.id));
      if (chosenHere.length === 0) continue;
      const found = projectForRepo(r.scan.repo, snapshot.projects);
      let target = found?.id;
      try {
        if (!target) target = await act.createProject(newProjectFor(r.scan.repo));   // made already connected to the repository
        // A project found by name or address is connected now, so the next scan goes straight to it.
        else if (found && !found.githubRepo) await act.updateProject(found.id, { githubRepo: r.scan.repo.fullName }).catch(() => undefined);
      } catch {
        counts.failed += chosenHere.length;
        continue;
      }
      for (const p of chosenHere) {
        try {
          if (p.asMilestone) { await act.createMilestone(milestoneInputFor(p, target)); counts.milestones++; }
          else { await act.createTask(taskInputFor(p, target)); counts.tasks++; }
        } catch {
          counts.failed++;
        }
      }
      counts.projects++;
      only = counts.projects === 1 ? target : null;
    }
    if (counts.tasks + counts.milestones === 0) {
      setBusy(false);
      setError("Nothing could be added. Try again, or add the items by hand.");
      return;
    }
    notify(summary(counts), { ttl: 9000 });
    closeGithub();
    if (only && mode === "scan") go({ name: "project", id: only });
  };

  const tickedCount = useMemo(() => results.reduce((n, r) => n + (r.scan?.proposals.filter((p) => ticked.has(p.id)).length ?? 0), 0), [results, ticked]);

  // ── Frame ─────────────────────────────────────────────────────────────────

  const forProject = project ? `“${project.name}”` : "this project";
  const description: Record<Step, string | undefined> = {
    loading: undefined,
    setup: "Connect your GitHub account, once.",
    connect: "Sign in so Wagonwheel can read your repositories.",
    waiting: undefined,
    pick: mode === "connect"
      ? `Choose the repository that belongs to ${forProject}.`
      : status?.login ? `Signed in as @${status.login}. Pick the repositories to scan.` : "Pick the repositories to scan.",
    scanning: undefined,
    review: mode === "scan" ? "Tick what you want in your workspace. Nothing is added until you press the button." : `Tick what you want in ${forProject}. Nothing is added until you press the button.`,
  };

  const footer = (() => {
    const cancel = <GlassButton key="cancel" tone="ghost" onClick={closeGithub}>Cancel</GlassButton>;
    switch (step) {
      case "setup": return <>{cancel}<GlassButton tone="primary" onClick={() => void saveClientId()} disabled={busy || !clientId.trim()}>Save Client ID</GlassButton></>;
      case "connect": return <>{cancel}<GlassButton tone="primary" onClick={() => void signIn()} disabled={busy}>Sign in with GitHub</GlassButton></>;
      case "waiting": return <GlassButton tone="ghost" onClick={cancelSignIn}>Cancel sign-in</GlassButton>;
      case "pick":
        if (mode === "connect") {
          const ok = !!chosen && !chosenTakenBy && !busy;
          return <>{cancel}<GlassButton onClick={() => void connect(false)} disabled={!ok}>Connect only</GlassButton><GlassButton tone="primary" onClick={() => void connect(true)} disabled={!ok}>Connect and scan</GlassButton></>;
        }
        return <>{cancel}<GlassButton tone="primary" onClick={() => void scanRepos([...picked])} disabled={picked.size === 0}>{picked.size === 0 ? "Scan" : `Scan ${picked.size} ${picked.size === 1 ? "repository" : "repositories"}`}</GlassButton></>;
      case "scanning": return <GlassButton tone="ghost" onClick={cancelScan}>Cancel</GlassButton>;
      case "review": return <>{mode === "scan" && <GlassButton tone="ghost" className="mr-auto" onClick={() => setStep("pick")} disabled={busy}>Back</GlassButton>}{cancel}<GlassButton tone="primary" onClick={() => void apply()} disabled={busy || tickedCount === 0}>{tickedCount === 0 ? "Add to workspace" : `Add ${tickedCount} to workspace`}</GlassButton></>;
      default: return undefined;
    }
  })();

  return (
    <Modal open onOpenChange={(o) => { if (!o) closeGithub(); }} title={mode === "connect" ? "Connect a repository" : "Scan GitHub for tasks"} description={description[step]} width={700} footer={footer}>
      <div className="flex flex-col gap-4 pb-1">
        {step === "loading" && (
          <div className="grid place-items-center py-10"><LoadingState label="Checking GitHub" variant="Dots" /></div>
        )}

        {step === "setup" && (
          <>
            <p className="text-[14px] leading-relaxed text-ink-2">
              Wagonwheel signs in with a GitHub OAuth app that you own, so nothing is shared with anyone else. You make it once, in about a minute:
            </p>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-ink-2 marker:text-ink-3">
              <li>Open <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer" className={linkClass}>New OAuth App</a> on GitHub.</li>
              <li>Name it <b className="text-foreground">Nucleus Wagonwheel</b>. Set the homepage URL to <code className="rounded bg-white/10 px-1">https://github.com</code> and the callback URL to <code className="rounded bg-white/10 px-1">http://localhost</code> (it is never used).</li>
              <li>Tick <b className="text-foreground">Enable Device Flow</b>, then <b className="text-foreground">Register application</b>.</li>
              <li>Copy the <b className="text-foreground">Client ID</b> from the next page (it is not a secret) and paste it here.</li>
            </ol>
            <Field label="Client ID">
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && clientId.trim()) void saveClientId(); }}
                placeholder="Ov23li…"
                autoFocus
                spellCheck={false}
                className="ww-field font-mono"
              />
            </Field>
            <FormError message={error} />
          </>
        )}

        {step === "connect" && (
          <>
            <p className="text-[14px] leading-relaxed text-ink-2">
              GitHub will open in your browser and show a short code to type there. Wagonwheel only reads: it never changes anything on GitHub.
            </p>
            <label className="flex items-start gap-2.5 text-[14px]">
              <input type="checkbox" checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} className="mt-0.5 size-4 accent-[#c62845]" />
              <span>
                Include my private repositories
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">GitHub calls this "repo" access, because it has no read-only version for private code. Untick it to see public repositories only.</span>
              </span>
            </label>
            <p className="text-[12.5px] text-ink-3">
              OAuth app Client ID <span className="font-mono">{status?.clientId}</span>{" "}
              <button type="button" className={linkClass} onClick={() => { setError(null); setStep("setup"); }}>Change</button>
            </p>
            {status && !status.canKeepSignIn && <p className="text-[12.5px] text-warn">This Mac cannot keep a password safely, so the sign-in will last until you quit the app.</p>}
            <FormError message={error} />
          </>
        )}

        {step === "waiting" && code && (
          <div className="flex flex-col items-center gap-3 py-3 text-center">
            <p className="text-[14px] text-ink-2">GitHub is open in your browser. Type this code there:</p>
            <div aria-label="Sign-in code" className="rounded-xl border border-white/10 bg-black/30 px-6 py-3 font-mono text-[30px] font-semibold tracking-[0.18em]">{code.userCode}</div>
            <div className="flex items-center gap-3">
              <GlassButton onClick={() => void copyCode()}>Copy code</GlassButton>
              <a href={code.verificationUri} target="_blank" rel="noreferrer" className={`${linkClass} inline-flex items-center gap-1 text-[13.5px]`}>Open GitHub again <ExternalLink size={13} /></a>
            </div>
            <div className="mt-2"><LoadingState label="Waiting for you to approve it" variant="Drive" /></div>
          </div>
        )}

        {step === "pick" && (
          <PickStep
            single={mode === "connect"}
            repos={repos} picked={pickedNow} setPicked={setPicked} takenBy={takenBy}
            manual={manual} setManual={setManual} manualRepo={manualRepo} chosenTakenBy={chosenTakenBy}
            status={status} busy={busy} error={error} onReload={() => void loadRepos()} onSignOut={() => void signOut()}
          />
        )}

        {step === "scanning" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <LoadingState label={`Reading ${progress.current}`} variant="Orbit" />
            <p className="text-[12.5px] text-ink-3">{progress.done + 1} of {progress.total}: issues, pull requests, milestones and roadmap notes</p>
          </div>
        )}

        {step === "review" && (
          <ReviewStep results={results} ticked={ticked} setTicked={setTicked} snapshot={snapshot} error={error} />
        )}
      </div>
    </Modal>
  );
}

// ── Pick repositories ───────────────────────────────────────────────────────

function PickStep({ single, repos, picked, setPicked, takenBy, manual, setManual, manualRepo, chosenTakenBy, status, busy, error, onReload, onSignOut }: {
  /** One repository (connecting to a project) rather than several (scanning). */
  single: boolean;
  repos: GithubRepo[] | null;
  picked: Set<string>;
  setPicked: Dispatch<SetStateAction<Set<string>>>;
  /** Repositories already connected to a project (lower-case name -> project name). Only used when single. */
  takenBy: Map<string, string>;
  manual: string;
  setManual: (text: string) => void;
  manualRepo: string | null;
  chosenTakenBy: string | undefined;
  status: GithubStatus | null;
  busy: boolean;
  error: string | null;
  onReload: () => void;
  onSignOut: () => void;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (repos ?? []).filter((r) => !q || r.fullName.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  }, [repos, filter]);

  const choose = (name: string) => {
    setManual("");
    setPicked((prev) => {
      if (single) return new Set([name]);
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search your repositories" aria-label="Search your repositories" className="ww-field !pl-8" />
        </div>
        {!single && picked.size > 0 && <GlassButton tone="ghost" onClick={() => setPicked(new Set())}>Clear</GlassButton>}
        <GlassButton tone="ghost" onClick={onSignOut} title={status?.login ? `Sign out @${status.login}` : "Sign out"}><LogOut size={14} />Sign out</GlassButton>
      </div>

      <FormError message={error} />
      {!repos && !error && <p className="py-6 text-center text-[14px] text-ink-3">Loading your repositories…</p>}
      {!repos && error && <div className="flex justify-center"><GlassButton onClick={onReload} disabled={busy}>Try again</GlassButton></div>}
      {repos && repos.length === 0 && <p className="py-6 text-center text-[14px] text-ink-3">GitHub did not list any repositories for this account.</p>}
      {repos && repos.length > 0 && shown.length === 0 && <p className="py-6 text-center text-[14px] text-ink-3">No repository matches "{filter}".</p>}

      {shown.length > 0 && (
        <ul className="-mx-1 flex max-h-[360px] flex-col gap-0.5 overflow-y-auto px-1" aria-label="Repositories">
          {shown.map((r) => {
            const owner = single ? takenBy.get(r.fullName.toLowerCase()) : undefined;
            return (
              <li key={r.fullName}>
                <label className={`ww-row flex items-start gap-3 rounded-lg px-2.5 py-2 ${owner ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}>
                  <input
                    type={single ? "radio" : "checkbox"} name={single ? "repository" : undefined}
                    checked={!manual.trim() && picked.has(r.fullName)} disabled={!!owner}
                    onChange={() => choose(r.fullName)} aria-label={r.fullName}
                    className="mt-1 size-4 shrink-0 accent-[#c62845]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold">{r.fullName}</span>
                      {r.private && <Chip><Lock size={10} />Private</Chip>}
                      {r.archived && <Chip tone="warn">Archived</Chip>}
                      {r.fork && <Chip>Fork</Chip>}
                      {owner && <Chip tone="ok">Connected to “{owner}”</Chip>}
                    </span>
                    {r.description && <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{r.description}</span>}
                  </span>
                  <span className="shrink-0 pt-0.5 text-[12px] text-ink-3">{r.openIssues} open</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {single && (
        <Field label="Or paste a repository" hint={manual.trim() ? (manualRepo ? (chosenTakenBy ? undefined : `Will connect ${manualRepo}.`) : undefined) : "A repository that is not in the list above, as owner/name or a github.com address."}>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="owner/name" aria-label="Repository as owner/name or a GitHub address" spellCheck={false} className="ww-field font-mono" />
          {manual.trim() && !manualRepo && <span role="alert" className="mt-1 block text-[12px] text-danger">That is not a repository: use owner/name or a github.com address.</span>}
          {manual.trim() && manualRepo && chosenTakenBy && <span role="alert" className="mt-1 block text-[12px] text-danger">{manualRepo} is already connected to “{chosenTakenBy}”.</span>}
        </Field>
      )}
    </>
  );
}

// ── Review ──────────────────────────────────────────────────────────────────

function ReviewStep({ results, ticked, setTicked, snapshot, error }: {
  results: RepoResult[];
  ticked: Set<string>;
  setTicked: Dispatch<SetStateAction<Set<string>>>;
  snapshot: Snapshot;
  error: string | null;
}) {
  const toggle = (id: string) => setTicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const setMany = (ids: string[], on: boolean) => setTicked((prev) => { const next = new Set(prev); for (const id of ids) { if (on) next.add(id); else next.delete(id); } return next; });

  const withScan = results.filter((r) => r.scan);
  const nothingAnywhere = withScan.length > 0 && withScan.every((r) => r.scan?.proposals.length === 0);

  return (
    <>
      <FormError message={error} />
      {results.filter((r) => r.error).map((r) => (
        <p key={r.fullName} role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"><b>{r.fullName}:</b> {r.error}</p>
      ))}
      {nothingAnywhere && <p className="py-4 text-center text-[14px] text-ink-3">Nothing to suggest: no open issues, pull requests, milestones or roadmap items were found.</p>}

      {withScan.map((r) => {
        const scan = r.scan as GithubScan;
        const project = projectForRepo(scan.repo, snapshot.projects);
        const rows = scan.proposals.map((p) => ({ p, imported: isImported(p, project?.id, snapshot.tasks, snapshot.milestones) }));
        const selectable = rows.filter((x) => !x.imported).map((x) => x.p.id);
        const on = selectable.filter((id) => ticked.has(id)).length;
        return (
          <section key={scan.repo.fullName} aria-label={scan.repo.fullName} className="rounded-xl border border-white/[0.07] bg-black/15 p-3">
            <header className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-[14.5px] font-semibold">{scan.repo.fullName}</h3>
              <a href={scan.repo.url} target="_blank" rel="noreferrer" aria-label={`Open ${scan.repo.fullName} on GitHub`} className="text-ink-3 hover:text-foreground"><ExternalLink size={13} /></a>
              <span className="text-[12.5px] text-ink-3">{project ? <>Adds to “{project.name}”</> : <>New project “{repoShortName(scan.repo.fullName)}”</>}</span>
              {selectable.length > 0 && (
                <span className="ml-auto flex items-center gap-1 text-[12.5px] text-ink-3">
                  {on} of {selectable.length}
                  <button type="button" className={linkClass} onClick={() => setMany(selectable, true)}>All</button>
                  <button type="button" className={linkClass} onClick={() => setMany(selectable, false)}>None</button>
                </span>
              )}
            </header>

            {rows.length === 0 && <p className="px-1 py-2 text-[13px] text-ink-3">Nothing to suggest from this repository.</p>}
            {rows.length > 0 && (
              <ul className="flex flex-col">
                {rows.map(({ p, imported }) => <ProposalRow key={p.id} p={p} imported={imported} checked={ticked.has(p.id)} onToggle={() => toggle(p.id)} />)}
              </ul>
            )}
            {scan.notes.map((n) => <p key={n} className="mt-2 px-1 text-[12.5px] text-ink-3">{n}</p>)}
          </section>
        );
      })}
    </>
  );
}

function ProposalRow({ p, imported, checked, onToggle }: { p: GithubProposal; imported: boolean; checked: boolean; onToggle: () => void }) {
  // The first lines of the description, without the "From GitHub:" link line every one ends with.
  const preview = p.description.split("\n\nFrom GitHub:")[0].replace(/\s+/g, " ").trim();
  return (
    <li>
      <label className={`ww-row flex items-start gap-3 rounded-lg px-2 py-1.5 ${imported ? "cursor-default opacity-60" : "cursor-pointer"}`}>
        <input type="checkbox" checked={checked && !imported} disabled={imported} onChange={onToggle} aria-label={p.title} className="mt-1 size-4 shrink-0 accent-[#c62845]" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Chip tone={KIND_TONE[p.kind]}>{KIND_LABEL[p.kind]}</Chip>
            <span className="min-w-0 break-words text-[14px] font-medium">{p.title}</span>
            {imported && <Chip tone="ok">Already added</Chip>}
          </span>
          {preview && <span className="mt-0.5 line-clamp-1 block text-[12.5px] text-ink-3">{preview}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 pt-0.5 text-[12px] text-ink-3">
          {p.dueDate && <span>{p.dueDate}</span>}
          {!p.asMilestone && <PriorityMark priority={p.priority} />}
          <a href={p.url} target="_blank" rel="noreferrer" aria-label={`Open “${p.title}” on GitHub`} onClick={(e) => e.stopPropagation()} className="hover:text-foreground"><ExternalLink size={13} /></a>
        </span>
      </label>
    </li>
  );
}
