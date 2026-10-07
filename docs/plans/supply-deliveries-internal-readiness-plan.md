# Supply Deliveries Internal Readiness Implementation Plan

**Status:** Functional fixes and FleetOps UI alignment complete; authenticated non-production acceptance pending  
**Date:** 2026-10-07  
**Scope:** Improve the existing FleetOps Supply Deliveries sandbox workflows. There is no SCM/HR integration in scope.

## Objective

Make the current shipment import/list, Fleet site mapping, cargo-profile editor, and measurement pre-screen easier to operate and harder to misread, while preserving FleetOps permissions and the current sandbox-only boundary.

The module remains a measurement pre-screen. `assignment_eligibility` stays `NOT_EVALUATED`; this work must not create or reserve dispatches/trips, expose cargo work to drivers, collect receipt/POD, or post inventory.

## Current baseline

The current worktree already contains fixes for stale load-fit responses, preserving unsaved cargo-profile edits during profile refetches, refreshing admin site mappings with the other page data, and displaying unavailable mapping coordinates without converting null values to `0, 0`. JSX parsing and `git diff --check` passed for that work. ESLint previously stopped on Node heap exhaustion, and an authenticated browser walkthrough has not been completed.

## Implemented work

### 1. Cargo-profile validation matches the API

**Files:** `src/app/(dashboard)/supply-deliveries/page.js`; use `src/app/api/supply/vehicles/cargo-profile/route.js` as the authoritative constraint source.

- Extend the shared `Field` input support for `max`, `minLength`, `maxLength`, and accessible inline error associations where needed.
- Keep required measurements positive, with API maxima: mass fields up to 1,000,000 kg, usable volume up to 10,000 m³, and compartment/opening dimensions up to 100 m. Allow an operational reserve of zero, up to 1,000,000 kg.
- Restrict optional temperature endpoints to -80 through 80 °C and show the range error when the minimum exceeds the maximum.
- Require gross vehicle weight limit to exceed operating mass.
- Match verification-reference trimming and length rules (3–255 characters) and require its value when enabling the profile.
- Prevent a verification-valid-until date that is today or earlier, using the same UTC-day comparison as the API.
- Preserve form values when validation fails. Keep server validation authoritative and show its field-specific errors inline when available; do not rely on browser attributes as the security boundary.

**Acceptance:** Every value rejected by the existing API is either blocked with a clear field-level explanation before submission or reported against the relevant field after server validation. Valid boundary values, including a zero reserve and exactly the API maximum, remain saveable.

**Implemented:** The editor now applies the API's positive/max bounds, zero-reserve allowance, optional temperature range and ordering, GVW-to-operating-mass rule, trimmed reference length, and future UTC-date rule. Local and keyed server errors are shown beside their fields, focused for correction, and cleared as the related values change. The server remains authoritative.

### 2. Single-vehicle results state their scope

**Files:** `src/app/api/supply/shipments/evaluate/route.js`, `src/app/(dashboard)/supply-deliveries/page.js`.

- Return `assignment_eligibility: "NOT_EVALUATED"` from the single-vehicle endpoint, matching the fleet comparison response.
- In the individual result, label a passing result as a measured-load pass and show an adjacent “Assignment not evaluated” notice.
- Render the evaluator’s limitations near that result. Keep driver, schedule, route, documents/roadworthiness, axle balance, and securement clearly outside the measurement pass.
- Preserve the existing shipment/vehicle/source-data stale-response guards.

**Acceptance:** Neither the individual nor fleet result can be read as an assignment recommendation. A measurement PASS remains distinct from eligibility.

**Implemented:** The single-vehicle endpoint returns `assignment_eligibility: "NOT_EVALUATED"`. Its result labels measurement status separately, shows an adjacent assignment notice, and displays the evaluator's limitations. The existing stale-response guards remain in place.

### 3. Cargo-profile provenance is explicit

**Files:** `src/app/(dashboard)/supply-deliveries/page.js`.

- Replace the UI’s bare “Verified” display with wording that describes the current data faithfully as the profile’s latest recorded save.
- Display the existing `verified_by` value as the recording employee identifier and the associated timestamp/reference, without adding employee-directory fields or broadening API permissions.
- State that this save record is not a separate compliance approval. Do not change who may edit profiles, when metadata is stamped, or what policy qualifies a verifier; those rules have no approved owner specification.

**Acceptance:** Users can identify who last recorded the profile and when, and the UI does not imply that FleetOps performed a separate approval step.

**Implemented:** The editor describes the metadata as the latest recorded save and displays the existing employee ID, timestamp and verification reference. It says explicitly that the record is not a separate compliance approval; no metadata semantics or permissions changed.

### 4. Apply established FleetOps UI/UX patterns

**Files:** `src/app/(dashboard)/supply-deliveries/page.js`.

- Use the existing inverse-theme hero action, shared metric cards, field controls, labels, and empty-state component.
- Group the primary request/measurement work, Admin sandbox setup, and Fleet cargo-profile editor by task and audience.
- Make loading, request failure/retry, no-data, active-selection, and responsive form states clear using current design tokens and reduced-motion behavior.

**Implemented:** Supply Deliveries now uses the shared `HeroHeader` button treatment, `StatGrid`/`StatCard`, `Input`/`Label`, `EmptyState`, and Radix `Select` menus for shipment, vehicle, sandbox-site, and Fleet-location selection. Admin sandbox actions are grouped apart from Fleet profile editing; request selection is visible; cargo fields are grouped by capacity, dimensions, temperature/handling, and verification. Loading, retry/error, and empty states are explicit. Existing behavior and access boundaries are unchanged. The custom menu rendering has passed source parsing and diff checks; browser appearance and interaction have not been previewed.

## Remaining acceptance: authenticated non-production walkthrough

**Precondition:** Sign in to the local non-production FleetOps app as Admin or Super Admin for import and site mapping. Use only designated synthetic sandbox data and confirm the configured environment has `SUPPLY_SCM_SANDBOX_ENABLED=true`; the importer is disabled in production. A Fleet Manager can review cargo-profile editing without admin-only import/mapping access.

Walk through:

1. Import the built-in synthetic event; confirm the shipment appears with its revision, site IDs, delivery window and measurement totals.
2. Replay the same event; confirm idempotent behavior and no duplicate shipment.
3. Exercise a malformed/invalid event and confirm the form retains input and displays a useful error.
4. Map pickup and delivery sites to eligible Fleet locations; refresh and confirm saved mappings and coordinates reload. Confirm missing/invalid/inactive location facts appear unavailable rather than as coordinates.
5. Save, disable, and re-enable a cargo profile. Try representative invalid values and confirm client/API validation parity and preserved drafts after refresh.
6. Run individual and fleet load-fit checks. Change shipment/vehicle selections and refresh while a check is pending; confirm stale responses do not appear and both result surfaces keep assignment eligibility `NOT_EVALUATED`.
7. Confirm role boundaries: dispatch-facing roles can use only the read/pre-screen capabilities granted to them; profile editing follows `vehicles.update`; only Admin/Super Admin see sandbox import and site-mapping controls.
8. Confirm no action on this page creates a dispatch/trip, driver job, receipt, or inventory posting.

The last recorded browser inspection stopped at `/login`; acceptance is pending until an authorized user session is available. Do not create synthetic rows in a shared or live database for this walkthrough.

## Verification completed and still required

1. Focused code review found no changes to schema, role grants, dispatch assignment, driver/mobile behavior, or inventory paths.
2. Espree parsing passed for the page and single-vehicle evaluation route; `git diff --check` passed.
3. Focused ESLint exited 0 with 0 errors and 16 React hook warnings for page hook dependencies and state/ref patterns.
4. The authenticated non-production walkthrough above remains required. The last browser inspection stopped at `/login`; no sandbox rows were imported and no live/shared data was changed. Do not describe source checks as browser or live-data acceptance.

## Out of scope and deferred

- SCM/HR connectivity, partner credentials/contracts, or owner decision collection.
- Cargo assignment/eligibility, reservation rules, driver execution/mobile projection, receiving/POD, retry/outbox, cargo reporting, and inventory posting.
- New safety or legal defaults for license class, training, schedule interval, load-plan verification, axle balance, or securement. Keep unknown eligibility fail-closed.
- Shipment pagination/search until sandbox volume or measured rendering/query performance demonstrates a need; the current list endpoint returns all shipments.

The functional items changed the Supply Deliveries client page and single-evaluation response; UI alignment changed presentation only. No operational data was changed. Acceptance remains incomplete until the walkthrough is visibly confirmed in an authorized non-production session.
