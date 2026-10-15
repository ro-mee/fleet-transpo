# Cargo audit fixes implementation plan

Goal: apply the six approved findings without changing Passenger presentation, server authority or installed dependencies.

Completed: all six approved source fixes, executable component/callback tests and documentation. Final verification: 1,091 affected tests / 85 files, strict touched lint and Android Hermes export passed. No important source-review findings. Native screenshots/device acceptance remain pending. No commit or deployment performed.

1. Add executable SwipeButton tests for pending, confirmed, refused, queued, rejected, duplicate and accessibility/gesture activation. Await a callback's explicit `true` result before success feedback. Map returns true only after acknowledged status writes; holds, overrides and completion-form navigation do not confirm a transition.
2. Add a shared reduced-motion hook using installed React Native AccessibilityInfo, guarding delayed initial results and cleaning up listeners. Apply it to SwipeButton and Home expansion.
3. Test Cargo duty-prompt suppression and visible Incident/End Duty access. Cargo keeps its first four reference shortcuts, with End Duty still available immediately as a separate shared button when on duty. Passenger order remains unchanged.
4. Simplify Cargo-only depth and overview spacing; preserve theme, touch sizes, honest counters and Passenger materials.
5. Test compact Cargo Map preserves target/telemetry/load while vehicle/capacity/schedule remain available in expanded Details. Preserve clearance/action regions and Passenger child layout.
6. Run focused tests, full affected regressions, scoped lint, UTF-8/whitespace checks and Android export. Document fixes and native-device limitations in the vault and SYSTEM.md. No commit/deployment/database write requested.
