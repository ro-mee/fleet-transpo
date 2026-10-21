# FleetOps mobile identity and launch rebuild

**Goal:** Replace the mobile car badge and dial/car startup with the owner's route-inspired FleetOps identity and an integrated, bounded brand reveal.

**Design:** Three open, forward-sweeping road ribbons suggest an F and converge toward a brass connection point. Unlike an enclosed leaf silhouette, separated lanes and cut ends communicate routing. Keep forest #285448, warm ivory #F5F2EC, brass #8A632C, the existing dark ground #0D1713 and Plus Jakarta Sans. Light/dark marks share exact geometry; high contrast is monochrome. The native icon, splash, auth, onboarding, About and branded map headers use the same mark. Existing clay UI and all operational behavior remain intact.

**Architecture:** Author vector geometry once and generate portable SVG masters, native PNGs and a small local Lottie composition using the installed renderer. No new mobile dependency. Separate launch timing/lifecycle from visual composition. Root keeps font loading, provider order, authentication, native splash protection, mounted navigation, push deferral and foreground sync.

## Work and verification

- [x] Create shared geometry, four mark variants, lockups, app/adaptive/monochrome icons and native light/dark splash images. Keep a reproducible generator. Check output geometry and image dimensions.
- [x] Write and run failing launch lifecycle regressions, then implement a bounded sequence: route opening, inward path build, mark formation, wordmark, short tagline hold and 180 ms overlay fade. Normal configured duration 2,080 ms including exit; motion-query deadline 120 ms, unresolved/error preferences use static reveal. Reduced motion must finish promptly. Keep callbacks fresh without restarting timing; fence cancellation/unmount and callback races.
- [x] Replace LaunchScreen and reusable Logo; use the new identity at existing mobile brand positions and add a restrained Home brand signature. Replace Expo app icon/splash configuration. Search before deleting old launch-only assets.
- [x] Exercise actual component/hook lifecycle with mocked native boundaries, root handoff and branding variants. Run focused/neighboring mobile tests, strict touched lint, encoding, Android export and local browser visual fixtures for light/dark/high contrast, small/large text and animation states. A browser fixture is not native acceptance.
- [x] Request independent code/visual review, resolve material findings, and update Mobile Architecture, a dedicated FleetOps identity note and SYSTEM.md with real results and remaining physical-device/release-build checks.

## Constraints and acceptance

Use English; UTF-8 file operations only. Preserve unrelated dirty work. No database, credentials, dependency upgrade, cloud build, push or deployment is needed. Existing Lottie remains installed for other screens. Native splash/icon changes require rebuilding the binary; Expo Go cannot prove native splash acceptance. Device cold start, TalkBack/VoiceOver, background interruption and frame rate remain explicitly pending unless tested on hardware.

The detailed user-provided brief and reference image settle scope and direction; the user explicitly asks for a chosen final direction and completed integration, so execution continues in this chat.

Verification record: complete mobile/lib suite105files/1,176tests; focused48tests; strict touched lint, UTF-8, asset reproducibility and Android Hermes export passed. See Capstone/01 - System/FleetOps Mobile Identity.md for scope, full asset inventory and device limitations.
