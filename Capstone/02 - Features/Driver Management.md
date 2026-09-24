---
type: feature
status: working
tags: [feature, drivers, ocr, consent]
source:
  - src/lib/driver/grounding.js
  - src/lib/consent/driver-visibility.js
  - src/app/api/driver
  - supabase/migrations/024_driverincidents.sql
  - supabase/migrations/049_driver_work_schedule_and_leave.sql
  - src/lib/scheduling/driver-schedule.js
  - src/services/driver-schedule.service.js
last_verified: 2026-09-23
related: ["[[Mobile Architecture]]", "[[Fleet And Vehicles]]"]
---

# Feature: Driver Management

## What it does

Driver records, licences (with OCR), documents, availability, incidents, consent, and performance. 23 drivers.

## Driver ≠ employee, exactly

A driver **is** an employee with a `drivers` row. Credentials and `role_id` live on [[employees]]; licence, availability and performance on `drivers`. Mobile login authenticates against `employees`, then resolves a `driverId`. → [[Authentication]]

## Licence scan — Gemini extraction (replaced Tesseract 2026-08-25)

`src/lib/ai/gemini-document.js` sends the licence photo to **Gemini structured output** (`gemini-3.1-flash-lite`, 12-second timeout, JSON `responseSchema`) and returns normalized fields directly — no OCR text, no regex parsing. `tesseract.js` was removed from the app entirely; scanning now happens **only server-side** in `/api/ai/scan-document` and `/api/driver/license-scan`.

Unreadable or absent fields come back `null`, never guessed. If Gemini is unconfigured, rate-limited, or times out, the endpoint returns empty extracted data with a validation issue and the user types the details — same graceful-degradation contract as before, one fewer moving part. → [[Graceful Degradation]]

Model selection: env `GEMINI_DOCUMENT_MODEL` overrides, then a gemini-2.5/3.x model configured on the provider row, else `gemini-3.1-flash-lite` (the only model confirmed working + fast for this API key on 2026-08-22).

## Licence image entry — URL paste removed 2026-09-18

The admin driver forms (`drivers/new/page.js`, `drivers/[id]/edit/page.js`) each carried **two free-text inputs** — "Or paste Front/Back License Image URL..." — that accepted any string and bound anything starting with `http` straight to an `<img src>` preview on keystroke, with no host validation. All four are removed (47 lines, no additions). Upload, Gemini scan, rotate, the preview and the enlarge modal are unaffected: the value is still set programmatically by the upload path (`new:200/233`, `edit:101/225/260`), never by typing.

**The paste inputs were only one of two ways in — the second is now closed too.** The write path accepted the field as well: `POST /api/drivers` destructured `license_image_url` from the request body and wrote it unvalidated, with the field absent from `validateBody` (`route.js:251`) entirely; the `employees.avatar_url` copy (`:339`) checked only `startsWith("http") && length <= 512`, a scheme check wearing a host check's clothing. `PUT /api/drivers/[id]` matched (`[id]/route.js:202, 228` — the export is **PUT**). So a direct API call could store a foreign host; removing the inputs was a UI change, and that distinction was the point.

**Closed 2026-09-18 — SEC-UPLOAD-008 (MEDIUM).** Both schemas now carry `license_image_url` / `license_back_image_url` as a `mediaUrl` type, and both `avatar_url` copies route through the same rule. `isAllowedStoredImageRef` (`src/lib/validation/index.js`) accepts an inline base64 image or a URL on a fleet-controlled origin, and routes `data:` to the **strict** `isBase64DataUrl` — the guard alone returns true for any `data:image/` prefix (`remote-url.js:34`), which would admit `data:image/svg+xml,<svg …>`. The 512-char cap on the avatar copy is kept deliberately: it is why a multi-megabyte scan never lands in `employees.avatar_url`.

The writer must already hold `drivers:create`/`update`, and the self-service route was always strict (`driver/me:219,253`), so a driver could never set a foreign host — the gap was defence-in-depth, with the CSP `img-src` narrowing as the only line behind it. `next.config.mjs` and this rule now draw from the **same** env-derived allow-list, so the browser-side and server-side lists cannot drift.

A live census (40 driver rows) found **zero** stored licence references, so this never manifested in data. Full record, the fail-before caveat, and what stays open: → [[Bugs]] SEC-UPLOAD-008. **SEC-UPLOAD-003** (ten-year signed TTLs) and **SEC-UPLOAD-006** (`getPublicUrl` on the private `driver-licenses` bucket) remain open.

## Licence media: the column holds an OBJECT KEY, not a URL — 2026-09-18

**SEC-UPLOAD-006 is closed. SEC-UPLOAD-003 is PARTIALLY CLOSED** — both phases of
the storage remediation landed on 2026-09-18. The code no longer mints or
persists a long-lived URL; the ten-year tokens already sitting in
`drivers.face_image_url` and `employees.avatar_url` (1 row each, measured) were
**not** revoked, because revoking them is a production-data action that needs its
own approval. See → [[Bugs]] for the full record and the census.

The four media columns on a driver (`face_image_url`, `license_image_url`,
`license_back_image_url`) and the `employees.avatar_url` mirror now hold a
**bucket-qualified object key** — `driver-licenses/12/6f1c….jpg` — and the route
mints a short-lived signed URL (1 hour) when it serializes the row. The four
columns that bear a driver's face or licence are in **private** buckets, so a
stored URL is a bearer credential written down; a key has no scheme, no host, no
token and no expiry, so there is nothing to leak and nothing to revoke.

| Piece | Where |
|---|---|
| The key format, and what a key may contain | `src/lib/storage/key-format.js` |
| Resolve a key **or a legacy URL** to a fresh signed URL | `src/lib/storage/object-refs.js` |
| Reduce an echoed value back to a key | `canonicalStoredRef` (same module) |
| Sign a driver-shaped payload | `src/lib/drivers/media.js` |

**Readers sign at the API boundary, so no UI component changed.**
`drivers/route.js`, `drivers/[id]/route.js`, `auth/profile/route.js` and
`driver/me/route.js` each resolve before responding, which covers every
downstream consumer — `drivers/[id]/page.js:121`, the edit form, `use-auth`,
`app-shell.jsx:348`, `user-dropdown.jsx:52`. They still receive a URL; it just
expires now.

**Two invariants a future edit must not break.** They are not obvious from
either side alone, which is why they are written down here:

1. **A legacy URL is RECOVERED, never passed through.** Both storage URL shapes
   (`/object/public/…`, `/object/sign/…`) carry the object key in their path, so
   the reader recovers the key and re-signs. Handing the URL back because its
   host is allow-listed is exactly the bug: a `getPublicUrl` value's host *is*
   the Supabase URL, and on a private bucket that URL authorizes nothing.
   Unrecoverable → `null` **and a warning**, never passed and never silently
   dropped.
2. **The write path canonicalises.** The admin edit form seeds from the loaded
   driver and submits it back on **every** save (`edit/page.js:116,295`), so
   without `toStoredMediaRef` each save would persist whichever short-lived URL
   the reader just minted — re-creating SEC-UPLOAD-003 through the read path.
   `driver/me`'s `face_image_url` PATCH is canonicalised for the same reason.

`employees.avatar_url` is the one column whose bucket cannot be assumed — it
receives keys from both `face-captures` (the driver's own photo) and
`driver-licenses` (the front-scan mirror). That is why stored values carry their
bucket as a prefix, and why the reader treats a qualified prefix as
authoritative over the column it was found in.

`vehicle-images` is deliberately **not** in the key vocabulary: it is public by
design (migration 050) and is read by URL, not signed.

## Consent and self-service visibility — CONFIRMED

`src/lib/consent/driver-visibility.js`:

```js
DRIVER_VISIBLE_SECTIONS = [profile, license, performance, trip_history, attendance]
DRIVER_SELF_EDITABLE_FIELDS = ["phone", "face_image_url",
                               "license_image_url", "license_back_image_url"]
LICENSE_REUPLOAD_WINDOW_DAYS = 30
```

An **allow-list**, not a deny-list. A driver can edit exactly four fields; anything new added to the table is not editable until someone deliberately adds it. That's the safe default. → [[Fail Closed By Default]]

> **Face photo self-service (2026-09-13):** `face_image_url` was whitelisted
> for years but no client could set it (PATCH takes a URL; nothing minted
> one). Now `POST /api/driver/face-photo` + the Profile-tab pencil badge
> close the loop — one upload fills the avatar AND the attendance
> face-verification reference. Full flow: → [[Driver Consent]]
>
> **Web sync (2026-09-13, display-only):** the photo renders across all web
> surfaces with initials fallbacks — staff detail header (`AvatarImage` on
> the existing `face → avatar → license` chain), staff list name cell,
> performance table (report payload extended additively; Excel ignores the
> extra keys), the driver's own `/driver/profile` header, the global
> `UserDropdown` (trigger and dropdown card header), and the `AppShell`
> sidebar user footer. NextAuth session propagation and `GET /api/auth/profile`
> ensure live sync without requiring re-login. Mobile `DriverHomeHeader` also
> reflects the uploaded face photo.
>
> **Full sweep (2026-09-16):** the same `face_image_url → avatar_url →
> initials` chain now renders on EVERY staff surface that names a driver via
> the shared `src/components/drivers/driver-avatar.jsx` (`resolveDriverPhotoUrl`
> + `DriverAvatar`, broken-URL falls back to initials): incidents table +
> responder line, document-expiry driver tab, trips table (now links to the
> profile), fuel records + fuel-request review, assignments tables + picker,
> leave board, reservations register + detail, dispatch board cards + detail +
> calendar drawer, both availability boards, live-map selected mission,
> dashboard coverage table, executive snapshot, command-palette results.
> Every driver-bearing API now selects both photo columns additively
> (trips, dispatch by-status/[id]/calendar/availability-pairs,
> incidents + [id], documents/expiring, fuel + fuel-requests, assignments,
> substitute schedules, leave list, transport-requests list/card/[id],
> search) behind the existing `requirePermission` guards — RBAC unchanged,
> driver role still excluded from roster reads. Verified: ESLint clean,
> 180 tests pass, route-auth audit 270/270.

`canUpdateLicenseScan()` used to enforce a 30-day re-upload window — removed 2026-08-25: re-upload is allowed anytime, gated instead by Gemini's authenticity/readability check. → [[ADR-012 Anytime Self-Service License Renewal]]

## The Sev-1 bug — FIXED 2026-08-11

`shouldGroundVehicle()` **grounded every vehicle on any incident**, ignoring `incidentType` and `severity` — and its test asserted that was correct. The rule it was supposed to implement was written in its own docstring the whole time.

Now: grounds on a breakdown-type report **or** Major/Critical severity, and never without a `vehicleId`.

→ [[BUG shouldGroundVehicle Is A Stub]] · [[Tests Can Encode Bugs]]

## Incidents were broken once already — CONFIRMED

Migration `024_driverincidents.sql` recreates a table that `005` dropped:

> *"The driver portal and /api/driver/incidents still reference it, so it was missing at runtime and incident reporting was broken."*

A migration removed a table that live code still used, and nothing caught it. → [[Migrations]]

## Incident lifecycle — CONFIRMED 2026-08-23

Report → ground → resolve is now a closed loop with the driver. Resolving restores
vehicle availability, requires a documented `actions_taken`, notifies the reporter,
and offline submissions are idempotent (`client_submission_id`). Full rules and
remaining limits: → [[Incidents]]

## License-compliance suspension — CONFIRMED 2026-08-23

Expired license ⇒ auto-`Suspended`, now **with an inverse**: `drivers.suspension_reason`
(migration 064) marks compliance suspensions (`license_expired`), and saving a valid
future expiry reinstates automatically — audit + staff notification on both the suspend
and the reinstate. Manual/legacy suspensions (reason NULL) are never touched by code.
Pure rule in `src/lib/drivers/compliance.js`; driver page carries a Reinstate banner
for the lingering-flag case. → [[GAP Compliance Suspension Had No Inverse]]

## Legal age — enforced 2026-09-23

`drivers.birthdate` carries a **legal-age floor of 18 years**. PH LTO issues a
professional driver's licence from 18 and every row in this registry is a licensed
driver, so no driver may be recorded as younger than that.

The rule lives in exactly one place: `src/lib/validation/age.js`
(`LEGAL_DRIVING_AGE`, `legalAgeCutoff`, `isAtLeastAge`), a dependency-free module
re-exported from `src/lib/validation/index.js`. It is deliberately separate from
that barrel because the birthdate picker is a client component and importing the
barrel would pull the security and storage helpers into the browser bundle.

Enforced at three layers, all reading the same rule:

| Layer | Where |
|---|---|
| The picker cannot offer it | `minAge={LEGAL_DRIVING_AGE}` on the `DatePicker` in `drivers/new` and `drivers/[id]/edit` |
| The form rejects it | `driverSchema.birthdate` via `dateString("Birthdate", { minAge })` |
| The API rejects it | `validate: (v) => isAtLeastAge(...)` on the `birthdate` spec in both `POST /api/drivers` and `PUT /api/drivers/[id]` |

**The API layer is the one that matters.** `driverSchema` is only the form's
resolver — it never runs on the server, because no application code runs on a
direct API call. The routes validate through the declarative `validateBody` spec
in `src/lib/validation/helpers.js`, so the rule is attached as that spec's
`validate` hook rather than assumed to travel with the zod schema.

**Why `legalAgeCutoff` builds a date from calendar parts instead of subtracting.**
On Feb 29 a naive 18-year subtraction rolls to Mar 1, admitting a birthdate one
day too young. The cutoff clamps the day to the target month's length and
compares year → month → day, so a leap day cannot widen the floor. A person whose
18th birthday is today passes; one day later does not.

Blank stays valid — the field is optional, and the rule only ever restricts a date
that was actually supplied. A live census before the change found **55 driver rows,
53 with a null birthdate and 0 underage**, so no existing record is blocked by it.

## Database tables used

`drivers` (23) · [[employees]] (47) · [[driver_vehicle_assignments]] · `driverincidents` · `driver_documents` · `driver_consents` · `driverattendance` **0 rows** · `driver_stats` (view) · [[mobile_refresh_tokens]] (57)

> **2026-09-24 — the two address surfaces are migrated onto the [[addresses]] registry.** `drivers.address_id` and `drivers.emergency_contact_address_id` existed since migration `122` and **nothing had ever read or written either**; both are now written. The Address inputs on `/drivers/new` and `/drivers/[id]/edit` are no longer text boxes — the operator picks through the Region → Province → City/Municipality → Barangay cascade, and `POST`/`PUT /api/drivers` resolve the pick **server-side**, deriving the geography from the barangay code rather than believing the text sent beside it.
>
> **No migration was needed** — the columns, their FK to `addresses(address_id)` and the index all already existed. This was an application change only.
>
> **The composed address is mirrored into `drivers.address` / `emergency_contact_address`**, the same maintained denormalization `locations.address` is. That is what keeps every existing reader working unchanged: `/drivers/[id]` still renders those two text columns and was not touched. The pick WINS over the submitted string when both arrive, because the server composed it from its own resolution — so the text and the registry row it points at are guaranteed to describe the same place.
>
> **This is the first surface where the map pin is enabled.** The canonical-location and hotel dialogs pass `showPinMap={false}` because the location already owns a point; a driver's home has no other coordinate owner — `drivers` carries live and standby positions, never a residential one. It is also the first live exercise of `chk_addresses_coords_pair`'s both-present branch, since the address rows written before this were all NULL/NULL. `forcedType="home"` with the type selector hidden, the mirror image of the canonical-location surface forcing `operational`.
>
> **Both routes fail hard, and that is now the point rather than a nicety.** `PUT` was already close, and its shape is worth stating exactly: the two registry rows are written in **one** `withTransaction` and the driver `UPDATE` runs *after* it, so a registry refusal refuses the whole request with nothing written at all. The one gap is the converse — if the driver `UPDATE` fails *after* the addresses commit, those rows are orphaned. Harmless by construction: the registry is append-only and nothing joins to it by value, and the caller still gets a failure. **`POST` was not atomic at all, and was restructured to become so.** Its employee and driver inserts went through the Supabase client (PostgREST over HTTPS), which cannot be enrolled in a `pg` `BEGIN`/`COMMIT` — a separate HTTP service is not a transaction handle — so the addresses were written in a *second* transaction and a failure there left a committed driver with both ids NULL, reported as a `warning`. Both inserts now run on `tx.query` inside one transaction, the addresses are written **before** the driver row so their ids go straight into its column list, and any failure rolls back all of it: no employee, no driver, no registry rows. The `warning` field and the old soft-delete-the-employee compensation are both gone. Neither insert needed anything only PostgREST provides — both are plain INSERTs with a `RETURNING` and a unique-violation check. See [[ADR-015 Address Owns Administration, Location Owns The Point]].
>
> **Not backfilled.** Existing drivers keep `address_id = NULL` and keep reading from their text columns; a driver is upgraded when a human next edits them, the same rule ADR-015 point (6) set for the locations. Design intent retained from the original note: a personal address is still **advisory** — an unverified address saves rather than blocks.

## Weekly work schedules & leave — CONFIRMED 2026-08-15

Migration `049_driver_work_schedule_and_leave.sql` adds `driver_work_schedules`
(one row per driver per `day_of_week`, `shift_start`/`shift_end`/`break_start`/
`break_end` TIME, `is_rest_day`, unique `(driver_id, day_of_week)`) and
`driver_leave_requests` (`start_date`/`end_date`/`leave_type`/`reason`/`status`
Pending|Approved|Declined, reviewed_by/notes/at).

Rules:

- **Fleet manager owns the schedule.** Only `system_admin`/`fleet_manager` write
  (`PUT /api/driver-work-schedules`); admin observes. Write policies in 049 are
  `system_admin` + `fleet_manager` only — matching the directive that admin is
  never the schedule writer. → [[Why RLS Is Not A Boundary]]
- **Fail-closed availability.** A driver with no schedule row is **not assignable**
  ("No work schedule"). Fail-open only when a caller never loaded schedule context
  (`driverBlockReason` returns null on `!ctx?.schedules`); fail-closed whenever
  context was loaded and the map is empty. Pure core: `scheduleBlockReason`
  (`src/lib/scheduling/driver-schedule.js`). → [[Fail Closed By Default]]
- **Blocking rule order**: approved leave covers the date → block; no row for that
  `day_of_week` → block; rest day → block; window not fully inside shift
  (`!(pickup >= shift_start && returnAt <= shift_end)`) → block; half-open break
  overlap (`break_start < returnAt && break_end > pickup`) → block.
- **Leave lifecycle**: driver files via `POST /api/driver/leave` (self, Pending);
  fleet manager approves/declines via `PATCH /api/driver-leave-requests/[id]`
  (409 if an overlapping request is already Approved). Driver withdraws Pending
  via `DELETE /api/driver/leave`. Only **Approved** leave blocks assignment.
- **Server TZ is Asia/Manila.** `localDayOfWeek`/`localTimeOfDay` use Date local
  getters, consistent with the `toCalendarDay` convention.
- Backfilled **49 rows** (drivers 1, 2, 19, 20, 21, 22, 26 × 7 days, 06:00–22:00,
  break 12:00–13:00, no rest days) so live enforcement could be verified without
  inventing a rest-day policy.

Enforcement surfaces: `GET /api/drivers` (windowed), `GET /api/vehicles/available`
(windowed, effective driver from `ctx.pairings`), `pair-scoring.js`
(`isDriverUnavailableFor` + `resolveVehiclePairing` + `buildFleetPairRecommendations`),
`recommendation.service.js` `validatePairAvailability`, `dispatch-advisor.js`,
the transport-request recommendation route, `conflicts.js` (DRIVER_UNAVAILABLE),
`trips/[id]/start` gate, and the dispatch calendar probe.

UI: `WorkScheduleCard` on the driver detail page (schedule editor gated
fleet_manager), `/drivers/leave` review board (fleet_manager approves),
`/driver/schedule` self-service (view schedule, file/withdraw leave).

> **Scope note (2026-08-23):** the Driver Leave Requests review board
> (`/drivers/leave`) and Document Expiration (`/fleet/documents`) pages are
> **hidden from navigation** (sidebar + command palette) as out-of-scope for
> the capstone demo. The routes, APIs, and data are intact — direct URL
> access still works for allowed roles (`permissions.js` unchanged). The
> driver's own `/driver/schedule` entry stays visible.

## Open questions

- `driverattendance` has 0 rows but is a `DRIVER_VISIBLE_SECTIONS` entry — is attendance actually implemented? **TODO:** check for a writer.
- The old "Standard Morning Shift" card was replaced by the real schedule; the
  static 06:00–02:00 assumption is gone. Backfilled hours are a neutral default,
  **not** a policy — the fleet manager should set real shifts via the editor.

## Related

[[employees]] · [[driver_vehicle_assignments]] · [[Mobile Architecture]] · [[Driver Consent]] · [[Feature Index]]
