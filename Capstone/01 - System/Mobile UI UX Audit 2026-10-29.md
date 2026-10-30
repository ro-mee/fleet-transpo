---
type: audit
title: Mobile UI UX Audit 2026-10-29
tags: [mobile, ux, accessibility, driver, audit]
last_verified: 2026-10-29
---

# FleetOps mobile UI/UX audit

Audit baseline: the current working checkout, including the owner's uncommitted October 28 launch and Home changes. Method: source inspection, independent reviews of trip/Map/Cargo, forms/profile/guidance and native accessibility, plus existing actual-component captures. No application source was changed before this report was assembled. The owner's follow-up explicitly authorizes implementation after the audit. This note records the baseline findings; the implementation plan records their final disposition.

Evidence boundaries: code can establish controls, contracts, conditions, token contrast and likely layout risks. It cannot establish outdoor visibility, a 3–5-second comprehension time, native text layout, GPS reliability, TalkBack/VoiceOver behavior or frame rate without device/user testing. Existing React Native Web fixtures substitute native services and contain sample data. No authenticated operation or database change is part of this audit. Paths below are repository-relative and identify real files.

### Selected styling rollback — 2026-10-30

The owner requested undoing bottom-nav, card/button and Home-header visual changes after reviewing actual before/current captures. Restored those original appearances; input and popup changes plus confirmed behavior fixes remain. Earlier visual recommendations for flattening these selected surfaces are superseded. See [[Mobile Home Claymorphism Implementation Plan#Selected visual changes undone — 2026-10-30]] for verification and remaining device limits.

### Owner correction: Home design restoration — 2026-10-29

The user clarified that enhancement must preserve the recently approved Cargo and Hotel Home images/design. The audit's removal was an implementer decision, not an accepted requirement. Restored the original illustrated scene/headings/colors and top-of-Home overview, summary/vehicle row, loading shapes and Home-only materials from the saved pre-audit source. The relevant recommendations to remove the scene/marketing headline or move its counts below assignments are superseded by this explicit direction. Other confirmed workflow/accessibility fixes remain. Follow [[Mobile Home Claymorphism Implementation Plan#Owner correction: restore the illustrated Home — 2026-10-29]] for the latest implementation/checks. Future audits must improve this visual design rather than silently remove approved content.

### Implementation closeout — 2026-10-29

Completed the approved plan after the existing baseline audit. The baseline findings below remain a historical record; their implemented disposition is documented in [[Mobile Architecture#Mobile usability implementation — 2026-10-29]] and the feature notes for Fuel, Trips, Incidents, Driver Consent and Cargo signatures. Home/navigation/shared controls and form/Cargo recovery are implemented. Independent review additionally corrected dropped api.get options, stale responder mission writes, comma-only fuel input, stacked header flex height, enlarged tab clearance and low-contrast upcoming labels. No new dependency/SDK/database/deployment or commit was introduced; preexisting launch/branding work was preserved.

Final gates: 1,602 tests passed across136 files (full mobile/lib plus responder identity and shared-policy compatibility); strict ESLint passed82 changed JavaScript files; Android Hermes export passed (1,538 modules,6,488,762-byte bundle,99 asset files); UTF-8 and whitespace gates passed. This is JS/assets verification, not an APK/native/device result.

After the owner explicitly confirmed removal on 2026-10-29, the app deleted the one-time Continue FleetOps mobile UX audit automation (continue-fleetops-mobile-ux-audit); its deletion response confirmed deleteStatus=deleted. The earlier approval block is resolved.

Actual-component React Native Web fixtures were inspected for Cargo/Passenger light, Passenger dark with simulated2x OS/1.15x app text and Cargo320dp high-contrast dark. These samples exposed and confirmed header/nav corrections; automated contrast checks cover all four palettes. The black fixture was deliberately high-contrast dark, not a new default; theme settings were not changed. Browser control became disabled in Work settings before broader shared alert/input/Cargo/signature visual checks, which remain unverified. Physical native screen readers/focus/keyboard/Back, camera/signature/permission return, Google Maps/background delivery, outdoor readability, release performance, tablets and installed splash/icon/audio remain pending. No real operating trip or production data was exercised.

## 1. Executive Summary

FleetOps has a substantial operational foundation worth preserving: native Expo routes, server-owned trip transitions, current-account guards, Passenger/Cargo specialization, inspection gates, signed Cargo handovers, Google Maps handoff, offline warnings and contextual guidance. The app needs focused correction and a quieter presentation rather than replacement.

- **Strongest areas:** trip readiness/authority checks; real Cargo observations separated from Fleet clearance; shared theme and components; explicit loading/offline states; the current bounded launch and reduced-motion fallback.
- **Weakest areas:** inconsistent native accessibility in shared inputs/dialogs; a redundant old Map route; truthful feedback for operations queued locally; decorative Home content ahead of current work.
- **Biggest usability problem:** a driver can receive a success or actionable interpretation that the server has not established, including session revocation and some trip conflict feedback.
- **Biggest visual consistency problem:** three shared material engines deliberately add inset highlights, thick top/bottom edges and repeated elevation. These conflict with the requested Soft UI Evolution / Elevated Clean direction.
- **Biggest workflow opportunity:** put duty, current assignment and incidents first; use canonical routes and state-specific actions; retain optional supporting detail below.

No P0 is proven by this audit. P1 findings include high-contrast dark status contrast, blank fuel interpreted as zero, document replacement being hidden for valid licenses, local-only revocation presented as completed, and Cargo lookup limited to an unrelated list page. Device-only risks remain explicitly unverified.

## 2. Current Mobile Architecture

- `mobile/package.json`: Expo 54, React Native 0.81.5, React 19.1, Expo Router 6. No SDK upgrade is needed for the recommendations. `mobile/AGENTS.md` requests reading the Expo 57 documentation; that was read without treating it as an instruction to upgrade installed packages.
- `mobile/app/_layout.js`: fonts, auth/settings/theme providers, splash and launch overlay, global alerts/notifications, queue sync. `mobile/app/(app)/_layout.js`: driver/password/consent guards, the single active-trip GPS poster, notifications/connectivity and guidance providers.
- `mobile/app/(app)/(tabs)/_layout.js` and `mobile/components/CurvedPillTabBar.js`: **four visible destinations**, Home/Map/Trips/Profile, plus a fuel scan action outside Map. History, notifications, vehicle and `fuel_action` are hidden routes. This is not five equal navigation destinations.
- `mobile/lib/theme.js`, `theme-context.js`, `settings-context.js`, `scaling.js`: forest/ivory/brass, Plus Jakarta Sans and IBM Plex Mono, four palettes, semantic colors and app text settings. The root web `PRODUCT.md`/`DESIGN.md` do not define the native UI and are partly stale.
- `mobile/components/clay/`, `mobile/lib/clay.js`, `mobile/components/home/materials.js`: reusable native card/button/input/tile/badge system, currently with heavy molded styling. Keep public component names to avoid a broad migration.
- `mobile/lib/driver-workspace.js`: saved `driverType` chooses Cargo/Passenger; active-trip vehicle/load compatibility gates actions. Unknown/mismatched values show a setup/block reason. Do not infer specialization solely from vehicle appearance or service name.
- UI state comes from local hooks/context, `useDriverProfile`, `useDuty`, `usePreShift`, trip reference helpers, per-driver offline caches and Cargo session/form/sync helpers. Backend state remains authoritative; these recommendations do not introduce another trip store.

The mobile README incorrectly says background GPS, notifications and offline sync are absent and lists an obsolete tab layout. Current source and newer vault notes supersede that description; update it as part of this work.

## 3. Screen Inventory

All paths in this table begin with `mobile/`.

| Screen | Route/File | Purpose | User | Current State |
|---|---|---|---|---|
| Native/JS launch | `app/_layout.js`, `components/LaunchScreen.js` | Restore app and reveal brand | All | Bounded light/dark/HC, audio/static fallbacks |
| Login | `app/login.js` | Driver sign-in | Signed out | Password form, role guard, recovery, demo entry |
| Forgot password | `app/forgot-password.js` | Request recovery | Signed out | Email and feedback |
| Reset password | `app/reset-password.js` | OTP/recovery and new password | Recovering | Shared password/OTP UI |
| Set password | `app/set-password.js` | Replace temporary credential | Invited driver | Required password flow |
| Consent | `app/consent.js` | Accept privacy version | Driver | Summary and checkbox gate |
| First permissions | `app/permissions.js` | Explain/request permissions | Driver | Native permission actions |
| Return from Maps | `app/redirect-trip.js` | Restore canonical Map | Driver | Guarded refresh link |
| Cargo sample | `app/cargo-demo.js` | Explicit isolated demo | Demo user | Sample mode, not operating data |
| Home | `app/(app)/(tabs)/index.js` | Duty/current/next work | Driver | Specialized hero, cards, shortcuts |
| Trips | `app/(app)/(tabs)/trips.js` | Today/upcoming/history | Driver | SectionList, date tabs and pagination |
| Map/active trip | `app/(app)/(tabs)/map.js` | Route/current state actions | Driver | TomTom WebView, draggable sheet, Google Maps |
| Hidden legacy Map | `app/(app)/(tabs)/vehicle.js` | Older duplicate map | Driver | Old status/manual odometer flow |
| Hidden fuel stub | `app/(app)/(tabs)/fuel_action.js` | Router placeholder | Driver | Renders null |
| History | `app/(app)/(tabs)/history.js` | Completed/past work | Driver | Cached list and filters |
| Notifications | `app/(app)/(tabs)/notifications.js` | Assignment/operational alerts | Driver | Read/dismiss/retry states |
| Profile | `app/(app)/(tabs)/profile.js` | Driver account/work links | Driver | Specialization-aware hub |
| Trip details | `app/(app)/trip/[id].js` | Review assignment/readiness | Driver | Load-aware details and actions |
| Cargo overview | `app/(app)/trip/[id]/cargo.js` | Manifest and clearance | Cargo | Shared CargoWorkflowScreen |
| Cargo pickup | `app/(app)/trip/[id]/cargo-pickup.js` | Count and handover | Cargo | Review/sign/submit with drafts |
| Cargo delivery | `app/(app)/trip/[id]/cargo-delivery.js` | Receiving acknowledgment | Cargo | Counts/evidence/signature/decision |
| Odometer | `app/(app)/trip/odometer.js` | Start photo and reading | Driver | Real camera/review and authority checks |
| Completion | `app/(app)/trip/complete.js` | End reading and complete | Driver | Actual photo/reading and Cargo gates |
| Arrival override | `app/(app)/trip/override.js` | Explain remote arrival | Driver | Typed reason, audited transition |
| Inspection | `app/(app)/inspection.js` | Pre-Shift/Pre-Trip | Driver | Real checklist, photo and submission states |
| End duty | `app/(app)/end-duty.js` | Shift condition report | Driver | Atomic report/close, real busy checks |
| Fuel | `app/(app)/fuel-report.js` | Request/receipt/scan | Driver | Existing form and review stages |
| Incident reporting | `app/(app)/incidents.js` | Routine/emergency report | Driver | Categories, evidence and confirmation |
| Incident details | `app/(app)/incident/[id].js` | Response/current incident | Driver | Record state and assistance details |
| Incident navigation | `app/(app)/incident/navigate.js` | Respond to assigned incident | Driver | Map/navigation context |
| Work schedule | `app/(app)/work-schedule.js` | Shifts/leave | Driver | Schedule, leave form/history |
| Activity log | `app/(app)/submissions.js` | Fuel/inspection/incident records | Driver | Cache, filters, failed report recovery |
| Devices | `app/(app)/devices.js` | Review/revoke sessions | Driver | Destructive confirmation and current device |
| Settings | `app/(app)/settings.js` | Theme/text/preferences | Driver | Native switches and text-size modal |
| Personal info | `app/(app)/profile/personal.js` | Saved identity/contact | Driver | Read-only identity, editable phone |
| License/documents | `app/(app)/profile/license.js` | Compliance/scans/renewal | Driver | Private reveal, front/back scans and audit |
| Assigned vehicle | `app/(app)/profile/vehicle.js` | Vehicle/plate/documents | Driver | Actual assigned vehicle, no invented vehicle editor |
| Change password | `app/(app)/profile/change-password.js` | Account security | Driver | Validated password form |
| Permission settings | `app/(app)/profile/permissions.js` | Review permission state | Driver | Readable state and native settings |
| Privacy | `app/(app)/profile/privacy.js` | Accepted policy and rights | Driver | Server policy sections and consent metadata |
| Help | `app/(app)/profile/help.js` | FAQ/guides/support | Driver | Expandable FAQ, reset tips, placeholder contacts |
| About | `app/(app)/profile/about.js` | Version/product/support | Driver | Shared logo/version, placeholder contacts |
| Guide practice | `app/(app)/profile/guide-practice.js` | Optional sample practice | Driver | Existing isolated practice host |
| Overlays/system states | `components/AppAlert.js`, `NotificationHost.jsx`, `OfflineStates.jsx`, `ConnectivityBanner.jsx`, `error-boundary.js` | Feedback/recovery | Driver | Shared system UI |
| Cargo issue/signature | `components/cargo/CargoIssueSheet.jsx`, `CargoSignatureModal.jsx` | Evidence and handover | Cargo | Existing sheets/modal |
| Route options/guidance | `components/RouteOptionsSheet.jsx`, `components/coachmarks/` | Route choice/contextual help | Driver | Existing route options and real target measurement |

## 4. Screen-by-Screen UI/UX Audit

The following entries assess purpose/action, hierarchy, layout/type/color/materials, controls/forms, navigation/status/error prevention, loading/empty/error/success behavior, accessibility, readability, one-hand use, cognitive load and consistency. Findings marked as a risk require native verification; “no new defect confirmed” is not a claim of exhaustive device acceptance.

### Launch / opening
**Current implementation:** local reference artwork, brand reveal and sound, bounded handoff and static reduced-motion/error mode in `components/LaunchScreen.js`, `lib/use-launch-sequence.js`. **Problems:** installed audio/icon/splash and smoothness still lack device acceptance. **Severity:** P3 verification. **Recommended changes:** retain the completed launch; test native silent-mode/cold start later. **Keep:** exact brand/proportions, timing and lifecycle protections. **Remove:** no launch content in this pass.

### Login
**Current implementation:** driver-only sign-in and shared ClayInput password visibility. **Problems:** the visibility control is 28dp and unnamed; primitive fonts do not match registered names (`components/clay/ClayInput.jsx:138–149,172–202`). **Severity:** P1/P2. **Recommended changes:** fix the primitive once, preserve paste/secure input/role checking. **Keep:** loading/errors/recovery. **Remove:** heavy input embossing.

### Forgot password
**Current implementation:** email-based recovery with existing generic response handling. **Problems:** shared input consistency and raised material excess. **Severity:** P2. **Recommended changes:** apply accessible input defaults and quieter shared surfaces. **Keep:** recovery contract and generic account-safe feedback. **Remove:** no recovery step.

### Reset password
**Current implementation:** recovery/OTP and validated password controls. **Problems:** shared password action targets/names/fonts. **Severity:** P1/P2. **Recommended changes:** shared input repair, check keyboard/large text. **Keep:** OTP/paste, errors and attempt rules. **Remove:** no security check.

### Set password
**Current implementation:** invited drivers must replace temporary credentials. **Problems:** same password action accessibility defect. **Severity:** P1. **Recommended changes:** shared primitive fix. **Keep:** mandatory-password routing and validation. **Remove:** no credential gate.

### Consent
**Current implementation:** three summary cards and a versioned acceptance in `app/consent.js`; `OnboardingConsentRow.jsx` styles Terms/Privacy as links but the entire row only toggles acceptance. **Problems:** policy-looking text does not open the actual policy. **Severity:** P1. **Recommended changes:** display the existing shared policy before acceptance through an explicit Read policy control; keep checkbox separate. **Keep:** policy version and server acceptance. **Remove:** deceptive link styling/unused chevrons, not policy content.

### First-run permissions
**Current implementation:** native request actions and permission states. **Problems:** status chips inherit broken HC-dark colors; long onboarding copy/illustration needs hardware text/keyboard verification. **Severity:** P1 shared contrast/P2 layout risk. **Recommended changes:** semantic status fix; retain explanations and denied/settings paths. **Keep:** explicit opt-in. **Remove:** unnecessary decorative sheen through shared styles.

### Home
**Current implementation:** header identity/weather/bell, past-report/pre-shift/end-duty prompts, illustrated hero with two metrics and assigned vehicle, workspace notice, current trip, shortcuts, upcoming/empty states (`(tabs)/index.js:569–787`, `DriverHomeCards.jsx:36–92`). **Problems:** date/tagline/art/statistics consume attention before current trip; Cargo alone has the hero duty ribbon; on-duty Passenger prepends End Duty and pushes Report Incident into More (`index.js:547–554`). **Severity:** P1 incident access/P2 hierarchy. **Recommended changes:** lead with compact truthful duty/current-state summary for both types, put the current assignment before secondary counts, preserve distinct load information, keep Incident among four visible shortcuts and End Duty independently reachable. **Keep:** actual profile/vehicle data, unknown and saved-data distinctions, missed report/pre-shift gates and current-before-shortcuts behavior. **Remove:** marketing headline and large decorative scene from the work overview, nested raised tiles and duplicate normal workspace label where identity already states it.

### Duty state / End duty
**Current implementation:** shared `use-duty.js`, Pre-Shift starts shift, report submission closes it; `end-duty.js` retains server busy/shift checks. **Problems:** Passenger Home lacks a persistent concise state; a visual toggle would misrepresent an atomic workflow. **Severity:** P2. **Recommended changes:** visible On Duty/Off Duty/checking label with shield/time icon and supporting text; link to existing inspection/report actions. **Keep:** atomic server workflow and busy protections. **Remove:** no safety checks; do not introduce a direct local toggle.

### Trips
**Current implementation:** SectionList with Today/Upcoming/History, grouped dates, manual pagination, refresh/empty/error/offline states. **Problems:** current cards inherit over-raised materials and shared HC-dark issue; native large-text verification remains. **Severity:** P1 shared contrast/P2 presentation. **Recommended changes:** preserve list and scope, quiet shared card surfaces. **Keep:** virtualization and date tabs. **Remove:** no tab purely for aesthetics.

### Trip details
**Current implementation:** actual assignment/readiness, Passenger/Cargo load presentation, inspection and start/complete destinations. **Problems:** dense repeated raised groups compete with the next required step. **Severity:** P2. **Recommended changes:** use one card per meaningful group, preserve next-state CTA and blockers; apply shared visual/accessibility fixes. **Keep:** server data, direct trip read and route preview. **Remove:** redundant depth, not guest/cargo/vehicle facts.

### Active trip / Map
**Current implementation:** real draggable/minimizable sheet, route metrics, recenter/options/external navigation, state-dependent swipe and detail links (`map.js:2188–2550`). **Problems:** all transition 409 errors are interpreted as geofence failures, though state/eligibility conflicts also return 409 (`2402,2441,2485`); sheet handle lacks button semantics; some sheet animation ignores reduced motion. **Severity:** P1 false override/P2 accessibility. **Recommended changes:** offer override only for `GEOFENCE_OUTSIDE`, surface other failures as their real error; name/size the expand/collapse button and honor reduced motion. **Keep:** the existing sheet, canonical target, GPS/permission/service guards and state-specific controls. **Remove:** duplicate Map implementation, not this working one.

### Hidden legacy Map / vehicle route
**Current implementation:** `(tabs)/vehicle.js` exports older `FullMapTab` with independent watch-only location subscription, old status/manual odometer actions and a destination-only external launcher. It is hidden but still addressable. **Problems:** it exposes a second, outdated user journey; load errors appear as no assignment. **Severity:** P1/P2. **Recommended changes:** redirect old route to `/map`. **Keep:** route compatibility and actual `/profile/vehicle`. **Remove:** old UI handlers after redirect. Do not claim it owns a second GPS poster: its hook is watch-only.

### Fuel action placeholder
**Current implementation:** hidden route renders null; the scan button already opens Fuel. **Problems:** direct old route can be blank. **Severity:** P2. **Recommended changes:** route to existing `/fuel-report`. **Keep:** URL compatibility. **Remove:** blank dead end.

### History
**Current implementation:** cached trip list/filter and actual brand header. **Problems:** duplicates the historical discovery path in Trips; legacy all-query list is bounded and not a full archive. **Severity:** P2. **Recommended changes:** retain compatibility, clearly describe loaded scope; use Trips History as primary discovery rather than building another archive. **Keep:** existing cards, cache and filters. **Remove:** unsupported “complete history” implications.

### Notifications
**Current implementation:** read/unread/severity labels, wrapping messages, separate 48dp dismiss, refresh errors retained by provider. **Problems:** HC-dark status colors and global toast translation under reduced motion. **Severity:** P1/P2 shared. **Recommended changes:** shared fixes; preserve explicit read/dismiss feedback. **Keep:** grouping, retries, provider identity optimization and independent dismiss. **Remove:** no notification information.

### Profile
**Current implementation:** saved driver identity, specialization, work/account links and sign-out. **Problems:** repeated raised card/tile/pill hierarchy and shared small-text/HC issues. **Severity:** P2. **Recommended changes:** quiet shared surfaces; keep Vehicle/License/Schedule/Settings secondary. **Keep:** current role, identity and safe sign-out. **Remove:** redundant decorative elevation.

### Cargo overview
**Current implementation:** shared `CargoWorkflowScreen` and view model present real manifest, local/server state and clearance. **Problems:** trip lookup reads first 100 chronological records then finds ID (`CargoWorkflowScreen.jsx:53`, `cargo-view-model.js:147–150`), so a legitimate assignment can disappear. **Severity:** P1. **Recommended changes:** use the already-supported `trip_id` filter rather than an arbitrary list page. **Keep:** current-session/freshness/compatibility guards and backend decisions. **Remove:** capped-list lookup dependency.

### Cargo pickup
**Current implementation:** quantity/condition/evidence review, saved drafts and signed releasing-staff acknowledgment. **Problems:** signature view asks users to review prior counts without showing those same reviewed counts inside the signing context. **Severity:** P2. **Recommended changes:** pass frozen reviewed line quantities into the existing modal; retain context version checks. **Keep:** count validation, private evidence, pending immutable retries and authority separation. **Remove:** no required evidence or review step.

### Cargo delivery
**Current implementation:** receiver acknowledgment, delivered/damaged/issue quantities and backend receiving decision. **Problems:** same capped trip lookup/signature-context issue; signed receipt is not receiving clearance. **Severity:** P1/P2. **Recommended changes:** direct lookup, visible reviewed quantities and truthful status labels. **Keep:** receiving/Fleet authority and draft retry semantics. **Remove:** no server gate.

### Odometer capture
**Current implementation:** actual camera, detected reading, retake/review and server-authorized start evidence. **Problems:** native permission/keyboard/camera/large-text acceptance remains incomplete. **Severity:** P2 verification risk. **Recommended changes:** preserve proven capture flow, apply shared input fixes. **Keep:** evidence binding, explicit confirmation and incident path. **Remove:** no photo requirement.

### Trip completion
**Current implementation:** actual ending reading/photo and guarded completion, including Cargo receiving holds. **Problems:** older alternate map route offers a different manual terminal journey. **Severity:** P1 canonical path. **Recommended changes:** redirect the old route; preserve this completion screen. **Keep:** stored start/current reading, validation, cancel and incident link. **Remove:** outdated alternate completion UI.

### Arrival override
**Current implementation:** typed reason, allowed action mapping and audited geofence override. **Problems:** generic Map conflicts can incorrectly invite this route; local queueing can imply progress before acknowledgment. **Severity:** P1. **Recommended changes:** geofence-specific entry and online-confirmed sequential transitions; preserve reason on failure and avoid silently advancing queued dependencies. **Keep:** audited reason and server checks. **Remove:** generic 409 override offers.

### Inspection
**Current implementation:** five-point daily Pre-Shift and type-specific Quick Pre-Trip, evidence and failed/passed feedback. **Problems:** `inspection.js:561–566` says GOOD TO GO / START YOUR SHIFT even with a blocking failed answer; backend still refuses unsafe readiness. Pass/fail choices in `InspectionChecklist.jsx:224–377` lack item-specific names/selected state, and required issue remarks use placeholder-only copy. **Severity:** P1 wording/P2 accessibility. **Recommended changes:** say Save blocking issue or Submit inspection as appropriate; add named selected controls and a visible remarks label; keep stage-specific checklist and insecure-load blocks. Native camera/keyboard/Back acceptance remains unverified. **Keep:** existing form and safety gate. **Remove:** success-sounding wording on safety failure; no checklist items without business approval.

### Fuel request / fuel report / receipt review
**Current implementation:** one Fuel route with request, gauge capture, receipt scan/review and queued/submitted confirmation. **Problems:** blank/whitespace fuel percent is converted to `Number('') === 0` (`fuel-report.js:341–348`); request button only checks photo/vehicle/busy (`FuelRequestForm.jsx:74`). **Severity:** P1. **Recommended changes:** distinguish blank from numeric zero in handler and enabled state, preserve real 0%, show field error; retain existing gauge/receipt workflow. **Keep:** vehicle-derived context, submission ID, review and honest queued confirmation. **Remove:** implicit zero default.

### Incident reporting
**Current implementation:** routine/emergency categories, evidence, location and explicit confirmation; unsent incidents surface in Activity/Home. **Problems:** Home hides Passenger Report Incident behind More during duty; placeholder support phone appears elsewhere as if real dispatch. `incidents.js:328–332` says sent after failed photos even if only queued and recommends submitting another report, risking duplication. Native location/photo acquisition has no screen-owned time bound; no measured latency is claimed. **Severity:** P1/P2. **Recommended changes:** direct Home visibility, honest queued/photo wording without duplicate-report advice, labeled larger remove-photo control, and bounded location fallback with progress feedback. **Keep:** text-first reporting, offline quarantine, critical confirmation and “dispatch not notified.” **Remove:** duplicate-report recovery advice; no emergency guard.

### Incident details
**Current implementation:** real incident response/assistance state. **Problems:** read failure clears incident/mission (`incident/[id].js:108–138`); queue-enabled arrival/resolve/reopen can look completed without acknowledgment. **Severity:** P1 mutation feedback/P2 read state. **Recommended changes:** confirmed-only consequential changes, retain last-known state with error/Retry and clear stale qualification; pause read polling while hidden. **Keep:** actual response information and local drafts. **Remove:** no operational status.

### Incident navigation
**Current implementation:** separate responder destination/navigation context. **Problems:** load failure only console-warns (`incident/navigate.js:96–116`), and arrival can be queued before showing success. **Severity:** P1 feedback/P2 recovery. **Recommended changes:** online-confirmed arrival, persistent error/Retry, last-known-state qualification and focus-aware polling; test denied GPS/Maps return on device. **Keep:** actual incident target and permission handling. **Remove:** no responder workflow.

### Work schedule / leave
**Current implementation:** shifts and existing leave submission/history. **Problems:** queued local requests are immediately described as pending fleet-manager approval (`work-schedule.js:176–186`); back icon has no accessible name. **Severity:** P1/P2. **Recommended changes:** require live submission or distinguish queued state persistently; name Back and preserve failed drafts. **Keep:** server-owned shifts/leave authority. **Remove:** premature approval-state claim.

### Activity log
**Current implementation:** saved/live fuel, inspection, incident records and unsent incident recovery. **Problems:** long eager lists are a potential scale issue, not measured jank; shared styling. **Severity:** P2. **Recommended changes:** quiet surfaces now, virtualize only with volume evidence. **Keep:** failed-send retry and explicit record types. **Remove:** no recovery data.

### Devices
**Current implementation:** current/other sessions with destructive revoke confirmation. **Problems:** default network fallback queues DELETE, then the UI removes session or signs out as though revocation succeeded (`devices.js:76–86`). **Severity:** P1. **Recommended changes:** online-only revocation; retain session and error on transport failure; clear local current session only after acknowledgment. **Keep:** confirmation and current-device distinction. **Remove:** offline success illusion.

### Settings
**Current implementation:** theme, text size and native preference controls. **Problems:** custom segmented labels and text-size modal need large-text/keyboard verification; preference changes animate regardless of reduced motion. **Severity:** P2. **Recommended changes:** retain preferences, honor reduced motion centrally. **Keep:** persisted settings and native switches. **Remove:** heavy raised segment treatment via shared cleanup.

### Personal information
**Current implementation:** saved identity and editable phone. **Problems:** phone PATCH can fall into generic mutation queue while toast says updated; Cancel hides editor but leaves `phoneEdited` true, displaying the discarded draft as saved. Empty phone returns silently. Initial read error promises pull-to-refresh without such a control. **Severity:** P1/P2. **Recommended changes:** require server acknowledgment, reset draft on Cancel, visible validation, persistent retry and distinct unconfirmed empty states. **Keep:** read-only identity boundary and cache refresh. **Remove:** unsupported immediate-success claim.

### License / documents
**Current implementation:** masked/private license, audit trail, front/back image source choices and image viewer. **Problems:** valid existing scans hide replacement controls despite anytime-renewal contract (`license.js:371,398`; [[Driver Consent]]). **Severity:** P1. **Recommended changes:** keep Replace front/back actions available with existing camera/gallery and safe upload flow. **Keep:** privacy reveal, evidence audit and stored fields. **Remove:** status-based hiding of renewal controls.

### Assigned vehicle
**Current implementation:** actual assigned plate/model, details and relevant documents in `/profile/vehicle`. **Problems:** misleading hidden `/vehicle` route leads to old Map. **Severity:** P2. **Recommended changes:** keep this real Vehicle view and normalize legacy navigation. **Keep:** saved vehicle truth. **Remove:** duplicate route behavior.

### Change password
**Current implementation:** current/new password validation and secure fields. **Problems:** shared unnamed/small visibility control. **Severity:** P1. **Recommended changes:** shared input repair without altering security rules. **Keep:** validation and busy state. **Remove:** no security condition.

### Permission settings
**Current implementation:** current OS permission labels and Settings actions. **Problems:** HC-dark chips inherit contrast bug. **Severity:** P1 shared. **Recommended changes:** semantic surfaces repair and real-device denied/settings return check. **Keep:** native permission ownership. **Remove:** no permission explanation.

### Privacy & consent
**Current implementation:** saved acceptance metadata and expandable server-provided policy. **Problems:** expansion always animates, independent of reduced-motion preference. **Severity:** P2. **Recommended changes:** honor preference, keep full policy. **Keep:** server text and audit metadata. **Remove:** no rights/retention explanation.

### Help
**Current implementation:** FAQ, reset tips and contact controls. **Problems:** `tel:18001234567` and `support@fleetops.com` are placeholders offered as real support; FAQ motion unguarded. **Severity:** P1 support honesty/P2 motion. **Recommended changes:** show unconfigured support truth instead of actionable fake contacts; keep guides/FAQ and honor reduced motion. **Keep:** actual reset/contextual help. **Remove:** unverified contact launches.

### About
**Current implementation:** logo, real app version and description. **Problems:** same placeholder support calls/mail; repeated nested raised treatment. **Severity:** P1/P2. **Recommended changes:** honest unconfigured support and shared visual cleanup. **Keep:** current reference logo and real version. **Remove:** fake contact affordances.

### Guide practice / Cargo demo / Map return
**Current implementation:** optional labeled sample practice with production-component reuse and real-target guidance; Cargo demo is sample-only; `redirect-trip.js` restores canonical assignment. **Problems:** legacy/V2 coexist under `EXPO_PUBLIC_DRIVER_GUIDES_V2`; changing rollout blindly is unsafe. **Severity:** P2 acceptance. **Recommended changes:** retain local gate and isolated practice, prefer contextual real-target guidance; no new fake interface or broad onboarding tour. **Keep:** practice write isolation and return/session guards. **Remove:** no fallback until V2 native acceptance permits it.

### Global alerts, sheets and feedback
**Current implementation:** shared AppAlert singleton with dismissal guards, NotificationHost, offline/cache banners, route options, Cargo issue/signature sheets and root boundary. **Problems:** AppAlert lacks bounded scroll/safe-area behavior and always springs; default button rows can truncate; notifications still translate under reduced motion. **Severity:** P2, potentially P1 for long recovery text pending native reproduction. **Recommended changes:** bounded scrollable alert body, growing/stacked actions for narrow/large text, preserve once-only callbacks and apply reduced motion. **Keep:** persistent error/retry where present, queue warnings, cancellation guards. **Remove:** double-bezel/decorative glow and unnecessary bounce.

## 5. Navigation Audit

**CURRENT:** Home | Map | fuel scan action | Trips | Profile; hidden History/Notifications/vehicle/fuel stub plus signed-in stack forms. Notifications are reached from the Home bell and Profile contains lower-frequency account/work links.

**RECOMMENDED:** retain four destinations and existing scan access for now. Make Home's Report Incident directly visible in both specializations; keep End Duty as a separate on-duty action. Redirect old `/vehicle` to Map and `fuel_action` to Fuel. Keep `/profile/vehicle` as vehicle information. Retain History compatibility while making Trips History the primary archive entry. Do not add an Operational tab: fuel/incidents/checklists already have working contextual access and there is no usage evidence for a fifth destination.

## 6. Driver Workflow Audit

**CURRENT FLOW:** sign in → required password/privacy/permissions → Home → Pre-Shift → assignment/Trips details → acceptance/readiness/Pre-Trip → odometer photo when required → Map/start → pickup → Passenger onboard or Cargo count/sign/release → current destination navigation → arrival → Cargo receiving/count/sign/clearance if required → ending odometer/completion → end-duty condition report.

**RECOMMENDED FLOW:** same authoritative sequence → Home immediately states duty/current next step → canonical Map owns active-trip navigation → only the currently valid action is primary → errors distinguish conflict from distance → Cargo opens the exact assignment and shows reviewed counts at signing → server-confirmed success or explicit local-save status → end-duty report remains reachable.

Unnecessary interactions to remove: More just to reach Passenger Incident; blank legacy route; opening outdated Map journey; returning to the previous Cargo screen only to recall signed quantities. Inspection/evidence/clearance confirmations have operational purpose and must not be removed as “extra taps.”

## 7. Map UX Audit

The requested draggable bottom sheet already exists. It computes primary/max height from viewport, insets and measured content; recenter/options/external/overview controls live outside the drag handler. Current target changes from pickup to destination using shared phase/target helpers. Provider route metrics, stale estimates, unresolved targets, map load/errors and location permission states are distinct. Google Maps handoff checks tracking readiness and explains explicit continuation without tracking; the optional return bubble is separate and is not proof of background GPS.

Preserve this layout. Improve its expand/collapse semantics, reduced motion and typed error classification; quiet sheet depth. Do not add another sheet library or cover more map area. Compact form should retain state, target, ETA/distance validity and the one next action; expanded form exposes vehicle/load/secondary detail. GPS/route/marker readability, gesture conflict, inset clearance and Maps return still require phone acceptance. Failed route recalculation must keep prior geometry with stale wording.

## 8. Cargo Driver UX Audit

Cargo specialization is real and should remain shared architecture with different content: manifest reference, quantities/units, declared weight, actual vehicle/capacity, pickup/delivery target, source/Fleet/receiver hold and count/evidence/signature. Passenger uses guest/VIP/count and pickup/drop-off facts. Do not show fake shipment photos or infer receiving authority from the driver's signature.

Existing manifest/item rows and issue sheet provide item names/counts, available photo evidence and operational status. Keep photos as compact evidence rather than adding a decorative gallery. Improve exact-trip loading and make frozen reviewed quantities visible in the signature modal. Preserve separate loaded/unloaded observation versus server clearance, stale manifest detection, offline draft recovery and immutable submission retries. Neither cargo driver nor UI can manufacture a source release or manager/receiver approval.

## 9. Design System Improvements

| Area | Recommended contract |
|---|---|
| Brand | Keep forest `#285448`, warm ivory `#F5F2EC`, brass `#8A632C`, current Hotel Route logo and four themes |
| Status | Existing success/warning/danger/info roles plus text/icon; resolve HC-dark backgrounds correctly; avoid color-only meaning |
| Typography | Existing Plus Jakarta Sans; page 24/32, title 20/28, card 16/22, body 16/24, support 14/20, caption 12/16; IBM Plex only operational figures |
| Spacing | Existing 4dp steps; 16dp screen gutter/card padding, 8dp within groups, 12–16dp peers, 24dp sections; retain safe-area clearance |
| Radius | 12dp controls, 16dp cards, small status pills; avoid 24–30dp rounded surfaces everywhere |
| Shadows | One subtle offset/blur for outer cards, stronger temporary overlays only; flat inner tiles/chips, no inset highlight or thick top/bottom strips |
| Cards | Reuse components and data contracts; one container per meaningful task group, divider rows inside |
| Buttons | Minimum 48dp target, growing multiline label, one primary next-state action; readable disabled/busy state |
| Inputs | Registered fonts/type scale, label announced by default, caller override retained, visible errors; 48dp named accessory button |
| Icons | Retain installed Ionicons for actions/navigation; MaterialCommunityIcons only specialized vehicle/cargo glyphs; consistent outline/filled selected treatment, labels for ambiguous actions |
| Sheets/dialogs | Existing native primitives, bounded scroll/safe-area and growing actions; retain Back/cancel and once-only callback guards |
| Motion | Existing reduced-motion hook; modest state feedback, direct final positions for reduced motion; no ambient Home animation needed |

Brand primary white-on-forest measures 8.56:1 and primary text on ivory 13.40:1; these do not need a palette replacement. High-contrast dark status labels currently measure 1.38–1.80:1. Preserve good pairs and correct the bad mapping.

## 10. Component Refactoring Opportunities

| Existing Component/File | Problem | Recommended change | Reason | Priority |
|---|---|---|---|---|
| `lib/theme.js` | HC-dark status palette identity bug | Correct dark status containers, minimum target floor | Cross-screen readability | P1 |
| `components/clay/ClayInput.jsx` | Unnamed 28dp accessory, unregistered font names | Label/type defaults and 48dp action | One fix reaches all password forms | P1 |
| `components/home/DriverHomeCards.jsx`, `(tabs)/index.js` | Decorative hero before work; Passenger Incident hidden | Compact duty, current-first, direct incident | Faster operational scan | P1/P2 |
| `components/cargo/CargoWorkflowScreen.jsx` | Capped unrelated list lookup | Exact trip filter | Assignment cannot disappear behind old records | P1 |
| `components/cargo/CargoSignatureModal.jsx` | Counts outside signing context | Frozen reviewed-line summary | Reduce recall/errors | P2 |
| `(tabs)/vehicle.js`, `fuel_action.js` | Old duplicate/blank journey | Canonical redirects | Preserve URL without duplicate behavior | P1/P2 |
| `components/AppAlert.js` | Unbounded/spring/short button row | Scroll, adaptive actions, reduced motion | Reachable recovery | P2 |
| `lib/clay.js`, `clay/molded-materials.js`, `home/materials.js` | Repeated puffy recipes | Reuse quiet style contracts | Consistency without component migration | P2 |
| `components/NotificationHost.jsx`, `RadarPulse.jsx`, `theme-context.js` | Uneven motion preference | Direct/no-motion branch | Respect accessibility | P2 |
| `components/CurvedPillTabBar.js` | Own palette/tiny fixed label | Theme colors, adaptive height/clearance | Keep native navigation readable | P2 |

## 11. Accessibility Audit

Confirmed: HC-dark status contrast fails; ClayInput action lacks name and minimum target; primitive font keys mismatch loaded fonts; scaled `TOUCH_TARGET` falls to 44.48dp at 320dp, below Android's 48dp guidance; several reduced-motion paths still animate. Tab labels and dialog rows need large-text adaptation. Labels should derive from visible input label unless a caller supplies a more specific accessible name.

Positive evidence: buttons expose role/disabled/busy, four tab cells expose selected state, Home avatar/bell and notification dismiss are 48dp, SwipeButton has activate accessibility action and motion handling, guidance measures real controls. Do not mistake small icon glyph size for actual tap target size. Native reading/focus order, screen-reader announcements, outdoors and keyboard/inset acceptance remain device checks.

## 12. Driver Safety UX

During active work, Home must show current state/assignment before secondary lifetime counts. Map remains the primary operating screen with current target, essential route status, next valid action, recenter and emergency access. Keep guard/confirmation for consequential state changes and geofence overrides. Never suggest an eligibility conflict can be bypassed as a distance issue. Preserve “dispatch not notified” for unsent incident reports and prevent fake support calls.

Use a visible “stop safely” instruction where a complex count/signature/photo/typed reason is required; do not invent vehicle-motion sensing or automatically block controls based on an unverified speed. Physical driver testing is required to establish safe one-handed operation; source review alone cannot certify safety.

## 13. UI Cleanup Matrix

| KEEP | IMPROVE | REMOVE | MERGE | MOVE |
|---|---|---|---|---|
| Brand/semantic theme | HC-dark status and input accessibility | Decorative Home slogan/large scene ahead of work | Old Map UI into canonical route redirect | Secondary metrics below current assignment |
| Four destinations | Dialog overflow/motion | Fake support contact links | Three material recipes into quiet shared vocabulary | Incident into visible Home shortcuts |
| Server trip/inspection/Cargo gates | Exact Cargo lookup/signing context | Blank fuel placeholder route | Duplicate history discovery toward Trips History, keep compatibility | End Duty beside current duty, separate from four shortcuts |
| Real-target contextual guides | Truthful online/queued feedback | Thick embossed edges/inset sheen | Shared input fixes across all auth forms | Optional details behind existing sheet expansion |

## 14. Priority Improvement Roadmap

**PHASE 1 – Critical usability fixes:** correct high-contrast status resolution; reject blank fuel without rejecting explicit zero; require real revocation/leave/contact-update acknowledgment; allow license renewal; use exact Cargo trip lookup; classify Map geofence errors by code. Add meaningful regressions first.

**PHASE 2 – Navigation and workflow improvements:** compact shared duty/current-first Home, direct Incident with independent End Duty; canonical legacy redirects; visible frozen Cargo signing quantities; honest support and policy access. Keep trip/permission/signature authority.

**PHASE 3 – Visual/design-system cleanup:** quiet existing materials, reduce large radii/sheen, preserve colors/font/assets, improve shared input and tab/dialog adaptation. Do not create a replacement component tree.

**PHASE 4 – Micro-interactions and polish:** reduced-motion consistency, screen-reader and device matrix, small/narrow/large-text inspection, documentation and verified export. Optional future work: list virtualization beyond Trips only when volume/profiling justifies it; guide V2 rollout only after native acceptance; user-study timing/outdoor testing.

Additional bounded implementation targets from the completed independent reviews: named Settings/permission switches; Settings return refresh and permanent-denial recovery; inspection failure wording/semantics; honest incident evidence/response states; personal-phone Cancel and retry. Native guide rollout, alternative legally valid signature, automatic moving-state lock and new backend evidence attachment remain future/product decisions. Source-report archives are `scratch/mobile-ux-audit-2026-10-29/{trip-map-cargo,forms-profile-guidance,native-accessibility}.md`; the consolidated findings above remain the durable vault record.

## 15. Recommended Final Mobile Structure

```text
Driver app
├── Home: duty, alerts, current/next assignment, actions, secondary summary
├── Map: current Passenger/Cargo target, route, next valid trip action
├── Trips: Today, Upcoming, History → existing trip details
│   ├── Passenger: guest/pickup/drop-off
│   └── Cargo: manifest → pickup acknowledgment → delivery acknowledgment
├── Fuel scan action → existing Fuel request/report/review
└── Profile
    ├── Personal information, License, Assigned vehicle
    ├── Work schedule/leave, Activity log, Notifications
    ├── Devices, Password, Permissions, Privacy
    └── Settings, Help/contextual guides, About
Contextual stack: Inspection, Odometer, Completion, Override, End duty,
Incidents/detail/navigation; auth/consent/permission guards remain above it.
```

These are existing routes grouped by purpose, not a request for new screens or a new tab.

## 16. Implementation Plan

| Task | Files/components affected | UI change | Behavior change | Priority | Risk | Dependencies |
|---|---|---|---|---|---|---|
| Correct shared status/input | `theme.js`, `ClayInput.jsx` and callers | Readable chips, named 48dp password action | Correct palette selection; input defaults | P1 | Low | Existing theme/hook/tests |
| Honest form/security feedback | `fuel-report.js`, `FuelRequestForm.jsx`, `devices.js`, `work-schedule.js`, `profile/personal.js` | Error retained; no premature success | Blank rejected, confirmation-only mutations | P1 | Medium | Existing API queue options |
| Renewal and support truth | `profile/license.js`, `help.js`, `about.js` | Replace scans visible; no fake support links | Existing upload stays available | P1 | Low | Existing upload/FAQ |
| Exact Cargo and signed context | `CargoWorkflowScreen.jsx`, `CargoSignatureModal.jsx` | Correct assignment and reviewed quantities | Filter by trip ID; freeze summary | P1/P2 | Medium | Existing endpoint/context guards |
| Canonical Map/actions | `(tabs)/map.js`, `vehicle.js`, `fuel_action.js`, `trip/override.js` | Correct conflict/override, named sheet control | Canonical redirects and acknowledged transitions | P1/P2 | Medium | Existing error code/state gates |
| Operational Home | `(tabs)/index.js`, `DriverHomeCards.jsx`, skeletons | Duty/current first, direct Incident, secondary counts | Navigation ordering only | P1/P2 | Medium | Current duty/workspace sources |
| Read policy | `app/consent.js`, `OnboardingConsentRow.jsx` | Explicit policy read and separate checkbox | Shared existing policy shown before consent | P1 | Low | Existing pure policy/version |
| Quiet/adaptive shared UI | materials, cards/buttons/input, tab bar, AppAlert | Flat inner surfaces, bounded/adaptive controls | No operational contract change | P2 | Medium | Visual fixtures and theme parity tests |
| Consistent motion | theme/notification/radar/help/privacy/Map | Static under Reduce Motion | Preserve cleanup/callback rules | P2 | Medium | Existing reduced-motion hook |
| Verification/documentation | focused tests, Hermes export, README, vault/SYSTEM | Reviewable evidence and known limits | No runtime data write | P1 | Low | Above tasks |

Execution details and checked status belong in `docs/superpowers/plans/2026-10-29-mobile-ux-improvements.md`. Do not stage/commit other chats' changes. Use the current checkout because its uncommitted launch/Home assets are part of the actual audit baseline; snapshot task-start source separately for review.

## 17. Before vs After Description

**Before:** existing driver workflows are capable but secondary illustration, metrics and repeated raised treatments compete with current work. Some controls are hard to identify with a screen reader. A blank value can become a false zero; local queueing can look like confirmed success; an old route can open an outdated Map journey.

**After target:** the same driver sees duty and current work first, reaches Incident without expanding More, reads status in every theme, reviews exactly what is being signed, and receives confirmed success or a clear retry requirement. Existing brand, Passenger/Cargo facts, native routes and server gates remain. Cards and controls feel lighter because decoration recedes. Device testing remains necessary before claiming native usability, outdoor readability or driver safety acceptance.
