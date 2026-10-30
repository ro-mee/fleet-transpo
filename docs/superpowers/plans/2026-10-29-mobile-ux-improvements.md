# FleetOps mobile UX improvements implementation plan

> **For agentic workers:** Use the existing independent task owners for the tasks below; root reviews their changes and verifies the combined result. Audit completed before application source edits. The owner explicitly approved implementation after audit.

**Goal:** Correct confirmed workflow/accessibility defects, then evolve existing native components toward Elevated Clean.

**Architecture:** Preserve Expo Router, current shared components and state/API contracts. Keep four destinations and current Passenger/Cargo authority. Reuse existing policy, native alert/scroll/permission controls and motion hook; no new dependency or database work.

**Tech stack:** Installed Expo54/RN0.81.5/React19.1, Vitest/esbuild component callback harness, React Native Web supporting fixtures.

## Global constraints

- Read `.agents/AGENTS.md`, relevant vault notes and `mobile/AGENTS.md`; Expo57 guide has been read, but installed SDK stays54.
- Baseline includes unrelated uncommitted launch/Home changes. Snapshot: `scratch/mobile-ux-audit-2026-10-29/source-baseline.json`; preserve those edits. No commits/push/deployment/operating-data changes.
- Full baseline audit: `Capstone/01 - System/Mobile UI UX Audit 2026-10-29.md`, exact17 sections. User direction overrides older keep-clay instructions.
- Verify meaningful behavior changes with failing-before/passing-after checks. Pure visual changes use rendering/checks, not implementation-mirroring tests.
- Keep security, validation, stale account/context fences, immutable Cargo retries, callback-once and theme-style key parity.

## Task 1: Shared readability and native controls (native owner)

Files: `mobile/lib/theme.js`, `components/clay/ClayInput.jsx`, `components/AppAlert.js`, `NotificationHost.jsx`, `RadarPulse.jsx`, `lib/theme-context.js`; shared materials/card/button/tile files.

- [x] Reproduce HC-dark contrast and input accessibility failures using real theme exports/component harness. Assert four palettes at least4.5:1 for opaque status text, explicit zero remains elsewhere unaffected, accessory48dp/name and caller-label override.
- [x] Correct dark resolution and target floor; use registered type/font keys, input label default and named visibility action. Preserve explicit inputStyle/accessible-label overrides.
- [x] Make global alert body bounded/scrollable and actions grow/stack with large text; honor reduced motion without losing replacement/Back/callback-once guards. Use hook consistently in notifications/radar/theme.
- [x] Quiet existing material APIs: subtle outer elevation, flat inner tiles/pills,12dp controls/16dp cards, no inset sheen or thick embossed edges. Keep light/dark key parity and fallback compatibility.
- [x] Run focused tests and strict changed-file lint. Record exact evidence in task report. Do not edit Home/tab files, forms/routes or shared docs owned by root.

## Task 2: Honest forms/profile/recovery (forms owner)

Files: Fuel screen/form, devices/work-schedule/personal/license, Help/About, incidents/detail/navigation, permissions/settings, driver-profile hook only as needed; focused regressions.

- [x] Reproduce blank-fuel, queued revoke/leave/phone, valid-license replacement and cancelled-phone draft failures. Real callback tests must verify no success/local removal after unconfirmed request and draft retention on failure.
- [x] Require nonblank finite0–100 fuel (valid0 allowed), visible error and matching disabled state; keep photo/vehicle gates and practice compatibility.
- [x] Set existing `queueOnFailure:false` for confirmed-only operations; defensively reject queued results. Keep session row/current session and failed drafts until acknowledgment.
- [x] Show existing license source controls for early renewal, name viewer Close. Remove callable placeholder support data; retain factual unconfigured guidance and existing FAQ/guides.
- [x] Correct incident photo warning without duplicate submission advice, expose truthful responder error/retry/stale state and acknowledged transitions; bound optional location acquisition if safe in existing contract.
- [x] Correct personal Cancel/validation/retry; label switches and photo controls; add permanent-denial/Settings-return recovery using existing registry. Keep old guide rollout flag unchanged; correct absent-library copy.
- [x] Run focused regression and changed-file lint; record findings/limits. Do not edit consent, Home, shared primitive/theme or docs.

## Task 3: Canonical trip/Cargo journey (trip owner)

Files: `CargoWorkflowScreen.jsx`, Cargo issue/signature/content; `map.js`, hidden `vehicle.js`/`fuel_action.js`, `trip/override.js`, inspection/checklist; focused regressions.

- [x] Reproduce exact-trip lookup error and generic409 override; preserve target/session guards while using existing `trip_id` endpoint and propagating failed trip read.
- [x] Restrict override offers to `GEOFENCE_OUTSIDE`. Re-read current trip/profile and bind session for override; reject invalid action/stale/busy/offline; don't queue dependent transitions or navigate before acknowledgment. Preserve reason on failure.
- [x] Redirect legacy vehicle route to canonical Map and blank fuel stub to Fuel. Verify old URL still resolves with no old status/watch UI.
- [x] Make failed safety checklist CTA truthful and selected choices/required remarks named. Preserve server blocking logic and inspection content.
- [x] Show frozen reviewed quantities in existing Cargo signature modal, read-only status rather than disabled receiver pseudo-action, explicit Return to Map. Add local evidence preview/remove only for editable drafts if existing URI contracts permit it; do not mutate signed retries.
- [x] Name/size Map expand action, honor reduced motion and move expanded-only extras out of collapsed summary if they obscure the primary action. Preserve gestures/navigation readiness and labels.
- [x] Run focused tests/lint and record task report. Do not change shared theme/materials, Home, docs or forms outside this scope.

## Task 4: Operational Home, navigation and policy (root)

- [x] Replace large decorative work overview with compact real duty label/support for both types; show current assignment before secondary summary. Keep missed report/pre-shift/end-duty warnings and unknown data distinction.
- [x] Keep Incident visible in first four shortcuts for both types; End Duty stays separately reachable throughout duty. Preserve tutorial target identifiers/guards and Fuel permission.
- [x] Keep four tabs/scan action; use native semantic colors and quiet bar, readable adaptive label sizing without increasing Map overlap. Preserve tabPress/guide actions and inset contract.
- [x] Read existing pure policy in consent; show explicit Read policy action and scrollable existing text, separate agreement. No invented policy/route or version change.
- [x] Verify actual-component narrow/large-text light/dark/HC fixtures with browser if available; distinguish fixtures from native acceptance.

## Task 5: Review, verification and durable documentation (root)

- [x] Review each task diff against task-start snapshot, address confirmed issues, run relevant combined mobile suite once and strict changed-file lint; encoding and whitespace gates.
- [x] Run final Android Hermes export with workspace-local temp. Record export as JS/assets only, not installed native acceptance.
- [x] Update mobile README, main mobile audit index, Mobile Architecture, relevant feature notes and SYSTEM.md with final changes/check counts and remaining limits.
- [x] Remove completed one-time continuation automation (owner confirmed; app deletion verified 2026-10-29); final response links full audit and states actual implementation/verification outcome. No approval request is needed for already-authorized fixes.

## Device/product acceptance remaining after software checks

Actual Android/iOS screen-reader focus, native gestures/keyboard/Back, camera/signature/permission return, outdoor visibility, Google Maps/background delivery, installed splash/icon/audio, tablet and real driver comprehension require device/user access. Guide V2 release rollout and alternative signature authority remain separate acceptance decisions; do not weaken checks or invent backend support.

## Final implementation evidence — 2026-10-29

Completed in the existing saved checkout on codex/internal-cargo-testing, preserving prior launch/branding edits. 1,602 tests passed across136 files (full mobile/lib plus responder identity and shared-policy compatibility); strict ESLint passed82 changed JavaScript files; Android Hermes export passed (1,538 modules,6,488,762-byte bundle,99 asset files); UTF-8 and whitespace gates passed. This is JS/assets verification, not an APK/native/device result.

Independent native/Home and forms/trip reviews found and closed adaptive tab/header sizing, dropped api.get actor/abort options, comma-only fuel input and stale responder mission actions. Arrival/resolve now accept a backward-compatible expected incident ID and refuse changed assignments. A final export failure exposed that src/lib/consent/policies.js was outside Metro’s allowed folders; the unchanged pure policy text now lives in existing shared/privacy-policy.js, with stable web/API re-exports and a shared mobile version. Focused4/4 and independent policy review confirmed unchanged text/version and compatible imports.

Browser samples used actual Home/tab components at light, dark/large text and narrow high contrast with native/API substitutions. Header intrinsic height, navigation label bounds and semantic upcoming-label contrast were corrected. Browser control was later disabled in Work settings; broader shared alert/input/Cargo/signature visual checks remain unverified, along with every listed physical-device acceptance item. The black background observed by the owner was a high-contrast dark fixture, not a changed default setting. No merge/push/commit, cloud build/deployment, operating-data write, dependency/SDK or schema change occurred.

After the owner explicitly confirmed removal on 2026-10-29, the app deleted the one-time Continue FleetOps mobile UX audit automation (continue-fleetops-mobile-ux-audit); its deletion response confirmed deleteStatus=deleted. The earlier approval block is resolved.

## Owner correction — restore recent Home design, 2026-10-29

The user explicitly rejected removing the recent Cargo/Hotel Home imagery. Restore/preserve the original illustrated hero, typography/colors, top overview and related loading/material presentation. The earlier Task4 removal/move recommendations are superseded; retain independent confirmed workflow/accessibility fixes. Restored from the pre-audit source snapshot, with66 focused checks passing. See the latest Home vault entry for final verification and browser/device limits. This source snapshot remains evidence only; do not wholesale reset unrelated audit or launch work.

## Selected appearance rollback — 2026-10-30

Owner explicitly requested undoing bottom navigation, cards/buttons and Home header changes. Restored original styling from the saved source snapshot, keeping input/popup changes and functional fixes. Prior flattening/nav visual recommendations for these surfaces no longer govern. See the latest Home vault entry for verification and captures.
