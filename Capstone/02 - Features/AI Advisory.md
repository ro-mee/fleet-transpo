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
last_verified: 2026-09-07
related: ["[[Dispatch]]", "[[AI Architecture]]"]
---

# Feature: AI Advisory

## Unified conversational dispatch flow - 2026-09-15

Options, Q&A, automatic selected-pair checking and assignment confirmation now share one conversation log. Each option is a Copilot bubble. Questions need no selection and end with a choice prompt; typed option commands select the exact displayed pair. Selection automatically produces the checked confirmation reply, so one subsequent Assign it can submit through the existing guarded path. Manual reasons, freshness, permission and conflict checks remain enforced. Success stays visible, including in the mobile drawer after the queue row moves out. See [[Temporal Dispatch Recommendation Implementation Plan#Unified conversation follow-up - 2026-09-15]] for the verification record (1,280 tests, lint, 267 guards and build passed; browser acceptance pending).

## Temporal recommendations and reliability/workload trade-offs - implemented locally 2026-09-15

Core behavior from [[Temporal Dispatch Recommendation Implementation Plan]] is implemented: horizon-specific cards, schedule gap versus usable slack, service-date workload, sufficient-reliability trade-offs, grounded conversation, boundary refresh, pinned choices and selection-bound explicit confirmation commands. Future cards omit current GPS precision. Assignment and trip start revalidate the exact pair. Tests: 130 files / 1,265 tests, 267 route guards, build and read-only live SQL checks passed. Browser/provider acceptance remains pending; authoritative duty/fatigue data and closed-tab alerts remain deferred.

## Planned queue-only Copilot - 2026-09-15

The user approved one assignment workspace in Reservation Queue: up to two current pair options, chosen-pair queue revalidation, same-panel permitted manual review and one active confirmation area. Reservation Detail will link to the exact selected request in the queue. See [[Queue Only Dispatch Copilot Implementation Plan]] for the proposed pinned-choice planner and versioned manual authorization work. The temporal implementation now supplies pinned selection, same-panel review and signed manual alternative authorization. The broader detail-to-queue navigation consolidation remains separately planned.

## Selected-pair explanations and stable confirmation - 2026-09-15

Copilot questions capture the displayed pair and request when sent. The conversation API resolves the pair against fresh server candidates before limiting context, distinguishes missing selections from the engine recommendation, and discloses candidate/exclusion coverage. Replies retain their asked-about pair in reservation-isolated history; chat never refreshes confirmation authority.

The action footer now remains visible through polling, missing evidence and blocked states, with a disabled reason and relevant recovery action. Queue validation belongs to `useDispatchPlan`; queue confirmation requires a current independent verified proposal, while individual detail does not inherit a cached queue plan. Review is pinned to pair, evaluation timestamp, plan token and override reason. Ranking displays `score` out of 100, and queue alternatives offer read-only comparison with unverified queue impact. Server assignment/override safeguards are unchanged.

Verification: 69 targeted tests / 10 suites, touched-source lint, 267/267 route guards and production build passed. Browser/live-provider acceptance remains pending because browser inventory returned no providers. See [[AI Recommendation Panel Improvement Plan]] for implementation details and remaining manual checks.

## Free-text Dispatch Copilot — 2026-09-15

The queue now analyzes the selected reservation's explicit Manila service date, rather than silently using today's scope for Upcoming rows. Copilot displays recorded exclusion reasons and includes an Ask Copilot composer with suggested question shortcuts, even when no pair is recommended. The permission-checked conversation endpoint reuses deterministic evidence and the existing AI adapter, with bounded history, rate limiting, minimal coordinate-free context and a labelled evidence-only provider fallback. Chat cannot assign or change a safety state; confirmation still requires the existing live validated route. See [[Dispatch Copilot Scope and Conversation Audit]] for verification and remaining browser/provider acceptance.

## Dispatch decision workstation — implemented 2026-09-14

The reservation queue now operates as a unified two-column persistent workstation (`/reservations/queue`): a compact selectable queue table on the left and a sticky, non-modal Dispatch Copilot decision aside on the right (collapsing to an accessible drawer on tablet/mobile with single-mount discipline). Selecting any queue row immediately updates the Copilot's context, recommended pair, live checks, feasibility metrics, and in-panel confirmation without opening a modal dialog.

The queue page features four truthful summary tiles (Ready, Review required, Blocked, Needs verification) derived from the planner scope (today through Manila midnight plus overdue), preserving unanalysed status prior to evaluation. Assignment commits directly within the Copilot panel with live server revalidation, plan token preservation, required override reasons for manual review, atomic timeline auditing, and 409 conflict recovery. See [[Dispatch Copilot Persistent Workspace Plan]] for architecture, tests (1,189 passing tests, Next.js build pass), and pending visual browser acceptance. Earlier descriptions below of modal recommendation flows are historical where they conflict with this persistent workstation.

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

## Routed deadhead signals — PR #1 (2026-09-07, information only, scoring unchanged)

`fetchCandidates` now enriches the nearest-5 Haversine shortlist with
`_deadhead_minutes_routed` + `_deadhead_provenance` (cached live TomTom,
fail-open; `src/services/route-feasibility-context.service.js`). The pair
scorer does NOT consume them yet — they ride along for the feasibility layer.
Phase 2 will wire them into delay-risk / future-impact scoring. Pending queue
requests are never treated as a pair's "next booking" (only `Scheduled`/`In
Progress` dispatches are).

## Route feasibility card — PR #2 (2026-09-07)

Recommendation GET/POST now attach `feasibility` (verdict + legs + reasons +
provenance) to recommended/alternate/top-3 via `attachPairFeasibility`; the
panel renders it as a Route Feasibility card with per-leg provenance labels.
Skipped-vehicle rejection reasons are disclosed in a collapsible list even
when pairs exist. Overrides accept an optional `override_reason` recorded in
timeline metadata (thesis: acceptance vs outcome analysis). Scoring unchanged.

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

## PR 5 queue copilot (2026-09-14)

The queue analyzes today's Manila-window unassigned requests and overdue pickups together. Provisional proposals share resources, protect future fixed trips and expose incomplete analysis. Review pins one pair; signed evidence expires or invalidates on operational changes. No bulk application or LLM decision dependency. See [[PR 5 AI Dispatch Copilot]] for objectives, bounds and verification: 1,173 tests and production build passed; browser/live concurrency acceptance pending.

## Related

[[AI Architecture]] · [[ADR-003 Deterministic AI]] · [[Dispatch]] · [[Maintenance]] · [[Feature Index]]


## PR 4.5 ? Context-aware dispatch (2026-09-13, implemented)

Recommendation GET/POST, regenerate, legacy halves and pinned narration now use per-pair IMMEDIATE / REPOSITION / SCHEDULED policy evidence. Scheduled preparation does not select current driver GPS fields. Feasibility precedes final selection; safe immediate candidates use routed ETA, while missing GPS preserves review candidates without invented ETA. The existing panel adds context and an explicitly opened, request-scoped dispatcher radar; exact standby coordinates require dispatch privileges and never enter ordinary recommendation/narration payloads. Stored snapshots are audit records rather than freshness authority.

Verification and remaining device acceptance: [[PR 4.5 Context-Aware Dispatch Radar Implementation Plan#Implementation record ? 2026-09-13]]. Full suite: 1,140 passing tests; later focused checks: 37 passing tests; web build, Android export, route-auth audit and migration/query verification passed.
