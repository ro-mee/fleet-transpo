---
type: implementation-plan
status: in-progress
date: 2026-10-14
tags: [mobile, navigation, google-maps, gps, android, overlay]
source:
  - docs/superpowers/specs/2026-10-14-google-maps-navigation-handoff-design.md
  - docs/superpowers/plans/2026-10-14-google-maps-navigation-handoff.md
  - docs/superpowers/plans/2026-10-14-android-trip-bubble.md
related: ["[[Tracking]]", "[[Trips]]", "[[Mobile Architecture]]", "[[ADR-011 Background GPS Tracking]]"]
---

# Google Maps Navigation and Android Bubble Implementation Plan

## Sequential integration update - 2026-10-16

The user subsequently authorized local merges into main. Mechanic integration, Google Maps handoff and Android trip-bubble source are integrated into local main in separate merge commits. Map conflict reconciliation preserves both hidden-map pausing and bubble-return assignment refresh. The combined offline Android Hermes export passed (1,475 modules, 88 assets, 5.74 MB); strict changed-file lint, encoding and conflict checks passed. This supersedes earlier statements that these branches remain separate. Source integration does not clear native compilation, physical acceptance, release decisions or cloud-upload consent. See [[Sequential Branch Merges 2026-10-16]] for final outcomes and fresh checks.

## Current branch status - 2026-10-16

Navigation handoff source is implemented on `codex/google-maps-handoff`, which is an ancestor of `codex/android-trip-bubble`. The latter branch reports bubble Tasks 1-4 implemented and automated JavaScript checks completed. Its worktree is clean at `cdcfb86c`. Native Android compilation, a fresh APK and physical acceptance remain pending; the latest branch note records the Expo cloud-upload approval hold. This task commits the plans and current-checkout fixes without merging either related branch or submitting a build. The original checklists below remain the approved work breakdown, not proof that every release gate has passed.

## Decision

Implement the proposal as two independent releases.

1. **Navigation reliability first:** one trusted trip-phase resolver, an ordered background-tracking preflight, Google Maps driving navigation, honest failure choices, the existing foreground-service notification as the return path, stale-trip cleanup, and physical Android verification.
2. **Optional bubble later:** an Android-only local Expo module that draws one 56 dp tap-to-return icon after explicit permission. It is not allowed to track GPS or change trip state.

The second release is blocked until the first release passes a real-device drive test and drivers still need faster return access than the notification provides.

## Why this ordering

Most of the proposed foundation already exists: FleetOps has a tested target resolver, Google Maps handoff, background GPS, per-leg distance, an Android tracking notification, and deep-link scheme. The highest operational risk is not drawing the bubble; it is proving that tracking starts before FleetOps loses foreground privileges and that failures are shown honestly.

The current tracker starts from the `AppState` transition and suppresses native start failures. The first plan replaces that uncertainty with a visible preflight and explicit result while preserving the established no-double-count merge behavior.

## Plan Documents

- Design: `docs/superpowers/specs/2026-10-14-google-maps-navigation-handoff-design.md`
- Release 1: `docs/superpowers/plans/2026-10-14-google-maps-navigation-handoff.md`
- Release 2: `docs/superpowers/plans/2026-10-14-android-trip-bubble.md`

## Scope Boundaries

- No database change.
- No trip-state mutation from opening Google Maps.
- No iOS overlay.
- No expanded bubble panel.
- No mandatory overlay permission.
- No claim that tracking survives an Android force-stop.
- No implementation or device verification has been performed as part of this planning task.

## Verification of the Plan

The plan was checked against the current mobile navigation resolver, background task, Map lifecycle, Expo configuration, Android manifest, deep-link scheme, relevant feature notes, and ADR-011. It separates the native overlay from the operationally required handoff so each release can be reviewed, tested, and rejected independently.

## Commit and branch readiness review - 2026-10-16

The `feat/mechanic-integration` checkout showed 44 dirty paths: 20 edited files, 13 staged deletions, and 11 untracked files. These mix the Off Duty illustration, TomTom WebView performance work, dispatch recommendation/test changes, and scratch-file cleanup, so they should not be committed as one change.

Review items before committing the affected work:

- `mobile/lib/fleet-bridge.js` turns a missing heading into `0`, although both map watchers can retain or receive no valid heading. That can reset the last usable map direction.
- `mobile/app/(app)/(tabs)/index.js` shows the Off Duty illustration for every successful pre-shift prompt, including the Passenger “Start Your Shift” prompt and tutorial prompts; the design says it belongs only in Off Duty states.
- `mobile/.easignore` no longer excludes `.jks`, `.p8`, `.p12`, `.key`, or `.mobileprovision` files. Restore those exclusions or confirm that builds use the root ignore file exclusively before an upload.
- The Live Map Radar note has two operational-safety bullets below the new illustration heading, and `SYSTEM.md` repeats the Google Maps plan paragraph inside the UTF-8 restoration entry.

The local `main` is an ancestor of `feat/mechanic-integration`; the feature branch is 34 commits ahead of `main` and 21 commits ahead of `origin/feat/mechanic-integration`. The related `codex/android-trip-bubble` branch is 20 commits from the shared base, versus 19 unique commits on the current feature branch. A committed-head merge simulation showed no textual conflict markers, but the dirty checkout overlaps that branch in seven paths, including `map.js`, `incident/navigate.js`, `navigation-route.js`, and four notes. The related branch is not listed on `origin`; its separate worktree was not readable from this checkout. Its latest committed note records an EAS cloud-upload approval hold and pending native/device acceptance, so mergeability does not mean release acceptance.

No commit, merge, test run, or build was performed during this review. Existing test and build claims remain those recorded in the feature notes; they were not independently rerun here.

## Review corrections and separate commits - 2026-10-16

The user authorized fixing the review items and committing each logical change with a description. Unknown headings now remain null across the bridge, and the dropped standby coverage-circle update is restored. Home uses the resolved Off Duty state before showing the pre-shift artwork. The earlier review overstated the Passenger case: a Passenger driver who is actually off duty should retain the illustration; the confirmed defect was its appearance in non-Off-Duty tutorial states. Signing-file upload exclusions are restored, the split radar-note bullets are reunited and the duplicate SYSTEM paragraph is removed.

Verification: nine new or strengthened regression cases failed for the intended missing-heading, tutorial-artwork and coverage-update behaviors before correction. All 275 affected and neighboring tests passed across 18 files. Strict lint passed for all 17 changed JavaScript files, the upload-filter probe excluded 12 private/generated examples while retaining required configuration/module inputs, and the tracked UTF-8 and staged whitespace checks passed. Broad test/lint attempts exhausted host memory; the restricted test attempt also refused temporary Git repositories. No full-suite or whole-repository lint pass is claimed for this task. Android device/native acceptance and the separate cloud-upload hold remain unresolved.

The related Android worktree was subsequently readable through the approved Git operation and confirmed clean. Commits cover scratch cleanup, build filters, dispatch fixtures/exclusion clarity, Off Duty artwork, map performance, and navigation planning, with the final system/architecture record kept separate. No push, merge, database change or cloud build was performed.
