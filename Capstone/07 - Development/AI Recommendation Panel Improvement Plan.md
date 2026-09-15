---
type: implementation-plan
status: implemented
created: 2026-09-15
related: ["[[AI Advisory]]", "[[Dispatch Copilot Scope and Conversation Audit]]"]
---

# AI Recommendation Panel Improvement Plan

## Implementation record - 2026-09-15

Implemented the four phases below. Browser/live-provider acceptance remains pending: browser inventory returned no connected providers. No live assignment or database changes were performed.

- Chat captures request ID, selected pair, plan token and viewed timestamp at send time. The route validates optional IDs/timestamp before preparing evidence, resolves selection against fresh candidates, prioritizes selected/recommended pairs within the existing limit, and returns selection status plus coverage. Prompts and fallback distinguish missing selections and partial context. Conversation messages retain the asked-about pair; delayed answers use the originating reservation. Chat is keyed by reservation, replacing the redundant effect reset.
- `useDispatchPlan` owns queue validation and exposes its invalidity reason. The wrapper passes queue context explicitly; detail no longer subscribes to cached plans. Queue confirmation now requires analysis and a valid independent proposal even before the first plan exists. The footer stays mounted through refresh/error/no-pair states, explains disabled actions, and offers existing recovery controls. Review remains bound to pair and evaluation, and is additionally bound to plan token and override reason. Submission, uncertain-outcome handling and server assignment gates remain in place.
- Pair headings distinguish recommended/selected/queue-proposed resources. Ranking displays the serialized `score` on its confirmed 0..100 scale, with no confidence claim. Queue comparisons are read-only with queue impact explicitly unverified. Removed the misleading phone fallback "Available". The footer and body have bounded scrolling for the drawer.
- Removed the orphaned `AiAssignDialog` after confirming no callers, the unused `onTrip` API and `queueRow`, duplicate polling, immediate selection refetch, unused imports and a duplicate Vitest import. The existing assigned lifecycle constant is literally `Assigned`, so no assigned-status repair was needed. Retained guarded render-time state updates because no defect was established.

Verification:

- Baseline: 24 tests passed across the original four focused suites. The duplicate test import was redundant but did not fail that baseline.
- Final: 69 tests passed across 10 suites (conversation projection/route, decision gates, panel rendering, delayed conversation context, queue workspace, assignment route, availability, plan evidence and planner). Added 23 regression checks across the changed/new focused suites.
- Touched-source ESLint with `--max-warnings 0` passed; route-auth audit passed 267/267 handlers.
- Production Next.js 16.2.11 build passed, including all 201 generated pages.
- Test launcher used `npx.cmd` because PowerShell blocks `npx.ps1`; Vitest required sandbox escalation for esbuild's directory resolution. Build ran successfully in the workspace.
- Static rendering tests are not a substitute for desktop/mobile interaction acceptance. Real provider wording, visible polling behavior, network request counts, keyboard focus, and live assignment/reconciliation remain unverified in a browser.

## Outcome and scope

Dispatchers should understand which pair they are reviewing, receive chat explanations about that same pair, and always see why confirmation is available or unavailable.

The following sections retain the implementation specification; actual completion and verification are recorded above. Preserve current styling, deterministic ranking, permissions, English chat responses, per-reservation history, manual-review rules, server revalidation, signed choice binding and atomic assignment. Use existing dependencies and endpoints; no migration, new AI engine, global optimizer, bulk assignment or token-lifetime extension.

## Phase 1 - Bind chat to the displayed selection

**Files:** `src/components/reservations/ai-recommendation-panel.jsx`, `copilot-conversation.jsx` in the same directory; `src/app/api/integration/transport-requests/[id]/conversation/route.js`; `src/lib/dispatch/conversation.js` and their existing conversation tests.

1. Pass the displayed vehicle/driver IDs and displayed evaluation timestamp into the chat component. Capture them when sending, together with the question and request ID, so a subsequent selection change cannot retarget an in-flight question.
2. Add optional `selectedPair: { vehicleId, driverId }` and `displayedEvaluatedAt` fields to the existing POST body. Require both IDs to be positive safe integers when supplied; reject malformed context before recommendation/provider work. Older clients omitting the fields retain the existing general-reservation behavior.
3. Treat these fields only as a reference to what the user saw. Resolve the IDs against the full, freshly prepared server candidate list before applying context limits. Never accept client scores, checks, eligibility or timestamps as operational authority.
4. Add explicit selected-pair context to the server evidence: resolved or no longer present. Keep the engine recommendation separately identified. If the selected pair vanished, explain that directly; do not silently answer about the new recommendation.
5. Prioritize the resolved selected pair, then the engine recommendation, then remaining unique pairs within the existing 12-pair limit. Preserve the 30-exclusion limit.
6. Add coverage metadata for pair/exclusion totals, included counts and truncation. Name totals as candidates/exclusions in this evaluation, not total fleet size. Preserve prefiltered flags and the coordinate/private-record allowlist.
7. Update both prompt and deterministic fallback to respect selection and coverage. Answers use their own evaluation time; a newer evaluation is not by itself proof that a decision changed. Chat must never renew the panel review or signed plan.
8. Record the asked-about pair with each outgoing message/response context so returning to history or switching pairs does not make an old answer look like evidence for the current pair. Preserve reservation isolation and current delayed-response handling.

**Acceptance:** select pair B when A is engine-recommended; both provider context and fallback refer to B. Repeat with a queue proposal differing from A, a B beyond the original first 12, a removed B, no pair, malformed IDs, stale plan, and truncated exclusions. Unknown/stale evidence stays unknown/stale; no private fields or mutation commands are introduced.

## Phase 2 - Stabilize confirmation and validation

**Files:** `src/hooks/use-dispatch-plan.js`, `src/components/reservations/dispatch-plan-panel.jsx`, `ai-recommendation-panel.jsx`; extend `src/lib/dispatch/decision.js` only if needed for a small testable presentation-state function.

1. Make the existing queue hook the sole owner of queue-plan validation polling. Pass its validation state and explicit invalidity reason through the wrapper. Remove the panel's duplicate PATCH observer and unused `queueRow` calculation.
2. Make queue context explicit through wrapper props. The detail panel should use individual recommendation/assignment behavior and must not acquire queue mode from a leftover global plan cache. Audit both callers before removing the panel's cached-plan subscription; preserve deliberate plan invalidation after assignment.
3. Separate action-area visibility from permission to submit. Keep the footer mounted for an active assignable request even when fetching, blocked or missing a pair; empty-selection and terminal-assignment views retain their appropriate layouts. Explain absent assignment permission without showing a working confirmation action.
4. Derive one prioritized explanation from existing gates: pending/uncertain submission, permission, failed analysis or validation, expired evidence/plan, missing or dependent proposal, loading, no pair, hard blocker, missing verification, manual reason, ready. Do not create another eligibility engine.
5. Keep existing submission gates while showing disabled controls during polling. Use a polite status region, visible disabled reason and appropriate existing recovery control: Recheck reservation, Analyze the selected date, or open the request after an uncertain outcome. Avoid repeating an unchanged announcement every timer tick.
6. Preserve pair/evaluation-bound two-step review and reason requirements. Changed evidence invalidates review; a refresh must never silently substitute another pair. Keep request-switch protection through submission and uncertain-outcome reconciliation, 409 handling and assignment-success invalidation.

**Acceptance:** let 10-second validation, 30-second recommendation refresh and plan expiry occur during review; the footer stays visible and submission remains gated. Cover failed PATCH, dependency, no proposal, no pair, revoked permission, manual reason, 409 and uncertain network outcome. Open detail after queue analysis and verify unrelated cached plans do not control its actions. Verify one active queue validation timer; measure requests without asserting a 2x reduction.

## Phase 3 - Clarify evidence and alternatives

**Files:** primarily `src/components/reservations/ai-recommendation-panel.jsx`; reuse current links, accordions and decision labels.

1. Use accurate headings: Queue-proposed pair, Recommended pair, or Selected pair, based on pair identity and context.
2. Correct the field mismatch: the panel currently reads `pair.match_score`, while the advisor serializer supplies `pair.score`. Confirm the final pool scoring clamp and render a finite score as Ranking score: N/100; hide absent scores rather than fabricating zero. State compactly that ranking is not safety confidence.
3. Put the decision, highest-impact reason and next action before detailed checks. Retain expandable route/evidence detail and the existing panel/drawer structure; no visual redesign or new cards needed.
4. In plan mode, allow an expandable read-only comparison of other currently evaluated pairs. Label it individual-request evidence with queue impact unverified. Do not expose a Select action that could substitute a pair under the original token. Explain that the queue proposal can differ from the single-request ranking to coordinate resources.
5. Label recovery controls consistently: Recheck reservation versus Analyze [service date]. Use existing coverage metadata in chat details and mention truncation in answers only when it affects the question.

**Acceptance:** recommended/manual/queue headings match the displayed IDs; score uses the actual payload field and is not described as probability. Queue comparison never changes the signed selection. Desktop and mobile show decision and next action clearly, with keyboard-accessible controls and no footer clipping.

## Phase 4 - Bounded cleanup and verification

1. Re-scan callers before deleting the orphaned `AiAssignDialog` or unused `onTrip` API. Do not delete active work solely because an earlier report called it dead. Remove the immediate candidate-selection refetch only after selection remains pinned and normal freshness/review checks cover it.
2. Verify lifecycle constants before touching the claimed queue/detail assigned-status mismatch. Conditional render-time state updates also require a demonstrated problem before replacement. Avoid a broad component rewrite.
3. Establish the touched-test baseline first. Source inspection found duplicate Vitest imports at the top of `queue-workspace.test.js`; confirm the current file and repair that small test blocker if still present, recording it separately from feature behavior.
4. Extend existing Vitest tests for selection resolution, limits, privacy, input validation, fallback and action gating. If action-state logic is extracted, exercise the real function rather than assertions against source text. No new test framework.

### Automated checks during implementation

Run the focused conversation and dispatch decision suites plus the affected queue tests:

```powershell
npx vitest run src/lib/dispatch/conversation.test.js 'src/app/api/integration/transport-requests/[id]/conversation/route.test.js' src/lib/dispatch/decision.test.js src/components/reservations/queue-workspace.test.js
npm run verify:auth
npm run build
```

Run ESLint on changed source files. Also run the existing assignment route, availability and plan evidence tests to confirm preserved boundaries. Report exact results and baseline failures; earlier passing counts are not evidence for this change.

### Browser acceptance

Use desktop queue, narrow-screen drawer and reservation detail. Check alternative-then-chat, selection changes during slow replies, restored history, no-pair/provider fallback, polling during review, expiry and failed validation, keyboard focus, manual reason, and queue/detail navigation. Exercise actual assignment only with designated test records/environment; use existing automated tests for destructive conflict scenarios otherwise. Report any unverified live behavior explicitly.

## Delivery and completion

Implement phases 1, 2, 3, then the bounded cleanup in phase 4; validate each changed behavior as it lands and run final integration checks once. Keep frontend/backend chat-contract changes together; optional request fields preserve compatibility. If reverting, revert the relevant feature change coherently while retaining server assignment guards.

Update this note with completed work and actual verification, synchronize `Capstone/02 - Features/AI Advisory.md` and the scope audit, and update `SYSTEM.md`. Completion means the selected-pair explanation is grounded, the footer remains visible through refreshes, queue and individual contexts are explicit, capped evidence is disclosed, and no assignment guard is weakened.
