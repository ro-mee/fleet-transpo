---
type: implementation-plan
status: implemented
date: 2026-09-13
related: ["[[Live Map Radar]]", "[[AI Advisory]]", "[[Dispatch]]", "[[Routes]]", "[[Tracking]]"]
---

# PR 4.5: Context-Aware Dispatch Radar

Implemented foreground scope on 2026-09-13. The implementation record below describes current behavior; the original design specification follows for traceability. Physical-device GPS and visual acceptance remain pending.

## Implementation record ? 2026-09-13

- **Policy:** location-relevance.js is the authority for candidate-specific IMMEDIATE, REPOSITION and SCHEDULED contexts. The short-notice horizon is the central 90-minute server default. Pending/Scheduled requests are actionable; invalid times and terminal states cannot authorize current GPS. Overdue actionable requests have their own reason code. A separate trusted-itinerary argument supports early departure in the pure policy; no current-GPS-derived departure or unverified request field activates it. No stored itinerary producer was added.
- **Presence and duty:** migration 111_dispatch_standby_presence.sql adds separate latest standby coordinates and observation/receipt time, accuracy, source, vehicle and mobile-session metadata on drivers. It does not change trip/rescue coordinates or add standby breadcrumbs. The existing attendance table supplies start/end duty through the authenticated mobile duty endpoint. Start duty checks actual work schedules/approved leave. Publication independently checks current attendance, consent, a live mobile session, eligible pairing and absence of an active trip/open incident/rescue mission. Samples predating duty, stale samples, poor accuracy, future skew and out-of-order writes cannot become fresh presence.
- **Mobile:** the single app-level poster publishes standby every roughly 30 seconds while foregrounded, after trip/rescue precedence. Duty and standby writes never queue offline. Profile has a clay Start duty / End duty control; the map header says Live Tracking only from a fresh server acknowledgement. Disabling tracking, ending duty and session revocation suppress/invalidate presence. The existing carlive.png marker, heading rotation, quiet fixed 5 km visual circle, weather-above-navigation layout and clay styling remain. Anchored demo map entities are restricted to development builds.
- **Evidence and routing:** recommendation preparation no longer selects current GPS fields or computes a hotel-base/haversine proximity. Catalog-resolved coordinates and qualified current standby fixes feed TomTom. Strict routing uses the existing cache with original computation time, a 90-second maximum age, four workers, a 25-second provider evaluation budget, and per-evaluation duplicate-leg reuse. Unevaluated pairs are reported. Current GPS never enters scheduled planning or a preceding-trip origin.
- **Feasibility:** hard conflicts precede routing. Preceding driver and vehicle commitments must establish the same meaningful origin; diverging origins, unknown release times or overdue in-progress releases stay unverified. Proposed service uses the real resolved duration/explicit arrival, not a separate one-hour assignment assumption. Driver and vehicle next bookings are protected independently. Departure-to-service-end work coverage is checked. Legacy passenger estimates and failed schedule/provider lookups cannot earn VERIFIED/SAFE. INFEASIBLE pairs are excluded from assignment selection; review candidates remain available without fabricated ETA.
- **Ranking and explanation:** feasibility is evaluated before the final choice; verified safe immediate pairs rank by routed pickup ETA before existing score/fairness tie-breaks. The 5 km driver circle is not a candidate cutoff. GET, POST, regenerate and pinned narration use fresh evaluation. Snapshots remain audit records, not a 60-minute permission to reuse live GPS. Legacy response halves carry the selected pair's context/readiness. LLM input includes only selected context, applicable evidence and feasibility facts.
- **Dispatcher UI and privacy:** the existing recommendation panel shows context, review/verified state, live-proximity wording, routed ETA and expected reposition evidence. An explicit View request radar control fetches exact pins only for the selected short-notice request. The endpoint requires reservations assignment and dispatch read-all permissions in addition to the recommendation read guard, rechecks presence/freshness, and returns private/no-store. Generic API serialization strips new standby storage fields even from nested driver rows; scheduled and ordinary recommendation responses contain no exact standby coordinates. Pins expire and are removed on the view's next refresh.
- **Commit consistency:** assignment, direct creation and dispatch edits revalidate the shared rules. Linked-request capacity/class inputs are reloaded from the database. Force cannot bypass hard conflicts; reviewable immediate/reposition uncertainty requires an override reason. Driver status exceptions for future windows require loaded work-schedule and leave evidence, with missing schedules, approved leave, current off-duty state and suspension still blocked. Evidence hashes are rechecked inside a short transaction. Final request assignment and dispatch creation/reassignment commit together; a service arrival is persisted. Routing occurs before the transaction. The small-fleet implementation briefly serializes operational writes with table locks; replace with ordered per-resource locks if measured contention warrants it.

### Verification performed

- Full Vitest run: **109 files / 1,140 tests passed**. Subsequent focused verification: **8 files / 37 tests passed**, including added canonical-request, busy/delayed GPS, preceding-origin and privacy checks.
- Web production build passed; Android Hermes export passed with **1,395 modules / 5.15 MB**, including carlive.png.
- Route-auth audit: **263 guarded methods, zero failures**.
- Migration runner: **114 applied, zero pending, zero checksum changes**; schema.sql regenerated. Presence columns inspected through information_schema. Real standby and evidence-hash queries executed successfully. The short commit lock plus evidence read was exercised inside BEGIN/ROLLBACK without changing operational records.
- Targeted ESLint checks passed. Design review fixed off-scale 10px text to 11px; existing mobile radar palette and modal scrim received narrow intentional-value exceptions, and the design sidecar was refreshed.

### Operational limits and acceptance

Foreground standby only: a backgrounded/locked device naturally becomes delayed/offline. Physical-device location acknowledgement, map gesture/animation appearance and actual dispatcher workflow acceptance still need a real driver session; bundle/unit checks do not prove device behavior. No live driver assignment or fabricated GPS observation was submitted during verification. Catalog-unresolved routes remain review-required. The independent early-departure hook requires a future trusted itinerary producer; the standard 90-minute gate is active now. Route-weather forecasting, always-on background standby, queue-wide optimization and a global fleet-surveillance endpoint were not added.

## Original design specification

## Recommended scope

Implement one authoritative location-relevance policy, real standby presence, and request-specific evidence in the existing recommendation flow. Reuse the current routing, scheduling, pairing and assignment guards. Keep the driver standby map calm; add dispatcher radar as a view of the selected request in the existing recommendation/queue flow, rather than a separate ranking application.

The deterministic engine selects evidence and evaluates candidates. Optional LLM narration explains supplied facts; it never selects origins, authorizes GPS use, changes feasibility or assigns a pair. This is context-aware rule-based decision support; do not describe it as a learned predictive model unless one is actually added and evaluated.

## Confirmed starting point

| Existing implementation | Consequence for this PR |
|---|---|
| Mobile standby map: fixed 5 km visual circle, clay controls/weather and four tabs | Preserve this presentation. The circle is not currently a server-side dispatch restriction. |
| `mobile/lib/tracking.js` returns before collecting/posting when there is neither a trip nor a rescue mission | A moving local marker is not evidence that dispatch receives fresh standby location. A standby publishing path is a prerequisite. |
| Recommendation route uses `PROXIMITY_WINDOW_HRS = 3`; `rule-engine.js` also defaults to 3 hours | Replace the distributed gate with the centralized 90-minute proposal. Existing helper also admits arbitrarily old pickup times; handle overdue requests explicitly. |
| `driverPosition()` prefers current coordinates, then trip GPS, then `HOTEL_BASE`; fallback GPS query omits observation time | Current data does not establish freshness. An assumed base must never become a tracked position or verified live ETA. |
| Candidate construction computes current-position distance even for future requests | Suppression must happen before derivation/serialization/narration, not only in rendering. |
| Pair scorer uses distance points and estimates pickup minutes from distance at 25 km/h | Replace immediate proximity evidence with verified routed ETA. Guard missing numbers before coercion: `Number(null)` must not become a zero-minute route. |
| Routes are computed for the nearest five before hard pair eligibility; feasibility is attached after ranking | Reorder the pipeline. Ineligible drivers must not consume the routing budget; infeasible winners must not remain recommended. |
| Three-leg feasibility and `travel-buffer.js`/`conflicts.js` already exist | Extend their origin/time inputs and reuse their constraints; do not build a parallel feasibility engine. |
| Next-dispatch lookup uses driver OR vehicle with `LIMIT 1`, and errors return null | Check both resources' next commitments, and distinguish an empty result from a failed lookup. Unknown schedule coverage is not proof of no conflict. |
| Recommendation snapshots default to 60 minutes; existing GET revalidates pairing | Pair validity is not GPS/traffic/context validity. Existing stale-pair fixes are present; extend them rather than claiming they are still missing. |
| GPS health: Fresh <=90 seconds, Delayed <=300 seconds, otherwise Offline; current-row timestamps are set to server `NOW()` by GPS writes | Reuse health categories but establish observation time independently of ingestion time. Old queued fixes cannot become Fresh on arrival. |
| Attendance history/table exists, but no check-in write endpoint was found in the inspected API tree | Confirm its producer before enabling mandatory checked-in eligibility. Do not equate an authenticated session with checked-in duty. |

## Decisions to lock before implementation

### 1. Request urgency and candidate origin are different dimensions

A single request may have an idle candidate using `IMMEDIATE`, another candidate using `REPOSITION`, and a candidate with no verified location. Put request urgency at response level and resolve `mode` per driver-vehicle pair. Do not force every candidate into the recommended pair's mode.

| Candidate context | Mode | Origin | Current GPS |
|---|---|---|---|
| Short-notice request; ready now; no intervening commitment | IMMEDIATE | Fresh qualified GPS, otherwise NONE | Allowed only with qualifying evidence |
| Relevant preceding commitment before candidate pickup | REPOSITION | Predicted preceding destination and available-at time | Excluded from this candidate's origin/proximity calculation |
| Future request without a meaningful preceding origin | SCHEDULED | NONE | Excluded entirely |

Missing GPS does not turn an immediate request into scheduled planning. Keep `mode: IMMEDIATE`, `liveLocationUsed: false`, and `proximity: null`; preserve non-location assessment with an explicit unverified state.

The preceding commitment must meaningfully predict where both driver and vehicle will be. A trip yesterday or an unexplained long gap does not establish tomorrow's origin. Divergent driver/vehicle origins, shift changes or missing destinations require handover/reposition evidence or an UNKNOWN result. A valid custodial pairing alone does not establish physical co-location.

### 2. Scope eligibility to time

Apply compatibility, capacity, compliance, pairing, resource readiness and requested-window conflicts to all contexts. Apply checked-in, on-duty-now, standby and not-on-active-trip gates to immediate radar participation. A driver currently on a trip or off duty can still be eligible for a future window; do not globally discard them before REPOSITION/SCHEDULED evaluation.

Include rescue missions and blocking incidents in current busy state. Check shift/break coverage across departure, passenger service and required turnaround, not merely the scheduled pickup instant. Preserve existing custodial/substitute rules and number-coding/compliance checks.

**Attendance dependency:** reuse a verified attendance producer if present. If absent, add the smallest authenticated start/end-duty flow backed by the existing attendance model, outside the map surface. Without a trusted current session, label duty unverified and withhold verified immediate-radar participation; do not silently relax the requested checked-in rule.

### 3. Resolve the early-departure trigger without circular GPS use

Central server default: `shortNoticeHorizonMinutes = 90`, alongside existing dispatch policy defaults. No settings UI in the first slice.

Use `0 <= pickupAt - now <= horizon` for ordinary short notice. Classify still-actionable overdue requests separately with a reason; never include cancelled/completed requests just because their dates are in the past. Missing/invalid pickup time means no live-location authorization.

An outside-horizon request may activate early only from a trusted, non-current-GPS planned departure estimate, such as a known staging plan or preceding itinerary. If none exists, remain scheduled; do not fetch GPS just to decide whether fetching GPS was permitted. Use an existing operational departure lead-time value where suitable, and define the exact cutoff in the policy test.

The supplied 70-minute scenario already meets the 90-minute rule. Add a pickup in 150 minutes with a verified required departure in 15 minutes to test the independent departure trigger. A pickup in three hours is scheduled unless this explicit exception applies.

### 4. Keep the two radar surfaces distinct

- **Driver:** own marker and 5 km circle, live/last-update state, waiting copy, weather and clay navigation. Only assigned work is actionable. No competing candidate rankings, exact other-driver positions or unassigned guest requests.
- **Dispatcher:** no selected immediate request means aggregate eligible-standby count and an empty operational state, without exact pins. A selected immediate request permits a scoped candidate list; a deliberate map view may return eligible fresh positions under authorization. Reposition candidates use predicted-origin styling and an Expected label, never a live pulse.
- **Scheduled recommendation:** omit current coordinates, GPS health, current-position distances and live pins from payloads and all display paths. A short explanation such as “Scheduled planning” is sufficient; do not render “Location unavailable.”

**Recommended 5 km meaning:** retain it as the driver's visual coverage context. It is not a hard search cutoff. A 6 km candidate with a faster safe route must not lose to a 3 km candidate solely because of that circle. If a fixed operating zone is actually required, model it separately as a named base/zone geofence; a circle moving with a driver cannot prove the driver is within a fixed zone.

## Implementation sequence

### Phase 1 — Pure policy and contracts

Add `src/lib/dispatch/location-relevance.js` and focused tests. Inputs include an injected `now`, request timing/state, candidate duty/busy context, meaningful preceding commitment and trusted departure evidence. No DB or provider calls.

Return stable reason codes and origin provenance. Prefer one authorization decision and derived presentation flags rather than several independently mutable booleans. Replace the old opt-out proximity condition (`!== false`) with explicit permitted-and-qualified evidence in all scorer callers.

Suggested contract:

```js
{
  policyVersion: "4.5-v1",
  evaluatedAt: "ISO timestamp",
  requestContext: { urgency: "SHORT_NOTICE", horizonMinutes: 90 },
  candidates: [{
    vehicleId, driverId,
    dispatchContext: {
      mode: "IMMEDIATE", originType: "CURRENT_GPS",
      reasonCode: "PICKUP_WITHIN_HORIZON", liveLocationUsed: true
    },
    readiness: "VERIFIED", // or REVIEW_REQUIRED; hard exclusions are separate
    proximity: {
      etaMinutes: 8, distanceKm: 3.2,
      distanceBasis: "ROUTED", source: "tomtom-live-traffic",
      gpsObservedAt: "ISO timestamp", routeComputedAt: "ISO timestamp",
      expiresAt: "ISO timestamp"
    },
    feasibility: { verdict: "SAFE" }
  }]
}
```

Adapt to current snake_case IDs and response shape; do not introduce a second incompatible public recommendation format. Scheduled entries omit proximity and current-location fields. Reposition entries include previous dispatch ID, expected origin label, available-at time and planned route provenance. Exact coordinates are absent from ordinary recommendation responses.

**Exit:** mixed candidate contexts, horizon boundaries, invalid times, overdue eligibility and absence of context all have deterministic tests.

### Phase 2 — Trustworthy standby presence

Extend the single app-level GPS poster, not `map.js`, with a consented, checked-in, on-duty, standby branch. Add an authenticated self-only endpoint such as `POST /api/mobile/driver/standby-location`; driver and effective vehicle IDs come from the server. Reuse its existing roughly 30-second foreground cadence, with trip/rescue posting taking precedence. Standby writes are never queued offline.

Separate location **collection**, **internal decision use**, and **dispatcher disclosure**. Recommended first version stores only the latest on-duty standby observation, not a trail. Freshness expiration immediately removes its ranking/pin eligibility. End duty/logout/revocation clears or invalidates standby presence. Consent/settings disabling tracking must suppress publication even while the local map can show the driver's own position.

Persist observation time, ingestion time, accuracy, source and effective pairing identity with the latest fix. Reuse `drivers.current_*` if its writers can be made coherent; add only missing latest-observation metadata. Review trip, general location and rescue writers together so a replay cannot overwrite a newer fix or be mislabeled as standby. Do not fill a new observation timestamp from old `last_location_update` and call it verified.

Reuse `getGpsHealth`; additionally reject invalid coordinates, implausible future timestamps, out-of-order samples and insufficient accuracy for proximity. Suggested accuracy ceiling: 100 m, centralized and subject to field calibration. Missing accuracy remains explicitly unverified. Keep any existing trip history behavior separate from the guarded latest-position update.

**Foreground limitation:** background/locked-app standby will naturally become Delayed/Offline. State this honestly. Always-on standby requires a separate justified background-location/battery/consent scope; do not imply the current foreground implementation supplies it.

**Exit:** a real standby device observation reaches the server without opening an active trip; server acknowledgements drive “Live Tracking,” rather than local marker movement plus network connectivity alone.

### Phase 3 — Candidate preparation, routing and feasibility

Move reusable request-candidate enrichment out of the oversized recommendation route only as needed for shared callers. Reuse `pair-scoring.js`, `driver-schedule.service.js`, `route-feasibility-context.service.js`, `travel-buffer.js`, `conflicts.js` and existing estimate/cache services.

Pipeline:

```text
Request validation + actionability
  -> time-scoped hard pair eligibility
  -> per-pair location relevance
  -> qualified origin + available-at time
  -> routed ETA where permitted
  -> previous / proposed / next commitment feasibility
  -> safe recommendation or explicit review-required candidates
  -> context-aware ranking + bounded narration facts
```

- IMMEDIATE routes depart now; REPOSITION routes depart when the preceding commitment releases the resource. Following-trip reposition departs after proposed service completion and required dwell/turnaround, not at proposed pickup time.
- Include actual/planned service duration, unloading, waiting and turnaround once. Use a shared effective service window instead of the current separate one-hour assignment fallback. Avoid double-counting buffers across engines.
- Evaluate the next assigned commitment for the driver and the vehicle independently. Protect both even when their next bookings differ. Cancellations and edits invalidate these inputs. Distinguish lookup failure from confirmed absence.
- Keep input uncertainty: missing previous destination, unknown end time, failed route or failed schedule query yields REVIEW_REQUIRED/UNKNOWN. Do not fall back to today's GPS for future origin.
- A routed provider response or acceptable cached provider route can influence live proximity. A haversine/speed heuristic may remain explicitly labeled elsewhere for legacy planning, but cannot populate verified proximity or claim traffic-aware ETA.
- Reuse the cache; expose actual route computation time and apply an immediate evidence-age limit (proposed 90 seconds). Overall evidence expiry is no later than the GPS freshness deadline or route deadline. A cached response is labeled cached, not newly computed.

**Better than nearest five:** for the currently small fleet, route all hard-eligible, fresh immediate pairs with bounded concurrency and a request deadline, deduplicating identical origin/destination legs. The nearest-five shortlist can hide the faster sixth driver across a bridge/highway. If a larger pool exceeds budget, report evaluated versus total candidates and keep remaining candidates “not evaluated”; claim “best evaluated candidate,” not “fastest fleet driver.” No new routing-matrix dependency is required initially.

**Ranking recommendation:** preserve valid pairing constraints; exclude verified INFEASIBLE results from the recommended set. Among verified safe immediate candidates, prioritize safe pickup arrival/ETA, then existing fairness/resource-fit tie-breaks. Do not allow a score clamp or designation bonus to conceal a route conflict. UNKNOWN candidates remain visible for manual review, without a SAFE label. Existing lawful override/manual-confirmation paths remain; no override bypasses hard eligibility or DB overlap constraints.

**Exit:** a nearer candidate endangering either resource's next booking cannot be the safe recommendation; an unrouted fallback cannot acquire a measured ETA.

### Phase 4 — Recommendation, snapshot and assignment integrity

Wire the policy through GET, POST, regenerate, saved snapshot reads, pinned-pair narration and legacy vehicle/driver response fields. Include policy version, request revision/effective inputs, candidate pairing identity, evidence times and origin provenance in existing snapshot JSON where possible. Avoid a new recommendation table.

Do not reuse a 60-minute pair snapshot as fresh location evidence. Recompute/suppress expired proximity, re-evaluate when the request crosses a horizon or changes time/location, and invalidate narration when pair/context/evidence changes. The LLM receives an explicit allowlist of applicable facts; arbitrary driver rows and exact coordinates never enter scheduled narration.

At assignment, revalidate current pairing, compatibility, duty requirements for immediate dispatch, conflicts and protected next commitments. Recheck stale evidence before claiming a verified recommendation. Perform routing before a short database transaction, then validate resource/request revisions and rely on the existing transactional overlap guard. Do not hold locks during TomTom calls.

Audit all assignment paths: request assign, direct dispatch create and dispatch edit/reassign. A UI change alone does not enforce the policy. Record the selected pair, policy version, applicable evidence/age, feasibility and existing override reason, without persisting exact standby coordinates in routine recommendation/audit payloads.

**Exit:** stale snapshots, two concurrent dispatchers and a changed next booking cannot silently commit the prior “safe” result.

### Phase 5 — Connect dispatcher and driver UI

Extend `AiRecommendationPanel` and the existing Reservation Queue selection flow first. Show one concise context label, the applicable ETA/provenance and meaningful feasibility reasons. Display delayed-GPS candidates in a review section, outside verified proximity ordering. Missing GPS does not imply no schedule-compatible candidates.

Add the dispatcher radar map as a selected-request view, reusing existing map primitives where appropriate. A small request-scoped read endpoint is justified for exact positions because list and map have different disclosure permissions. Require request authorization plus operational dispatch/location access; do not allow all `reservations:read` users or generic driver-list readers to fetch exact standby coordinates. Recheck request actionability, relevance, candidate eligibility and freshness on every read. Return private/no-store responses and remove stale pins on the next refresh.

The driver map preserves the current clay header/controls/weather/nav arrangement. Update tracking copy from acknowledged standby publication, gracefully showing sending/delayed/paused states without more cards. Remove or clearly isolate the current anchored demo station/driver layers from production operational radar. Receiving an assigned trip uses the existing assignment flow; there is no driver self-selection from the dispatcher candidate list.

Use focused polling only while the operational view is open, reuse existing freshness/query patterns, and clean up on request/tab changes. Do not introduce sockets, a global all-driver endpoint or a separate radar dashboard for this PR.

**Exit:** scheduled payload inspection shows no forbidden live-location fields; driver and dispatcher roles see only their intended surfaces.

### Phase 6 — Verification, rollout and documentation

Use the existing Vitest and project verification commands. Cover the matrix below, then inspect real device standby publication and both web modes. Native screenshot/animation acceptance for the current standby screen is already pending and should be included here.

| Scenario | Required result |
|---|---|
| Pickup in 30 min; idle; Fresh accurate GPS | Immediate routed ETA can affect ranking |
| GPS at 90 seconds / just over 90 seconds | Boundary matches shared GPS-health rule; delayed sample cannot affect proximity |
| Fresh timestamp but poor/missing accuracy | Unverified proximity, no measured-location ranking |
| Queued old sample arrives now; future-dated sample | Cannot replace newer presence or become Fresh |
| Pickup tomorrow; mutate all current GPS inputs | Same scheduled recommendation and LLM facts; no current-location output or routing calls |
| Pickup in 3 hours without departure exception | Scheduled |
| Pickup in 150 min; trusted required departure in 15 min | Explicit departure rule can activate short-notice handling |
| Mixed idle and preceding-trip candidates | Candidate-specific Immediate/Reposition modes in the same response |
| Preceding origin/end missing or unexplained gap | No current-GPS substitution; UNKNOWN/review state |
| Driver currently active but free for a future window | Not idle radar; future planning remains possible |
| On leave, on break, unchecked-in, rescue-busy or wrong pairing | Appropriate time-scoped exclusion before routing |
| Incompatible capacity/compliance/vehicle status | Hard rejection before routed proximity |
| Proposed trip threatens driver or vehicle's next booking | No verified safe recommendation for that pair |
| Next-booking query fails | Unknown protection, never “no next booking” |
| Sixth-by-distance candidate is fastest by route | Considered or explicitly disclosed as not evaluated |
| Outside 5 km but fastest safe eligible candidate | Not rejected by the visual radius |
| TomTom unavailable or every GPS sample stale | Schedule assessment remains; no fabricated ETA |
| Pairing/request edited; horizon crossed; evidence expired | Snapshot/narration refreshed or stripped before reuse |
| Concurrent assignments | Live revalidation and database guard protect resources |
| Scheduled, read-only user, or driver calls exact-position endpoint | No unauthorized exact location disclosure |
| Duty ends, consent revoked, app backgrounds | Publishing/pin eligibility stops or expires according to the stated foreground policy |

Any required migration must follow repository policy: choose an unused filename, make it idempotent, run `npm run db:check`, `npm run db:up`, `npm run db:dump`, and inspect schema/query results. Never hand-edit `schema.sql`. No migration is applied during planning.

Roll out as three reviewable slices: **4.5A policy + presence**, **4.5B feasibility + recommendation enforcement**, **4.5C dispatcher UI + driver status integration**. Do not expose “verified immediate dispatch” until A and B are complete. PR #5 remains queue-wide optimization; it consumes this evidence instead of redefining it.

For thesis evaluation, define metrics before collecting them: decision time from request selection to confirmation; recommendation acceptance/override among shown recommendations; fallback fraction among immediate evaluations; conflicts flagged separately from conflicts actually avoided; predicted versus actual pickup arrival where timestamps exist. Record denominators, observation period and missing data. “Prevented conflicts” is not proven just by counting warnings.

Update the Radar, Tracking, Routes, AI Advisory and Dispatch notes plus `SYSTEM.md` after implementation, with actual checks and any unresolved device limits. No production-readiness claim until the attendance source, consented standby collection, route evidence and assignment-time enforcement are verified together.

## Deferred deliberately

No new LLM model, learned ETA predictor, queue-wide optimization, routing matrix, settings screen, always-on background standby or full fleet location trail. Add these only for a demonstrated requirement. The core delivery is one policy, one trusted latest-position path, reused feasibility, and existing recommendation surfaces.

## Historical planning verification

Reviewed the mobile map/poster, recommendation GET/POST and snapshot paths, pair/rule scorers, shared GPS health, route cache, feasibility context/engine, conflict helpers, relevant vault notes and schema definitions. No live database was queried and no tests were run for this documentation-only task. Existing runtime changes from the preceding standby UI task are not part of this planning change.


## Web standby visibility fix - 2026-09-14

The web Live Map previously consumed only active-trip GPS and rescue positions, so PR 4.5 standby publications were invisible there. It now polls the separately authorized GET /api/tracking/standby-locations feed every 15 seconds and merges verified standby pins into the existing operations map. Standby pins carry driver/plate identity, a Standby label, observation time and accuracy, without a fabricated trip or breadcrumb history. The map shows a standby count and removes expired pins or pins from a failed standby feed; active trips take precedence for the same driver/vehicle.

The endpoint requires trips:read_all, uses private/no-store responses, and reuses standbyState, qualifiedGps and effectiveStandbyVehicle. Presence requires current attendance, consent, active session, tracking enabled, no active trip/rescue, a matching eligible vehicle and a fresh accurate observation from the current duty session. This explicitly adds operations-wide standby visibility; request-specific recommendation GPS relevance and generic API storage-field suppression remain unchanged. Foreground-only publication remains the current mobile scope. Per-driver eligibility checks are reused for the small fleet; batch schedule/pairing reads if polling cost becomes significant.

Verified: 15 focused tests across four files; targeted ESLint; web production build (200 pages); route authorization audit (264 guarded methods, zero failures); new identity SQL executed successfully against the configured database. Real-device/browser acceptance remains pending.
