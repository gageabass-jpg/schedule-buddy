// Thin client wrapper around the placesAutocomplete Cloud Function (Google
// Places, for the employer search). The API key stays on the server.

import { getFunctions, httpsCallable } from "firebase/functions";
import { app as firebaseApp } from "../firebase";

export interface PlaceSuggestion {
  placeId: string;
  /** The business name, e.g. "Thomas Hospital". */
  name: string;
  /** Where it is, e.g. "Fairhope, AL, USA". */
  detail: string;
}

const fns = getFunctions(firebaseApp, "us-central1");
const call = httpsCallable<{ input: string; sessionToken?: string }, { suggestions: PlaceSuggestion[] }>(
  fns,
  "placesAutocomplete",
);

export async function searchPlaces(input: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const r = await call({ input, sessionToken });
  return r.data.suggestions ?? [];
}
