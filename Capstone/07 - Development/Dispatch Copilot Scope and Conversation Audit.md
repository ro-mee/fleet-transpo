# Dispatch Copilot scope and conversation audit

2026-09-15 — research only. Application code was not changed. Source inspection and user screenshots; no authenticated live recommendation payload or database diagnosis was performed.

## Implementation follow-up — 2026-09-15 (pre-filtered transparency + always-English)

RS-KXIH diagnosis (above) showed the blind spot is structural: the SQL
candidate pre-filter drops status/capacity failures with no recorded reason, so
neither the panel nor the Copilot can explain them. Implemented:

- `fetchCandidates` (`dispatch-recommendation-preparation.service.js`) runs a
  second cheap query for same-category, non-deleted vehicles failing the
  status/capacity pre-filter, with engine-identical reasons via pure
  `prefilterReason()` (seats wording wins on double failure, mirroring the
  engine's check order). Deleted rows stay hidden.
- `buildDispatchRecommendation` (`dispatch-advisor.js`) merges them into
  `none_reasons` flagged `prefiltered: true` (deduped against engine skips);
  `pairs`/`recommended`/`considered` untouched, so the queue planner and assign
  path are unaffected.
- Panel renders flagged rows as *"Checked briefly — …"* in "Why options were
  excluded" (open by default with no pair); conversation evidence carries the
  flag + plate, so "Why no match?" / "Other options?" / "What needs fixing?"
  all report them as excluded-with-reason, never as options.
- Prompt corrections: the wrong "select it on the request" vehicle advice is
  replaced with record-check next steps, and **the Copilot now always answers
  in plain English** even to Filipino/Tagalog questions (`CONVERSATION_STYLE` +
  conversation route instructions; prior language-mirroring removed).
- No migration; no new permissions; privacy unchanged (plate + status + seats).

Verification: 15 new/updated tests pass (preparation 6, advisor 3, conversation
4, conversation route 2); related suites 79/79 (planner, evidence, pair-scoring
48, queue-workspace); ESLint clean on all 8 touched files; production build
passed; live read-only run against request 502 confirmed ABC-1234 in candidates
and XYZ 5678 pre-filtered with "Vehicle status is Under Maintenance."
(No live assignment was made.)

Chat presentation refinement (2026-09-15): replies now request 2–4 conversational sentences by default, practical cause first, one next step, English/Filipino matching the question, and Philippine local pickup times. Avoid routine metadata dumps and repeated safety disclaimers; operational evidence rules remain unchanged. Plain-text normalization removes model bold markers. Chat follows the user's reference: left assistant/right user bubbles, immediate outgoing message, checking indicator, local-time message stamps, expandable evidence metadata, compact suggested chips and a bottom composer with send icon/character count. Enter sends; Shift+Enter creates a newline; IME composition does not accidentally send. Failed questions are restored for retry, duplicate sends are guarded, and new messages scroll within the chat without pulling users away from older messages. Five focused conversation tests passed; touched-source lint and production build checked. Browser appearance and live model wording still require manual acceptance because no browser provider was available in this session.

The findings below describe the pre-fix source. Implemented date-scoped planning through the existing planner: panel and queue actions use the selected reservation's Manila service date and label it explicitly; today's scope includes overdue, other dates use their own midnight-to-midnight interval. Existing signed plan tokens now include window metadata. Scope-aware counts retain evaluated/total and dependency/partial indicators. No new snapshot or token mechanism.

Restored exclusion reasons and distinct missing/error/vanished-selection messaging, removed unconditional Live/checks-passed/downstream-verified claims, removed fallback to obsolete planned pairs, and gated queue confirmation on current token validation and matching proposal. Failed queue analysis is visible and disables confirmation. Request switching is ignored during assignment/uncertain-outcome reconciliation; default pair identity is pinned. Existing required review and server assignment checks remain.

Added Ask Copilot with free-text English/Filipino questions, contextual prompt shortcuts and local conversation history, available even without a recommendation. New read/recommend-guarded POST conversation route loads current deterministic evidence, uses an explicit coordinate-free projection and the existing LLM adapter, and returns plain explanatory text only. No mutation tools or model-generated action execution. Questions are limited to 1,000 characters, eight recent history messages, ten requests per minute through the existing limiter, and a 12-second provider timeout. Existing AI usage logging is reused. No new dependency or migration.

Conversation answers show their own existing evaluation timestamp and explicitly do not renew the confirmation card. Provider unavailability falls back to recorded evidence with an explicit limited-conversation label. Conversation history is isolated strictly per reservation: each booking (keyed by `requestId`) maintains its own independent conversation thread in an in-memory pub/sub map and `sessionStorage` (`fleetops_dispatch_copilot_convo_map`). Conversations never bleed across reservations (selecting a different reservation displays only its own conversation or a clean welcome prompt), and returning to a previously viewed reservation immediately restores its private chat. The header provides an active context indicator (`Context: #RS-xxxx · Guest`) and a selective reset control (`Clear memory`) that wipes only the active reservation's conversation. Operational context excludes raw driver records, standby coordinates and plan tokens from the provider payload. Unknown evidence does not become verified through chat.

Verification: full Vitest 121 files / 1,194 tests passed; touched-source ESLint clean; route auth audit 267/267 passed; production build passed. Added tests cover Manila date boundary/invalid date, selected date propagation, exclusion/privacy projection, conversation permission/input validation and provider fallback. Browser inventory returned no providers; visual interaction and real-provider responses remain unverified. No live assignment was made and Maria Clara's exact database exclusion is not claimed resolved without reviewing her response.

Manual checks: select the September 16 Upcoming request, click Analyze 2026-09-16, and verify the KPI date/scope and actual evaluation count. Read Why options were excluded. Type “Bakit walang recommended driver?” and a follow-up; expect a grounded reply or clearly labelled provider fallback. Expire/change a queue plan and confirm assignment remains disabled until valid reanalysis. Check error handling, narrow-layout scrolling and request switching during submission before operational acceptance.

## Implementation report review - 2026-09-15

Implementation follow-up: [[AI Recommendation Panel Improvement Plan]] is implemented. Chat now resolves captured selected-pair IDs against fresh evidence and exposes context coverage; the confirmation footer stays visible with explicit disabled reasons; the queue hook alone validates plans; detail is isolated from cached queue context. Ranking uses `score`, alternatives in queue mode are read-only, and dead dialog/callback code is removed. Verification: 69 tests across 10 suites, touched-source lint, 267 route guards and production build passed. Browser inventory had no connected provider; live provider/assignment and desktop/mobile interaction acceptance remain pending. The source-only findings below are historical where superseded by that implementation record.

Source-only review of the supplied implementation report; no application changes, tests, browser session, live provider or DB checks were performed in this review. Earlier verification counts belong to earlier implementation work.

- Highest-priority omission: chat receives request/message/history/planToken but no selected pair identity. The endpoint recomputes evidence and supplies its own recommended pair. "Why this pair?" can therefore describe a different pair from a manually selected alternative or queue proposal. Pass the displayed pair IDs as untrusted selection context, resolve them against fresh server evidence, and explicitly report changed/missing evidence. Ensure the selected pair remains included in the bounded evidence projection.
- Confirmation visibility: canAct excludes recommendation/plan-validation fetching and the footer is conditional on canAct. Routine polling can remove the action area. Keep its position stable, show the blocking reason and appropriate Recheck/Analyze action, and preserve existing freshness/assignment gates.
- There are two validation observers with separate timers, but the installed TanStack Query shares an in-flight promise. Exact doubling of HTTP traffic is not established. Consolidate ownership and measure network behavior before claiming a 2x saving.
- Alternatives suppressed in plan mode are a constraint to explain, not automatically a bug: arbitrary substitution must not reuse a token signed for another pair. Comparison can be read-only; an actionable change needs a valid replan or an explicitly supported individual workflow.
- Presentation suggestions: label the displayed pair as selected versus engine-recommended; describe match score as a ranking score, not confidence or probability of safe assignment; prioritize decision, blocker and next action above detailed evidence.
- The report's onTrip statement needs precision: the panel invokes it in an effect, although no supplied callback caller was found. Conditional render-time state updates alone do not establish a bug. The claimed assigned-status mismatch needs lifecycle-value verification and a reproducible case before being accepted as a defect.
- Evidence projection caps pairs at 12 and exclusions at 30 without explicit total/truncation fields. Include coverage totals so limited chat context cannot be described as an exhaustive fleet evaluation.

Suggested acceptance: select an alternative then ask why; compare queue proposal versus individual recommendation; let polling and token expiry occur during review; exceed evidence caps; exercise provider fallback, 409 conflict and uncertain-outcome recovery. These checks remain proposed, not executed.

## Confirmed findings

1. Scope mismatch: screenshot is taken September 15 with Upcoming selected and trips at September 16 01:00 and 02:00. buildDispatchPlan in src/services/dispatch-plan.service.js selects pickup_datetime strictly before next Manila midnight (plus overdue), excludes assigned resources and active dispatches. useDispatchPlan posts without a date/tab argument. Zero of zero is consistent with that scope; it does not describe the visible Upcoming reservations. Re-analyzing the same scope cannot include tomorrow's trips.
2. Two different operations look interchangeable: panel Recheck refetches one recommendation; Re-analyze calls the queue planner. Its success updates the plan cache/KPIs, not the selected recommendation query. The screen does not explain out-of-scope selected requests.
3. Misleading empty state: ai-recommendation-panel.jsx renders “No eligible fleet pairing currently satisfies all strict constraints for this window” whenever !pair && !query.isLoading, including error/unavailable-selection cases. It does not render pair.none_reasons even though dispatch-advisor/applyDispatchRadar retain exclusion explanations. This is a frontend diagnosis loss. The exact reason Maria Clara has no recommendation remains unverified; a 01:00 trip could encounter duty/pairing constraints, but that is a hypothesis, not an observed result.
4. Conversation absent: current component has no dispatcher question composer, chat state or send handler. Its textarea is exclusively the override reason. Existing recommendation narration is optional prose about an already computed pair; it is not a multi-turn conversation. The existing executeLlmCompletion adapter can be reused for language.
5. False reassurance: “Live” is unconditional; evidence details unconditionally say recorded checks passed; absent downstream results can fall back to “Downstream route evidence is verified.” These must reflect actual check coverage/freshness instead.
6. Stale selection risks: refreshed candidates can fall back to planProposal.pair if the pinned pair disappears. Default recommended pair is not pinned until explicit alternative selection. Parent passes plan token even for a selection with no matching proposal. canAct does not gate on queue validation failure. Server validation remains necessary, but these UI paths can display obsolete evidence or send incompatible scope and produce avoidable rejection.
7. Request-switch risk: parent selection remains enabled while the child submits/reconciles assignment, and disappearance from the page falls back to the first request. This can lose the visible submission/recovery context.

These are current-source regressions/omissions; previous passing build/test counts did not establish browser correctness or coverage of these user flows.

## Updated product requirement

User explicitly wants free-form dispatcher conversation, with contextual suggested buttons/options. This supersedes the prior suggested-questions-only/no-free-text design restriction. Preserve no chat-initiated mutations, no invented safety facts, existing deterministic engines, validated confirmation, privacy and RBAC.

The Copilot must remain usable when no pair exists: explain known exclusions, disclose missing evidence, accept follow-up questions and offer relevant corrective navigation. Do not hide the conversation behind canAct or pair presence.

## Recommended repair order

1. Restore trustworthy diagnostics before adding language: distinguish request outside analysis scope, successful evaluation with exclusions, incomplete evaluation, loading/error, stale evidence and vanished selection. Render existing exclusions and source-backed check results; remove unconditional reassurance.
2. Make analysis date explicit. Default to today; when Upcoming is selected, offer/select a concrete service date (for the screenshot September 16), not an unbounded “all upcoming” query. Extend the existing planner's input/date filter and include scope in its existing signed plan evidence and validation contract. Preserve its cap, partial results and protection of commitments beyond that date. Historical overdue scope must be stated explicitly rather than mixed into tomorrow silently. Label the controls “Recheck reservation” and “Analyze Sep 16 queue”; only use “Re-analyze” after an existing analysis. Show scope in KPI titles and selected-request context.
3. Add an always-visible composer (“Ask about this reservation or queue…”) and per-request conversation, with suggested prompts such as “Why no available pair?”, “Which checks failed?”, “Show alternatives” and “What needs to change?”. Scope conversations to reservation and selected analysis date; request changes must never reuse another request's answer as evidence.
4. Reuse existing LLM adapter through one permission-checked, read-only conversation endpoint for language understanding and explanations. Bound message/history sizes and provider duration; allowlist/minimize operational evidence and exclude standby coordinates, credentials and raw private records. Existing deterministic services remain the only operational evidence source; existing timestamps/tokens remain the freshness authority. Never trust client-supplied facts as verified or concatenate user text into SQL.
5. Support natural English/Tagalog questions and follow-ups rather than pretending keyword buttons are free chat. Answer known operational questions from authoritative facts; distinguish explanatory/general advice from evaluated evidence. Missing facts lead to an honest answer and relevant recheck action. If provider unavailable, retain structured diagnostics and clearly disclose limited conversational availability.
6. Chat cannot change decision states or assign resources. A question like “Assign this driver” may direct the dispatcher to explicit review controls, never execute it. Model text cannot authorize overrides or create arbitrary action buttons; UI actions remain an allowlisted mapping to current server-verified states.
7. Fix identity/scope/pending gates before rollout: disappeared selected pair needs recheck; old plan cannot substitute for current evidence; no token forwarded to unrelated individual selection; plan invalidation disables queue confirmation; keep request fixed while submit/reconcile is pending. Refreshing selected evidence after analysis must preserve scope and invalidate prior review rather than silently pick a replacement.

## Diagnosis: XYZ 5678 invisible on RS-KXIH — 2026-09-15 (live DB, read-only)

User report: Copilot evaluated only ABC-1234 for RS-KXIH (Okada Patron, Guest
Transportation) and knew nothing about XYZ 5678, the second vehicle in the
category. Verdict: **data root cause + code transparency gap**, not a
category-resolution bug.

Live rows:
- RS-KXIH (`request_id` 502): `requested_category_id` = 2 (Guest Transportation),
  1 passenger, pickup 2026-09-15T05:39Z (Tue 13:39 Manila), `fleet_status` Pending.
- ABC-1234 (`vehicle_id` 37): category 2, `Available`, 4 seats, fuel 10% → passes
  SQL filters → evaluated, then blocked on checks (Tue coding, registration, fuel).
- XYZ 5678 (`vehicle_id` 1): category 2, 5 seats, custodian driver 21 active, **but
  `vehicle_status` = `Under Maintenance`** → dropped by the `fetchCandidates` SQL
  pre-filter (`vehicle_status <> ALL('{Under Maintenance,Decommissioned,Registration
  Expired}')`, `dispatch-recommendation-preparation.service.js:76`), which records
  no reason. It never reaches the pair engine, so it is in neither `pairs` nor
  `exclusions` — the Copilot's "not evaluated" reply was correct given its evidence.

Follow-ups (not yet implemented): confirm whether XYZ 5678 is genuinely in the
shop (open `vehiclemaintenance` rows) or a stale status that `syncVehicleStatus`
should have cleared — completing its repair record restores it to candidates.
Code-side: surface SQL pre-filter drops with reasons in conversation evidence, and
fix the prompt's wrong "select it on the request" advice for vehicles (vehicles
are not selectable on requests).

## Acceptance

Reproduce Sep 15 Today=0 / Upcoming=2: explain exclusion before analysis; explicit Sep 16 analysis evaluates the two requests or reports its actual exclusions/partial result. “0 of 0” must never imply those two requests were checked. Recheck updates the selected request only. A no-pair state must show actual reasons and still allow chat.

Exercise expired/failed plan validation, removed pair, rapid request switching, delayed chat responses, missing downstream evidence, provider failure and absent permissions. Natural typed questions should return grounded answers; requests to bypass safety must not create mutations. Confirmation and 409/network recovery must retain existing safeguards. Browser validation is required; no claim of successful live fixes is made in this audit.
