# The any-household data model

Status: **designed, converter built and tested; nothing reads or writes it yet.**
Types: `shared/model.ts`. Converter: `shared/fromLegacy.ts`. Resolver:
`shared/resolve.ts`. Tests: `tests/model.test.mjs`.

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
| `people/{pid}` | a person: name, role, account, colour, photo, employer, payday, weekly pattern, alternate weekends, blackouts | every member (caregiver: names only, see below) |
| `shiftTypes/{id}` | shift presets | every member |
| `shifts/{id}` | one person's shift on one date, `replace` or `add` | admin/partner; caregiver their own |
| `events/{id}` | life events, `personId` or the whole family | admin/partner |
| `coverageRequests/{id}` | requests, now naming `caregiverId` | admin/partner; caregiver the ones addressed to them |
| `caregiverRequests/{id}`, `scheduleBlocks/{id}`, `caregiverOff/{id}`, `occasions/{id}`, `shiftOffers/{id}`, `imports/{id}` | as today, one document each | admin/partner (+ caregiver where they are the author) |
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

**Per-document rules replace the mirror.** A caregiver can be allowed to read
exactly the coverage requests addressed to them (`caregiverId` → their person
→ their `uid`), so `caregiverView` and the functions that maintain it can go.

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
| `imports` | `imports/*`; inline photos move to Cloud Storage |
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
2. **Readers and writers.** One small data layer each for the Mac app, the
   phone and the functions, reading the new collections and writing single
   documents. Built on staging against a synthetic household seeded by the
   converter.
3. **Clients move over, on staging.** The screens that assume G/K/D (the
   calendar, coverage, pickers, the widget snapshot, the wall, nucleusAI's
   tools) take people from `people/`.
4. **Migration function.** For one household:
   - take a manual backup;
   - convert;
   - write the collections;
   - re-run the equivalence check server-side against the live record;
   - only if it matches, set `schemaVersion: 2`.
   `state/main` is kept, read-only, for 30 days.
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
6. **Photos move to Cloud Storage**, set per person in the app. The bundled
   Gage/Kaylene/Daisy photos are uploaded as your household's photos during
   migration.
