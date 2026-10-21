# Mobile Clay Performance Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent list and notification changes; the parent owns integration, lifecycle changes and documentation. Work in the existing feature checkout to retain its current mobile behavior and uncommitted work. Do not commit unrelated work.

**Goal:** Reduce avoidable mobile rendering while preserving the existing claymorphism, live facts and operational workflows.

**Architecture:** Retain cached clay materials and shared cards. Let React Native window the Trips list, preserve notification references when the complete ordered data is unchanged, and scope Home/Trips presentation clocks and Home map previews to visible foreground use.

**Tech Stack:** Installed Expo SDK 54, Expo Router 6, React Native 0.81.5, React 19, Vitest and existing native-boundary test harnesses.

## Global Constraints

- Preserve forest/ivory colors, typography, card materials, accessibility, text scaling and all trip/duty/inspection gates.
- Do not replace road routes with endpoint-only static maps, change GPS ownership or slow visible readiness updates.
- No dependencies, database changes, deployment, EAS cloud submission or blanket hardware-texture caching.
- Preserve pre-existing edits. Read the repository-requested SDK 57 reference (a later retry succeeded) without upgrading the installed SDK; implementation uses installed APIs, checked against official RN 0.81 and Expo Router guidance.
- Record measured application-work reductions separately from unmeasured Android FPS/memory and development-build overhead.

## Task 1: Window the Trips schedule

**Files:** `mobile/app/(app)/(tabs)/trips.js`, relevant Trips rendering tests.

- [x] Add a regression using 90 historical trips. Before the fix, demonstrate that the root eagerly produces all 90 card elements. Require row delivery through a windowed native list after the change, while invoking the row renderer to verify actual trip IDs, display and navigation props.
- [x] Replace the outer ScrollView and nested row maps with SectionList. Supply each section's existing label and items as `{ key: bucket, label, data: items }`. Keep the real TripCard component unchanged.
- [x] Preserve all header, count, loading/error/offline/empty, refresh and manual pagination behavior through list header/empty/footer slots. Use stable trip ID keys, non-sticky section headers and variable row heights; do not use getItemLayout with dynamic text.
- [x] Keep clipping disabled to avoid the previously documented Android clay-shadow artifacts. Start with a small initial render/batch and a modest offscreen window, preserving enough pre-rendering for responsive scrolling.
- [x] Run focused Trips schedule/duty/cargo checks and strict touched-file lint. Record that real native windowing/FPS remains device acceptance.

## Task 2: Avoid unchanged notification publications

**Files:** `mobile/context/notification-feed.jsx`, `mobile/lib/notifications/inbox-render.test.js`.

- [x] Add failing same-response identity/publication coverage to the real provider harness. Also cover ordered changes, changed message/read state, row additions/removals and fetch-error recovery.
- [x] In the state updater, retain the previous notification array only when the complete ordered JSON response is unchanged. Do not compare only unread count or a subset of fields. Keep delivery processing and seen-ID behavior intact.
- [x] Memoize the published context on its actual fields/callbacks so a parent-only rerender does not publish an unchanged value.
- [x] Run provider/inbox/navigation/tier/push-permission tests and strict lint. Record identical-poll array/context identity before/after; do not claim device FPS.

## Task 3: Stop hidden presentation work

**Files:** new `mobile/lib/use-screen-clock.js` and regression tests, Home and Trips tabs, `mobile/components/home/DriverHomeCards.jsx`, affected Home test fixtures.

- [x] Add lifecycle regressions for the real shared clock hook using controlled focus/AppState/timers: visible foreground retains the 30-second cadence, blur/background stops it, refocus/resume refreshes the time immediately, and cleanup removes listeners/timers.
- [x] Implement one shared `useScreenClock()` returning `{ now, active }`. It owns only a presentation clock, never GPS or network polling. Reuse installed Expo Router focus lifecycle and native AppState.
- [x] Replace Home/Trips unconditional presentation intervals with the hook. Home passes `active` to its trip-card map rendering; hidden Home omits the map renderer while retaining an equal-size placeholder, so road previews return normally on focus.
- [x] Verify every existing Home route preview remains available when active, including upcoming cards. Preserve actions/readiness and fix the stale comment claiming Home supports only one interactive preview.
- [x] Run lifecycle and affected Home/Trips regression tests, strict touched lint, UTF-8 and whitespace checks, then Android Hermes export if locally available.

## Completion

- [x] Independent review checks correctness, scope, performance evidence and preservation of the existing dirty tree.
- [x] Update the mobile audit, mobile architecture and SYSTEM.md with exact changes, checks and Android device limitations. Distinguish concept images from the retained clay implementation.
- [x] Report the avoided work and explain that release-build/device comparison is still required before claiming smooth FPS.

## Verified outcome

- Completed all three implementation tasks and independent source review.
- Full mobile-filtered run: 112 files / 1,272 tests passed. Strict lint passed for nine touched source/test files.
- Work probes: 90 eager history-card elements to zero (all records retained); six unchanged notification identity publications to zero; four active Home map components to zero while hidden; one foreground presentation interval to zero on blur/background. These are not native FPS measurements.
- Browser fixture review retained clay appearance at 320/390 px, light/dark, large text and loading/error/empty states. Screenshots are in scratch/mobile-clay-performance-trips.png and scratch/mobile-clay-performance-states.png.
- Android Hermes export passed: 1,508 modules / 5.93 MB / 91 assets. Initial sandbox-temp output was refused; workspace-local TEMP/TMP retry succeeded. No permission override or cloud upload used.
- Mobile audit, Home note, architecture note and SYSTEM.md updated. Task-file whitespace and repository UTF-8 gate run at closeout.
- Physical Android fast scrolling, shadows/windowing, WebView resume, OS text scaling and release-build FPS/memory remain pending. Home maps reload on return after hidden teardown.
- Sources: https://reactnative.dev/docs/0.81/sectionlist ; https://reactnative.dev/docs/0.81/optimizing-flatlist-configuration ; https://reactnative.dev/docs/0.81/performance ; https://docs.expo.dev/versions/v57.0.0/ .
