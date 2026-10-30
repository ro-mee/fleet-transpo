# Mobile Map audit visuals — 2026-10-30

The owner asked for a mobile Map UI/UX and function audit with a side-by-side image like the navigation comparison. The left side renders the current Map screen from source. The right side renders an audit-only proposal. **No mobile application source was changed.**

- `assignment-review.jpg`: label straight-line distance honestly, remove unsupported road arrival minutes and surface the existing assignment count. Keep the approved clay styling, layout and trip controls.
- `gps-recovery.jpg`: show the current overlapping GPS recovery/layers, versus measured stacking and larger layer switches. Current fixture rows measure 17px high; proposal rows measure 48px.

These are React Native Web review fixtures with current component layout/materials, real bundled vehicle artwork, fonts and icons. The map roads/route, GPS, account, weather and assignments are illustrative samples, with sample freshness frozen for a stable comparison. API writes are blocked, native services are substituted and nothing is sent to a live operating endpoint. These are not physical-phone or live TomTom captures.

The audit-only proposal changes the fixture's in-memory source copy; production source is untouched. The two images do not claim the false-arrival or background-readiness defects have been fixed.

Report: `Capstone/07 - Development/Mobile Map UI UX and Function Audit 2026-10-30.md`. Evidence/build source: `scratch/mobile-map-audit-2026-10-30/`.

Fresh existing coverage: 506 mobile tests / 24 files plus 130 backend tests / 8 files passed. Five audit probes reproduced the documented gaps. Physical-device GPS, permission flow, native accessibility, real map-provider rendering and performance remain unverified.

While the existing local preview server is running:

- http://127.0.0.1:4194/map-audit-assignment.html
- http://127.0.0.1:4194/map-audit-recovery.html
- http://127.0.0.1:4194/map-audit-active.html

## Full trip-cycle follow-up

The original pictures covered standby/recovery only. See trip-cycle-review.md for all 12 saved comparisons (six stages each for Cargo and Passenger), and the interactive gallery at http://127.0.0.1:4194/map-cycle-gallery.html. Current/proposed stage summaries and action labels were checked in every browser fixture; application source and handlers remain untouched. These concepts may use more vertical map space and still need density/native acceptance.

## Compact travelling variant and competitor study

The owner liked stage clarity but found the tall sheet obstructed the map. compact-navigation-cargo.jpg compares the previous stage proposal against the compact travelling variant. The three other compact-navigation images cover Cargo at pickup and Passenger travelling/at pickup. Four browser comparisons and detail expansion/collapse were checked; Cargo tray454→166px in the normal390×800 fixture. These are not competitor/native captures. Native REA was blocked by missing Android tooling/packages; dated official driver references are documented in Capstone/07 - Development/Mobile Map Visibility and Driver App Study 2026-10-30.md. Camera occlusion integration remains a production recommendation. No app source was edited. Preview: http://127.0.0.1:4194/map-compact-cargo-pickup.html .

## Turn-by-turn directions correction

The first schematic omitted the existing directions banner. directions-and-compact-tray.jpg and directions-passenger.jpg now reuse the current map-document banner CSS/markup/icons with sample turn values. The top road instruction and bottom trip-stop/action tray are separate. gps-lost-cargo.jpg and gps-lost-passenger.jpg show sample guidance hidden and Retry GPS available. These are review fixtures only; route-provider behavior, camera integration and the open false-arrival audit defect are not fixed by these images. Source/app unchanged. Preview: http://127.0.0.1:4194/map-directions-cargo.html .

## Directions-only refinement

The owner clarified directions only. refined-directions-detail.jpg shows current versus refined banner; the full/dark/small companion captures preserve the same Map and tray. The new32px arrow, distance/action grouping, separate street and integrated following maneuver use shared clay/theme styling. Light/dark/narrow browser checks found112px total height and no horizontal overflow; native/large-text acceptance remains open. This is a design preview, with no mobile production changes. Preview: http://127.0.0.1:4194/map-directions-refined.html .
