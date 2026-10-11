# Task 11 — Staff cargo review and source links

Date: 2026-10-11

## Delivered

- Added the staff trip cargo panel with expected, pickup and delivery quantity columns, separate order and delivery shortages, decision history, partner message delivery status, and explicit unavailable/missing-manifest states.
- Kept source acceptance, Fleet clearance, receiver confirmation, feedback acknowledgement and vehicle inspection distinct. Reviewer actions appear only when the current server view supplies the corresponding capability. A conflict keeps the draft and action result visible and disables stale resubmission until a fresh current view loads.
- Added safe REQUEST and SUPPLY links. REQUEST resolves through the persisted schedule/request-manifest relation. SUPPLY resolves through the execution/allocation/shipment relation and the stored manifest revision/hash, then opens the existing Supply Deliveries selection with a local UUID. The shipment page checks the UUID against its server-loaded list and explains missing or malformed links.
- Projected only bounded history metadata and safe feedback fields; raw payloads, contacts, proof and bearer URLs are excluded. Private evidence is fetched only on an explicit view action.
- Added scoped trip, reservation and dispatch detail summaries/links. No cargo provider, supply assignment, business approval, migration, upload, inventory or live-write path was enabled.

## Test-driven evidence

Initial quantity-table RED:

```text
npx vitest run src/components/cargo/cargo-quantity-table.test.js --pool=forks --maxWorkers=1
1 test failed: expected the rendered output to contain “Expected”; the component was initially an empty stub.
```

Final focused test run:

```text
npx vitest run 'src/app/api/trips/[id]/cargo/route.test.js' src/lib/supply/shipment-detail-selection.test.js src/lib/cargo/api.test.js src/lib/cargo/read-adapter.test.js src/components/cargo src/services/cargo-execution.client.test.js --pool=forks --maxWorkers=1
Test Files  9 passed (9)
     Tests  54 passed (54)
```

This includes the rendered `10 / 9 / 9` quantity case, read-only capability gating, retained draft after a rejected/conflicting action, feedback ACK wording, bounded history/privacy projection, persisted source-link resolution, local shipment selection validation, and the route's `503 CARGO_CONFIGURATION_REQUIRED` response. Vitest could not resolve a `node_modules` realpath within the sandbox before collection; the recorded runs used the approved filesystem-access path. That sandbox error is not counted as a test failure.

Scoped lint:

```text
npx eslint --max-warnings 0 'src/app/(dashboard)/trips/[id]/page.js' 'src/app/(dashboard)/reservations/[id]/page.js' 'src/app/(dashboard)/dispatch/[id]/page.js' 'src/app/(dashboard)/supply-deliveries/page.js' src/components/cargo src/services/cargo-execution.client.js src/lib/cargo/api.js src/lib/cargo/read-adapter.js src/lib/supply/shipment-detail-selection.js
Exit 0; no warnings or errors.
```

Next compile smoke:

```text
npx next build --webpack --experimental-build-mode compile
Compiled successfully in 41s.
```

The compile emitted the existing warning that `src/lib/auth/geoip.js` has an expression-based dependency request. Compile mode does not perform the final page-generation stage, so this is not reported as a complete production build. The default Turbopack build failed before route compilation on a Windows `.next/node_modules/geoip-lite` junction error (OS error 80); an un-escalated webpack attempt was denied creating a `.next` directory (EPERM), then the same documented webpack compile command succeeded with filesystem access. The Next route listing included `/trips/[id]`, `/reservations/[id]`, `/dispatch/[id]`, `/supply-deliveries`, and `/api/trips/[id]/cargo`.

## Browser and live limitations

`npm run dev -- --hostname 127.0.0.1` reported ready, but both the isolated CUA browser request to `http://127.0.0.1:3000/trips/1` and a local `Invoke-WebRequest` timed out. The browser could not load a page, so no screenshot, console inspection, small-desktop visual review or staff/readonly role acceptance is claimed. The panel unavailable state is covered by rendered component tests, and the cargo route test confirms the default runtime response is 503; those fixture results do not establish a live role workflow. No operational cargo decision, evidence upload, feedback retry, shipment assignment or source-provider call was made.

Relevant Capstone notes updated: Trips, Dispatch, `cargo_execution_storage.md`, and `supply_delivery_foundation.md`.

## Round 1 review recovery — 2026-10-11

Addressed both Important findings from review of `3cf046015e84f87e4ca168ec4b12da78e2994c9e`:

- Feedback status now maps `NOT_QUEUED` to “Not queued”, keeps `PENDING` as “Waiting to send”, and renders unknown values as neutral “Delivery status unavailable”. The partner-message status remains separate from cargo approval.
- A decision command manager retains the same generated `event_id` and frozen payload after a status-less network error or an HTTP 5xx. The panel locks decision details and exposes “Retry same decision” until the result is known. A definite 4xx clears the pending command so a new command can be created after the current state is refreshed. Success also clears it.

The command-manager regression tests force both a lost network response and HTTP 503, retry successfully, and assert the same event ID, identical payload object and frozen evidence-ID array are sent again; they also verify that a later new decision gets a new ID and that a definite 409 permits an updated command. Rendered tests cover `NOT_QUEUED`, unknown status, and the locked same-command retry UI. Directly mounted panel rejection/refetch coverage remains deferred: this repository's Vitest setup has no DOM renderer/testing library, and the local browser timed out before loading the page. The deferred test is tracked as a review Minor; reducer/static-render tests are not described as a full panel request interaction.

Final focused regression run:

```text
npx vitest run 'src/app/api/trips/[id]/cargo/route.test.js' src/lib/supply/shipment-detail-selection.test.js src/lib/cargo/api.test.js src/lib/cargo/read-adapter.test.js src/components/cargo src/services/cargo-execution.client.test.js --pool=forks --maxWorkers=1
Test Files  10 passed (10)
     Tests  61 passed (61)
Exit 0
```

Scoped lint:

```text
npx eslint --max-warnings 0 src/components/cargo src/services/cargo-execution.client.js src/lib/cargo/api.js src/lib/cargo/read-adapter.js src/lib/supply/shipment-detail-selection.js 'src/app/api/trips/[id]/cargo/route.js' 'src/app/api/trips/[id]/cargo/route.test.js'
Exit 0; no ESLint warnings or errors.
```

Webpack build check:

```text
npx next build --webpack --experimental-build-mode compile
⚠ Compiled with warnings in 19.5s
./src/lib/auth/geoip.js
Critical dependency: the request of a dependency is an expression
✓ Compiled successfully in 27.9s
Build ran with "compile" mode, to finalize the build run either "generate" or "generate-env" mode as well
Exit 0
```

The warning is in `src/lib/auth/geoip.js`, confirmed unchanged from the Task 11 base; it is unrelated and was not modified. This successful compile-mode check is not reported as a complete production build. The route listing included `/api/trips/[id]/cargo`; its focused route tests passed and continue to verify the default `503 CARGO_CONFIGURATION_REQUIRED` response. No provider, write path, schema, or operational cargo data was changed.

Browser check for this review recovery used an isolated CUA tab to `http://127.0.0.1:3000/login`; the request timed out. The server was stopped afterward. No screenshot, browser console result, authenticated staff/readonly role acceptance, or live cargo review is claimed. The cargo API remains unavailable at runtime.
