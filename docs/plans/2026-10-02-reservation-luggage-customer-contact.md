# Reservation luggage and customer contact implementation plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task by task.

**Goal:** Record a reservation's luggage and guest contact number once, show the recorded facts in the web reservation and queue, and show them to the assigned driver in the mobile app.

**Architecture:** `transportation_requests` remains the source of these Booking-owned facts. Both push and pull use `TransportationRequestSchema` and `ingestRequest`; the web list/detail and driver-scoped trip API project the same stored values. Existing records keep nulls, and every UI distinguishes missing data from a recorded luggage count of zero.

**Tech Stack:** Next.js 16.2.11, React 19, Zod 4, PostgreSQL via `pg`, Vitest, Expo/React Native driver app.

---

## Scope and proposed contract

The proposed fields are `luggage_count` (nullable integer, 0–99), `luggage_notes` (nullable text, at most 500 characters), and `guest_phone` (nullable string, at most 50 characters). The UI labels are **Luggage count** and **Customer phone** or **Guest phone**; the mobile API may alias the phone as `passenger_phone` to match the existing map call control. `null` means the luggage count was not supplied; `0` means explicitly no luggage. Do not derive luggage count from passenger count or parse it from `special_requests`. Optional notes can describe size or handling needs without replacing the numeric count.

These are optional at intake so existing Booking senders and historical reservations remain valid. The in-app `/reservations/new` page simulates the Booking side of the boundary; it can collect the fields, but Fleet's normal reservation lifecycle must not start editing parent-owned guest facts. A replay with the same `external_booking_id` keeps the existing row untouched under the current idempotency rule. Any later correction flow needs a separate Booking contract decision.

The phone is the guest/customer contact for this transport request, not a driver or booking-agent number. Keep punctuation and `+` for display; trim surrounding whitespace and reject control characters, but do not require a Philippine-only format. For a `tel:` action, construct the URI from an allowlisted dial string (`+`, digits, and necessary dial punctuation) and hide or disable the action when no usable number exists. Do not add the phone to URL parameters, audit messages, Copilot prompts, or analytics exports. The existing inbound `integration_log.payload` stores parsed requests and needs an explicit redaction change in Task 2.

The mobile trip API already limits rows to the authenticated driver's `driver_id`. Show phone and luggage on Trip Details; show luggage in the Trips card only if it fits without displacing route and status. The Live Map passenger sheet can show the same luggage facts and use its existing call control when a phone exists. The queue shows the count in both grid/list rows and the notes in the selected reservation/detail context; the customer phone belongs in detail, not every dense queue row.

**Confirmed terminology:** The user wants a **number of luggage items**, displayed as **Luggage: 0** or **Luggage: N** throughout web and mobile. Optional luggage notes remain proposed. **Decision to confirm before implementation:** whether “customer phone” means guest, booker, or both. This plan assumes guest phone; adjust the contract and projections together if the answer differs.

## Task 1: Verify the live migration baseline and add nullable columns

**Files:**
- Create: `supabase/migrations/<next-unused>_reservation_luggage_guest_phone.sql` (choose after the live ledger check; `141` is only the next filename visible locally, not a reserved version)
- Generated: `schema.sql`
- Test/verification: `scripts/migrate.mjs`, `scripts/verify-db-contract.mjs`, `scripts/verify-anon-access.mjs`

1. Run `npm.cmd run db:status` from the repository root and inspect the complete applied/pending/missing ledger before choosing a number. On this planning pass it exited `status failed:` without detail in the restricted environment, so the next version is **not verified**. Run `npm.cmd run db:check` as the offline filename gate.
2. Add the three columns with `ADD COLUMN IF NOT EXISTS`; keep them nullable and add a named, idempotent `CHECK (luggage_count IS NULL OR luggage_count BETWEEN 0 AND 99)`. Add concise column comments stating that these are cached Booking facts and null means not supplied. Do not backfill from passenger count, `special_requests`, or the retired `vehiclereservations.guest_phone`.
3. Apply with `npm.cmd run db:up`, then `npm.cmd run db:dump`. Review the generated `schema.sql` diff; never hand edit it. Verify the three columns and check constraint through `information_schema`/`pg_constraint` against the live `public` database.
4. Run `npm.cmd run db:contract` and `npm.cmd run verify:anon` after the migration. It adds columns to an existing classified table, but the guest phone raises the sensitivity of any accidental grant or RLS drift. Resolve every `200 []` probe against the live contract rather than treating it as a pass.

**Exit:** migration applies once and reruns safely, existing rows retain nulls, live catalog and generated schema agree, and anon access remains closed.

## Task 2: Extend both Booking ingest paths through the shared contract

**Files:**
- Modify: `src/lib/integration/contracts.js`
- Modify: `src/lib/integration/ingest.js`
- Modify: `src/lib/integration/booking-gateway.js` only to make mock sample data exercise the new fields
- Test: `src/lib/integration/ingest.test.js`
- Add or extend the nearest contract parser test under `src/lib/integration/`

1. Add optional nullable schema properties for `luggage_count`, `luggage_notes`, and `guest_phone`. Reject negative, fractional, out-of-range, oversized, and control-character values. Normalize blank notes/phone to null; preserve explicit `0` for luggage. Do not use a loose numeric coercion that turns a blank string into zero.
2. Add all three columns and parameter values to `ingestRequest`'s single `INSERT ... RETURNING *`. Both `POST /api/integration/transport-requests` and `POST /api/integration/pull` already call this function; do not add parallel SQL to either route. Keep the existing idempotent replay behavior.
3. Test push/pull statement parity, omitted and zero count, populated notes/phone, invalid values, and replay of the same external booking ID. Update positional insert assertions in `ingest.test.js` to assert by column/parameter mapping so the new tail does not silently shift expectations.
4. Keep errors and audit metadata free of the phone. The existing inbound `integration_log.payload` records the parsed request: omit `guest_phone` (and free-text `luggage_notes`) from that reconciliation payload while retaining booking ID, source, and operational fields needed for matching. Verify no other logging path serializes the raw inbound body. Record the redaction in the integration boundary note.

**Exit:** a request created through either door stores the same three values; old payloads still create successfully; duplicate deliveries do not overwrite existing guest data.

## Task 3: Collect and display the facts on web reservations

**Files:**
- Modify: `src/app/(dashboard)/reservations/new/page.js`
- Modify: `src/app/(dashboard)/reservations/[id]/page.js`
- Verify: `src/app/api/integration/transport-requests/[id]/route.js` (`SELECT tr.*` already returns the added columns)

1. Add a nonnegative **Luggage count** input that supports empty/unrecorded separately from zero, a short luggage-notes input, and a `type="tel"` customer-phone input with `autoComplete="tel"`. Apply the same limits and trim rules as the contract; keep helpful inline errors. Do not put a sample real-looking phone in the random-fill action unless clearly synthetic.
2. Include the three values in the existing `injectTransportRequest` payload. Preserve the current submit, idempotent outcome, and query invalidation behavior.
3. In reservation detail, show **Luggage: Not recorded / Luggage: 0 / Luggage: N**, optional notes, and a labeled customer contact value only when supplied. Use plain text for unknown phone, without a dead call button. Keep driver phone in its separate driver section.
4. Test form-to-payload normalization and detail formatting for null, zero, and populated cases. A single meaningful component or pure-formatting test is enough; do not add tests that only mirror JSX.

**Exit:** staff can submit and reread the fields on a new request without confusing customer and driver contact numbers.

## Task 4: Update reservation queue projections and both view modes

**Files:**
- Modify: `src/app/api/integration/transport-requests/route.js` (`TR_LIST_SELECT`, `TR_CARD_SELECT`)
- Modify: `src/components/reservations/reservation-queue-table.jsx`
- Modify: `src/app/(dashboard)/reservations/queue/page.js` only if the selected context needs a luggage-notes or phone field
- Test: `src/components/reservations/queue-workspace.test.js` or a small formatter test alongside the queue component

1. Add `luggage_count` to the paginated register and queue projections; add `luggage_notes` and `guest_phone` only to the detail/selected-request surface that uses them. The full `tr.*` path already contains them, but current paginated card/list reads use explicit projections.
2. Remove both `luggage_count ?? passenger_count` fallbacks in queue grid/list. Render an actual zero as **Luggage: 0** and a positive value as **Luggage: N**; render null as **Luggage not recorded** (or omit the compact metric while keeping the detail label explicit). Preserve passenger count as its own fact.
3. Keep long notes and phone off the dense row. If the queue has no suitable selected-request detail area, link to the existing reservation detail rather than expanding every row. Ensure search/filter/sort and 30-second polling do not reset the selected record merely because these fields change.
4. Test both view modes or their shared formatter with `null`, `0`, and a positive count. Test the paginated queue response contains the persisted field, since `TR_CARD_SELECT` is not `tr.*`.

**Exit:** the queue never substitutes passenger count for luggage count, and operators can find the recorded luggage details.

## Task 5: Project only the assigned driver's facts and render mobile

**Files:**
- Modify: `src/app/api/mobile/driver/trips/route.js`
- Modify: `mobile/app/(app)/trip/[id].js`
- Modify: `mobile/app/(app)/(tabs)/trips.js` for a compact luggage metric if layout permits
- Modify: `mobile/app/(app)/(tabs)/map.js` for its passenger sheet and existing call control
- Modify: `mobile/lib/trip-detail.js` if a shared count/phone presentation helper is useful
- Test: `src/app/api/mobile/driver/trips/route.test.js`, `mobile/lib/trip-detail.test.js`

1. Extend the existing `LEFT JOIN transportation_requests tr` projection with `tr.luggage_count`, `tr.luggage_notes`, and `tr.guest_phone AS passenger_phone` for nonterminal trips; return null phone for Completed/Cancelled trips and null fields for a trip without a linked reservation. Preserve the `t.driver_id = session.user.driverId` predicate and the 1–100 row cap; never add a request-controlled driver ID.
2. Add a Luggage section to Trip Details next to Passenger and Special Requests. Show count zero distinctly, hide empty notes, and say **Not recorded** for null. Show the customer phone and a call action only if a usable number exists; keep the no-phone state readable without an inert button.
3. In the Live Map passenger sheet, show the same luggage facts and make the existing call control conditional. Avoid interpolating raw input directly into `tel:`. Do not broaden the map or lifecycle APIs.
4. If the Trips list displays a luggage count, use only the API value and keep route, scheduled time, and status ahead of it. Long notes and the phone stay on detail/map.
5. The driver app currently writes entire trip responses to per-driver AsyncStorage caches with no TTL (`TRIPS_ALL`, `HOME_TRIPS`, and per-trip key). Add a small cache projection that removes `passenger_phone` before every one of those writes. Luggage may remain cached. On a cached offline trip, label contact unavailable rather than showing a stale or invented number. Check logout/session-death cache clearing still works.
6. Test assigned-driver scoping, API field projection, absent reservation, count zero, no/invalid phone, and dial URI behavior. Run the relevant mobile Vitest suite and an Android Expo export. Before implementation, read the versioned Expo guide required by `mobile/AGENTS.md`; before editing Next code, read the relevant `node_modules/next/dist/docs/` guide required by root `AGENTS.md`.

**Exit:** the assigned driver sees the same recorded luggage and contact as web; unrelated drivers cannot request the trip; no phone is fabricated or exposed through local cache by accident.

## Task 6: End-to-end acceptance and documentation

**Files:**
- Update: `Capstone/02 - Features/Reservations.md`
- Update: `Capstone/03 - Database/Tables/transportation_requests.md`
- Update: `Capstone/04 - Architecture/Mobile Architecture.md`
- Update: `Capstone/01 - System/System Boundaries.md` if the Booking contract changes as above
- Update: `SYSTEM.md`

1. Run focused Vitest checks, changed-file ESLint, `npm.cmd run db:check`, `npm.cmd run db:contract`, and `npm.cmd run verify:anon`; run the full app build if the touched routes/components pass focused checks. Record command results and any environment limitation accurately.
2. With a clearly disposable reservation, exercise web create → persisted detail → queue grid/list → assign to a driver → driver Trips/Trip Details/Live Map. Verify `0`, positive, and missing luggage counts; optional notes; valid/blank phone; no linked reservation; and old rows with nulls. Check the phone is visible only to the assigned driver and the call action opens the intended number on a device. Remove any disposable cloud data only with the user's explicit authorization.
3. Update the four Capstone notes and `SYSTEM.md` with actual behavior, migration number, and observed verification, rather than marking this proposed plan as implemented. Roll out the nullable DB migration first, then web API/UI, then mobile client. Older mobile clients ignore additive fields; old Booking senders omit them safely.

**Completion criteria:** one persisted source of truth, no invented luggage counts, guest contact visible on web and to the assigned mobile driver, optional old payload compatibility, driver-scoped authorization, and verified database/anon protections.
