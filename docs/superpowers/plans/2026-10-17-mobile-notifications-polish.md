# Mobile Notifications polish

**Goal:** Align the existing mobile inbox with the app's soft ivory/forest card design while improving readability and touch separation.

**Scope:** `mobile/app/(app)/(tabs)/notifications.js`, `mobile/lib/notifications/presentation.js`, and `mobile/context/notification-feed.jsx`, plus focused checks and Capstone documentation. Preserve current delivery classification, read/dismiss endpoints, date groups, notification ordering and navigation.

- [x] Reproduce missing failed-load guidance and notification-card interaction/readability issues with focused rendering checks.
- [x] Reuse ClayScreenHeader and a raised inbox-summary card. Place the full-width Mark all read button inside the summary and show pending feedback. Keep the user's preferred card containers.
- [x] Use neutral raised message cards with a semantic icon, readable wrapping title/body, category/severity context, a separate timestamp/read-status row, and a sibling 48 dp dismiss control. Preserve accessible full descriptions and current mark-read/deep-link behavior.
- [x] Surface refresh failure from the existing provider, preserve loaded rows and provide Retry. Never present an initial fetch failure as an empty inbox.
- [x] Review fixture-backed real components at narrow phone widths, both themes, long copy and enlarged text; verify dismiss and read/navigation separately without operating notifications. Run focused regressions, touched lint, Android export and encoding/whitespace checks. Update Notifications, UI UX Audit - Mobile and SYSTEM.

Implementation is local in the current chat. No dependency, database, delivery-policy or deployment change.
