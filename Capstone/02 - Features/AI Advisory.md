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

## Reference option-card UI - 2026-09-16

Restyled Copilot option messages to the user's supplied visual reference: compact option/status/time header, emerald recommended card and filled button, neutral alternative with outlined button, side-by-side vehicle/driver identity band with a divider, status icons and full-width arrow actions. The card itself remains a message in the existing conversation. Its header expands schedule/workload evidence and additional checks without filling the compact default view.

Only actual candidate data is displayed: vehicle plate/name/seats, stored vehicle image (neutral icon fallback), driver name/ID, supported checks and the scheduled Manila pickup time. No sample names, van photos, times or all-clear claims were copied. Vehicle image_url now passes through the existing advisor projection. Current missing/blocked/stale states and selection/assignment guards remain visible and enforced.

Verification: ten focused card/panel/assignment/advisor tests and touched-source ESLint passed. Build status is recorded in SYSTEM.md. Browser inventory has no connected provider, so exact visual matching and mobile screenshot acceptance remain unverified. The gray-on-color detector combined mutually exclusive emerald/slate badge branches; a file-scoped false-positive exception preserves the reference's same-hue light-background/dark-text badges. No unresolved design finding remains.

## Copilot answer quality - 2026-09-16

Enhanced the existing conversation guidance to answer the question first, use only relevant evidence, explain the actual reliability/workload trade-off, and avoid repeating the reservation or checklist. Driver display names are included in the explicit evidence projection. Future findings remain schedule-qualified; stale or future GPS cannot appear as live ETA, including through the legacy travel-minutes alias.

Evidence-only fallback replies now distinguish timing/workload, ETA and conflict questions, retain displayed option identity and separate completed/active/scheduled work. Missing evidence remains unknown, and a blocked selected pair gets a corrective next step rather than an assignment invitation. Unsupported/general questions retain a short labelled evidence summary; the fallback is not a general-purpose language model.

The server supplies selectable option numbers from fresh checks. The UI appends a choice prompt only for those options when no pair is selected, and never asks the dispatcher to choose again after selection. Prompt guidance forbids claiming before/after changes from untrusted chat history or timestamps. Background refresh still does not append repetitive chat messages. Assignment authority remains in the checked confirmation flow.

Verification: 29 focused tests passed. Final lint, authorization audit and production build results are recorded in SYSTEM.md. Live-provider wording and browser acceptance were not exercised. The design hook's undersized Clear memory label was changed to the documented 12px control size; no findings were suppressed or left outstanding.

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

## Copilot eye-pulse GIF - 2026-09-16

Created `public/images/copilot-avatar-pulse.gif` from the existing PNG using `scripts/animate-copilot-avatar.py` (Python/Pillow/NumPy). Bright-green color detection is limited to the face so only the two eyes pulse; cap, headset and body remain static. The 1024px transparent GIF has 60 frames at 50ms, a 3-second infinite loop and a smooth 22%-100% brightness pulse. Decoded-frame verification confirms every non-eye pixel stays identical across all frames. GIF palette quantization and binary transparency apply; the source PNG is unchanged and the app has not been switched to the animation.

## Copilot blink GIF - 2026-09-16

Added `public/images/copilot-avatar-blink.gif`: the eyes close vertically in 100ms, hold closed for 100ms, then reopen over 150ms during a 3-second infinite loop. Python reconstructs the dark visor only within the eye regions before compressing the luminous eye layers. Run `scripts/animate-copilot-avatar.py --blink` to reproduce. Verified 3000ms total duration and identical decoded pixels outside the eye regions; duplicate holds encode as six frames. The earlier pulse GIF and source PNG remain available; app references are unchanged.


## Blinking avatar activated - 2026-09-16

Renamed the blink asset to `public/images/copilot-avatar-blinking.gif` and switched all eight Copilot avatar references across the queue, panel, conversation, option bubbles and mobile drawer. The Python generator now outputs this filename. Verified all eight references resolve to the asset and decoded its 3000ms infinite loop.


## Dispatch Copilot feature review - 2026-09-16

Reviewed current conversation evidence/guidance and temporal recommendation notes. Existing foundations include temporal recommendations, reliability/workload explanations, exclusions and selection-bound assignment. Proposed additions (not implemented): actionable recovery guidance when no pair qualifies; verified before/after change explanations; read-only what-if schedule simulation; downstream impact explanations across reservations; and event-driven alerts with replacement proposals for assigned trips. Prioritize recovery guidance and verified change explanations, then simulation. Alerts should be deduplicated and based on meaningful changes, not every refresh; closed-tab delivery needs a durable worker. Simulations must use the constraint engine and remain separate from actual assignments. No product code or live behavior changed; assessment is source/document based, not a live operational audit.


## Copilot enhancement implementation plan - 2026-09-16

Created [[Dispatch Copilot Decision Support Enhancement Plan]] in `Capstone/07 - Development/`: phased recovery guidance, verified change explanations, read-only simulation, queue impact and assigned-trip alerts. Includes source reuse, permissions, simulation/assignment separation, notification scheduler dependencies, acceptance cases and rollout gates. Status: proposed; documentation only, no application behavior changed.


**Return-trip matching plan added (2026-09-16):** Extended [[Dispatch Copilot Decision Support Enhancement Plan]] with Phase 4B: bounded follow-on booking search from scheduled destination/release, full sequence feasibility, evidence-backed empty-travel comparison and separate explicit follow-on assignment review. Includes cross-midnight, missing evidence and concurrent-assignment acceptance cases. Documentation only; not implemented.


## Selected Copilot option readability - 2026-09-16

Reworked the selected-pair summary within the existing conversation: separate labeled vehicle/driver identity, prominent preparation slack, previous release time, service-date workload columns and temporal context. Schedule reasoning and verified checks use keyboard-accessible native disclosures; unresolved checks and schedule uncertainty stay visible. Repeated check-label prefixes are removed without changing evidence. Pending rechecks withhold old detail, future live ETA remains suppressed and existing assignment/review handlers are preserved. Raised existing 10px panel labels to the 12px design-system step.

Verification: 15 focused component tests passed, touched-source ESLint passed and layout detector reported no findings. Live desktop/mobile visual inspection unavailable because the session has no browser provider.

Production build also passed (201 pages).


## Selected review conversation order fix - 2026-09-16

The selected-pair summary previously rendered after all chat messages, causing bottom-follow scrolling to land on the summary instead of the newest question/answer. Selection messages now carry structured pair/action identity, and the live selected review renders immediately after the latest matching selection turn. Subsequent questions, answers and the typing indicator stay below it. Cleared/pruned history places the review above remaining messages; no duplicate review is created. Operational errors/assignment progress remain separate current replies and assignment guards are unchanged. Explicit commands also resume bottom-follow scrolling.

Verification: 16 focused component tests and touched-source ESLint passed, including review ordering and pruned-history regression cases. Browser visual validation remains unavailable in this session.
