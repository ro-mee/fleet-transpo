---
type: assessment
status: proposed
tags: [maintenance, predictive, capstone, ui-ux]
date: 2026-10-23
related: ["[[Maintenance]]", "[[AI Advisory]]"]
---

# Predictive maintenance direction assessment

## Scope and decision

The owner requested an opinion on the pasted FleetOps predictive-maintenance audit and practical improvements, including premium, modern, minimalist UI advice using UI/UX Pro Max, Impeccable and High-End Visual Design. The owner explicitly selected **a useful, realistic capstone that is easy to demonstrate**.

This is an assessment and proposed scope, not an approved implementation specification. No application behavior, database records, permissions or UI were changed. Existing unrelated working-tree changes were preserved.

Recommended direction: explainable service forecasting, a small set of condition alerts, and a complete forecast-to-work-order workflow. Keep the existing maintenance and mechanic modules as the foundation. Machine-learning failure prediction is a later research option requiring suitable historical outcomes and separate validation.

## What source review supports

| Audit concern | Current local evidence and qualification |
| --- | --- |
| An unrelated repair can advance routine servicing | `src/services/maintenance-schedule.service.js:110` checks Completed but not qualifying service tasks; the PUT route calls it at `src/app/api/vehicle-maintenance/[id]/route.js:325`. The forward-only clamp means advancement is possible, not inevitable for every repair. |
| Already-overdue mileage can be ignored with sparse trips | `src/lib/ai/predictive-maintenance.js:124` excludes the mileage-derived date unless usage confidence is high. A recorded exceeded threshold is a fact and must be checked independently of a forecast. Small negative projected values can also round to negative zero. |
| Completion and schedule updates can disagree | The work-order change and audit are transactional, but vehicle status and schedule updates occur after that transaction (`src/app/api/vehicle-maintenance/[id]/route.js:294-325`). Downstream failure can leave a committed completion and an error response. |
| Distance quality is not reflected in confidence | `src/app/api/ai/predictive-maintenance/route.js:40-49` uses SUM(distance) and COUNT(*) without actual-distance/provenance qualification. Modern trip completion can populate distance with measured distance, so distance is not always estimated; the issue is indistinguishable evidence quality and sample coverage. |
| The fleet overview reads retired fields | `src/app/(dashboard)/fleet/maintenance/components/PredictiveOverview.js` reads band/days_remaining/km_remaining. The mounted caller and services do not adapt the current risk/daysToService/kmToService contract. Its empty state can also say Fleet is Healthy when data is unavailable. |

The existing `/maintenance/predictive` page already uses Service Outlook wording, explains the limits of its score, and separates loading, failure and no-schedule states. Reuse that progress instead of rebuilding from the older overview.

Mechanic assignment, Pending Inspection review, assignee-scoped history/upcoming feeds and manual fuel-diagnostic work orders already exist. The proposal should connect them, not claim they are new. The October 1 observation of 19 unscheduled vehicles out of 21 is historical, not a current live fleet count.

Two qualifications to the pasted advice:

- Dividing by 90 is reasonable for a fully observed 90-calendar-day average, including idle days. Improve observation coverage and compare recent activity; do not simply switch to active-day division and overstate future daily usage.
- Renaming a health score to urgency without changing its direction is confusing: the present high score means less urgency. Prefer explicit due status and supporting evidence; keep any numeric ranking secondary and clearly defined.

## Smallest useful capstone scope

1. **Trustworthy service status.** Check exceeded date/mileage first, preserve unknown readings, prevent unrelated resets, and save completion plus authoritative schedule changes together. Keep notification delivery outside that transaction. Unify both page contracts.
2. **Data setup and evidence.** Show the last verified odometer and date, last qualifying service, configured interval, usable observation period and valid-distance coverage. Provide Record odometer / Set service schedule actions. Label insufficient data instead of inventing zero mileage or confidence percentages.
3. **A small service catalog.** Start with configured routine/oil service, brake inspection and tire inspection. These are separately tracked tasks, not claims to predict brake or tire failure. Use appropriate manufacturer/fleet-approved intervals per vehicle, with audited overrides. Map each completed task to the schedule it can reset. Demonstrate the first service type end to end before expanding.
4. **One connected action flow.** Forecast or reported issue -> staff review -> existing work order -> assigned mechanic -> findings and evidence -> authorized completion -> relevant schedule/alert update. Link an active order to its trigger; repeat refreshes/clicks should show View work order rather than create another. Allow multiple tasks when they are genuinely different. Defer with a reason and review date without erasing overdue facts.
5. **One initial condition signal.** Surface recurring unresolved inspection findings and link the original evidence. A fuel anomaly can reuse the existing manual diagnostic flow afterward. Reports and unusual consumption are reasons to inspect, not proof of a defect. Do not silently change inspection grounding policy; operational availability remains governed by the existing incident/maintenance rules.
6. **Evidence of usefulness.** Save a lightweight forecast snapshot at meaningful changes or daily evaluation, with its inputs, rule version and linked outcome. Record whether a mechanic confirmed a reported issue. Demonstrate service-due detection, duplicate prevention, correct completion updates and missing-data handling. Do not call these failure-prediction accuracy.

Forecast evaluation compares a stored estimate with the observed mileage-threshold crossing when that event is observable. Early servicing ends that cycle; it is not automatically a forecast error. Measure confirmed condition alerts among reviewed alerts, report sample sizes, and keep synthetic demo outcomes separate from real operational evidence. Maintenance-completion date alone is not a failure or threshold-crossing label.

## UI recommendation

Use one Maintenance workspace with Overview, Work orders and History. Overview leads with a compact summary and prioritized work list; a selected vehicle opens supporting detail beside it on desktop and as a focused detail view on phones.

The main list answers: vehicle, service/issue, due status, reason, evidence freshness and next action. Suggested actions are Review, Schedule service, View work order, Record odometer and Set schedule. Summaries can overlap (for example an overdue vehicle can have an active order); label their units and do not display them as slices of one total.

Keep three distinct concepts: service urgency, operational availability and work-order progress. Scheduled does not mean serviced; low service urgency does not mean safe to dispatch. Prefer Due within 7 days over Critical when the only evidence is a routine service date.

Use the shared Inter typography, tabular numbers, semantic status colors, 12px controls, 16px panels, restrained borders, consistent spacing and short feedback transitions. Preserve readable contrast, keyboard/focus behavior, labeled touch actions and light/dark states. Premium quality comes from alignment, clear hierarchy and reliable interactions. Repository design rules take precedence over High-End Visual Design's generic font bans, large marketing spacing and cinematic motion.

UI/UX Pro Max's broad search initially matched an incident-status landing page, so its unrelated layout/palette were rejected. A narrower style search matched Minimalism & Swiss Style for enterprise dashboards; only applicable clarity and restraint principles were used. Impeccable's Operate guidance supports the same direction. Its generated design sidecar was flagged stale; this assessment did not repair unrelated design configuration.

## Demo story and delivery order

Use explicitly labeled demo vehicles to show: mileage already overdue with zero recent trips; a well-supported future due estimate; missing odometer/schedule; a repeated inspection complaint; an already-linked open work order; and completion of one service without resetting another.

Deliver correctness and data setup first, then one complete service-to-work-order flow with the unified UI, then the extra task types, one condition signal and lightweight evaluation. A dispatch-aware service slot suggestion can follow later when job duration and resource availability are reliable; do not silently reschedule existing trips.

## Verification and references

Assessment verified by reading repository policy, relevant vault sections, shared design guidance, prediction engine/API, maintenance completion and schedule code, both prediction presentations, and existing test coverage through a parallel read-only review. No application tests, live SQL, authenticated browser walkthrough or model evaluation were performed. Documentation encoding/whitespace verification is recorded in the task response; no runtime-fix claim is made.

External terminology cross-check: [IBM predictive maintenance](https://www.ibm.com/think/topics/predictive-maintenance/jcr%3Acontent) distinguishes condition-based failure prediction from scheduled preventive maintenance. [Geotab reporting](https://support.geotab.com/help/mygeotab/reports/managing-reports/reporting-in-mygeotab) documents time/mileage/hour reminders, schedules, work jobs and unrepaired defects as separate operational views. These support the product framing, not claims about FleetOps accuracy.
