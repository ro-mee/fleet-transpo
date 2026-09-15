# Dispatch Copilot Decision Workstation Plan

Status: IMPLEMENTED locally, 2026-09-14. Automated checks passed; browser and live database concurrency acceptance remain pending. The audited baseline below describes the pre-change implementation; the completion record documents the resulting behavior.

## Implementation completion record — 2026-09-14

- Reused the existing planner, radar, conflict detector, pairing/priority/workload engines, query cache, plan tokens and validated assignment path. No dependency, migration, LLM service or second freshness mechanism was introduced.
- Replaced the queue's expanded proposal list with a compact entry point and a right-side dialog (full width on narrow screens). It shows priority-ordered decisions, disjoint readiness/dependency/unevaluated counts, partial scope, shared candidate options and explicit reanalysis. The dialog is modal for existing focus-management behavior; the queue remains visible behind it.
- Reservation Info now hosts the shared decision view; its Assign action focuses that view. Queue confirmation wraps the same view in AiAssignDialog. Pair selection uses resource IDs; refresh/reordering cannot silently select another pair. Already-assigned requests link to dispatch continuity.
- Added deterministic four-state presentation, positive required-check coverage, ordinary warnings, route provenance and separate downstream commitments. Blocking evidence precedes missing evidence, which precedes review advice, which precedes ready status. Scores and confidence percentages never establish readiness. Service forecasts remain ranking/advisory evidence; elevated forecasts prompt review, and missing forecast basis displays unavailable.
- Existing strict conflict loading now verifies effective pairing, operational vehicle state, category, required capacity/compliance records and grounding incidents, and checks maintenance across days touched by the service interval. Failed evidence loading and incomplete evaluations fail closed. Selected-vehicle incidents participate in existing assignment revisions.
- Scheduled UNKNOWN now requires permitted explicit manual review. Missing required identity/capacity/compliance checks, hard conflicts, invalid standby eligibility and stale evidence cannot be overridden. Every force request requires a trimmed reason of 1–500 characters. Forced/reviewed metadata is accurate; the required assignment timeline event commits in the existing assignment transaction. Matching snapshots alone are consumed as accepted pair evidence.
- Existing 30-second foreground detail refresh and 10-second plan validation remain. Selection/focus rechecks evidence; an imminent existing scheduled-context boundary triggers a refresh. Existing expiry disables confirmation. Why questions use the displayed evidence without another request or clock. Queue impact uses the same cached and validated plan; shared options are not presented as proven conflicts or lost service.
- Confirmation requires review followed by one explicit assignment action. Existing singular/plural/message-only 409 responses appear with the rejected selection. Unknown network outcomes reload the request before offering retry. Success clears the queue plan and asks for reanalysis; it never auto-confirms another request.
- Preserved permissions and coordinate privacy. Copilot renders route provenance/ETA without standby coordinates; authorized operators can open the separate operations map. No embedded GPS radar, generic chat, free-form simulations, bulk apply or chat mutation was added.

### Verification and remaining acceptance

- Full Vitest run: 118 files / 1,180 tests passed. Regressions cover strict missing evidence, grounding incidents, cross-midnight maintenance and exclusive interval end, scheduled review requirements, override reason validation, decision precedence/expiry/service advice, and transaction-scoped audit failures. Existing planner/evidence/route tests remain passing.
- Production Next.js build passed (201 static pages); touched-source ESLint passed without warnings; route authorization audit passed all 266 exported methods.
- No browser provider is available in this session, so responsive layout, keyboard/focus interaction and two-tab user flows were not visually verified. No real assignment or live database concurrency exercise was performed. Automated mocks are not a substitute for that acceptance.

Manual acceptance with disposable test requests:

1. Open Reservations → Queue → Open queue decisions → Analyze queue. Verify scope, priority ordering, incomplete counts and dependency messages; no bulk confirmation should exist.
2. Open a ready root pair and check its request/resource identities, evidence, route/next-trip details and Why answers. Reorder or refresh recommendations: the chosen IDs must stay pinned. Review then confirm one pair; verify its dispatch/timeline and that queue reanalysis is required.
3. Use requests with missing capacity/compliance or a known overlap/grounding incident. Confirm remains unavailable. For scheduled unknown departure evidence with otherwise complete checks, explicit manual review and a nonblank reason are required; inspect the timeline metadata after confirmation.
4. Analyze in two tabs, change/assign a shared resource in one, then try the old decision in the other. Expect disabled stale state or server 409, preserved prior selection, and reanalysis without an automatic replacement. Exercise timeout recovery and verify no duplicate dispatch.
5. Check keyboard navigation and narrow layouts; read-only roles have evidence only, and roles without queue recommendation permission cannot analyze the queue. Confirm Copilot/network recommendation payloads contain no standby coordinates.

### Operational risks and rollback

Stricter required-data and scheduled-review gates intentionally reduce automatic readiness where source data is incomplete. Correct records or use the permitted documented manual-review path; never loosen hard gates to restore a green label. Strict incident/pairing evidence adds database reads to a bounded small-fleet planner; monitor latency and partial-analysis frequency before increasing its existing cap. The existing broad revision guard can reject unrelated fleet changes conservatively.

Rollback the presentation files as one UI change if usability fails, preserving the shared server validation and atomic audit corrections. No schema rollback is needed for this follow-up. Keep earlier PR 4.5/5 and unrelated local changes intact. Do not call the feature production-accepted until the manual/browser and real concurrency checks above pass.

## Recommendation

Placement follow-up: [[Dispatch Copilot Persistent Workspace Plan]] supersedes this note's modal-first queue layout with the user's reference composition: compact queue rows beside a persistent desktop Copilot. That follow-up is planned only; shared safety rules below remain in force.

ACCEPT decision-first support: the system analyzes, the dispatcher reviews evidence and explicitly confirms one pair. MODIFY chatbot placement into a collapsible queue decision panel and the same decision view in Reservation Info's existing recommendation area. Deterministic questions are secondary. Preserve FleetOps tokens and dense operational layout; no global floating chatbot or new visual system.

## Audited local baseline

Read root and nested AGENTS, latest SYSTEM context, Reservations, Assignments, Dispatch, AI Advisory, PR 4.5 and PR 5 notes, and current local source. The working tree contains modified and untracked PR 4.5/5 files; GitHub default-branch assumptions do not describe this checkout.

| Assumption | Finding and decision |
|---|---|
| Queue planner may not exist | ALREADY SOLVED locally: `dispatch-plan.service.js`, POST/PATCH dispatch-plan route, signed plan tokens and queue panel exist. It is bounded greedy with one-prior-pair repair, not a global optimizer. |
| Snapshot age is operational freshness | REJECT. Snapshots have `generated_at`, `valid_until` (60 minutes), `is_consumed`, `consumed_at`. Current recommendation GET recomputes and does not serve snapshots as safety authority. POST persists snapshots and can update request estimates. |
| `evaluatedAt` is hypothetical | ALREADY SOLVED: `applyDispatchRadar` sets it, plus `policyVersion` and evaluation counts. Pairs have context/evidence expiry and, where applicable, proximity GPS/route timestamps and expiry. |
| One existing expiry field covers everything | MODIFY. Plans use `generatedAt`/`expiresAt` (maximum 60 seconds, earlier evidence can win), GPS freshness is 90 seconds, and internal assignment evidence lasts at most 30 seconds. Use these existing scopes; add no Copilot TTL, snapshot table or token scheme. |
| Override reasons are optional | PARTLY FALSE locally. Immediate/reposition unverified evidence requires force plus a nonblank reason. Hard conflicts are always rejected. Scheduled UNKNOWN currently bypasses that unverified gate; force on otherwise accepted work does not universally require a reason. |
| Every 409 contains conflicts[] | FALSE. Hard checks return `conflicts[]`; pair checks return singular `conflict` including possible `reviewable`; stale tokens/evidence use `error`/`code`; lifecycle conflicts can be message-only. `apiFetch` already preserves status, code and data. |
| A positive checklist is proof of full coverage | FALSE. Radar exposes hard findings but drops ordinary warning findings. Missing/zero capacity is not rejected by current positive-capacity comparisons. Some absent compliance data does not generate a conflict. The dialog also renders a broad green statement when request conflicts are empty. |
| Maintenance/incident checks fully support proposed wording | FALSE. Maintenance conflict checks cover the pickup calendar day, not every day touched by the service interval. Incident grounding exists, but recommendation payloads do not expose an explicit negative incident check. A status projection alone cannot prove all incidents were checked. |
| Detail contention is already available | FALSE. Planner computes scarcity and checks tentative commitments internally, returning proposal dependencies. It exposes neither a full contention explanation nor proof that a particular resource is another request's best option. |
| Management can use queue analysis read-only today | FALSE. Detail recommendation GET requires read; queue analysis/validation also require recommend, which management lacks. Queue navigation excludes management. Preserve that boundary. |

Important current defects to address in the shared path: `forced` is computed from hard blocking findings after those already returned 409, so review overrides can be mislabelled; successful responses likewise report the wrong warning set. Scheduled UNKNOWN can be accepted without explicit review. Pair selection is stored by array index, allowing a periodic reorder to change the selected pair. `evaluation.evaluated` counts started checks, not necessarily successful complete checks. Snapshot consumption does not prove the selected pair matched the snapshot. Comments describing hard-conflict bypass are stale.

## Architecture and data flow

1. Existing request preparation resolves estimates and eligible custodial/substitute pairs, scoring and workload.
2. Existing conflict, schedule, compliance, grounding and route-feasibility functions evaluate the selected pair. Extend their existing output with explicit check coverage and advisory findings; do not calculate rules again in React.
3. Existing planner overlays tentative commitments for queue scope, reuses the same evaluator and retains bounded evaluation diagnostics.
4. One small pure decision mapper consumes those outputs for queue/detail presentation and server confirmation eligibility. Each check is verified, advisory, missing, blocking or explicitly not applicable; include source/type and existing timestamps/reference IDs where available.
5. Shared decision view displays the result, deterministic explanations and allowed actions. Existing assign endpoint remains the only confirmation path.

Retain the current rankers. Priority is derived from pickup time, overdue, VIP/emergency and configured thresholds; fairness is pool-relative historical workload, not safety. Planner's ordered heuristic favors safety, priority coverage, served count, scarcity, travel, fairness and stable IDs. Do not promise identical queue and single-request picks: queue optimization considers competing work.

## Decision state, precedence and evidence contract

Decision state describes a particular pair or a scoped request analysis. It is separate from freshness, lifecycle, completeness and queue dependency. Loading/error/assigned are not forced into four operational states.

Freshness uses existing evaluation/expiry metadata. Expired evidence, invalid plan revision, failed refresh or changed selection/request disables confirmation and labels previous findings historical. It does not assert a new current BLOCKED decision.

For current evidence, apply this precedence:

| State | Deterministic rule |
|---|---|
| BLOCKED | Known non-reviewable conflict; `feasibility.verdict === INFEASIBLE`; invalid designated/substitute pairing; known non-dispatchable vehicle/driver; or immediate `STANDBY_NOT_VERIFIED`. Reviewable `dispatch_evidence` errors are excluded despite their legacy `severity: blocking`. |
| INSUFFICIENT_DATA | No known hard blocker, but required inputs/checks are missing, failed, stale or unevaluated; route UNKNOWN, unqualified needed GPS, unknown preceding origin/service end, or required downstream leg unavailable. Scheduled mode does not require GPS, but cannot claim verified departure without credible planned-origin evidence. |
| REVIEW_REQUIRED | Required checks are complete and no hard blocker exists, but route TIGHT or a current applicable advisory requires attention. Also use a separate queue review reason for unresolved provisional placement; shared-resource candidacy alone is not a physical conflict. |
| ALL_CLEAR | Complete eligible pair; positive required check coverage; evaluated SAFE plus VERIFIED; current evidence; no hard/missing/actionable advisory findings. Display **Ready for confirmation**, scoped to recorded evidence, not ALL CLEAR in large unqualified text. |

Known hard blockers outrank concurrent unknowns, while all findings remain visible. Empty findings, high score/confidence, an Available label, or old checklist do not prove ALL_CLEAR. Low/missing rating or fairness history never blocks safety; display unavailable ranking evidence neutrally. Low fuel/service-risk advice remains advisory unless an existing hard rule independently grounds the resource. Do not treat every `detected_risks.level=high` as a hard conflict: some describe present status rather than future-window eligibility.

Required check coverage: valid request time/requirements and resolved duration; known sufficient seating and required category; valid effective pairing; driver duty/leave/license and vehicle compliance; full service-window resource conflicts/maintenance; relevant blocking incidents; incoming and independent driver/vehicle downstream feasibility. Successful zero-result probes are distinguishable from unloaded/failed probes. Where no next dispatch exists after a successful query, show 'No next assigned trip found', not an invented zero or slack figure.

A request is not globally BLOCKED just because one candidate fails. Require completed relevant candidate coverage and explicit exclusions to say 'No eligible pair found in this analysis.' Budget exhaustion, an empty filtered pool without diagnostics, or greedy placement failure cannot prove that no fleet solution exists. A verified dependent proposal is not ready for immediate confirmation; display 'Waiting for preceding request' separately. Partial candidate exploration does not erase fully verified chosen-pair safety, but removes any 'best across the fleet' claim.

## Queue behavior

Replace the long standalone proposal list above the queue with a compact summary and expandable side panel on wide screens; use a full-width sheet on narrow screens. Keep queue scanning space and selection visible. Same existing analysis window: today through next Manila midnight plus overdue, all pagination, maximum 30 prepared requests and 25-second evaluation budget. Fixed future commitments remain protected. The deadline does not cancel setup queries or started I/O.

Counts: ready root proposals, review required, blocked within evaluated scope, insufficient data, waiting dependencies, and not evaluated. Deduplicate the primary buckets and show completeness explicitly. Do not call provisional suggestions '8 scheduled safely'; assigned totals are separate persisted queue facts. Partially assigned requests are currently excluded by the planner's both-IDs-null filter; disclose this scope and direct them to detail.

Order attention by existing priority and pickup time. 'Review next decision' chooses a currently actionable root; it does not skip an overdue blocked request silently. Keep urgent unresolved work visible. Exact future assigned counts must come from existing queue facts, not planner servedCount.

After assignment, immediately invalidate the old plan and related request/recommendation/dispatch/timeline queries. Show success plus **Re-analyze queue**. Choose explicit reanalysis over proposal 1's unconditional 'Queue recalculated': bounded provider work may take time or fail. Never auto-confirm the next request. While reanalyzing show progress, then disclose new partial results or failure.

## Reservation Detail behavior

Evolve the existing inline AiRecommendationPanel into the shared decision view. The page's Assign action focuses/opens that view rather than maintaining a duplicate independent recommendation experience. Queue review can continue using AiAssignDialog as its wrapper, simplified to compact request context plus the same view. Pin pair by IDs, never by sorted array index.

Order: recommended pair and operational state; freshness; highest-impact blocker/missing item; verified/advisory/missing check groups; incoming/passenger/next-trip evidence; alternatives; Why questions. Keep full details expandable, with primary review/confirmation reachable.

Expose existing `pickupBufferMin` as slack before latest safe departure, already net of safety buffer. `turnaroundMin` is remaining time after repositioning, not necessarily net of safety buffer. `expectedArrival` in route feasibility is arrival at destination, not pickup arrival. Do not relabel these as the proposal's invented metrics. Retain all evaluated driver/vehicle next-trip results, not just the current worst verdict, to explain two different downstream commitments accurately.

Show scheduled origin assumptions rather than current GPS. Existing assigned requests display committed resources and dispatch continuity, not a fresh unassigned 'ready' card. Authorized reassignment goes through the existing reassignment workflow.

## Contextual actions and deterministic Q&A

| Context | Actions |
|---|---|
| Current ALL_CLEAR root, authorized | Review & confirm; alternatives if present; Why this pair |
| REVIEW_REQUIRED | Review warning; eligible alternative if verified; explicit review acknowledgment only where server permits |
| BLOCKED | View actual conflict; inspect existing alternatives; link to permitted corrective workflow; recheck after correction; no confirm |
| INSUFFICIENT_DATA | Retry relevant evaluation; view missing fields; existing manual-review path only for explicitly reviewable route/departure uncertainty |
| Stale or refresh failed | Recheck; view previous decision labelled historical; no assign |
| Queue dependency | Review preceding request; reanalyze after confirmation; no dependent confirm |
| Already assigned | Open dispatch/timeline; existing permitted reassignment |
| Read-only | Evidence and Why; no mutation actions |

Use suggested questions, not a free-text box promising general intelligence. Templates: why this pair (pairing/reasons/workload), why not a named evaluated alternative (structured exclusion), can it reach pickup (verified ETA/provenance), next-trip impact (each protected dispatch), why urgent (existing priority derivation), contention (current planner diagnostics). Bind each answer to request/pair and the evaluation already on screen. Missing answer -> 'Not evaluated' plus relevant recheck. No separate Q&A endpoint, snapshot or routing call per question. No arbitrary what-if simulation in v1.

Optional future LLM: reuse existing adapter only to rephrase allowlisted deterministic facts. Nullable and nonblocking; no safety state/action authority, tools, new model service or coordinate/raw employee context. Current narration is an extra recommendation evaluation, so do not combine its newer facts with an older decision as if they were one evaluation. Deterministic Q&A remains fully useful without it.

## Confirmation, freshness and 409 recovery

Single explicit confirmation presents pinned request/pair and decision context. Reuse existing assignment mutation, permission enforcement, live conflict/pair checks, revision-guarded transaction and database safeguards. Preserve queue plan token for queue-derived actions. Never silently remove it to bypass a stale rejection or silently substitute an alternative.

Do not animate individual checks as passed while the endpoint only returns final success. Show 'Rechecking and assigning'. On success show actual committed pair and dispatch link. On timeout/unknown network outcome, reload request/dispatch first; do not retry blindly or claim no assignment happened. Lifecycle bookkeeping and post-commit audit/side effects are not all within the final guarded transaction.

Normalize existing 409 forms into an inline recovery panel: previous pinned decision; returned conflicts or message/code; recheck action. `STALE_DISPATCH_PLAN` invalidates queue, `STALE_DISPATCH_EVIDENCE` invalidates pair evidence, non-reviewable conflict removes confirm, and reviewable evidence opens the explicit review path. Re-fetch before offering a replacement and require new review. Do not invent who changed a resource, an event timestamp, or '18 seconds later' from a hash mismatch. Preserve rejected evidence when closing/invalidating the old dialog instead of losing it to a toast.

Snapshot valid_until is only audit-record expiry. Render live evaluatedAt and existing relevant expiry; compute display freshness from those fields without creating a persisted Copilot clock. Existing 30-second foreground detail refresh and 10-second plan validation can remain initially. Recheck on focus/selection/expiry. Reaching the existing context boundary should refresh scheduled/immediate context. Failed background refresh must remove current-ready presentation even if cached data remains visible. Avoid resetting expiry when answering Why.

## Override and audit changes

Require a trimmed, bounded nonblank reason for every `force:true` request server-side; reject blank input explicitly, not through a vague feasibility message. Force cannot bypass hard conflict, required identity/capacity/compliance data, stale token, invalid pairing or missing standby eligibility. Scheduled UNKNOWN currently accepted without review is a real hardening change: require explicit review for permitted departure/route uncertainty, retaining INSUFFICIENT_DATA on screen. TIGHT follows the existing reviewable-evidence path when applicable. Plain advisory acceptance is distinguished from an override.

Return an explicit server reviewability signal from the shared evaluator; UI never invents it. Disable override submission until the reason is valid. Use 'Confirm after manual review', not 'Override AI'. A dependent/nonverified queue proposal is not signed for assignment: review it in the normal detail workflow with a clear scope change, rather than repurposing its token.

Correct existing event metadata to record actual review/force usage, acknowledged findings, selected pair, evidence/policy timestamps, reason and actor. Extend existing reservation event/audit records; no audit table. Record whether an existing snapshot matches the selected pair before calling it accepted; consumption is not acceptance evidence. Include a nonsecret plan reference when available; never raw signed tokens or GPS coordinates. Preserve required assignment event auditability across transaction/post-commit failures; report uncertain response outcomes accurately.

## Contention

Reuse the planner's prepared candidate sets and actual tentative feasibility trials. Expose bounded diagnostics with resource IDs, affected request IDs, relation (shared option / tested conflict / predecessor dependency), evaluated scope and reasons. A shared candidate alone means potential competition, not confirmed overlap or lost service. Only claim that assigning A reduces B's options when an existing evaluated trial proves it. No new optimizer, graph service or arbitrary simulation.

Detail opened from queue reuses the current plan in the existing query cache and validates the same token; no persistence/localStorage. Detail opened directly says queue impact not analyzed and offers existing queue analysis to authorized users. Display not-in-window/cap-excluded status explicitly. Do not run an entire queue analysis on every detail mount or Q&A click.

## Implementation slices and reuse

1. Shared evidence contract and safety corrections: expose successful/missing checks and warnings; preserve evaluation errors and exclusion reasons; use existing grounding predicate in conflict loading; extend maintenance overlap from pickup day to known service interval using existing calendar semantics; ensure selected vehicle incidents participate in existing revision coverage. Harden required-data/review gates in the existing validator. No separate Copilot conflict engine.
2. Pure decision mapper and shared view: reuse AiRecommendationPanel/AiAssignDialog, ConflictBlock, existing feasibility view, status tokens and TanStack Query. Remove empty-conflicts green claims, safety confidence display, index-based pair selection and duplicate action areas.
3. Confirmation/409/override audit fixes in existing assign route, recommendation/evidence services and transport client. Preserve APIs compatibly while normalizing response details.
4. Queue summary/contextual actions and bounded contention diagnostics in existing planner/API; reuse current signing and freshness. Add deterministic question templates over returned facts.
5. Acceptance and documentation. No schema migration expected; if an unexpected schema change is needed, follow repository migration policy separately.

## RBAC and privacy

Keep current permissions: detail read, analysis read+recommend, assignment assign; management gets detail evidence only under current access, not new queue analysis privileges. All corrective links respect their own permissions; a dispatcher cannot edit custodial assignments just because the Copilot mentions a missing substitute. Read-only Q&A has no mutations.

Explicitly allowlist returned decision/answer fields. No standby coordinates, position objects, tokens/session details or raw incident narratives. Existing separate radar stays separately authorized and opt-in; no coordinate exception inside Copilot even for tracking-privileged users. Present incident IDs/restriction facts without sensitive descriptions.

## Tests and acceptance

- Table-driven mapper cases: each state, hard+unknown precedence, reviewable legacy blocking severity, missing capacity/license data, expired SAFE, scheduled UNKNOWN, TIGHT, warning policy, zero vs failed probes, no next trip, incomplete candidate search, dependent verified proposal and non-actionable lifecycle.
- Shared safety regressions: cross-midnight maintenance and fixed/tentative commitments; separate driver/vehicle next trips; failed grounding/status drift; request changes during confirmation; review reason validation; no forced hard bypass; expiry/revision locking.
- Planner diagnostics: deterministic unchanged ranking, shared option versus proven contention, cap/deadline scope, no false fleet-wide impossibility, no dependency confirmation, no assignment/notification/alert writes during analysis.
- UI/API: ID-pinned choice across refresh reorder, freshness expiry/focus/context change, structured/singular/message-only 409, preserved rejected evidence, timeout reconciliation, no auto-submit after reanalysis, warning audit, read-only/RBAC and coordinate-leak tests.
- Browser acceptance: wide and narrow queue/detail, keyboard/focus restoration, dialog accessibility, all four states, failed providers, two-tab resource change, one confirmation followed by manual reanalysis. Real isolated DB race test for simultaneous dispatchers; mocked unit tests are not live concurrency proof.
- Run focused tests first, then full suite/build/auth audit; preserve existing unrelated local work. No application tests or live database queries were run for this planning-only task.

Risks: whole-fleet invalidation can be frequent with standby updates; 30-request/25-second bounds limit completeness; stronger evidence requirements may lower ready counts; uncertain scheduled origins are common by design; shared gate hardening affects non-Copilot callers. Do not hide these with green states. Separate UI and shared-safety commits: rollback UI to current panel while retaining validated server safety/audit fixes. No new feature-flag system needed.

Explicitly excluded: chat mutations, Apply All, safety percentages, second recommendation/conflict/freshness/snapshot system, new LLM service, automatic confirmation, always-on queue optimization, full contention graph, manual coordinator cross-checking for data already loaded, and unrelated mobile/design-system changes.

Research performed by the primary assistant; no custom/sub-agents invoked for this planning task. Impeccable shape guidance used for operational UX; Ponytail principles used to limit new machinery. Historical 1,173-test result belongs to the preceding PR 5 implementation, not a new test run for this plan.
