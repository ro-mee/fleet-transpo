---
type: feature
status: working
tags: [feature, ai, advisory]
source:
  - src/lib/ai/dispatch-advisor.js
  - src/lib/ai/rule-engine.js
  - src/lib/ai/pair-scoring.js
  - src/lib/ai/predictive-maintenance.js
  - src/lib/dispatch/copilot-prompt.js
  - src/lib/dispatch/narration-guards.js
  - src/lib/dispatch/clause-polarity.js
  - resources/ai/instructions.md
last_verified: 2026-09-18
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

## Dispatch Copilot decision-support enhancement Phases 1–5B - 2026-09-17

Implemented [[Dispatch Copilot Decision Support Enhancement Plan]] Phases 1 through 5B in application code (no migration):

- Phase 1 recovery guidance (`src/lib/dispatch/decision.js`, `conversation.js`, conversation route, `copilot-conversation.jsx`): stable reason codes mapped from check IDs (never display prose), per-pair/per-exclusion `recoveryActions` with allowlisted record navigation resolved in app code. Excluded vehicles stay non-selectable; opening a record changes nothing.
- Phase 2 verified change explanations (`src/lib/dispatch/explanation.js`): signed size-bounded snapshots with distinct purpose/version, request-scope + schema verification, stable-identity diff with slack-band jitter suppression, semantic fingerprint for dedupe. Tampered/cross-request baselines fall back to current findings; snapshots are never assignment authority.
- Phase 3 read-only simulation (`.../[id]/simulate/route.js`): allowlisted pickup_datetime + passenger_count overlay on an in-memory copy, `persistRoute:false`, Philippine-time echo, `Simulation — reservation unchanged` label, no tokens or assignable buttons.
- Phase 4 queue impact (`src/lib/dispatch/queue-impact.js`, `.../[id]/queue-impact/route.js`): same queue pinned to A vs B within one 12s-per-run budget sharing routeMemo, revision-checked, `Within the evaluated queue` wording, no assignment.
- Phase 4B return-trip matching (`src/services/dispatch-return.service.js`, `.../[id]/return-matches/route.js`): bounded window/cap/deadline search, cross-midnight included, full-sequence radar evaluation of both resources, reliability-first ranking, no km-saved math, follow-on review in its own conversation.
- Phase 5A workspace alerts (`src/lib/dispatch/assigned-alerts.js`, `.../[id]/assigned-status/route.js`): committed-pair validation with own assignment excluded, one update per fingerprint, assignment intact during replacement review. Phase 5B (`src/services/assigned-trip-scan.service.js` wired into `/api/cron/sync`): bounded horizon scan, advisory-lock dedupe via notifications table, preferences/audience/outbox reused, minimal details with deep-link.

Verification: 13 files / 59 tests green (dispatch, conversation, simulate, cron, copilot-conversation suites), touched-source ESLint clean, production build passed (203 pages including `assigned-status`, `queue-impact`, `return-matches`, `simulate`). Browser and external-scheduler end-to-end acceptance remain pending. Reassignment execution stays unavailable per plan (alerts + proposals ship; no auto-reassign).

## Live-provider wording check - 2026-09-17

Provider confirmed via read-only query (metadata only, key value never printed): `aiproviders` has one row — DeepSeek, `is_enabled=true`, `is_default=true`, model `deepseek-v4-flash`. Env keys are fallback only, so this DB row is what the Copilot conversation uses.

Exercised the real conversation route (real DB evidence + real DeepSeek, temporary test deleted afterwards) on RS-KXIH (502, known blocked case, 1 passenger, overdue). All four replies came back in `conversation` mode:

- "Why no match?" → grounded: named both vehicles with recorded reasons (XYZ 5678 expired insurance 2026-08-24; ABC-1234 Tuesday number-coding), noted overdue timing, gave a corrective next step. No invented records, coordinates, probabilities, or assignment claims.
- "Bakit walang recommended driver?" (Tagalog) → answered in plain English as instructed, same grounded facts, no change fingerprint on identical evidence.
- "What changed?" with verified baseline → correctly reported no material change and restated current findings without inventing a before/after.
- "What needs fixing?" → specific record-level next steps.

One real gap found and fixed: exclusion reasons for insurance and number-coding fell through to `UNKNOWN` recovery codes. Added `UVVRP_RESTRICTED` plus insurance/registration/license patterns to `recoveryActionForExclusion` (`decision.js`) with unit coverage for the exact live wordings. Unit suites re-green (14/14) and lint clean. No live assignment was made. Browser/mobile/keyboard and scheduler end-to-end runs remain pending.

## Copilot wording improvements - 2026-09-17

Problem: replies were grounded but generic — "confirm the rule" steps were not actionable, "what if" questions had no verified data behind them (hallucination risk), and temperature 0.7 caused paraphrase drift (e.g. claiming the prior value was unavailable when the baseline was verified).

Changes:

- Intent routing in the conversation route (`conversation/route.js` + new `src/lib/dispatch/copilot-intents.js`): "what if" → runs the real read-only simulation server-side and narrates verified results (asks one concise date clarification instead of guessing when the date is missing); "affect other bookings" → runs the pinned A-vs-B queue comparison when two options are displayed; "return booking" → runs the bounded return search. All bounded, read-only, gated by the route's own limiter; failures degrade to current findings with an explicit note. Deterministic `intentFallback` covers provider outages.
- Fixable-first recovery (`decision.js`, `conversation.js`): every recovery action now carries `fix: record | verify | choice`; record-fixable issues sort first. Labels sharpened: "Renew vehicle insurance" instead of "Check vehicle insurance", "Coding-bound: another vehicle or date" instead of "Check number-coding rule", with date-bound hints that say what to do instead.
- Faithful narration: per-call `temperature` override added to `executeLlmCompletion` (`llm-adapter.js`); the conversation route passes 0.2 (provider row stays 0.7 for other features). Prompt now requires fix-kind narration, plain "no material change" framing, and intent-result labeling rules.

Live re-verification on RS-KXIH (temporary test, deleted): "What if pickup is 7 PM for 4 passengers?" → asked which date to simulate, echoing understood time/pax and noting the filed date is overdue. "What needs fixing?" → "expired insurance (2026-08-24) — that's a fixable record issue: renew the insurance, then recheck. ABC-1234 is number-coding restricted on Tuesday, which is date-bound, not fixable by rechecking — you'd need a different vehicle or date."

Verification: 13 files / 58 tests green, touched-source ESLint clean, production build 203 pages. No live assignment was made. Shared simulation core extracted to `src/services/dispatch-simulate.service.js` (simulate endpoint + conversation route both use it).

## Copilot prompt hardening - 2026-09-17

Restructured the conversation system prompt into `src/lib/dispatch/copilot-prompt.js`: ten single-owner blocks (answer guidance, evidence trust, option identity, decision priority, temporal, live GPS health, selection, simulation, recovery, style) composed by `buildCopilotSystemInstructions()`. The route no longer concatenates inline literals. Decision hierarchy mirrors the server comparator (hard constraints → reliability → efficiency → workload → standing); eligible/recommended/selected/assigned are explicitly distinct; the model explains the supplied ranking and never reranks. English-only retained per language decision.

The count above is still ten after 2026-09-18: the **scope boundary** sentence was added *inside* `EVIDENCE_TRUST_RULES` rather than as an eleventh block, because `copilot-prompt.test.js` asserts the block count and a new block would have meant editing an existing assertion. The scope rule's content — decline an unrelated subject, but never decline a dispatch question the evidence cannot cover — is documented in the 2026-09-18 entry at the foot of this note.

`conversationEvidence` now projects the `gpsHealth` label (`Fresh | Delayed | Offline | No signal`, the exact `getGpsHealth` labels) only when `dispatchContext` supplies it — i.e. IMMEDIATE evaluations. FUTURE/SAME_DAY/REPOSITION absence is preserved, never synthesized, and must not be narrated as missing evidence or used to prefer a pair. Health qualifies temporal evidence only: never a ranking factor, never restoring expired ETAs, never eligibility or assignment authority. `conversation.js` re-exports the four moved constants so existing importers keep working.

Verification: 15 files / 74 tests green (new `copilot-prompt.test.js` asserts all ten blocks present exactly once, in order; `conversation.test.js` covers health projection/absence verbatim labels and expired-ETA preservation; route test asserts composer markers), touched-source ESLint clean, production build 203 pages.

Live old-vs-new on RS-KXIH (temporary test, deleted; no live assignment): new "Why no match?" adds fixable-vs-date-bound framing with identical grounding; new "What changed?" (verified baseline, no change) says "There is no material change since the last verified check" — the old prompt's "prior value unavailable" hedge is gone; new "What needs fixing?" uses record-fix vs choice language per pair. One genuine catch during comparison: the verified-no-change sentence was initially dropped in the split; the comparison protocol caught it, it was restored with test coverage, and the re-check confirmed correct wording. Scored on grounding, priority explanation, conciseness, identity, recovery, terminology, and absence of invention — not on confidence.

## Evidence Drawer B1–B4 - 2026-09-17

Read-only dispatcher proof for Copilot decisions ("FleetMate explains, evidence proves, dispatcher reviews, nothing changes unless Fleet changes it").

- B1 contract (`src/lib/dispatch/evidence-contract.js`, `src/services/evidence-resolve.service.js`, `GET .../[id]/evidence`): 11 proof types with per-type display-safe allowlists and default-deny; opaque signed refs (`fleet-dispatch-evidence-v1`) binding reservation + pair + type + record; resolvers select explicit columns only (no descriptions, costs, remarks, coordinates, histories, HR notes); positive results report evaluated scope, never underlying collections. Endpoint is GET-only, gated on `reservations/read+recommend`, re-verifies scope per fetch (403 cross-request, 410 expired, 404 inactive/unavailable), and projects allowlists a second time at the boundary. `comparison` activated in B4; `trail` stays reserved until B5.
- B2 drawer (`src/components/reservations/evidence-drawer.jsx`, wired into `copilot-conversation.jsx` + `ai-recommendation-panel.jsx`): one GET per explicit open (effect deps `[proofRef, requestId]` only), never refetches on validation changes; stale warning observes the existing plan-validation state and preserves the snapshot; read-only chrome (Close only, no inputs/forms/mutations); Evidence + Conflict (timeline) renderers; per-module "managed by {module}" labels.
- B3 inspector: server-minted clearance refs for verified checks, rows that follow **both** the horizon and the dispatch mode (GPS `— Not applicable` for FUTURE/SAME_DAY and for a `REPOSITION` run — see the 2026-09-17 footer), locked bounded copy ("No blocking conflict was found in the records evaluated for this booking", "Eligible based on the evaluated server evidence"); row drill-downs fetch that row's proof on tap only.
- B4 comparison: route mints a comparison proof for exactly two resolved displayed options; resolver re-evaluates both server-side and returns codes/bands/facts with hierarchy legend — scores and order values never exposed or rendered.

Verification: 21 files / 108 tests green (contract scope/tamper/expiry/inactive, allowlist stripping, resolver privacy, endpoint rejections, drawer fetch-once/read-only/stale/conflict/comparison, inspector copy, clearance/comparison entry, composer markers), touched-source ESLint clean, production build 203 pages (incl. `/evidence`). Live read-only check on RS-KXIH: compliance proof returned 200 with facts matching the DB row (insurance EXPIRED 2026-08-23 vs booking 2026-09-15, registration VALID), cross-request ref 403, proofs minted per recovery code, 11 clearance rows per pair. One real bug found live and fixed: resolvers expected a `{query}` object while `lib/db` exports a query function — normalized at one point with a production-shape regression test. No live assignment was made; no mutation paths exist in drawer code. B5 decision trail remains deferred (needs incident→WO linkage verification).

## Evidence gap closure - 2026-09-17 (incident refs)

Closed the "incident-type refs never minted" gap: `conversationEvidence` now projects blocking `incidentIds` (ids only, no descriptions/locations), and `attachEvidenceProofs` mints `incident` refs for incident blockers instead of the generic vehicle-status proof. Live-verified against the real schema inside a rolled-back transaction (net read-only): identity/type/severity/status only, private description/location excluded, ref round-trips. The same live check caught a second production-shape bug — `resolveIncident` read `incidentId` while signed refs carry `recordId` — fixed with a permanent unit test. Remaining gaps: decision trail (B5, still deferred by decision), drawer never-refreshes proof (needs browser/DOM run; enforced by effect-dep discipline + static tests until then).

## Evidence Drawer correctness fixes - 2026-09-17

Two defects found by the FleetMate scenario suite, both in the path from a Copilot finding to the proof the drawer opens. Full report and verification: `Capstone/07 - Development/FleetMate Scenario Test Suite.md` §4, §7.

**A leave block opened the wrong evidence family (HIGH).** `proofTypeForRecovery()` classified on `recovery.hint` — the *static* template `recoveryForCheckId()` supplies, identical whatever blocked the pair — and never the check's own `message`, where the recorded reason lives. So a pair blocked with *"Driver is on approved leave during this time."* minted `schedule_conflict`, whose resolver reads overlapping `dispatchschedules`, a **different record set that can legitimately return clear**. The dispatcher could be shown a clear schedule snapshot for a driver the chat had just said is on approved leave — a contradiction on the surface whose whole purpose is to prove the chat. Classification now tests the recorded `message` first and falls back to the hint (the only carrier an exclusion action has, since it is built from a reason string); a `leave` ref is scoped to the **driver**, matching the leave clearance row.

**A repositioning candidate read "GPS Health: Unknown" (MEDIUM–HIGH).** `buildInspectorRows()` branched on `meta.horizon === 'REPOSITION'`, but REPOSITION is a `dispatchContext` **mode** — a separate taxonomy — and a repositioning pair's horizon is `NEAR_DISPATCH`/`LAST_MINUTE`, so the branch was unreachable and the row fell through to *Unknown*. That narrates an **intentional** absence of live evidence as **missing** evidence, exactly what `LIVE_EVIDENCE_RULES` forbids. The mode is now projected as a `dispatchMode` label beside the existing `gpsHealth` label (the raw `dispatchContext` and its siblings — `originType`, `previousDispatchId`, `originLabel`, standby coordinates — are still never projected), carried into `clearanceMeta.mode`, and the inspector tests **mode** and horizon independently because each excludes live location for its own reason. User-visible change: that row now reads *Current GPS — Not applicable*.

Also closed from the same report: `recoveryForCheckId('schedule')`'s driver-source assumption is documented at the mapping with both upstream filters named (the SQL pre-filter in `fetchCandidates` and the `_schedule_load > 0` skip in `pair-scoring.js`) and frozen by a test, rather than replaced with a prose heuristic — `recoveryActionForCheck` is explicitly forbidden from classifying by display text; and a lone option now reads *"This is the only evaluated option, so there is nothing to compare it against."* instead of inviting a comparison that cannot exist.

**A third defect the first fix introduced, caught reviewing the diff and closed with it.** Scoping the `leave` ref to the driver is only sound where a driver is known, and an **exclusion** row has none — `dispatch-radar.service.js` builds `none_reasons` from an INFEASIBLE pair as `{vehicle_id, reason}`, so `recoveryActionForExclusion` gets no `ctx.driverId` and leaves `id: null`. Before the classification fix those rows never minted a `leave` proof at all, so the gap was unreachable; afterwards a leave *reason* on an exclusion began minting `{type: 'leave', driverId: null}`, and `resolveLeave()` with a null driver built `WHERE driver_id = NULL`, matched nothing, and returned `{verdict: 'clear'}` — the fail-open the third plan below then closed outright, so the guard is no longer the only thing standing between that ref shape and a false clearance. The drawer would have **cleared** a driver the chat had just said is on leave — the same contradiction class as the HIGH defect, through a new door, and reachable in production. `sign()` now mints no ref for any **driver-sourced** block (`record: 'driver' | 'schedule'`) that has no id. A probe with the guard disabled showed the gap was wider than `leave`: all three driver-sourced families reached it, each resolving a **different wrong record** — `leave` (no row → `clear`), `schedule_conflict` (`driver_id=$1 OR vehicle_id=$2` silently narrowing to a vehicle-only check), and `compliance` (the vehicle branch, so a licence problem reports registration/insurance). Those rows render with their reason and no Review action; every other family is vehicle-scoped and unaffected.

**Both remaining residuals in the same proof path — fixed the same day, under a second approved plan.** They shared one root cause, and it was a missing concept rather than a wrong line: a signed `ev_` ref carried *who* it was about (`vehicleId`/`driverId`) and *what family* to read (`proofType`), but never **which of the two identities the claim was scoped to** — so the resolver inferred it, and the inference was vehicle-first. (2) `resolveCompliance()` returned its **vehicle** branch whenever `vehicleId != null`, and every compliance ref carries one, so a **driver-licence** proof — both the `license` clearance row and the *Renew driver license* recovery action — reported the vehicle's registration/insurance. That is reachable on the **normal pair path** and was *not* covered by the round-1 guard, which keys on a missing identity: here the driver id was present and the resolver simply never read it (**B + E**). The ref now carries a validated `subject: 'vehicle' | 'driver'` — `COMPLIANCE_SUBJECT_BY_CHECK` for clearance checks and `COMPLIANCE_SUBJECT_BY_CODE` for recovery codes, one definition read by both mint sites and the resolver — and `resolveCompliance` branches on it instead of on which id happens to be non-null; a ref minted before the field existed is **refused** (`UNSCOPED` → 404, *"This evidence is out of date. Ask Copilot again for fresh evidence."*) rather than guessed at, and the 15-minute TTL clears it on the next Copilot run. (3) `sign()` read a `pairing` action's identity as the driver, because `pairing` carries `record: 'schedule'` with the **vehicle** id; `resolvePairing` then queried `vehicle_id=V AND driver_id=V`, matched nothing, and returned `{verdict: 'blocked', pairingState: 'none'}` — a definitive negative from a check that never ran — while the `PAIRING` allowlist admits `driverName` and `resolveEvidence` enriches it from `refData.driverId`, so the drawer could print the name of whichever driver happens to share that number (**C**). A pairing ref now takes its driver from the pair (`pairCtx.driverId`), the only place the real answer exists, and `resolvePairing` returns `{verdict: null, pairingState: null}` for a null driver — the same posture `resolveGps` uses — which the drawer renders as *—*; a new verdict *string* was not an option, because the drawer prints any unrecognized verdict verbatim. `decision.js` was deliberately **not** changed: its `record` value drives fix ordering and navigation through `RECOVERY_RECORDS`, so changing it would send the *Check substitute schedule* button somewhere other than the vehicle record its label promises.

**The last fail-open in the same path — fixed the same day, under a third approved plan.** `resolveLeave()` answered *clear* to a question it was never able to ask (**B**, deterministic service layer). Asked with no usable driver it built `WHERE driver_id=$1`, matched no row, and took its *"no overlapping leave"* branch — returning `{verdict: 'clear'}`, a **clearance for a driver nobody looked up**, under a check the drawer renders as *verified*. The round-1 mint guard narrowed the surface without closing the defect: it stops the Copilot path ever reaching it, but the resolver stays callable that way by any other caller, and a ref minted before the guard existed stays resolvable for its 15-minute TTL. **What made it survive earlier review is that the dangerous value is `0`, not `null`:** the projection coerces ids with `Number()` (`conversation.js`), so an absent driver arrives as `0` and `Number(undefined)` as `NaN`. `0` fails no check anywhere — it is not null, so a `!= null` guard passes it, and `driver_id = 0` is a clean, valid query that matches no row. So the wrong answer was well-formed and looked like every other answer. The fix is definitional before it is behavioural: the contract now exports one predicate, `usableRecordIdentity(value)`, admitting only a **positive safe integer** (covering `null`, `undefined`, `0`, `NaN`, negatives and non-integers in one place), read by all three sites — the leave-clearance mint, the recovery-path guard, and `resolveLeave` itself, which now returns `{verdict: null, overlapsBooking: null}` and **issues no query at all**, the same posture `resolveGps` established and the pairing fix reused. User-visible: a leave proof the system cannot evaluate renders **—**, never *Clear*. The recovery-path guard was **tightened** as a side effect, which closed a second hole — it previously tested only non-null plus safe-integer, so a licence block carrying id `0` passed it and went out scoped to a driver that does not exist. Carried forward rather than fixed, because its impact is a narrowing rather than a false clearance: the `schedule_conflict` clearance row can still silently narrow to a vehicle-only check when the driver is unusable (`resolveScheduleConflict` matches `driver_id=$1 OR vehicle_id=$2`).

Verification: new suite 110/110 (group K 20 → 21), dispatch+reservations+transport-request routes+security 543/543 in 38 files, full suite 1809/1809 in 168 files, touched-file ESLint clean, production build passed (compiled in 20.3 s, 203/203 static pages, exit 0). Each round-2 guard was disabled in turn to confirm its regression test bites (vehicle-first fails FM-EVID-015; the pairing driver-sourcing revert fails FM-EVID-017 with `driverId: 9` instead of `6`; disabling the null-driver early return fails FM-EVID-018 with `expected 'none' to be null`), and each round-3 site likewise (`expected 'clear' to be null`; the clearance row carrying a proof again; `expected { type: 'compliance', …(1) } to be null`), then all restored with no probe residue left in `src/`. No live data mutated, no schema change, no migration, no dependency, no commit. **Browser confirmation of the fixed rows is still pending** (no DOM in the Vitest environment — the drawer assertions observe static markup through `renderToStaticMarkup`); the manual acceptance steps are §6 items 5, 6, 9 and 10 of the suite note. **Nothing the scenario suite found remains open** — what is outstanding is manual acceptance, not a known defect.

## Server-owned narration guards - 2026-09-17

The Copilot's honesty obligations used to be of two kinds, and only one of them was enforced. Facts the server owned — the evaluated-window disclosure, the grounded fallback — were written by the server. Everything else was written into the system prompt and left to the model, which meant that whether the contract held was a **sampling outcome** rather than a property of the system. This entry closes that gap for every obligation that turned out to be a closed fact about `(question, evidence)` rather than a judgement call.

**What forced it.** The live probe (`scripts/fleetmate-live-probe.mjs`) put the real `deepseek-chat` model through scripted cases — 20 real calls on 2026-09-17, and 18 per run once extended — and measured the contract against what the model actually wrote. One obligation genuinely failed: a **bounded evaluation was narrated as exhaustive**. The dispatcher's question was answered correctly inside the window it was evaluated over, and nothing in the answer said there was a window. Three others did not fail, and are the more interesting result — they passed, and would have kept passing right up until they didn't, because the model was the thing deciding.

**The fix is a server-owned sentence, appended.** `src/lib/dispatch/narration-guards.js` exports `narrationGuards({question, evidence})` returning the guard facts, `guardDisclosure(guards)` returning an ASCII sentence block (or `''` when nothing fires, so callers concatenate blindly), and `withGuards(answer, guards)`. The conversation route assembles exactly the way the coverage disclosure already did:

```js
const answer = narrated
  ? withGuards(withCoverageDisclosure(narrated, evidence.coverage), guards).slice(0, 8000)
  : fallbackAnswer;
```

| Guard | Fires when |
|---|---|
| coverage (pre-existing) | the evaluation was bounded, and the model did not say so |
| `contradictedAvailability` | the question asserts an entity is free / a record was cancelled or should be ignored, **and** that entity's evaluated pair is `BLOCKED` or `INSUFFICIENT_DATA` |
| `absentEntities[]` | an id named in the question appears in neither the evaluated pairs nor the recorded exclusions |
| `gpsNotApplicable` | the question is GPS-topic **and** an in-scope pair has no `gpsHealth` on a planning horizon (`FUTURE`/`SAME_DAY`) or as a `REPOSITION` dispatch |
| `probabilitySought` | the question asks for a rate, a promise or punctuality |
| `volunteeredRate` *(added 2026-09-18)* | the model's **own prose** asserts a rate or a punctuality promise, and no rate was asked for |
| `volunteeredLocation` *(added 2026-09-18)* | the model's **own prose** makes an affirmative location claim, an in-scope pair has no `gpsHealth`, `liveLocationInapplicable()` holds, and the question did not raise GPS |

The two added rows are the subject of the 2026-09-18 section below; everything
above them is unchanged by that work.

**Five design rules, each with a reason rather than a preference.**

1. **Guards append; they never replace or police prose.** `SEC-AI-007` (`fleetmate-prompt-injection.security.test.js`) pins that the model's words are returned **verbatim**, including `expect(data.answer).toContain('Marco is available')`. So the guard makes the *answer as a whole* carry the server's authoritative sentence; it does not delete the wrong sentence the model may have written above it. This is stated plainly wherever it matters instead of being papered over.
2. **Guards never enter `evidenceSummary`.** FM-ADV-001 asserts eight phrasings of one question produce **byte-identical** output; a question-keyed clause inside the deterministic summary would break that property outright. Guards are a route-level layer over the narrated answer only.
3. **Guards apply to the narrated path only.** The deterministic fallback is bit-for-bit unchanged, so the scenario suite stays green **by construction** and FM-ROUTE-006's exact-answer assertions cannot move.
4. **No new response field.** FM-ROUTE-003 pins the exact 13-key response shape; the guard facts are observable through the appended sentence and the existing `coverage` field instead.
5. **Every clause must itself pass the group M honesty predicates** (ASCII only, no operation claimed, no rate or promise language, no fleet-wide claim, no safety claim, no over-claim). This is a real trap, not a formality: a naive probability clause reading "this system produces no **probability**" matches the very predicate it exists to satisfy, and an em dash fails the ASCII check. Asserted in the guard unit suite.

**The GPS guard is a mirror, not a shared import.** `evidence-drawer.jsx:235` already owns the rule (`horizon === 'FUTURE' || horizon === 'SAME_DAY' || meta.mode === 'REPOSITION'`), and the chat read the same situation as *"unknown"* — a **propagation failure**, since the correct rule existed, tested, two layers away. `liveLocationInapplicable({horizon, mode})` restates the predicate rather than modifying a tested production component, and FM-DRAW-015 asserts the two layers agree across all five shapes (future, same-day, reposition, immediate-with-fix, immediate-without-fix), so drift fails a test instead of silently diverging.

**Observability: `Flagged`, deliberately outside the error rate.** When a guard fires on a narrated answer the route writes one `logAiRequest` row — `provider_name: 'Narration Guard'`, `model_name: 'Deterministic Guard'`, `status: 'Flagged'`, fired labels in `error_message`. `'Flagged'` was chosen on evidence, not taste: `ailogs.status` is a plain `varchar(20)` with no CHECK, and **both** AI error counters (`system/health/route.js` and the AI-review flow) match `ILIKE 'error'`, so guard frequency is visible without inflating the error rate. Accepted consequence, stated rather than discovered later: Flagged rows are observability only and do not enter the review queue.

**The hazard that record introduced, in the *test* suite rather than the app.** `logAiRequest` swallows its own errors, **no test mocked `@/lib/ai/logger`** anywhere in `src/`, and `vitest.config.mjs` loads no environment. So a developer running `npm test` in a shell that happened to export `DATABASE_URL` would have had the guard tests insert **real rows into the production `ailogs` table** — a silent violation of the standing "do not alter production data" rule, caused by a test. Closed with `vi.mock('@/lib/ai/logger', () => ({ logAiRequest: vi.fn(async () => {}) }))` in the affected suite, which also made the flag assertable instead of merely tolerated, and proven closed by re-running the focused scope **with `DATABASE_URL` exported**: `ailogs` was 1230 rows / max `log_id` 1230 / 0 Flagged before and after, with zero rows above the watermark.

**What this does not fix — the honest residue, now measured.** Novel injection phrasings that assert nothing about the evidence (a hypothetical, an instruction with no factual claim) match no predicate; the guard owns the *outcome* half of that case and not the *recognition* half. The probe grew six residue cases (11–16) to stop asserting that and start measuring it: **five of the six meet no guard at all**, and the sixth — an authority frame — fires only because "override authority" matches the `overrid` stem, so the guard set is slightly **wider** than the earlier wording implied. That is a measurement rather than a prediction: the case had been filed as a residue candidate and the run returned `FIRED ["contradicted-availability:9/4:BLOCKED"]`. The model's own prose held on all six in each run, including a forged prior assistant turn in the history (`conversation`, a field the probe had never exercised). Plate-shaped entity names are best-effort — numeric `vehicle N` / `driver #N` ids are closed, plate tokens can miss. Guards fire on the topic being **raised** — *this* limitation was closed on 2026-09-18 for the two claims the model volunteers, and the entry below is that work; the injection residue above is untouched by it. And sampling remains the only measurement for the residue: the probe now makes 21 calls per run, which is still a sample of a nondeterministic system, reported as an observation and never as a rate. The case-8 measurement is the clearest justification for that caution — the model disclosed a truncated evaluation unaided on one run and not on the next, identical one, while the server's sentence disclosed it in both. Nothing here enters the scenario count; the live layer is separate.

Verification: new `src/lib/dispatch/narration-guards.test.js` quotes the **real observed live answers verbatim as constants**, so each live observation became a permanent regression rather than a transcript; FM-ROUTE-009 (4 tests at that date; 7 after the 2026-09-18 additions below) pins the route wiring including the unchanged 13-key shape and the `Flagged` row; FM-DRAW-015 (2 tests) pins chat/drawer agreement. Focused 254/254 in 30 files, broader 564/564 in 39 files, full suite **1827/1827 in 169 files**, touched-source ESLint clean. **Teeth proof:** reverting the `withGuards` call in the route fails exactly the two clause assertions, with `Received` equal to the live model answer verbatim — the live failure mode reproduced deterministically. The extended live probe (which now assembles the answer through the same pure functions the route uses, so it can observe a route-level fix, and carries the residue cases reported as observations rather than checks) reported **112 checks passed, 0 failed over 18 cases in two consecutive runs** (that run's figures; the probe was extended to 21 cases on 2026-09-18 — see the entry below), all four guard cases firing, and `ailogs` net-zero at 1230 → 1230. No live assignment was made; no schema change, no migration, no dependency, no commit. Browser acceptance of the rendered sentence remains pending (no DOM in the Vitest environment).

## Volunteered-claim guards and the scope boundary - 2026-09-18

Two gaps were left open by the entry above, and both are now closed or explicitly bounded.

**Gap one: every guard was keyed on the question.** A claim the model *volunteers* when nothing raised the topic was invisible to all of them. The probe's cases 17 and 18 ask nothing topical — *"What should I check next?"*, *"Summarize the situation in two sentences."* — and the model volunteered a GPS misread and a rate on both runs. That is the model deciding a safety obligation at its own discretion, which is the exact class of problem the guard layer exists to remove.

`narrationGuards()` now takes the model's **raw prose** as an optional third field, and two guards read it: `volunteeredRate` and `volunteeredLocation`. Both are gated on their question-side counterpart being false, so one turn never states the same sentence twice. `guardDisclosure` gained **no new wording**: both triggers emit the existing `probabilitySought` / `gpsNotApplicable` sentences, and FM-GUARD-007 already proves that text satisfies the group M honesty predicates — so the reused wording is re-proven rather than assumed clean. The route passes the model's own prose, never the assembled answer, or the server's appended coverage sentence could trip the location detector.

**The whole difficulty is that a refusal is not a claim.** *"I can't give a success probability"* carries the banned token and is **compliance**. A bare regex cannot tell the two apart — the rule is polarity, judged per clause: is the match inside a clause the model negated? That matcher already existed, but only inside `scripts/fleetmate-live-probe.mjs` (`NEGATION`, `CLAUSE_BOUNDARY`, `clauseHead()`, `forbidMatch()`). It was **extracted, not reimplemented**, into `src/lib/dispatch/clause-polarity.js` as `assertionMatches`, and the probe now imports it. The reason is not tidiness: a guard and the test predicate that judges it would otherwise be two copies of one honesty rule, and two copies drift — a trap this codebase had already been taught once by the Evidence Drawer.

**These guards are asserted deterministically and only *observed* live, deliberately.** The model may simply not volunteer a claim on a given run, so an asserted live check would flap — the failure mode that makes a suite's red meaningless. They are pinned with mocked answers in `narration-guards.test.js` (FM-GUARD-009/010/011) and FM-ROUTE-009; the probe reports whether they fired as an **observation**. On the 2026-09-18 run neither fired, and the transcript records why: the model volunteered nothing on those turns, which is not the same as a detector missing something.

**Gap two: nothing bounded the subject at all.** `EVIDENCE_TRUST_RULES` said only *"You are FleetOps dispatcher decision support."* An unrelated request — a poem, a basketball score — reached the narrated path and was answered from general knowledge; with the provider down, `fallbackAnswer` returned `evidenceSummary(evidence, message)` for any question. The prompt now states the boundary, and states **both** directions of its failure: an unrelated subject is declined rather than answered, but an in-scope question the evidence cannot cover is answered by naming what is missing, not by declining to discuss it. Over-refusal is the failure a scope rule invites, and it fails silently.

**The scope boundary is now deterministic at the route edge.** `classifyCopilotScope()` in `src/lib/dispatch/copilot-intents.js` separates courtesy, out-of-scope and in-scope messages. Direct FleetOps vocabulary is accepted; short follow-ups such as *Why?*, *What changed?* and *Compare them* are accepted only when the recent history contains an in-scope FleetOps turn or the request still carries active reservation/recommendation context. A previous unrelated turn resets that context, so it cannot make a later vague message operational. Courtesy and unrelated requests return a private `mode: "scope-only"` response before request loading, deterministic evidence, or the LLM provider. The response has empty operational fields and does not clear or replace displayed options, selected review, plan state, or evidence already rendered by the panel. `SCOPE_RULES` remains in the prompt as defense in depth; scope never decides availability, eligibility, ranking, evidence, assignment state, reservation state, or any other operational record.

Verification: `src/lib/dispatch/clause-polarity.test.js` (new, 6 tests) pins the matcher on the **verbatim live strings** already stored in `narration-guards.test.js`, including the refusal answers that must not match and the contrastive case (a refusal followed by `but` and a real claim). `FM-GUARD-009/010/011` pin the two triggers, their gating, and the refusal-is-not-a-claim case. `FM-ROUTE-009` grew two tests: a volunteering answer is guarded and logged once as `Flagged`, and a refusal is delivered **byte-identical** with no log record. `copilot-prompt.test.js` gained one assertion for the scope sentence, with the block count still asserted at ten. **Teeth proof:** forcing only the two new triggers to `false`/`null` in the route fails exactly the four new assertions and leaves 208 green — and the same check states honestly that FM-GUARD-010/011 do *not* fail under it, since they are false-positive regressions rather than teeth tests. Full suite **1859/1859 in 171 files**; the 8-file scenario scope **133/133 (124 ids)**; `ailogs` verified unchanged at 1230 → 1230 by counting around a real vitest run with `DATABASE_URL` genuinely exported. The live probe grew to **21 cases, 121 checks passed, 0 failed**, and the extraction changed no existing verdict. No live assignment was made; no schema change, no migration, no dependency, no commit.
