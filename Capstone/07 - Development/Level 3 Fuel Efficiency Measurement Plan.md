---
type: implementation-plan
status: active
created: 2026-10-18
updated: 2026-10-19
related: ["[[Fuel]]", "[[Technical Debt]]"]
---

# Level 3 Fuel Efficiency Measurement Plan

## Outcome and scope

Full "Level 3" measurement — promoting **measured** fuel efficiency (verified receipts over completed-trip distance, possibly segmented by traffic/time-of-day, grade, route class or driver) from a read-only reference to the **primary basis** for estimates and forecasts. The gates below were signed off by product on 2026-10-19, and **phase 1** (rolling per-vehicle measured basis for the request forecast, dispatch payload and resolver precedence — but with the profile cleanly out-ranked only when the gates pass) shipped the same day; see the implementation record. The segmentation described under "What is not captured" remains parked: it needs data the system does not collect and will not be invented.

## Calibers (one precedence, FE-08)

1. **Measured efficiency (Level 3, phase 1)** — `src/lib/fuel/measured-efficiency.js`: eligible receipts (non-deleted; `Approved` plus legacy `Completed`) over completed-trip distance in the trailing window, adopted only when the gates below pass (`basis: "measured"`), flagged when it disagrees widely with the profile.
2. **Configured profile** — `vehicles.fuel_efficiency_kmpl`, resolved by `resolveVehicleEfficiency()` (`src/lib/ai/rule-engine.js`, `basis: "profile"`). Drives request forecasts and the locked trip estimate wherever the measured gates have not passed.
3. **Seat/fuel-type heuristic** — a labelled fallback only (`basis: "heuristic"`), never silent.
4. **Period read-out** — `src/lib/reports/fuel-consumption.js`: the same eligible set over a chosen range with `MIN_EFFICIENCY_DISTANCE_KM = 50` as a **display floor**. Surfaced read-only on `/fuel/estimates` (the measured strip) via `getFuelConsumptionReport`; still never feeds an estimate.

## Graduation gates (SIGNED OFF 2026-10-19, recorded here before wiring)

All four answers were product decisions; they are now constants in `src/lib/fuel/measured-efficiency.js` and pinned by its test suite.

- **Window definition.** Trailing **90** Manila calendar days, inclusive of today (`manilaTrailingRange`), matching the reports horizon. `MEASURED_EFFICIENCY_WINDOW_DAYS = 90`.
- **Volume floor.** At least **100 km** of completed-trip distance in the window — comfortably above the 50 km display floor, roughly 2–3 real trips of evidence. `MEASURED_EFFICIENCY_MIN_DISTANCE_KM = 100`.
- **Data quality (receipt floor).** At least **3** eligible receipts in the window, so one odd fill-up cannot dominate the average. `MEASURED_EFFICIENCY_MIN_RECEIPTS = 3`. Eligibility still means non-deleted `Approved` + legacy `Completed` receipts over `Completed`-trip distance — the official caliber, no new one.
- **Sanity band (gap handling).** Adopt the measured number once the gates pass; a gap of **more than 35%** against the configured profile raises a **review flag** recorded with the request (`efficiency_flags: ["profile-gap-high"]` in the calculation snapshot) — never a blocker, never a silent switch. Exactly at the band is not a flag. `MEASURED_EFFICIENCY_MAX_PROFILE_GAP = 0.35`.

## Ordered path (executed 2026-10-19)

1. ✅ Record the gate numbers (window, volume, receipts, sanity band) in this note.
2. ✅ Compute per-vehicle rolling measured efficiency from the existing caliber in `fuel-consumption.js`; no new storage (the request snapshot JSONB carries the provenance).
3. ✅ Surface it with an explicit basis label beside the profile value (the FE-08 payload pattern: value + basis), on the requests calculation snapshot and the dispatch candidate payload.
4. ✅ Flip the precedence in `resolveVehicleEfficiency()` — that function is the single seam where the swap happens, test-first.

## Implemented — phase 1 (2026-10-19)

- **`src/lib/fuel/measured-efficiency.js`** — the gate constants + `assessMeasuredEfficiency` (pure gates/arithmetic/flag) + `attachMeasuredEfficiency` (two grouped queries mirroring the official caliber, per vehicle, over the trailing window; attaches `_measured_efficiency` onto vehicle rows).
- **`resolveVehicleEfficiency()`** (the FE-08 seam) — precedence is now **measured → profile → heuristic**; a vehicle carries `_measured_efficiency` only when an async caller attached it, and only an eligible assessment outranks the profile.
- **`POST /api/fuel/requests`** — the operational forecast resolves through the seam: the calculation and variance math use `efficiency.kmpl` whatever its basis; the calculation snapshot records `efficiency_basis`, `efficiency_kmpl` and, when measured, `efficiency_measured {distance_km, liters, receipts, window_days}` + `efficiency_flags`. A vehicle with **no configured profile** may now pass the profile guard **only if** its measured gates pass (tank capacity still required) — the honest consequence of measured outranking the profile.
- **Dispatch candidate payload** (`dispatch-recommendation-preparation.service.js`) — candidates get their measured basis attached before scoring, so `_est_fuel_basis` may read "measured"; the payload contract is unchanged.
- **Behaviour on real data (2026-10-19):** **0 of 13** vehicles pass the gates on the current fleet data (best partial evidence: vehicle #130 with 5 receipts but only 51 measured km — below the 100 km floor). Measured is inert until data accumulates; every request keeps its profile basis today. That is the gates working as intended, not a defect.
- **Not wired (deliberate):** the locked trip estimate's efficiency still comes from the configured profile, written by `trip-lifecycle.service.js` — that file belongs to the in-flight odometer workstream and must not be touched; the swap there is one edit once that workstream lands. The per-vehicle basis read-out on the vehicle profile page is also deferred. Other surfaces resolve through the seam and pick measured up automatically when their caller attaches it.

## Capture backlog (parked — requires new data, not new code)

- Traffic/time-of-day, road grade, route class and per-driver attribution are not persisted anywhere tied to fuel measurement. Adding them means new capture, storage and provenance work — not a display change. No proxy will be derived or invented.
- No segmentation or regression approach has been designed or validated on fleet volumes; premature promotion would replace a configured baseline with a noisy estimate.

## Implemented today (reference, 2026-10-18)

- `GET /api/fuel/estimates` returns `measured: { efficiency_kmpl, liters, distance_km, min_distance_km }` from `getFuelConsumptionReport(from, to)`.
- `/fuel/estimates` renders it as a read-only strip under the KPI grid; below the 50 km floor it says "insufficient data" instead of guessing. It never feeds an estimate or a forecast.

## Related

- [[Fuel]] — the feature note with the full audit history.
- [[Technical Debt]] — carries the parked items' status.
