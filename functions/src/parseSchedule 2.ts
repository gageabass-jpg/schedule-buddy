// parseSchedule — vision-powered schedule-photo parser.
//
// Architecture:
//   - HTTPS callable invoked from the iOS app's "+" import button.
//   - Authenticates the caller, resolves them to their household.
//   - Loads state/main so Claude can map what it reads to the household's
//     existing shift types (by name / hours).
//   - Sends the photo to Claude (vision) and asks for a STRUCTURED list of
//     scheduled days. It writes NOTHING — the client shows a preview and the
//     user confirms, then the client writes via its normal state path.
//
// The Anthropic API key lives as a Firebase function secret.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

interface ShiftType {
  id: string; name: string; start: string; end: string;
  crossesMidnight?: boolean;
}
interface HouseholdState {
  shiftTypes?: ShiftType[];
  range?: { from: string; to: string };
}

interface ParseRequest {
  imageBase64: string;                 // raw base64 (no data: prefix)
  mediaType: string;                   // e.g. "image/jpeg"
  person?: "G" | "K" | "Daisy";        // who the caller is importing for (context only)
}
interface ParsedShift {
  date: string;                        // YYYY-MM-DD
  start: string;                       // HH:MM 24h
  end: string;                         // HH:MM 24h
  crossesMidnight: boolean;
  label: string;
  matchedShiftTypeId: string | null;   // id from the household's shift types, if one fits
}
interface ParseResponse {
  shifts: ParsedShift[];
  note: string;
}

function isoToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const parseSchedule = onCall<ParseRequest, Promise<ParseResponse>>(
  { secrets: [ANTHROPIC_API_KEY], region: "us-central1", cors: true, memory: "512MiB", timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");

    const imageBase64 = (request.data.imageBase64 ?? "").trim();
    const mediaType = (request.data.mediaType ?? "").trim();
    const person = request.data.person ?? "G";
    if (!imageBase64) throw new HttpsError("invalid-argument", "No image supplied.");
    if (!ALLOWED_MEDIA.has(mediaType)) {
      throw new HttpsError("invalid-argument", `Unsupported image type: ${mediaType}`);
    }
    // Guard against oversized payloads (~7MB base64 ≈ 5MB image).
    if (imageBase64.length > 7_500_000) {
      throw new HttpsError("invalid-argument", "Image too large. Try a smaller photo.");
    }

    // 1. Resolve household + role.
    const db = getFirestore();
    const hhSnap = await db.collection("households")
      .where("memberUids", "array-contains", uid).limit(1).get();
    if (hhSnap.empty) throw new HttpsError("failed-precondition", "No household found.");
    const householdId = hhSnap.docs[0].id;
    const role = hhSnap.docs[0].data().roles?.[uid] ?? "partner";
    if (role === "supporting") {
      throw new HttpsError("permission-denied", "Caregivers can't import schedules.");
    }

    // 2. Load shift types for mapping context.
    const stateSnap = await db.collection("households").doc(householdId)
      .collection("state").doc("main").get();
    const state = (stateSnap.data() ?? {}) as HouseholdState;
    const shiftTypes = state.shiftTypes ?? [];
    const today = isoToday();
    const year = today.slice(0, 4);

    const shiftTypeLines = shiftTypes.length
      ? shiftTypes.map((s) =>
          `  ${s.id} → "${s.name}" ${s.start}-${s.end}${s.crossesMidnight ? " (overnight)" : ""}`).join("\n")
      : "  (none configured)";

    const whoLabel = person === "K" ? "Kaylene" : person === "Daisy" ? "Daisy" : "Gage";

    const prompt =
      `You are reading a photo of a work/school schedule to import ${whoLabel}'s scheduled days.\n` +
      `Today is ${today}. Assume the current year is ${year} unless the photo clearly says otherwise.\n\n` +
      `The household already has these shift types (id → name, hours):\n${shiftTypeLines}\n\n` +
      `Extract EVERY scheduled day you can see for ${whoLabel}. For each day return:\n` +
      `  - date: YYYY-MM-DD (infer the year from context; a schedule usually spans one month)\n` +
      `  - start: HH:MM 24-hour\n` +
      `  - end: HH:MM 24-hour\n` +
      `  - crossesMidnight: true if the shift ends the next calendar day (e.g. 19:00-07:30)\n` +
      `  - label: a short human label exactly as written on the schedule (e.g. "7p-730a", "Day", "8a-12p")\n` +
      `  - matchedShiftTypeId: if the hours match one of the shift types above, put its id; otherwise null\n\n` +
      `Rules:\n` +
      `- Only include days that are actually scheduled/worked. Skip blank/off days.\n` +
      `- If a cell shows only a code like "7p-730a", convert it to start/end 24h times.\n` +
      `- If you cannot determine the exact date, make your best inference from the visible month/day headers.\n` +
      `- Return STRICT JSON only, no prose, in exactly this shape:\n` +
      `{"shifts":[{"date":"2026-04-14","start":"15:00","end":"23:30","crossesMidnight":false,"label":"3p-1130p","matchedShiftTypeId":null}],"note":"one short sentence about what you saw"}\n`;

    // 3. Vision call.
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    let raw = "";
    try {
      const resp = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg", data: imageBase64 },
            },
            { type: "text", text: prompt },
          ],
        }],
      });
      raw = resp.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text).join("").trim();
    } catch (e) {
      logger.error("parseSchedule: Anthropic call failed", { error: String(e) });
      throw new HttpsError("internal", "Couldn't read that photo. Try again with a clearer shot.");
    }

    // 4. Parse the JSON out of the reply (tolerate stray prose / code fences).
    let parsed: ParseResponse;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : raw);
    } catch (e) {
      logger.error("parseSchedule: bad JSON from model", { raw: raw.slice(0, 500) });
      throw new HttpsError("internal", "Couldn't understand the schedule in that photo.");
    }

    const validIds = new Set(shiftTypes.map((s) => s.id));
    const shifts: ParsedShift[] = Array.isArray(parsed.shifts)
      ? parsed.shifts
          .filter((s) => s && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)))
          .map((s) => ({
            date: String(s.date),
            start: String(s.start ?? "").slice(0, 5),
            end: String(s.end ?? "").slice(0, 5),
            crossesMidnight: !!s.crossesMidnight,
            label: String(s.label ?? "").slice(0, 40),
            matchedShiftTypeId: s.matchedShiftTypeId && validIds.has(String(s.matchedShiftTypeId))
              ? String(s.matchedShiftTypeId) : null,
          }))
          .sort((a, b) => a.date.localeCompare(b.date))
      : [];

    logger.info("parseSchedule: parsed", { householdId, person, count: shifts.length });
    return { shifts, note: String(parsed.note ?? "").slice(0, 200) };
  },
);
