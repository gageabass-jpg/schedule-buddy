// One-off helper: mint a wall display token without going through the
// Mac app UI. Run from the functions/ directory so it can resolve
// firebase-admin from node_modules.
//
// Usage:
//   node scripts/mintWallToken.js [--label "Kitchen Pi"]
//
// Requires Application Default Credentials. If you've never set them up:
//   gcloud auth application-default login
//
// The script lists households the credentials can see. If there's exactly
// one, it mints a token for that household. Otherwise it prints them all
// and exits — re-run with --household <id> to pick one.

const admin = require("firebase-admin");
const crypto = require("node:crypto");

const PROJECT_ID = "schedule-buddy-dd2cf";
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const TOKEN_LEN = 32;

function genToken() {
  const bytes = crypto.randomBytes(TOKEN_LEN);
  let out = "";
  for (let i = 0; i < TOKEN_LEN; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function parseArgs(argv) {
  const out = { label: "Kitchen Pi", householdId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--label" && argv[i + 1]) { out.label = argv[++i]; continue; }
    if (a === "--household" && argv[i + 1]) { out.householdId = argv[++i]; continue; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  let householdId = args.householdId;
  if (!householdId) {
    const snap = await db.collection("households").get();
    if (snap.empty) {
      console.error("No households found in project", PROJECT_ID);
      process.exit(1);
    }
    if (snap.size > 1) {
      console.log("Multiple households found. Re-run with --household <id>:");
      snap.forEach((d) => {
        const data = d.data();
        const name = data.name || data.householdName || "(unnamed)";
        const members = Object.values(data.memberNames || {}).join(", ") || "?";
        console.log(`  ${d.id}  — ${name}  [${members}]`);
      });
      process.exit(2);
    }
    householdId = snap.docs[0].id;
    const data = snap.docs[0].data();
    console.log(`Using household ${householdId} (${data.name || data.householdName || "(unnamed)"})`);
  }

  // Mint with a retry loop in case of (vanishingly unlikely) collision.
  let token = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = genToken();
    const ref = db.collection("wallTokens").doc(candidate);
    const exists = await ref.get();
    if (exists.exists) continue;
    await ref.set({
      householdId,
      createdAt: Date.now(),
      createdBy: "mint-script",
      label: args.label,
      revoked: false,
      serverCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    token = candidate;
    break;
  }
  if (!token) {
    console.error("Failed to mint token after 4 attempts (collisions).");
    process.exit(3);
  }

  const url = `https://${PROJECT_ID}.web.app/wall?t=${token}`;
  console.log("");
  console.log("✅ Token minted:");
  console.log("");
  console.log("  Token:    " + token);
  console.log("  Label:    " + args.label);
  console.log("  Household:" + " " + householdId);
  console.log("");
  console.log("  Kiosk URL:");
  console.log("    " + url);
  console.log("");
}

main().catch((err) => {
  console.error("Mint failed:", err.message || err);
  if (err.code === 16 || /UNAUTHENTICATED|credentials/i.test(String(err))) {
    console.error("");
    console.error("Looks like Application Default Credentials aren't set up.");
    console.error("Run this once on your Mac, then retry:");
    console.error("  gcloud auth application-default login");
  }
  process.exit(1);
});
