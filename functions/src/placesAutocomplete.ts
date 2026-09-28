// placesAutocomplete — employer search for the Manager's People editor.
//
// Architecture:
//   - HTTPS callable. The Manager sends what's been typed so far; we ask
//     Google Places Autocomplete (New) and hand back a short list of
//     businesses ("Thomas Hospital" · "Fairhope, AL, USA").
//   - The Google API key lives as a Firebase function secret
//     (GOOGLE_PLACES_API_KEY), never in the app bundle.
//   - Only household members may call it, so a stray Firebase sign-in
//     can't spend the quota.
//   - The client passes one sessionToken per editing session so Google
//     bills the keystrokes as a single autocomplete session.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";

const GOOGLE_PLACES_API_KEY = defineSecret("GOOGLE_PLACES_API_KEY");

interface PlacesAutocompleteRequest {
  input: string;
  sessionToken?: string;
}

export interface PlaceSuggestion {
  placeId: string;
  /** The business name, e.g. "Thomas Hospital". */
  name: string;
  /** Where it is, e.g. "Fairhope, AL, USA". */
  detail: string;
}

interface PlacesAutocompleteResponse {
  suggestions: PlaceSuggestion[];
}

// The slice of the Places API (New) autocomplete response we read.
interface GooglePrediction {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
}

export const placesAutocomplete = onCall<PlacesAutocompleteRequest, Promise<PlacesAutocompleteResponse>>(
  { secrets: [GOOGLE_PLACES_API_KEY], cors: true, timeoutSeconds: 10 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");

    const input = String(request.data?.input ?? "").trim();
    if (input.length < 2) return { suggestions: [] };
    if (input.length > 100) throw new HttpsError("invalid-argument", "That's too long to search.");
    const sessionToken = typeof request.data?.sessionToken === "string"
      ? request.data.sessionToken.slice(0, 64)
      : undefined;

    const hh = await getFirestore().collection("households")
      .where("memberUids", "array-contains", uid).limit(1).get();
    if (hh.empty) throw new HttpsError("permission-denied", "Join a household to search employers.");

    let res: Response;
    try {
      res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY.value(),
        },
        body: JSON.stringify({
          input,
          includedRegionCodes: ["us"],
          languageCode: "en",
          ...(sessionToken ? { sessionToken } : {}),
        }),
      });
    } catch (e) {
      logger.error("placesAutocomplete: request failed", e);
      throw new HttpsError("unavailable", "Couldn't reach Google Places.");
    }
    if (!res.ok) {
      logger.error("placesAutocomplete: Google returned", res.status, await res.text().catch(() => ""));
      throw new HttpsError("unavailable", "Google Places didn't answer.");
    }

    const body = (await res.json()) as { suggestions?: GooglePrediction[] };
    const suggestions: PlaceSuggestion[] = [];
    for (const s of body.suggestions ?? []) {
      const p = s.placePrediction;
      if (!p?.placeId) continue;
      const name = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
      if (!name) continue;
      suggestions.push({ placeId: p.placeId, name, detail: p.structuredFormat?.secondaryText?.text ?? "" });
    }
    return { suggestions: suggestions.slice(0, 6) };
  },
);
