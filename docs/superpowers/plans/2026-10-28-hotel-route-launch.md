# Hotel Route mobile identity and launch

Approved scope: implement the selected Hotel Route identity and the user's letter-drop reference in both mobile themes, remove the launch tagline, add a refined synchronized sound, and replace mobile brand assets. The user explicitly requests visual fidelity to the supplied images.

## Constraints

### Exact artwork follow-up

The owner rejected the remaining vector approximation and requested exact logo, texture, glow and proportions in both modes. Normal-theme artwork will now use the original final-panel pixels. Clean source rectangles (half-open, in the 1672 x 941 approved boards): light `[1333,130,1645,778]` (312 x 648), dark `[1338,136,1650,766]` (312 x 630). Do not stretch them into the older 360 x 640 artboard. Preserve source files, generated high-contrast vectors, existing timing/sound and unrelated Home work. Pixel equality of the decoded final PNG against its source crop is the acceptance check. Lottie uses matching textured image layers during motion and the untouched full plate at the final hold. Static references do not define every in-between animation frame; the final artwork can be exact while motion remains an implementation of the approved choreography.

Follow-up software implementation is complete: normal artwork/native assets now use the source pixels; LaunchScreen consumes actual aspect ratios; shared wordmarks use the reference texture. Exact final pixels and rendered animation states were checked, and identity/architecture/SYSTEM notes record the evidence and device limits.

- Preserve unrelated Home changes and existing authentication, font/settings hydration and navigation handoff.
- Use the existing checkout and shared logo API. No database, deployment or unrelated redesign.
- Source references: `docs/design/mobile-launch/user-letter-drop-reference-2026-10-28.png`, `05-letter-arrival-light-v1-2026-10-28.png`, `05-letter-arrival-dark-v1-2026-10-28.png`, and the selected round-three Hotel Route logo.
- One self-contained local composition per theme: 312 x 648 light, 312 x 630 dark, and 360 x 640 for plain high contrast. Road/hotel reveal, eight individual letters and reflection; normal themes crossfade to the exact final plate by 1.50 seconds, while high contrast settles by 1.75 seconds. Exit at 1.90 seconds with 180 ms fade; startup remains bounded to 2.08 seconds.
- Light ivory/forest/brass and dark forest/champagne versions. Monochrome accessible variants omit decorative glare. Reduced motion and renderer failure use matching final artwork and prompt handoff. No launch tagline or tagline accessibility announcement.
- Audio must be local, short and gentle, not loop, not delay startup, respect iOS silent mode, stop on background/unmount and not restart on rerender.

## Tasks

1. Replace `scripts/generate-mobile-brand.mjs` artwork with a shared Hotel Route master. Generate all existing mark, lockup, launcher/adaptive/monochrome/splash/favicon assets, full Lottie compositions and final `launch-*.png` images. Keep existing filenames so current brand consumers update together. Visually inspect generated frames against references.
2. Add original launch audio and a bounded audio hook with lifecycle tests. Install the SDK-compatible audio package if needed; configure playback only, without recording permissions. Align letter impacts with completed landings at 0.78 seconds plus 75 ms intervals, with a soft final sweep.
3. Integrate the composition and final images in `mobile/components/LaunchScreen.js`. Simplify `mobile/lib/use-launch-sequence.js` to own only preference, bounded completion and exit. Update existing lifecycle/render tests before implementation; preserve race, cancellation, reduced-motion and handoff coverage. Audit remaining mobile brand surfaces.
4. Run focused tests, lint, encoding checks and an Android bundle/export; capture and inspect actual composition frames in light/dark and accessibility variants. Review the diff independently, fix material issues, and document device-only limitations truthfully.
5. Update `Capstone/01 - System/FleetOps Mobile Identity.md`, `Capstone/04 - Architecture/Mobile Architecture.md` and `SYSTEM.md` with implementation, verification and remaining physical-device checks.

## Progress

- Repository instructions and relevant identity notes read. Existing Home modifications identified and preserved.
- Implemented shared Hotel Route assets, complete themed compositions, original local sound, launch integration and all remaining brand headers. Native loading and sound start together; late native loads beyond 150 ms from mount use the final static frame rather than truncating the sequence.
- Full mobile suite: 122 files / 1,523 tests before final timing refinements. Final focused checks: 47 tests. Related header/guide tests, strict touched lint, UTF-8, deterministic asset regeneration and final Android Hermes export passed (1,539 modules, 6.01 MB, 101 assets).
- Independent review caught two synchronization issues, now corrected: native-load origin and delayed successful loads. Actual DotLottie final frames exposed dropped stroke fields; generator now emits `ty` before style properties and asserts this rule. Both light/dark final rendering and all static variants inspected.
- Capstone identity/architecture notes and SYSTEM.md updated. No commit or deployment; unrelated Home work preserved.
- Reference follow-up completed: source-textured layers, matching shared logos and original final plates replace the normal-theme vector approximation. Both final PNGs and embedded final Lottie plates have zero changed RGB samples. Browser review confirmed both themes, letter/reflection states and compact logos, correcting moving-letter background fragments and a mask join line. Proof: `docs/design/mobile-launch/implemented-reference-pair.png`.
- Final checks: 49 launch/audio/brand tests plus eight integration/onboarding tests, strict touched lint, and 38 byte-identical regenerated files. Clean Android Hermes export passed (1,541 modules, 6.5 MB, 103 assets). Generate assets before exporting, not concurrently. Updated Capstone identity/architecture notes and SYSTEM.md.
- Remaining device acceptance: sound, frame rate, accessibility, cold start and installed splash/icon checks require a rebuilt binary and device. No SDK/adb/device is available here. Exact final source pixels are verified; scaled GPU screenshots and every interpolated video frame are not claimed pixel-identical.
- The October 29, 2026 02:25 Asia/Manila follow-up found the implementation complete. All 38 generated files still matched the verified build, saved export/capture evidence was present, and UTF-8/whitespace checks passed. No implementation was repeated. The one-run automation `finish-fleetops-reference-design` was deleted; only previously documented device acceptance remains unavailable here.
