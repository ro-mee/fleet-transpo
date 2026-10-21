# Passenger and Cargo Driver Guidance Implementation Plan

Execution record (2026-10-21): software for tasks1–11 and the executable isolation/regression/export portions of tasks12–13 is implemented behind the default-off v2 flag. Shared production view names were adjusted to the existing code seams rather than duplicated. Exact changed ownership, test outcomes, environment retries and remaining acceptance are recorded in `Capstone/07 - Development/Driver Guidance Redesign Implementation Plan 2026-10-20.md`. The original checklist below remains the acceptance contract: planned commits were not made, and legacy deletion, physical Android/staged-operation checks and participant acceptance remain pending. Automated tests and export do not close those gates.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only if the owner authorizes delegation. Steps use checkbox syntax for tracking.

**Goal:** Give hotel Passenger and Cargo drivers short, well-explained contextual help and optional safe practice using the real production interface.

**Architecture:** Keep the existing coach-mark presentation and context split. Extract eligibility/progress/practice rules into small pure modules, migrate guides independently, and reuse production view components with isolated local practice controllers. Operational screens retain their existing authorization, validation, transitions and network ownership.

**Tech Stack:** Existing Expo/React Native, JavaScript, Expo Router, AsyncStorage, Clay components, current SwipeButton, Vitest and existing esbuild-based actual-component harnesses. No new package or database change is planned.

**Design and copy authority:** `docs/superpowers/specs/2026-10-20-driver-guidance-redesign-design.md`. The entire content catalogue is in section 4; each task below names the entries it must deliver.

## Global constraints

- All driver text uses plain English and explains action, reason, result and recovery.
- Short tips normally use 20-45 words; More details normally uses 60-120 words. Never truncate a safety rule to meet a word count.
- No duplicate tutorial screens, imitation controls, forced welcome chain, gamification or mastery claims.
- Practice requires explicit safely parked confirmation and an in-memory capability; URL flags alone grant nothing.
- Practice is unavailable during any active/accepted assignment, emergency/responder work or pending operational submission.
- Practice causes no operational submission, upload, queue, business autosave, file copy, GPS acquisition/posting, dialing or external navigation.
- Unknown or stale motion suppresses automatic overlays. Known movement always vetoes practice. Preserve the global >=10 km/h/two-minute hold and add guide-only rules from the design.
- Practice expires after ten minutes; background/logout/account/assignment/emergency changes discard it. No automatic resume.
- Reuse existing validators, labels, legal transitions, native fonts/theme, Clay components and touch/focus patterns. Minimum new touch target: 44 dp or the existing larger shared target.
- Odometer photo requirements are trip/capability-aware; Cargo signatures acknowledge counts and never replace source/Fleet/receiver authority.
- Production Cargo providers remain unavailable until their separate integration work is authorized and completed.
- Keep the shared checkout's unrelated changes. Use UTF-8 file tools; do not edit schema.sql, credentials or deployment settings.
- Planning completion is not implementation, device acceptance or deployment completion.

## Execution checklist and file responsibilities

All paths are relative to `C:/Users/lenovo/OneDrive/Desktop/capstone`. Existing paths below were inspected during planning. Proposed new paths are explicitly marked Create. Before execution, reread `.agents/AGENTS.md`, current Capstone notes, this design and the current diff because concurrent work exists. If web/Next files enter scope, read the installed Next guides first; this plan does not require a web implementation.

| Unit | Responsibility |
|---|---|
| `mobile/lib/driver-guides.js` (new) | Versioned content catalogue, variants and legacy mapping; no effects |
| `mobile/lib/driver-guide-policy.js` (new) | Classify guide eligibility and blocking reasons from explicit snapshots |
| `mobile/lib/driver-guide-progress.js` (new) | Pure persisted-progress transitions and import rules |
| `mobile/lib/coach-mark-storage.js` (existing) | AsyncStorage persistence, compatibility and per-driver scoping |
| `mobile/lib/driver-practice.js` (new) | Memory-only session creation, valid events, scenario reducer and expiry |
| `mobile/lib/use-driver-practice.js` (new) | Session lifecycle glue; no operational client or native side-effect imports |
| `mobile/components/coachmarks/CoachMarkProvider.jsx` (existing) | Single presentation owner and stable guide actions; temporary legacy adapter |
| `mobile/components/coachmarks/GuideDetailsSheet.jsx` (new) | Reusable detail text and focus restoration using native Clay patterns |
| `mobile/components/coachmarks/PracticeBanner.jsx` (new) | Always-visible sample identity and Exit practice |
| `mobile/components/coachmarks/DriverPracticeHost.jsx` (new) | Compose production views with local fixtures/handlers only |
| `mobile/app/(app)/profile/guide-practice.js` (new) | Thin authenticated route; validates memory session, never creates it |
| `mobile/components/map/MapTripPanel.jsx` (new) | Actual shared trip header/summary/progression region extracted from Map |
| `mobile/components/map/MapControlCluster.jsx` (new) | Actual shared map controls extracted from Map |
| `mobile/components/inspection/InspectionChecklist.jsx` (new) | Actual checklist fields and remarks; no fetch/submit/autofill |
| `mobile/components/fuel/FuelRequestForm.jsx`, `FuelReceiptReview.jsx` (new) | Actual current fuel fields, review and actions; controllers stay in screen |
| `mobile/components/incidents/IncidentReportForm.jsx` (new) | Actual category, safety questions, details, severity and submit presentation |
| `mobile/components/cargo/*` and `mobile/components/trips/OdometerCapture.jsx` (existing) | Reuse existing form/view seams; isolate native side effects as necessary |

Do not create all new files as empty scaffolding. Add each when its task produces working behavior. If an existing shared production component already expresses a proposed extraction, reuse it and record the corrected path in this plan.

## Task 1: Freeze existing behavior and define content contracts

**Files:** Create `mobile/lib/driver-guides.js`, `mobile/lib/driver-guides.test.js`; inspect `mobile/lib/coach-marks.js`, `mobile/lib/map-intro.js`, `mobile/lib/load-presentation.js`, `mobile/lib/driver-workspace.js`, `mobile/lib/coach-marks.test.js`; update `Capstone/02 - Features/Driver In-App Guide.md` with a migration inventory.

**Interfaces:** Export `getDriverGuide(id, variant)`, `listDriverGuides(variant)` and `LEGACY_GUIDE_IMPORTS`. Variants are `common`, `passenger`, `cargo`; use separate guide IDs for daily and per-trip inspections, pickup and delivery, fuel request and receipt, start and end odometer. Invalid IDs/variants return null/empty, never Passenger defaults.

Guide records have this exact minimum shape:

```js
{
  id: "cargo.departure", version: 1, variant: "cargo",
  title: "Before leaving pickup", section: "cargo",
  steps: [{
    id: "cargo.departure.clearance", targetId: "cargo.departure_status",
    title: "Wait for departure clearance",
    body: "A saved count or signature does not mean you can leave. Wait for every required source, fleet-team and post-load securement check to clear.",
    details: "Saved on this device means the record may still need syncing. Saved by Fleet means it reached the fleet system. A partner acknowledgment means the message was received, not that the quantity was accepted. Departure permission is a separate current decision. Refresh after the responsible team reviews it. Do not depart when the app says the record is unsynced, unavailable or awaiting clearance.",
    interaction: "observe", eventType: null
  }]
}
```

- [ ] Inventory every current milestone/version/target/producer/consumer, navigation owner, URL tour branch, stored key and simulation side effect. Recount from current source; do not assume the old 23/44 figures remain correct.
- [ ] Add a failing registry test for separate Passenger/Cargo content, full explanatory fields, unique step IDs, valid targets and no Cargo guest-pickup terminology. Run `npx vitest run mobile/lib/driver-guides.test.js`; require a meaningful failure before implementation.
- [ ] Implement the catalogue from design section 4. Preserve useful current content only when it matches today's contracts. Derive dynamic counts/times/units from screen context and current production helpers.
- [ ] Run that suite and existing `mobile/lib/load-presentation.test.js` and `mobile/lib/driver-workspace.test.js`. Expect all passing. Review the copy manually for accurate consequences; string-length checks alone cannot establish usefulness.
- [ ] Document exact old-to-new ownership and planned commit `feat(mobile): define driver guidance catalogue`. Stage only task-owned hunks after review.

## Task 2: Driver-scoped progress, conservative migration and replay

**Files:** Create `mobile/lib/driver-guide-progress.js`, `mobile/lib/driver-guide-progress.test.js`, `mobile/lib/driver-guide-storage.test.js`; modify `mobile/lib/coach-mark-storage.js`.

**Interfaces:** The pure progress module exports `guideProgressKey({actorId, guideId, variant, version})`, which throws on missing identity; `nextGuideProgress(previous, action, at)`, which returns `{status, updatedAt, source}` for `seen`, `dismiss` and `complete`; and `importLegacyGuideProgress(scope, legacyValues, at)`, which returns a migrated record or null. None processes an operational action. Add storage exports `readGuideProgress(scope)`, `writeGuideProgress(scope, record)` and `resetGuideProgress(scope)`. The provider reads legacy values, calls the pure import and persists a returned record only when the new key is absent. Storage failure returns an explicit unavailable result instead of pretending success.

Key format: `fleetops.guide2.<guideId>.<variant>.v<version>_<actorId>`. Do not read unscoped keys as evidence that every driver completed a guide. Writes are serialized per actor/key; include a captured actor/session guard so an old async completion cannot alter current-account state. Completion and dismissal suppress auto-show; seen does not. A provider's in-memory visit gate prevents repeated display during one visit.

```js
it("imports an old combined skip/completion value without claiming completion", () => {
  expect(importLegacyGuideProgress(
    { actorId: "17", guideId: "welcome", variant: "common", version: 1 },
    { welcome: "completed" }, 1000
  )).toMatchObject({ status: "dismissed", source: "legacy_unknown_outcome" });
});
```

- [ ] Implement failing cases for actor/variant/version separation, old true/completed import, ambiguous keys, idempotent migration and no global reset.
- [ ] Define replay as an in-memory presentation override; preserve prior persistent outcome until explicit dismissal/completion of replay. Test exit/background during replay preserves it.
- [ ] Implement storage/import rules without deleting old keys. Failed writes retain session-local suppression and show an honest persistence failure on explicit Reset/Replay actions.
- [ ] Run `npx vitest run mobile/lib/driver-guide-progress.test.js mobile/lib/driver-guide-storage.test.js mobile/lib/coach-marks.test.js`; expect passing without weakening old expectations unrelated to the future sequence change.
- [ ] Planned commit: `feat(mobile): scope and migrate driver guide progress`.

## Task 3: Safe eligibility and isolated practice sessions

**Files:** Create `mobile/lib/driver-guide-policy.js`, `mobile/lib/driver-guide-policy.test.js`, `mobile/lib/driver-practice.js`, `mobile/lib/driver-practice.test.js`, `mobile/lib/use-driver-practice.js`, `mobile/lib/driver-practice-lifecycle.test.js`; inspect `mobile/lib/tracking.js`, `mobile/lib/motion-state.js`, `mobile/lib/driver-workspace.js`.

**Interfaces:** `evaluateGuideEligibility(snapshot)` returns `{allowed, reason}`. Snapshot explicitly includes `kind` (`automatic`, `details`, `practice`), `now`, foreground, emergency/responder state, motion `{speedMs, observedAt, movingHold}`, confirmed actor/workspace, assignment/submission state, route and target readiness, and `parkedConfirmed`. Use the specification's numerical freshness/expiry rules; missing values remain unknown.

`createPracticeSession({id, epoch, actorId, topic, variant, now, eligibility})` refuses disallowed eligibility and returns memory-only `{id, epoch, actorId, topic, variant, createdAt, expiresAt, phase, data}`. `reducePractice(session, event, now)` consumes `{sessionId, epoch, stepId, type, payload}` and accepts only the expected successful event for that step. `useDriverPractice` owns the session and exposes `startPractice`, `dispatchPractice`, `endPractice` and `practiceSession` to the provider. It receives current context and the injected clock; it does not create its own operational subscriptions or location watcher.

```js
it("does not accept movement as parked confirmation", () => {
  expect(evaluateGuideEligibility({
    kind: "practice", now: 10000, foreground: true,
    emergency: false, responderWork: false,
    actorConfirmed: true, workspace: "cargo",
    hasAssignment: false, hasPendingSubmission: false,
    parkedConfirmed: true,
    motion: { speedMs: 2, observedAt: 9990, movingHold: false }
  })).toMatchObject({ allowed: false, reason: "movement" });
});
```

- [ ] Write failing policy cases for fresh stationary, stale/unknown/nonfinite motion, sticky movement, creeping speed, invalid clock, emergency, no identity, active assignment and pending receipt/report.
- [ ] Preserve the existing global motion hook. Expose the existing poster evidence to the provider using its current subscription/hook; introduce no second GPS stream. Apply stricter tutorial eligibility separately.
- [ ] Add unknown-GPS explicit-practice handling only with no operational work, parked confirmation and no movement veto. Once a known-motion session becomes stale, suspend/end it; never downgrade silently into the unknown exception.
- [ ] Add reducer/lifecycle tests for expiry, double events, failed validation, incorrect session/epoch, background, logout, new assignment, urgent deep link and late promises. Confirm no implicit resume or business-data cleanup.
- [ ] Run `npx vitest run mobile/lib/driver-guide-policy.test.js mobile/lib/driver-practice.test.js mobile/lib/driver-practice-lifecycle.test.js mobile/lib/motion-state.test.js`; expect passing, with no global threshold changes.
- [ ] Planned commit: `feat(mobile): isolate parked driver practice sessions`.

## Task 4: Independent guide orchestration and lightweight Welcome

**Files:** Modify `mobile/components/coachmarks/CoachMarkProvider.jsx`, `mobile/components/coachmarks/index.js`, `mobile/app/(app)/_layout.js`, `mobile/app/(app)/(tabs)/index.js`, `mobile/components/home/DriverHomeCards.jsx`, `mobile/components/DriverSos.js`, `mobile/components/CurvedPillTabBar.js`; create `mobile/lib/driver-guide-provider.test.js`; retain `mobile/lib/coach-marks.test.js` regression intent.

**Interfaces:** Add stable provider actions `requestGuide({guideId, variant, context, source})`, `replayGuide({guideId, variant})`, `recordGuideEvent({sessionId, epoch, stepId, type, outcome})` and the practice actions from Task 3. `source` is `automatic` or `manual`; events advance only the active matching guide/step and only on its declared successful outcome. Preserve the three context partitions and existing operational hooks.

- [ ] Add a build-time `EXPO_PUBLIC_DRIVER_GUIDES_V2` coexistence switch, default off until acceptance. In v2, Welcome dismissal leaves Home idle; assert zero unrelated trigger/navigation calls.
- [ ] Replace the cascade with independent screen requests. One active guide, one automatic intro per screen visit, no replay-induced global reset, no stale target/route requests and no completion-driven navigation.
- [ ] Audit all old producers and tour shortcut interception. In v2 disable legacy producers, not only the Welcome branch. Legacy `?tour=1` entries must show an explanation/return to Help without enabling synthetic approvals or real mutations. Keep legacy behavior behind the off switch only during migration.
- [ ] Execute the actual provider through the repo's mocked-native harness. Test an AsyncStorage await racing movement/account/route changes; recheck eligibility after awaits. Test one action produces one navigation/step outcome and no unrelated screen opens.
- [ ] Run `npx vitest run mobile/lib/driver-guide-provider.test.js mobile/lib/coach-marks.test.js mobile/lib/driver-guide-policy.test.js`. Update obsolete chain-specific assertions only for the v2 mode; preserve the protection they originally tested.
- [ ] Record the first shipped slice in the guide/architecture notes. Planned commit: `feat(mobile): make driver guidance independent by section`.

## Task 5: Useful detail disclosure, overlay resilience and accessible practice shell

**Files:** Create `mobile/components/coachmarks/GuideDetailsSheet.jsx`, `PracticeBanner.jsx`, `DriverPracticeHost.jsx`, `mobile/app/(app)/profile/guide-practice.js`, `mobile/lib/driver-guide-details-render.test.js`, `mobile/lib/driver-practice-host.test.js`; modify `CoachMarkTooltip.jsx`, `CoachMarkOverlay.jsx`, `CoachMarkTarget.jsx` only where needed and register the thin route in the existing profile/app routing pattern.

**Interfaces:** `GuideDetailsSheet({visible, title, body, onClose})` renders the selected step's details and restores opener focus. `PracticeBanner({topic, onExit})` has persistent label `Practice mode - sample data` and text `Nothing here will be submitted.` `DriverPracticeHost({session, onEvent, onExit})` switches among registered shared production views; it cannot start its own session. The route reads the provider's valid session only.

- [ ] Inspect the existing Cargo signature modal, Help disclosures and Clay components before building. Use their established native focus/Back/scroll patterns and native theme, not dashboard tokens.
- [ ] Add actual-render/callback tests for More details, Close/focus return, Not now, Android Back and Exit. Keep essential actions reachable at 320 width and 200% text.
- [ ] Preserve window-to-container target coordinates, presentation generation and reduced-motion handling. A missing/unmounted/offscreen target cancels the automatic spotlight without a blocking scrim; manually opened text help remains accessible.
- [ ] Deep-link directly to the practice route with no provider capability and assert no sample approval, operational controller mount or submission fallback. Reject expired/wrong-account capabilities synchronously before rendering interactive controls.
- [ ] Ensure a genuine SOS/emergency entry cancels presentation immediately and retains existing operational behavior with no new tutorial confirmation. No practice SOS control invokes the genuine sender.
- [ ] Run `npx vitest run mobile/lib/driver-guide-details-render.test.js mobile/lib/driver-practice-host.test.js mobile/lib/driver-guide-provider.test.js`; expect passing. Planned commit: `feat(mobile): add readable guide details and clear practice identity`.

## Task 6: Real Map components and Passenger practice

**Files:** Create `mobile/components/map/MapTripPanel.jsx`, `MapControlCluster.jsx`, `mobile/lib/driver-map-guide.test.js`, `mobile/lib/driver-map-practice-render.test.js`; modify `mobile/app/(app)/(tabs)/map.js`, `mobile/components/SwipeButton.js` only if the shared component needs a tested accessibility correction, and the practice host; retain `mobile/components/MapIntroPractice.jsx` and `mobile/lib/map-intro.js` for legacy mode until Task 12.

**Interfaces:** `MapTripPanel({trip, summary, action, onAction, children})` owns production presentation; `action` is `{label, disabled, busy, reason}` from the existing controller. `MapControlCluster({controls})` renders production controls with each existing `{id, label, icon, disabled, onPress}`. Keep special native map/WebView lifecycle and real navigation handlers in Map, outside these view modules. Practice composes the same views and actual SwipeButton with local handlers; no cloned gesture implementation.

- [ ] First characterize current production labels, disabled/busy behavior, header/sheet layout, control availability and swipe callback contracts with actual component/callback tests.
- [ ] Extract without changing operational behavior; reuse existing `load-presentation` labels and current Map phase rules. Do not introduce a second hardcoded progression table. If extracting a pure phase descriptor is necessary, make the real controller consume it too and retain existing mutation ownership.
- [ ] Add standby and active-trip contextual guides. No Layers tutorial target is fabricated on an active view that lacks Layers. Route summary/ETA guidance states what is estimated and what is confirmed.
- [ ] Implement explicit Passenger sample pickup and drop-off using Task 1 copy. The production Map retains its layout; the practice host uses a clearly labeled sample route region and makes no claim of real GPS/assignment status. Reuse shared controls; unsupported external navigation is explained, not launched.
- [ ] Bind `onSwipeSuccess` to `dispatchPractice` only in the sample host. Assert failed/partial swipe stays on the current step, busy blocks duplicates, valid swipe advances once, and real Map callbacks still call their original endpoints/guards.
- [ ] Run `npx vitest run mobile/lib/driver-map-guide.test.js mobile/lib/driver-map-practice-render.test.js mobile/lib/map-action-confirmation.test.js mobile/lib/cargo-map-start.test.js mobile/lib/load-presentation.test.js`. Planned commit: `feat(mobile): teach trip progression with the production map controls`.

## Task 7: Inspections, readiness and odometer guidance

**Files:** Create `mobile/components/inspection/InspectionChecklist.jsx`, `mobile/lib/driver-inspection-guide.test.js`, `mobile/lib/driver-odometer-guide.test.js`; modify `mobile/app/(app)/inspection.js`, `mobile/app/(app)/trip/[id].js`, `mobile/app/(app)/trip/odometer.js`, `mobile/app/(app)/trip/complete.js`, `mobile/components/trips/OdometerCapture.jsx`, `mobile/lib/use-trip-odometer.js` only for a justified side-effect/presentation seam; integrate the host.

**Interfaces:** `InspectionChecklist({items, answers, remarks, onAnswer, onRemarks, disabled})` renders the actual production controls without initialization or submit effects. Reuse `OdometerCapture` as the shared camera/review presentation; production hook owns native camera/upload/scan while sample input provides an included fictional photo and local review results. Do not create a second capture/review component or call the real hook in practice.

- [ ] Write failing cases separating daily shift, Passenger quick check and Cargo securement guides. Use actual current checklist items, conditional remarks and dynamic totals. Do not seed a failed real check, auto-pass or submit to complete a guide.
- [ ] Extract the checklist view; leave production fetching, mode/identity resolution, submit validation and shift/trip writes in their controller. Supply only local answers in practice.
- [ ] Add readiness, start-photo and end-photo content from the design. Show photo guidance only when the real trip requires it. Preserve the existing legacy/manual path rather than turning this tutorial task into an odometer-policy change.
- [ ] Use a sample total-km image already available if suitable; otherwise create a simple repository-native synthetic fixture with an explicit Sample label. No real image upload/model call/native permission in practice. Wrong/ambiguous sample readings require Retake; no manual replacement of photo-based odometer values.
- [ ] Assert start confirmation's real consequence is explained, cancellation retains real drafts, Cargo holds still block completion and a rejected/queued real operation does not masquerade as a successful tutorial event.
- [ ] Run `npx vitest run mobile/lib/driver-inspection-guide.test.js mobile/lib/driver-odometer-guide.test.js mobile/lib/trip-odometer-render.test.js mobile/lib/trip-odometer-entry.test.js mobile/lib/trip-odometer-recovery.test.js mobile/lib/trip-completion-render.test.js`. Planned commit: `feat(mobile): explain inspections and trip odometer decisions`.

## Task 8: Fuel requests and receipt practice through the real fields

**Files:** Create `mobile/components/fuel/FuelRequestForm.jsx`, `FuelReceiptReview.jsx`, `mobile/lib/driver-fuel-guide.test.js`, `mobile/lib/driver-fuel-practice-render.test.js`; modify `mobile/app/(app)/fuel-report.js`, the practice host and `mobile/lib/driver-guides.js`; inspect `mobile/lib/fuel-scan-demo.js` and the current sample receipt fixture.

**Interfaces:** Shared fuel views receive current values/errors/status and existing input/review/submit callbacks as props; their names mirror the extracted production controls. Screen controller retains request queries, approval policy, camera/upload/scan, polling, queue and final submission. Host supplies the same view props from `reducePractice`, never a synthetic `isTour` approval inside the operational controller.

- [ ] Characterize current request/approval/receipt control visibility and callback behavior in rendered tests before extraction.
- [ ] Add separate request and receipt guides with More details covering correct vehicle, gauge confirmation, Pending versus Approved, scan verification, duplicate avoidance and existing manual recovery.
- [ ] Reuse the sample receipt's printed total 2,911.25 and incorrect extracted total 2,911.75. Exercise the actual editable review field and validator. A wrong value cannot complete the sample step; correction advances once.
- [ ] Prove opening/retaking/submitting a sample invokes no native camera, file copy, upload, model request, fuel mutation, polling or queue insertion attributable to practice. Existing real form paths retain authorization and approval behavior.
- [ ] Run `npx vitest run mobile/lib/driver-fuel-guide.test.js mobile/lib/driver-fuel-practice-render.test.js mobile/lib/coach-mark-simulation.test.js`; include the current fuel render/queue suites identified by Task 1's inventory. Planned commit: `feat(mobile): guide fuel authorization and receipt verification`.

## Task 9: Incident decisions, SOS priority and honest offline explanations

**Files:** Create `mobile/components/incidents/IncidentReportForm.jsx`, `mobile/lib/driver-incident-guide.test.js`, `mobile/lib/driver-offline-guide.test.js`; modify `mobile/app/(app)/incidents.js`, `mobile/components/DriverSos.js`, `mobile/components/ConnectivityBanner.jsx`, host and registry; inspect `shared/incidents/severity.js`, `mobile/lib/sync.js`, `mobile/lib/connectivity-state.js` and existing incident status screens.

**Interfaces:** Shared incident view receives actual category/assessment/severity/details/assistance fields and their existing handlers. Real controller owns live reports, location, native confirmation, mutation and queues. Sample controller calls the same pure severity helper with fictional data. Connectivity guidance augments the current banner, not a second automatic overlay.

- [ ] Add real-form callback tests for assessment-driven severity, changed-severity reason and existing Critical confirmation; preserve exact business rules.
- [ ] Add contextual incident content and optional local sample report. End with `Practice complete - no report was sent`, never a simulated responder dispatch or genuine Emergency Report Sent message.
- [ ] SOS remains explanation-only; no exercise presses/sends/dials. Opening a real emergency path cancels guides before the real existing handler is called, without changing its confirmation contract.
- [ ] Teach device-saved/queued/received/acknowledged as separate real states. Do not promise every operation queues offline; photo trip transitions and Cargo clearance keep their existing restrictions. Show configuration-unavailable guidance without enabling a provider.
- [ ] Run `npx vitest run mobile/lib/driver-incident-guide.test.js mobile/lib/driver-offline-guide.test.js mobile/lib/connectivity-state.test.js mobile/lib/coach-marks.test.js` plus current incident/sync suites from the inventory. Planned commit: `feat(mobile): explain incident outcomes and offline limits`.

## Task 10: Cargo count, signature and clearance guidance

**Files:** Modify `mobile/components/cargo/CargoWorkflowScreen.jsx`, `CargoWorkflowContent.jsx`, `CargoItemReceiptRow.jsx`, `CargoIssueSheet.jsx`, `CargoDecisionStatus.jsx`, `CargoSignatureModal.jsx`, practice host and registry. Create `mobile/lib/driver-cargo-guide.test.js`, `mobile/lib/driver-cargo-practice-render.test.js`. Reuse `mobile/lib/cargo-view-model.js`, `mobile/lib/cargo-form-state.js`, `mobile/lib/cargo-demo-fixtures.js`, `shared/cargo-handover.js`; inspect existing demo scenarios for reusable fixture values, not duplicate UI.

**Interfaces:** Add stable targets around actual manifest units/count, issue, review, signature and decision controls. Production `CargoWorkflowContent` remains the shared view seam. Separate any native location acquisition in `CargoSignatureModal` into a production-supplied callback; sample modal receives a local callback returning an honest unavailable location, never a permission prompt. Keep the validated drawing/acknowledgment behavior shared.

- [ ] Test blank versus zero, measured versus whole-package units, 10 expected / 9 counted, supported issue/reason and 10 requested / 9 picked-up / 9 delivered shortage arithmetic.
- [ ] Add the design's Cargo guides in stage order: manifest/count, issue, releasing acknowledgment, saved/clearance states, delivery and receiving acknowledgment. Details distinguish vehicle inspection from item verification and pickup securement from post-load clearance.
- [ ] Practice uses the actual count editor, issue sheet, review summary, signer modal and decision display. Use fictional names/drawings only in memory. Changing the count invalidates its prior sample signature; cancellation retains sample counts. A sample recount preserves the previous sample observation within that session.
- [ ] Include clean pickup, shortage/WAIT/recount, unsynced receipt, unavailable service, signed-but-not-cleared pickup and delivered-but-no-receiver-authority. No local checkbox or signature sets a real `can_depart`/`can_complete` capability.
- [ ] Explain recipient refusal by directing to Fleet without inventing a new authority/disposition flow. No production provider, storage, grant, endpoint or server policy activation belongs in this task.
- [ ] Run `npx vitest run mobile/lib/driver-cargo-guide.test.js mobile/lib/driver-cargo-practice-render.test.js mobile/lib/cargo-signature-render.test.js mobile/lib/cargo-signature-workflow.test.js mobile/lib/cargo-view-model.test.js mobile/lib/cargo-verification-render.test.js mobile/lib/cargo-map-start.test.js`. Planned commit: `feat(mobile): teach cargo counts handovers and approval holds`.

## Task 11: Section replay and complete explanatory Help

**Files:** Modify `mobile/app/(app)/profile/help.js`, relevant section Help entry points and registry/provider. Create `mobile/lib/driver-guide-help-render.test.js`; reuse `ClayMenuRow` and existing FAQ disclosure patterns.

**Interfaces:** The existing Help & Support screen calls `listDriverGuides(variant)` and displays Read guide, Replay guide and eligible Practice for the selected section. Replay uses Task 4's action, not Reset all. A section's local Replay entry opens the same Help section and does not start practice automatically.

- [ ] Add actual-render tests for common + Passenger/Cargo filtering, unknown workspace, unavailable practice reason, other-workflow sample labeling, per-guide replay and current-driver-only reset.
- [ ] Keep full text useful when no active trip, no target, no GPS or no connection exists. Read guide never requires a fake operational screen or a real assignment.
- [ ] Put Reset all tips behind the existing explicit confirmation as a secondary control. Display storage failure honestly; do not show success if clearing failed.
- [ ] Add FAQs answering the most likely driver questions: why start is blocked, daily versus quick inspection, photo retake, Cargo signature versus clearance, pending fuel and whether an offline report reached Dispatch. Reuse catalogue text rather than maintain a conflicting copy.
- [ ] Run `npx vitest run mobile/lib/driver-guide-help-render.test.js mobile/lib/driver-guide-storage.test.js mobile/lib/driver-practice-host.test.js`. Planned commit: `feat(mobile): add section replay and practical driver help`.

## Task 12: Isolation proof and legacy removal

**Files:** Create `mobile/lib/driver-guidance-isolation.test.js`, `mobile/lib/driver-guidance-regression.test.js`; modify migrated integrations and existing tests. Remove `mobile/components/MapIntroPractice.jsx`, obsolete `mobile/lib/map-intro.js`/tests and obsolete simulation files only after their inventory owners are migrated. Keep any shared fixture still used by new receipt practice.

**Interfaces:** All production and sample views now use independent guide requests. Remove the coexistence flag only after the full v2 path passes acceptance; old storage keys may remain inert until a separately justified retention cleanup.

- [ ] Build a harness around actual host/shared-view callbacks. Fail immediately on unexpected imports/calls to real API mutation/upload/queue/autosave/file copy/location/phone/navigation functions; include a call-count spy for each boundary. An import scan is supplemental, not the proof.
- [ ] Execute every registered sample's success, validation failure, retry, cancel and interrupt path. Include out-of-order, repeated and stale-account events plus direct URLs with legacy tour flags.
- [ ] Separately exercise real production handlers and assert their required writes/guards still run. A sample test passing because all callbacks are no-ops is not acceptable.
- [ ] Compare actual app network/queue activity with an idle baseline; identify practice-origin work separately from legitimate app-wide background activity. No practice data enters real trip caches, submissions, stored photos or signatures.
- [ ] Search references with `rg -n 'MapIntroPractice|TutorialSwipeButton|map-intro|tour_sos|tour_preshift|tour_step|isTourShortcutActive' mobile`. Classify every result before deletion. Do not bulk-delete tests merely because they assert old names; port measurement, duplicate-navigation, motion and zero-mutation regressions.
- [ ] Run `npm run test:run -- mobile/lib`, `npm run lint:ci` and `npm run verify:encoding`. Then run `npm run test:run` for the integrated regression. Record actual outputs and resource/permission blockers; do not weaken checks or claim skipped suites passed.
- [ ] Planned commit: `refactor(mobile): retire legacy driver tour paths` after Task 13's acceptance allows flag removal. Until then keep old code isolated and label cleanup pending.

## Task 13: Android, accessibility and driver usefulness acceptance

**Files:** Create `Capstone/07 - Development/Driver Guidance Acceptance 2026-10-20.md` during execution with actual dates/results; update the guide, Trips, Fuel, Incidents, Mobile Architecture and relevant map notes, plus SYSTEM.md. This note does not exist yet because no implementation/device checks have run.

- [ ] Produce the Android export from the mobile directory: `npx expo export --platform android --max-workers 1 --output-dir .expo-driver-guides-export`. Record success or exact failure. Export is not native-device acceptance. Remove only task-owned temporary artifacts after checking their absolute paths.
- [ ] Inspect light/dark layouts at 320, 360 and 390 dp, landscape and 200% text. Check first/last step, long details, keyboard, safe areas, unavailable target, loading/error and sample banner. Reuse the actual components, not screenshots of mock layouts.
- [ ] On a physical Android device verify swipe once/partial/busy, spotlight alignment during scrolling/rotation, TalkBack focus/announcements, reduced motion, Back/close, real camera permission denial and no permission prompts from sample practice.
- [ ] Verify stationary entry, known movement suppression, stale GPS, denied GPS, app background, return, incoming assignment, logout, reconnect and urgent entry. Do not perform a driving experiment that requires the driver to interact with a moving vehicle; simulate motion evidence or use an independent observer in a controlled test.
- [ ] With approved staged identities, verify the genuine Passenger journey through inspection, start evidence, pickup/drop-off and ending evidence remains intact. Record all business effects from staged real operations separately from sample practice. Cargo operating E2E remains a separate integration gate; test tutorial holds with isolated fixtures.
- [ ] Run the formative pilot described in design section 8: at least three unfamiliar participants per workflow. Observe independent sample task completion, explanation of saved/approval states and recovery. Fix every safety misunderstanding; repeat the affected scenario and record the outcome, without inventing participant results.
- [ ] When these gates pass, remove the coexistence switch/legacy code under Task 12, rerun affected tests/lint/encoding/export, and update docs to describe the actual new default. If phone or participant acceptance is unavailable, preserve the rollout gate and report the remaining release block explicitly.
- [ ] Planned commit: `docs(mobile): record driver guidance acceptance and workflow rules`. Do not deploy, push, activate Cargo providers or run DB migrations as part of this plan.

## Requirement coverage and final handoff

| Requirement | Tasks |
|---|---|
| Well-explained actions, reasons, consequences and recovery | 1, 5, 7-11; design content catalogue |
| No forced chain, independent relevant triggers | 3-4 |
| Common and correct Passenger/Cargo content | 1, 6-10 |
| Real production UI, actual SwipeButton, no replicas | 5-10 |
| Isolated local practice with no operational effects | 3, 5-10, 12 |
| Safe motion/emergency/session handling | 3-5, 9, 12-13 |
| Current odometer and signed Cargo rules | 7, 10 |
| Progress migration and individual replay | 2, 4, 11 |
| Offline, missing targets, unavailable services | 3, 5, 9-11 |
| Accessibility, physical device, driver understanding | 5, 12-13 |
| Legacy cleanup and synchronized documentation | 12-13 |

Execution should proceed inline task-by-task unless the owner requests agents. Review each working slice before starting the next dependent task. Keep commit boundaries logical; avoid including existing unrelated changes. Final reporting must distinguish implemented code, automated checks, physical device checks, participant findings and deployment status.

Planning self-review completed: all proposed guide topics map to tasks; numerical motion/expiry rules and interfaces match the design; old boolean imports preserve uncertainty; real operational effects remain distinct from sample interactions; no Cargo activation or new server/storage feature is hidden inside tutorial work. This plan contains intended future checks, not passing results.
