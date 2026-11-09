import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { app as nucleusApp, auth } from "../firebase";

/**
 * Google's permission to read the user's mail. It's asked for only when the user
 * searches their email, and what comes back is a token that lasts about an hour.
 * It goes to the scan function with that one request; Nucleus never keeps it.
 *
 * The token comes from its own throwaway Google sign-in, on a second Firebase
 * auth instance, not from the account Nucleus is signed in with. So it works
 * whether Nucleus uses Apple or Google, any Gmail account can be chosen, and
 * the Nucleus account is never linked to or changed by it. The scan function
 * still knows who is asking from the Nucleus sign-in, which is untouched.
 */
const GMAIL_READ = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_APP = "gmail-token";

/** The second auth instance, made on first use. */
function tokenAuth() {
  const app = getApps().find((a) => a.name === TOKEN_APP) ?? initializeApp(nucleusApp.options, TOKEN_APP);
  return getAuth(app);
}

/** The error codes people actually hit, in words that say what to do. */
function friendly(e: unknown): Error {
  switch ((e as { code?: string } | null)?.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return new Error("The Google window was closed before Gmail was allowed.");
    case "auth/popup-blocked":
      return new Error("The Google window was blocked. Allow pop-ups for Nucleus and try again.");
    case "auth/network-request-failed":
      return new Error("Couldn't reach Google. Check the connection and try again.");
    default:
      return e instanceof Error ? e : new Error("Couldn't connect to Gmail.");
  }
}

/** A fresh Gmail read token for whichever Google account the user picks. Opens
 *  Google's own window, with its account chooser; the first time it asks to
 *  allow reading mail. */
export async function getGmailAccessToken(): Promise<string> {
  if (!auth.currentUser) throw new Error("Sign in to Nucleus first.");
  const gauth = tokenAuth();
  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_READ);
  // Which mailbox to read is the user's call, so always show the chooser.
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const result = await signInWithPopup(gauth, provider);
    const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
    if (!token) throw new Error("Google didn't give Nucleus access to Gmail.");
    return token;
  } catch (e) {
    throw friendly(e);
  } finally {
    // Nothing of that sign-in is kept: the token is all it was for.
    await signOut(gauth).catch(() => undefined);
  }
}
