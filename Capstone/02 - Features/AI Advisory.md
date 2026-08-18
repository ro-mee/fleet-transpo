---
type: feature
status: working
tags: [feature, ai, advisory]
source:
  - src/lib/ai/dispatch-advisor.js
  - src/lib/ai/rule-engine.js
  - src/lib/ai/pair-scoring.js
  - src/lib/ai/predictive-maintenance.js
  - resources/ai/instructions.md
last_verified: 2026-08-17
related: ["[[Dispatch]]", "[[AI Architecture]]"]
---

# Feature: AI Advisory

## What it does

Ranks vehicle + driver pairs for a request and explains why, so the dispatcher chooses from an informed shortlist instead of a raw list of 20 vehicles and 23 drivers.

## Why it exists

Assignment has many competing constraints — availability, category match, number coding, document expiry, driver hours, vehicle condition. A human can hold three of those in mind. The rule engine holds all of them, every time, identically.

## The critical design property — CONFIRMED

**It advises. It never acts.** `src/lib/ai/dispatch-advisor.js:11-14`:

> *"DETERMINISTIC AND ADVISORY. The same inputs always produce the same output, every number traces to a rule in this file, and nothing here writes an assignment — a human confirms via the assign endpoint. LLM narration, when enabled, is a nullable presentation layer on top and never the decision."*

→ [[ADR-003 Deterministic AI]] · [[AI Architecture]]

## How it works

| Module | Job |
|---|---|
| `rule-engine.js` | Deterministic scoring against the constraint set |
| `pair-scoring.js` | Scores vehicle+driver **as a pair**, not separately |
| `predictive-maintenance.js` | Flags vehicles approaching service thresholds |
| `prompt-loader.js` | Loads `resources/ai/instructions.md` (editable content, not code) |
| narration adapter | Optional LLM prose. **Never throws.** |

Scoring pairs rather than ranking vehicles and drivers independently is the non-obvious choice: the best vehicle and the best driver aren't necessarily the best pairing (a driver may not be certified for that vehicle class).

## The engine ranks the whole roster — CONFIRMED 2026-08-15

`fetchCandidates` does **not** filter to `driver_status = 'Available'` or exclude
`vehicle_status = 'In Use'`. Availability is answered by **schedule-overlap**, and the only
statuses that disqualify are the true ones — driver `Suspended` / `On Leave` / `Off Duty`
(`UNAVAILABLE_STATUSES`) and vehicle `Under Maintenance` / `Decommissioned` /
`Registration Expired`. `In Use` is deliberately allowed: a vehicle out now is free for a later
window.

The manual pickers previously filtered to `status: "Available"` only — stricter
than the engine, so they withheld pairs the engine (and the server's
`validatePairAvailability`) would accept. They were updated to mirror the engine
(→ [[Dispatch]] "Availability is decided by the window, not the status label").
The `ai-assign-dialog` manual override was removed 2026-08-18; the dialog now
embeds the shared `AiRecommendationPanel`, which renders the engine's eligible
pair directly.

## Schedule & leave feed the engine — CONFIRMED 2026-08-15

`isDriverUnavailableFor`, `resolveVehiclePairing` and
`buildFleetPairRecommendations` now accept a pickup/return window and a schedule
context. `validatePairAvailability` (recommendation.service.js) loads the driver's
weekly schedule + approved leave via `loadDriverScheduleContext` and passes them
through, so the advisory ranking, the transport-request recommendation endpoint
(GET + POST) and `buildDispatchRecommendation` all exclude a driver who is
schedule-blocked or on approved leave for the window — same rule as the dispatch
pickers. → [[Driver Management]]

## AI Fair Workload Distribution — CONFIRMED 2026-08-15

Adds a pool-relative workload term to the fleet-pair ranking so the least-loaded
eligible driver is preferred among otherwise-similar pairs. It never decides who is
eligible and never overrides the designated-driver match.

- **Hard rules decide WHO CAN; scoring decides WHO SHOULD.** Eligibility,
  availability, schedule/leave, license and the designated-driver pairing remain
  MUST-PASS. Fairness only re-ranks the drivers who already passed every hard rule.
- **Designation always wins.** The designated-driver bonus (+45) vs substitute (+10)
  is a +35 gap, larger than the fairness pull (~15), so a lighter substitute can never
  outrank an intact designated pair.
- **Workload is more than trips.** `workloadIndex` = trips + km/40 + hours/1.5 with a
  rolling lookback (7d × 1.0, 30d × 0.4) so recent activity weighs heavier.
- **Pool-relative, not absolute.** `scoreWorkloadBalance(index, poolMax)` = 1 −
  index/poolMax (clamped 0..1); the least-loaded driver scores ~100 and is flagged
  `is_lightest`. Drivers with no history are neutral (`null` fairness, no score change,
  no invented ranking).
- **Runs after scoring.** `scoreFleetPair` now returns an *unclamped* score so fairness
  has headroom to reorder near-saturated pairs; the final clamp to 0..100 happens in
  `buildFleetPairRecommendations` after `applyWorkloadFairness`. Chip + checklist
  claim in the panel; `fairness_score`/`workload` passed through dispatch-advisor.

→ [[Dispatch]]

## LLM narration is optional and currently off — CONFIRMED

`.env` has **no LLM key**, so narration is always `null` and the UI shows deterministic scores. The feature degrades to "less prose," not "broken." → [[Deterministic Core With Nullable Narration]]

The prompt in `resources/ai/instructions.md` constrains the model hard:

> *"Never invent fake vehicle records, invalid plate numbers, or hallucinate data. If data is missing, state that it is missing."*

## Database tables used

`ailogs` (731 rows on 2026-08-11 — the largest table, and growing) · `recommendation_snapshots` **0** · `ai_insights` **0** · `ai_recommendations` **0**

The zero rows are notable: the **logging** path is heavily exercised, the **persistence** paths are not. INFERRED: snapshots/insights were designed and wired but never populated.

## Edge cases

- **No LLM key** → narration null, scores still shown. Live path today.
- **LLM returns malformed output** → adapter swallows it, narration null.
- **`ailogs` doesn't exist** → created at runtime. → [[DEBT Runtime DDL On Hot Path]]
- **Narration containing an abbreviation** → the UI splits on periods per the prompt's formatting rule, so "approx. 3 km" would split mid-sentence. INFERRED fragility. **TODO:** verify the UI parser.

## Assignment integrity audit - CONFIRMED 2026-08-17

The AI-assisted assignment dialog previously fell back to stored AI vehicle and
driver JSON when it could not form a current DB-backed pair. This produced a
confirmed invalid display: `XYZ 5678 + Juan Dela Cruz`, while the live active
custodian was Jack Mors and no substitute schedule existed.

The dialog fallback is now removed. It refreshes active custodial rows on open
and can display or commit only a current custodian or dated substitute. The
focused pair-scoring and reservation-state suites pass 56/56.

The Reservation Info recommendation panel still has open snapshot,
regeneration, response-shape, narration-cache and consumption defects. Until
those are fixed, the assign endpoint's live revalidation is the final
correctness boundary. See [[BUG AI Recommendation Can Serve Stale Pair]].

## What I learned

The defensible way to put an LLM in a workflow with real consequences: make the decision deterministic and traceable, make the LLM's contribution purely presentational, and make it nullable. Then "the AI hallucinated" is a cosmetic bug rather than an incident.

## Related

[[AI Architecture]] · [[ADR-003 Deterministic AI]] · [[Dispatch]] · [[Maintenance]] · [[Feature Index]]
