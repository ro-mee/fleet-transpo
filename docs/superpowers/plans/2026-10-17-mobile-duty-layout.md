# Mobile duty and weather layout implementation plan

**Goal:** Apply the user's approved Trips status placement, consistent Map colors and inline Home weather.

**Architecture:** Keep the existing screen controllers and shared theme. Reuse ClayBadge on Map and Trips; extend WeatherChip's existing compact presentation for the Home header. Keep loading/error/offline precedence and real assignment counts intact.

**Stack:** Expo 54, React Native 0.81, Expo Router, existing theme tokens and Plus Jakarta Sans.

## Constraints

- Preserve the prior explicit illustration sizing correction and unrelated working changes.
- No new dependencies, API/database changes, deployment or workflow changes.
- Use the existing accessible notification/profile controls and full weather description.
- Validate phone widths, both themes and larger text; native acceptance must be reported honestly.

## Steps

- [x] Add focused rendering coverage for compact weather accessibility and Trips loading/error/offline precedence. Confirm regressions fail before implementation.
- [x] Update `mobile/components/WeatherChip.js` compact mode to icon + temperature without the visible city line. In `mobile/components/home/DriverHomeHeader.jsx`, use a small greeting above the name and place compact weather before the bell in one row. Preserve 48 dp profile/notification targets; let large text wrap within the identity rather than pushing weather below it.
- [x] Update `mobile/app/(app)/(tabs)/trips.js`: title/date header, duty badge at the right only when its empty state is displayed, count panel only when loaded trips exist, and one centered artwork/title/explanation group with 48 dp top spacing. Preserve refresh, sync notes, existing state copy and assignments.
- [x] Update `mobile/app/(app)/(tabs)/map.js`: replace the separate mint empty palette with semantic theme colors and reuse ClayBadge with primary tone for the status pill. Preserve other state symbols, map behavior and refresh.
- [x] Review real components in a local browser preview at 320/390/440 dp, light/dark and larger text. Run focused regressions, touched ESLint, Android Hermes export using workspace-local temporary storage, encoding and whitespace checks. Update the audit, Trips, Live Map Radar and SYSTEM notes with results and limits.

Execution is inline in this chat; the user approved the design and requested implementation. Keep changes local for review.


User feedback follow-up (2026-10-17): the plain Trips treatment was rejected. Restored shared raised cards around its header and empty state, retaining the revised badge placement and queue rules. See the mobile UI audit for the final composition and verification limits.
