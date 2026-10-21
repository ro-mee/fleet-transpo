---
type: design
title: FleetOps Mobile Identity
tags: [mobile, branding, launch, accessibility]
last_verified: 2026-10-21
---

# FleetOps mobile identity

The October 21, 2026 rebrand replaces the mobile car badge and car/compass launch. The chosen mark uses three open road ribbons, directional cut ends and a brass connection point. The open lanes suggest routing and an F without enclosing a leaf silhouette. The wordmark is Plus Jakarta Sans Semibold, with a brass Ops accent. The tagline is “Moving operations. Further together.”

Light uses forest #285448, ivory #F5F2EC and brass #8A632C; dark uses ivory #F5F2EC and brass #D2A765 on #0D1713. High-contrast light/dark marks and wordmarks are entirely black/white. Existing clay screens, semantic status colors and operational icons retain their roles. This is the mobile identity; the web dashboard has a separate design system.

## Assets and usage

`scripts/generate-mobile-brand.mjs` is the reproducible asset generator. Its cubic paths are shared by SVG masters, native PNGs and local Lottie compositions. `mobile/assets/brand/wordmark-outline.json` stores the outlined lettering; its font license is included. No mobile dependency was added.

- `mark-{light,dark,high-contrast-light,high-contrast-dark}.svg/.png`: standalone mark, with a tightly framed square canvas.
- `lockup-{variant}.svg`: primary horizontal mark/wordmark lockup with fully outlined lettering; no external font is needed.
- `route-reveal-{variant}.json`: four small, local 1,900 ms animations with matching geometry, no external media and no loop.
- `splash-mark-light.png` / `splash-mark-dark.png`: transparent native splash artwork. `app.json` configures ivory/forest backgrounds and imageWidth 160.
- Replaced `fleetops-icon.png`, `icon.png`, adaptive foreground/background/monochrome images and `favicon.png`. The legacy `splash-icon.png` was removed entirely: the splash plugin renders `splash-mark-*.png`, so nothing consumed it. Adaptive foreground fits the central safe region; monochrome uses white plus alpha; app icons are opaque.
- `brand-board.png` / `preview.svg`: four-mode identity reference.

`mobile/components/logo.js` owns `FleetOpsMark`, `FleetOpsWordmark` and `Logo`. The unused `BrandBar` was removed with the rebrand, so the module no longer carries a signed-in top bar nobody renders. The new mark appears in launch, login, onboarding, About, Map empty/loading headers and a small Home signature. Password recovery retains its security symbols. Operational vehicles and map car markers are not brand assets and remain intact. Decorative wordmark lettering keeps its artwork proportions instead of following OS text zoom; surrounding instructions, subtitles and other copy still scale, and each lockup has one accessible FleetOps label.

Removed after a repository reference check: `mobile/assets/car animation.json` and `mobile/assets/PRt4x4Ds0p.json`. The installed Lottie renderer remains in use; the old dial, car stage, corners, track and beacon composition are gone.

## Launch story and safeguards

| Stage | Configured timing from launch mount |
| --- | --- |
| Opening and path build | Three route strokes enter and draw inward through about 700 ms |
| Mark formation | Open road bands and connection point resolve by 1,050 ms; outer routes recede |
| Brand reveal | Wordmark fades in at 1,050–1,350 ms |
| Final splash | Tagline fades in at 1,280–1,540 ms, then the finished identity holds |
| App transition | Overlay fades out over 180 ms; fallback completes by 2,080 ms |

The motion preference query has a 120 ms deadline. Reduced motion, failed/unknown preference or failed artwork uses an immediate static mark and readable text, normally a 150 ms hold and a 1 ms handoff. An unresolved query therefore completes at about 271 ms. Late changes cannot replay the sequence or extend its normal deadline. A successful artwork event cannot skip the text reveal (earliest normal handoff 1,720 ms). Timings describe configured application work, not total device cold-start time or a measured frame rate.

`use-launch-sequence.js` owns one mount-anchored timeline. Fresh callbacks do not restart it; late initial preferences cannot override newer OS events; timers and native completions race through one completion guard. Cleanup stops motion, timers and subscriptions and ignores late callbacks. An interrupted or missing native exit completion still releases via its bounded timer.

The native splash remains protected at module load. Fonts (including the failure path) and persisted settings retain their existing gates. `ThemedApp` hides the native splash once its themed shell has laid out. Authentication/session restore, provider order, mounted normal-scale Stack, consent/navigation guards, foreground sync and post-launch InteractionManager push initialization remain in place. The navigator stays touch/accessibility-blocked while launch is present. Root and the launch listener registry guard repeated completion; tabs and foreground return do not replay launch.

## Verification and limits

- Test-first lifecycle regressions: 16 expected failures before the new hook, then passing. Focused integration run: 7 files / 48 tests, including normal/reduced/error/timeout paths, callback races, cancellation/unmount, preference ordering, native splash layout, font failure, push deferral, foreground return and brand variants.
- Complete `mobile/lib` run: 105 files / 1,176 tests passed. Strict touched ESLint, UTF-8 and whitespace checks passed. Asset generator assertions and repeat-generation SHA-256 equality passed.
- Android Hermes export passed: 1,515 modules, 5.38 MB bundle and 95 assets. Initial attempt failed because Hermes could not write the sandbox temporary folder; retry with a workspace-local temporary folder succeeded. Public Expo configuration resolves to the installed SDK 54 and the new splash/icon paths. No SDK upgrade was made; repository-required version 57 documentation was consulted along with installed APIs.
- Browser fixtures render actual React Native Web components, local fonts, icons, generated animation JSON and installed DotLottie WASM, with mocked native/provider boundaries. Inspected mark formation, dark final launch, light launch at 320 px with simulated 2x surrounding text, both monochrome launches, large-text Auth/onboarding and Home signature. Screenshots: `scratch/fleetops-brand-review/`. The final onboarding capture confirms its legacy cyan brand subtitle is now sage/white. The live browser fixture completed the real hook, removed its overlay and exposed its replay control. Independent code/visual review found no important brand/lifecycle issue; this color fix was confirmed separately.
- The pre-existing Home greeting/name row wraps severely in the 320 px / 2x text fixture; the added brand signature fits. This operational row was not redesigned in the rebrand. Native text-size behavior and a separate responsive Home correction remain follow-up work.

No Android device/adb was available. A newly built native binary is required to see installed icon and native splash changes; Metro reload and Expo Go cannot establish acceptance. Still check release-build cold start/handoff in both themes, native Lottie rendering, TalkBack/VoiceOver, actual OS text sizes, background interruption and frame rate. Native splash follows the OS scheme before saved app preferences load, so deliberately different OS/app theme choices need device review. Tablet/native iOS acceptance is also pending.

No database, operational data, dependency, deployment, push or commit changed. See [[Mobile Architecture]], [[UI UX Audit - Mobile]] and `docs/superpowers/plans/2026-10-21-fleetops-mobile-rebrand.md`.

## Usage-aware continuation

The owner requested a safe checkpoint and same-chat continuation if the five-hour allowance reaches 5% remaining. Check the actual 300-minute bucket at work boundaries, use its returned reset timestamp and schedule one occurrence just after reset only while executable work remains. Do not duplicate another task's automation or schedule repeated device-acceptance waits. This rebrand completed before the threshold, so no continuation is needed.
