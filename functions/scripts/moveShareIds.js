// One-off: take householdId and ownerUid out of the world-readable
// publicShares/{token} docs and put them in shareOwners/{token}, which no
// client can read (see firestore.rules).
//
// New clients do this on their own the next time they publish. Run this once
// after deploying the rules so that every share is clean now, not whenever
// someone next edits the schedule.
//
// Run from the functions/ directory so it can resolve firebase-admin:
//
//   node scripts/moveShareIds.js            # dry run: says what it would do
//   node scripts/moveShareIds.js --apply    # does it
//
// Requires Application Default Credentials (gcloud auth application-default
// login). Safe to run twice: an existing owner doc is never overwritten, and
// a share with no ids left is skipped.
//
// For each share that still names an owner or household it
//   1. writes shareOwners/{token} (only if absent), then
//   2. deletes ownerUid and householdId from the share.
// In that order, so a failure between the two leaves the share working.
//
// A share that names no household is matched to the one household its ownerUid
// belongs to. If that is not exactly one, it is left alone and listed.

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROJECT_ID = "schedule-buddy-dd2cf";
const CALENDAR_KEYS = new Set(["v", "householdName", "people", "days", "from", "to", "updatedAt"]);

async function householdFor(db, share) {
  if (typeof share.householdId === "string" && share.householdId) {
    const hh = await db.collection("households").doc(share.householdId).get();
    return hh.exists ? { id: hh.id, data: hh.data() } : null;
  }
  if (typeof share.ownerUid !== "string" || !share.ownerUid) return null;
  const found = await db.collection("households").where("memberUids", "array-contains", share.ownerUid).get();
  return found.size === 1 ? { id: found.docs[0].id, data: found.docs[0].data() } : null;
}

/** Returns { moved: [token], clean: [token], skipped: [{ token, why }] }. */
async function moveShareIds(db, { apply = false, log = () => {} } = {}) {
  const out = { moved: [], clean: [], skipped: [] };
  const snap = await db.collection("publicShares").get();
  for (const d of snap.docs) {
    const token = d.id;
    const share = d.data();
    const hasIds = "ownerUid" in share || "householdId" in share;
    if (!hasIds) { out.clean.push(token); continue; }

    const hh = await householdFor(db, share);
    if (!hh) {
      out.skipped.push({ token, why: "can't tell which household it belongs to (missing, or its owner is in several)" });
      continue;
    }
    // Who to record as owner: the stamped uid, else whoever created the household.
    const ownerUid = (typeof share.ownerUid === "string" && share.ownerUid) || hh.data.createdBy;
    if (typeof ownerUid !== "string" || !ownerUid) {
      out.skipped.push({ token, why: "no owner uid on the share or the household" });
      continue;
    }
    const extra = Object.keys(share).filter((k) => !CALENDAR_KEYS.has(k) && k !== "ownerUid" && k !== "householdId");
    if (extra.length) log(`  ${token}: has fields the rules no longer allow (${extra.join(", ")}); they stay until it is republished`);

    if (apply) {
      try {
        await db.collection("shareOwners").doc(token).create({ ownerUid, householdId: hh.id });
      } catch (e) {
        if (e.code !== 6 /* ALREADY_EXISTS */) throw e;
      }
      await d.ref.update({
        ownerUid: FieldValue.delete(),
        householdId: FieldValue.delete(),
      });
    }
    out.moved.push(token);
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getFirestore(initializeApp({ projectId: PROJECT_ID }));
  const r = await moveShareIds(db, { apply, log: (s) => console.log(s) });
  const verb = apply ? "moved" : "would move";
  console.log(`${verb} ${r.moved.length}; already clean ${r.clean.length}; left alone ${r.skipped.length}`);
  for (const s of r.skipped) console.log(`  left alone: ${s.token.slice(0, 6)}…  ${s.why}`);
  if (!apply && r.moved.length) console.log("Re-run with --apply to do it.");
  if (r.skipped.length) process.exitCode = 2;
}

module.exports = { moveShareIds };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
