# FleetOps integration review follow-up implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make v1 unknown-service failures explicit, enforce v2 active-service and location checks at commit, persist v2 route-cache data only with a successful request, and report unsupported pull revisions distinctly.

**Architecture:** Keep provider estimation outside row locks. In the final v2 transaction, re-resolve and lock active location codes and the active service code, insert using those locked IDs, then persist the already-computed strict route estimate on the same transaction connection only when the insert returned a row. Preserve v1 resolution and route behavior; report unsupported v2 events without implementing revision semantics.

**Tech Stack:** Next.js 16.2.11 App Router route handlers, JavaScript ES modules, Vitest, PostgreSQL transaction/query adapter.

## Global Constraints

- Preserve v1 compatibility: reject a missing numeric catalog ID and known incompatible load types; do not add a v1 active/deleted filter.
- V2 service validity must hold through request commit; use `FOR SHARE` on the service row and use that row's `service_type_id` for the insert.
- Do not call a route provider while holding location/service locks.
- A route-cache write is allowed only after the new request insert succeeds; exact replay, failed locked validation, and conflict-without-insert do not persist a route.
- Keep non-mock source identity bound to the trusted adapter principal; do not add a POS HTTP adapter or enable gateway connectivity.
- Unsupported v2 update/cancel/revision items remain unprocessed; do not implement update/cancel semantics.
- Do not inspect `.env`, query live DB/catalog/status, apply a migration, edit/dump `schema.sql`, activate a connector, merge, or deploy.
- Read the installed Next.js 16.2.11 route-handler guidance before editing the pull handler; the route remains a standard `POST` handler.
- Use test-first slices. Run focused Vitest and touched-file ESLint; run the full suite once after all follow-up changes.

---

### Task 1: Reject unknown legacy service IDs cleanly

**Files:**
- Modify: `src/lib/integration/ingest.js`
- Test: `src/lib/integration/ingest.test.js`

**Interfaces:**
- No public API change. `ingestRequest(request, opts)` rejects with `{ code: "SERVICE_UNAVAILABLE" }` when a supplied v1 `service_type_id` has no matching catalog row.
- Existing active, inactive, and soft-deleted rows remain eligible only when their known `default_load_type` is compatible; a null/unknown load type keeps the v1 passenger default.

- [ ] **Step 1: Add a failing test.** Use the existing `wire({ service: null })` stub and a request with `service_type_id: 13`. Assert rejection code `SERVICE_UNAVAILABLE`, no call to `resolveRequestEstimate`, and no transportation-request insert.

```js
it("rejects an unknown legacy service ID before estimation", async () => {
  wire({ service: null });
  await expect(ingestRequest({ ...REQUEST, service_type_id: 13 }))
    .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  expect(resolveRequestEstimate).not.toHaveBeenCalled();
  expect(insertCall()).toBeUndefined();
});
```
- [ ] **Step 2: Verify RED.** Run `npm run test:run -- src/lib/integration/ingest.test.js -t "unknown legacy service ID"`. Expected: failure because the current implementation carries ID 13 into estimation and insertion.
- [ ] **Step 3: Add the existence check.** After the v1 catalog query, reject a missing row before estimating; leave the existing known-load-type mismatch check unchanged and do not add status/deletion predicates.

```js
if (!services[0]) {
  const error = new Error("Service ID is unknown or unavailable.");
  error.code = "SERVICE_UNAVAILABLE";
  throw error;
}
const catalogLoadType = services[0].default_load_type;
```

- [ ] **Step 4: Verify GREEN.** Run `npm run test:run -- src/lib/integration/ingest.test.js`; expected: the unknown-ID, known-Cargo rejection, and matching-Passenger tests pass.
- [ ] **Step 5: Commit.** Commit only `ingest.js` and `ingest.test.js` with `fix: reject unknown legacy service IDs`.

### Task 2: Lock v2 service validity and defer route-cache persistence

**Files:**
- Modify: `src/lib/integration/ingest.js`
- Test: `src/lib/integration/ingest.test.js`
- Modify: `src/services/route-resolver.service.js`
- Test: `src/services/route-resolver.test.js`

**Interfaces:**
- Add `persistStrictRouteEstimate(db, request, estimate)`, an exported database-only helper. It consumes linked location IDs plus `{ distanceKm, durationMin, source }`; it returns without work for incomplete/nonpositive estimates or unusable endpoints, inserts a missing route, and updates only an incomplete non-Manual route. It must never call TomTom.
- Add a private `resolveActiveServiceCode(serviceCode, loadType, dbQuery = query, { lock = false } = {})` resolver. It throws stable `SERVICE_UNAVAILABLE` for missing/inactive/deleted/mismatched v2 service rows and otherwise returns `service_type_id`.

```js
async function resolveActiveServiceCode(serviceCode, loadType, dbQuery = query, { lock = false } = {}) {
  const { rows } = await dbQuery(
    `SELECT service_type_id, default_load_type FROM service_types
      WHERE service_code = $1 AND status = 'Active' AND deleted_at IS NULL${lock ? " FOR SHARE" : ""}`,
    [serviceCode]
  );
  const service = rows[0];
  if (!service || service.default_load_type !== loadType) {
    const error = new Error("Service code is unavailable or incompatible with the load type.");
    error.code = "SERVICE_UNAVAILABLE";
    throw error;
  }
  return service.service_type_id;
}
```

- [ ] **Step 1: Add failing tests.** In `ingest.test.js`, make strict estimation return a complete estimate and capture a transaction-local query adapter. Assert the order is location locks → active-service `FOR SHARE` lookup → request insert → `persistStrictRouteEstimate(tx, ...)`; assert the inserted service ID is the locked row ID and the estimate call uses `{ persistRoute: false, strictRegistry: true }`. Add failure tests proving a service retired at final recheck rejects without insert/route persistence, and `ON CONFLICT DO NOTHING` does not persist a route.

```js
expect(events).toEqual([
  "pickup_lock", "dropoff_lock", "service_lock", "request_insert", "route_persist",
]);
expect(resolveRequestEstimate).toHaveBeenCalledWith(
  expect.objectContaining({ pickup_location_id: expect.any(Number) }),
  expect.anything(),
  { persistRoute: false, strictRegistry: true },
);
expect(persistStrictRouteEstimate).toHaveBeenCalledWith(
  tx,
  expect.objectContaining({ pickup_location_id: expect.any(Number) }),
  expect.objectContaining({ distanceKm: 12.5, durationMin: 30 }),
);
```
- [ ] **Step 2: Verify RED.** Run `npm run test:run -- src/lib/integration/ingest.test.js -t "locks the active service|does not persist a route"`. Expected: current code lacks the service lock and calls strict estimation with `persistRoute: true`.
- [ ] **Step 3: Add a route-helper unit test.** In `route-resolver.test.js`, prove a positive estimate creates a route from exact active linked IDs with `allowNameFallback: false`, and prove a non-Manual incomplete route is updated without any provider call. Keep Manual route estimates unchanged.
- [ ] **Step 4: Verify helper RED.** Run `npm run test:run -- src/services/route-resolver.test.js -t "persists a resolved strict estimate"`; expected: export/function is missing.
- [ ] **Step 5: Implement the database-only helper.** Reuse `resolveRouteEndpoints`, `findActiveRoute`, and `resolveRouteForRequest`; validate linked active canonical endpoints before route writes. Update only missing fields on a non-Manual route using the transaction adapter. The helper must contain no TomTom/provider call:

```js
export async function persistStrictRouteEstimate(db, request, estimate) {
  const distanceKm = positiveNumber(estimate?.distanceKm);
  const durationMin = positiveNumber(estimate?.durationMin);
  if (distanceKm === null || durationMin === null || !db?.query) return null;

  const endpoints = await resolveRouteEndpoints(db, {
    origin: null,
    destination: null,
    originLocationId: request.pickup_location_id,
    destinationLocationId: request.dropoff_location_id,
    allowNameFallback: false,
  });
  if (!endpoints || !isActiveCanonicalLocation(endpoints.originLocation)
    || !isActiveCanonicalLocation(endpoints.destinationLocation)
    || !hasCoordinatePair(endpoints.originLocation)
    || !hasCoordinatePair(endpoints.destinationLocation)) return null;

  const route = await findActiveRoute(db, endpoints);
  if (!route) {
    return resolveRouteForRequest(db, {
      ...request,
      pickup_location: null,
      dropoff_location: null,
      estimated_distance: distanceKm,
      estimated_duration: durationMin,
      estimate_source: estimate.source,
    }, { allowNameFallback: false });
  }
  if (route.estimate_source === "Manual"
    || (route.estimated_distance != null && route.estimated_duration != null)) return route;

  return db.query(
    `UPDATE routes SET estimated_distance = $1, estimated_duration = $2,
       estimate_source = $3, estimate_updated_at = NOW(), updated_at = NOW()
     WHERE route_id = $4 AND estimate_source IS DISTINCT FROM 'Manual'`,
    [distanceKm, durationMin, estimate.source, route.route_id]
  );
}
```
- [ ] **Step 6: Verify helper GREEN.** Run `npm run test:run -- src/services/route-resolver.test.js`.
- [ ] **Step 7: Implement the transaction sequencing.** Keep the early service-code lookup for fast rejection. Run strict v2 estimation with `persistRoute: false`. In `withTransaction`, resolve locations with `FOR SHARE`, re-resolve the service code with `FOR SHARE`, verify load type, replace insert parameter index 9 with the locked service ID, insert, and call `persistStrictRouteEstimate(tx, linkedRequest, estimate)` only when `RETURNING` produced a row.

```js
const inserted = await tx.query(insertSql, lockedParams);
if (inserted.rows[0]) {
  await persistStrictRouteEstimate(tx, {
    ...request,
    pickup_location_id: lockedPickupId,
    dropoff_location_id: lockedDropoffId,
  }, estimate);
}
return inserted;
```
- [ ] **Step 8: Verify GREEN and regression coverage.** Run `npm run test:run -- src/lib/integration/ingest.test.js src/services/route-resolver.test.js`; expect all insert/replay/tombstone and strict-estimate tests to pass, with no provider call in the locked transaction.
- [ ] **Step 9: Commit.** Commit the four files with `fix: make v2 service and route writes atomic`.

### Task 3: Classify unsupported pull revisions

**Files:**
- Modify: `src/app/api/integration/pull/route.js`
- Test: `src/app/api/integration/pull/route.test.js`

**Interfaces:**
- A recognized v2 envelope with `event_kind !== "create"` or `external_revision !== 1` is rejected with stable `SOURCE_REVISION_UNSUPPORTED`.
- The response remains aggregate HTTP 200; each recognized unsupported row increments `skipped`, `rejected`, and `rejectionCodes.SOURCE_REVISION_UNSUPPORTED`. Malformed envelopes remain skipped without a rejection code.

- [ ] **Step 1: Add failing tests.** Feed update, cancel, and revision-2 create envelopes followed by one valid create. Assert `ingested: 1`, three rejections under `SOURCE_REVISION_UNSUPPORTED`, and that only the valid row reaches `ingestRequest`.

```js
const unsupported = [
  { ...MOCK_INCOMING[0], event_kind: "update" },
  { ...MOCK_INCOMING[0], event_kind: "cancel" },
  { ...MOCK_INCOMING[0], external_revision: 2 },
];
getGateway.mockReturnValue({
  name: "mock",
  fetchPendingRequests: async () => [...unsupported, MOCK_INCOMING[1]],
});
const response = await POST(new Request("http://localhost/api/integration/pull", { method: "POST" }));
expect(await response.json()).toMatchObject({
  ingested: 1,
  skipped: 3,
  rejected: 3,
  rejectionCodes: { SOURCE_REVISION_UNSUPPORTED: 3 },
});
expect(ingestRequest).toHaveBeenCalledTimes(1);
```
- [ ] **Step 2: Verify RED.** Run `npm run test:run -- src/app/api/integration/pull/route.test.js -t "unsupported v2 revisions"`. Expected: current code reports them only as skipped and has no code.
- [ ] **Step 3: Add the stable code.** When a parsed v2 envelope has an unsupported kind/revision, throw an error with code `SOURCE_REVISION_UNSUPPORTED`. In the envelope-parse catch, count that recognized code as both skipped and rejected, increment `rejectionCodes[code]`, and continue; leave other malformed items as skipped only.

```js
if (raw?.contract_version === 2) {
  const envelope = normalizeInboundEnvelope(raw, sourceIdentity);
  if (envelope.event_kind !== "create" || envelope.external_revision !== 1) {
    const error = new Error("Unsupported v2 event or revision.");
    error.code = "SOURCE_REVISION_UNSUPPORTED";
    throw error;
  }
  request = envelope.request;
}
```

```js
} catch (error) {
  const code = error?.code;
  if (code === "SOURCE_REVISION_UNSUPPORTED") {
    skipped += 1;
    rejected += 1;
    rejectionCodes[code] = (rejectionCodes[code] || 0) + 1;
  } else {
    skipped += 1;
  }
  continue;
}
```
- [ ] **Step 4: Verify GREEN.** Run `npm run test:run -- src/app/api/integration/pull/route.test.js`.
- [ ] **Step 5: Commit.** Commit only the pull route and its test with `fix: report unsupported pull revisions`.

### Checkpoint

- [ ] Run touched-file ESLint: `npm run lint -- src/lib/integration/ingest.js src/lib/integration/ingest.test.js src/services/route-resolver.service.js src/services/route-resolver.test.js src/app/api/integration/pull/route.js src/app/api/integration/pull/route.test.js`.
- [ ] Run `git diff --check`.
- [ ] Do not start migration or geofence work if any focused integration suite is failing.
