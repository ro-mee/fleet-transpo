# Mobile Quick Actions Swap Design (Fuel & Activity Log)

## Goal

Swap the position of **Activity Log** and **Fuel** shortcuts in the mobile driver companion app's Quick Actions panel (`mobile/app/(app)/(tabs)/index.js`) to elevate Fuel logging into the primary visible set while demoting Activity Log to the overflow ("More") menu.

## Context & Rationale

- On standard mobile devices, `HomeQuickActions` (`mobile/components/home/DriverHomeCards.jsx`) displays four primary shortcut tiles plus a "More" toggle button (`actions.slice(0, 4)`).
- Drivers frequently need to report fuel receipts, odometer readings, and fuel gauge captures during active shifts.
- Previously, Fuel was placed at the very end of the shortcuts list (index 5 or 6 depending on duty status), hiding it behind "More". Meanwhile, Activity Log (viewing past submissions and inspection history) occupied slot 4 in the always-visible primary set, despite being a lower-frequency review action.
- Swapping the positions places Fuel in slot 4 (immediately visible both off-duty and on-duty) and moves Activity Log to slot 6 (accessible under "More").

## Layout & Ordering Specification

In `mobile/app/(app)/(tabs)/index.js`, the `shortcuts` memoized array will be ordered as follows:

1. **End Duty** (conditional: `duty.checkedIn && workspace.mode !== 'cargo'`, icon: `time-outline`, action: `goEndDuty`)
2. **Pre-Shift** (icon: `clipboard-outline`, action: `goPreShift`)
3. **My Schedule** (icon: `calendar`, action: `goSchedule`)
4. **Fuel** (conditional: `canReportFuel`, icon: `speedometer`, action: `goFuelReport`)
5. **Report Incident** (icon: `shield-checkmark`, action: `goIncidents`)
6. **Activity Log** (icon: `pulse`, action: `goSubmissions`)

### Visibility Breakdown

| Driver State | Visible Tiles (Slots 1–4) | Overflow ("More" Menu) |
| :--- | :--- | :--- |
| **Off-Duty (Passenger/Cargo)** | Pre-Shift, My Schedule, Fuel, Report Incident | Activity Log |
| **On-Duty (Passenger)** | End Duty, Pre-Shift, My Schedule, Fuel | Report Incident, Activity Log |
| **On-Duty (Cargo)** *(End Duty is separate button)* | Pre-Shift, My Schedule, Fuel, Report Incident | Activity Log |

## Invariants & Preserved Behavior

1. **Routing & Actions**: Navigation destinations (`/fuel-report`, `/submissions`, `/incidents`, `/work-schedule`, `/inspection`, `/end-duty`) remain unchanged.
2. **Permissions (RBAC)**: `canReportFuel` gate (`canAction(ACTIONS.REPORT_FUEL)`) remains strictly enforced; if a driver cannot report fuel, the tile is omitted, allowing subsequent items to shift left.
3. **Interactive Onboarding Walkthrough & Coach Marks**: `home.shortcut_fuel` and `home.shortcut_incident` target IDs, transition locks, and `notifyInteraction` handlers in `DriverHomeCards.jsx` and `CoachMarkProvider.jsx` remain intact. Placing Fuel in the visible 4 actually simplifies the onboarding tour by eliminating the need to expand "More" to locate Fuel.
4. **Idle Route Prefetching**: `QUICK_ACTION_ROUTES` in `mobile/lib/prefetch-routes.js` remains unchanged.
5. **Cargo Mode**: Cargo mode retains its direct separate End Duty button and visible shortcuts behavior.

## Verification Plan

1. **Automated Unit & Integration Tests**:
   - Run mobile test suite (`npm run test:run -- mobile`) covering `cargo-home-render.test.js`, `coach-marks.test.js`, `prefetch-routes.test.js`, etc.
   - Add/verify test assertions confirming the new shortcuts ordering in `shortcuts` or rendered output.
2. **Linting & Encoding**:
   - `npx eslint mobile/app/(app)/(tabs)/index.js`
   - `npm run verify:encoding`
3. **Documentation Updates**:
   - Update `Capstone/01 - System/Mobile Home Claymorphism Implementation Plan.md` with the new shortcut ordering follow-up note.
   - Update `SYSTEM.md` with the change and verification evidence.
