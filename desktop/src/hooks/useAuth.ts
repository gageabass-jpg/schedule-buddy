import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider, appleProvider } from "../firebase";

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: User };

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setState(user ? { status: "signed-in", user } : { status: "signed-out" });
    });
  }, []);

  return state;
}

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth, googleProvider);
}

export async function signInWithApple(): Promise<void> {
  await signInWithPopup(auth, appleProvider);
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function doSignOut(): Promise<void> {
  await signOut(auth);
}
