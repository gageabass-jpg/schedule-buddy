// cleanSchedule — image-based schedule diff.
//
// Architecture:
//   - HTTPS callable invoked from the Mac Manager Cleaner UI.
//   - Caller uploads an image (base64) of a "clean / source-of-truth"
//     schedule.
//   - We hand the image to Claude with a structured prompt + the
//     household's shift type catalog. Claude returns a JSON list of
//     parsed shifts.
//   - The client does the diff against current state (cheaper than
//     shipping the whole state up here) and renders the three-pane
//     approve/deny UI.
//
// The Anthropic API key lives as a Firebase function secret, never in
// any app bundle.

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

interface ParsedShift {
  date: string;          // YYYY-MM-DD
  who: "G" | "K";        // schedule type
  shiftTypeId: string;   // matches a household shiftType id
  label: string;         // human label, e.g., "Day 12h"
}

interface CleanScheduleRequest {
  imageBase64: string;   // raw base64 without "data:image/..." prefix
  imageMediaType: "image/jpeg" | "image/png" | "image/webp";
  /** Which person the uploaded schedule applies to. Constrains parsing. */
  who: "G" | "K";
}

interface CleanScheduleResponse {
  shifts: ParsedShift[];
  /** Optional date range Claude inferred from the image. */
  dateRange?: { from: string; to: string };
  /** Human note Claude wants to surface to the user. */
  note?: string;
}

export const cleanSchedule = onCall<CleanScheduleRequest, Promise<CleanScheduleResponse>>(
  { secrets: [ANTHROPIC_API_KEY], cors: true, timeoutSeconds: 120 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in to use this.");

    const data = request.data;
    if (!data?.imageBase64) throw new HttpsError("invalid-argument", "Missing imageBase64.");
    if (!data?.imageMediaType) throw new HttpsError("invalid-argument", "Missing imageMediaType.");
    if (data.who !== "G" && data.who !== "K") {
      throw new HttpsError("invalid-argument", "who must be 'G' or 'K'.");
    }

    // Resolve household + load shift types so Claude can map.
    const db = getFirestore();
    const hhSnap = await db.collection("households")
      .where("memberUids", "array-contains", uid).limit(1).get();
    if (hhSnap.empty) throw new HttpsError("failed-precondition", "No household found.");
    const householdId = hhSnap.docs[0].id;

    const stateSnap = await db.collection("households").doc(householdId)
      .collection("state").doc("main").get();
    if (!stateSnap.exists) {
      throw new HttpsError("failed-precondition", "State not initialized.");
    }
    const state = stateSnap.data() ?? {};
    const shiftTypes = (state.shiftTypes as ShiftType[] | undefined) ?? [];
    if (shiftTypes.length === 0) {
      throw new HttpsError("failed-precondition", "No shift types defined. Add some first.");
    }

    // Compact shift type catalog for the prompt.
    const catalog = shiftTypes.map((s) =>
      `- id:${s.id} name:"${s.name}" times:${s.start}–${s.end}${s.crossesMidnight ? " (overnight)" : ""}`
    ).join("\n");

    const personLabel = data.who === "G" ? "the household admin (Gage)" : "the partner (Kaylene)";

    const systemPrompt =
      `You parse a photo of a work schedule into structured JSON shifts.\n\n` +
      `The schedule belongs to ${personLabel}. The household has these shift types:\n\n${catalog}\n\n` +
      `Rules:\n` +
      `- Output ONLY a JSON object, no prose.\n` +
      `- Shape: { "shifts": [{ "date": "YYYY-MM-DD", "who": "${data.who}", "shiftTypeId": "<id from catalog>", "label": "<human label>" }], "dateRange": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }, "note": "<optional>" }\n` +
      `- Pick the closest shiftTypeId from the catalog by start/end time. If nothing fits closely, omit that shift.\n` +
      `- Dates must be absolute (use the visible month/year on the schedule; if year is ambiguous, choose the closest future year).\n` +
      `- If you see a day marked off / blank / "OFF" / vacation, do NOT include it.\n` +
      `- Sort shifts by date ascending.\n` +
      `- The "label" is the catalog name, e.g. "Day 12h". Not free text.\n`;

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

    let parsed: CleanScheduleResponse;
    try {
      const resp = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: data.imageMediaType,
                data: data.imageBase64,
              },
            },
            {
              type: "text",
              text: "Parse this schedule. Return JSON only.",
            },
          ],
        }],
      });

      // Extract the text block.
      let raw = "";
      for (const block of resp.content) {
        if (block.type === "text") raw += block.text;
      }
      // Strip markdown code fences if Claude added them.
      raw = raw.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      parsed = JSON.parse(raw);
    } catch (e) {
      logger.error("cleanSchedule parse failure", { err: String(e) });
      throw new HttpsError("internal", "Couldn't parse the schedule image. Try a clearer photo.");
    }

    // Validate every shift's shiftTypeId is in the catalog.
    const knownIds = new Set(shiftTypes.map((s) => s.id));
    const cleaned: ParsedShift[] = (parsed.shifts ?? [])
      .filter((s) => knownIds.has(s.shiftTypeId))
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date))
      .map((s) => ({
        date: s.date,
        who: data.who,
        shiftTypeId: s.shiftTypeId,
        label: String(s.label ?? ""),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    logger.info("cleanSchedule served", { householdId, count: cleaned.length });

    return {
      shifts: cleaned,
      dateRange: parsed.dateRange,
      note: parsed.note,
    };
  },
);
