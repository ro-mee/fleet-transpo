---
type: feature
status: working
tags: [feature, fuel, mobile, gemini]
source:
  - src/services/fuel.service.js
  - src/app/api/fuel
  - src/app/api/mobile/fuel
  - src/lib/fuel/gemini-receipt.js
  - src/lib/fuel/request-policy.js
  - mobile/app/(app)/fuel-report.js
last_verified: 2026-10-18
---

# Feature: Fuel

## Status: working scanner flow — USER-CONFIRMED

Receipt capture and Gemini extraction work on-device. The last live row-count check was 2026-08-11, when `fuelrecords` had **0 rows**; the database count was not re-queried today, so persisted end-to-end usage remains to be verified after the latest scanner change.

## Positioning: a Fuel Planning, Authorization, Monitoring & Consumption Control system

The module is deliberately structured in four layers (external review adopted 2026-08-25):

| Layer | Purpose | Where it lives |
|---|---|---|
| Planning | Predict upcoming fuel requirement from dispatch data | 24h forecast query + `request-policy.js` |
| Authorization | Control how much may be purchased | Auto-authorization policy + manager ladder |
| Transaction | Record actual refueling | Mobile receipt flow (`/api/mobile/fuel`) |
| Analytics | Actual consumption & anomalies | Variance flag, budget utilization, reports |

## What exists

| Piece | Note |
|---|---|
| `src/services/fuel.service.js` | **33 lines of `apiFetch`** — a client fetch wrapper, not a domain service → [[DEBT Services Folder Mixes Two Concerns]] |
| `/api/fuel/*` routes | CRUD |
| Dashboard page | Under `(dashboard)/` |
| Mobile refuel screen | Embedded receipt camera, review, manual recovery, and fuel submission |
| `/api/mobile/fuel/upload` | Stores the driver's receipt and returns a short-lived signed URL **plus** the object key |
| `/api/mobile/fuel/scan` | Verifies URL ownership, fetches the uploaded image, and invokes Gemini server-side |
| `gemini-receipt.js` | Structured extraction and strict field normalization (now incl. `fuel_type`) |
| `/api/fuel/requests` | Driver-submitted consolidated refill requests + policy auto-authorization + manager approval ladder |
| `/api/fuel/allocations` | Monthly per-vehicle budget plus tank capacity / efficiency profile |
| `request-policy.js` | Pure decision core: recommendation math, variance check, fuel-policy evaluation, tank/type checks |
| `fuelstations` | Table **dropped** in an earlier migration; still appears in both stale ERDs → [[DOC ERDs Missing Core Table]] |

## Fuel request lifecycle — three-value model — VERIFIED 2026-08-25

The refill decision separates three numbers so the manager sees *why*, not just an amount (external review adopted 2026-08-25):

| Value | Formula | Example (60 L tank · 25% · 160 km @ 8 km/L) |
|---|---|---|
| **Minimum safe refill** | `forecast_consumption + reserve − current`, floored at 0 | **11 L** |
| **Preferred target** | `min(tank, max(90% tank, consumption + reserve)) − current` | **39 L** (to 54 L) |
| **Maximum allowed** | `tank_capacity × (1 − reported level)` | **45 L** |

The 90% target is deliberately kept as a *preferred* operating level to reduce repeated refueling stops — it is displayed next to the minimum, never instead of it.

### Approval: policy auto-authorization + manager ladder — VERIFIED 2026-08-25

**Auto-authorization (strict conditions, all server-computed).** At request creation `evaluateFuelPolicy()` approves instantly (`status='Approved'`, `approved_by=NULL`, `auto_authorized: true` in the snapshot) only when **all** hold:

- a positive recommendation exists,
- no fuel variance was detected,
- the forecast fits inside the tank (no range warning),
- minimum safe ≤ recommendation,
- the monthly budget covers the recommended liters.

Anything else stays `Pending` with its reasons in `policy_reasons`. Drivers cannot influence any input — `requested_liters` is always the server's own recommendation. Auto-authorized requests immediately count as committed against the budget. The audit trail logs action `auto-authorize` vs plain `create`.

**Manager ladder (for exceptions).**

| `gemini-receipt.js` | Structured extraction and strict field normalization (now incl. `fuel_type`) |
| `/api/fuel/requests` | Driver-submitted consolidated refill requests + policy auto-authorization + manager approval ladder |
| `/api/fuel/allocations` | Monthly per-vehicle budget plus tank capacity / efficiency profile |
| `request-policy.js` | Pure decision core: recommendation math, variance check, fuel-policy evaluation, tank/type checks |
| `fuelstations` | Table **dropped** in an earlier migration; still appears in both stale ERDs → [[DOC ERDs Missing Core Table]] |

## Fuel request lifecycle — three-value model — VERIFIED 2026-08-25

The refill decision separates three numbers so the manager sees *why*, not just an amount (external review adopted 2026-08-25):

| Value | Formula | Example (60 L tank · 25% · 160 km @ 8 km/L) |
|---|---|---|
| **Minimum safe refill** | `forecast_consumption + reserve − current`, floored at 0 | **11 L** |
| **Preferred target** | `min(tank, max(90% tank, consumption + reserve)) − current` | **39 L** (to 54 L) |
| **Maximum allowed** | `tank_capacity × (1 − reported level)` | **45 L** |

The 90% target is deliberately kept as a *preferred* operating level to reduce repeated refueling stops — it is displayed next to the minimum, never instead of it.

### Approval: policy auto-authorization + manager ladder — VERIFIED 2026-08-25

**Auto-authorization (strict conditions, all server-computed).** At request creation `evaluateFuelPolicy()` approves instantly (`status='Approved'`, `approved_by=NULL`, `auto_authorized: true` in the snapshot) only when **all** hold:

- a positive recommendation exists,
- no fuel variance was detected,
- the forecast fits inside the tank (no range warning),
- minimum safe ≤ recommendation,
- the monthly budget covers the recommended liters.

Anything else stays `Pending` with its reasons in `policy_reasons`. Drivers cannot influence any input — `requested_liters` is always the server's own recommendation. Auto-authorized requests immediately count as committed against the budget. The audit trail logs action `auto-authorize` vs plain `create`.

**Manager ladder (for exceptions).**

1. `approved < minimum_safe_liters` → blocked unless an override reason is provided (schedule changed / cancelled trip / emergency)
2. `minimum ≤ approved ≤ recommended` → normal
3. `approved > recommended` → reason required
4. `approved > monthly budget remaining` → allowed with a required override reason; the modal warns "will exceed by N L" — hotel operations are never hard-blocked by budget
5. Tank-space cap always applies

### Budget tiers (not a quota)

The plan table shows per-vehicle utilization: normal under 80%, amber "Near budget limit" ≥ 80%, red "Budget exceeded" > 100% with review required. Vocabulary is deliberately *budget/target*, not *allowance*.

### Transaction validation & verification studio

At receipt submission (`POST /api/mobile/fuel`), beyond actual ≤ authorized and allocation-month checks:

- **Impossible-quantity check** — estimated current level + claimed liters must fit the tank, else 409
- **Fuel-type mismatch flag** — Gemini extracts the product line (`fuel_type`); stored in `fuelrecords.receipt_fuel_type` (migration 067) and compared to the vehicle's fuel type in the verification studio. Flag-only, never blocking: receipts often omit the product, and "Diesel Max"-style product names normalize to Diesel/Gasoline/Gasoline≈Petrol synonyms or null.
- **High-End Receipt Verification Studio (`ReceiptVerificationModal`)** — provides a dedicated thermal-receipt inspection workspace:
  - 🔄 90° image rotation for mobile pump photos
  - 🌓 Thermal paper contrast booster (clarifies faint blue/purple/grey thermal print)
  - 🔍 Fluid zoom, pan, and fullscreen inspection dialog
  - 🛡️ Three-check automated audit cockpit (Fuel Type Compatibility, Tank Space Plausibility, and Math Consistency)
  - ⚡ Quick-reason rejection dialog (`RejectClaimDialog`) with single-click preset chips.

### Gauge photo evidence + AI-assisted level read — VERIFIED 2026-08-25 (build)

Every fuel request is backed by a dashboard gauge photo (**required** — enforced in the app UI *and* server-side: `POST /api/fuel/requests` rejects without an owned `gauge_photo_url`).

- **Camera-only capture** ? no gallery option, so the evidence must be a fresh in-app camera shot; the bottom-nav scan shortcut routes contextually (approved request → receipt camera, otherwise → gauge camera).
- **Assisted input, never trusted input**: at capture time the photo is uploaded to `fuel-receipts/{driverId}/gauge/` and scanned by `gemini-gauge.js` (`scanFuelGaugeWithGemini`). The estimate only **pre-fills** the level field when it is still empty; the driver always confirms. Unreadable → fail-closed nulls ("enter manually"), never a guess — `normalizeGaugeScan` also rejects impossible values instead of clamping them into lies.
- Prompt explicitly warns the model away from temperature/tach gauges and handles needle **and** digital-segment gauges.
- Manager review panel shows the claimed % next to the photo thumbnail (zoomable) plus what the AI read (`calculation_snapshot.gauge_scan`).
- Accuracy is measurable without a real vehicle: `scripts/gauge-fixtures.html` renders synthetic gauges at exact levels (needle, tilted, digital) → `scripts/verify-gauge-scan.mjs <folder> <token>` uploads them through the real pipeline and prints a ±5 / ±10 point accuracy table.
- Gemini credentials come from the `aiproviders` table **or fall back to `GEMINI_API_KEY` in `.env.local`** (`llm-adapter.js`) — live scanning works without any DB setup.

Stacking order of trust for one claim: gauge photo + AI read → driver-confirmed % → variance flag vs history → receipt liters ≤ authorized → manager verification.



### Fuel variance flag

At request creation the server compares the driver-reported level against the last reported level minus completed-trip consumption since (`assessFuelVariance`). A gap larger than **15% of tank capacity** stores `fuel_variance` in `calculation_snapshot` and renders "Fuel variance detected — review recommended" in the review modal; a flagged request always goes to the manager's Pending queue, never auto-authorized. The gauge photo above is the visual evidence layer on top of this flag.

### Allowance semantics (committed vs consumed)

`allocationUsage()` deducts only **verified** liters (`fuelrecords.status='Approved'`) as consumed, and additionally holds approved-but-unverified request amounts as *committed* so concurrent approvals cannot double-spend the same allocation. Remaining = allocated − consumed − committed.

All values ride in the `fuelrequests.calculation_snapshot` JSONB; the receipt fuel type is the one new column (`fuelrecords.receipt_fuel_type`, migration 067). Legacy pending rows derive their floor via `minimumSafeFromSnapshot()`.

### Manual verification checklist (defense-ready)

1. **T1 happy path** — driver requests with a low gauge % → manager reviews six-tile panel → approve → mobile unlocks logging → receipt → verify claim → verified liters consume budget
2. **Sufficient-fuel rejection** — high gauge % → 409 by design
3. **Below-minimum approval** — blocked without override reason, allowed with one
4. **Above-budget approval** — warns "exceeds by N L", allowed only with reason
5. **Auto-authorization** — clean request (no variance, budget ok) approves itself instantly: no Review button needed, "Within policy" badge on Approved row
6. **Variance badge** — report far below expected remaining → amber flag in review modal, request goes to Pending even if otherwise clean
7. **Impossible quantity** — submit liters > tank space → 409
8. **Fuel-type mismatch** — receipt stating another product shows ⚠ in verification modal
9. **Budget tiers** — set allocation low → utilization bar turns amber/red

## Mobile receipt flow — VERIFIED 2026-08-22

```mermaid
flowchart LR
    N[Bottom-nav Scan] --> C[Receipt camera]
    C --> R[Crop and review]
    R --> U[Private receipt upload]
    U --> G[Server-side Gemini scan]
    G --> F[Driver reviews fields]
    F --> S[Fuel record submission]
```

- The center navigation action opens the camera immediately with `scan=1`.
- `CameraView` captures the receipt; `receipt-crop.js` maps the visible guide to the source image before resize/compression.
- Gemini model: `gemini-3.1-flash-lite`, structured JSON, 12-second server timeout.
- Fields: `station_name`, `fuel_date`, `liters`, `price_per_liter`, and final `amount`.
- Brand normalization: Petron → `PETRON`; Shell/Skyewin Prime Resources → `SHELL`. Dealer/operator names are not stored as the station brand.
- Petron's `Description / Qty / Price / Amount` layout and Skyewin's discounted final invoice are explicitly described in the extraction prompt.
- Local ML Kit/deterministic receipt parsing has been removed. Gemini failure keeps the receipt attached and falls back to driver review/manual completion.
- Odometer is no longer extracted or entered. `POST /api/mobile/fuel` derives it from the assigned vehicle's latest server-side mileage.
- Price per liter is shown independently when Gemini reads it; the server still calculates the stored value from `amount / liters`.
- The old fuel-gauge card was removed because receipt volume is not the same as the vehicle's current tank level.

## Trust boundaries

- Gemini API credentials stay on the server.
- The scan route only accepts a receipt reference owned by the authenticated driver — either an owned signed URL or an owned object key, both matched against the same expected path prefix.
- Receipt images must be valid image responses and no larger than 10 MB.
- Driver, trip, vehicle, fuel type, odometer, price per liter, and initial `Pending` status are server-owned or server-derived.
- `client_submission_id` keeps mobile submissions idempotent.
- **The stored filename's extension is server-derived** (2026-09-17). It used to
  come from `file.name?.split(".").pop()`, so `receipt.html` declared as
  `image/png` was stored as `<uuid>.html` under `Content-Type: image/png` — the
  exact disagreement a content sniffer is built to resolve, and a stored-XSS
  shape wherever the object is served from a host that honours the extension.
  `storeFuelReceipt` now uses the extension the magic-byte validator returned,
  as `vehicles/[id]/image/route.js` already did. Found by the security
  assessment (SEC-UPLOAD-002, LOW). → [[Travel Expenses]] carries the same fix.
- **An owned receipt URL is matched segment-by-segment** (same pass,
  SEC-UPLOAD-004). `isOwnedFuelImageUrl` used `path.includes(...)`, so
  `/…/sign/other-bucket/storage/v1/object/sign/fuel-receipts/4/x.png` satisfied
  it, and decoding the path first let an encoded separator (`fuel-receipts%2F4%2F`)
  decode *into* a match the real path never had. It now builds the expected path
  one percent-encoded segment at a time and compares it as a raw **prefix**,
  keeping the host check and the `token` requirement.
- **The fuel columns store an object KEY, not a URL** (2026-09-18, SEC-UPLOAD-003
  Phase B). `receipt_url` and `gauge_photo_url` used to hold a ten-year signed
  URL — a bearer credential with no revocation path, and the column was readable.
  Both now hold a bucket-qualified key (`fuel-receipts/4/….jpg`) and every reader
  signs a 1-hour URL on the way out: `api/fuel`, `api/fuel/[id]`,
  `api/fuel/requests`, `api/admin/analytics/fuel`, `api/mobile/fuel`,
  `api/mobile/fuel/[id]`. The upload route returns **both** shapes —
  `receipt_url` (short-lived, for the immediate preview/scan) and `receipt_path`
  (the key) — so an already-installed APK keeps working; `isOwnedFuelImageUrl`
  accepts either shape and checks both against the same expected prefix. The
  write path **canonicalises**: the client echoes back the URL it was shown and
  the server reduces it to a key rather than trusting the client.
  Consequently `scan`/`gauge-scan` sign the reference themselves instead of
  `fetch`ing what the client sent — a key is not fetchable, and trusting the
  client to hand over something already signed is not a control.
- **Behaviours that changed:** an upload URL is fetchable for **1 hour instead of
  10 years** (the scan runs within seconds, so the flow is unaffected); an `<img>`
  preview built from a *stale* upload URL breaks after an hour; a **dangling**
  legacy object now reads as `null` rather than as a broken image.
- **Data residual — SEC-UPLOAD-003 is PARTIALLY CLOSED, not closed.** The code
  stops minting long-lived URLs; it does not revoke the ones already stored. The
  2026-09-18 census found 7 rows in `fuelrecords.receipt_url` (6 of them already
  dangling) and 1 in `fuelrequests.gauge_photo_url` still holding ten-year tokens.
  Clearing them means rewriting the rows to keys or rotating the storage key —
  both are separate, explicitly-approved actions. → [[Bugs]]

## Why it's worth a note

`fuel.service.js` is the clearest example of the naming collision in `src/services/`: it sits alongside `reservation-lifecycle.service.js`, which does transactions and DB writes, but it is 33 lines of browser `fetch`. Same folder, same suffix, completely different kind of module.

## Remaining verification

Save one Petron and one Skyewin/Shell scan against an active trip, then verify the resulting `fuelrecords` row, automatic odometer, signed receipt URL, calculated price per liter, and `Pending` review status.

## Console consolidation (2026-09-04)

- `fleet/fuel` retired → redirects to `/fuel`. Its exceptions list + measured-efficiency table live on as the console's **Needs review** section (flags + full-record Review handoff into the existing verification studio; the bespoke `window.prompt` resolve path is gone).
- Page order now teaches budget → permit → receipt: allocations → requests (renamed from the lying "Allocation History" title) → needs review → registry.
- Stat cards are summaries; the pill row is the single filter. CSV export pages through the full filtered set (was first-page-only data). Dead Archive flow + unused imports deleted.
- Roles closed: `driver` removed from `/fuel` NAV_ROLES; Review/Configure/record-approve buttons gated on `fuel_requests.review` / `fuelallocations.update` / `fuel.update` (matrix already denied drivers).
- Driver web `Log Fuel` (direct-record bypass) replaced with mobile-app request guidance + a My-requests table (server-scoped to the driver). Full gauge-photo upload on web deferred — the API hard-requires an owned gauge photo, so this closes the bypass honestly.
- `fuel/analytics` kept as the read-only view: loading/error states, Monthly Trend upgraded to `AreaChart` (executive pattern + sr-only data table), fuel-type bars kept (no fake color semantics).
- Overview cards work like the assignments module (2026-09-04): Monthly Budget / Permits / Registry switch the single visible table (scroll-spotlight tried first, rejected for looking cheap). Pills remain the registry's only status filter.
- Needs Review dissolved as a tab (2026-09-04): the flagged panel now pins atop the Registry view when count > 0 (collapsing to nothing when clear); measured efficiency moved to the Analytics page. Tabs are Registry · Budget · Permits with a spring sliding-pill indicator (icons + pending count, reduced-motion collapses to instant, `tablist` semantics).
- Discoverability fix: KPIs went back to display-only and switching moved to an explicit labeled tab bar (`role="tablist"`) — clickable KPIs hide their affordance from new staff.
- Smart registry default (2026-09-04): pure derivation (no effect) — user pick wins, else Pending while loading or when review work exists, All when healthy-but-nonempty. Pills override anytime and stick for the session.
- Per-table KPIs (2026-09-04): each tab carries its own display-only KPI row from already-loaded data — Budget (configured / unconfigured / total liters / over-budget), Permits (pending / approved / fulfilled / rejected), Review (flagged / efficiency measured), Registry (total / pending / approved ₱ / rejected). Tab bar sits above the KPIs; Registry is the default view.

## Fuel request list offline tolerance (2026-09-16)

- `mobile/app/(app)/fuel-report.js` `loadFuelRequests` is now cached-first via `CACHE_KEYS.FUEL_REQUESTS` (`mobile/lib/offline-cache.js`, driver-namespaced, cleared on logout) — same Offline Read Mode pattern as Home/Trips. Display-only; approval gates still run on live state.
- Transport failures (`isTransportFailure`) no longer `console.warn` — the global connectivity banner owns them (PR #3.1 dedup). Genuine errors (auth/validation/5xx) still warn.
- Cold-start tolerance: one automatic retry via `shouldAutoRetry` + `LIST_AUTO_RETRY_MS` before giving up, matching Home/Trips.
- The 15 s approval poll early-returns while `useConnectivity()` reports fully `offline` (cached list stays, no network attempt, no warn); `unstable` still polls so mid-blip approvals are picked up. Poll resumes automatically on recovery.
- Verified: `vitest run mobile/lib/connectivity-state.test.js mobile/lib/offline-cache.test.js mobile/lib/offline-ux.test.js` (33 passed), `eslint` on touched files clean.

## Related

[[Fleet And Vehicles]] · [[DEBT Services Folder Mixes Two Concerns]] · [[Feature Index]] · [[Reports]]

## DOE PDF provider transport — Task 2, 2026-10-08 (implemented, uncommitted)

`src/lib/fuel/providers/doe-pdf.js` now also exports the fail-closed transport used by the later cron/manual tasks: `fetchNcrPage` (https-only, `redirect: "error"`, origin-change refusal, 8 s abort), `fetchPdfBytes` (allowlisted PDF origin, 10 MB cap, 15 s abort) and `extractPdfText` (pdf-parse 1.1.1, `extractorImpl` seam for tests). Every transport failure returns `{ ok: false, reason }` retaining the last verified snapshot — never a guess. `src/lib/fuel/providers/doe-pdf.test.js` covers page/redirect/non-https/failure cases plus real pdf-parse extraction from a locally-built minimal PDF (computed xref, no fixture, no live network). 9/9 vitest pass, eslint clean.

Two brief deviations, both required by the toolchain (see task-2 report): import via `pdf-parse/lib/pdf-parse.js` (the package `index.js` debug harness reads `test/data/05-versions-space.pdf` under vitest where `module.parent` is unset) and `pdfParse(data)` with the plain `Uint8Array` instead of `Buffer.from(data)` (vitest realm mismatch makes pooled-Buffer `byteOffset` unread to pdf.js → `bad XRef entry`; plain-`Uint8Array` parses in both realms, verified). Task 1 `MONTHS` abbreviation extension untouched. No routes, DB, or architecture changed, so no `01 - System` note update.

Phase 1 closeout, 2026-10-08 (disabled by default): the same adapter owns the full pipeline — company Diesel/Gasoline columns averaged (≥2 observations, 2-decimal) for region NCR with Monday (`startISO` + `+08:00`) effectivity; unparseable weeks/text retain the last verified snapshot. `GET /api/cron/fuel-prices` prefers a PDF branch gated by `FUEL_PRICE_PDF_ENABLED=1` + `FUEL_PRICE_SOURCE_VERIFIED=1` + https `FUEL_PRICE_NCR_PAGE_URL` / `FUEL_PRICE_PDF_CDN`, else the existing provider/disabled path; manual import is `POST /api/fuel/reference-prices/import-pdf` (`fuelallocations.update`) with an "Import from DOE PDF" card on the reference-prices page. Verification 2026-10-08: `npx vitest run src/lib/fuel src/app/api/cron/fuel-prices src/app/api/fuel/reference-prices "src/app/(dashboard)/fuel/reference-prices"` → 19 files passed, 1 skipped, 133 tests passed, 3 skipped (opt-in postgres-closeout); `npx eslint` on the 8 Phase-1 files → clean, no warnings. No migration ran, no live network touched; the pipeline stays disabled until the operator sets the env gates.

Parser v2 — Task 7, 2026-10-08: the live NCR text has no company-header table — it is repeating product blocks — so `parseNcrPdfText` now tries product blocks first and falls back to the legacy company table (signatures and announcement shapes unchanged). Gasoline averages RON91 blocks only and Diesel averages DIESEL blocks only (DIESEL PLUS, other RON grades and KEROSENE ignored); each average includes all station prices in the block plus the min/max summary lines.

Scheduler — 2026-10-09 (not yet live): `.github/workflows/fuel-prices.yml` calls `GET /api/cron/fuel-prices` Mondays 21:30 UTC (Tuesday 05:30 Manila) with `CRON_SECRET`, plus manual runs via `workflow_dispatch`. Needs `APP_URL` repo variable, `CRON_SECRET` repo secret, merge to the default branch (GitHub only runs schedules from there), and the server env gates above — otherwise every run just retains. A `retained` outcome is normal; the job fails only on transport/HTTP errors.

## Verified reference-price workflow — review fixes, 2026-10-08 (prepared; live apply held)

**Historical checkpoint:** the prepared/unapplied status in the reference-price, atomic-snapshot and provider sections below is superseded by the current database closeout recorded under **Fuel database closeout**. It remains here as the original review evidence, not the current migration verdict.

The fuel console links to `/fuel/reference-prices`. Staff with `fuelallocations.read` can review product, region, PHP/L price, effectivity, source, verifier and lifecycle. Only staff with `fuelallocations.update` can record a manual verified price or choose the estimate region. The API obtains the verifier from the signed-in employee; submitted verifier, method and lifecycle cannot grant authority. Manual verification requires checking the dated publication. The form labels Manila time and converts it to an explicit `+08:00` instant.

`src/lib/fuel/price-repository.js` owns real server SQL. It validates scalar PHP/L prices with two-decimal storage, required source URLs, real calendar dates and explicit timezones, Manual verifier identity and Automatic ingestion hash. A transaction and advisory lock serialize publication. Exact repeats return the existing snapshot; conflicting same-effectivity prices require a new later correction with provenance. Consecutive implausible adjustments are held for review. Future rows remain Pending; an atomic effectivity transition promotes the current row and retains previous rows as Historical. Repeating activation leaves prices and provenance unchanged.

Fuel Estimates module — 2026-10-09: separate read-only monitoring at `/fuel/estimates` (nav + `reports.read` roles admin/super_admin/fleet_manager/management) so managers need not widen the trip table — `GET /api/fuel/estimates` lists Completed trips with their locked estimate, vehicle plate/name, price basis and snapshot proof, filterable by date/region/vehicle, with totals; rows link to trip detail. Same HeroHeader/StatCard/EmptyState components as Fuel Analytics. History verifier shows the employee name (LEFT JOIN) with ID fallback; source opens in a new tab plus an inline Preview. Verified: 5 new tests green, lint clean, nav/permission suites unaffected.

`priceAt` includes verified Historical rows when resolving earlier instants. Invalid or absent basis returns null. An expiry/stale-warning horizon for a particular official source remains an open business decision; the code does not invent a market-validity period. Receipt pump prices and receipt approval remain independent.

Draft migration `154_fuel_price_snapshots.sql` creates the table, effectivity uniqueness, provenance checks and RLS, revoking anon/authenticated and PUBLIC table privileges. Re-entry checks reject incompatible columns or a wrong/partial/invalid unique index instead of silently accepting a same-named object. `PENDING_TABLES.fuel_price_snapshots` in `scripts/lib/schema-contract.mjs` is an explicit reviewed migration-backed classification separate from applied `TABLES`. Offline source-SQL coverage includes it and checks the exact draft; live `db:contract` still fails when the relation is absent or protection is wrong. `schema.sql` was not edited or regenerated.

## Atomic trip fuel snapshot — review fixes, 2026-10-08 (prepared; live apply held)

The real completion API calls the real service without a test-only price seam. `completeTrip` locks the trip row and rechecks terminal state inside its transaction. It resolves the configured `fuel_price_region` setting and the vehicle product through the verified server repository. The entire first completion basis is captured together: planned and actual distance, distance provenance, vehicle efficiency, reference price, snapshot identity, region, separate planned/actual estimated liters and cost, unavailable reason and capture time. Completed retries return the existing row without rewriting its basis or repeating transition side effects. Missing inputs remain unavailable, including on later retries after prices or vehicle efficiency change.

Actual distance prefers valid odometer math, a validated supplied trip distance, then the server GPS trail. The locked trip's stored start odometer is authoritative; a validated client start is only a fallback for legacy trips with no real stored start. Derivation requires an actual end reading. Boolean/object/array odometers are rejected before writing, preventing input coercion from corrupting the immutable distance and fuel estimate. Numeric-string readings and absent-input legacy completion remain supported. Planned route distance is never promoted to actual. Malformed supplied distance is rejected before a write. Estimate arithmetic uses decimal integer ratios: liters round to 3 decimal places; cost uses those rounded liters and rounds to cents. 36 km at 9 km/L and PHP 62.70/L stores 4.000 L / PHP 250.80; a 32 km plan separately stores 3.556 L / PHP 222.96. Half-cent ties and boolean/object basis inputs have regression coverage. `fuel_consumed` keeps its original meaning.

Draft `155_trip_fuel_estimate.sql` adds the snapshot fields, requiring 154 first. Its rerun guard checks nullable column types/precision and a target-table-scoped FK with the exact source/target columns, target relation, validation and action modes. An incompatible same-named constraint aborts instead of being accepted. No live apply or catalog verification has occurred.

## Optional provider pipeline — review fixes, 2026-10-08 (disabled by default)

`GET /api/cron/fuel-prices` uses real shared-service-token authentication and fails closed when the cron secret is absent. Automatic updates require `FUEL_PRICE_PROVIDER_ENABLED=1`, `FUEL_PRICE_SOURCE_VERIFIED=1`, a configured source identity and an HTTPS source approved by the operator. No official source URL has been guessed or activated.

The enabled pipeline activates already verified due announcements, fetches without following redirects, rejects a changed response origin, parses the configured source fixture shape, validates against stored consecutive price history and publishes through the repository. Automatic publication compares against the latest verified announcement, including future Pending rows, and retains that announcement when an older unseen provider payload arrives. Manual review can explicitly backfill historical intervals. Repeated fetches are duplicates; relative jumps, format drift and transport failures retain the existing prices. The server generates the bounded ingestion hash. No scraping runs in dispatch/request paths and no DB schedule was created. Manual verified prices remain available through the same review workflow after the authorized schema checkpoint.

**Offline verification:** focused fuel/caller/manual UI/API/cron/schema-contract and release acceptance suites; real application modules with fake external DB/transport adapters, no mock of the repository/service being tested. Coverage includes the actual completion route, serialized concurrent retries, unavailable snapshot immutability, history/effectivity, role denials, server-owned verifier, origin spoofing, strict timestamps/scalars and exact decimal rounding. Whole page rendering checks manager/observer/loading/schema-error states. Lint and whitespace checks cover the touched files. These are offline tests, not browser/device or live PostgreSQL evidence.

The final odometer/latest-announcement follow-up reproduced four failures before fixes: omitted stored start used supplied distance, boolean legacy start was accepted, an older automatic announcement bypassed the stale gate, and nonnumeric end readings silently completed. The real completion/cron/repository/service tests then passed (4 files, 24 tests), including stored-start precedence, numeric-string legacy readings, missing actual distance, and serialized first capture.

### Closeout evidence harness

The strengthened offline completion test runs the real ownership, geofence, status, audit, reservation, completion and price repository modules, replacing only identity and external DB/Supabase boundaries. Manual region selection and price creation flow into the real completion route: snapshot 44, signed-in verifier 3, 36 km / 9 km/L / PHP 62.70 produces 4 L / PHP 250.80. A paused capture interleaves a retry and preserves the whole first basis. GPS actual distance remains separate from the 32 km plan. UTC and Manila effectivity boundaries and redirect refusal/changed-origin responses have explicit assertions. The focused closeout run passed 29 tests across five files.

`src/lib/fuel/postgres-closeout.test.js` is opt-in with `FLEETOPS_REVIEW_DB_TEST=1`. It prepares a guarded random private review schema, clones live column types without production defaults, sequences, triggers or foreign keys, and inserts fixture trip/request/vehicle/manual-price rows. It checks persisted completion rows, GPS versus plan, and two real PostgreSQL clients using `pg_blocking_pids` to establish row-lock overlap. Mutation targets are allowlisted; the search path excludes public. Cleanup verifies the exact generated schema, its owner and allowed fixture tables before dropping it. Production constraints, grants and RLS remain separate live-catalog evidence. Without the flag, all three database tests are skipped and no connection is made. Preparation/skip validation is not a successful live run; its result must be recorded after the authorized parent run.

The first authorized database attempt exposed fixture mismatches: bigint IDs arrive as strings, and CTAS did not copy the audit index required by `ON CONFLICT (event_key) WHERE event_key IS NOT NULL`. The fixture now compares exact ID text and creates that exact partial unique index in its private schema. Assertions require two persisted manual-workflow audit entries and one completion audit entry even under concurrent retry, so logged audit failures cannot count as successful evidence. These fixture corrections passed lint and whitespace checks; the parent owns the enabled rerun and final live verdict.

The next authorized attempt passed persisted manual snapshot/completion evidence. Its GPS fixture represented an 11 km jump in one minute, correctly rejected by the real trail helper's speed guard; it now spans 30 minutes with a preceding trip start. Blocking observation now uses `pg_backend_pid()` inside each transaction rather than the pooler's client ID. Every adapter query, fixture query and transaction uses `BEGIN` with `SET LOCAL search_path` and bounded local timeouts, then commits or rolls back. The adapter checks its actual schema before each query. No session search-path setting survives to a pooled backend's next user. Final GPS/concurrency success still requires the parent's enabled rerun.

### Fuel database closeout — 2026-10-08

The authorized parent checkpoint applied migrations 150–155 through the repository runner, refreshed the generated schema and reported a clean database contract (77 relations, zero findings). This supersedes the earlier statement that fuel migrations 154/155 were only drafts. See [[FleetOps Passenger Cargo Review Closeout 2026-10-08]] for the shared closeout and remaining release decisions.

The enabled isolated PostgreSQL fuel suite passed all three tests (full fuel run: 19.39 seconds). Real manual region/price routes persisted snapshot 44 with verifier 3; the real completion route persisted 36 km, 9 km/L, PHP 62.70/L, 4.000 L and PHP 250.80, with separate planned estimates. A realistic 30-minute GPS trail persisted approximately 11.1 km actual distance while keeping the 32 km plan. Two distinct PostgreSQL backend IDs overlapped: `pg_blocking_pids` showed the second completion waiting for the first trip-row lock. Both calls returned the same first distance, efficiency, reference price, snapshot, region, planned/actual costs, unavailable reason and capture time. One completion audit event persisted under retry. No application service or repository was mocked; identity and the Supabase status lookup remained external fixture boundaries.

A later combined run exposed a 5-second test timeout and overlap on the shared fixture connection. The final harness gives each fixture query its own exclusive transaction, serializes fixture operations, qualifies every fixture relation with the generated private schema, and checks schema scope inside pinned application transactions. Setup/reset and cleanup drain outstanding transactions; each real test has a bounded 30-second allowance. This prevents a timed-out fixture operation from changing a following operation's transaction settings or resolving a mutation to public. The corrected combined PostgreSQL run passed all 16 tests across four files in 26.79 seconds; all three fuel tests passed, including the genuine blocking proof. Production SQL and behavior were unchanged by these harness fixes. Shared post-run operational-count/default-path checks are recorded in the closeout note.

Fixtures used a generated private schema and transaction-local settings only. Production business rows, production sequences and official provider sources were not changed. The fixture copied current live column types and explicit indexes needed by exercised SQL; it did not reproduce production triggers, foreign keys, RLS or grants. Those remain separate catalog evidence. The cleanup dropped the exact verified fixture schema, explicitly queried the catalog to confirm its absence, and ended its pool.

**Remaining gates:** browser/device acceptance and release decisions belong to the shared closeout; the final configured production build passed. Official-source clearance and its stale-warning policy remain external; automatic ingestion stays disabled until explicitly configured. Missing fuel relations/columns still return a clear 503 pending-schema error for an unprepared environment.

## Export exports the view you are looking at — 2026-10-01 (implemented)

The header **Export CSV** button always exported fuel **receipt claims**, whichever of the three views (Registry / Monthly Budget / Permits) was on screen — and it did it wrong. `getFuelRecords` answers in paginated mode with an envelope, `{ rows, total, counts }`, and that object was handed straight to `exportToCSV`, which tests `data?.length` — `undefined` on an object — and returns `{ count: 0 }` without writing a file. Clicking Export with **45 permits** visible produced no download and a toast reading *"Exported undefined records"*.

Confirmed against live on 2026-10-01: `fuelrequests` = **45** rows, `fuelrecords` = **1**. The two lists are different entities and the export could match neither.

`src/lib/fuel/export-targets.js` now yields one target per view, each with its own `entity`, button `label`, `filename`, `columns` and `collect()`:

| View | Exports | Endpoint |
|---|---|---|
| Registry | receipt claims | `GET /api/fuel` (through `collectPagedRows`, so **every** page of the active filter, not page 1) |
| Monthly Budget | monthly budget rows | `GET /api/fuel/allocations` |
| Permits | fuel permits | `GET /api/fuel/requests` |

`collectPagedRows()` lives in `src/lib/export.js` beside `exportToCSV` and keeps the envelope-unwrapping in one place: it reads `rows`, walks pages until `total` is reached, stops on an empty page (a wrong `total` cannot spin), honours a `maxPages` bound, and passes a bare array through for endpoints that do not paginate. The button in the header names its entity ("Export receipt claims" / "Export permits" / "Export monthly budget") so the label can no longer disagree with the file, and an empty filter produces a warning instead of a silent no-op.

The old `pageSize: total` call was also an unbounded single query; the paged walk replaces it.

## Fleet Manager live-use remediation - 2026-10-03

`GET /api/fuel/requests` now includes active and archived receipt counts plus the statuses of active receipts for each permit. The Permits table shows whether the linked receipt is approved, pending, completed, rejected, archived, or missing, and whether it is eligible for Fuel Analytics. Fulfilled remains the permit lifecycle state; it does not promise that a receipt is currently active or approved. Fuel Analytics includes non-deleted `Approved` fuel records only.

An earlier read-only snapshot (about 02:04 Manila) of the documented live project found 24 fulfilled permits: 21 had archived receipts only and 3 had active receipts (2 Approved, 1 Pending). It counted 12 active Approved fuel records. A later same-day snapshot differed; see the archive audit follow-up below. No permits or receipts were modified. The receipt-state helper and route response tests passed.

**Verification.** `src/lib/export.test.js` (8 tests) — including the root-cause pin that `exportToCSV` refuses a paginated envelope and reports `count: 0` — and `src/lib/fuel/export-targets.test.js` (7 tests), which asserts the 45-permit case explicitly: the permits view must call the permits endpoint, must not touch `getFuelRecords`, and must carry the active status/search filter through every page of the registry walk.

## Fuel Governance & Policy Engine — 2026-10-03 (implemented & verified)

Refueling planning, pilferage detection, and auto-authorization previously relied on hard-coded constants (10% reserve, 90% target fill, 15% variance threshold, and 60 L auto-approval). These are now centralized in an audited, configurable policy engine stored in `system_settings` under setting key `fuel_policy`:

| Policy Key | Default | Allowed Range | Description |
|---|---|---|---|
| `reserveBufferPercent` | `10` | 5% – 40% | Safety floor retained in tank before mandatory refill is recommended |
| `preferredTargetPercent` | `90` | 40% – 100% | Operating refill target to minimize repeated pump visits |
| `maxFillCapPercent` | `100` | 80% – 100% | Physical tank upper bound accounting for thermal expansion |
| `varianceThresholdPercent` | `15` | 5% – 40% | Mileage vs gauge discrepancy triggering an anomaly alert |
| `enableVarianceAlerts` | `true` | boolean | Toggles pilferage & consumption variance detection |
| `autoApprovalEnabled` | `true` | boolean | Toggles instant auto-authorization engine |
| `autoApprovalMaxLiters` | `60` | 10 – 200 L | Liter ceiling above which requests require Fleet Manager review |
| `budgetEnforcementMode` | `"warning"` | `"warning"` \| `"strict"` | Warning permits manager override with reason; Strict hard blocks |
| `maxPricePerLiter` | `120` | ₱40 – ₱200 / L | Receipts exceeding this ceiling trigger anomaly warning |
| `strictFuelTypeMatching` | `false` | boolean | Strictly block claims where receipt fuel type conflicts with engine |

### Architecture & Touchpoints

- **Pure Policy Definition:** `src/lib/fuel/fuel-policy.js` provides `DEFAULT_FUEL_POLICY`, `FUEL_POLICY_RANGES`, `mergeFuelPolicy()`, and `validateFuelPolicy()`.
- **Database Storage:** `src/services/fuel-settings.service.js` reads/writes `system_settings` using `fuel_policy` key, preventing any breaking table migration.
- **REST Endpoints:** `GET` / `PUT /api/settings/fuel` (`src/app/api/settings/fuel/route.js`) with RBAC guard (`requirePermission(req, "fuel_settings", ...)`), parameter allowlist, and audit logging (`writeAudit`).
- **Core Decision Logic:** `src/lib/fuel/request-policy.js` accepts optional `policy` in `calculateFuelRecommendation()`, `assessFuelVariance()`, and `evaluateFuelPolicy()`.
- **Request Creation Integration:** `src/app/api/fuel/requests/route.js` fetches the active policy and injects it into all calculations and auto-authorization evaluations.
- **Approval and receipt integration:** Strict budget mode blocks manager over-budget approvals even with an override reason. Mobile receipt submission uses the configured price ceiling for anomaly flags and blocks a known fuel-type mismatch when strict matching is enabled. Gauge photos on requests and receipt photos on claims remain mandatory in the mobile flow; neither is exposed as a configurable toggle.
- **UI Management Console:** `src/app/(dashboard)/settings/fuel/page.js` provides a modern settings console with HeroHeader, 5 KPI stat cards, an interactive Three-Value Tank Visualizer, Refueling & Planning Thresholds, Pilferage & Variance Detection, Auto-Authorization Engine, Cost & Budget Governance, and action buttons.
- **Navigation & Access:** Added to `NAV_ROLES["/settings/fuel"]` and `MATRIX.fuel_settings` for `admin`, `super_admin`, and `fleet_manager` (`src/lib/auth/permissions.js`), workspace sidebars (`src/lib/workspaces.js`), and Command Palette (`src/components/ui/command-palette.jsx`).

**Verification.** Policy, request, and mobile receipt suites passed in the 3,605-test full run; `npm run lint:ci`, `npm run verify:auth`, and `npm run db:check` passed. The new settings reject non-boolean switches and a target fill above the tank cap.

### Receipt archive audit follow-up - 2026-10-03

A later read-only snapshot of the same project (02:59 Manila) found 22 fulfilled permits: 21 with archived receipts only, 1 with an active linked receipt, and none without a linked receipt. Across `fuelrecords`, 49 of 50 records were soft-deleted (20 with status `Approved`, 29 `Pending`); none had a matching `fuelrecords` audit event. The actor and reason for those historical archives cannot be recovered. Counts differed from the earlier same-day snapshot, so each is timestamped evidence rather than a stable total. Both snapshots predate the controlled defense data cleanup and must not be treated as current counts.

`DELETE /api/fuel/[id]` now locks an active record, soft-deletes it, and writes a required `fuelrecords` audit event in the same transaction. The event captures the actor, timestamp, previous status, and linked permit ID without logging receipt contents or free-text notes. If the audit write fails, the archive rolls back. The existing endpoint remains reason-free; this adds future attribution but cannot explain historical archives.

**Verification.** The latest focused run passed 14 tests across four files, including archive success, already-archived behavior, and rollback when required audit logging fails. Changed route/helper paths passed ESLint and `git diff --check`. No live row or migration was changed.

### Fuel request review dialog viewport fit - 2026-10-07

The dialog already capped its full height to `100dvh - 2rem`, but the root used `overflow-hidden` while only the body scrolled. The action row sat outside that body scroll area, so a tall dialog could clip the buttons at the viewport edge. The dialog root now owns vertical scrolling, and the header and action row stick to its top and bottom edges. The footer wraps at narrow widths and keeps each button at its natural width. No automated or browser verification was run.
## Manual efficiency diagnostic work orders — 2026-10-08

Fleet Manager, Admin and Super Admin can file an Inspection from a Below-baseline report row with an available estimate. The report checks the latest open `[fuel-diagnostic v1]` Inspection first and shows its work-order number/status. Filing another requires explicit confirmation; failed checks offer retry and block filing. The staff-only lookup is bounded to ten vehicle IDs and excludes completed/cancelled/deleted/unmarked records. Rapid clicks cannot submit the same action twice. This safeguard does not enforce uniqueness across concurrent users.

The work order has Normal priority, cost zero, server-stamped creator and tomorrow's Manila date. It does not ground the vehicle today; it becomes due under normal maintenance rules tomorrow. Other grounding reasons remain effective. No automatic filing, cron, efficiency formula or schema change was introduced. Stored/push notifications retain the work-order ID as `fuel_diagnostic` and open the staff maintenance register. See [[Maintenance]] and [[Notifications]] for verification: full suite 4,482 passed, lint/auth/migration checks passed, plus isolated PostgreSQL midnight availability coverage.

The 2026-10-08 signed-in local smoke test used the quarter report because October's monthly range had no qualifying per-vehicle estimate. It filed diagnostic #84 from an eligible Below-baseline row, confirmed the report showed the open order after reload, and chose **Keep existing** in the repeat-filing prompt; no duplicate was filed. This was a local smoke test, not a production dispatch-availability test. See [[Maintenance]] for the remaining manual-test limits and the test record details.

## Fuel estimates and reference-price workspace — 2026-10-09

Fuel Estimates now groups four compact summary measures, the applied date/region/vehicle filters, and a comparison table for completed trips. Reference Prices shows the estimate region first, highlights weekly DOE PDF import, keeps verified manual entry available, and presents source-backed history with preview/open actions. Existing API calls, permissions, price verification, locked completion snapshots, receipt-price meaning, and form fields are unchanged. Scoped ESLint and `git diff --check` passed. The browser preview was blocked by the active Test Mechanic role, which cannot view these staff pages; authenticated staff visual review remains pending. No test suite was run for this visual-only change.

## Estimates & request correctness audit — fixes, 2026-10-18 (implemented; working tree uncommitted)

Full audit findings FE-01…FE-18; this pass implemented Phase 0 + Phase 1 plus the separately approved receipt→fuel-level item. Every fix was written test-first (failing suite observed before the change).

**Estimates monitoring (`GET /api/fuel/estimates`, `/fuel/estimates`).** The default range is now the current Manila calendar month ending on its **last day** (it used to end on the first day of the following month). Totals no longer come from the row page — a dedicated aggregate runs over the whole range (`trips`, `priced_trips`, `estimated_cost`, `estimated_liters`) and the response carries `truncated` when the 500-row page is not all of it; the page shows a truncation notice, and its KPIs are now **Trips priced** (priced of completed) and **Average cost per priced trip** — the old "average cost per trip" divided by every completed trip, including unpriced ones. Missing cost is labelled with its actual reason — `No cost (no reference price)` / `No cost (no distance)` / `No cost (no efficiency)` / `No cost (value out of range)` — and rows captured before the estimate columns existed read `No cost (Not captured)` instead of implying a missing price.

**Litres are kept when the price is missing.** `estimateFuelCost()` returns `{ liters, cost: null, basis: "partial", reason: "no-price" }`, and trip completion stores `estimated_fuel_l` for that case (previously both were nulled). The priced basis is labelled `estimated` (was `measured`, which claimed more than an estimate). Only new captures are affected; stored snapshots are never rewritten.

**Each scheduled leg is counted once.** `planForecastDistance()` in `request-policy.js` pairs reverse `origin`/`destination` legs one-to-one and mirrors only legs with no scheduled return; previously every trip row was multiplied by two, so a scheduled out-and-back consumed four legs of fuel in the recommendation. Unpairable legs still get ONE assumed return, and that assumption is recorded in the snapshot: `forecast_legs`, `paired_forecast_legs`, `assumed_return_km`, `round_trip_assumed`. `calculateFuelRecommendation()` takes the total `forecastDistanceKm` (no hidden ×2), and `estimateFuel()` in `src/lib/geo/distance.js` gained an explicit `{ assumeReturn }` option whose default preserves the dispatch screens' current lone-leg behaviour.

**Variance: refills in, unknown distance no longer a false pass.** Approved receipts recorded since the last gauge report now sit on the expected side of the comparison (`refilled_liters` in the snapshot's `fuel_variance`). Completed trips whose distance is missing leave `SUM(distance)` NULL — that is unknown consumption, not zero — so the check returns the empty verdict instead of "no variance".

**Approving a receipt updates the tank level.** Migration `165_vehicles_fuel_level_updated_at.sql` adds `vehicles.fuel_level_updated_at`; `PUT /api/fuel/[id]` now folds the purchased litres into the stored level in the same transaction as the approval — `level = min(100, level + litres / tank)` — and stamps the new column (the request POST stamps it too when a driver reports a level). Re-approving cannot add the same litres twice; there is no backfill, so NULL means "unknown age".

**Verification (2026-10-18, offline + live).** Migration applied through the repository runner: `db:up` → 165 applied, `db:dump` regenerated `schema.sql` (reviewed; contains only the new column plus the other workstream's already-applied 164), `db:contract` 89 relations classified with 0 violations, `db:status` 165 applied / 0 pending / 0 changed. The live request-flow harness `scripts/verify-fuel-requests.mjs` was brought back in line with the current contract (it had gone stale: no gauge photo was sent, a `fuelrequests` column count was pinned, and it assumed every request stays `Pending`) and extended with a check that approving a receipt raises the stored level; it ends **15 passed / 0 failed** against live. Focused suites: fuel + geo (222 tests), estimates route/page (11), `fuel/[id]` approval (6), release-acceptance + completion-path (19), request-policy (29). Full run: 5,686 passed — the only two failing files belong to the in-flight mobile/odometer workstream (`mobile/lib/off-duty-illustration.test.js` and `src/app/api/trips/[id]/live-monitor/route.test.js`, whose route imports that workstream's modified `src/lib/api/ownership.js`) and were not touched here. Lint on the touched files and `verify:encoding` passed. The tree was left uncommitted at the owner's instruction because another workstream is mid-flight.

## Open-request lifecycle (FE-06) & estimates monitoring Phase 3 — 2026-10-18 (implemented; working tree uncommitted)

Second pass of the same audit (FE-06, FE-10, FE-11, FE-13, FE-14, FE-15, FE-16, FE-17). Test-first again; every module below was RED before it was GREEN.

### Withdraw, named conflicts, lazy auto-close

**A conflict now says what it is.** A second request for the same vehicle answers `409` with `code: "OPEN_REQUEST_EXISTS"` and a `blocking_request` block — `fuel_request_id`, `status`, `trip_id`, `age_days` (computed in SQL, not in JS), `created_at` — and the message names the permit ("…(#77, Pending, opened 3 days ago)."). Previously the driver saw a bare conflict and had no way to learn which permit held the vehicle.

**Drivers can withdraw their own permit.** `DELETE /api/fuel/requests` accepts `{ fuel_request_id, reason? }` for the driver's **own** `Pending`/`Approved` request, sets `status = 'Cancelled'`, writes `review_notes` ("Withdrawn by the driver" unless a reason is given), and logs audit action `withdraw`. It is **refused while a non-deleted receipt is linked** — cancelling a request whose litres were already purchased would orphan the receipt's permit. `Cancelled` is new to `fuelrequests_status_check` via migration **166** (idempotent `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`; applied through the runner). It is safe for the partial unique index because that index keys on `Pending`/`Approved` only, so a cancelled permit **frees the vehicle** for a new request. No time-based auto-expiry was added — that remains an open product decision ("abandoned" has no agreed definition), and the withdrawal path is the driver-owned answer.

**Cancelled trips no longer hold the vehicle.** When a trip is cancelled with an open permit, nothing was previously running in the trip-cancel path that could close it, so the permit blocked every future request for that vehicle. New requests now **lazily close** open permits tied to `Cancelled` trips at POST time — once, with a single retry if the first attempt is swallowed by a concurrent insert — writing audit action `auto-close`. Lazy close was chosen deliberately over a hook in `transition.service.js`, which belongs to the in-flight mobile/odometer workstream.

**Mobile (`mobile/app/(app)/fuel-report.js`).** The Pending and Approved boxes gained a withdraw affordance (Approved one is hidden in tour mode); the confirm is `AppAlert` destructive, refused while offline (the API call is not queued), and on success the `client_submission_id` is regenerated so a later re-request is not deduped to the cancelled row. The form state notes a cancelled previous request the way it already noted a rejection. `StatusBadge`'s fuel entity map gained `cancelled: "secondary"` — without it the global fallback would have rendered a withdrawn permit as red.

### Estimates monitoring: planned vs actual, provenance, KPIs, export

**API** (`GET /api/fuel/estimates`):
- `page` paging (500 rows/page) plus `total`, so an export can walk the **whole** filtered range instead of the 500 rows on screen;
- case-insensitive region filter (`UPPER(t.fuel_region) = UPPER($n)`) — "ncr" now matches "NCR";
- a `regions` list read from completed trips (`DISTINCT UPPER(btrim(fuel_region))`), so the select cannot offer two spellings of one region;
- rows carry `planned_distance_km` / `planned_estimated_fuel_l` / `planned_estimated_fuel_cost`, `distance_provenance`, `fuel_efficiency_snapshot_kmpl`, and the snapshot's `effective_at` + `verification_method`;
- totals add `litered_trips` and four **ratio parts** — `liters_distance_km`, `liters_with_distance`, `priced_distance_km`, `priced_cost_with_distance` — each filtered to rows carrying both a value and a positive distance, so cost/km and L/100km divide km that belongs to the same numerator. (Distance without a numerator, or the reverse, is in no quotient.)

**Page** (`/fuel/estimates`):
- **Six StatCards**: estimated cost (priced of total), estimated litres, priced coverage %, average cost per priced trip, cost per km, L/100km — each carrying its denominator in the note ("over 900 km"), and "—" instead of a fabricated 0 while loading/erroring.
- **Presets + applied range**: This month / Last month / Last 30 days chips (Manila calendar, `manilaMonthRange` / `manilaTrailingRange`) and a caption naming what is on screen ("October 2026", or the day range for custom filters). The caption is driven by the server's echoed `from`/`to`, so it cannot disagree with the data.
- **Filters**: `DatePicker` from/to with cross-bounds, a region `Select` fed by the distinct list, and a vehicle search that applies itself after a 300 ms pause (dates/region still go through Apply, where a half-picked range must not fire).
- **Table**: planned vs actual columns with a null-safe Δ (`Δ vs planned` renders "—" whenever either side is missing — never a delta against an unknown), a distance-provenance label (Odometer / Reported / GPS trail; unknown keys render as themselves), price cell with effective date **and** verification method and a source link that opens in a new tab, and completion/effective timestamps rendered on the **Manila clock** (`formatManilaDateTime` — the viewer's timezone must not shift the day a trip completed; FE-16).
- **Export CSV**: flattens rows with the same labels and null-safety (`estimateExportRows`, 17 columns) and walks **every page** of the applied filter via `collectPagedRows`, toasting the true count (or an honest warning when empty).

**FE-14 (index) verdict: not justified — no migration written.** `EXPLAIN (ANALYZE, BUFFERS)` against the live database chose a sequential scan (cost 2.65) for the estimate row query over a 90-day window: **35** completed trips, **3.8 ms**, 6 shared buffer hits, quicksort on a 31 kB set. A partial `(end_time) WHERE trip_status='Completed' AND deleted_at IS NULL` index would not be selected at this volume; add it only if completed-trip count grows by orders of magnitude. The three new SQL shapes (rows, regions, totals) were also run read-only against live — regions currently lists exactly `['NCR']`.

**Shared date helpers** (`src/lib/dates.js`): `formatManilaDateTime` (Manila-pinned, en-PH medium/short, "—" fallback), `addDaysToKey`, `manilaMonthRange`, `manilaTrailingRange` — all pure and tested; the estimates route now reuses `manilaMonthRange` instead of its own month math.

**Verification (2026-10-18, offline + live).** Migration 166 applied through the runner (`db:up`); `db:dump` refreshed `schema.sql` (the diff also picked up the other workstream's already-applied 164); `db:check` "166 migration files valid"; `db:contract` clean. Focused suites: 9 files / 69 tests green (estimates route 10, estimates page 13, dates, export, the fuel API suites); `fuel/requests` route 10/10. The live harness `scripts/verify-fuel-requests.mjs` was extended with the FE-06 flow — second-request 409 names the blocking permit, withdrawal cancels and frees the vehicle, the replacement request completes the whole receipt flow — and ends **18 passed / 0 failed** (exit 0). Full suite: **5,714 tests passed** across 509 files; the only two failing files are the in-flight odometer workstream's known failures (`src/app/api/trips/[id]/live-monitor/route.test.js`, `mobile/lib/off-duty-illustration.test.js`), untouched here. Touched-file ESLint and `verify:encoding` clean. The page's interaction paths (chip clicks, debounce timing, the export walk) are not exercised by the SSR test harness (vitest runs `environment: "node"`, no jsdom), so the chip/caption/column markup and the pure helpers are pinned by tests while the click-throughs remain browser-acceptance items. Left uncommitted alongside the odometer workstream.

## Estimate-caliber unification (FE-08) — 2026-10-18 (implemented; working tree uncommitted)

The last open confirmed finding from the estimates audit. Three independent "estimated fuel" calibers coexisted: the configured profile (`vehicles.fuel_efficiency_kmpl`) driving the request forecast and the locked trip estimate, a seat/fuel-type heuristic driving the dispatch advisory, and a silent `8 km/L` default inside `estimateFuel()`. **One precedence rule now exists:** `resolveVehicleEfficiency(vehicle)` in `src/lib/ai/rule-engine.js` returns `{ kmpl, basis: "profile" }` when the configured profile is a positive number, and `{ kmpl, basis: "heuristic" }` otherwise — the heuristic is documented as the labelled fallback, and every consumer resolves through it.

`estimateFuel()` (`src/lib/geo/distance.js`) no longer applies numbers silently: it returns `efficiencyKmpl` + `efficiencyDefaulted`, and the exported `FALLBACK_EFFICIENCY_KMPL = 8` is always reported when it stands in. An unknown or invalid distance now returns `liters: null` instead of a fabricated `0` — the same null-never-zero discipline the rest of the module follows. The dispatch advisor's vehicle payload gained `estimated_fuel_efficiency_kmpl` + `estimated_fuel_basis`; the recommendation preparation service computes `_est_fuel_liters` profile-first and attaches `_est_fuel_basis`. No UI currently renders an estimated-fuel figure (the recommendation panel omits it and fuel findings are filtered out of narration), so the labels live at the payload contract — whichever surface adopts the number inherits which basis produced it. No schema change; no migration.

**Roadmap residue after this pass.** FE-12 (claimed-vs-GPS distance precedence) still needs product intent — its display half (the provenance chip) shipped in Phase 3; FE-19 (estimate-vs-receipt view) remains gated on product scope; the Phase 4 optionals (Level 3 measurement study, daily-cost chart) are not started. Product decisions still pending: request auto-expiry policy (FE-06), price max-age label (FE-11), return-leg fallback default (FE-04).

**Verification (2026-10-18, offline).** Test-first: the four touched suites were RED (10 failing expectations — missing resolver export, old result shape, the silent default, the fabricated zero) before the implementation, then GREEN. Focused: `rule-engine`, `distance`, `dispatch-advisor`, `dispatch-recommendation-preparation` — **54/54**. Neighboring surface (dispatch, AI, geo, integration routes): **47 files / 643 tests green**. Full suite: **5,722 passed / 6 failed across 523 files** — both failing files are the in-flight odometer workstream's known failures (`src/app/api/trips/[id]/live-monitor/route.test.js`, `mobile/lib/off-duty-illustration.test.js`), untouched here. `lint:ci` and `verify:encoding` clean; `db:status` 166 applied / 0 pending / 0 changed (no migration added this pass). Left uncommitted alongside the odometer workstream.

## Estimate reconciliation & stale-reference labels (FE-19, FE-11, FE-06 extension, daily chart, Level 3 read-out) — 2026-10-18 (implemented; working tree uncommitted)

The final pass over the estimates audit, with every product question answered before code. Test-first again — the three touched suites were RED (10 failing expectations) before the implementation. **No schema change, no migration.**

### Product decisions recorded (2026-10-18)

- **FE-12 — keep claimed-first distance precedence.** The odometer → trip-distance → gps-trail order was already pinned by `trip-estimate.test.js`, and the provenance chip shipped in Phase 3, so the basis is visible where the number is. No code change.
- **FE-06 extension — close on trip end, not just cancellation** (below).
- **FE-11 — a 14-day stale-reference label**, display-only (below).
- **FE-19 — receipt actuals on `/fuel/estimates`** (below).
- **FE-04 — keep the assume-return forecast default.** The assumption is already explicit (`round_trip_assumed`, `assumed_return_km`, `paired_forecast_legs`) and recorded at forecast time; no change.
- **Level 3 — measurement plan + read-only measured strip.** No model change; measured efficiency does not become the primary basis.

### Trip-end closure (FE-06 extension)

`closeOpenRequestForEndedTrip` (renamed from `…ForCancelledTrip`) now closes an open permit when its linked trip is **`Completed`**, **`Cancelled`** or **soft-deleted** — lazily, on the next request POST, once with one retry, exactly as the cancellation-only version did. Two guardrails: a permit with a **linked live receipt** is never auto-closed (the fuel was actually drawn; the same rule the driver-withdraw path enforces), and the review note names the end that happened ("completed before the request was reviewed" / "cancelled before…"). The `auto-close` audit record's `reason` now distinguishes `trip-completed` from `trip-cancelled`. The `linked_receipt_count` subselect lives in `openRequestForVehicle`, shared by the close path and the withdraw guard; the 409 payload still shapes its own `blocking_request` fields.

### Stale reference price label (FE-11)

`REFERENCE_PRICE_STALE_AFTER_DAYS = 14` in `src/lib/fuel/price-policy.js` is a **display-only** horizon. Rows carry `price_age_days` (floored days between the snapshot's `effective_at` and the estimate capture) and `price_stale` — both computed in SQL at exactly that interval comparison — and the totals query joins `fuel_price_snapshots` for a `stale_priced_trips` count. The page renders a per-row "Stale reference · N d old" chip in the Price basis column and a range-level warning ("N priced trips used a reference older than 14 days") when the count is non-zero; export gains "Price age (days)" and "Stale reference" columns. The label never changes which price was eligible or how the estimate was computed.

### Estimate vs receipt (FE-19)

Each row now carries `actual_fuel_l`, `actual_cost` and `actual_receipt_count` from a `LEFT JOIN LATERAL` over **eligible receipts** — `status IN ('Approved', 'Completed')` and `deleted_at IS NULL`, the same caliber Reports' measured efficiency uses — linked to the trip. The page adds a **Receipt** column (litres, cost, receipt count) and a **Δ vs receipt** column computed as estimate − receipt for both litres and cost, null-safe in both directions ("—" whenever either side is missing — never a delta against an unknown, never a fabricated 0 for a trip with no receipt). Export gains "Receipt fuel (L)", "Receipt cost", "Delta vs receipt (L)", "Delta vs receipt cost". Live evidence: **12 of the 35 completed trips** currently carry a linked verified receipt (20–38 L each), so the column and deltas render on real rows.

### Daily cost chart

The route returns a `daily` series grouped by the **Manila completion day** (`TO_CHAR((t.end_time AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD')`), with the same filters as the totals; the page renders it as a recharts bar card ("Cost per day") only when the series is non-empty, using the established analytics-chart styling (`chart-h-md`, tooltip CSS vars, `aria-hidden` decorative wrapper). Bars show the locked estimate cost per completion day; a day where no completed trip was priced renders as 0 — the priced-coverage KPI and the per-trip table carry that caveat.

### Level 3 — measurement plan + read-only read-out

The route returns a read-only `measured` block — `efficiency_kmpl`, `liters`, `distance_km`, `min_distance_km` — taken from the **official measured caliber** (`getFuelConsumptionReport` and `MIN_EFFICIENCY_DISTANCE_KM = 50` in `src/lib/reports/fuel-consumption.js`). The page shows a slim strip under the KPI grid: the period's measured efficiency (otherwise "insufficient data — needs at least 50 km…"), explicitly labelled a read-only reference — the locked estimates keep their configured profiles, and no third caliber was introduced. Full Level 3 (traffic/grade/route-class/per-driver factors as the primary basis) stays parked behind a written plan: [[Level 3 Fuel Efficiency Measurement Plan]], which lists the graduation gates (since **signed off** and wired — see the phase-1 section below) that kept measured efficiency from replacing the configured profile until its data could be trusted.

**Roadmap residue after this pass.** Audited estimates findings (FE-01…FE-19) are delivered or explicitly parked. Phase 1 of Level 3 (measured basis behind signed-off gates) shipped 2026-10-19; the factor-segmentation half of full Level 3 (traffic/grade/route-class/per-driver) remains parked pending new data capture (the plan's backlog — it will not be invented), and the measured-basis read-out on the vehicle profile page is deferred. Request auto-expiry remains an open product decision (no time-based close was added). The estimates page's interaction paths and the mobile withdraw flow still need browser/device acceptance (the vitest harness is node-only).

**Verification (2026-10-18, offline + live).** Test-first: three suites RED (10 failing expectations) → GREEN; focused four suites **52/52** (requests route, estimates route, estimates page, price-policy). Neighboring fuel surface (`src/app/api/fuel`, `(dashboard)/fuel`, `src/lib/fuel`, `src/lib/reports`, fuel-settings service): **34 files / 251 passed / 12 skipped**. Live read-only verification (temp `pg` script against the real DB): the new rows SQL (receipt lateral + price age) returned 35 rows with `price_age_days` showing single-digit ages on priced rows and `price_stale` false; the totals stale filter, the daily aggregate and the permit select with `linked_receipt_count` all executed; the report's own caliber queries returned **372.00 L over 873.40 km across 12 receipts** in the current demo range (≈2.35 km/L), so the read-out renders a value, not the insufficient-data branch. Gates: `lint:ci` clean, `verify:encoding` clean, `db:status` 166 applied / 0 pending / 0 changed. Full suite: **5,733 passed / 6 failed across 523 files** — both failing files are the in-flight odometer workstream's known failures (`src/app/api/trips/[id]/live-monitor/route.test.js` 4, `mobile/lib/off-duty-illustration.test.js` 2), confirmed by re-running exactly those two files. Left uncommitted alongside the odometer workstream.

## Final shared-check cleanup - 2026-10-19

Escaped the apostrophe in the estimates page JSX while preserving the displayed wording. Whole-repository strict lint now passes with zero warnings. The estimates page tests passed as part of the 55-test focused cleanup run and the fresh passing full regression suite. The formerly failing shared Off Duty assertions now follow the approved duty-independent Trips date-tab design; Home and Map duty artwork/icon checks remain. Production webpack build passed. See [[Trip Odometer Photo Verification 2026-10-19]] for exact full-suite totals. No fuel calculation, schema, provider or operating data changed in this cleanup.

## Fuel estimates review - 2026-10-20 (analysis complete; focused polish approved and implemented below)

Reviewed the uncommitted estimates page/API, saved-estimate arithmetic, receipt comparison, report reference, measured-efficiency gates and related notes. Existing saved-estimate arithmetic preserves decimal rounding and missing-price litres; no calculation failure was found in the focused checks. Confirmed follow-up items:

- The measured-reference sentence displays litres divided by kilometres while labelling the result km/L. The report computes distance divided by litres correctly; the explanation needs correction.
- The period reference comes from `getFuelConsumptionReport(from, to)` for the entire fleet. Region and vehicle filters apply to the estimates but not that reference. Label its fleet-wide scope explicitly.
- The daily SQL and chart normalizer convert absent estimated costs into zero. Preserve an unavailable daily cost separately from a genuine zero and show daily priced coverage. The chart also needs an accessible text/table equivalent; its current wrapper is hidden from assistive technology.
- Date validation relies on `Date.parse`, which accepts `2026-02-30` and normalizes it to March 2. Reject impossible calendar days before querying the database.
- Export pagination orders only by `end_time`. Add the unique `trip_id` as a tie-breaker so equal completion timestamps have a stable page order.
- Inspect the six-column KPI grid and wide comparison table at laptop/mobile widths during the polish pass. These are visual-review targets, not confirmed rendered defects.

Approved scope: preserve saved estimates, receipt eligibility, reference-price rules and shared visual identity; fix the confirmed display/input/export issues and improve table readability. No application code, schema or operating data changed during the initial review. The user then approved the focused polish; the implementation is recorded below.

Verification: focused estimates page/API + trip-estimate + measured-efficiency suites **46 passed**. Wider fuel, geo-distance and report-caliber run **27 files passed, 1 file skipped; 218 tests passed, 3 skipped** (database closeout checks). Reproduced JavaScript's impossible-date normalization directly. Browser navigation to `/fuel/estimates` redirected to `/login`; authenticated visual and interaction acceptance remains unverified.

## Fuel estimates focused polish - 2026-10-20 (implemented)

Applied the approved fixes to the existing read-only estimates page and API. No saved estimate, reference-price eligibility, receipt eligibility, forecasting gate, permission, schema or operating data changed.

- **Daily costs:** SQL preserves null costs/litres and returns `priced_trips`; chart normalization retains null separately from a genuine zero. Daily totals explain priced-only coverage, warn about unpriced days, and offer **View daily totals** with cost and priced-count columns. The table remains available to screen readers while collapsed, and the decorative chart has its own keyboard accessibility layer disabled. The expanded daily table and trip comparison table have named, focusable scroll regions.
- **Clearer reference:** the period reference explicitly covers all vehicles and regions for the selected dates, and explains that region/vehicle filters do not affect it. The km/L sentence now correctly shows completed kilometres divided by verified receipt litres. Saved estimates retain their original basis.
- **Readability:** six KPIs use three desktop columns with wrapping value notes, avoiding squeezed six-column cards. An average with no priced trips is unavailable. The trip table uses tabular data text, comparison directions are explained, and the receipt comparison explicitly describes fuel purchases rather than measured consumption. Export/header controls stack on narrow screens, and export waits until data is available.
- **Dates and export order:** impossible dates are rejected before querying, real leap days remain valid, and rows order by completion time plus unique trip ID so equal timestamps have a stable export page order.

**Verification:** five added regression tests plus updated daily contract fixtures produced **7 failing checks before implementation**, then **37/37 focused tests passed**. The surrounding fuel/report/distance run passed **223 tests in 27 files**, with **3 database closeout checks skipped**. A live read-only route harness (database writes disabled on its connections) verified the October range (**14 completed trips / 7 days / 3 days with unavailable cost**), filtered empty results, page 2 and invalid-date rejection. This verifies real SQL execution, not browser authentication.

**Browser acceptance:** a local synthetic preview bundled the real page, shared controls, Recharts and global styles, replacing only API/session boundaries and Next link navigation. Checked 1280 and 390 px light, 320 px dark, and 768 px layouts; cards and the document no longer overflow, while wide tables scroll inside their own regions. Keyboard arrow scrolling moved the daily table, vehicle search and Last month applied, region selection worked, and the CSV download contained exactly the searched sample trip with missing costs left blank. Loading, empty and error states rendered; export stayed disabled without data. Browser warning/error logs were empty on the tested path. Independent code review reported no confirmed actionable findings. The initial hidden-table overflow was fixed by clipping a containing block rather than the table itself.

**Limits:** preview data is synthetic and the preview omits the dashboard shell. Authenticated staff acceptance and a full production build/full-repository test run were not performed in this focused pass. See the implementation checklist at `docs/superpowers/plans/2026-10-20-fuel-estimates-polish.md`.

## Gated fuel practice - 2026-10-21

Fuel request and receipt review controls are shared with local sample handlers. The sample requires fictional gauge evidence/25%, leaves its request Pending and corrects the printed receipt total2911.25 and45.5litres. It cannot create approval, open a camera/gallery, upload evidence or insert a queue record. Real operational validation and approval remain in FuelReport. V2 is default-off; see [[Driver Guidance Redesign Implementation Plan 2026-10-20]] for verification and remaining native/participant acceptance.
