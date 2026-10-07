# FleetOps × Supply Chain Integration — Audit and Implementation Plan

**Status:** Audit and plan remain source-grounded; foundation slice implemented on 2026-10-07; P0 is not complete  
**Audit date:** 2026-10-07  
**Scope:** The original audit was read-only. The user's later instruction to proceed authorized a bounded foundation implementation; see the implementation progress below.

### Implementation progress (2026-10-07)

| P0 area | Current status | Evidence / remaining boundary |
|---|---|---|
| Contract and owner approval | **Pending** | Added a versioned sandbox-only Zod contract and admin-only importer. No external SCM/HR contract, partner authentication, owner approval or real endpoint was available; the production importer is disabled. |
| Private schema and security | **Foundation implemented** | Migrations 144-146 add cargo profile, shipment snapshot, immutable manifest revision, inbox, shipment event, sandbox site-mapping and rejected-attempt tables. RLS and anon/authenticated privilege revokes are explicit. Migration 147 adds the typed dispatch slot. Allocation, receipt, evidence and outbox relations are still absent. |
| Sandbox site identity | **Implemented** | Admin maps imported sandbox SCM site IDs to active Fleet locations with stored addresses and valid coordinates. This does not geocode, prove route feasibility or enable assignment. |
| Physical load checks | **Partial** | Profile verification now fails closed when verifier, timestamp, reference or a valid future expiry is missing. Payload/volume/package-fit/handling/temperature checks, pickup readiness and the existing vehicle non-dispatchable status rule are implemented. The evaluator does not establish packability, securement, axle distribution, documents, roadworthiness, driver eligibility or schedule availability. |
| Shared dispatch and assignment | **Typed slot foundation implemented; assignment pending** | Migration 147 adds `dispatchschedules.service_type`. Existing request-linked rows are `PASSENGER`; legacy requestless rows remain NULL; new general dispatch API creates are stamped `PASSENGER` and reject `SUPPLY_DELIVERY`. No shipment allocation, recommendation token, commit-time revalidation or shared assignment transaction exists, and the page cannot assign or reserve vehicles/drivers. |
| Driver execution and receiving | **Not implemented** | Mobile cargo projection/checkpoints, proof of delivery, receiver authorization, per-line receipt/discrepancy and SCM acknowledgement remain pending. Trip completion and GPS do not update shipment receipt or stock. |
| Reporting and reproducible end-to-end demo | **Passenger partition partial; cargo reporting/demo pending** | Fleet Utilization, Driver Performance, and Trip Performance now exclude typed `SUPPLY_DELIVERY` trips while keeping legacy untyped trip rows in the existing passenger reports. Fleet Cost, Financial Summary and Fuel Consumption remain fleet-wide. Cargo-specific KPIs and a contract-to-receipt walkthrough do not exist. No synthetic operational rows were inserted. |
| Dispatch and report source inventory | **Complete (source audit)** | The base `vehicles` model has passenger seating/license data but no verified cargo ratings; migration 144 added separately verified payload, GVW/operating-mass, volume, compartment/opening geometry, temperature and handling fields. The request assignment endpoint and `POST /api/dispatch` are the two dispatch creation paths; request assignment auto-creates the passenger dispatch/trip in its transaction. Passenger punctuality and trip activity were previously untyped; those passenger reports now filter out `SUPPLY_DELIVERY` and retain legacy untyped history. Fleet Cost, Financial Summary and Fuel Consumption use shared fleet distances/consumption. No cargo dispatch path exists, so current report values remain unchanged. |

After contract validation, semantic sandbox conflicts are stored as rejected inbox receipts when their source event identity is available and unused. Migration 146 adds `supply_integration_attempts` for parsed JSON payloads that fail Zod validation and event-ID, sequence, request or business conflicts that cannot be represented by a unique inbox row. Attempts store a payload hash, bounded source identifiers only when the organization ID is sandbox-scoped, a rejection code/status, the authenticated employee and timestamp; rejected bodies and invalid field values are never copied. Syntactically malformed JSON is still rejected by the shared parser without an attempt row. Migration 147 adds the `dispatchschedules.service_type` discriminator: request-linked legacy rows become `PASSENGER`, requestless history remains NULL, and new general dispatch API rows are explicitly `PASSENGER`; that endpoint rejects `SUPPLY_DELIVERY` until an allocation path exists. Live schema metadata confirmed the default and check constraint, and the exact dispatch list query returned all 37 active rows. Fleet Utilization, Driver Performance and Trip Performance now exclude typed supply dispatches while retaining legacy NULL rows; live read-only SQL confirmed the filters and found no current cargo trips. The load evaluator blocks enabled profiles with missing/invalid verification identity, timestamp, reference or expiry. The live `db:contract` reports zero violations across 75 relations; the seven supply tables remain private. `verify:anon` explicitly refuses those seven relations but exits 1 because 48 older HTTP-empty probes remain inconclusive; the live contract resolves those as RLS enabled with no anon policy. Focused ESLint passed for the import route/service, evaluator, dispatch typing and report changes. No automated tests, build, browser/device acceptance or deployment verification was run.

## 1. Executive summary

The post-defense gap is a real goods-transport workflow. FleetOps can reserve a driver and vehicle, create a trip, show passenger-oriented work in the driver app, and report trip movement. The audited repository does not contain a shipment/manifest domain, package weight or geometry model, cargo vehicle ratings, load checkpoints, or receiving/POD workflow. A truck label or a new vehicle category would not close that gap.

The recommended architecture adds a bounded Supply Delivery domain and attaches its allocations to FleetOps’s existing dispatch resource reservation and trip execution. This keeps passenger bookings and cargo manifests separate, while making both consume the same driver and vehicle calendar and the same database overlap guard. A supply shipment keeps its own manifest revision, cargo events, and receiving evidence. The existing trip status remains a vehicle-execution status; it never means that goods were accepted into inventory.

P0 is a demo-safe, one-shipment/one-trip path with a versioned SCM contract, measured cargo capabilities, deterministic hard eligibility, safe shared dispatch, distinct mobile pickup/drop-off handling, receiver verification, and a visible SCM acknowledgement using a sandbox adapter if the real SCM contract is not available. FleetOps records transport evidence; SCM/Receiving alone decides whether accepted quantities post to inventory. P1 brings real partner connectivity, reliable retries/reconciliation, partial and split work, returns, and expanded handling. P2 covers batching and optimization.

### Ownership map

| Concern | System of record | FleetOps boundary |
|---|---|---|
| Purchasing, suppliers, item catalog, stock and inventory posting | Supply Chain / Procurement / Inventory | Receive an approved transport snapshot; never become a second purchasing or inventory ledger. |
| Request approval, manifest and packed goods facts | SCM provides the approved revision | Validate transport completeness and suitability; retain immutable revisions and source references. |
| Vehicles, verified cargo capabilities, maintenance and Fleet availability | FleetOps | Maintain measured ratings and explicit service eligibility; share availability across passenger and supply work. |
| Driver assignment, trip, GPS, ETA and road operations | FleetOps | Apply existing server-side permissions, license, duty, schedule, leave, pairing and conflict checks. |
| Loaded, delivered, accepted, damaged, missing quantities and receipt | Warehouse / Receiving / SCM | Record transport evidence and send it to SCM; never infer receipt from GPS or trip completion. |
| Employee leave and HR status | HR, if an authoritative interface is available | Do not expand FleetOps into an HR system. Continue enforcing the currently available approved leave/schedule evidence until a governed HR feed is agreed. |

The current local leave and schedule workflow is an existing FleetOps dependency, not evidence of an HR integration. Its future authority must be resolved with HR before replacing or synchronizing it.

## 2. As-is inventory with repository evidence

The status labels below describe this checkout. “Missing” means no implementation was found in the audited source, mobile, migration, and generated-schema paths. It does not assert that an external SCM/HR service has no API. The checked-in schema dump is a local artifact, not a live catalog check.

| Area | Status | Current evidence and finding |
|---|---|---|
| App/database architecture | Verified | Next.js API routes, services and scheduling/domain modules are separate; the independent driver app is Expo/React Native. *src/lib/db.js:1-2* uses Supabase JS and pg boundaries; *scripts/migrate.mjs:1-17, 22-28* is the ledger-based PostgreSQL migration runner. The passenger trip flow is exposed by *src/app/api/mobile/driver/trips/route.js:52-101* and consumes driver-scoped work. |
| Existing external boundary | Verified | *src/lib/integration/contracts.js:21-65* validates a guest transportation request with passenger count and Booking terms. *src/lib/integration/ingest.js:48-58, 79-96* is idempotent on external booking ID and inserts passenger fields. It is not a goods manifest contract. |
| Booking connectivity | Verified | *src/lib/integration/booking-gateway.js:6-13, 97-130* says the mock is the default and the HTTP gateway throws while unconnected. This is not an SCM connection. |
| SCM contracts, partner identity and event API | Missing / Unclear | No cargo/shipment implementation was found by searching *src*, *mobile*, *supabase/migrations*, and *schema.sql*. External SCM endpoint/schema, auth model, event order and sandbox are unavailable in this repository audit. |
| Request storage | Verified | Local *schema.sql:960-1003* describes *transportation_requests* with external booking ID, guest, pickup/drop-off, passenger count, service/category and passenger lifecycle fields. *Capstone/03 - Database/Tables/transportation_requests.md:20-50* documents Booking-owned facts and its reservation event writer. No package manifest or goods lifecycle is represented there. |
| Dispatch resource reservation | Verified | Local *schema.sql:219-242* has a dispatch row with nullable *request_id*, vehicle, driver, time window and status. *src/app/api/dispatch/route.js:35-64, 165-193* accepts a request-less dispatch, validates passenger requests when present, checks a pair and conflicts, inserts the shared slot, then only advances a reservation when one exists. |
| Cross-category concurrency primitive | Verified, source-only | *supabase/migrations/029_dispatch_overlap_guard.sql:1-9, 26-59, 66-71* takes per-vehicle and per-driver advisory transaction locks and rejects overlapping active dispatch rows using half-open time comparisons. This only protects cargo if cargo assignments write through the same dispatch table with a complete positive time window. The on-disk filename is 029, while its SQL comment and older Capstone references say 023; do not infer migration numbers from the old note. |
| Trip execution | Verified | *src/services/status.service.js:345-373* creates a trip from a dispatch’s vehicle, driver and route, and checks for an existing non-deleted trip. Local *schema.sql:1022-1064* allows 16 trip states including passenger-specific “Passenger Onboard.” *src/lib/scheduling/trip-state.js:43-65* defines the adjacency graph. Trip completion cannot stand for receiver acceptance. |
| Passenger assignment and planning | Verified | *src/app/api/integration/transport-requests/[id]/assign/route.js:29-76, 146-176* uses reservation permissions, queue plan tokens, pair validation, and transactional evidence revalidation. *src/app/api/integration/transport-requests/dispatch-plan/route.js:8-20, 32-45* protects the plan route. *src/services/dispatch-plan.service.js:26, 135-158* projects passenger request fields and plans those requests; it is not a cargo planner. |
| Vehicle master data and screens | Verified / Missing | *src/app/(dashboard)/fleet/vehicles/new/page.js:493-594* edits category, passenger seating and operational status. Local *schema.sql:1198-1234* contains passenger seating and a required driver license class constrained to B/B1; it has no payload, cargo volume, package fit, loading opening, refrigeration or cargo-service profile. *Capstone/03 - Database/Tables/vehicles.md:49-57* says goods class B2 is unsupported pending confirmation and system extension. |
| Vehicle availability board | Verified | *src/app/api/dispatch/availability-pairs/route.js:61-84, 108-149, 164-179, 301* checks windowed passenger seating, fleet status, document/coding, clashes and schedule context. Its “capacity” is seating; it does not establish freight suitability. |
| Driver eligibility and leave | Verified / Missing | *src/lib/scheduling/driver-schedule.js:1-13, 85-105, 117-125* blocks approved leave, missing schedules, rest days, shift violations and break overlap; *src/lib/scheduling/day-eligibility.js:46-80* fails closed for missing schedules/rest days and approved leave. *src/services/driver-schedule.service.js:102-115, 153-228* reads and reviews the local leave table. No HR-owned feed was found; local records and policy are not proof of an HR integration. |
| Server authorization | Verified | *src/lib/auth/permissions.js:16-22, 119-146, 190-199* defines current actors and server-side resource/action permissions. Dispatch and reservation routes call *requirePermission*; new SCM, warehouse and receiving actions need distinct server checks and record ownership, not just hidden UI. |
| Driver mobile job projection | Verified / Missing | *src/app/api/mobile/driver/trips/route.js:52-101* scopes to the authenticated driver, joins dispatch to *transportation_requests*, and returns guest name/passenger count. *mobile/app/(app)/(tabs)/trips.js:36-80* renders passenger-oriented cards. There is no supply job projection, manifest, loading confirmation or proof-of-delivery flow in the audited files. |
| Mobile inspections, tracking and offline behavior | Verified / Unclear for freight | *Capstone/02 - Features/Trips.md:56-92, 101-112* documents mandatory Pre-Trip/trip gates and foreground GPS every 30 seconds; the inspection concept includes passenger-items/cabin readiness and should not appear as a cargo questionnaire. *mobile/lib/tracking.js:18-21* defines the 30-second post interval. *Capstone/04 - Architecture/Mobile Architecture.md:369-385* documents driver-scoped, display-only cache and server-authoritative queued actions. No cargo checkpoint retry policy exists. |
| Mobile SDK instructions | Unclear / Must resolve before implementation | *mobile/package.json:12, 25, 31-34* reports Expo ~54 and Router ~6; *mobile/AGENTS.md:1-3* requires consulting Expo v57 docs before mobile code. Confirm the repository policy/version mismatch and use docs matching the installed SDK or deliberately upgrade as a separate approved change. |
| Current integration retries | Verified, scoped | *src/app/api/system/health/integration-retry/route.js:7-16, 19-37* is a super-admin retry for outbound *integration_log* rows via the existing Booking reconciliation service. This is not an SCM inbox/outbox, inbound manifest revision reconciler, or dead-letter contract. |
| Metrics and reports | Verified / Missing | *src/lib/reports/operational-reports.js:441-476* summarizes all non-deleted trip rows into shared total/completion/distance metrics. Driver punctuality is based on server-stamped pickup and scheduled passenger pickup in *src/lib/reports/operational-reports.js:178-223, 227-245*. Cargo records therefore need an explicit service type and separate KPIs; adding trips without partitioning would distort current totals and guest pickup punctuality. |
| Capacity, manifest, POD and receipt | Missing | No matches for cargo, shipment, gross weight, cargo volume or proof of delivery were found in the audited source/schema/migration search. Existing *trips* and *dispatchschedules* do not hold these goods facts. |
| RLS and schema policy for new tables | Verified policy; no new objects | *scripts/lib/schema-contract.mjs:70-181, 443-455* classifies tables and views; *scripts/lib/sql-references.mjs:105* extracts SQL references. Repository policy requires explicit RLS and privilege review for new tables/views; generated *schema.sql* does not show policies/grants. Live catalog and migration ledger were not queried for this plan. |

### Evidence limits

This is a repository source audit, not a live database, external partner, browser, device, or production audit. No tests/build, migration status, schema dump, authenticated screen flow, SCM/HR call, or receiving/inventory write was run. Do not treat live row counts in older Capstone notes as current. Before implementation, confirm the live migration baseline with the repository runner, refresh the generated schema if it is behind, and validate external owners’ contracts.

## 3. Requirements traceability

| ID | Business requirement | Owner module | Existing support | Gap | Priority | Acceptance criteria |
|---|---|---|---|---|---|---|
| R1 | Accept only approved SCM transportation requests with scoped source identity | SCM integration boundary | Booking has a separate push/pull boundary | No SCM schema/auth/ownership mapping | P0 | Valid approved request creates one Fleet snapshot; unapproved, foreign-source or malformed data is rejected without partial writes. |
| R2 | Preserve manifest revisions, SKU, transport quantity and package facts | Supply shipment domain | None | No goods entities or immutable revision model | P0 | Same revision is immutable; newer revision is explicit and auditable; quantity per purchased item is never assumed to equal package count. |
| R3 | Register measured cargo-capable vehicles | Fleet vehicle master | Passenger category/seats/status/docs | No explicit freight service flag or measured physical profile | P0 | Cargo is eligible only with verified per-vehicle ratings and explicit SUPPLY_DELIVERY permission. |
| R4 | Enforce payload, volume, package fit and handling as hard constraints | Cargo feasibility service | Passenger seat floor and operational checks | No weight, geometry, volume, temperature or load-distribution check | P0 | Any over-limit or unknown safety-critical value blocks assignment; no administrative or AI override. |
| R5 | Share driver/vehicle calendars across passenger and supply work | Dispatch service/database | Shared dispatch table, app conflict checks, DB overlap trigger | Current planner and request assignment are passenger-shaped | P0 | Simultaneous passenger/cargo allocation to the same driver or vehicle/window yields at most one committed dispatch. |
| R6 | Keep queue recommendations bound to current evidence | Supply plan/assignment APIs | Signed passenger queue token and transaction revalidation | Cargo-specific token inputs and revalidation missing | P0 | Stale manifest, capacity, duty, pair or schedule evidence invalidates the proposal at commit. |
| R7 | Separate shipment checkpoints from trip state | Supply shipment + mobile | Trip graph and GPS | No warehouse load, delivery, discrepancy or receipt state | P0 | Trip can complete without receipt; a receipt changes only on receiver/SCM evidence. |
| R8 | Display a distinct supply delivery job to drivers | Mobile app/API | Driver trip list, route, GPS, inspection, offline cache | Current projection and cards are guest/passenger-shaped | P0 | Driver sees only own assigned job, correct manifest summary, handling needs, load and drop checkpoints; no guest/passenger controls. |
| R9 | Capture receiver evidence and synchronize accepted quantities | Receiving/SCM boundary | None | No receiver role, POD records, line discrepancies or receipt event | P0 | Receiver records accepted/damaged/missing/rejected quantities; Fleet sends evidence; SCM alone posts stock. |
| R10 | Handle split, partial, return, multi-stop and mixed orders | Shipment allocations | Existing shared trips only | No allocation map or partial-delivery model | P1 | Per-line allocations reconcile across trips; no quantity is allocated/delivered/accepted twice. P0 blocks unsafe single-trip loads and recommends additional vehicles. |
| R11 | Protect request and event integrity through duplicate, revision and retry | Integration boundary | Booking external ID idempotency and outbound retry | No SCM event ID, revision sequencing or durable retry ledger | P0 basic dedupe; P1 robust retry | Duplicate key/body returns original result; conflicting body/revision returns a conflict and an auditable reason; retries do not duplicate effects. |
| R12 | Respect driver license, duty, schedule, leave and active work | Shared eligibility | Current pairing, license, schedule and local approved leave checks | No HR feed; goods license code/qualifications unresolved | P0 existing evidence; P1 HR connection | Ineligible, off-duty, on approved leave or conflicting driver is blocked server-side. Missing HR integration is reported as unresolved. |
| R13 | Keep passenger KPIs and flow intact | Passenger modules/reporting | Passenger lifecycle and metrics | Shared trip counts may mix job types | P0 | Passenger endpoints/statuses/UI keep current contracts; report filters prove passenger-only measures do not include cargo. |
| R14 | Enforce partner, dispatcher, driver, warehouse and receiver permissions | API/RBAC | Existing role matrix and driver ownership | No SCM/warehouse/receiver permissions or shipment ownership checks | P0 | Tampered IDs, wrong partner, wrong driver, and unauthorized receipt writes fail at the server and are audit-logged without leaking records. |
| R15 | Recover across outage, session refresh and replay | Integration/mobile | Booking outbound retry, mobile outbox/session refresh | No cargo-specific event ordering/offline command semantics | P1 | Replay/outage tests produce one effect, truthful pending status, and no bypass of refreshed server authorization. |
| R16 | Measure supply performance separately | Reports | Trip and driver reports | No cargo utilization, discrepancy or on-time-delivery dimensions | P0 minimal separation; P1 full KPIs | Passenger punctuality and performance remain passenger-only; cargo receives separate delivery and utilization metrics with unknown history quarantined. |

## 4. Architecture options and decision

| Option | Shape | Advantages | Costs and risks |
|---|---|---|---|
| A. Minimum extension of current reservation model | Put supply requests into *transportation_requests* with a service type, append cargo fields/JSON, adapt current queue and assignment flow. | Lower initial route count; can reuse parts of queue and reservation notifications. | The current contract/schema contain guest, passenger count, booking status and passenger request states. Cargo lines, multiple revisions, accepted quantities and multiple trips do not fit that row. Extending its single-writer/status/integration behavior risks changing Booking semantics and passenger reports. |
| B. Bounded shipment domain attached to shared trip execution — recommended | Add supply request/manifest/allocation/event/receipt records. A shipment allocation points to a shared *dispatchschedules* resource slot; the generated *trips* row points to that dispatch. Add a typed driver job projection. | Goods lifecycle and source ownership stay separate; existing common dispatch slot and trip/GPS infrastructure can be reused; shared overlap guard can prevent cross-service double booking; can later split/partially deliver without treating cargo as a guest. | Requires a migration, cargo-specific API/UI, checks and report partitioning. Existing plan service and mobile response are passenger-specific, so reuse must be at the shared scheduling primitives, not their passenger projections. |

Choose B. Keep the current passenger request and trip APIs compatible. For new work, add a dispatch operation type and a shipment-to-dispatch allocation bridge; supply dispatches have no passenger request ID. Require the bridge and operation type to be written atomically. Audit request-less historical dispatches before imposing stricter constraints; do not label them as supply or passenger by guess. All passenger and supply work still reserves the same dispatch row for the same driver and vehicle, so the current database overlap guard remains the final shared race barrier.

P0 permits one shipment on one trip. A shipment that fails any load check remains unassigned and offers an explicit “plan additional vehicle/split” next step; it is never forced onto a larger-looking vehicle. P1 activates multi-dispatch allocation and partial quantities. P0 does not combine passenger riders and cargo on one trip. Future mixed-service use requires explicit operational/legal approval, dedicated compartment/sanitation evidence, and tests.

## 5. Domain and schema changes

These are proposed entities, not confirmed existing tables. Names may change after SCM schema review.

| Proposed entity | Key and main contents | Owner / rules |
|---|---|---|
| vehicle cargo profile | vehicle_id primary/FK; supports_supply_delivery, verified revision/date/actor; rated payload kg; legal GVW and operating mass when available; usable internal dimensions and volume; loading opening dimensions; single-package limits; axle limits; temperature range; sanitation/segregation and equipment. | FleetOps. One current verified profile per vehicle; missing/stale required ratings make it ineligible. Category or marketing name never implies capacity. |
| supply shipment | Fleet shipment ID; source organization; external SCM request ID; request and approver references; current manifest revision; pickup/drop stops and contacts as minimized snapshots; timezone/window; priority; SCM status snapshot; Fleet validation/assignment projection; source payload hash and timestamps. | FleetOps copy of SCM facts. Unique (source organization, external request ID); SCM remains master for approval and inventory. |
| supply manifest revision | shipment ID + monotonically increasing external revision; immutable line/package snapshot; source hash/schema version; received actor/time. | A correction creates a revision; it does not rewrite loaded/accepted history. Revision after assignment invalidates the old plan and requires fresh validation. |
| manifest lines and package specs | Revision + external line ID; SKU reference/description/category; ordered quantity/UOM; transport quantity/UOM; units per package; package count; gross kg/package; L×W×H in canonical metres; optional pallet footprint/stack height; orientation/stack/fragile/food/temperature/securement requirements. | Quantities use explicit UOM and conversion provenance. No inferred package count or package size from purchased quantity. |
| shipment-dispatch allocations and line allocations | Shipment ID + dispatch ID; manifest revision; allocated line/package quantities; planned stops/order; allocation status. | Bridge many shipment-to-dispatch and dispatch-to-shipment for future work. P0 enforces one shipment per dispatch; P1 permits only the tested combinations. Tie the driver’s job to dispatch ID because a trip is generated from a dispatch. |
| shipment events | Shipment ID, event ID, event type, source/actor identity, manifest revision, occurred/recorded timestamps, sequence and correlation ID, concise redacted metadata. Append-only. | Fleet checkpoints and source/receiver events; unique scoped event key prevents replay. No inventory balances. |
| receipt and receipt lines | Shipment/allocation ID; receiver identity and role, signed timestamp; quantity received/accepted/damaged/missing/rejected by line; discrepancy reason; private evidence object references; SCM reconciliation ID/status. | Receiver/SCM authors acceptance. “Received” and “accepted” remain different quantities. Media lives in private storage with retention rules, not event JSON. |
| integration inbox/outbox (or a justified extension) | Source + event ID + body hash + schema version + correlation ID + status/attempts/next attempt/result. | Durable idempotency and delivery intent. Existing *integration_log* is Booking-oriented and has no established SCM sequencing contract; do not repurpose it without a reviewed compatibility decision. |
| dispatch typing | operation_type on *dispatchschedules* (PASSENGER, SUPPLY_DELIVERY, and a temporary reviewed legacy value as needed); request_id stays nullable for cargo; supply bridge identifies cargo source. | Existing request_id is passenger-specific. A deferrable constraint trigger or equivalent database-enforced transaction invariant must ensure passenger rows reference a passenger request and supply rows have an allocation. Do not deploy a strict check until live null/orphan history is reviewed. |

### Constraints and indexes

- External request uniqueness is scoped to SCM organization and external ID. Inbound event uniqueness is scoped to partner/environment and event ID. Manifest revision is unique per shipment; same version with a different body hash is a 409 conflict, not an overwrite.
- Every ready-to-dispatch manifest is non-empty. Package counts and quantities must be positive; package dimensions and gross weight must be finite and positive. Distinguish nullable “not supplied” from numeric zero. Bounds and precision need SCM/operations confirmation.
- Store normalized physical units: metres, kilograms, cubic metres, and Celsius. Store the original value/UOM and the versioned conversion source where source precision or conversion matters. Monetary and source quantities retain their currency/UOM; do not round item quantities through a floating-point conversion.
- A line’s transport package count is separately supplied or approved from SCM packing data. Preserve ordered, allocated, loaded, delivered, accepted, damaged, missing, and rejected quantities with conservation checks appropriate to the source’s UOM.
- Allocation transactions prevent cumulative active allocation from exceeding the manifest revision. Reassigning a shipment preserves the cancelled/released allocation and event history; it does not erase its first dispatch.
- Index source IDs/revisions, open shipment status + requested window, manifest-line joins, dispatch allocations by active dispatch, and outbox/inbox state + next-attempt time. Add indexes only for actual query shapes.
- If a view is added, set security_invoker and verify its grants; register it under VIEWS. Every new private table needs explicit RLS, grants/revokes for anon/authenticated, a schema classification, and SQL-reference registration as required by repository gates.

### Migration, backfill and rollback

1. Before selecting a filename, run the repository’s live-ledger npm run db:status and offline npm run db:check. The migration number is deliberately unspecified; the ledger, not the largest visible filename, decides what is available.
2. Deploy additive tables/nullable dispatch type first. Review the live catalog and request-less dispatch rows. Backfill only facts provable from existing foreign keys; keep uncertain historical dispatches explicitly unclassified until reviewed. Do not synthesize cargo profiles or infer B2/vehicle legal facts.
3. Build the schema-contract classifications and SQL references alongside any new table/API query. Apply through npm run db:up, refresh with npm run db:dump, and review generated schema; never edit schema.sql manually. Verify columns/FKs/indexes through the live catalog and rerun actual application queries.
4. For each new table/view, use npm run db:contract plus npm run verify:anon; resolve every empty probe against the catalog. RLS and grants are not visible in schema.sql. Keep object storage private and scope signed URLs.
5. Roll out behind a feature flag: contract/shadow validation, vehicle profile capture, dispatcher pilot, then one demo depot. If disabled, passenger flows continue and new SCM events are held/rejected with a retryable “feature unavailable” result. Do not drop audit, allocation, or receipt data to roll back code. A rollback stops new cargo assignment, drains/reconciles outbound events, preserves immutable history, and uses a forward corrective migration if data is wrong. Destructive down migrations are not the rollback plan.

## 6. Status machines and ownership

Never put cargo acceptance states into the current trip status constraint. The current trip graph has a passenger-specific “Passenger Onboard” state; delivery quantities and receiving belong to a separate shipment event model.

| State family | Proposed states and allowed movement | Authoritative owner |
|---|---|---|
| SCM approval/request snapshot | SCM owns approval, readiness, cancellation and manifest revision. Fleet stores received snapshots and maps them to RECEIVED → VALIDATING → BLOCKED or READY. A corrected revision re-enters validation. | SCM owns business approval and source revision. Fleet owns only validation result. |
| Fleet shipment | RECEIVED → VALIDATING → BLOCKED or READY. BLOCKED → VALIDATING on corrected data; READY → ALLOCATED; ALLOCATED → READY on safe release or LOADING; LOADING → LOADED or DELIVERY_EXCEPTION; LOADED → IN_TRANSIT or DELIVERY_EXCEPTION; IN_TRANSIT → ARRIVED or DELIVERY_EXCEPTION; ARRIVED → AWAITING_RECEIPT; AWAITING_RECEIPT → RECEIVED, PARTIALLY_RECEIVED or DELIVERY_EXCEPTION. PARTIALLY_RECEIVED → ALLOCATED for a replanned remainder, RECEIVED when the outstanding quantities are reconciled, or CLOSED_WITH_EXCEPTION only after SCM/receiver closes the remaining discrepancy. | Fleet owns validation and transport checkpoints; Receiving/SCM owns receipt outcome. Parent status is derived from allocations/receipts when split work is enabled. |
| Cancellation / return | READY or ALLOCATED → CANCEL_REQUESTED → CANCELLED only after dispatch is stood down and nothing was loaded. If loading has begun or cargo is onboard, cancellation becomes DELIVERY_EXCEPTION or CANCEL_REQUESTED → RETURN_PLANNED → RETURNING → RETURNED / CLOSED_WITH_EXCEPTION, with custody, quantity and receiver events. A delivery exception may return to READY/ALLOCATED only after its cause is resolved and all hard checks rerun. RECEIVED, CANCELLED, RETURNED and CLOSED_WITH_EXCEPTION are terminal; corrections are new linked events, not rewrites. | SCM requests cancel; Fleet records safe transport consequence; SCM decides stock disposition. |
| Dispatch | Keep current Scheduled, In Progress, Pending Reassignment, Completed, Cancelled and transition service. A supply allocation references the dispatch. Stand-down/reassignment releases resources while shipment history stays open for replanning. | Fleet dispatch service. |
| Trip execution | Keep current trip adjacency and start/roadworthiness gates. For a cargo job, do not use At Pickup/Passenger Onboard to mean cargo loaded. Use only the compatible generic execution progression, for example Assigned → Driver Accepted → Trip Started → In Progress → En Route → Arrived → Completed; the shipment has its own pickup/load/drop-off events. | Fleet driver/trip service. |
| Receiving/POD | NOT_SUBMITTED → SUBMITTED → VERIFIED, or SUBMITTED → REJECTED_FOR_CORRECTION → SUBMITTED. Verified quantities are immutable; correction is a new referenced receipt event. | Authorized receiver/SCM. Fleet records the evidence and outbound result. |

No automatic transition is triggered merely by elapsed time, GPS geofence, arrival, trip completion, or a retry. A partial shipment remains open while a remainder is replanned, or closes with exception only after the authorized receiver/SCM decision. On any cancel request, current dispatch/trip state is reconciled first; loaded goods retain custody history. A partial multi-allocation shipment’s displayed parent status is derived from its child allocations and verified receipts, with the derivation rules frozen with SCM before P1.

## 7. Physical load validation specification

Use a pure deterministic evaluator shared by recommendation and final assignment. It returns per-check PASS, BLOCK, or UNKNOWN with evidence, values, source revision and a dispatcher-readable reason. Only all-PASS hard checks are eligible. UNKNOWN safety evidence is not treated as a pass.

### Quantities and capacity

For each manifest package group i:

- packages_i = explicit transport package count (not bought SKU quantity unless SCM supplies a validated units-per-package conversion).
- gross_weight_i_kg = packages_i × gross_weight_per_package_kg.
- nominal_volume_i_m3 = packages_i × length_m × width_m × height_m.
- shipment_gross_weight_kg = Σ gross_weight_i_kg.
- shipment_nominal_volume_m3 = Σ nominal_volume_i_m3.
- safe_available_payload_kg = min(verified_rated_payload_kg, verified_gross_weight_limit_kg − verified_operating_mass_kg) − other_load_and_occupant_mass_kg, using a documented tare/GVW convention. If the rating convention or any component is unknown, the derived payload is UNKNOWN and the vehicle is blocked.
- weight_utilization = shipment_gross_weight_kg / safe_available_payload_kg; volume_utilization = shipment_nominal_volume_m3 / usable_cargo_volume_m3. Display separately; never blend them into one score. Values over 100% block.

Inputs are normalized from grams/centimetres/litres and approved UOM mappings before evaluation. Preserve enough decimal precision for safe comparisons; round only for display. Reject negative/zero quantity, missing required unit conversion, non-finite values, invalid temperature bands, impossible geometry, stale profile verification and empty manifests.

### Package and vehicle fit

Every package must fit each required loading opening and the clear compartment dimensions. For a rectangular package, test only physically permitted orientations; all three package axes must fit the corresponding opening/compartment axes. If rotation is prohibited by fragility or packaging, honor that restriction. If an opening, usable dimension or required package dimension is unknown, do not auto-assign.

Passing the dimension and volume sums is necessary, not sufficient, for a multi-package load: it does not prove a stable 3D packing arrangement, aisle access, axle balance, tie-down or safe unloading. P0 uses a simple single-SKU carton demo and a documented warehouse load plan/check for arrangement and securement. A qualified loader records the verified arrangement against the manifest revision. This check can resolve packability uncertainty only when every hard measurement, payload and safety rule already passes; it cannot waive overcapacity, missing ratings, roadworthiness, temperature or legal constraints.

### Service, equipment and driver compatibility

- Require the vehicle profile to explicitly allow SUPPLY_DELIVERY. PASSENGER-only assets fail. A dual-service vehicle needs explicit approval, separated/appropriate compartments, sanitation/segregation controls and the vehicle’s operational policy; its label alone is insufficient.
- The manifest’s full required temperature range must be inside the verified vehicle’s maintained capability. Required refrigeration with no verified equipment or temperature capability is a hard block. Temperature evidence must include a loading check and exception threshold if SCM/food-safety owners require it.
- Enforce known fragile, cannot-stack, food-separation, spill/regulated-goods, tie-down, liftgate, depot and allowed-service-area requirements from explicit capabilities. Legal/regulatory rules remain unverified until Fleet’s compliance owner supplies confirmed rules.
- Apply existing vehicle document/status, maintenance, UVVRP policy, driver license and pairing, approved leave, shift/break and active-dispatch rules. Goods-driver license classes/qualifications need confirmed legal and fleet data before enabling affected asset classes. The checked-in Capstone note says B2 is currently unsupported.
- Never provide a manual or AI override for weight, volume, dimension, temperature, legal, roadworthiness or double-booking blockers. A permitted override may address only a separately approved non-safety advisory and must record actor, reason, evidence and before/after values.

### Worked example

Manifest: 120 cartons, 10 kg gross per carton, each 0.50 m × 0.50 m × 0.20 m. Total weight is 1,200 kg; nominal volume is 120 × 0.05 = 6.0 m³. A verified truck rated for 1,500 kg safe available payload and 8.0 m³ usable volume passes those two necessary checks (80% weight and 75% volume utilization). A 0.50 m carton fits a verified 1.80 m × 1.80 m loading opening in an allowed orientation. The candidate still needs legal loading plan/securement, driver, schedule, service/food compatibility and dispatch-conflict PASS results. If it were refrigerated goods, the non-refrigerated truck would fail regardless of the weight and volume result.

## 8. APIs, events and permissions

These routes and payloads are proposals only; they are not existing endpoints. Use versioned, Zod-validated contracts and an anti-corruption adapter. Do not send the SCM schema through the Booking transportation-request parser.

### Contract shape

SCM to FleetOps proposal:

    POST /api/v1/integrations/scm/transport-requests
    {
      "schema_version": "1.0",
      "event_id": "scm-prod:evt-8471",
      "event_type": "TransportRequestApproved",
      "sequence": 17,
      "correlation_id": "scm-order-482",
      "source": {"organization_id": "restaurant-group-a", "module": "SCM"},
      "occurred_at": "2026-10-07T04:15:00Z",
      "request": {
        "external_request_id": "TR-482",
        "approver_ref": "user-opaque-19",
        "manifest_revision": 3,
        "pickup": {"site_id": "WH-02", "address": "...", "ready_from": "..."},
        "delivery": {"site_id": "REST-08", "address": "...", "window_start": "...", "window_end": "..."},
        "timezone": "Asia/Manila",
        "lines": [{
          "external_line_id": "line-1", "sku_ref": "SKU-opaque-1",
          "ordered": {"quantity": 120, "uom": "case"},
          "transport_packages": [{
            "count": 120, "units_per_package": 1, "gross_weight_kg": 10,
            "length_m": 0.5, "width_m": 0.5, "height_m": 0.2
          }],
          "handling": {"temperature_c": null, "fragile": false, "cannot_stack": false}
        }]
      }
    }

The ellipsis values above are illustrative only; a production contract must specify typed values and required/optional fields. The actual SCM API must provide contact role and address/geocoordinate provenance, pickup readiness, delivery window, source UOM conversions, gross packed weight/dimensions, handling needs, revision and cancellation semantics.

SCM publishes approved request, ready-for-pickup, manifest revision and cancellation. Fleet emits assigned vehicle/driver + ETA, en-route-to-pickup, cargo-picked-up, in-transit, arrived, delivery exception, POD submitted and transport closed. Receiving/SCM returns receipt verified/rejected with line-level received/accepted/damaged/missing/rejected quantities, actor, reason, evidence refs and SCM receipt ID. Each event includes schema version, scoped event ID, sequence/revision, correlation ID, source actor and occurred/recorded times.

| Event group | Producer → consumer | Required content and status owner |
|---|---|---|
| Approved / ready / revised / cancelled request | SCM → Fleet inbox; dedicated partner credential and organization ownership | External request ID, source org, event ID, sequence, manifest revision/hash, pickup/delivery, window, item/package facts, occurred time and correlation ID. SCM owns approval/readiness/cancel; Fleet owns only its validation and dispatch status. |
| Assignment / en-route / loaded / in-transit / arrived / exception / POD submitted / transport closed | Fleet outbox → SCM | Shipment, dispatch and trip IDs; selected vehicle/driver references; event sequence; milestone time; current manifest revision; relevant loaded/delivered/discrepancy totals; ETA or reason where applicable. Fleet owns these transport milestones; SCM owns its order/inventory state. |
| Receipt verified / rejected | Authorized receiver or SCM → Fleet inbox, with Fleet forwarding/acknowledging the correlated receipt | SCM receipt ID, shipment and line IDs, received/accepted/damaged/missing/rejected quantities, actor/site/role, reason, evidence refs, sequence and correlation ID. Receiving/SCM owns acceptance and stock posting. |

For every group, the scoped event ID is the idempotency key, correlation ID joins request→dispatch→trip→receipt, and sequence plus manifest revision prevents an old event from overwriting new facts. Reject or quarantine sequence gaps/conflicting bodies for reconciliation. P0’s sandbox demonstrates request, outbound milestone and receipt acknowledgement; P1 supplies durable backoff, dead-letter and operator reconciliation for partner outages.

### Identity, idempotency and reconciliation

- Use a dedicated SCM service identity/credential and scope per partner/environment. Do not reuse BOOKING_WEBHOOK_SECRET. Validate credential, partner ownership, timestamp/signature or short-lived machine token, schema version, replay key and body size. No browser-accessible partner secret.
- Store one inbox row and the source body hash before acknowledging. Same key and same hash returns the existing result; same key with different content returns conflict; older sequence/revision is quarantined; a higher manifest revision is immutable and revalidated. Never apply out-of-order manifest deltas silently.
- Record outbound intent transactionally with assignment/checkpoint/receipt, then deliver idempotently. P0 demo may use a deterministic SCM sandbox adapter. P1 adds bounded retry/backoff, dead-letter visibility, reconciliation by correlation/source IDs and an operator repair flow. No Kafka or separate microservice is justified by current evidence.
- A network timeout after SCM accepted an event is retried with the same event ID. Client success is not inferred until Fleet has persisted an inbox receipt. Retry must not repeat assignment, load, receipt or stock-posting effects.
- Attachments use private object references and scoped, expiring access. Redact contacts, signatures and sensitive raw manifest payloads from app errors, logs, analytics and push copy. Set retention with SCM/Receiving/privacy owners.

### Authorization map

| Actor | Allowed operation | Required server boundary |
|---|---|---|
| SCM machine identity | Create/read only its own approved requests; send revision/cancel events; receive Fleet transport events. | Partner/environment identity + external ownership check; dedicated scope; event idempotency; never list another organization’s records. |
| Fleet manager | Manage and verify cargo asset profiles, compliance/equipment and active state. | New fleet-cargo permission and field audit. Profile edits invalidate active recommendations and require revalidation. |
| Dispatcher | Read eligible cargo queue, analyze, assign/reassign and stand down. | New shipment-scoped permissions; server validation and signed plan token; no hard-safety override. |
| Driver | Read own assigned supply jobs, record load and transport checkpoints, report exception, submit POD evidence allowed by policy. | Authenticated driver identity must match trip/dispatch assignment; read ownership and transition validation on every write. |
| Warehouse | Confirm readiness and loaded quantities for authorized site/order. | Site and shipment ownership; cannot alter SCM approval or accept final inventory. |
| Receiver | Record accepted/rejected quantities and evidence for assigned delivery/site. | Receiver role/site ownership; immutable verified receipt; no Fleet or SCM inventory posting from a driver role. |
| Super admin / support | Configuration and audited repair only. | Least privilege, reasoned support action; never a generic bypass around domain permissions. |

All UI affordances are backed by server-side permission and ownership checks. The session timeout duration was not verified during this audit. Confirm the current timeout and refresh path before adding long mobile forms; after refresh or re-authentication, revalidate permission, driver/receiver ownership and source revision rather than treating session renewal as authorization.

## 9. Screen-by-screen impacts

| Actor / surface | Change type | Planned behavior |
|---|---|---|
| Fleet Manager — vehicle create/edit and status | Modify existing fleet surface | Add a distinct Cargo Capability section/profile: service eligibility, verified ratings, compartment/opening, payload, volume, equipment, temperature, sanitation, depot/service areas, evidence source and verification date. Preserve Passenger Capacity as its separate meaning. Missing rating is visibly “not verified” and not freight-eligible. |
| Dispatcher — supply queue | Create a typed Supply Deliveries view (or clearly separated queue tab after route audit) | Show approved/ready status, pickup readiness/window, destination window, package count, kg and m³ separately, missing facts and latest manifest revision. Never show SCM procurement controls as Fleet controls. |
| Dispatcher — assignment detail | Modify shared assignment component/API carefully | Eligible vehicle-driver pairs only; show cargo hard checks, separate weight/volume headroom, failed/unknown reasons, depot and time window. Explain ranking. Queue proposals have expiring tokens tied to shipment revision/hash and eligibility evidence. |
| Dispatch Calendar / availability pairs | Extend shared views | Display supply allocations with an explicit Supply Delivery badge while keeping calendar time-window and pair logic shared. Passenger seat filters never mean cargo capacity. |
| Driver mobile — Trips / job detail | Modify route to render a typed job view | Supply details show warehouse, receiving location/roles, delivery window, manifest/package summary, handling and load instructions. Do not render guest name/phone, passenger count, passenger-items prompt or passenger terminology for cargo. |
| Driver mobile — pickup / in-transit / arrival | Create cargo checkpoints under the typed trip view | Capture loading quantities/discrepancy and securement; use current route/GPS while foreground; record arrived and POD submission as shipment events. Roadworthiness remains mandatory. Define online/outbox semantics per checkpoint and truthful pending sync state. |
| Receiver / warehouse user | Prefer SCM-owned UI; otherwise create a narrow Fleet receipt surface | Readiness and warehouse loaded quantities may be sent from SCM/warehouse. Receiving verifies counts and condition. Fleet records and returns evidence; SCM controls whether inventory is posted. Avoid building an alternate procurement/inventory portal. |
| SCM | SCM-owned screens; contract/deep link only | Create/approve request, source manifest, set ready, revise/cancel, receive Fleet ETA/milestones, verify receipt and decide inventory movement. If no real endpoint is ready, use a clearly labeled demo adapter. |
| Reports | Modify existing trip-report views and add cargo report | Filter all existing passenger-specific metrics to passenger work. Provide cargo-only on-time-to-window, weight/volume utilization, exceptions, discrepancy and transport cost after metric definitions are agreed. Show unclassified legacy data separately. |

## 10. Dispatch and scheduling algorithm

1. Validate SCM source, approval, request ID, event ID, current manifest revision, non-empty lines, UOM conversions, package count, dimensions, weight, handling, stops and requested windows. Persist an immutable snapshot or return structured validation errors; do not partially ingest.
2. Return “waiting for warehouse” when pickup is not ready. Do not reserve a vehicle for an unready request unless an explicit pre-positioning policy is approved.
3. For the requested route/window, load candidate cargo profiles, vehicles, drivers, pairing/license and documents, schedule/approved leave, current active dispatches, maintenance/coding, service-area and route evidence in bounded queries (no per-candidate N+1).
4. For each pair, apply hard filters first: vehicle active and verified, explicitly supports supply, legal payload/weight PASS, nominal volume PASS, every package/opening/compartment fit, required temperature/equipment/sanitation PASS, safe load plan PASS where required, required driver class/training/duty/leave/schedule PASS, designated pairing PASS, route feasible, and no shared passenger or cargo resource overlap for the full operational window. UNKNOWN becomes blocked with named missing evidence.
5. Only hard-eligible pairs reach ranking. Rank deterministically by promised-window slack, verified travel/deadhead, availability after the job, depot/service-area fit and separately reported utilization headroom. Use stable vehicle/driver ID as final tie-breaker. AI may describe this result but cannot alter the eligible set or rank/commit resources.
6. Issue a short-lived signed selection token bound to shipment ID, source revision/hash, time window, vehicle, driver and evidence expiry. An edited manifest or stale vehicle/driver evidence invalidates it.
7. On assignment, repeat validation. Resolve external route/provider work before the short DB transaction; inside transaction recheck manifest revision, profile revision, pairing, schedule/leave and resource overlap under the established locks, insert the typed dispatch and shipment allocation, create/ensure its trip idempotently, and write audit/outbox intent. Any changed fact returns a conflict for fresh analysis.
8. Require departure and arrival in the cargo assignment window. Include loading/unloading and required turnaround/deadhead in the reserved interval. Existing trigger uses a zero-duration fallback when scheduled arrival is null, so cargo endpoints must reject a missing or non-positive interval rather than relying on that fallback.
9. If no pair fits, return precise blockers and “plan split/additional vehicle” where appropriate. Never send an oversized request through as a manual override.

## 11. Phased work breakdown

Complexity is a planning estimate: S small, M medium, L large. Paths are likely touch points, subject to implementation-time source review.

### P0 — demo-safe end-to-end flow

| Work package | Dependencies / likely files | Size | Risk | Verifiable definition of done |
|---|---|---:|---|---|
| P0.1 Confirm SCM request/manifest/event contract, owner boundaries, ID/revision and demo sandbox | SCM sample payloads; proposed new *src/lib/supply-integration/* contract/adapter; docs only until owners respond | M | No authoritative SCM schema or source UOM rules | Versioned request/event examples approved by SCM, Warehouse, Receiving and Fleet; no Fleet inventory writer is included. |
| P0.2 Add additive shipment, revision, manifest, cargo profile, allocation, event/receipt and inbox/outbox schema; classify security | *supabase/migrations/* after live ledger check; *scripts/lib/schema-contract.mjs*; *scripts/lib/sql-references.mjs*; *schema.sql* generated | L | Live schema/ledger may differ; grants/RLS and uncertain legacy dispatches | Idempotent migration applies through runner; constraints and indexes verified live; every new relation passes contract and anon review; rollback disables feature and preserves evidence. |
| P0.3 Build pure physical-load evaluator and cargo candidate service | New *src/lib/supply/*; reuse only shared conflicts/pair primitives after adapting; *src/app/api/dispatch/availability-pairs/route.js* | L | Incomplete ratings, source unit differences and route evidence | Unit matrix covers kg/m³/fit/temp; unknown and stale safety data fail closed; deterministic output explains all blockers; passenger evaluator output unchanged. |
| P0.4 Add typed queue, recommendation token and transactional assignment | New supply API/service and *src/app/(dashboard)/supply-deliveries/*; *src/app/api/dispatch/route.js* and existing assignment evidence service only through a reviewed shared abstraction | L | Shared resource concurrency, passenger side effects, manifest changed at commit | One supply shipment atomically reserves a shared dispatch, creates an allocation and one trip; stale token/manifest fails; passenger and cargo overlap races serialize safely. |
| P0.5 Add single-shipment driver checkpoints and receiver verification | *src/app/api/mobile/driver/trips/route.js* plus a typed supply-job projection; *mobile/app/(app)/(tabs)/trips.js*, *mobile/app/(app)/trip/[id].js*, *mobile/app/(app)/inspection.js*, private evidence storage | L | Passenger assumptions in inspection/completion; stale offline commands | Driver sees cargo-only job, passes roadworthiness, records loaded/exception/arrival, and submits evidence; receiver records quantities; neither trip completion nor GPS posts inventory. |
| P0.6 Reporting split, regression and reproducible demo | *src/lib/reports/operational-reports.js*, reports routes/pages and tests near changed modules | M | Historical untyped dispatches could contaminate KPIs | Passenger metrics remain unchanged for passenger fixtures; cargo metrics use typed cargo rows; full contract-to-receipt sandbox walkthrough is repeatable. |

P0 excludes multi-stop route batching, mixed passenger/cargo trips, automatic multi-vehicle bin packing and live stock writes. It must nevertheless reject an unfit load and offer a safe documented split/additional-vehicle path.

### P1 — production readiness

| Work package | Likely modules | Size | Risk | Verifiable definition of done |
|---|---|---:|---|---|
| P1.1 Connect real SCM, durable retry/backoff, dead-letter and reconciliation | *src/lib/supply-integration/*, cron/reconcile pattern, integration admin view, partner configuration | L | Partner outages, out-of-order revisions and duplicate callbacks | Staging proves signed requests, replay, retry, recovery after lost acknowledgements and operator reconciliation with no duplicate effects. |
| P1.2 Split/partial pickup/receipt, multi-trip allocation, cancellation after loading and returns | Shipment allocation/events APIs, dispatcher/mobile/receiver surfaces | L | Quantity conservation and custody history across trips | Same manifest lines reconcile across split loads/receipts; cancellation/return path preserves dispatch and evidence history. |
| P1.3 Advanced handling and compliance source integration | Cargo profile, evaluator, inspections, partner HR/compliance APIs | L | Unconfirmed license, sanitation, cold-chain and regulated-goods rules | Every introduced rule has an authoritative owner/source and adversarial test; unsupported values stay blocked. |
| P1.4 Full cargo operational reporting and service support | Reports, audit and reconciliation UI | M | KPI definition drift and sensitive attachments | Cargo on-time, discrepancy and utilization definitions are reviewed; passengers remain filtered; unresolved legacy rows stay separately visible. |

### P2 — optimization

| Work package | Likely modules | Size | Risk | Verifiable definition of done |
|---|---|---:|---|---|
| P2.1 Multi-stop/multi-order route batching | Supply planner, routing adapter, shared dispatch plan evidence | L | Compounded timing, cargo compatibility and fairness | Reproducible planner respects every hard constraint and returns a fresh commit token; no heuristic bypass. |
| P2.2 Cost forecasting and route/asset optimization | Analytics and deterministic ranking | M/L | False precision and objective tradeoffs | Inputs and confidence are disclosed, forecast does not become eligibility authority, and baseline comparisons are auditable. |
| P2.3 3D packing optimization | Packing engine only if volume justifies it | L | Complex geometry and unsafe overconfidence | Verified load plans outperform the manual baseline in measured cases; geometry uncertainty remains an explicit block/review state. |

## 12. Test and acceptance plan

No tests were run for this planning task. The cases below are planned acceptance criteria mapped to unit, integration, API, web, mobile, concurrency and migration layers.

| # | Given | When | Then | Planned test layers / phase |
|---:|---|---|---|---|
| 1 | A truck/van has complete verified payload, volume, geometry and service capability | Fleet Manager saves it, then leaves one required rating missing in a fixture | Complete profile can be evaluated; incomplete profile is visibly unverified and cannot be recommended | Schema/API/web + unit; P0 |
| 2 | A vehicle is PASSENGER-only; another is explicitly multi-purpose with compliant separated cargo compartment | A supply request is analyzed | Passenger-only is rejected; multi-purpose is eligible only when every explicitly required condition passes | Evaluator/API/web; P0 |
| 3 | One load is under payload but over volume; another under volume but over payload | Evaluator runs both | Each is blocked by its own dimension; separate utilization values are shown | Unit/property matrix; P0 |
| 4 | Total nominal volume fits, but one carton exceeds the door opening/compartment in every permitted orientation | A candidate is evaluated | Vehicle is blocked for package fit regardless of volume percentage | Unit/API; P0 |
| 5 | Multiple SKUs use kg/g, m/cm and distinct package-to-item ratios | Manifest is normalized | Correct canonical totals and line quantities are stored with conversion provenance and controlled rounding | Contract/unit/integration; P0 |
| 6 | Manifest requires chilled 2–8°C; candidate truck has no verified refrigeration and van has verified 2–8°C range | Candidates are evaluated | Truck is rejected; van can pass temperature only when all other checks pass | Unit/API; P0 |
| 7 | Shipment exceeds single-vehicle safe capacity; later P1 fixtures include split loads, two orders, multi-stop, partial pickup and partial receipt | Planner/allocator runs | P0 blocks unsafe assignment and offers additional-vehicle planning; P1 allocations conserve line quantities and preserve event history | Unit/API/E2E; P0 rejection, P1 execution |
| 8 | Same SCM event is replayed; a different body reuses its ID; an older revision arrives after a newer one | Ingest runs | Exact replay is idempotent; conflicting body is 409; stale revision is quarantined and never silently replaces current manifest | Contract/integration/API; P0 |
| 9 | Two dispatchers concurrently select the same truck or driver for overlapping passenger/supply windows | Both assignments commit at once | Exactly one overlapping assignment succeeds; the other receives conflict and a fresh-plan instruction | Two-connection DB integration/API; P0 |
| 10 | Queue plan token is absent, stale, changed or valid; detail/manual assignment is submitted separately | Assignment is attempted | Queue-originated work follows signed-token rules and commit-time revalidation; manual/detail remains fully revalidated; no cargo hard constraint can be forced | API/security regression; P0 |
| 11 | Driver has HR-approved leave (when HR feed exists), local approved leave in P0, Off Duty, no schedule or an overlapping passenger trip | Supply pair evaluation/assignment runs | Driver is blocked with a truthful source reason; no manual override clears a hard availability conflict | Unit/API/integration; P0 local evidence, P1 HR feed |
| 12 | Warehouse is not ready, reports a shortage, or SCM cancels before, during or after loading | Event arrives at each stage | Not-ready work is not dispatched; shortage is recorded against line and requires new plan; pre-load cancellation stands down; once loading starts, cancellation records an exception and preserves custody/quantity history | API/workflow/mobile; P0 readiness and pre-load cancellation, P1 during/after-loading handling |
| 13 | Driver reaches geofence or completes trip but no receiver receipt exists | GPS/trip completion is recorded | Shipment remains awaiting receipt; no accepted quantity or stock-post event is created | Integration/API regression; P0 |
| 14 | Receiver confirms received quantities with damaged/missing/rejected lines and authorized evidence | Receipt is submitted/replayed | Per-line conservation and evidence actor/time are preserved; SCM receives one idempotent receipt event; unauthorized receiver is rejected | API/integration/web/E2E; P0 basic, P1 all discrepancy paths |
| 15 | Supply trip breaks down and is rerouted/reassigned after dispatch or loading | Dispatcher updates work | Old dispatch and events remain; resources release/reassign transactionally; customer-facing status says delayed/replanned; loaded custody remains assigned | Transition/API/mobile/E2E; P1 |
| 16 | Wrong partner, foreign shipment ID, wrong driver/receiver, tampered vehicle or forged accepted quantity is submitted | Protected endpoint receives it | Server rejects with no data leak or state change and writes safe audit metadata | Route-auth/security tests; P0 |
| 17 | Passenger booking is assigned, driver uses current GPS/mobile flow, and passenger punctuality/report fixtures run alongside cargo trips | Passenger path and shared reports are exercised | Passenger lifecycle and visible fields remain unchanged; tracking works; passenger trips/punctuality exclude cargo and cargo KPIs exclude passengers | Regression/API/mobile/report tests; P0 |
| 18 | SCM times out after submit, event retries, mobile session expires, and queued command replays | Network/auth recovers | One business effect occurs, client truthfully shows pending sync, refreshed auth is used without bypass, and permanent failures are reconcilable | Integration/mobile E2E/chaos-style tests; P0 idempotency, P1 worker/session recovery |

### Additional acceptance coverage

- Property tests: dimension permutations, positive unit conversion, boundary equality at exactly rated payload/volume, rounding, invalid/non-finite and zero values, and quantity conservation.
- Migration/security: clean and already-applied migration; existing dispatch backfill dry-run; FK/check/index checks; schema contract classification; new private tables refused to anon; policy/grant catalog resolves all probe outcomes.
- API/UI: queue counts and pagination remain correct across types; selected manifest revision matches the card; unavailable pairs explain exact blockers; stale recommendation cannot submit; audit log excludes secrets, phone/contact data and raw evidence.
- Mobile: pre-trip gate remains server-owned; passenger checklist stays passenger-only; supply load check captures quantity before departing warehouse; offline display is visibly stale; checkpoint retries replay once; logout clears the driver’s cached supply job and evidence metadata.
- Session: expire the current session during review/receipt submission; refresh/re-authenticate, then confirm authorization and source revision again before replay.

### Demo fixtures (synthetic only)

| Record | Proposed synthetic facts |
|---|---|
| Cargo truck | TRK-DEMO-01, SUPPLY_DELIVERY only, verified 1,500 kg safe available payload, 8.0 m³ volume, 4.0 × 2.0 × 1.8 m clear compartment, 1.8 × 1.8 m door, no refrigeration. |
| Cargo van | VAN-DEMO-01, SUPPLY_DELIVERY only, verified 600 kg payload, 3.0 m³ volume; refrigeration capability is absent unless the test explicitly configures verified 2–8°C equipment. |
| Passenger-only asset | CAR-DEMO-01, passenger capability only, no cargo profile; must fail every supply recommendation. |
| Manifest | SCM-DEMO-2026-001, restaurant dry-goods request, revision 1, 120 cartons × 10 kg × 0.50 × 0.50 × 0.20 m = 1,200 kg and 6.0 m³. |
| Delivery | Warehouse WH-DEMO-02 to REST-DEMO-08, synthetic ready time and Asia/Manila delivery window; one cargo trip and one driver with valid test eligibility. |
| Receiving exception | 120 cartons loaded; 118 physically received, 117 accepted, 1 damaged, 2 missing. Totals reconcile; trip completion alone leaves inventory untouched. Receiver posts a synthetic discrepancy and SCM sandbox receives one receipt event. |

No seed rows should use real phone numbers, signatures, private addresses, partner credentials or live stock IDs.

## 13. Risk register and unresolved decisions

| Risk / unresolved item | Severity | Current evidence | Decision or mitigation needed |
|---|---|---|---|
| SCM API/schema and sandbox are unknown | High | No external contract in audited repository | SCM owner supplies approved request/event examples, auth, environments, IDs, UOM conversion rules, event sequencing, cancellation and retry SLA before P0 connector work. |
| Inventory posting authority can be accidentally duplicated | Critical | No Fleet cargo ledger exists today | SCM/Inventory remains sole stock writer; prove by endpoint/write audit and the arrival/completion negative test. |
| Packages may be unfit despite total volume passing | Critical | No geometry/packability domain exists | Require dimensions, opening, loading plan and securement; keep unknown safety inputs blocked; postpone automated 3D packing. |
| Vehicle ratings/legal license details are incomplete | Critical | Vehicle model is seat-centric; B2 currently unsupported in Capstone note | Fleet Compliance validates GVW/payload conventions, LTO classes, permits and measurements per vehicle. Do not enable an asset until profile verified. |
| HR integration/source authority is unknown | High | FleetOps currently stores schedules and leave used by eligibility | HR confirms an API/feed, identifiers, freshness, revocation and hours/rest semantics. Avoid building a second leave workflow; until then, surface the local evidence source and its limits. |
| Request-less dispatch/source classification | High | Read-only live query on 2026-10-07 found 37 active rows (30 Completed, 7 Scheduled), with 0 request-less rows and 0 active request-less reservations. `POST /api/dispatch` still accepts a request-less body. | This snapshot needs no backfill for current active rows, but inspect every dispatch caller/report and add an explicit operation type for new cargo rows before enforcing any type invariant. |
| Shared passenger path regression | High | Passenger query/UI/report assumptions are direct | Typed API response, regression suite, service-type filters, feature flag and no passenger FSM/schema vocabulary changes. |
| Manifest revision after assignment/load | High | No existing immutable manifest model | Freeze revisions; re-plan before load; after load use explicit custody/discrepancy/return events, never rewrite history. |
| Sensitive location, contacts, signature and media leakage | High | Existing request integration logs parsed payloads | Minimize snapshots, redact logs/errors, private attachments, scoped access, retention review and least-privilege views. |
| Offline stale instructions or duplicate checkpoint | High | Existing mobile cache/outbox is driver-scoped but cargo actions do not exist | Decide which checkpoints are online-only versus safely queued; use stable client submission IDs, manifest revision checks and server replay validation. |
| P0/P1 scope drift | Medium | Requirements include split, returns, advanced handling and optimization | P0 is one shipment/one trip with basic receiver evidence. P1 enables partial/split/returns and real retry. P2 optimization only. |
| Current SDK policy mismatch | Medium | App reports Expo ~54; mobile AGENTS requires Expo v57 docs | Resolve repository policy before mobile implementation; do not blindly upgrade SDK as part of feature work. |
| Live migration/schema baseline may lag source files | High | Repository policy warns that generated schema may lag live | Run db:status and db:dump at implementation start; do not choose migration version or infer live structure from filename/schema.sql alone. |

## 14. Capstone defense demonstration

Use a resettable synthetic SCM sandbox and synthetic fleet/driver records. Keep the demo in Asia/Manila and label SCM acknowledgements as sandbox responses unless a real staging partner has passed acceptance.

1. In the SCM sandbox, approve restaurant request SCM-DEMO-2026-001, mark WH-DEMO-02 ready, and send manifest revision 1 with the 120-carton package facts.
2. In FleetOps Supply Deliveries, open the request and show the source organization, approver reference, ready state, revision, quantity/package count, 1,200 kg, 6.0 m³ and destination window.
3. Open vehicle capability detail. Show that CAR-DEMO-01 and the non-refrigerated van fail the request; show the truck’s verified 1,500 kg / 8.0 m³ ratings, 80% and 75% load ratios, package/door fit, driver eligibility and clear shared calendar.
4. Analyze and assign using the signed current proposal. Demonstrate an overlapping passenger dispatch blocking the candidate, then use the eligible time/vehicle or explicitly remove the conflict through the normal dispatcher path. Never edit DB rows during the demo.
5. Open the driver app. Show the Supply Delivery label, pickup/destination, manifest and handling; confirm the generic roadworthiness gate without passenger-only items; record warehouse-loaded quantity and securement.
6. Start the trip and show live route/GPS/ETA. Demonstrate the passenger trip remains on its existing separate passenger screen.
7. At destination, show driver arrival/trip completion without any receipt or inventory change.
8. Switch to the authorized synthetic receiving account/sandbox. Record 118 received, 117 accepted, 1 damaged, 2 missing and evidence/reason. Submit and show one correlated Fleet-to-SCM receipt event.
9. In SCM sandbox, acknowledge and demonstrate that only the authorized receiving workflow may decide whether accepted quantity posts to inventory. Show Fleet’s event/reference, not an invented Fleet inventory balance.
10. Open reports and show separate passenger punctuality/trip metrics and cargo delivery/discrepancy/utilization metrics.

## 15. Recommended implementation order after approval

1. **Contract workshop and access inventory (M):** obtain SCM and HR owner/API documentation, sample manifests, source IDs/UOM conversion rules, event sequencing, receipt responsibilities, privacy/retention rules and a sandbox. Decide which license/food-safety rules apply.
2. **Live schema and operations baseline (S/M, complete for this slice):** `db:status`, `db:check`, `db:dump`, the read-only dispatch count, vehicle measurement source review, dispatch creation-path review and report query review are complete. Before migration 147, the live baseline had 37 active dispatches, all with a request ID (30 `Completed`, 7 `Scheduled`). Migration 147 classifies those as `PASSENGER`; requestless historical rows remain NULL instead of guessing their purpose. The post-migration list query returned 37 active rows. The database now defaults new dispatches to `PASSENGER`, while the existing general API rejects an explicit `SUPPLY_DELIVERY` type until a shipment allocation workflow exists. Report partitioning remains required before cargo work can be assigned.
3. **Freeze P0 domain and acceptance decisions (M):** approve one-shipment/one-trip scope, service type/backfill strategy, vehicle payload convention, unknown-data behavior, package/UOM definitions, state ownership, receipt semantics and feature flag.
4. **Implement P0 foundation in thin vertical slices (L):** contract/inbox → private schema/contract gates → cargo evaluator → shared transactional dispatch/token → driver checkpoints and receiver event → sandbox callback/report partition. Add focused tests at each boundary, then run migration/security and regression gates.
5. **Stage and demonstrate before production connection (M/L):** deploy disabled, seed only synthetic data, exercise full demo and outage/replay tests, collect compliance/receiver sign-off, then enable for one depot. Connect live SCM only after partner contract/security and end-to-end reconciliation are accepted.

---

**Audit conclusion:** The repository offers useful Fleet infrastructure, not a complete supply-chain delivery capability. The 2026-10-07 implementation adds a private shipment foundation and sandbox load-check surface only. Continue by closing owner/contract decisions, then implement shared transactional assignment, typed mobile execution, receiver evidence and passenger/cargo reporting separation while keeping SCM as inventory owner.
