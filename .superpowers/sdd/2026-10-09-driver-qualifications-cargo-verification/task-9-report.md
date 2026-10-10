# Task 9 — Durable cargo partner feedback worker and inbox

Date: 2026-10-11
Base: `918abc2f1e8f93ee5af7de5c9a9635937eefffac`

## Result

Implemented a durable feedback delivery worker, strict receipt-only ACK contract, explicit nonproduction mock gateway, default-closed runtime gateway, authenticated bounded cron endpoint, and separately permissioned staff read/retry endpoint. The implementation reuses Task 5/6/7 cargo storage, validation, hashing, audit and decision interfaces. It adds no table, migration, schema dump, dependency, or scheduler configuration. Existing booking delivery and `/api/integration/cargo/decisions` remain separate.

The worker leases bounded due events with `FOR UPDATE SKIP LOCKED` inside a transaction and commits before network I/O. It verifies event payload hash, source organization, execution and version before sending. Later events for an execution wait until every earlier event is acknowledged. The worker increments attempts at lease time and retries after 1, 5, 15 and 60 minutes, then hourly. Attempt 10 becomes `FAILED` with its original event and payload retained. The final update requires the current lease token, so a stale worker cannot overwrite the successor's result.

ACK contains only the exact event ID and `received: true`; fixture labels ACCEPT/WAIT/REJECT are receipt annotations and cannot mutate source decisions, Fleet safety, receiver/custody status or inventory. Source decisions continue through the existing separately scoped inbox. Staff reads require `integrations.read`, retries separately require `integrations.execute`, and both use persisted trip/source/organization scope. Retry requeues the same failed event ID and preserves its payload. Cron authentication uses the service token and caps batches at 100.

No approved provider configuration exists. The default gateway's send and acknowledgement methods return `CARGO_CONFIGURATION_REQUIRED`; the worker checks configuration before leasing or touching the DB. Staff runtime list/retry similarly remain unavailable. Only an explicit injected test/development fixture can exercise sends and staff operations. No partner send, credentials, endpoint, cron schedule or live cargo operation was enabled.

## Verification

- TDD RED: initial focused run failed because the new contract/gateway/service modules did not yet exist. This established the tests' missing implementation before code was added.
- Focused unit/route suite, rerun after final lint fix: `npx vitest run src/lib/cargo/feedback-contract.test.js src/lib/integration/cargo-gateway.test.js src/services/cargo-feedback.service.test.js 'src/app/api/integration/cargo/feedback/route.test.js' src/app/api/cron/cargo-feedback/route.test.js --reporter=dot` — **5 files, 19 tests passed**.
- Disposable Task 9 PostgreSQL suite: `CARGO_FIXTURE_DB_TEST=1 npx vitest run src/services/cargo-feedback-db.integration.test.js --testTimeout=30000 --reporter=verbose` — **3/3 passed**. It used two distinct PostgreSQL backend sessions and verified the committed lease was visible before gateway I/O, competing workers and ordering, stale lease fencing, immutable payload, and organization-scoped inbox uniqueness. Isolated schemas were removed at teardown.
- Existing Task 6 source-decision replay/scope SQL subset: `CARGO_FIXTURE_DB_TEST=1 npx vitest run src/services/cargo-execution-service-db.integration.test.js -t 'replays the original whole view|checks authenticated identities and source scope' --testTimeout=60000 --reporter=verbose` — **2 passed, 28 skipped by the title filter**. This confirms exact source replay and organization scope on existing interfaces; it is not a Task 9-only test suite.
- The two PostgreSQL suites above ran sequentially. No combined or overlapping SQL result is claimed.
- Scoped ESLint over the 11 Task 9 source/test files passed after moving the pool declaration above its use in the integration test.
- `npm run db:check` — **160 migration files valid**; no migration was added or applied.
- `npm run verify:auth` — **333 guarded exported route methods, 0 failures**.

A first final Vitest attempt inside the sandbox was blocked by Windows `EPERM` resolving the installed Vitest `spy.js`; the approved rerun completed and found one incorrect test expectation (gateway creation returns a closed interface; its methods reject). That test now asserts the method behavior and the final rerun passed. This is not counted as an implementation failure.

## Documentation and limits

Updated `Capstone/01 - System/System Boundaries.md`, `Capstone/03 - Database/Tables/integration_log.md`, `Capstone/03 - Database/Tables/cargo_execution_storage.md`, `Capstone/07 - Development/Driver Qualifications Cargo Verification Implementation Plan.md`, and appended the Task 9 paragraph to `SYSTEM.md`. The progress ledger records completion and the Task 8 deferred Minor remains out of scope.

Fixtures prove behavior against isolated disposable schemas, not the live database catalog, external partner delivery, credentials, deployment configuration or production scheduler. Runtime remains closed until approved configuration and gates exist. No Task 10/mobile/report work was included.

Commit: `Add durable cargo feedback worker` on `feat/mechanic-integration`.
## Review fix 1 — caller-bound staff authority and retry cycles

The first scoped review found that attempt 10 could be manually requeued but the next lease became attempt 11, which the event envelope rejected. It also found the staff route discarded its authenticated session and staff list/retry trusted caller-selected scope without resolving approved authority or writing required audit.

A retry now resets the bounded attempt counter to zero and begins a new ten-attempt cycle. The event UUID and immutable source/payload/hash stay fixed. The successful required audit records the old FAILED status, old attempt count and error code along with the event ID and authenticated employee, preserving cycle history. A later tenth failure again becomes FAILED. No schema change was needed.

The routes pass the `requirePermission` session and request into the service. The service resolves the trip and execution manifest from the database in a transaction, compares requested source/organization with persisted source data, checks the active employee, then calls an explicitly configured staff-authority callback with the session and persisted trip/execution. Reads and retries both call `writeAuditRequired` in the same transaction as their query/update. No live callback/provider is configured; production staff endpoints continue returning 503. The only callback seam is an explicit nonproduction fixture.

TDD RED was observed: the first regression run failed five tests (three service cases because the fixture lacked caller-bound authorization and two route cases because session/request were dropped). After implementation, the focused run passed **5 files / 22 tests**:

`npx vitest run src/lib/cargo/feedback-contract.test.js src/lib/integration/cargo-gateway.test.js src/services/cargo-feedback.service.test.js 'src/app/api/integration/cargo/feedback/route.test.js' src/app/api/cron/cargo-feedback/route.test.js --reporter=dot`

The sequential isolated PostgreSQL suite passed **4/4**:

`$env:CARGO_FIXTURE_DB_TEST='1'; npx vitest run src/services/cargo-feedback-db.integration.test.js --testTimeout=60000 --reporter=verbose`

Its new staff fixture denied a requested organization different from the persisted manifest, forced a real audit-trigger failure and verified the retry stayed FAILED at attempts 10, then retried the same event, observed attempt 1 delivered and ACKed with identical payload/hash, and exhausted another retried event at attempt 10. Existing two-session lease ordering, stale-token and inbox uniqueness tests also passed. All SQL scenarios used isolated disposable schemas and ran sequentially; no live schema changed.

Scoped ESLint passed for all 11 Task 9 source/test files. `npm run verify:auth` passed 333/333 guarded route methods. No migration, schema dump, provider configuration, partner send or scheduler was added. Updated System Boundaries, cargo storage and implementation plan notes plus `SYSTEM.md`; recovery ledger records this review fix.

### Review fix 1 commit status

The changes above are included in the scoped Task 9 review-fix commit, based on review base `57734e22`.
