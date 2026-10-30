# Mobile UI comparison — 2026-10-30

The owner requested previews of the four remaining audit UI changes without using a phone. These browser captures compare actual React Native Web components loaded from the saved pre-audit source snapshot (left) with current source (right), using identical light-theme sample data. No application code, theme preference, operating data or user session changed.

- 01-navigation.jpg: original curved wave versus current flatter semantic-color navigation.
- 02-controls.jpg: actual ClayCard, ClayInput and ClayButton with a sample odometer field and actions.
- 03-alert.jpg: actual AppAlertHost opened through its imperative API in both versions; Cancel/Continue are fixture callbacks only. The current Continue label has visibly weak contrast, faithfully retained in this preview and not silently corrected during this read-only presentation.
- 04-header.jpg: actual DriverHomeHeader with sample driver/weather/notifications.

Interactive menu: http://127.0.0.1:4194/ui-comparison.html while the existing local4194 preview server runs. Build source: scratch/mobile-ux-audit-2026-10-29/compare-ui.mjs; native device/API/router/gradient/icon boundaries use preview adapters. Fonts, token styles and component layout come from actual source. Browser shadow rendering and real native keyboard/screen-reader behavior differ; these are UI comparison fixtures, not native acceptance. Original Home illustration restoration is preserved.

## Selected styling restored — 2026-10-30

The owner requested restoring navigation/cards/buttons/header. restored-navigation.jpg, restored-controls.jpg and restored-header.jpg capture the original style on the left and restored current style on the right. The earlier numbered captures remain historical audit comparisons. Inputs and popups were left at the audit version; functional fixes remain.

## Curve visibility enhancement — 2026-10-30

nav-curve-enhanced.jpg compares the original 92dp-wide/10dp-rise wave (left) with the requested 112dp-wide/18dp-rise curve (right). Actual navigation components retain the same scan/tab positions and styling. Light and dark browser fixtures were inspected; 145 navigation/guide checks and strict component lint passed. Physical-device appearance remains unverified.
