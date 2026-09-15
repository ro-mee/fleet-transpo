# Dispatch Copilot Persistent Workspace Plan

Status: IMPLEMENTED, 2026-09-15. Application code updated: two-column layout, compact semantic table, shared plan hook, in-panel confirmation, and automated tests (1,201 passing tests, clean build). React 19 Rules of Hooks violation resolved in AiRecommendationPanel by hoisting useQuery unconditionally. Resolved UTC-vs-Manila timezone mismatch in `transport-requests` queue tab predicates (`(pickup_datetime AT TIME ZONE 'Asia/Manila')::date`), ensuring early morning upcoming trips (Sep 16 Manila) do not bleed into the Sep 15 "Today" tab. Removed redundant `Guest Transpo` badge pill per user request in favor of the clean inline reference indication `#RS-xxxx · Category`. Integrated bespoke 3D Dispatch Copilot mascot avatar (`public/images/copilot-avatar.png`) across the Copilot header, chat messages, loader indicator, mobile drawer title, mobile open button, and empty state. Visual browser acceptance pending live browser inspection.

## Outcome and visual authority

Build the user's reference composition: a compact selectable transportation queue on the left and a persistent decision-support Copilot on the right. On desktop the queue stays interactive while the dispatcher reads evidence and confirms one reservation. This supersedes the modal-first queue placement in [[Dispatch Copilot Decision Workstation Plan]], not its safety rules.

Audience: dispatch operators comparing requests and committing resources. Mode: Operate. Preserve current FleetOps navigation, Inter typography, neutral surfaces, semantic status colors and light/dark tokens. The supplied image governs composition, density and hierarchy; its Evergreen branding, serif typography, fictional reservations and green brand palette are not a global theme-change request.

## Verified local starting point

- Queue page currently renders large ReservationCard entries, server-backed lifecycle tabs/counts, search and pagination (25 rows, 30-second polling).
- DispatchPlanPanel sits above those cards and opens a modal right-side dialog. Selecting a proposal opens AiAssignDialog. Queue card assignment also has its own dialog state.
- AiRecommendationPanel already supplies the shared evidence/Why/assignment experience, identity-pinned pairs, background refresh, manual review, server revalidation and 409/uncertain-outcome recovery.
- Existing planner returns bounded proposals, dependencies, shared-option contention and analysis completeness; plan cache and token validation already exist.
- Dashboard shell uses a fixed top navigation and an expanded 240px or collapsed 72px sidebar. Responsiveness must use remaining workspace width, not viewport width alone.
- Current source tokens are neutral FleetOps colors. DESIGN.md and globals.css support preserving that identity.

## Layout and row design

Use a page-local two-column workspace. At approximately 1,020px available content width, reserve 460px (up to 490px on `2xl`) for the Copilot and remaining width for queue content with a modest gutter. Final threshold must be verified against real labels with expanded and collapsed navigation. Target side-by-side operation at 1366×768 and larger when sufficient content width remains.

The queue column contains a compact title/action row, four analysis summary tiles, existing lifecycle tabs/search, view layout switcher (List view vs 2-column Grid view matching user references 1-to-1), compact rows and pagination.
- **List View:** Clean card rows with rounded checkbox, `#TR-xxxx` reference, guest name with user icon, party/baggage count, calendar date & time, route with distance and duration estimates, pill tags (VIP, Airport, Restaurant, Group), and lifecycle/Copilot status chips.
- **Grid View:** 2-column responsive cards with top header status pill, guest info, date & route row, trailing chevron, and bottom pill tags.
- Selected row gets a subtle semantic tint, leading indicator and accessible selection control. Keyboard users can select via a real button; inner links/actions must not trigger selection accidentally. Do not add an ARIA grid unless its full keyboard behavior is implemented.

Copilot is a nonmodal aside on desktop, sticky below the existing header, with a bounded scrolling evidence body and visible action footer. The queue uses the normal page scroll; avoid introducing a second full queue scrollbar. The reference's hierarchy is preserved:
1. Dispatch Copilot title, analysis state and timestamp.
2. Selected reservation context.
3. Recommended vehicle and driver.
4. Decision banner and highest-impact findings.
5. Evidence/checks.
6. Actual route metrics and next-trip impact.
7. Brief deterministic Why explanation.
8. Primary review/confirmation action and contextual secondary questions.

On narrower content widths, keep compact rows/cards and open the same Copilot body in the existing accessible drawer/dialog. Restore focus to its trigger on close. Mount only one active Copilot body so hidden desktop/mobile copies do not duplicate queries, IDs or mutation state.

## Summary and evidence truth

Four tiles: Ready, Review required, Blocked, Needs verification. Include separate waiting-dependency and not-evaluated counts when present; never force those into a ready bucket. Counts derive once from the existing plan and decision mapper, across the stated plan scope, not just the visible 25 rows. Keep lifecycle totals in the existing tabs; Assigned is not a Copilot readiness state.

Avoid duplicating four identical counters inside the narrow Copilot. Its compact summary instead states evaluated/total, scope and freshness. Before analysis show an unanalysed state, not four fabricated zeros. Expired counts are historical and cannot retain a current-ready claim. Empty/failed bounded placement does not establish a fleet-wide Blocked conclusion.

Planner scope remains today through Manila midnight plus overdue, capped at 30 requests with the existing budget. Changing the displayed lifecycle tab, search or page does not change that scope. Explain out-of-window, partially assigned, cap-excluded and not-evaluated selections explicitly.

Only use real fields. No invented baggage coverage, live on-duty label, driver rating, ETA or traffic forecast. Missing metrics show Unverified. Existing pickupBufferMin is departure slack; turnaroundMin is time after repositioning, not automatically net safety slack. Show individual downstream trips when they differ. Replace “meets all requirements” with “Recorded checks passed; live revalidation required.” No confidence percentages.

## Selection and data flow

Queue page owns selected request ID and mobile open state. Select the first visible actionable row on initial load for orientation; never run queue analysis or confirm automatically. User selection wins over polling/reordering. On an explicit filter/tab/page change clear the review draft and select from the new visible result; never show the old request under a new highlighted row. When polling removes the selected row, show its changed/current record or a clear unavailable state rather than silently switching requests.

Plan analysis remains an explicit Analyze queue/Re-analyze queue action. Reuse ['dispatch-plan'], its existing validation key and existing request/recommendation queries. A small shared hook is justified only to move the current plan lifecycle out of the modal and let rows, counts and aside consume one owner; it is not another state store or freshness layer.

Selection → load that request → match proposal by request ID → render the shared decision view. Fetch full evidence only for the selected request, not every visible row. Key the decision instance by request identity and explicit decision scope; resetting selection clears pair/reason/confirmation state. Ignore late responses belonging to a previously selected request.

For an analyzed request, pin the planned pair and preserve its token for any queue-derived confirmation. The selected-pair refresh may invalidate or downgrade readiness; it must never silently replace the plan's pair. Label plan analysis time and pair check time separately instead of implying one evaluation. Recheck the request does not renew the queue token.

A dependent proposal remains nonconfirmable until its predecessor is committed and the queue is reanalyzed. Existing shared options are potential competition, not proven collisions. “View alternatives” may inspect evidence; choosing a different pair requires explicit individual-review scope or queue reanalysis. Never quietly drop a stale plan token to assign individually. Direct detail review remains available through its existing route with that scope made clear.

## Actions, confirmation and recovery

| State | Primary behavior |
|---|---|
| Current ready root | Review & confirm, then explicit confirmation of named request/pair |
| Review required | Show warning; permitted manual review requires reason |
| Needs verification | Show missing evidence and Recheck; manual review only if server explicitly allows |
| Blocked | Show blocker, alternatives/corrective link and Recheck; no confirm |
| Waiting on predecessor | Review predecessor and reanalyze after its assignment |
| Stale/error | Keep prior findings labelled historical; disable confirm; reanalyze/recheck as appropriate |
| Assigned/terminal | Actual resources, lifecycle and dispatch/timeline links; no fresh assignment prompt |
| Read-only | Evidence and Why only; existing recommend permission still governs queue analysis |

Suggested questions expand existing deterministic evidence in place. No free-text chatbot or invented “What if traffic is worse?” simulation. Footer actions vary by state and must not cover evidence at small heights or browser zoom.

Keep final review inside the desktop panel; do not reopen the old assignment modal. Pin the request, pair, scope and evaluated evidence during review. Invalidate the review when any of those changes. Disable changing selection and duplicate submission while assignment or uncertain-outcome reconciliation is pending.

Submit only through assignResources and the existing validated endpoint. Preserve override reason, plan token, live checks and atomic timeline evidence. On success retain the actual committed result, invalidate queue/recommendation/dispatch/timeline queries and old plan, and offer Re-analyze queue. Do not automatically choose or confirm the next request.

On 409 preserve rejected pair/findings and selection. Stale plan needs queue reanalysis; request evidence can be refreshed without erasing the failure prematurely. On timeout/network ambiguity reload the request before retry. These behaviors already exist and must survive moving from dialogs to the persistent panel.

## Implementation sequence and file scope

1. Refactor DispatchPlanPanel's existing analysis/validation ownership for the queue page; share one derived proposal/count lookup. Preserve token-bound eligibility and existing incomplete/dependency handling.
2. Update src/app/(dashboard)/reservations/queue/page.js to coordinate selection and the two-column layout. Add a focused reservation-queue-table.jsx if cleaner than expanding the shared ReservationCard; retain the card for other callers/narrow contexts.
3. Recompose dispatch-plan-panel.jsx into the persistent aside plus responsive wrapper. Remove the queue's competing assignment-dialog path; leave AiAssignDialog available for other legitimate callers.
4. Recompose ai-recommendation-panel.jsx presentation to match the reference hierarchy and action footer, keeping its shared detail-page use and safety behavior. Only extract presentational subcomponents actually used by both layouts.
5. Add focused interaction regressions, perform visual acceptance, and update Reservations, AI Advisory, PR 5 notes and SYSTEM.md with actual verified results.

Expected backend changes: none. If a reference element lacks existing evidence, omit it or mark it unavailable. Do not broaden APIs, RBAC, planner scope, database schema, global dashboard theme, optimizer, snapshots or provider usage merely to fill the mockup.

## Acceptance, risks and rollback

Automated checks must cover row selection versus navigation/cancel actions; refresh reorder and delayed-response isolation; switching requests clears review/reason; stale tokens/dependencies block submission; alternate scope cannot drop plan protection; one confirmation only; 409/network recovery; success invalidates the plan; and denied permissions. Reuse the existing test runner and security/decision regression suites. Finish with touched-source lint, production build and relevant full-suite checks.

Visual acceptance is a required deliverable, not replaced by a passing build. Inspect desktop 1366×768 and 1920×1080, expanded/collapsed sidebar, narrow tablet and 390px mobile, light/dark mode and 200% zoom. Verify simultaneous queue/Copilot visibility, readable long routes/names, meaningful first viewport, reachable confirmation, keyboard focus, drawer focus return and no page-wide horizontal overflow. Inspect selected/loading/ready/review/missing/blocked/stale/assigned states. Use a real browser provider; if unavailable, report visual acceptance pending and do not claim the reference appearance is verified.

Main risks: cramped content beside navigation, lost selection during polling, duplicate responsive mounts, and mixing queue-scoped evidence with individual recommendations. The width threshold, stable IDs, single mounted view and explicit scope rules address these directly.

Deliver as one cohesive UI follow-up after acceptance, preserving existing uncommitted work. Rollback only the new queue layout/selection/presentation changes; preserve server evidence hardening and assignment auditing. No migration rollback is required.

