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