---
type: implementation-plan
status: proposed
created: 2026-09-15
related: ["[[AI Advisory]]", "[[Reservations]]", "[[AI Recommendation Panel Improvement Plan]]"]
---

# Queue Only Dispatch Copilot Implementation Plan

## Manual Analyze controls removed - 2026-09-15

Removed the remaining Copilot Analyze buttons from its header, empty state and recovery flow. Selecting an option still automatically generates and validates the required queue plan. Recheck reservation now repeats the chosen-pair check when a pair is selected, so stale or failed queue evidence has a recovery path without a separate Analyze action. Seven focused panel/assignment tests and touched-source ESLint passed.

## Summary-card removal - 2026-09-15

The user removed the four analysis KPI cards and their count/expiry/Analyze footer from Reservation Queue. These summaries no longer appear after analysis. Copilot retains its analysis and assignment checks. Queue-page ESLint passed; this is a presentation-only removal.

## Conversation-flow update - 2026-09-15

The user's reference now defines a single message log: two assistant option replies, free questions before selection, a choice question after an answer, typed/clicked option selection, automatic selected-pair checking and one subsequent Assign it to confirm. This interaction is implemented and supersedes any separate review-click requirement below. Success remains in the conversation and the mobile drawer stays open. See [[Temporal Dispatch Recommendation Implementation Plan#Unified conversation follow-up - 2026-09-15]]. Detail-to-queue navigation consolidation remains outside this follow-up.

## Dependency implementation update - 2026-09-15

[[Temporal Dispatch Recommendation Implementation Plan]] implements the shared two-option flow, pinned chosen-pair queue reanalysis, coverage preservation, v2 verified/manual tokens, same-panel confirmation and selected-identity protection during refresh. It also explicitly extends chat with selection-bound commands through the existing mutation handler. This does not claim completion of the broader Reservation Detail navigation consolidation. Automated verification and browser limitations are recorded in that note.

## Approved direction and outcome

The dispatcher uses one Copilot in `/reservations/queue`: select a reservation, compare up to two evaluated pairs, choose one, review the current result, and confirm. Manual review stays in this same workspace when the server permits it. Reservation Detail contains booking information, assignment/dispatch information and history, with a link back to the selected reservation in the queue.

This note is a proposed implementation plan. No application changes or new test runs were made while writing it. It supersedes the earlier dual-entry-point and read-only-queue-alternative design when implemented; earlier completed work remains the starting point.

Audience: dispatchers operating the hotel fleet. Preserve the existing FleetOps theme and desktop aside/mobile drawer. The selected reservation reference, current option and next action are the visual anchors. This is a workflow simplification using existing components, not a new chatbot engine or global visual redesign.

## User experience contract

1. **Select reservation:** retain a compact reference and service date; avoid repeating the full booking card. Load current individual evidence and obtain the date-scoped queue analysis if one is needed. Show progress truthfully; do not claim the queue was checked before completion.
2. **Compare options:** show up to two distinct, currently evaluated, nonblocked pairs. Prefer the matching current queue proposal, then the best remaining evaluated candidate. Label reviewable and incomplete evidence distinctly; do not call both options ready. One option or no options are valid outcomes. Keep other evaluated options accessible through an optional disclosure.
3. **Choose:** the button selects a vehicle/driver identity, not a card number or prose answer. If the existing fresh signed choice and evidence match, use them; otherwise recheck the selected choice against the queue. Clear previous review immediately and keep the chosen identity visible while checking. Never silently substitute the engine's new favorite.
4. **Review result:** show ready, permitted manual review, blocked, or needs verification, with the relevant reason and next action. Surface affected bookings when the revised arrangement changes. Metadata and detailed checks stay under **View checks and details**, but expiry, blockers and concerns preventing confirmation remain visible.
5. **Confirm:** keep one active confirmation area near the bottom. The final action explicitly identifies the pair and request. If manual review is allowed, require a specific reason before confirmation. The existing assignment endpoint revalidates before saving.
6. **After confirmation:** show the committed result and dispatch/timeline links. Invalidate the prior queue plan before the next assignment. Preserve conversation history per reservation.

Initial options, checks, selection controls and confirmation are deterministic system UI. They remain usable if the language provider fails. Chat explains recorded facts and comparisons on demand; it does not create controls, change selections, authorize review or execute assignments. Use concrete differences such as pickup timing and recorded workload; avoid unsupported claims such as safer or lower risk.

## Phase 1 - Create one entry point and preserve selection

**Files:** `src/app/(dashboard)/reservations/[id]/page.js`, `src/app/(dashboard)/reservations/queue/page.js`, existing transport service and queue tests.

- Remove the detail page's `AiRecommendationPanel` mount and unused import. Replace the existing scroll-to-Copilot action with **Open in Dispatch Queue**, using `/reservations/queue?requestId=<id>` for unassigned actionable requests. Preserve **Open dispatch** for an existing assignment and preserve nonassignment detail actions.
- Parse and validate the deep-linked ID. Resolve it through the existing permission-checked request GET; an ID in the URL is not authority to access or assign it.
- Select the correct lifecycle tab and derive the Manila service date from the fetched record. Selection must survive initial smart-tab steering and list polling.
- Do not rely on the first page containing the request. Keep a separately fetched selected-request context when the item is outside the visible page/filter, disclose that fact and provide a return-to-list action. Do not silently replace it with the first visible row or invent a matching list row. Use an existing exact-filter/page-locator capability if available at implementation time.
- Missing, deleted or unauthorized IDs show an appropriate error without selecting another request. Completed, cancelled or already assigned requests show their real state, with no new assignment control.
- The detail link appears only for roles allowed to enter the queue. Preserve existing read-only detail access; this change grants no new permissions.
- On narrow screens, opening a valid selected request opens the existing drawer. Browser Back/Forward and refresh preserve intentional selection.

**Acceptance:** follow the link for a next-day request, a request beyond page one, an already assigned request, and an invalid ID. Verify the exact request/date remains active and Detail contains no second Copilot or broken scroll target.

## Phase 2 - Support a chosen pair in queue reanalysis

**Files:** `src/app/api/integration/transport-requests/dispatch-plan/route.js`, `src/services/dispatch-plan.service.js`, `src/services/dispatch-plan-evidence.service.js`, `src/hooks/use-dispatch-plan.js`, existing planner/route/token tests.

- Extend the existing POST body with optional `selection: { requestId, vehicleId, driverId }` and `basePlanToken`; retain ordinary `{ date }` analysis. Validate all IDs as positive safe integers. Verify the supplied baseline's signature, revision, expiry and date; never trust a client-posted plan or eligibility findings.
- Resolve the selected request and pair from current server data. The request must belong to the selected analysis window and the pair must pass existing pairing and evidence rules. If it is outside the 30-request evaluation cap, say it was not evaluated; do not sign it or silently push out a higher-priority request to fit it.
- Add one pinned selection to the existing bounded planner. Once selected, candidate iteration and single-replacement repair must not replace that request's pair. Continue checking fixed commitments, all affected provisional legs and both vehicle/driver availability.
- Preserve higher-priority coverage from the verified baseline. Include compact signed baseline coverage identifiers if needed because the current token omits dependent proposals; never infer baseline coverage from untrusted UI data. Report any other changed or unplaced proposal by request ID with its supported reason before confirmation. A change to provisional proposals is not an assignment to those requests.
- A rejected choice returns a clear selected-choice result and affected-request findings, without authorization for the rejected pair. Keep the dispatcher on the same request with **Choose another option** or **Check again**. Do not automatically switch the displayed pair back.
- Preserve the existing request cap, shared evaluation deadline, before/after revision checks, expiry sweep and dependency rules. Deadline, missing queue evidence and stale baseline are recheck states, never reasons to allow manual confirmation automatically.
- Resolve the dispatch policy consistently for the new check. The current radar's direct default-buffer use, identified in [[AI Recommendation Logic Review]], must not make the revised check disagree with saved conflict settings; thread the existing resolved buffer policy through relevant evaluator calls and verify a nondefault value.
- Return the revised plan, selected-pair evidence, impacted proposals, evaluation scope and fresh token together. The hook replaces them atomically and is still the only validation-poll owner.

**Acceptance:** Option 2 is honored when viable, never substituted during repair, and never sent with Option 1's authorization. Cover competing higher-priority requests, fixed trips, shared resources across time, date mismatch, out-of-cap selection, tampered baseline, deadline, revision drift and saved nondefault buffer.

## Phase 3 - Permit explicitly eligible manual review in the queue

**Files:** planner and plan-evidence services; `src/lib/dispatch/decision.js`; `src/app/api/integration/transport-requests/[id]/assign/route.js`; `src/services/recommendation.service.js`; existing assignment, decision and token tests.

This phase changes the queue's currently VERIFIED-only confirmation contract. Removing the client guard alone is not sufficient.

- Distinguish normal confirmable choices from **manual-review-eligible choices** in the signed plan. Use a versioned token contract with an explicit confirmation mode bound to request/vehicle/driver IDs. Keep normal choices limited to verified, independent proposals.
- Review eligibility comes from fresh server evidence: required checks are present and verified, the pair is explicitly reviewable, no hard conflict or standby restriction exists, and evidence is unexpired. Missing registration/license/capacity, infeasible routes, missing pair, expired evidence and arbitrary planner failures cannot become manual choices.
- Apply the same review rules already enforced by `validatePairAvailability`; do not add a broader meaning of `force`. Show the exact allowed concern being acknowledged. A reason describes the actual verification performed, not a generic waiver.
- Extend planner feasibility acceptance only for the deliberately selected, explicitly reviewable leg. Continue checking its interactions with fixed and provisional commitments. Preserve higher-priority coverage; uncertain impact outside an explicitly permitted review concern remains nonconfirmable. Other unreviewed legs do not gain authorization through this selection.
- An uncommitted manually reviewed proposal cannot establish a verified origin or release time for later choices. Dependent requests stay unavailable for confirmation until the preceding assignment commits and the queue is reanalyzed. If the selected request itself has uncommitted predecessors, require those first.
- Manual choices must remain **Review required**, never included in ready/verified counts or described as automatically safe. Full/partial evaluation counts remain truthful.
- Assignment receives the fresh bound token plus `force: true` and the required 1-500-character reason. Verify mode/selection before lifecycle work and again inside the existing locked commit. Rebuild live evidence and record acknowledged findings/reason through the existing audit path.
- Do not drop the plan token to reach the old individual-assignment path from this UI. Existing non-Copilot consumers of the assign API retain their supported behavior; removing them is outside scope.
- During token rollout, existing version-1 tokens retain their existing verified-choice semantics until expiry; they never authorize manual choices. New manual choices require the new version. Patch validation and conversation token inspection must understand the versioned contract without turning review choices into verified facts.

**Acceptance:** a genuinely reviewable scheduled request can be reviewed and confirmed from the queue with a reason. Missing compliance data, hard overlap, stale token, wrong pair/mode, unsupported unknown queue impact and incomplete analysis remain blocked. Verify atomic audit, 409 behavior, and uncertain-outcome reconciliation.

## Phase 4 - Present options in one conversational workspace

**Files:** `src/components/reservations/ai-recommendation-panel.jsx`, `copilot-conversation.jsx`, `dispatch-plan-panel.jsx`; `src/lib/dispatch/conversation.js`; conversation route only where its existing evidence projection needs new selected-choice facts.

- Reuse the panel and chat components. Put compact option cards in the current conversation/workspace area, with vehicle plate, driver, eligibility state and one or two factual distinctions. Show the ranking score only in details unless it helps explain the choice.
- Option cards use stable vehicle/driver IDs. Option 1/2 are display labels, never identity. Pin the option set during selection/review; do not silently reorder it on polling. Disappeared options become unavailable visibly.
- Keep the initial structured options and latest selected-choice result available without an LLM call. Choosing a card calls the deterministic recheck flow, not the chat endpoint. Suggested questions use existing free-text chat and captured selected-pair context.
- Separate historical messages from current action state: stored messages are explanatory snapshots only. Do not persist live tokens or working confirmation buttons in session history. Old cards cannot authorize a new action; if shown in history, they are inert.
- One current footer handles checking, ready, manual reason, blocked, retry and confirming states. Clear review whenever request, pair, plan token, evaluated evidence or acknowledged reason changes. If other proposals change during reanalysis, require review of the new result.
- Keep a compact reference/date visible. Collapse repeated booking information, raw checks, scores and expiry timestamps. Keep the current stale warning and action-blocking concern visible. Fuel or maintenance findings stay prominent when they affect readiness/review; otherwise include them in details or answers on demand.
- With no pair, show the strongest recorded exclusion or missing-data reason and a relevant record/recheck action even if the AI provider is unavailable. Do not make chat availability a prerequisite to understand a blocked request.
- Preserve per-reservation history and send-time pair/request capture. Discard obsolete selection-check responses using request ID, pair identity and a current operation identity; an older response must not overwrite a newer selection or date. Disable further choice changes during final submission and uncertain-outcome reconciliation.
- Preserve the pending context through mobile drawer close/reopen and responsive transitions. Either keep the active operation state in the existing queue owner or prevent dismissal while its outcome is unresolved. Do not leave a hidden pending action or lost recovery controls.
- Use keyboard-operable selection buttons, descriptive disabled states, a polite status announcement and sensible focus after choosing/rechecking. Fit the active footer and scrollable body on desktop/mobile without nested unbounded scrolling.

**Acceptance:** two/one/no options, incomplete analysis, expired plan, provider failure, slow out-of-order responses, switching requests, restoring history, keyboard operation and drawer resize/close during submission. Confirm no historical button can act and only one Copilot is mounted.

## Phase 5 - Verification and documentation

Use the installed Vitest tooling and existing test seams; add focused checks for pinned selection, manual token binding and actual rendered behavior. Do not certify the flow with source-text matching alone.

- **Planner/API:** ordinary analysis compatibility, selected alternative, repair pinning, priority/commitment protection, partial/cap/deadline, unchanged-versus-changed revision, service-date boundaries and nondefault buffer.
- **Authorization/commit:** normal and manual token modes, old-token compatibility, wrong request/pair, omitted reason, hard/missing evidence, predecessor dependencies, live recheck and audit rollback. Validate tokens both before and within commit.
- **UI/conversation:** exact-request deep links, absent-page selection, current card identity, one footer, disabled and manual states, stale history controls, delayed replies and LLM outage.
- **Browser:** exercise desktop queue and mobile drawer with actual visible interactions; test Detail-to-Queue navigation and complete one normal/manual flow only with designated test data. If no connected browser or safe test environment exists, explicitly record these checks as pending rather than passed.
- Run focused changed/related suites, touched-source ESLint, `npm.cmd run verify:auth` and `npm.cmd run build`. Record the current baseline separately from new failures. Read the installed Next.js guides before route/page code changes.
- Update this note with implementation status and actual verification, then synchronize `AI Advisory.md`, `Reservations.md`, prior workspace notes and `SYSTEM.md`. Keep older verification counts historical.

## Delivery order and boundaries

Implement backend pinned-choice checking and signed manual authorization with their tests first. Then wire the conversational queue UI and deep link; remove the detail Copilot only when its normal and manual workflows have working queue replacements. Deploy token producer/verifier changes together. Reverting manual authorization must also disable its UI controls; never fall back to an unbound assignment request.

No new dependencies, database migrations, LLM selection authority, bulk assignment, global optimizer or longer token expiry are planned. Broad weight/fairness/fuel-policy changes from the separate logic review are outside this change; the buffer consistency issue is included because the selected-choice recheck must use one policy. Existing deterministic eligibility, permissions and hard blockers remain the authority.

Done means one queue Copilot covers normal choice, alternative recheck and permitted manual review; Detail routes to the same selected request; confirmation is bound to the latest server-approved choice; and remaining unverified acceptance is reported explicitly.
