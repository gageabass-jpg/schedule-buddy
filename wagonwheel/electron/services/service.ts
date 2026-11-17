import { AppError, invalid } from "../db/errors.js";
import type { Workspace } from "../db/repo.js";
import { SERVICE_PROVIDERS, SERVICE_PROVIDER_LABEL, type ServiceProvider } from "../../shared/types.js";
import type { ProviderStatus, ServicesStatus, UsageOutcome } from "../../shared/services.js";
import type { Fetch } from "../github/device-flow.js";
import type { ServiceTokenStore } from "./credentials.js";
import { monthsAgo, VercelClient } from "./vercel.js";

// Checking a service's usage with its provider. It reports; it never writes a bill. Holds nothing but the saved
// tokens (in the store, not here) and checks every argument, because they come from the window.

const TOKEN = /^[A-Za-z0-9_.-]{16,200}$/;
const TEAM = /^[A-Za-z0-9_-]{1,100}$/;

/** Usage this far over a quiet month is worth a look: at least $2, and at least a tenth of the plan's fee when one is set. */
const HIGH_FLOOR_USD = 2;

export interface ServicesDeps {
  fetch: Fetch;
  store: ServiceTokenStore;
  workspace: () => Workspace;
  now?: () => number;
}

/** "$0.03", "$7.40", or "less than a cent" for a fraction of one. Usage is often far below a cent. */
function usd(dollars: number): string {
  if (dollars <= 0) return "$0.00";
  if (dollars < 0.005) return "less than a cent";
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const monthName = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

export class ServicesService {
  private readonly now: () => number;

  constructor(private readonly deps: ServicesDeps) {
    this.now = deps.now ?? Date.now;
  }

  private provider(raw: string): ServiceProvider {
    if (!(SERVICE_PROVIDERS as readonly string[]).includes(raw)) throw invalid("That is not a service Wagonwheel can check usage on.");
    return raw as ServiceProvider;
  }

  private vercel(token?: () => string | null, team?: () => string | null): VercelClient {
    const { store } = this.deps;
    return new VercelClient(this.deps.fetch, token ?? (() => store.token("vercel")), team ?? (() => store.teamId("vercel")));
  }

  status(): ServicesStatus {
    const { store } = this.deps;
    const providers: ProviderStatus[] = SERVICE_PROVIDERS.map((provider) => ({
      provider,
      connected: store.has(provider),
      teamId: store.has(provider) ? store.teamId(provider) : null,
    }));
    return { providers, canKeepToken: store.canKeep() };
  }

  /** Save a token, but only once the provider has accepted it. */
  async setToken(providerRaw: string, tokenRaw: string, teamRaw: string): Promise<ServicesStatus> {
    const provider = this.provider(providerRaw);
    const token = (tokenRaw ?? "").trim();
    const team = (teamRaw ?? "").trim();
    if (!TOKEN.test(token)) throw invalid(`That does not look like a ${SERVICE_PROVIDER_LABEL[provider]} token. Paste the whole token, without spaces.`);
    if (team && !TEAM.test(team)) throw invalid("The team id may only have letters, numbers, dashes and underscores. Leave it blank for your personal account.");
    // Try it for real, cheaply (the last hour, answer not read). A wrong token or team stops here and nothing is saved.
    await this.vercel(() => token, () => team || null).check(this.now());
    this.deps.store.save(provider, token, team || null);
    return this.status();
  }

  clearToken(providerRaw: string): ServicesStatus {
    this.deps.store.clear(this.provider(providerRaw));
    return this.status();
  }

  /**
   * Check the usage billed beyond the plan, this month so far and last month. Writes no bill, changes no figure:
   * the provider's data is usage, not invoices, and invoices are what the bills are. Only "last checked" is noted.
   */
  async checkUsage(serviceId: string): Promise<UsageOutcome> {
    const ws = this.deps.workspace();
    const service = ws.getService(serviceId);
    if (!service.provider) throw invalid(`${service.name} has no usage to check. Type its bills in instead.`);
    const label = SERVICE_PROVIDER_LABEL[service.provider];
    if (!this.deps.store.has(service.provider)) throw new AppError("services", `Connect ${label} first: add a token from your ${label} account.`);

    const now = this.now();
    const client = this.vercel();
    const thisStart = monthsAgo(now, 0);
    const lastStart = monthsAgo(now, 1);
    const thisMonth = thisStart.toISOString().slice(0, 7);
    const lastMonth = lastStart.toISOString().slice(0, 7);
    // One after the other: each month is tens of megabytes of daily records, read as a stream.
    const current = await client.usage(thisStart, new Date(now));
    const previous = await client.usage(lastStart, thisStart);

    const planFeeUsd = service.amountCents / 100;
    const high = current.billedDollars >= Math.max(HIGH_FLOOR_USD, planFeeUsd * 0.1);
    const snapshot = ws.markChecked(service.id);

    let summary = `${label} usage billed beyond your plan: ${usd(current.billedDollars)} so far in ${monthName(thisMonth)} (${usd(previous.billedDollars)} in ${monthName(lastMonth)}).`;
    summary += high
      ? ` That is more than a quiet month: check ${label}'s usage page.`
      : " Nothing unusual. Your own bill figures were not changed.";
    return {
      snapshot,
      summary,
      usage: { month: thisMonth, billedUsd: current.billedDollars, previousMonth: lastMonth, previousBilledUsd: previous.billedDollars, high },
    };
  }
}
