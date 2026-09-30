# The any-household data model

Status: **data layer and rules built and tested. The Mac runs on the model
through the legacy bridge once a household is migrated. No household is
migrated yet.**

| Piece | Where |
|---|---|
| Types | `shared/model.ts` |
| Converter | `shared/fromLegacy.ts` |
| Resolver (shifts, coverage) | `shared/resolve.ts` |
| Data layer | `shared/store.ts` |
| Mac binding | `desktop/src/lib/modelStore.ts` |
| Functions binding | `functions/src/modelStore.ts` |
| Phone binding | `shared/phone.ts`, bundled to `public/js/nucleus-model.js` |
| Legacy bridge | `shared/toLegacy.ts` (`toLegacy`, `bridgeEdit`), `bridgeWrites` in `store.ts` |
| Mac bridge | `desktop/src/lib/householdState.ts`, `desktop/src/hooks/useHousehold.ts` |
| Tests | `tests/model.test.mjs`, `tests/bridge.test.mjs`, `tests/store.test.mjs`, `tests/phoneModel.test.mjs`, `tests/rules.test.mjs` |

## Why

Everything a household holds lives in one document, `households/{id}/state/main`:

- It is built for exactly three people. Gage, Kaylene and Daisy are fixed
  slots (`selfName`, `partner`, `dependents.daisy`, keys `G`/`K`/`D` in
  `employers`, `paydays`, `weeklyTemplates`, `events[].who`). A household
  with one parent, three adults or no caregiver can't be represented.
- Every edit rewrites the whole document. The phone does a full `set()` of its
  in-memory copy, so a stale phone can overwrite an edit made on the Mac, and
  any field the phone doesn't know about is deleted on its next save.
- It grows without limit (import photos are stored inline as data URLs;
  events and requests are never pruned) toward Firestore's 1 MB cap.
- Access can only be granted to the whole document, which is why the
  caregiver needs a mirrored `caregiverView`.

## The model

Each thing is its own document; each person is a record.

| Path | What | Who can read |
|---|---|---|
| `households/{hid}` | name, time zone, `childcare`, `schemaVersion`, members and roles | every member |
| `people/{pid}` | who a person is: name, role, account, colour, photo, order | every member |
| `personDetails/{pid}` | the rest of them: employer, payday, weekly pattern, alternate weekends, blackouts | admin/partner, and the person themself |
| `shiftTypes/{id}` | shift presets | every member |
| `shifts/{id}` | one person's shift on one date, `replace` or `add`. A replace shift's id is `{date}_{pid}_replace`, so there is one per person per date | admin/partner; caregiver their own |
| `events/{id}` | life events, `personId` or the whole family | admin/partner |
| `coverageRequests/{id}` | requests, now naming `caregiverId` | admin/partner; caregiver the ones addressed to them |
| `caregiverOff/{id}` | a caregiver's day off | admin/partner; the caregiver their own |
| `caregiverRequests/{id}` | requests a caregiver sent | admin/partner; the caregiver the ones they sent |
| `scheduleBlocks/{id}`, `occasions/{id}`, `shiftOffers/{id}`, `imports/{id}` | as today, one document each | admin/partner |
| `settings/main` | calendar name, export range, public share | admin/partner |

**People have a role**, which decides what the schedule does with them:

- **adult**: works shifts. The kids are covered while any adult is free.
- **caregiver**: covers when no adult can. Their own shifts (classes, work)
  are time they can't cover.
- **child**: needs covering. Owns no shifts and no colour.

**Dated shifts** unify four legacy lists. A `replace` shift takes the place of
the weekly pattern for that date (a type of `null` means off). An `add` shift
sits on top of it.

| Legacy | New |
|---|---|
| `overrides` (Gage) | `replace` |
| `ot` (Gage) | `add`, `overtime: true` |
| `partner.shifts` (Kaylene) | `add` |
| `dependents.daisy.shifts` | `add` |

**Coverage for any household.** A gap is time when every adult is away (at
work, travelling or asleep):

- with two adults, the two-parent overlap it has always been;
- with one adult, their time away;
- with three, only when all three are gone at once.

The math is shared with the existing engine (`computeOverlap.ts`), not copied.

**Per-document rules replace the mirror.** A caregiver reads exactly the
coverage requests addressed to them (`caregiverId` → their person → their
`uid`), so `caregiverView` and the functions that maintain it can go. Only
admin and partner write; a caregiver's changes keep going through the
`caregiverAction` function, which checks each one.

**The data layer** (`shared/store.ts`) is the only code that knows these paths.
It is written once against a small store interface, with two adapters: the
Mac's modular SDK, and the namespaced API that the phone's compat SDK and the
functions' Admin SDK share.
- **Reads:** `loadHousehold`, `watchHousehold` (live) and `watchCaregiver`.
- **Writes:** `savePerson`, `removePerson`, `putRecord`, `removeRecord`,
  `saveSettings` and `saveHouseholdInfo`, each touching single documents and
  checking the record first.
- **Migration:** `writeModel` and `setSchemaVersion`.

## Where every legacy field goes

| state/main | New home |
|---|---|
| `selfName`, `partner.name`, `dependents.daisy.name` | `people/*.name` |
| `weeklyTemplates.{G,K,daisy}` | `people/*.weekly` |
| `template`, `templateEndDate` | Gage's `weekly` when there's no `weeklyTemplates.G`; otherwise already superseded |
| `alt` | Gage's `altWeekend` |
| `overrides`, `ot`, `partner.shifts`, `dependents.daisy.shifts` | `shifts/*` |
| `otOpportunities` | `shiftOffers/*` |
| `employers.{G,K,D}`, `paydays.{G,K}` | `people/*.employer`, `.payday` |
| `caregiverBlackouts` | the caregiver's `blackouts` |
| `childcareOff` | `caregiverOff/*`, naming the caregiver |
| `events[].who` | `events/*.personId` (none = family) |
| `coverageRequests` | `coverageRequests/*` + `caregiverId` |
| `caregiverRequests`, `scheduleBlocks`, `occasions` | one document each |
| `imports` | `imports/*`, each with its photo inline (one import per document is well under the size limit) |
| `shiftTypes` | `shiftTypes/*` |
| `householdName`, `timeZone` | the household root |
| `calName`, `range`, `shareEnabled`, `shareToken`, `_migrations` | `settings/main` |
| `calView`, `ui`, `activeTab` | not household data: kept on each device |

Anything else found in a record is reported in the migration log, never
dropped silently.

## Proof it draws the same thing

`tests/model.test.mjs` converts legacy records and runs the old and new code
side by side, requiring identical results:

- the calendar: every chip, label, source, note and "where";
- the coverage gaps;
- the caregiver's unavailable time.

It does this for a household that uses every field, and for 300 random
households. Planting a bug in the new resolver fails it.

## Migration plan

1. **Model, converter, equivalence tests.** Done.
2. **Readers and writers.** Done:
   - the data layer, bound for the Mac, the phone and the functions;
   - rules for every new collection;
   - tests against the local test database: a converted household written
     through the Admin adapter reads back identically through the Mac's, as
     each role.
   The first staging household comes from the migration function (step 4)
   run on a legacy test household. That exercises the real path rather than a
   seed that skips it.
3. **Clients move over.** In two halves:
   - **The bridge (Mac, phone, functions: done).** For a migrated household, `toLegacy` builds
     the old state/main shape from the records, so every screen keeps working
     unchanged. Every save goes through `bridgeEdit`: the edit is the
     difference between the state it started from and the result, and only
     the records it changed are written, merged onto what's stored.
     - All of the Mac's writers go through `desktop/src/lib/householdState.ts`,
       and `useHousehold` watches the records.
     - The phone watches the records for a migrated household, and each save
       writes the difference from the state it last received. The inbox
       handlers that edit outside the live sync go through
       `readHouseholdStateOnce` / `writeHouseholdStateOnce`.
     - Every function reads and edits through `functions/src/householdState.ts`
       (`readLegacyState`, `editLegacyState`). nucleusAI's changes and undo,
       the health calendar and caregiver actions all use it. An edit to a
       migrated household is not one transaction: it's worked out from a fresh
       read and merged onto it.
     - **The edit log.** Each bridged save writes an `edits/{id}` entry in the
       same batch: the records it changed, before and after. `onHouseholdEdit`
       rebuilds the state before and after that save and runs the same
       notification code as the state/main trigger, so one save sends one
       notification however many records it touched. It then refreshes the
       caregiver's view and removes the entry.
     - Model → legacy → model is exact (same records, same ids), checked on
       the full household and 300 random ones.
     - Partner edits made through the bridge are checked end to end under the
       real rules.
     - The phone and the functions get the same bridge next.
   - **Native screens.** The screens that assume G/K/D (the calendar,
     coverage, pickers, the widget snapshot, the wall, nucleusAI's tools)
     take people from `people/`, one at a time. Until a screen moves, it shows
     the first two adults and the first caregiver.
4. **Migration function (built).** `migrateHousehold` (`shared/migrate.ts`,
   run by the function of the same name, admin only) for one household:
   - copies state/main to `legacyBackups/{time}`;
   - clears anything a failed earlier attempt left;
   - converts and writes the records;
   - reads them back and checks (`shared/verify.ts`) that they're exactly the
     conversion and draw the same calendar, coverage gaps and caregiver time
     as state/main, from 3 months back to a year ahead;
   - only if that passes, sets `schemaVersion: 2`.
   Every attempt leaves a report in `migrations/{time}`. Once switched,
   state/main is read-only by rule, so an out-of-date app fails to save
   rather than writing where nothing reads.
   `unmigrateHousehold` moves back: it writes the household as it now stands
   into state/main (nothing done since is lost) and clears the version.
   Both run from the Mac: Family Console → General → Data format.
**New households start on the model.** The setup wizard (phone:
`public/index.html` "SETUP WIZARD"; Mac: `components/SetupWizard.tsx`) asks
for the household's name and time zone, its people (partner, caregiver,
kids), the shifts anyone works, each adult's usual week and work details,
and a home address. It then creates the household with
`shared/onboarding.ts`: `schemaVersion: 2`, exactly those records, no
starter data, and invite codes for the partner and caregiver. The phone never
runs its old built-in fix-ups on a household on the model.

5. **Cutover.** One coordinated release: functions, rules, phone, Mac and
   Windows together. Then retire `caregiverView` and `state/main`.

## Decisions (defaults assumed until you say otherwise)

1. **Kids become people** (role `child`, a name, no colour), so events can be
   for them and the app knows a household needs childcare planning. The
   migration can't know their names; you add them in the app.
2. **Colours past two adults.** The palette has Teal (Gage), Clay (Kaylene)
   and Ink-Muted (Daisy). A third adult needs a new hue. That's design work,
   deferred until a household needs it.
3. **Screen state leaves the household.** Which month you're looking at, the
   calendar layout and the active tab become per-device. The Mac and phone
   stop sharing "where I was".
4. **One household per account** for now. Belonging to two (e.g. a caregiver
   for two families) comes later.
5. **One coordinated cutover** rather than running both formats in parallel.
   Only your household is live, so a single switch is far less work. It means
   the Windows app is rebuilt the same day.
6. **Person photos move to Cloud Storage** (`people/*.photoPath`), set per
   person in the app, when the screens that show them move to the model.
   Until then the bundled Gage/Kaylene/Daisy photos keep showing, and the
   migration uploads nothing.
