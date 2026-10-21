---
type: plan
status: software-implemented-rollout-gated
last_verified: 2026-10-21
related: ["[[Driver In-App Guide]]", "[[Mobile Architecture]]", "[[Trips]]", "[[Fuel]]", "[[Incidents]]", "[[Coach Marks Passenger Cargo Proposal Assessment 2026-10-20]]"]
---

# Driver guidance redesign implementation plan - 2026-10-20

The owner requested an implementation plan for both hotel Passenger and Cargo and emphasized that details must be genuinely useful and well explained for drivers. The approved software is implemented behind a default-off rollout gate. Final verification and physical-device/participant acceptance are recorded below. No real business data or deployment setting changed.

## Authoritative artifacts

- Design and full driver-facing content: `docs/superpowers/specs/2026-10-20-driver-guidance-redesign-design.md`.
- Ordered implementation tasks, file responsibilities, interfaces, regression commands and release gates: `docs/superpowers/plans/2026-10-20-driver-guidance-redesign.md`.

## Chosen approach

Keep useful existing spotlight and context protections, remove the automatic Welcome sequence and migrate one section at a time. Use common guidance plus independent Passenger/Cargo content resolved from the saved workspace/trip. Reuse the real production controls and extracted presentation components for clearly labeled local practice; keep operational controllers and sample handlers isolated. No new tutorial backend, package, migration, training dashboard or duplicate practice interface is planned.

Each guide explains the immediate action briefly, with More details covering why, the actual result, blockers and recovery. The content catalogue covers daily versus per-trip inspection, assignment/readiness, start/end odometer photos, standby/active Map, Passenger guest handoffs, Cargo units/counts/issues/recounts, releasing/receiving signatures, separate source/Fleet/receiver clearance, fuel request/receipt review, incident severity, SOS explanation and honest offline/unavailable states.

Practice needs explicit parked confirmation and a memory-only session. It is unavailable during active/accepted work, emergency/responder work or pending operational submissions. Unknown/stale motion suppresses automatic overlays; recent movement vetoes practice. The proposed guide-only policy preserves existing operational motion thresholds. All practice-origin writes, uploads, queues, autosaves, GPS and external actions are prohibited. Real background services continue independently.

## Ordered slices

1. Catalogue and current integration inventory.
2. Driver/guide/variant/version progress and conservative legacy import.
3. Safe eligibility, local practice reducer and interruption fencing.
4. Independent triggers and lightweight Welcome.
5. Readable details, accessible highlights and practice shell.
6. Shared production Map components and Passenger practice.
7. Inspections, readiness and odometer guidance.
8. Fuel request/receipt guidance through real fields.
9. Incident decisions, SOS priority and offline explanations.
10. Cargo quantities, signatures and approval holds.
11. Individual replay and practical Help.
12. Executable isolation/regression proof and legacy cleanup.
13. Android, accessibility and driver-understanding acceptance.

## Verification and release boundary

Planning checked the current provider, registry, storage, motion derivation, Map/practice/swipe controls, current form integration points, Cargo view/signature contracts, Help, test configuration and actual-component test patterns against the relevant Capstone notes. Checked referenced existing target paths, task coverage, interface consistency, placeholder absence, UTF-8 decoding and scoped whitespace. These are document checks, not app test results.

Implementation must prove zero sample-origin operational effects through actual callbacks; retain genuine operational guards; pass strict lint, focused/final regression, encoding and Android export; and complete native Android and formative driver checks. At least three unfamiliar participants per workflow must perform the critical sample task independently and correctly distinguish saved records from approval. A safety misunderstanding blocks release. No participant, runtime, phone or export result is claimed today.

Cargo production intake/execution/evidence/authority activation remains separate and pending. A tutorial cannot grant clearance or make unavailable providers operational. The existing implementation record in Driver In-App Guide remains current until the plan is implemented and verified.

## Concept visualization - 2026-10-20

At the owner's request, generated one inline three-screen Cargo pickup concept using the built-in image-generation tool. It illustrates a short spotlight tip on the actual-count field, an expanded explanation of count/difference/clearance, and optional practice with the same intended controls plus a persistent Sample data label and Exit practice. The example consistently uses 10 expected boxes and 9 counted, with a one-box shortage. It explicitly states that a saved count or signature does not authorize departure.

Visually inspected the generated board: all three screens, essential explanations, shortage arithmetic, practice identity and primary actions are readable and complete. The image is labeled Concept preview / Sample data. It is an AI-generated illustration of the planned interaction, not a screenshot, exact implementation specification or evidence that production components have already been reused. No application code, operational data, provider configuration or deployment changed.

Preview-only image: `C:/Users/lenovo/.codex/generated_images/01a159da-3483-7e80-a6e7-250f3c52fc57/exec-f43bff9d-e9ee-4ac8-8ca8-47ee9190ee97.png`. The image remains outside the project because it is a conversation preview, not an application asset.

## Scheduled implementation start - 2026-10-20

The owner authorized scheduling implementation for the next 2:31 AM. Current Manila time was October 20 at approximately 11:27 PM, so the scheduled start is **October 21, 2026 at 2:31 AM, Asia/Manila**. Created one active, one-occurrence automation attached to this chat: `implement-passenger-and-cargo-driver-guidance`. The app confirmed creation and displayed the automation card on a subsequent view request.

The saved instructions authorize implementing the plan, not merely sending a reminder. They require reading repository/vault instructions, preserving unrelated work, working inline unless delegation is separately authorized, verifying software changes, retaining physical-device/participant release gates and updating Capstone/SYSTEM. They prohibit deployment, push, production Cargo activation and real business-data changes. Completion time is not promised; the schedule specifies when work begins.

Local execution requires the computer to remain on, the desktop app running and the project available. No implementation was performed while creating this schedule. The automation is configured for one occurrence, not a daily implementation job.

### Usage-aware continuation authorized

The owner additionally authorized another scheduled continuation when the five-hour usage allowance reaches 5% remaining. Updated the existing automation prompt, preserving its initial October21 2:31 AM schedule, active status and target chat. The app confirmed the update, and a read of its saved configuration verified those fields and the continuation instructions.

The implementation run will read usage at entry, between tasks and around expensive checks. At 5% or less remaining in the relevant 300-minute window, it must save completed tasks, changed files, exact verification outcomes, remaining work and the next action here and in SYSTEM.md. It must then create or reuse exactly one one-occurrence continuation in the same chat for two minutes after the usage tool's actual reset timestamp, carry forward the same scope/policy and end the current work run. The continuation checks fresh usage and resumes from that checkpoint. This is normal continuation after the account's reset, not a reset purchase or a limit bypass.

No extra continuation is created before the threshold is observed. Do not create duplicates, a daily loop, or repeated wakeups merely to wait for physical-device/participant input. Stop scheduling once executable software work is complete or user action is required. Missing usage data, scheduling failures or a separate weekly blocker must be reported honestly. Boundary checks cannot guarantee catching an abrupt exhaustion at exactly5%; the policy is a best-effort scheduled-run instruction, not a platform-level continuous threshold trigger.

At the read used to configure this policy, the five-hour window was81% used/19% remaining, with its reported reset at October21,2026 2:31:25 AM Asia/Manila. This is a point-in-time observation, not a fixed future reset schedule. No application implementation began during this update.

## Implementation checkpoint - 2026-10-21, first scheduled run

Work started on the existing `feat/mechanic-integration` checkout. The plan depends on substantial pre-existing uncommitted Passenger/Cargo work; no reset, stash, migration, deployment or unrelated change was made. Read repository/mobile instructions and the required Expo57 reference; installed Expo54 APIs remain unchanged. Work is inline as requested.

Implemented foundation: 23 versioned guide variants with full design-derived English explanations; pure progress/import and safety-policy modules; serialized actor-scoped guidance storage; a memory-only practice reducer/lifecycle; an executable independent-guide controller; a gated native provider retaining the existing three contexts and geometry overlay; More details and a persistent practice identity banner. `EXPO_PUBLIC_DRIVER_GUIDES_V2` defaults off. Legacy remains current until acceptance.

Practice readiness uses strict queue reads and existing read-only owned trips/submissions/responder endpoints. The ordinary API helper can drain queued writes after a GET, so a narrowly scoped `skipQueueDrain` option was added with an actual-api regression; authentication/validation and default behavior stay intact. Missing/failed readiness blocks practice. No readiness call was made against live business data during implementation.

Map extraction reuses existing TripOperationalSummary for Cargo and moves the actual Passenger header into PassengerMapSummary, rather than introducing a second summary layout. Actual active Map controls now use MapControlCluster; the production callbacks remain in Map. The same components are intended for the local host next. The earlier proposed MapTripPanel file is unnecessary because the existing summary already supplies that seam.

Fresh checks so far: baseline165 tests across3files passed; catalogue/progress/policy plus workspace/presentation33 passed; storage/practice/policy/legacy154 passed; actual detail/banner144 with legacy passed; controller/provider/legacy151 passed; readiness/lifecycle/provider7 passed; API refresh27 passed; shared Map/cargo/confirmation56 passed. These overlapping focused runs are separate results, not an additive test total. A missing extracted Clay-material binding was caught by actual rendering and corrected; the final Map run passed. One early scoped lint run found hook dependency warnings; those bindings were corrected and fresh lint confirmation is pending. No native acceptance, participant acceptance, export or final broad regression is claimed yet.

Next: complete the shared-view practice host and remaining form extractions, connect independent eligible section triggers/replay, block old URL-only tour entry in v2, extend Cargo practice without native GPS, run isolation and real-operation regressions, lint/encoding/export and record remaining native/participant release gates. Preserve the rollout switch and old code until those gates allow removal. No commit/push was performed.

## Software handoff checkpoint - 2026-10-21

The inline implementation now includes the production-view extractions and optional local sessions for Passenger pickup/drop-off, daily/quick inspection, start/end odometer review, fuel request/receipt correction, incident assessment and Cargo count/issue/signature/clearance/delivery examples. Real API, native camera, upload, queue, autosave, file, GPS and launcher owners remain outside the practice host. Sample evidence is visibly fictional PNG data under `mobile/assets/driver-practice/`; it is never copied into operational evidence storage.

### Actual inventory and ownership

Recounted the current legacy registry: **23 milestones, 44 step entries: one untargeted Welcome and 43 target references using 31 distinct target IDs**. Legacy keys: welcome; pretrip/pretrip_remarks/pretrip_complete; trip_readiness; preshift/end_duty; map_intro/live_trip; fuel_scan_intro/fuel_scan_capture/fuel_scan_verify; sos/incident/offline; tour_sos/tour_preshift/tour_end_duty/tour_incident/tour_incident_category/tour_fuel/tour_fuel_entry/tour_fuel_flow.

- `CoachMarkProvider` selects exactly one provider using `EXPO_PUBLIC_DRIVER_GUIDES_V2 === '1'`. Default is legacy; no environment file was changed. The three existing contexts and measured overlay remain the interface.
- `driver-guides` owns 23 new variant records for 19 topics. `driver-guide-progress`, `coach-mark-storage` and `driver-guide-controller` own driver/variant/version progress, conservative import, independent presentation and replay. Old true/completed outcomes import as dismissed/unknown, never proof of understanding. Old keys are retained.
- Production inspection, fuel and incident screens retain their operational controllers. `InspectionChecklist`, `FuelRequestForm`, `FuelReceiptReview`, `IncidentReportForm`, `IncidentSubmitButton` and `IncidentCriticalConfirmation` provide their actual shared views. Map retains its mutation/route owners and shares `PassengerMapSummary`/`MapControlCluster`; existing `TripOperationalSummary` remains Cargo's summary seam. OdometerCapture retains its camera lifecycle and shares OdometerReview.
- `DriverPracticeHost`, `driver-practice`, `use-driver-practice` and the authenticated `/profile/guide-practice` route own memory-only sample sessions. URL parameters cannot create the session. `LegacyGuideLinkGuard` rejects old tour/tutorial/walkthrough/pretrip-passed links before operational screens mount when v2 is selected. The old simulation components and provider navigation branches are retained solely behind the default-off coexistence gate; removal is intentionally pending acceptance.
- `DriverGuideTrigger` produces a tip for the current screen/target with matching workspace/trip context. Existing Home/duty/readiness producers use the compatibility adapter; `tour_*`, old Map chain/navigation and offline popup producers cannot start the new sequence. Cargo counts, issue remarks, signature entry and clearance labels have precise production targets. Per-section Help replay does not require a real operational action.
- `DriverGuideLibrary` lists common/current-workflow sections. Unknown workspace gets common read-only text and setup guidance, with no Passenger assumption. Full explanations stay readable inline without a GPS fix, active trip or working connection. Reset remains explicit and reports failed persistence honestly.
- SOS interrupts synchronously before opening its real sheet. The existing connectivity banner has its own Details action; there is no second offline warning. Incoming entries in the existing inbox feed invalidate guidance/practice readiness without adding another inbox poller.

### Safety and meaningful validation

Fresh work checks use strict local queue reads and existing owned read-only trips/submissions/responder endpoints. A capped or failed history cannot prove the absence of incident work. Unknown emergency/responder state suppresses automatic overlays; queue-only knowledge does not assert that emergency work is absent. Readiness GETs explicitly skip the API helper's ordinary outbox drain. Default operational behavior remains unchanged. Readiness refreshes every 15 seconds and expires after 30 seconds; locally observed work changes interrupt sooner. This does not promise instantaneous detection of an external change that the app has not received.

Practice has a ten-minute, identity/session-bound lifetime, explicit parked confirmation and stricter stationary rules. Known-motion sessions end if evidence becomes stale. Background, account/session changes, route abandonment, movement, emergency, assignments or pending work invalidate the capability. The host has no operational modules; strict dependency maps and actual callback execution cover failures, corrections, retries, cancellation, stale events and local completion. Production-path regressions retain real writes and authorization guards.

Cargo practice reuses actual count, issue, receipt, signer and decision views. It includes whole boxes versus measured kilograms, shortage reasons, clean count, unsynced/unavailable holds, fictional signature, WAIT/recount, separate securement and missing receiver authority. Recount discards the old active signature, retains the earlier sample observation in memory and requires a fresh count/signature. No sample ever sets real departure or completion capabilities. The real signature controller still supplies optional fresh GPS; the pure signature view receives an injected no-location handler in practice. Signature and Critical sample modals retain their own visible sample notice and Exit.

### Verification record

- Final broad mobile run before the last review adjustments: **1,129 passed, zero failed**. Final affected rerun is recorded below when complete. Existing real-operation/measurement/queue/permission assertions were kept; test loaders were updated to evaluate extracted views.
- Integrated repository run: **6,025 passed, 4 failed because Windows sandbox restrictions blocked temporary Git repositories or Git's text-conversion helper**. Targeted retry using a workspace-owned temporary folder passed all three encoding-gate cases; the remaining existing read-only history security suite passed **44/44** with automatic approval for execution outside the sandbox. No test or security gate was skipped or disabled.
- Strict repository lint passed after renaming a test helper's reserved `module` binding. Encoding gate passed. Final affected lint/encoding are recorded below.
- V2 Android export succeeded with **1,506 modules** and a Hermes bundle, using a workspace-owned temporary directory after the first compiler attempt could not write the sandbox's temporary folder. Log: `scratch/driver-guides-android-final.log`. Export is not installation or device acceptance.
- Isolated browser preview used the actual host/shared views, theme tokens, fonts and React Native Web, with only platform/provider boundaries replaced. Inspected 360-pixel light Cargo, 320-pixel dark enlarged-type Cargo, 390-pixel short landscape Passenger and long scrolling details. Exercised nine-box shortage, reason and real review summary: expected10, pickup9, order shortage1. The sample-case selector was collapsed after visual review so it does not crowd the primary task. Browser preview does not establish native camera, WebView drawing, keyboard or TalkBack behavior.
- Review remained inline as the owner requested. Corrected extraction bindings, native dependency separation, modal sample identity, session-generation fencing, unknown emergency handling, recount signature invalidation and sample receipt/gauge validation. No claim of independent reviewer, native participant or staged-business acceptance is made.

### Release gates and next action

The implementation tasks have software coverage; task12 legacy deletion and task13 rollout remain intentionally gated. A physical Android run must still cover real gestures, measurement during scroll/rotation, system 200% text, all 320/360/390 layouts, keyboard/safe areas, TalkBack/reduced motion, permission denial and incoming-work/background/account interruptions. Compare native network/queue activity with an idle baseline and verify genuine staged Passenger operations with approved test identities. Cargo operating E2E remains separately blocked on its production integration; practice cannot activate providers. Observe at least three unfamiliar participants per workflow and fix/retest every safety misunderstanding.

Do not enable the build flag, remove legacy code, deploy, push, activate Cargo or change business data on the basis of automated checks alone. No additional scheduled wakeup is appropriate merely to wait for phone/participant acceptance. No commit, push, deployment, migration, production-provider activation or business-data write was performed in this run. Existing unrelated working-tree changes were preserved.

### Final affected verification

After the last review fixes, the complete mobile suite passed **1,129/1,129**, and lint on the final adjusted reducer/host/test helper/Trip Details files passed. The strict repository lint had already passed; the final encoding gate passed after the documentation updates. The ordinary integrated run and its targeted environment-only retries above remain separate records, not an invented single clean-run total. Final current-code Android export confirmed exit0 with Hermes bundle `entry-6e1729d5e97284c220bde8341afb497c.hbc` (5.93MB). The task-owned export/temp directories were removed after verification; the exact export log remains in scratch.

No usage continuation has been scheduled: the last boundary read showed92% used/8% remaining in the300-minute window, above the5% continuation threshold. Executable implementation and final export verification are complete; the remaining acceptance needs native-device/staged identities/participants. Do not create a wakeup only to wait for that acceptance.
