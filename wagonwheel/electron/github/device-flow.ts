import { AppError } from "../db/errors.js";

// GitHub's device flow: the app asks for a code, the person types it on github.com in their
// own browser, and the app polls until GitHub hands over a token. No redirect, no secret in
// the app: only the OAuth app's public Client ID.
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

export type Fetch = typeof fetch;
export const USER_AGENT = "Nucleus-Wagonwheel";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

export const unreachable = (): AppError => new AppError("github", "Could not reach GitHub. Check your internet connection and try again.");

async function postForm(f: Fetch, url: string, body: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": USER_AGENT },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw unreachable();
  }
  let json: unknown = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new AppError("github", `GitHub answered with something unexpected (HTTP ${res.status}). Try again in a moment.`);
  }
  return { status: res.status, json: json as Record<string, unknown> };
}

const asText = (v: unknown): string => (typeof v === "string" ? v : "");
const asNumber = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback);

/** The reason, in words, for an `error` GitHub's device endpoints send back. */
export function deviceFlowProblem(code: string): string {
  switch (code) {
    case "device_flow_disabled":
      return 'Device sign-in is turned off for this OAuth app. On GitHub, open the app\'s settings, tick "Enable Device Flow", save, and try again.';
    case "incorrect_client_credentials":
    case "Not Found":
      return "GitHub does not recognise that Client ID. Check it against your OAuth app on GitHub.";
    case "unsupported_grant_type":
    case "incorrect_device_code":
      return "GitHub rejected the sign-in request. Start the sign-in again.";
    case "rate_limit":
      return "GitHub says there were too many sign-in attempts. Wait a minute and try again.";
    default:
      return `GitHub refused the sign-in (${code || "no reason given"}).`;
  }
}

export interface DeviceCode { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }

export async function requestDeviceCode(f: Fetch, clientId: string, scope: string): Promise<DeviceCode> {
  const { json } = await postForm(f, DEVICE_CODE_URL, { client_id: clientId, scope });
  const problem = asText(json.error) || (json.message === "Not Found" ? "Not Found" : "");
  if (problem) throw new AppError("github", deviceFlowProblem(problem));
  const deviceCode = asText(json.device_code);
  const userCode = asText(json.user_code);
  const verificationUri = asText(json.verification_uri);
  if (!deviceCode || !userCode || !verificationUri) throw new AppError("github", "GitHub did not send a sign-in code. Try again.");
  return { deviceCode, userCode, verificationUri, expiresIn: asNumber(json.expires_in, 900), interval: asNumber(json.interval, 5) };
}

export type TokenResult =
  | { state: "pending"; interval: number }
  | { state: "done"; token: string }
  | { state: "expired" }
  | { state: "denied" };

/** One check of whether the person has approved the code. */
export async function pollDeviceToken(f: Fetch, clientId: string, deviceCode: string, interval: number): Promise<TokenResult> {
  const { json } = await postForm(f, TOKEN_URL, {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  const token = asText(json.access_token);
  if (token) return { state: "done", token };
  switch (asText(json.error)) {
    case "authorization_pending": return { state: "pending", interval };
    case "slow_down": return { state: "pending", interval: asNumber(json.interval, interval + 5) };
    case "expired_token": return { state: "expired" };
    case "access_denied": return { state: "denied" };
    default: throw new AppError("github", deviceFlowProblem(asText(json.error)));
  }
}
