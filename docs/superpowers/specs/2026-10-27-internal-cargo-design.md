# Internal Cargo reservations and Fleet Manager review

The owner approved completing the standalone Cargo workflow: use Add Reservation/New Request for internal delivery jobs and item lists, and give the Fleet Manager a module to inspect counts, images and signatures and make operational decisions. This replaces the previous external-only Cargo scope for INTERNAL jobs; it does not activate PMS/POS/SCM integrations.

## Chosen design

Reuse the existing reservation form, immutable request manifests, Cargo receipt engine, private evidence bucket, mobile forms and trip lifecycle. An explicit server-owned INTERNAL origin selects the new runtime. External sources and fixture-only factories retain their existing restrictions. A separate internal runtime is preferable to removing the existing safety switches or duplicating the whole Cargo state machine.

The manager role is `fleet_manager`; `admin` and `super_admin` retain administrative access. Dispatchers may create and assign permitted jobs through existing controls, but cannot make internal manager decisions. Drivers remain restricted to their assigned trip. Client payloads cannot choose their authority or origin.

## Intake

The existing `/reservations/new` page saves Cargo instead of leaving it as an unsaved draft. A session-authenticated staff endpoint writes the request and revision-1 item manifest atomically. Use existing location IDs, Cargo service choices, exact-decimal quantities, units, packaging/physical validation and canonical manifest hashes. Generate INTERNAL organization/source identity on the server. A stable submission UUID makes exact retry idempotent and changed-content retry a409. Keep item reference images null; driver pickup/delivery evidence is the image workflow requested here.

Creation remains Pending and existing dispatch assignment controls apply. No new Approved reservation lifecycle is introduced. Manager review below concerns the actual recorded pickup/securement/receiving; it cannot certify a driver license or commission a vehicle.

## Driver and manager flow

An assigned driver can initially load the exact saved manifest, capture pickup counts, optional issue photos and the releasing acknowledgment, then submit one immutable observation. Uploaded photo IDs must bind the same immutable submission UUID as the receipt. The manager reviews the current counts, discrepancies, available private images and signature, and records ACCEPT_OBSERVED, WAIT or REJECT_PICKUP with a reason. INTERNAL pickup always requires explicit manager acceptance, even when clean.

Departure is a separate manager securement decision with explicit load checks, reason, reviewed evidence, current receipt/hash/version and current driver/vehicle binding. A signature or sample tutorial never grants departure. At destination the driver records delivered counts/images/receiving acknowledgment. A separate later manager receiving review confirms the current observation, including an explicit reason for accepted discrepancies, or holds it. Only current accepted receiving proof permits the ordinary ending-odometer/completion path.

Reviews are append-only and tied to the authenticated employee. Recounts invalidate prior decisions/securement by exact receipt identity; current execution views resolve durable reviews rather than rewriting original command responses. Exact retries return the original authorized response; stale version or changed payload conflicts. Existing post-pickup cancellation/reassignment holds remain.

## Manager module and evidence

Add a bounded Cargo review queue and a focused record view using existing table, Card, Dialog, Badge and photo/signature review patterns. Lead with trip/request identity, stage, driver/vehicle and required next decision. Reuse the existing Cargo verification panel for actual counts and explicit private evidence reads; internal actions use a distinct authenticated manager command rather than pretending to record outside-source communication. Show missing evidence, loading, denied access, stale data and retry states honestly.

Use the existing private cargo-evidence bucket and dedicated assigned-trip/manager authorization. Enforce actual image size/type, stable retry, server-owned paths and current session/trip scope. Never add Cargo to generic public media signing. Signed image state expires and is cleared on hide, denied access, navigation and session changes. Keep attached evidence protected; new internal retention metadata must describe actual local policy without inventing outside approvals. No automatic deletion of attached records is introduced by this feature.

## Data and security

After fresh ledger status169/0/0, migration170 is reserved for this feature. Extend only relevant source/command constraints to admit INTERNAL. Add immutable internal review/proof records with RLS, full anon/authenticated privilege revocation, binding checks and required audit linkage. Register private tables in the schema contract, apply with the repository runner, dump generated schema and verify live catalog/anon/bucket policy separately. Internal events do not enqueue or claim partner delivery.

## Verification and completion

Use tests before implementation for internal intake atomicity/replay, manager role denial, private evidence ownership, receipt-photo submission binding, manager acceptance/securement/receiving, stale/recount/replay races, assignment binding, real lifecycle transitions and unchanged external refusals. Use isolated rollback/temporary PostgreSQL fixtures for operational data checks. Run focused checks then repository lint, encoding, auth/migration/schema gates and production build. Inspect real rendered reservation/review pages. Native phone interactions remain explicitly unverified until exercised on a device.

Preserve the owner-requested sample request606 and existing unrelated local mobile dependency/TypeScript changes. Do not fabricate real license verification, capacity measurements or vehicle commissioning to hide readiness failures. Document exact running setup and any remaining test-data prerequisite.
