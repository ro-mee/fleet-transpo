# Fleet ↔ Hotel/POS Must-Haves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the four panel-proof gaps (room/guest reference, folio/billing flag+amount on COMPLETED, Booking-initiated cancel/modify, gateway-ready HTTP adapter + reconcile) without connecting to a live PMS/POS.

**Architecture:** One idempotent migration adds reference + billing columns to `transportation_requests` only (no new tables, so no RLS/grant surface change). Contracts (`contracts.js`) stay the single boundary truth; `ingest.js` stays the single writer; `outbound.service.js` stays the single emitter; `advanceReservation()` stays the single status writer. Gateway stays `mock` by default; `http` mode becomes a real, tested, credential-gated client that is never enabled until the parent team hands over URL+key.

**Tech Stack:** Next.js 16 App Router route handlers, Zod contracts, `pg` via `src/lib/db.js`, vitest, `scripts/migrate.mjs` ledger (`db:status` / `db:up` / `db:dump`), `db:contract` + `verify:anon` gates.

## Global Constraints

- Migration file MUST be idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`); live DB is ahead of files in places, so every statement must be a safe no-op there.
- NEVER reuse a migration number; run `npm run db:status` first — `ls supabase/migrations/` is NOT sufficient (ledger holds numbers with no file: `113`, `114`, `115`, `141`, `142` are spent). As of 2026-10-06 the highest on-disk file is `143_mechanic_assignment.sql`, so the candidate next number is `144` — re-confirm at execution time.
- `schema.sql` is generated — never edit by hand; commit the `db:dump` diff as the review artifact.
- New tables: none. If any task ever adds one, it MUST enable RLS explicitly + `REVOKE ALL ... FROM anon, authenticated` + register in `scripts/lib/schema-contract.mjs` (else `npm test` fails and `verify:anon` goes INCONCLUSIVE/EXPOSED).
- Outbound delivery is best-effort: a Booking failure never rolls back the Fleet transition; it stays `failed` in `integration_log` for reconcile.
- Inbound ingest is idempotent on `external_booking_id` (replay returns `{ idempotent: true }`, never a duplicate row).
- No credentials in scripts; `scripts/load-env.mjs` reads `.env`. `BOOKING_API_URL` / `BOOKING_API_KEY` / `BOOKING_WEBHOOK_SECRET` / `CRON_SECRET` stay unset locally — readiness means code + tests + docs, not live keys.
- Gateway default stays `mock` (`BOOKING_GATEWAY` absent → mock). `http` mode must fail closed with a loud error when URL/key are missing, never silently return `[]`.
- Every task ends with its own test cycle + `git diff --check` + touched-file ESLint; full suite + `lint:ci` + production build before merge.

---

### Task 1: Migration — guest/room reference + billing columns on `transportation_requests`

**Files:**
- Create: `supabase/migrations/144_transport_request_guest_folio.sql` (number re-confirmed via `db:status` at execution; use next free if `144` is spent by then)
- Test: `supabase/migrations/144_transport_request_guest_folio.sql` (verified via `information_schema`, not a vitest file — see steps)
- Reference: `schema.sql` (regenerated, never hand-edited)

**Interfaces:**
- Consumes: live `transportation_requests` definition (`schema.sql:960-1003` — has NO `guest_id` / `room_number` / `bill_to_room` today; old `004_integration_sub_system.sql:105-107` put them on the dropped `vehiclereservations`, proving the gap)
- Produces: columns `guest_id TEXT NULL`, `room_number VARCHAR(20) NULL`, `hotel_branch VARCHAR(100) NULL`, `bill_to_room BOOLEAN NOT NULL DEFAULT FALSE`, `charge_amount NUMERIC(12,2) NULL`, `charge_currency CHAR(3) NOT NULL DEFAULT 'PHP'`, `charge_status VARCHAR(20) NOT NULL DEFAULT 'not_chargeable'` + CHECK `charge_status IN ('not_chargeable','pending','posted','failed','waived')` + partial index on `(charge_status) WHERE charge_status = 'pending'`

- [ ] **Step 1: Confirm the next free migration number**

Run: `npm run db:status`
Expected: `pending 0`, ledger-missing set still includes `113/114/115/141/142`; highest on-disk `143`. If `144_*` already exists or ledger shows `144` spent, use the next free integer and rename every `144` reference in this plan.

- [ ] **Step 2: Write the migration file**

```sql
-- 144_transport_request_guest_folio.sql
-- Guest/room reference (PMS-owned, cached read-only) + folio/billing intent.
-- Idempotent: safe no-op where columns already exist.
ALTER TABLE transportation_requests
  ADD COLUMN IF NOT EXISTS guest_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS room_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS hotel_branch VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bill_to_room BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS charge_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS charge_currency CHAR(3) NOT NULL DEFAULT 'PHP',
  ADD COLUMN IF NOT EXISTS charge_status VARCHAR(20) NOT NULL DEFAULT 'not_chargeable';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_transport_charge_status'
  ) THEN
    ALTER TABLE transportation_requests
      ADD CONSTRAINT chk_transport_charge_status
      CHECK (charge_status IN ('not_chargeable','pending','posted','failed','waived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transport_requests_charge_pending
  ON transportation_requests (charge_status) WHERE charge_status = 'pending';
COMMENT ON COLUMN transportation_requests.guest_id IS 'PMS guest id, cached read-only; PMS is system of record.';
COMMENT ON COLUMN transportation_requests.room_number IS 'Hotel room for folio posting + dispatcher lookup; cached read-only.';
COMMENT ON COLUMN transportation_requests.bill_to_room IS 'Whether COMPLETED should emit a folio-charge intent for PMS to post.';
COMMENT ON COLUMN transportation_requests.charge_amount IS 'Computed at trip completion from trips cost columns; PMS posts it, Fleet never charges.';
```

- [ ] **Step 3: Apply + dump**

Run: `npm run db:up`
Expected: `applied 1, pending 0` (or `already applied` no-op on re-run — idempotency proof).

Run: `npm run db:dump`
Expected: `schema.sql` diff shows ONLY the 7 columns + 1 CHECK + 1 partial index on `transportation_requests`. Commit both files together.

- [ ] **Step 4: Verify presence on live (read-only probes)**

Run: `npm run db:contract` and `npm run verify:anon`
Expected: `db:contract` clean for `transportation_requests` (no new table → no new classification needed); `verify:anon` verdict for the table unchanged from baseline (no new exposure; columns are not a new endpoint).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/144_transport_request_guest_folio.sql schema.sql
git commit -m "feat(db): guest/room reference + folio intent on transportation_requests"
```

---

### Task 2: Boundary contract + ingest + read projections for the new fields

**Files:**
- Modify: `src/lib/integration/contracts.js:21-65` (inbound schema)
- Modify: `src/lib/integration/ingest.js:79-115` (INSERT column list)
- Modify: `src/app/api/integration/transport-requests/route.js:68-88` (`TR_LIST_SELECT`), `:123-146` (`TR_CARD_SELECT`), `:264-279` (search)
- Test: `src/lib/integration/ingest.test.js` (extend), `src/lib/integration/contracts.test.js` (new if absent — co-locate next to contracts.js)

**Interfaces:**
- Consumes: Task 1 columns.
- Produces: `parseTransportationRequest()` accepts and returns `{ guest_id, room_number, hotel_branch, bill_to_room }`; `ingestRequest()` persists them; GET list/card projections expose them; search matches `room_number` + `guest_id`.

- [ ] **Step 1: Write the failing contract test**

```js
// src/lib/integration/contracts.test.js
import { describe, it, expect } from "vitest";
import { parseTransportationRequest } from "./contracts.js";
describe("folio reference fields", () => {
  it("accepts guest/room/bill_to_room and defaults bill_to_room false", () => {
    const out = parseTransportationRequest({
      external_booking_id: "BK-TEST-001",
      pickup_location: "Main Lobby",
      pickup_datetime: "2026-10-06T14:30:00+08:00",
      guest_id: "G-77120",
      room_number: "1204",
      hotel_branch: "Manila",
      bill_to_room: true,
    });
    expect(out.guest_id).toBe("G-77120");
    expect(out.room_number).toBe("1204");
    expect(out.bill_to_room).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/integration/contracts.test.js`
Expected: FAIL (`guest_id` stripped / unknown key, `bill_to_room` missing).

- [ ] **Step 3: Minimal contract change (additive, permissive — never block ingest)**

```js
// contracts.js — inside TransportationRequestSchema, after guest_name:
guest_id: z.string().max(100).optional().nullable(),
room_number: z.string().max(20).optional().nullable(),
hotel_branch: z.string().max(100).optional().nullable(),
bill_to_room: z.coerce.boolean().optional().default(false),
```

Rule: all four OPTIONAL + nullable (except `bill_to_room` default `false`). A Booking sender that never heard of folio must still ingest. Never `z.string().min(1)` here — that would turn a missing room into a 400 and block intake.

- [ ] **Step 4: Persist in `ingest.js` INSERT (same order in columns + values)**

Add `guest_id, room_number, hotel_branch, bill_to_room` to the column list and `request.guest_id || null, request.room_number || null, request.hotel_branch || null, request.bill_to_room === true` to the params. Keep `RETURNING *` so the row echoes the new fields.

- [ ] **Step 5: Expose in GET projections + search**

Add `tr.guest_id, tr.room_number, tr.hotel_branch, tr.bill_to_room, tr.charge_amount, tr.charge_currency, tr.charge_status` to BOTH `TR_LIST_SELECT` and `TR_CARD_SELECT`. Extend the free-text search `OR` chain with `tr.room_number ILIKE $n OR tr.guest_id ILIKE $n`. Full-row `SELECT tr.*` path needs no change.

- [ ] **Step 6: Run tests + lint**

Run: `npx vitest run src/lib/integration/contracts.test.js src/lib/integration/ingest.test.js`
Expected: PASS. Then: `npx eslint src/lib/integration/contracts.js src/lib/integration/ingest.js src/app/api/integration/transport-requests/route.js --max-warnings 0`

- [ ] **Step 7: Commit**

```bash
git add src/lib/integration/contracts.js src/lib/integration/ingest.js "src/app/api/integration/transport-requests/route.js" src/lib/integration/contracts.test.js src/lib/integration/ingest.test.js
git commit -m "feat(integration): ingest + project guest/room/bill_to_room"
```

---

### Task 3: Folio/billing intent on COMPLETED (compute from `trips` costs, emit to Booking)

**Files:**
- Modify: `src/services/trip-lifecycle.service.js:190-218` (`completeTrip` → `advanceReservation` call)
- Modify: `src/services/outbound.service.js:35-53` (event builder — add `billing` block)
- Modify: `src/lib/integration/contracts.js:74-88` (`TransportStatusEventSchema` — add optional `billing`)
- Modify: `src/services/reservation-lifecycle.service.js:27-42` (`PATCHABLE` — add `charge_amount`, `charge_currency`, `charge_status`)
- Test: `src/services/trip-lifecycle.service.test.js` (COMPLETED carries billing), `src/services/outbound.service.test.js` (new or extend — billing passthrough)

**Interfaces:**
- Consumes: Task 1+2 columns; `trips` cost columns (`schema.sql:1045-1051`: `fuel_cost, toll_fees, parking_fees, driver_cost, maintenance_cost, miscellaneous_cost, total_cost` — already exist, no trip migration needed).
- Produces: on `COMPLETED`, request row gets `charge_amount/charge_currency/charge_status`; outbound `COMPLETED` event carries `billing: { bill_to_room, amount, currency, trip_id, distance_km } | null`; non-chargeable requests emit `billing: null` (never `amount: 0` masquerading as a charge).

Charge rule (panel-safe, honest): `amount = trips.total_cost ?? (fuel_cost + toll_fees + parking_fees + driver_cost + maintenance_cost + miscellaneous_cost)`; if all null/zero → `charge_status = 'not_chargeable'`, `billing = null`. Fleet NEVER posts to a folio — it emits intent; PMS posts. `bill_to_room = false` → same `not_chargeable` path regardless of costs.

- [ ] **Step 1: Write the failing outbound test**

```js
// src/services/outbound.service.test.js
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn(async () => ({ rows: [{ log_id: 1 }] })) }));
vi.mock("@/lib/integration/booking-gateway", () => ({
  getBookingGateway: () => ({ name: "mock", acknowledgeStatus: async (e) => ({ delivered: true, seen: e }) }),
});
import { emitTransportStatus } from "./outbound.service.js";
describe("folio billing block", () => {
  it("carries billing on COMPLETED when bill_to_room with amount", async () => {
    const res = await emitTransportStatus(
      { external_booking_id: "BK-1", request_id: 9, fleet_status: "Completed", source_system: "PMS" },
      { billing: { bill_to_room: true, amount: 1250.5, currency: "PHP", trip_id: 4 } }
    );
    expect(res.delivered).toBe(true);
  });
  it("sends billing null when not chargeable", async () => {
    const { getBookingGateway } = await import("@/lib/integration/booking-gateway");
    const seen = [];
    getBookingGateway().acknowledgeStatus = async (e) => { seen.push(e); return { delivered: true }; };
    await emitTransportStatus(
      { external_booking_id: "BK-2", request_id: 10, fleet_status: "Completed" }, { billing: null }
    );
    expect(seen[0].billing ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/services/outbound.service.test.js`
Expected: FAIL (`billing` dropped / schema rejects unknown key).

- [ ] **Step 3: Schema + emitter change**

```js
// contracts.js — inside TransportStatusEventSchema:
billing: z.object({
  bill_to_room: z.boolean(),
  amount: z.number().nonnegative().nullable(),
  currency: z.string().length(3).default("PHP"),
  trip_id: z.union([z.string(), z.number()]).optional().nullable(),
  distance_km: z.number().nonnegative().optional().nullable(),
}).optional().nullable(),
```

```js
// outbound.service.js — inside event builder, after eta:
billing: extra.billing ?? null,
```

- [ ] **Step 4: Compute + persist at completion (`trip-lifecycle.service.js`)**

In `completeTrip`, after `rows[0]` (completed trip) and before `advanceReservation({ toStatus: L.COMPLETED, ... })`: read `rows[0].total_cost ?? sum(parts)`; read the request's `bill_to_room`; derive `{ charge_amount, charge_status }` (`pending` iff `bill_to_room && amount > 0`, else `not_chargeable`); pass `patch: { charge_amount, charge_currency: 'PHP', charge_status }` (requires Task 3's `PATCHABLE` addition) and `outbound: { billing: <block|null>, driver, vehicle, eta }`. Keep the whole charge block best-effort inside the existing try/catch — a charge-compute failure must never un-complete the trip.

- [ ] **Step 5: Run tests + lint**

Run: `npx vitest run src/services/outbound.service.test.js src/services/trip-lifecycle.service.test.js src/lib/integration/ingest.test.js`
Expected: PASS. ESLint touched files with `--max-warnings 0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/integration/contracts.js src/services/outbound.service.js src/services/trip-lifecycle.service.js src/services/reservation-lifecycle.service.js src/services/outbound.service.test.js src/services/trip-lifecycle.service.test.js
git commit -m "feat(billing): folio-charge intent on COMPLETED"
```

---

### Task 4: Gateway readiness-only (real HTTP adapter, still default-mock, reconcile wired)

**Files:**
- Modify: `src/lib/integration/booking-gateway.js:97-118` (`HttpBookingGateway` real impl)
- Modify: `src/services/outbound.service.js:109-151` (`reconcileFailedDeliveries` — backoff + max-age guard, additive only)
- Create: `src/app/api/cron/reconcile/route.js` (CRON_SECRET-gated; calls `reconcileFailedDeliveries`)
- Modify: `.github/workflows/cron-sync.yml`, `vercel.json` (add reconcile schedule next to existing sync — read both files first, follow their existing secret/env pattern)
- Modify: `src/app/api/settings/connectors/route.js` (report `bookingMode`, `hasUrl`, `hasKey` booleans — never the secret values)
- Test: `src/lib/integration/booking-gateway.test.js` (http mode with mocked `fetch`: success, 401, timeout, missing-env fail-closed)

**Interfaces:**
- Consumes: `TransportStatusEventSchema` (unchanged wire shape — readiness must not change the contract).
- Produces: `getBookingGateway()` returns a working `http` client when `BOOKING_GATEWAY=http` AND `BOOKING_API_URL` + `BOOKING_API_KEY` are set; otherwise throws fail-closed. `reconcileFailedDeliveries` retries `pending/failed` outbound rows with per-row backoff; cron route exposes it to the scheduler.

Explicit non-goals (readiness, not cutover): NO live URL/key is configured; default stays `mock`; no Booking-side correlation proof is claimed. `describeBookingNotify()` already tells the truth about mock (`src/lib/integration/booking-notify.js:27-31`) — keep that copy verbatim.

- [ ] **Step 1: Write the failing gateway test (mocked fetch, no network)**

```js
// src/lib/integration/booking-gateway.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
beforeEach(() => { vi.resetModules(); delete process.env.BOOKING_GATEWAY; delete process.env.BOOKING_API_URL; delete process.env.BOOKING_API_KEY; });
describe("HttpBookingGateway readiness", () => {
  it("fail-closed without URL/key", async () => {
    process.env.BOOKING_GATEWAY = "http";
    const { getBookingGateway, _resetBookingGateway } = await import("./booking-gateway.js");
    _resetBookingGateway();
    await expect(getBookingGateway().fetchPendingRequests()).rejects.toThrow(/not configured|not connected/i);
  });
  it("sends api key header + timeout on success", async () => {
    process.env.BOOKING_GATEWAY = "http"; process.env.BOOKING_API_URL = "https://booking.example"; process.env.BOOKING_API_KEY = "k";
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] }));
    const { getBookingGateway, _resetBookingGateway } = await import("./booking-gateway.js");
    _resetBookingGateway();
    await getBookingGateway().fetchPendingRequests();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("https://booking.example"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer k" }) }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/integration/booking-gateway.test.js`
Expected: FAIL (stub throws `not connected yet` unconditionally; no header/timeout logic).

- [ ] **Step 3: Minimal real adapter (same two methods, same schemas)**

`fetchPendingRequests()`: `GET {BOOKING_API_URL}/transport-requests?status=pending` with `Authorization: Bearer {BOOKING_API_KEY}`, `AbortSignal.timeout(10000)`, validate each item with `TransportationRequestSchema` (skip-and-count malformed, never throw the batch). `acknowledgeStatus(event)`: validate with `TransportStatusEventSchema` first (as mock does), then `POST {BOOKING_API_URL}/transport-status` with same auth/timeout; non-2xx → throw with `status + body slice` so `integration_log.error_message` records it. Constructor throws fail-closed when URL/key missing. No other file changes its call shape — `pull/route.js`, `outbound.service.js` keep calling the same two methods.

- [ ] **Step 4: Reconcile hardening (additive)**

In `reconcileFailedDeliveries`: skip rows whose `payload` is not an object (already there); add skip when `error_message` shows >5 consecutive failures AND `created_at` older than 7 days (leave row `failed`, count as `deferred`, never delete). Return `{ gateway, retried, delivered, stillFailed, deferred }` — additive key only.

- [ ] **Step 5: Cron route + schedule (follow existing `cron-sync.yml` / `vercel.json` pattern)**

`src/app/api/cron/reconcile/route.js`: `GET` + `POST`, `Authorization: Bearer {CRON_SECRET}` required (fail 503 when unset, matching existing cron behavior); calls `reconcileFailedDeliveries({ max: 50 })`; returns `{ ...result }`. Add the schedule line next to the existing sync entry in both workflow and `vercel.json` — do not invent a new secret name.

- [ ] **Step 6: Run tests + lint**

Run: `npx vitest run src/lib/integration/booking-gateway.test.js src/services/outbound.service.test.js`
Expected: PASS. ESLint touched files `--max-warnings 0`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/integration/booking-gateway.js src/services/outbound.service.js "src/app/api/cron/reconcile/route.js" .github/workflows/cron-sync.yml vercel.json src/app/api/settings/connectors/route.js src/lib/integration/booking-gateway.test.js
git commit -m "feat(integration): http gateway ready (mock default), reconcile cron wired"
```

---

### Task 5: Booking-initiated cancel + modify (webhook, service-token authed, idempotent)

**Files:**
- Create: `src/app/api/integration/booking-cancel/route.js` (`POST { external_booking_id, reason? }`)
- Create: `src/app/api/integration/booking-modify/route.js` (`POST { external_booking_id, pickup_datetime?, pickup_location?, dropoff_location?, passenger_count?, special_requests?, guest_id?, room_number? }`)
- Reuse: `src/app/api/integration/transport-requests/route.js:27-41` (`authorize()` dual-auth pattern — copy verbatim, do not invent a third auth), `src/services/reservation-lifecycle.service.js` (`advanceReservation`, `loadRequest`), cancel cascade in `[id]/cancel/route.js:29-42`, reschedule property-change in `[id]/reschedule/route.js:20-83`
- Test: `src/app/api/integration/booking-cancel/route.test.js`, `src/app/api/integration/booking-modify/route.test.js` (idempotent replay, terminal-noop, unauthorized without token/session)

**Interfaces:**
- Consumes: Tasks 1–2 columns; `L.CANCELLED` escape-hatch semantics; `E.CANCELLED` / `E.RESCHEDULED` timeline events.
- Produces: `POST /api/integration/booking-cancel` → cancels request + open dispatches/trips (same cascade as staff cancel), returns `{ ...request, idempotent }`; `POST /api/integration/booking-modify` → property-only update (never moves `fleet_status`), recomputes estimate, emits status with fresh `eta`, returns `{ ...request }`.

Guards (both routes): terminal `Completed/Cancelled` → `409` (cancel) / `409` with no write (modify) + `integration_log` inbound row `status='skipped'`. Unknown `external_booking_id` → `404` (never create on cancel/modify — creation belongs to ingest POST only). Replay of an already-cancelled request → `200 { idempotent: true }`.

- [ ] **Step 1: Write the failing cancel test**

```js
// src/app/api/integration/booking-cancel/route.test.js
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn(async (sql) => {
  if (sql.includes("FROM transportation_requests")) return { rows: [{ request_id: 7, fleet_status: "Assigned", external_booking_id: "BK-7" }] };
  if (sql.includes("FROM dispatchschedules")) return { rows: [] };
  return { rows: [{ request_id: 7, fleet_status: "Cancelled" }] };
}) }));
import { POST } from "./route.js";
describe("booking-cancel", () => {
  it("rejects without service token or session", async () => {
    const res = await POST(new Request("https://fleet.test/api/integration/booking-cancel", { method: "POST", body: JSON.stringify({ external_booking_id: "BK-7" }) }));
    expect([401, 503]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/api/integration/booking-cancel/route.test.js`
Expected: FAIL (`./route.js` does not exist).

- [ ] **Step 3: Implement `booking-cancel` (staff-cancel cascade, keyed on `external_booking_id`)**

Lookup `transportation_requests WHERE external_booking_id = $1 AND deleted_at IS NULL`; if missing → 404; if terminal → 200 `{ ...row, idempotent: true }` + `integration_log` inbound `booking_cancel_duplicate` `processed`. Else run the `[id]/cancel` cascade verbatim (trips → Cancelled, dispatch → Cancelled, `syncVehicleStatus`/`syncDriverStatus`), then `advanceReservation({ toStatus: L.CANCELLED, patch: { status_reason: reason } })`, `writeAudit`, `integration_log` inbound `booking_cancelled` `processed`.

- [ ] **Step 4: Implement `booking-modify` (reschedule-route semantics, never touches `fleet_status`)**

Same lookup; terminal → 409 no-write + `skipped` log. Whitelist body keys (`pickup_datetime`, `pickup_location`, `dropoff_location`, `passenger_count`, `special_requests`, `guest_id`, `room_number`, `hotel_branch`); ignore everything else (never allow `fleet_status`, `vehicle_id`, `driver_id`, charge columns from Booking). Single `UPDATE` + `E.RESCHEDULED` event with `{ previous_*, new_* }` metadata + `writeAudit` + `emitTransportStatus(updated, { eta })` + `processed` log.

- [ ] **Step 5: Run tests + lint**

Run: `npx vitest run src/app/api/integration/booking-cancel/route.test.js src/app/api/integration/booking-modify/route.test.js`
Expected: PASS. ESLint both route files `--max-warnings 0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/integration/booking-cancel/route.js src/app/api/integration/booking-modify/route.js src/app/api/integration/booking-cancel/route.test.js src/app/api/integration/booking-modify/route.test.js
git commit -m "feat(integration): booking-initiated cancel + modify webhooks"
```

---

### Task 6: Gates — schema, security, suite, docs

**Files:**
- Modify: `Capstone/01 - System/System Boundaries.md`, `Capstone/02 - Features/Reservations.md`, `Capstone/02 - Features/Request Lifecycle.md` (or closest feature note), `Capstone/01 - System/System Overview.md` changelog line
- Verify: `scripts/lib/schema-contract.mjs`, `scripts/lib/sql-references.mjs` (read-only check — column-only change needs NO new entry; fail the task if `npm test` disagrees)

**Interfaces:**
- Consumes: Tasks 1–5 diffs.
- Produces: green gates + vault notes in sync with code.

- [ ] **Step 1: Schema gate**

Run: `npm run db:status` → expect `pending 0`; `npm run db:dump` → expect clean (no diff after Task 1 commit); `git diff --check` → clean.

- [ ] **Step 2: Security gates**

Run: `npm run db:contract` → expect clean (no new tables). Run: `npm run verify:anon` → expect no new EXPOSED vs baseline; any `200 []` on touched tables is INCONCLUSIVE, never PASS — resolve via the contract output.

- [ ] **Step 3: Suite + build**

Run: `npx vitest run src/lib/integration src/services/outbound.service.test.js src/services/trip-lifecycle.service.test.js src/app/api/integration/booking-cancel src/app/api/integration/booking-modify`
Expected: PASS. Then `npm run lint:ci` (exit 0) and production build green. Full `npm test` before merge; the only acceptable failures are the pre-existing baseline set recorded in `Capstone/00 - Home/Current State.md` — any new failure blocks the merge.

- [ ] **Step 4: Vault update (mandatory per `.agents/AGENTS.md`)**

Update `System Boundaries.md` (new columns + cancel/modify + gateway-ready state), `Reservations.md` / `Request Lifecycle.md` (folio intent on COMPLETED, Booking-initiated paths), `System Overview.md` changelog (one line per shipped task + verification). Mention the doc update in the final response.

- [ ] **Step 5: Final commit (docs only, if code already committed per-task)**

```bash
git add Capstone/ schema.sql
git commit -m "docs: folio + booking-cancel/modify + gateway-ready integration notes"
```

---

## Self-review

- **Spec coverage:** billing (§1) → Tasks 1–3; gateway-ready (§2) → Task 4 (mock default kept, no live keys); cancel/modify (§3) → Task 5 (idempotent, terminal-safe, cascade matches staff cancel); room/guest reference (§4) → Tasks 1–2 (nullable, never blocks ingest, searchable in queue).
- **Placeholder scan:** no TBD/TODO; every test step has runnable code; every SQL statement is complete and idempotent; file paths are exact.
- **Type consistency:** `billing: { bill_to_room: boolean, amount: number|null, currency: 3-char, trip_id?, distance_km? } | null` is identical in schema, emitter, and completion caller; `charge_status` vocabulary (`not_chargeable/pending/posted/failed/waived`) is identical in migration CHECK and Task 3 logic; `gateway.name` (`mock`/`http`) threads through `emitTransportStatus` → `describeBookingNotify` unchanged.
