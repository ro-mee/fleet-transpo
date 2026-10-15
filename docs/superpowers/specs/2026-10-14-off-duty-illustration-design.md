# Off Duty Illustration Design

## Goal

Use the supplied clipboard-and-crossed-location illustration as the consistent visual indication for a driver who is Off Duty in the mobile companion app.

## Scope

- Show the illustration in the dedicated Off Duty empty state on Home, Trips, and Map.
- Keep the existing `OFF DUTY` label, title, supporting copy, and Pre-Shift action so the image never carries the meaning by itself.
- Replace the existing small crossed-location glyph on those dedicated empty states rather than showing both.
- Keep compact duty rows text-only. A large decorative image there would reduce scanability and crowd operational information.
- Do not change Rest Day or On Leave visuals.

## Presentation

- Store one optimized local image under `mobile/assets/images/` and reuse it everywhere.
- Render it with `contain` sizing so it is never cropped.
- Use a larger centered treatment on Map and Trips, and a compact treatment inside the Home assignment empty card.
- Mark the image as decorative for accessibility because the adjacent text already announces the state.
- Preserve light and dark theme readability without changing the illustration's colors.

## Behavior and Data

This is presentation-only. Duty resolution, Pre-Shift rules, location tracking, assignments, permissions, and API behavior do not change.

## Verification

- Add render checks proving that all three Off Duty surfaces use the shared image.
- Confirm Rest Day and On Leave still use their existing visuals.
- Run focused mobile tests, lint for touched files, the UTF-8 check, and an Android export if the focused checks pass.
- Native device visual acceptance remains separate if no emulator or connected device is available.
