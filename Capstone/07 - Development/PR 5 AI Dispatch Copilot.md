# PR 5 AI Dispatch Copilot

2026-09-14 follow-up implemented: [[Dispatch Copilot Decision Workstation Plan]] now records the shared queue/detail decision workstation, explicit check coverage, four-state evidence presentation, required manual-review reasons, atomic assignment timeline evidence and stale recovery. Full suite: 118 files / 1,180 tests passed; build, touched ESLint and 266-method auth audit passed. Browser/live concurrency acceptance remains pending. The sections below describe the underlying PR 5 planner retained by that follow-up.

Implemented 2026-09-14. Queue **Analyze queue** produces provisional pairs, reviewed and confirmed one at a time through the existing assignment dialog. No Apply All.

## Rules

- Analysis includes unassigned Pending/Scheduled requests through next Manila midnight plus overdue pickups, across pagination. Fixed dispatches are excluded; missing pickup times require review.
- Feasibility has no midnight cutoff. Persisted future commitments and tentative trips protect both driver and vehicle. Every insertion rechecks all proposed legs. A preceding tentative destination supplies the next origin even after long gaps.
- Existing canonical estimates, eligibility, schedules, leave, compliance and PR 4.5 route evidence are reused. Unknown evidence never earns verified status.
- Ordered objectives: hard safety, priority coverage, total served, scarcity, travel burden, fairness, stable IDs. The bounded greedy implementation uses single-prior-pair replacement and preserves covered higher-priority requests. Repair accepts the first safe served-count improvement; global optimality is not guaranteed.
- Cap: 30 requests and a shared 25-second evaluation budget. Setup/revision queries and started I/O are not cancelled by that budget. Responses expose `analysisComplete`, evaluated/total counts, `incompleteReason` and per-proposal completion. Partial analysis never means remaining requests are unavailable.

## Freshness and confirmation

POST `/api/integration/transport-requests/dispatch-plan` requires reservations read and recommend permissions, checks before/after fleet revisions and signs an ephemeral token. PATCH validates without regenerating. Responses are private/no-store.

Revision hashes cover requests, assignments, drivers, vehicles, categories, maintenance, routes, locations, work/leave/substitute schedules, attendance, consent, sessions, employees, trips, incidents and policy. Generated request display metadata is excluded; Pending-to-Scheduled bookkeeping is normalized. Conservative whole-table hashes invalidate on unrelated operational changes too; narrow dependencies only if measured invalidation frequency warrants it.

Tokens expire within 60 seconds or earlier route/location/context expiry. Expired predecessor evidence downgrades dependent proposals. UI polls validity every 10 seconds, disables invalid confirmation and loads full request details for review while pinning the pair in fresh recommendations.

Only proposals without uncommitted predecessors can be confirmed. Confirm the prerequisite and reanalyze. Assignment permission, signed choice and revision are checked before lifecycle work and again inside the guarded assignment transaction. One successful assignment invalidates the plan. Existing intermediate lifecycle bookkeeping is outside the final transaction; a late rejection does not imply zero bookkeeping writes.

Analysis writes no assignments, dispatches, notifications or alerts and does not persist request estimates. Existing routing infrastructure may populate provider caches. No migration, dependency, mobile change, new monitoring integration or LLM decision layer.

## Verification and limits

Core files: `dispatch-plan.service.js`, `dispatch-plan-evidence.service.js`, shared `dispatch-recommendation-preparation.service.js` and tentative support in `dispatch-radar.service.js`. UI uses `dispatch-plan-panel.jsx` and existing assignment components.

- Final full Vitest: **115 files / 1,173 tests passed**. Includes deterministic/scarcity/travel ordering, priority preservation, persisted/tentative conflicts, cross-midnight commitments, preceding origins, partial caps, expired dependencies, read-only analysis, signed/stale choices, unauthorized confirmation and transaction-time stale rechecks.
- Production build passed (201 pages), touched-file ESLint passed, route-auth audit passed (266 methods), migration filename check passed (114 files). No migration added.
- Browser dispatcher acceptance, live database concurrency and physical GPS/device acceptance remain pending. Mocked tests do not certify live dispatch execution.

Agent record for this implementation continuation: `pr5_backend` used **gpt-6-astra, medium**, producing backend changes before a usage-limit error. The primary assistant completed review, fixes, UI integration and verification. No independent tester sign-off. No Sol or Luna agent used in this continuation; removed custom workflow/configuration was not restored.

Related: [[AI Advisory]] · [[Dispatch]] · [[PR 4.5 Context-Aware Dispatch Radar Implementation Plan]]
