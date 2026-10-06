# FleetOps v2 zero-coordinate geofence implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make valid v2 canonical `(0,0)` location targets work through trip geofencing and live-monitor routing while preserving the legacy/GPS sentinel.

**Architecture:** Keep the default coordinate parsers sentinel-safe. Add an explicit target-only opt-in derived from `source === "canonical_registry"` for v2 targets, and a corresponding route-polyline opt-in for corridors fetched to those targets. Never use the target opt-in for the current GPS position or legacy v1 target.

**Tech Stack:** JavaScript, Vitest, shared pure geofence/off-route evaluators, trip-geofence and live-trip-monitor services.

## Global Constraints

- A linked active v2 point with complete finite in-range coordinates may be `(0,0)` and must remain `canonical_registry`.
- Permit zero only for a v2 canonical target and route geometry generated to that target.
- Keep `(0,0)` rejected for GPS position inputs and legacy v1 route targets; do not globally relax GPS or coordinate validation.
- V2 remains linked-Fleet-only: never use request text, proposal coordinates, gazetteer, or seed locations as a substitute target.
- Use TDD; run focused Vitest and touched-file ESLint. Do not claim a live database or device result from mocked tests.

---

### Task 1: Carry target-scoped zero opt-in through geofence and arrival gates

**Files:**
- Modify: `src/lib/geo/geofence.js`
- Test: `src/lib/geo/geofence.test.js`
- Modify: `src/services/trip-geofence.service.js`
- Test: `src/services/trip-geofence.test.js`

**Interfaces:**
- `evaluateGeofence({ position, target, radiusM, accuracyM, allowZeroZeroTarget = false })` retains the current default. Its GPS `position` always uses sentinel-safe parsing; only the target parser uses the opt-in.
- `evaluateTripGeofences(...)` opts in per endpoint only when that target has `source === "canonical_registry"`.
- `checkEndProximity()` passes target provenance to `evaluateGeofence`; legacy targets keep the default.

- [ ] **Step 1: Add failing pure tests.** In `geofence.test.js`, assert a nonzero GPS point within 100 m of a `(0,0)` `canonical_registry` target is `inside`; the same target without the marker remains `unknown`; and a `(0,0)` GPS position remains `unknown` even when the target opts in.

```js
it("allows zero only for a canonical target, never a GPS position", () => {
  const target = { lat: 0, lng: 0, source: "canonical_registry" };
  expect(evaluateGeofence({
    position: { lat: 0.0005, lng: 0 }, target, allowZeroZeroTarget: true,
  }).state).toBe("inside");
  expect(evaluateGeofence({ position: { lat: 0.0005, lng: 0 }, target }).state).toBe("unknown");
  expect(evaluateGeofence({
    position: { lat: 0, lng: 0 }, target, allowZeroZeroTarget: true,
  }).state).toBe("unknown");
});
```
- [ ] **Step 2: Verify RED.** Run `npm run test:run -- src/lib/geo/geofence.test.js`. Expected: v2 target evaluation is `unknown` because the shared parser rejects zero for both sides.
- [ ] **Step 3: Add failing service tests.** In `trip-geofence.test.js`, feed an active v2 linked registry point at `(0,0)` into `evaluatePingGeofence` and `checkPickupProximity`; use a nonzero ping within the radius and assert `near_pickup`/`inside`. Keep the existing legacy route `(0,0)` suppression test and add a zero-GPS-position unknown assertion.

```js
const zeroV2Trip = {
  trip_id: 58, dispatch_id: 9, route_id: null,
  origin: "Partner pickup", destination: "Partner drop-off",
  external_create_fingerprint: "v2-zero", pickup_location_id: 41, dropoff_location_id: null,
  _pickup_registry_location_id: 41, _pickup_registry_name: "Equator Harbor",
  _pickup_registry_is_active: true, _pickup_registry_retired_at: null,
  _pickup_registry_latitude: "0", _pickup_registry_longitude: "0", _pickup_registry_radius: 75,
  _dropoff_registry_location_id: null,
};
const pingResult = await evaluatePingGeofence(stubDb([]), zeroV2Trip, {
  latitude: 0.0005, longitude: 0, accuracy: 10,
});
expect(pingResult.near_pickup).toBe(true);

clearTripGeofenceCache();
const now = new Date("2026-09-07T10:00:00+08:00");
const arrivalDb = stubDb([
  ["FROM gpstracking", [{ latitude: "0.0005", longitude: "0", accuracy: "10", recorded_at: now.toISOString() }]],
  ["FROM trips t", [zeroV2Trip]],
]);
expect((await checkPickupProximity(arrivalDb, 58, now)).state).toBe("inside");
```
- [ ] **Step 4: Verify service RED.** Run `npm run test:run -- src/services/trip-geofence.test.js -t "zero-coordinate v2"`. Expected: targets are constructed, but the evaluation/gate reports unknown.
- [ ] **Step 5: Implement the target-only parser option.** Add `allowZeroZeroTarget = false` to `evaluateGeofence`. Parse `position` with the default sentinel rule and parse `target` with the opt-in. In `evaluateTripGeofences`, derive that opt-in from `target.source === "canonical_registry"`; in `checkEndProximity`, pass the same provenance check.

```diff
- if (lat === 0 && lng === 0) return null;
+ if (!allowZeroZero && lat === 0 && lng === 0) return null;
```

Use `toLatLng(value, { allowZeroZero = false } = {})`; call it without options for `position` and with `{ allowZeroZero: allowZeroZeroTarget }` for `target`.
- [ ] **Step 6: Verify GREEN.** Run `npm run test:run -- src/lib/geo/geofence.test.js src/services/trip-geofence.test.js`.
- [ ] **Step 7: Commit.** Commit the four files with `fix: honor v2 zero-coordinate geofence targets`.

### Task 2: Preserve the v2 zero target through live monitor and corridor geometry

**Files:**
- Modify: `src/services/live-trip-monitor.service.js`
- Test: `src/services/live-trip-monitor.service.test.js`
- Modify: `src/lib/geo/off-route.js`
- Test: `src/lib/geo/off-route.test.js`

**Interfaces:**
- `toLatLngArray(value, { allowZeroZero = false } = {})` keeps its default rejection; `targetKeyOf(target)` and the destination side of `resolveLegRoute` opt in only for `target.source === "canonical_registry"`. The origin/GPS position always uses the default.
- `distanceToPolylineM(position, points, { allowZeroRoutePoints = false } = {})` keeps its default rejection; `evaluateOffRoute({ ..., allowZeroRoutePoints = false })` passes the option only to route geometry. GPS position and recent pings remain sentinel-safe.
- `evaluateTripRow()` enables route-point zero only when the current v2 target has `canonical_registry` provenance.

- [ ] **Step 1: Add failing off-route tests.** In `off-route.test.js`, assert a two-point corridor ending at `(0,0)` yields null with default options and a finite distance with `allowZeroRoutePoints: true`; assert a `(0,0)` current GPS position remains an invalid observation even with the route-point opt-in.

```js
const points = [[0.0005, 0], [0, 0]];
expect(distanceToPolylineM({ lat: 0.0005, lng: 0 }, points)).toBeNull();
expect(distanceToPolylineM(
  { lat: 0.0005, lng: 0 }, points, { allowZeroRoutePoints: true }
)).toBe(0);
expect(evaluateOffRoute({
  position: { lat: 0, lng: 0 }, routePoints: points, allowZeroRoutePoints: true,
}).state).toBe("unknown");
```
- [ ] **Step 2: Verify RED.** Run `npm run test:run -- src/lib/geo/off-route.test.js -t "zero route point"`. Expected: both route-point cases are currently treated as unusable.
- [ ] **Step 3: Add failing live-monitor test.** Build a persisted-v2 trip row whose active linked target is `(0,0)`, with a nonzero GPS fix within 100 m. Mock TomTom to return a route whose final point is `[0, 0]`. Assert the monitor exposes the target as `{ lat: 0, lng: 0, source: "canonical_registry" }`, produces a non-null ETA, and computes finite corridor distance; assert a legacy zero target or zero GPS fix does not receive the opt-in.

```js
fetchTomTomRoute.mockResolvedValue({
  durationMin: 8,
  trafficDelayMin: 0,
  coordinates: [[0.0005, 0], [0, 0]],
});
const result = await evaluateLiveTripMonitor(db, { tripId: 101, now: NOW, persist: false });
expect(result.endpointTargets.pickup).toMatchObject({ lat: 0, lng: 0, source: "canonical_registry" });
expect(result.liveEta).not.toBeNull();
expect(result.offRoute.distanceM).not.toBeNull();
```
- [ ] **Step 4: Verify RED.** Run `npm run test:run -- src/services/live-trip-monitor.service.test.js -t "v2 zero-coordinate target"`. Expected: target route-key parsing yields unknown ETA/corridor.
- [ ] **Step 5: Implement scoped target parsing.** Add the default-false options to `toLatLngArray`, `targetKeyOf`, and `resolveLegRoute`; only parse a canonical-registry target with zero allowed. Add the default-false route-point option to `distanceToPolylineM`/`evaluateOffRoute`, and pass it from `evaluateTripRow()` only for a canonical-registry target.

```js
const targetKey = targetKeyOf(target); // targetKeyOf uses allowZeroZero only for canonical_registry.
const destination = toLatLngArray(target, {
  allowZeroZero: target?.source === "canonical_registry",
});

// In off-route evaluation, the point parser stays strict; only route geometry opts in.
const distanceM = distanceToPolylineM(position, routePoints, { allowZeroRoutePoints });
```

At the evaluator call site, set `allowZeroRoutePoints: target.source === "canonical_registry"`; do not pass that option to `toPoint(position)` or `validObservation()`.

```diff
- if ((aLat === 0 && aLng === 0) || (bLat === 0 && bLng === 0)) continue;
+ if (!allowZeroRoutePoints && ((aLat === 0 && aLng === 0) || (bLat === 0 && bLng === 0))) continue;
```

Keep `toPoint(position)` unchanged; call `distanceToPolylineM(pos, routePoints, { allowZeroRoutePoints })` after current-position validation.
- [ ] **Step 6: Verify GREEN.** Run `npm run test:run -- src/lib/geo/off-route.test.js src/services/live-trip-monitor.service.test.js`.
- [ ] **Step 7: Commit.** Commit the four files with `fix: preserve v2 zero targets in live monitoring`.

### Checkpoint

- [ ] Run `npm run lint -- src/lib/geo/geofence.js src/lib/geo/geofence.test.js src/services/trip-geofence.service.js src/services/trip-geofence.test.js src/services/live-trip-monitor.service.js src/services/live-trip-monitor.service.test.js src/lib/geo/off-route.js src/lib/geo/off-route.test.js`.
- [ ] Run `git diff --check`.
- [ ] Confirm every opt-in is target/route-geometry-specific; GPS position parsers remain default-false.
