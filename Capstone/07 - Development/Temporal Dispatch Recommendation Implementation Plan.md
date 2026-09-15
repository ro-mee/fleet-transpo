---
type: implementation-plan
status: implemented-locally
created: 2026-09-15
related: ["[[AI Advisory]]", "[[Reservations]]", "[[Queue Only Dispatch Copilot Implementation Plan]]", "[[AI Architecture]]"]
---

# Temporal Dispatch Recommendation Implementation Plan

## Outcome and scope

FleetMate recommends up to two eligible driver-vehicle pairs using evidence relevant to the reservation's pickup time. It explains the actual reliability/workload trade-off, lets the dispatcher choose and review a pair, and revalidates before assignment and operational dispatch.

The core implementation is complete locally; the original design and planning record are retained below. See the implementation record for verification and remaining acceptance work. Preserve the existing Reservation Queue aside/mobile drawer and FleetOps visual language. This extends [[Queue Only Dispatch Copilot Implementation Plan]]; its pinned-choice queue authorization is a dependency for choosing alternatives. The natural-language action phase below deliberately extends that earlier plan's read-only chat boundary.

## Existing foundation and gaps

| Area | Current source evidence | Required change |
|---|---|---|
| Temporal location | `src/lib/dispatch/location-relevance.js` already separates SCHEDULED, REPOSITION and IMMEDIATE; default short-notice horizon is 90 minutes | Add explicit reservation horizon metadata without replacing these per-pair origin modes; thread resolved saved policy instead of direct defaults |
| Candidate preparation | `dispatch-recommendation-preparation.service.js` loads pairings, schedules, leave and rolling 7/30-day completed workload without current GPS fields | Add service-date planned/actual workload and schedule evidence |
| Feasibility | `dispatch-radar.service.js` checks previous/next commitments, standby/GPS and routes before final candidate selection | Preserve long schedule gaps for explanation; evaluate release/position and readiness using temporal evidence |
| Eligibility | `conflicts.js` and `validatePairAvailability` enforce current pairing, capacity, leave, compliance, maintenance and assignment checks | Reuse these checks; unknown required evidence cannot become a green check |
| Ranking | Pair scoring contains weighted fairness/designation; radar and queue planner also order candidates | Apply one reliability-sufficiency comparison consistently at final selection, including queue repair |
| Conversation | `conversation.js` projects selected-pair evidence but combines proximity/expected-route minutes and lacks structured temporal/workload trade-offs | Preserve provenance and expose the actual comparison decision |
| Assignment | Existing assign route revalidates; `useDispatchPlan` validates signed plan evidence every 10 seconds | Add boundary-triggered reanalysis, selection-safe refresh and dispatch-time revalidation |

The working tree already contains extensive ongoing changes. Recheck callers and file existence before implementation; the inspected panel imports `copilot-option-flow` and `copilot-options`, which were not both available during this inspection. Do not treat this planning pass as a clean build baseline or overwrite parallel work.

## 1. Define one temporal contract

Compute context on the server with an injected `now`, UTC instants and Asia/Manila calendar dates. Proposed defaults reuse existing policy: near-dispatch horizon = 90 minutes; last-minute operational urgency = 30 minutes (`highMinutes`). Keep these configurable through the existing policy validation/storage, not new settings infrastructure.

Evaluate in this precedence order:

| Context | Rule | Card evidence |
|---|---|---|
| Invalid/inactive | Missing pickup, cancelled/completed or otherwise nonactionable | Explain actual state; no actionable recommendation |
| Overdue | Pickup is in the past and still actionable | Explicit overdue warning and fresh operational feasibility; never roll pickup forward silently |
| Last minute | 0-30 minutes until pickup | Current availability, qualified GPS, live routed pickup ETA, active-trip progress and constraints |
| Near dispatch | More than 30 and up to 90 minutes, or a trusted planned departure is due | Verified readiness, current/releasing-trip evidence and live ETA when justified |
| Same-day planning | Outside near horizon, pickup on today's Manila date | Schedule fit, predicted release/positioning, planned turnaround and workload |
| Future planning | Outside near horizon, pickup on a later Manila date | Schedule/leave/maintenance/compatibility, previous and next bookings, planned workload |

Near-midnight bookings use elapsed time before calendar-day grouping. A booking created days ago can become last-minute operationally; only call it a newly made last-minute booking if its recorded creation time supports that claim.

Keep reservation horizon separate from candidate origin: a near-dispatch candidate still serving a trip uses its predicted release/destination, not an idle standby pin. A far-future candidate can have a planned repositioning leg without any live-location claim. A known earlier planned departure can promote operational evaluation for long journeys.

All cards and narration use this contract. Future planning neither fetches nor ranks on today's GPS or traffic. Date-specific route estimates are allowed only with supported departure-time provenance; otherwise label them as estimates or unavailable. Do not imply today's traffic predicts Sept 18.

## 2. Build truthful schedule and workload evidence

Extend existing candidate/evaluator payloads with compact fields, rather than introduce a second recommendation store:

- `temporalContext`: horizon, pickupAt, serviceDate, evaluatedAt, nextBoundaryAt, policyVersion.
- `scheduleEvidence`: previous driver/vehicle commitments, expected release and source, raw gap, estimated transfer minutes, required preparation minutes, usable slack, next-commitment slack and uncertainty.
- `workloadEvidence`: serviceDate, completed trips, in-progress trips, remaining scheduled trips, planned service minutes, recorded driving minutes and existing recent-history index; include coverage and source.
- `decisionEvidence`: reliability band, decisive reason code, compared pair IDs, supported differences, trade-off and secondary preference.

Reuse existing feasibility fields where their meaning matches. Avoid two fields with different definitions of the same buffer.

### Buffer definitions

- **Schedule gap** = pickup time minus expected preceding release time. Sept 18 16:40 to 18:30 is a 110-minute gap.
- **Usable preparation slack** = schedule gap minus estimated transfer time minus required preparation/safety allowance, applied once through the shared policy.
- **Projected pickup margin** = pickup time minus predicted arrival at pickup. With 45 minutes remaining and a fresh 19-minute route, arrival is approximately 26 minutes before pickup. This differs from net slack after a safety allowance.

Do not label raw gap as verified on-time readiness. Check both driver and vehicle histories; different prior trips need separate resource release/position evidence. Evaluate the next commitment too. Do not discard a 110-minute preceding gap because the current short-notice cutoff is 90 minutes. No previous trip means “No preceding booking recorded,” not infinite buffer. Missing end time, uncertain active-trip release or unknown transfer is explicitly unverified.

Use recorded completion for completed trips, schedule estimates for future trips, and qualified progress estimates for active trips. An overdue active trip cannot be assumed finished because its scheduled end passed.

### Workload and fatigue

For Sept 18, show “3 scheduled trips on Sept 18,” not “3 trips today.” For today, separate completed, active and remaining planned work; count a dispatch/trip association once, exclude cancelled/deleted records and keep uncommitted queue proposals distinct from fixed work. Use duration and recent workload alongside counts when available. Count zero only after a successful complete query; missing history remains unknown/neutral.

Shift/leave and standby presence already exist; a complete duty/rest ledger and approved fatigue thresholds are not established by this inspection. Driving duration is not total duty time, and check-in duration alone is not a reliable duty ledger. Never invent “8 hours on duty” or “fatigued.” Reuse known shift limits as hard constraints. If full duty-limit enforcement is required, first establish authoritative duty/rest records, policy thresholds and coverage; enforce the projected assignment against those limits in shared eligibility. This is a separate data-dependent delivery step, not a prerequisite to honest workload comparison.

Maintenance is currently evaluated with calendar-date records. Respect those semantics; do not invent hourly maintenance release times. Say “No recorded maintenance/leave conflict for this window” only after the applicable checks succeed.

## 3. Replace unlimited score advantages with sufficient reliability

Use a deterministic comparison after hard eligibility and feasibility, not LLM selection or an arbitrary percentage:

1. Exclude hard failures. Unknown required evidence stays needs-verification; preserve existing narrowly permitted manual review.
2. Protect fixed bookings, resource compatibility and higher-priority queue coverage.
3. Compare reliability bands from usable pickup/next-trip slack and evidence quality: sufficient, tight, unknown, infeasible. Reuse SAFE/TIGHT/UNKNOWN/INFEASIBLE semantics; document any mapping change.
4. Prefer sufficient reliability over tight timing. Within the same sufficient band, stop rewarding extra unused buffer. With comparable supported evidence and no material efficiency disadvantage, prefer better workload distribution.
5. Treat efficiency as material only with relevant routing evidence. Proposed initial tie band: a transfer difference of at most 10 minutes is comparable; above it prefer the lower transfer burden, with an explicit reason. This is a tunable operational assumption, not a measured risk threshold. Future cases with unknown origins cannot use this tie-breaker or claim equivalent efficiency.
6. When workload/efficiency cannot distinguish candidates, retain applicable standing-pair preference and stable IDs for reproducibility. Existing valid-custodian/substitute eligibility remains mandatory; fairness never invents an arbitrary pairing. Remove the unconditional designation score dominance between otherwise eligible pairs where it contradicts sufficient-reliability fairness.

Extra buffer does not provide a continuously increasing bonus once sufficient. Known near-limit workload may influence comparison only with an authoritative metric; exceeding an applicable hard duty limit excludes the pair regardless of spare time.

Use the same comparison evidence in individual ranking, queue selection and repair. Queue scarcity/coverage may justify a different choice; disclose “Preserves coverage for another booking” with the affected request, rather than inventing an individual reliability reason. Limit claims to evaluated candidates if the cap/deadline prevents full coverage.

### Required example outcomes

Assume equal compatibility, next-booking feasibility and comparable efficiency; classify the supplied gaps using actual transfer and preparation evidence first.

| Scenario | Expected result |
|---|---|
| A 95m / 5 trips; B 20m / 2 trips; B has tight usable slack | A: larger verified timing margin outweighs lighter workload |
| A 95m / 5 trips; B 85m / 2 trips; both sufficient | B: better balance; extra A buffer gives no ranking bonus |
| A 105m / 5 trips; B 70m / 2 trips; both sufficient | B if other material factors are comparable |
| A beyond an established duty limit | Exclude A, regardless of buffer |
| A 105m raw gap but 100m required transfer/preparation | Never claim A is reliable from the raw gap alone |
| B workload missing | Do not interpret missing as fewer trips |

Use “Best schedule fit,” “Larger timing margin,” and “Better workload balance.” Remove headline 96%/88% claims. Any retained score in details must say ranking score, not probability, safety confidence or arrival guarantee.

## 4. Render dynamic options and grounded answers

Extend `ai-recommendation-panel.jsx` and existing option/conversation components after reconciling in-progress UI work. Preserve desktop aside, single mobile drawer and existing tokens.

- Show zero, one or two distinct eligible options; separate blocked exclusions from reviewable candidates. Never fill two slots with invalid pairs.
- Each option shows driver, vehicle/plate, decisive label, relevant timing/workload facts and visible concerns. Future card footer: “Based on the current schedule. Rechecked before assignment and dispatch.” Explain once: “Live pickup ETA is not shown yet because the vehicle's location near departure is not known.”
- Near dispatch, show check-in/completion/availability only when verified. Stale GPS/provider failure replaces ETA with “Live ETA unavailable,” without retaining an old ready claim.
- Supply structured horizon, raw gap versus slack, workload date/coverage, ETA provenance, winning rule and alternative advantage to `conversationEvidence`. A deterministic template must answer the main trade-off even during provider failure.
- Answer “Why A despite more trips?” with the actual compared values and deciding rule. If evidence changed since the displayed options, say so and show current results; never silently explain a different pair as the old Option A.
- Keep current Choose A/B actions accessible after an answer, bound to stable IDs and the current option set. Historical copies are inert. Choosing enters review, never immediately assigns. Keep one confirmation footer, keyboard support, focus feedback and polite status announcements.

## 5. Reevaluate without silently changing assignments

Extend the existing query/hook lifecycle; add no separate background service for the initial queue experience.

- While the selected workspace is visible, reanalyze at context boundaries, after relevant source changes, on expired evidence and on window focus/reopen. Reuse existing cache invalidation/revision checks and one polling owner; debounce changes and deduplicate concurrent work.
- Distinguish token validation from recomputation: the current 10-second validation poll alone does not generate a new recommendation. Fetch new evidence when invalidated. Bound refreshes by the existing route budget and stop background polling for hidden/inactive views.
- Expiry is the earliest of evidence expiry, token expiry and the next temporal boundary. Version signed evidence when context/ranking semantics change. Include relevant schedule, workload and policy revisions; changing the clock across a boundary also invalidates old authority.
- Pin a selected identity while refreshing. Changed evidence clears review; a disappeared candidate becomes unavailable visibly. Ignore obsolete request/date/pair responses.
- A future recommendation is advisory. A dispatcher-confirmed future assignment is a real existing assignment that reserves resources; no new “tentative assignment” lifecycle is implied. Recheck that committed pair at the operational dispatch/start path and report conflicts for dispatcher action. Never automatically switch it to a new winner.
- Trace dispatch create/update and mobile start callers before wiring the shared check. Exclude the assignment's own commitment from overlap evaluation, retain transaction/authorization guards and avoid re-running unassigned-queue ranking as start authorization.
- Closed-tab automatic fleet-wide alerts require a durable scheduled worker and delivery policy. Defer that separate service explicitly; opening/focusing and dispatch/start still perform current checks.

## 6. Support “Assign it” through the same action path

Implement after pinned choice, review and signed alternative authorization are working. Reuse `assignResources` and the existing guarded assign endpoint.

- Recognize a small explicit intent set (for example “choose option 1,” “choose option 2,” “assign it,” “change selection”) outside LLM prose. General chat stays explanation-only; quoted text, questions and model-generated content cannot trigger commands.
- Resolve A/B against the currently displayed option set. Resolve “it” only to an explicitly selected pair for the current request. With no selection, show current choices; do not infer authority from a historical favorite.
- Before review exists, “Assign it” opens the named confirmation summary. Once a current review is visible, a new explicit “Assign it” invokes the same submission handler as the named Assign button. A chat response never counts as confirmation.
- Bind intent to request, pair, current review/evidence and signed plan. Missing/stale authority triggers recheck and renewed review. Preserve required manual-review reason and permissions; chat grants neither.
- Prevent duplicate concurrent submission; use existing lifecycle/idempotency protections. On network ambiguity, refetch the committed request before retrying. On 409, invalidate authority and show the changed condition. Success updates queue caches and existing atomic audit/timeline records, including action source if supported.

## Delivery sequence and verification

1. **Policy/evidence:** implement context, consistent resolved settings, full schedule-gap evidence and service-date workload. Read installed Next.js guides before route/page edits. Prove future requests do not select current GPS or call current-traffic routing as future evidence.
2. **Ranking:** implement the shared sufficiency comparator and machine-readable reasons across individual/queue/repair paths. Keep assignment constraints unchanged and add the scenario table as executable cases.
3. **Cards/conversation:** render temporal facts and deterministic comparisons. Prove two/one/zero options, missing data, source provenance, correct Manila dates, provider outage and keyboard/mobile behavior.
4. **Refresh/commit:** integrate context-boundary expiry, changes/revisions, selected-choice pinning and operational pre-dispatch checks. Prove midnight, exactly 30/90 minutes, overdue, changed leave/maintenance, active-trip overrun, self-exclusion, nondefault saved policy, next-trip conflict and racing assignments.
5. **Chat actions:** finish selection-bound commands after the queue-only plan's alternative authorization. Test ambiguous/quoted commands, no selection, stale review, duplicate send, wrong request/pair, permission failure, 409 and uncertain-result reconciliation.
6. **Optional duty data:** only ship fatigue/duty-limit claims after authoritative recording and policy are established; otherwise retain honest workload language.

Use installed Vitest and existing suites: location relevance, route feasibility, radar, dispatch plan/evidence, recommendation availability, conversation, panel and assign route. Add focused behavioral checks at existing seams, not source-string assertions alone. Run touched-source ESLint, `npm.cmd run verify:auth` and `npm.cmd run build` after implementation. Record preexisting build failures separately, especially incomplete concurrent UI files. Browser acceptance must exercise the actual desktop queue and mobile drawer; use designated test records for mutation checks.

No migration is assumed for the core feature: derive evidence from existing records and extend existing policy/payloads. If duty tracking or missing source fields require schema work, inspect migration filenames, add an idempotent unused migration, then use `db:up`, `db:dump` and live constraint/query verification under repository policy. Never hand-edit `schema.sql`.

**Definition of done:** future cards contain no current-location precision; both-safe candidates can favor workload; every recommendation and answer names supported evidence; selected alternatives retain correct queue authority; refresh never silently changes a choice/assignment; button and explicit chat confirmation share the guarded commit; dispatch rechecks the committed pair; unsupported signals remain visibly unknown.

## Planning verification record

2026-09-15: Read repository policy, the supplied interaction attachment, relevant reservation/assignment/advisory/architecture and queue-planning notes, and inspected local policy, candidate preparation, feasibility, conflict, ranking, conversation and assignment paths. Verified documentation patch formatting. No application tests, live DB checks, browser acceptance or production changes were performed for this documentation-only task. That record describes the planning pass; the implementation status below supersedes it.

## Unified conversation follow-up - 2026-09-15

The user's supplied conversation flow supersedes the separate review-click/two-Assign-it interaction described in the original design below. Copilot now presents the two options as separate assistant bubbles inside the same scrolling message log as questions, replies, selection checking and the assignment result. The composer stays in that conversation; the detached option/confirmation section and redundant technical disclosure were removed.

Typing an explicit option (Option 2, 2, choose option B, or pipiliin ko option 2) follows the same selection handler as its button. It records the user choice, pins its identity, automatically rechecks the signed queue choice and individual evidence, then presents the checked pair as the confirmation reply. After that reply is ready, the first explicit Assign it submits the same guarded mutation as the named Assign button. A pending/failed check, missing manual reason, stale authority or permission failure still prevents assignment; selecting never assigns. Rechecks do not execute queued confirmation commands.

Questions are allowed before selecting. The request sends displayed option IDs separately from selectedPair; the server resolves card numbers against current evidence and discards extra client fields. A question does not implicitly select Option 1. After answering without a selection, the conversation asks which option to choose and repeats current choice buttons. Quoted/ambiguous text and model replies remain explanation-only.

Assignment success preserves the conversation and result; the mobile drawer stays open. The queue retains the completed selected reservation for the success view after its row leaves the actionable list. No background automatic assignment or new permission is introduced.

Verification: 131 Vitest files / 1,280 tests passed, including event-handler checks for selection -> pending recheck -> first Assign it, failed checks and duplicate submission; touched-source ESLint passed; authorization audit passed (267/267); production build passed (201 pages). Browser inventory again returned no connected providers, so actual desktop/mobile visual and live-model wording acceptance remain pending. No database migration, live assignment or dependency installation was performed.

## Implementation record - 2026-09-15

Implemented the core policy, evidence, ranking, cards, refresh, guarded selection and explicit chat actions in the existing dispatch path. No new dependency or migration.

- Temporal v2 classifies Manila service dates, overdue/30-minute/90-minute boundaries and operational departure. Saved horizon, efficiency and preparation settings flow through evaluation; partial settings updates preserve existing values and validate the merged policy.
- Schedule evidence retains long preceding gaps, separates transfer/preparation/slack, protects both resources' next bookings, and uses recorded completion only as history. Active overruns do not become assumed release locations. Future routing carries a departure date; future requests never load today's GPS.
- Workload uses existing completed trips and fixed active/scheduled dispatches starting on the Manila service date. It reports counts and known service minutes, not duty duration or fatigue. Failed source reads remain unknown; zero requires a successful read. Recent rolling history remains available in upstream scoring, while the final sufficient-reliability tie uses service-date work.
- Shared final comparison puts hard/missing checks and timing reliability ahead of material transfer efficiency. Once both are SAFE and efficiency is comparable, lighter known service-date workload can win. Extra unused buffer earns no unlimited bonus. The existing bounded queue planner remains a heuristic, not a global optimizer.
- The two-option conversation flow shows temporal facts and grounded labels without probability claims. Option identity is pinned during refresh; unavailable choices and changed recommendations remain visible. Actual analysis drives progress, with no artificial thinking delay. Selected alternatives require v2 signed queue evidence and preserve baseline verified coverage. Manual review requires explicit signed manual authority and the existing reason/permission checks.
- Exact Choose/Change selection/Assign it commands share the button review and confirmation handlers. Questions, quotes, history and model prose never execute actions. Review binds current pair/evaluation/token/reason; late mutation results are ignored. Ordinary plan refresh can change the proposed pair, but never the pinned selection; a mismatch requires selecting/rechecking it before renewed review.
- Visible-workspace refresh uses expiry/revision checks and temporal boundaries. The trip-start path rechecks the committed pair, excludes its own dispatch/trip, and performs the existing start transition under revision/expiry locks. It uses only fresh, accurate GPS belonging to that trip and pair after the start-window gate; standby GPS is not required after mobile tracking switches to the assigned trip. Trip GPS participates in the start commit revision.

Verification: full Vitest suite passed (130 files, 1,265 tests); route authorization audit passed (267/267); production build passed (201 pages). Touched-source lint and focused checks were rerun after final presentation cleanup. The actual workload, previous/next commitments, owned-trip GPS and commit-revision SQL all passed against the app database inside BEGIN READ ONLY / ROLLBACK, without displaying record data. No live assignment or start was executed.

Acceptance limitations: no connected browser provider, so desktop/mobile keyboard, layout and live-model/provider acceptance remain pending. Closed-tab proactive alerts and authoritative duty/fatigue-limit recording remain deferred as designed. Source data must support departure and route evidence; an idle future candidate with unknown departure arrangements stays reviewable/unknown rather than receiving invented readiness.
