import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CreditCard, ExternalLink, Minus, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { notify } from "@nucleus/ui/lib/toast";
import { SERVICE_KIND_LABEL, SERVICE_PROVIDER_LABEL, type Service } from "@shared/types";
import { useData } from "@/lib/store";
import { useUi } from "@/lib/ui-state";
import { messageOf } from "@/lib/bridge";
import { formatShort } from "@/lib/dates";
import {
  dollars, flaggedServices, higherThanUsual, inDays, monthName, monthOf, monthOnly, monthTotals, nextBillDate, ordinal, owedNow, parseDollars,
  serviceMonth, shiftMonth, spentSoFar, yearlyEstimate, type ServiceMonth,
} from "@/lib/services";
import { Chip, EmptyState, IconButton, PageHeader, Section } from "@/components/kit";
import { GlassButton } from "@/components/GlassButton";
import { cn } from "@nucleus/ui/lib/utils";

/** What the workspace pays each month, service by service: Supabase, Vercel, GitHub, Google Workspace, Firebase…
 *  A figure is typed in from the invoice. Where a service has a usage API (Vercel), Check usage reports what was
 *  billed beyond the plan, without writing a bill. The point is to see a bill that
 *  is higher than usual, or one that is owed and unpaid, before it turns into a surprise. */
export function Services() {
  const { snapshot, today, act, attempt } = useData();
  const { newService, editService } = useUi();
  const [reading, setReading] = useState(false);
  const month = monthOf(today);
  const before = shiftMonth(month, -1);
  const { services, serviceCharges: charges } = snapshot;

  const now = useMemo(() => monthTotals(services, charges, month), [services, charges, month]);
  const last = useMemo(() => monthTotals(services, charges, before, month), [services, charges, before, month]);
  const flagged = useMemo(() => flaggedServices(services, charges, month), [services, charges, month]);
  const owed = useMemo(() => owedNow(services, charges), [services, charges]);
  const spent = useMemo(() => spentSoFar(services, charges), [services, charges]);
  const year = useMemo(() => yearlyEstimate(services, charges), [services, charges]);
  const active = useMemo(
    () => services.filter((s) => s.status === "active").map((s) => serviceMonth(s, charges, month)).sort((a, b) => b.amountCents - a.amountCents || a.service.name.localeCompare(b.service.name)),
    [services, charges, month],
  );
  const cancelled = useMemo(() => services.filter((s) => s.status === "cancelled"), [services]);
  const readable = active.filter((r) => r.service.provider);

  const readBills = async () => {
    setReading(true);
    const said: string[] = [];
    for (const r of readable) {
      try {
        said.push(`${r.service.name}: ${await act.checkUsage(r.service.id)}`);
      } catch (err) {
        said.push(`${r.service.name}: ${messageOf(err)}`);
      }
    }
    setReading(false);
    notify(said.join("  "), { ttl: 9000 });
  };

  const markPaid = (serviceId: string, bill: { month: string; amountCents: number }) =>
    attempt(() => act.setServiceCharge({ serviceId, month: bill.month, amountCents: bill.amountCents, paid: true }));

  const change = now.totalCents - last.totalCents;
  const subtitle = services.length === 0
    ? "Track what each service costs every month."
    : `${dollars(now.totalCents)} expected in ${monthOnly(month)} · ${active.length} ${active.length === 1 ? "service" : "services"}`;

  return (
    <>
      <PageHeader
        title="Services"
        subtitle={subtitle}
        actions={<>
          {readable.length > 0 && (
            <GlassButton onClick={() => void readBills()} disabled={reading} title="Check usage billed beyond the plan on the services that report it. Writes no bill.">
              <RefreshCw size={14} className={reading ? "animate-spin" : undefined} />{reading ? "Checking (a minute or so)…" : "Check usage"}
            </GlassButton>
          )}
          <GlassButton tone="primary" onClick={newService}><Plus size={15} />Add service</GlassButton>
        </>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {services.length === 0 ? (
          <EmptyState
            icon={<CreditCard size={20} />}
            title="No services yet"
            body="Add Supabase, Vercel, GitHub, Google Workspace or Firebase to see what they cost each month, and to catch a charge that jumps."
            action={<GlassButton tone="primary" onClick={newService}><Plus size={15} />Add your first service</GlassButton>}
          />
        ) : (
          <>
            {flagged.length > 0 && <Heads flagged={flagged} month={month} onOpen={editService} />}

            <div className="mb-3 grid grid-cols-3 gap-3 max-[1180px]:grid-cols-1">
              <Stat label={`${monthName(month)}`} value={dollars(now.totalCents)} note={now.estimatedCount > 0 ? `${now.estimatedCount} of ${now.rows.length} still at the usual fee` : "every bill recorded"} />
              <Stat label={monthName(before)} value={last.rows.length ? dollars(last.totalCents) : "—"} note={last.rows.length ? (last.estimatedCount > 0 ? `${last.estimatedCount} of ${last.rows.length} estimated` : "all recorded") : "nothing to compare"} />
              <Stat
                label="Change"
                value={last.rows.length ? `${change > 0 ? "+" : change < 0 ? "−" : ""}${dollars(Math.abs(change))}` : "—"}
                note={last.rows.length ? "from last month" : "needs a month of history"}
                icon={change > 0 ? <ArrowUpRight size={16} className="text-warn" /> : change < 0 ? <ArrowDownRight size={16} className="text-ok" /> : <Minus size={16} className="text-ink-3" />}
              />
            </div>
            <div className="mb-6 grid grid-cols-3 gap-3 max-[1180px]:grid-cols-1">
              <Stat
                label="Owed right now"
                value={dollars(owed.totalCents)}
                tone={owed.totalCents > 0 ? "warn" : undefined}
                note={owed.bills.length ? `${owed.bills.length} unpaid ${owed.bills.length === 1 ? "bill" : "bills"}, listed below` : "nothing unpaid"}
              />
              <Stat
                label="Spent so far"
                value={dollars(spent.totalCents)}
                note={spent.count ? `${spent.count} paid ${spent.count === 1 ? "bill" : "bills"} since ${monthName(spent.since as string)}` : "no paid bills recorded yet"}
              />
              <Stat
                label="A year of this"
                value={year.yearlyCents > 0 ? `~${dollars(year.yearlyCents)}` : "—"}
                note={year.yearlyCents > 0
                  ? `about ${dollars(year.monthlyCents)} a month${year.unknown.length ? `, not counting ${year.unknown.map((s) => s.name).join(", ")}` : ""}`
                  : "set a usual fee, or record a bill, to estimate"}
              />
            </div>

            {owed.bills.length > 0 && (
              <Section title="Owed" count={owed.bills.length} className="mb-6">
                <ul className="glass-card flex flex-col border border-warn/30 p-1.5">
                  {owed.bills.map((b) => (
                    <li key={b.charge.id} className="ww-row flex items-center gap-3 rounded-xl px-3 py-2.5">
                      <button type="button" onClick={() => editService(b.service.id)} className="min-w-0 flex-1 truncate text-left text-[14.5px] font-medium hover:underline decoration-white/30 underline-offset-2">{b.service.name}</button>
                      <span className="text-[12.5px] text-ink-3">{monthName(b.charge.month)}</span>
                      <span className="w-[84px] text-right font-display text-[16px] font-semibold">{dollars(b.charge.amountCents)}</span>
                      <GlassButton className="!h-8 !text-[12.5px]" onClick={() => void markPaid(b.service.id, b.charge)} title={`Mark ${b.service.name}'s ${monthName(b.charge.month)} bill as paid`}>Mark paid</GlassButton>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Active" count={active.length}>
              <ul className="ww-rise glass-card flex flex-col p-1.5">
                {active.map((r) => (
                  <ServiceRow
                    key={r.service.id}
                    row={r}
                    month={month}
                    today={today}
                    extra={higherThanUsual(r.service, charges, month)}
                    paidSoFar={spent.perService[r.service.id]}
                    onMarkPaid={markPaid}
                  />
                ))}
              </ul>
            </Section>

            {cancelled.length > 0 && (
              <Section title="Cancelled" count={cancelled.length} className="mt-6">
                <ul className="glass-card flex flex-col p-1.5 opacity-75">
                  {cancelled.map((s) => {
                    const lastCharge = [...charges].filter((c) => c.serviceId === s.id).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
                    return (
                      <li key={s.id} className="ww-row flex items-center gap-3 rounded-xl px-3 py-2.5">
                        <button type="button" onClick={() => editService(s.id)} className="min-w-0 flex-1 truncate text-left text-[14.5px] font-medium hover:underline decoration-white/30 underline-offset-2">{s.name}</button>
                        <span className="text-[12.5px] text-ink-3">{lastCharge ? `last charged ${dollars(lastCharge.amountCents)} in ${monthName(lastCharge.month)}` : "never charged"}</span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            <p className="mt-6 text-center text-[12.5px] leading-relaxed text-ink-3">
              Typed-in figures and the usual fee are yours to keep right. A bill recorded as unpaid counts as owed until you mark it paid; the yearly figure uses each service's usual fee, or the average of its last three bills. Check usage only reports usage billed beyond the plan, on services marked “checks usage on …”, and only when you press it. It never writes or changes a bill.
            </p>
          </>
        )}
      </div>
    </>
  );
}

/** A bill that is notably higher than usual, said plainly and first, with the service to open. */
function Heads({ flagged, month, onOpen }: { flagged: { service: Service; extraCents: number }[]; month: string; onOpen: (id: string) => void }) {
  return (
    <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border border-warn/30 bg-warn/10 px-4 py-3">
      <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 text-[14px] leading-snug">
        <p className="font-semibold text-warn">{flagged.length === 1 ? "A bill is higher than usual" : `${flagged.length} bills are higher than usual`} in {monthName(month)}</p>
        <p className="mt-0.5 text-ink-2">
          {flagged.map((f, i) => (
            <span key={f.service.id}>
              {i > 0 && ", "}
              <button type="button" onClick={() => onOpen(f.service.id)} className="font-medium text-foreground underline decoration-white/30 underline-offset-2 hover:decoration-white/70">{f.service.name}</button>
              {` (+${dollars(f.extraCents)})`}
            </span>
          ))}
          . Check each one's billing page, and cancel anything you did not mean to keep.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon?: React.ReactNode; tone?: "warn" }) {
  return (
    <div className={cn("glass-card flex flex-col gap-1 px-4 py-3.5", tone === "warn" && "border border-warn/40 bg-warn/10")}>
      <span className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <span className={cn("flex items-center gap-1.5 font-display text-[26px] font-semibold leading-tight tracking-tight", tone === "warn" && "text-warn")}>{icon}{value}</span>
      <span className="text-[12.5px] text-ink-3">{note}</span>
    </div>
  );
}

/** One service: what it is, what it costs this month, when it bills, how much has been paid in all, and a box to type this month's bill into. */
function ServiceRow({ row, month, today, extra, paidSoFar, onMarkPaid }: {
  row: ServiceMonth; month: string; today: string; extra: number | null;
  paidSoFar: { cents: number; count: number } | undefined;
  onMarkPaid: (serviceId: string, bill: { month: string; amountCents: number }) => unknown;
}) {
  const { act, attempt } = useData();
  const { editService } = useUi();
  const { service, charge, amountCents, estimated } = row;
  const [draft, setDraft] = useState("");
  const [unpaid, setUnpaid] = useState(false);
  const next = nextBillDate(service.billingDay, today);
  const owedThisMonth = charge !== null && !charge.paid;

  const record = async () => {
    const text = draft.trim();
    if (!text) return;
    const cents = parseDollars(text);
    if (cents == null) { notify("That is not an amount. Type it like 25 or 12.50.", { ttl: 5000 }); return; }
    const ok = await attempt(() => act.setServiceCharge({ serviceId: service.id, month, amountCents: cents, paid: !unpaid }));
    if (ok !== undefined) { setDraft(""); setUnpaid(false); }
  };

  return (
    <li className="ww-row flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-3 py-3">
      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => editService(service.id)} className="truncate text-left text-[15px] font-semibold hover:underline decoration-white/30 underline-offset-2">{service.name}</button>
          {service.plan && <span className="text-[13px] text-ink-3">{service.plan}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-3">
          <Chip tone={service.kind === "usage" ? "warn" : "neutral"} title={service.kind === "usage" ? "This bill moves with use, so it can surprise you" : "The same fee every month"}>{SERVICE_KIND_LABEL[service.kind]}</Chip>
          {service.provider && <Chip tone="ok" title="Wagonwheel can check this service's usage beyond the plan. Its bills are still typed in from the invoices.">checks usage on {SERVICE_PROVIDER_LABEL[service.provider]}</Chip>}
          {next && <span>bills on the {ordinal(service.billingDay as number)} · {inDays(next, today)} ({formatShort(next, today)})</span>}
        </div>
        {paidSoFar && <div className="mt-1 text-[12.5px] text-ink-3">{dollars(paidSoFar.cents)} paid so far · {paidSoFar.count} {paidSoFar.count === 1 ? "bill" : "bills"}</div>}
      </div>

      <div className="flex min-w-[150px] flex-col items-end text-right">
        <span className="font-display text-[19px] font-semibold leading-tight" title={estimated ? "No bill recorded yet: this is the usual fee" : charge?.source === "manual" ? "Typed in" : "Read from the service"}>
          {estimated ? (amountCents > 0 ? `~${dollars(amountCents)}` : "—") : dollars(amountCents)}
        </span>
        <span className="text-[12px] text-ink-3">{estimated ? (amountCents > 0 ? "usual fee, not yet billed" : "no fee set") : owedThisMonth ? "billed, not paid" : charge?.source === "manual" ? "recorded" : "read from the service"}</span>
        {owedThisMonth && (
          <span className="mt-1 flex items-center gap-1.5">
            <Chip tone="danger" title="Billed or charged, but not paid yet">Unpaid</Chip>
            <GlassButton className="!h-6 !px-2 !text-[11.5px]" onClick={() => void onMarkPaid(service.id, { month, amountCents })} title={`Mark ${service.name}'s ${monthName(month)} bill as paid`}>Mark paid</GlassButton>
          </span>
        )}
        {extra != null && <Chip tone="warn" className="mt-1" title="More than the usual fee">+{dollars(extra)} over usual</Chip>}
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void record(); }}
          placeholder={`${monthOnly(month)} bill  ↵`}
          aria-label={`Record ${service.name}'s bill for ${monthName(month)}`}
          inputMode="decimal"
          className="ww-field !min-h-8 !w-[116px] !text-[13px]"
        />
        <select
          value={unpaid ? "unpaid" : "paid"}
          onChange={(e) => setUnpaid(e.target.value === "unpaid")}
          aria-label={`Is ${service.name}'s ${monthName(month)} bill paid?`}
          title="Paid, or billed and still owed"
          className="ww-field !min-h-8 !w-[84px] !pl-2 !pr-5 !text-[12.5px]"
        >
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>
        {service.billingUrl && (
          <IconButton label={`Open ${service.name}'s billing page`} onClick={() => window.open(service.billingUrl as string, "_blank", "noopener,noreferrer")}><ExternalLink size={15} /></IconButton>
        )}
      </div>
    </li>
  );
}
