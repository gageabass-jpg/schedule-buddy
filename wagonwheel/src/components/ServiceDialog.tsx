import { useEffect, useMemo, useState, type FormEvent } from "react";
import { KeyRound, Unplug } from "lucide-react";
import { TrashIcon } from "@nucleus/ui/ui/trash";
import {
  SERVICE_KINDS, SERVICE_KIND_LABEL, SERVICE_PROVIDERS, SERVICE_PROVIDER_LABEL,
  type ServiceKind, type ServiceProvider,
} from "@shared/types";
import type { ProviderStatus, ServicesStatus } from "@shared/services";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { bridge, messageOf } from "@/lib/bridge";
import { dollars, dollarsField, monthName, parseDollars, SERVICE_PRESETS } from "@/lib/services";
import { cn } from "@nucleus/ui/lib/utils";
import { Field, FormError, IconButton, Modal } from "./kit";
import { GlassButton } from "./GlassButton";

/** Add a service, or change one: what it is, what it usually costs, when it bills, and where the bill can be read. */
export function ServiceDialog() {
  const { snapshot, act, attemptOk } = useData();
  const { serviceDialog, closeService, confirm } = useUi();
  const existing = serviceDialog?.id ? snapshot.services.find((s) => s.id === serviceDialog.id) : undefined;

  const [name, setName] = useState(existing?.name ?? "");
  const [plan, setPlan] = useState(existing?.plan ?? "");
  const [kind, setKind] = useState<ServiceKind>(existing?.kind ?? "flat");
  const [amount, setAmount] = useState(existing ? dollarsField(existing.amountCents) : "");
  const [billingDay, setBillingDay] = useState(existing?.billingDay ? String(existing.billingDay) : "");
  const [billingUrl, setBillingUrl] = useState(existing?.billingUrl ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [cancelled, setCancelled] = useState(existing?.status === "cancelled");
  const [provider, setProvider] = useState<ServiceProvider | null>(existing?.provider ?? null);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (serviceDialog?.id && !existing) closeService(); }, [serviceDialog, existing, closeService]);

  const history = useMemo(
    () => (existing ? snapshot.serviceCharges.filter((c) => c.serviceId === existing.id).sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 6) : []),
    [snapshot.serviceCharges, existing],
  );

  const applyPreset = (key: string) => {
    const p = SERVICE_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setName(p.name);
    setKind(p.kind);
    setBillingUrl(p.billingUrl);
    setProvider(p.provider);
    setHint(p.hint);
  };

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const cents = amount.trim() === "" ? 0 : parseDollars(amount);
    if (cents == null) { setError("The usual monthly fee must be an amount, like 25 or 12.50."); return; }
    const day = billingDay.trim() === "" ? null : Number(billingDay);
    setBusy(true);
    try {
      const fields = { name, plan, kind, amountCents: cents, billingDay: day, billingUrl: billingUrl.trim() || null, notes, provider, status: cancelled ? ("cancelled" as const) : ("active" as const) };
      if (existing) await act.updateService(existing.id, fields);
      else await act.createService(fields);
      closeService();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: "Delete this service?",
      body: `"${existing.name}" and every bill recorded for it will be deleted. This cannot be undone. If you only stopped paying for it, mark it cancelled instead and keep the history.`,
      confirmLabel: "Delete service",
      danger: true,
    });
    if (!ok) return;
    if (await attemptOk(() => act.deleteService(existing.id))) closeService();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) closeService(); }}
      title={existing ? "Edit service" : "Add a service"}
      description={existing ? undefined : "What you pay for each month."}
      width={560}
      footer={<>
        {existing && <GlassButton tone="danger" className="mr-auto" onClick={() => void remove()}><TrashIcon size={14} />Delete</GlassButton>}
        <GlassButton tone="ghost" onClick={closeService}>Cancel</GlassButton>
        <GlassButton tone="primary" onClick={() => void save()} disabled={busy || !name.trim()}>{existing ? "Save" : "Add service"}</GlassButton>
      </>}
    >
      <form onSubmit={save} className="flex flex-col gap-4 pb-1">
        {!existing && (
          <div>
            <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-3">Start from</span>
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className={cn("rounded-full border px-3 py-1 text-[13px] font-medium transition-colors", name === p.name ? "border-crimson/60 bg-crimson/20 text-foreground" : "border-white/10 bg-white/[0.06] text-ink-2 hover:bg-white/10 hover:text-foreground")}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {hint && <p className="mt-2 text-[12.5px] text-ink-3">{hint}</p>}
          </div>
        )}

        <div className="grid grid-cols-[1fr_180px] gap-3">
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Supabase" autoFocus maxLength={120} className="ww-field !min-h-10 !text-[15px]" /></Field>
          <Field label="Plan (optional)"><input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Pro" maxLength={120} className="ww-field !min-h-10" /></Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Type">
            <select value={kind} onChange={(e) => setKind(e.target.value as ServiceKind)} className="ww-field">
              {SERVICE_KINDS.map((k) => <option key={k} value={k}>{SERVICE_KIND_LABEL[k]}</option>)}
            </select>
          </Field>
          <Field label="Usual monthly fee ($)"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 25" className="ww-field" /></Field>
          <Field label="Billing day"><input value={billingDay} onChange={(e) => setBillingDay(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="1–31" className="ww-field" /></Field>
        </div>
        <p className="-mt-2 text-[12.5px] leading-snug text-ink-3">
          {kind === "usage"
            ? "Usage-based bills move with use. Set the usual fee to what you expect, and Wagonwheel will warn you when a month comes in well above it."
            : "A flat fee is the same every month. Set it, and Wagonwheel will warn you if a bill ever differs."}
        </p>

        <Field label="Billing page" hint="Where the bill lives. Must start with https://">
          <input value={billingUrl} onChange={(e) => setBillingUrl(e.target.value)} placeholder="https://…" className="ww-field" />
        </Field>

        <Field label="Check usage automatically" hint="Only a service named like Vercel can check its usage on Vercel. This reports usage beyond the plan; the bills themselves are typed in from the invoices.">
          <select value={provider ?? ""} onChange={(e) => setProvider((e.target.value || null) as ServiceProvider | null)} className="ww-field">
            <option value="">No, I will type it in</option>
            {SERVICE_PROVIDERS.map((p) => (
              <option key={p} value={p} disabled={!name.toLowerCase().includes(SERVICE_PROVIDER_LABEL[p].toLowerCase())}>{SERVICE_PROVIDER_LABEL[p]}</option>
            ))}
          </select>
        </Field>
        {provider && <ProviderBlock provider={provider} />}

        <Field label="Notes (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. Seats, what it is for, who to ask" className="ww-field" /></Field>

        {existing && (
          <label className="flex items-center gap-2.5 text-[14px]">
            <input type="checkbox" checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} className="size-4 accent-[#c62845]" />
            I have cancelled this service <span className="text-ink-3">(keeps its bills as history; a month with no bill stops counting it)</span>
          </label>
        )}

        {existing && history.length > 0 && (
          <div>
            <span className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-3">Recorded bills</span>
            <ul className="glass-inset flex flex-col p-1" style={{ ["--ww-r" as string]: "12px" }}>
              {history.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-[13.5px]">
                  <span className="w-[120px] text-ink-2">{monthName(c.month)}</span>
                  <span className="flex-1 font-medium">{dollars(c.amountCents)}</span>
                  <span className="text-[12px] text-ink-3">{c.source === "manual" ? "typed in" : `read from ${SERVICE_PROVIDER_LABEL[c.source]}`}</span>
                  <GlassButton
                    className={cn("!h-6 !px-2 !text-[11.5px]", !c.paid && "border-danger/40 text-danger")}
                    onClick={() => void attemptOk(() => act.setServiceCharge({ serviceId: c.serviceId, month: c.month, amountCents: c.amountCents, paid: !c.paid }))}
                    title={c.paid ? "Mark this bill as unpaid (owed)" : "Mark this bill as paid"}
                    aria-label={c.paid ? `${monthName(c.month)}'s bill is paid: mark it unpaid` : `${monthName(c.month)}'s bill is unpaid: mark it paid`}
                  >
                    {c.paid ? "Paid" : "Unpaid"}
                  </GlassButton>
                  <IconButton label={`Delete ${monthName(c.month)}'s figure`} className="!size-7" onClick={() => void attemptOk(() => act.deleteServiceCharge(c.id))}><TrashIcon size={14} /></IconButton>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[12px] text-ink-3">To replace a figure, type a new one for that month on the Services screen.</p>
          </div>
        )}

        <FormError message={error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ── Connecting a provider ───────────────────────────────────────────────────

const TOKEN_PAGE: Record<ServiceProvider, string> = { vercel: "https://vercel.com/account/tokens" };

/** Connect (or disconnect) the token that reads a provider's bill. The token goes to the main process and
 *  into the Mac's keychain; this window never gets it back. */
function ProviderBlock({ provider }: { provider: ServiceProvider }) {
  const { attemptOk } = useData();
  const label = SERVICE_PROVIDER_LABEL[provider];
  const [status, setStatus] = useState<ServicesStatus | null>(null);
  const [token, setToken] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { bridge().servicesStatus().then(setStatus).catch((e) => setError(messageOf(e))); }, []);
  const mine: ProviderStatus | undefined = status?.providers.find((p) => p.provider === provider);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await bridge().servicesSetToken(provider, token, team));
      setToken("");
    } catch (err) {
      setError(messageOf(err));
    }
    setBusy(false);
  };

  const disconnect = async () => {
    setBusy(true);
    if (await attemptOk(async () => setStatus(await bridge().servicesClearToken(provider)))) setError(null);
    setBusy(false);
  };

  return (
    <div className="glass-inset flex flex-col gap-3 p-3.5" style={{ ["--ww-r" as string]: "14px" }}>
      {!status ? (
        <p className="text-[13px] text-ink-3">Checking…</p>
      ) : mine?.connected ? (
        <div className="flex items-center gap-3">
          <KeyRound size={16} className="shrink-0 text-ok" />
          <p className="min-w-0 flex-1 text-[13.5px] leading-snug">
            Connected to {label}{mine.teamId ? ` (team ${mine.teamId})` : " (your personal account)"}. Press <span className="font-semibold">Check usage</span> on the Services screen to see the usage {label} has billed beyond your plan, this month and last. It writes no bill and changes no figure.
          </p>
          <GlassButton className="!h-8 !text-[12.5px]" onClick={() => void disconnect()} disabled={busy}><Unplug size={13} />Disconnect</GlassButton>
        </div>
      ) : (
        <>
          <p className="text-[13px] leading-snug text-ink-2">
            To check usage, Wagonwheel needs a {label} token.{" "}
            <a href={TOKEN_PAGE[provider]} target="_blank" rel="noreferrer" className="font-medium text-foreground underline decoration-white/30 underline-offset-2 hover:decoration-white/70">Create one on {label}</a>
            , name it “Wagonwheel”, and paste it here. It is kept in your Mac’s keychain, never in the workspace file, and is only ever sent to {label}.
          </p>
          {status && !status.canKeepToken && <p className="text-[12.5px] text-warn">Your Mac’s keychain is not available, so the token would be kept only until the app closes.</p>}
          <div className="grid grid-cols-[1fr_170px] gap-2.5">
            {/* Enter here connects the token; it must not submit the service form around it. */}
            <input
              type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (token.trim() && !busy) void connect(); } }}
              placeholder={`${label} token`} aria-label={`${label} token`} className="ww-field"
            />
            <input
              autoComplete="off" spellCheck={false} value={team} onChange={(e) => setTeam(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (token.trim() && !busy) void connect(); } }}
              placeholder="Team id (optional)" aria-label={`${label} team id`} className="ww-field"
            />
          </div>
          <div className="flex items-center gap-3">
            <GlassButton className="!h-8 !text-[12.5px]" onClick={() => void connect()} disabled={busy || token.trim() === ""}><KeyRound size={13} />{busy ? "Checking…" : `Connect ${label}`}</GlassButton>
            <span className="text-[12px] text-ink-3">The token is tried on {label} before it is saved. Leave the team id blank for a personal account.</span>
          </div>
        </>
      )}
      <FormError message={error} />
    </div>
  );
}
