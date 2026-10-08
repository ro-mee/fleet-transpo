---
type: audit
status: partially-remediated
date: 2026-10-02
tags: [qa, admin, maintenance, reports, dispatch]
related: ["[[Maintenance]]", "[[Reports]]", "[[Dispatch]]", "[[RBAC]]"]
---

# Admin QA Report Assessment — 2026-10-02

Source review of the supplied Admin QA report. The deployed behavior was not replayed in this assessment; record counts, HTTP responses, and deployment configuration remain observations from the report rather than independently verified facts.

| Report finding | Source assessment | Follow-up |
| --- | --- | --- |
| B1/B2 maintenance vehicle control | Strong shared cause. `openEditDialog` seeds `vehicle_id` from an integer DB field; both the `FloatingSelect` value and each Radix `SelectItem` value receive raw integer IDs. This explains a missing selected label and a click that does not persist. No create/update request was sent, so database relationship loss was not demonstrated. | Convert vehicle IDs to strings at the select boundary for initial edit value and options, then test create selection and edit preservation in a browser. |
| B3 report analysis | Real UI failure path: `analystLoading` remains true when a valid report payload enabled the narrative query but the narrative errors or returns an unmatched/empty result. Export buttons depend on `activeQuery.data`, not on the narrative. Their disabled state needs a separate report-query check. | Capture both report and narrative responses; show a bounded narrative error/retry state and keep data export independent. |
| B4 dashboard/calendar count | The dashboard counts every non-deleted `Scheduled` dispatch in `/api/dispatch/by-status`; the calendar counts the selected window. A follow-up live check found scheduled dispatch 622 *inside* October 2 and 10 available drivers, so date scope alone cannot explain the reported calendar zeros. Core calendar query failures were previously swallowed into empty arrays. | Core failures now surface a retry state and KPI cards avoid false zeros; replay the deployed page after release to establish whether that was the observed cause. |
| B5 predictive zero | Maintenance counts work orders; predictive maintenance scores eligible vehicles and service schedule/usage. Their totals should not match. A 2026-10-01 live audit recorded 21 predictions, including 19 unscheduled, so a default-view zero conflicts with that earlier snapshot. The current page also has a request-error panel and a filter-dependent count. | Capture deployed revision, active filter, request state, and response before treating zero as a scoring defect. |
| B6 TomTom route error | Missing TomTom configuration is a deployment issue if automatic estimates are required. The route form has manual distance, duration, and source inputs. The duplicate-direction rejection is an independent integrity rule, not evidence that manual creation fails for a new pair. | Verify hosting configuration, then use a genuinely unused origin/destination pair to test manual fallback. |
| B7 templates | Confirmed placeholder page: `/notifications/templates` renders “Email templates coming soon.” Whether that blocks release depends on an accepted notification-template requirement. | Define the requirement or remove the unfinished feature from the Admin acceptance scope. |

The maintenance action buttons have tooltip wrappers but no accessible names on the buttons themselves. The report's accessibility observation is supported by source. The Admin navigation and page redirects are useful UI checks, but do not prove server authorization; replay authenticated API requests and role-tampered writes before RBAC sign-off. The three disposable records identified by the QA report remain a cleanup task; this assessment did not change cloud data.

## Implementation follow-up — 2026-10-02

The requested B3–B6 follow-up changed Reports, Dashboard/Calendar, Predictive Maintenance and Routes as recorded in their feature notes. Live SQL was read-only. No cloud records, deployment settings or migration files were changed. Verification: 24 focused tests across five files, changed-file ESLint, and `npm run build` passed. Production acceptance is still needed for the calendar and predictive browser states. The accessible Vercel login cannot see the FleetOps project, so the production TomTom key remains an external configuration task.
