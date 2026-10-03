---
type: plan
status: implemented-locally
tags: [incidents, mobile, driver, safety, implementation-plan]
source:
  - mobile/app/(app)/incidents.js
  - mobile/metro.config.js
  - mobile/components/DriverSos.js
  - mobile/lib/sync.js
  - mobile/lib/sync.test.js
  - mobile/app/(app)/profile/help.js
  - src/app/api/driver/incidents/route.js
  - src/app/api/driver/incidents/route.test.js
  - shared/incidents/severity.js
  - src/lib/incidents/severity.test.js
  - supabase/migrations/141_driverincident_severity_assessment.sql
  - src/lib/driver/grounding.js
  - src/app/(dashboard)/incidents/page.js
  - Capstone/01 - System/UI UX Audit - Mobile.md
last_reviewed: 2026-10-03
---

# Guided Incident Severity Recommendation — Implementation Plan

**Status: implemented locally on 2026-10-03.** Mobile and server changes are in the working tree, and migration 141 is applied to the configured Supabase project. The app is not deployed; manual device/accessibility acceptance and incident-response owner review remain before calling the flow operationally accepted.

## Goal and confirmed decisions

Help drivers report the urgency of an incident in familiar terms instead of asking them to choose among four unexplained severity chips. Use a deterministic, answer-based recommendation, explain its basis, and let the driver override it. A brief confirmation appears before a typed report is submitted as Critical. The floating SOS path remains a direct Critical emergency report and bypasses the guided questions.

The classifier is operational guidance, not a medical diagnosis, free-text AI classifier, or emergency-service dispatch system. A driver who needs immediate help must still be able to use SOS and the existing 911 guidance.

## Baseline before implementation

- Before this implementation, the typed mobile form in `mobile/app/(app)/incidents.js` had six categories and four unlabeled chips (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). It started at `medium`, which was sent as `Moderate` if the driver did not change it.
- `POST /api/driver/incidents` accepts the four stored values and defaults missing or invalid severity to `Minor`. It sets the response deadline from the stored severity: Critical 2 hours, Major 24 hours, Moderate 72 hours, Minor 7 days.
- Severity has operational consequences. `Major` and `Critical` ground an assigned vehicle; breakdown categories ground it at every severity. Breakdown reports create maintenance work, while severe or explicitly damaged accident reports can also create it. Critical/Major reports are included in the urgent SLA notification path.
- `mobile/components/DriverSos.js` sends type `Emergency`, severity `Critical`, and Medical Assistance directly. Offline POSTs can be queued, so the assessment and confirmation must survive replay with the same `client_submission_id`.
- The driver help article formerly told drivers to select Critical manually; it now describes the guided recommendation and SOS.

## Implemented driver flow

1. Keep the existing category, description, assistance, photo, vehicle/trip, and location fields. After category selection, the form asks four coded safety/impact questions.
2. Show the recommended level and a plain-language reason after all four answers are selected.
3. Drivers can open **Change severity**, choose any of the four levels, and select a short override reason. Changing an answer recalculates the recommendation and clears the old override.
4. Typed Critical reports show a native confirmation with the answer basis and **Confirm and send Critical report** / **Review answers** actions. Android Back closes the dialog. Choosing below a Critical recommendation also requires the driver to affirm that they rechecked immediate danger.
5. SOS remains a direct Critical submission and records SOS provenance. Its user interaction and call-emergency-services guidance are unchanged.

Do not infer urgency from category alone, an assistance chip alone, or incidental words in the free-text description. An `Unsure` answer must never silently become Minor or be promoted to Critical without an affirmative danger signal; show an explicit safety explanation and let the driver escalate.

## Implemented deterministic rule table — version 1

Version 1 is implemented in shared/incidents/severity.js. Category-specific copy clarifies the first and fourth questions, while the same coded answers feed Expo and the API. An Unsure answer is never Minor and never produces Critical without an affirmative immediate-danger answer.

| Stored level | Driver-facing meaning | Example signals for the deterministic rule |
|---|---|---|
| Critical | Immediate danger to a person; use SOS or emergency services for immediate help | The driver answers Yes to whether anyone needs emergency help or is in immediate danger. Typed Critical sends require a brief confirmation. |
| Major | Urgent safety review is needed | Immediate danger is Unsure; vehicle safety is Unsafe or Unsure; or a current hazard to people/traffic is Yes or Unsure. |
| Moderate | The incident disrupts operations without a stronger safety signal | The trip is Delayed or Stopped after immediate danger is No and no Major vehicle/hazard signal applies. |
| Minor | No current safety concern or trip disruption was reported | Immediate danger is No, vehicle is Safe or Not applicable, no hazard is reported, and the trip is Not affected. |

The form asks about immediate danger, vehicle safety, trip impact, and hazards to people or traffic. Assistance chips and free-text descriptions do not change the recommendation. A driver override is recorded using a reason code; a lower-than-Critical override requires an explicit recheck of the immediate-danger answer.

## Delivered implementation

### 1. Shared policy

- Added dependency-free, versioned rules shared by Expo and Next.js; Metro watches only the shared folder.
- Added tests for every rule branch, missing/invalid answers, override reasons, rule version, Critical confirmation, SOS, and legacy compatibility.

### 2. Mobile and offline flow

- Replaced the four unexplained severity chips with progressive questions, a recommendation/rationale card, severity override levels, and override reason choices.
- Added vehicle stand-down context for Major/Critical assigned-vehicle cases and breakdown reports.
- The coded answers, final level, confirmation flags, and submission ID stay in the existing queued request body; an offline replay test verifies this.
- Updated driver FAQ, tutorial copy, immediate-emergency/SOS banner copy, and conditional GPS wording.

### 3. API, database, and reviewer provenance

- POST /api/driver/incidents recomputes the recommendation and validates answer, override, and Critical-confirmation fields before insert.
- Severity-only legacy requests still insert with NULL provenance; historical incidents were not backfilled. SOS remains direct Critical and is tagged as SOS.
- Existing grounding, maintenance, due-date/SLA, and notification code continues using the final severity column.
- Migration 141 adds nullable assessment JSON and a shape CHECK to driverincidents. db:status, db:check, db:up, db:dump, and db:contract were run; no new table or RLS surface was added.

### 4. Verification and remaining acceptance

- Touched-source ESLint, 30 classifier/route/offline tests, and Expo Android export passed.
- Final `db:contract` classified 68 live relations with 0 violations. `driverincidents` and the concurrently observed `system_health_snapshots` table both have RLS enabled and no anon policy; `verify:anon` returned an explicit refusal for the telemetry table. `npm run db:status` reports 141 on-disk migrations applied, 0 pending, and 0 changed. Migration `142_system_health_telemetry.sql` is now present on disk with a matching ledger checksum, and the live schema dump includes the table.
- Android/iOS VoiceOver/TalkBack, small-screen device review, live mobile incident submission, and incident-response owner review remain pending.

## Acceptance criteria

- A driver can answer the short questions and understand both the recommended level and why it was chosen.
- Critical is never selected solely because of a category, assistance request, or free-text keyword; a typed Critical send has the brief confirmation, while SOS remains direct.
- Drivers can override a recommendation, and staff can distinguish the final level from its recommendation and provenance.
- Old app versions and reports queued before upgrade continue to submit without being reclassified.
- Severity-driven safety side effects remain consistent with the final stored severity and current grounding policy.

## Scope boundaries

- No machine-learning or LLM classification, diagnosis, automatic 911 call, or changes to staff severity policy.
- No broad redesign of the incident workflow and no change to the SOS interaction.
- No retroactive severity recalculation for existing reports.

## Implementation boundary

This is implemented locally and the schema migration is live in the configured project; application deployment and acceptance are not complete. Before broad operational release, the incident-response owner should review the version 1 question wording and thresholds, and a device pass should walk through Minor, Moderate, Major, Critical, overrides, offline replay, and SOS. The classifier does not replace emergency services, dispatch judgment, or staff review.
