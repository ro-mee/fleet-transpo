# Mobile Map trip-cycle visual review — 2026-10-30

The initial visual audit showed standby/recovery, not the full trip cycle. This follow-up supplies all six stages for Passenger and Cargo. Each image has current source on the left and a proposed stage summary/action wording on the right. No mobile application source was changed.

| Stage | Cargo | Passenger |
| --- | --- | --- |
| Ready to start | [Cargo comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-cargo-ready.jpg>) | [Passenger comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-passenger-ready.jpg>) |
| Travelling to pickup | [Cargo comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-cargo-pickup.jpg>) | [Passenger comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-passenger-pickup.jpg>) |
| At pickup | [Cargo comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-cargo-boarding.jpg>) | [Passenger comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-passenger-boarding.jpg>) |
| Travelling to destination | [Cargo comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-cargo-delivery.jpg>) | [Passenger comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-passenger-delivery.jpg>) |
| At destination | [Cargo comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-cargo-finish.jpg>) | [Passenger comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-passenger-finish.jpg>) |
| Completed / standby | [Cargo comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-cargo-completed.jpg>) | [Passenger comparison](<C:/Users/lenovo/OneDrive/Desktop/capstone/docs/design/mobile-map-audit-2026-10-30/cycle-passenger-completed.jpg>) |

Interactive stage gallery: http://127.0.0.1:4194/map-cycle-gallery.html while the local preview server runs.

The proposal keeps the existing clay surfaces, controls, bottom navigation, manual swipe actions and all source callbacks. It makes current stage/target/next step explicit, exposes existing load/passenger facts, and gives live route metrics a consistent reading area. At pickup, Confirm loading/boarding names the confirmation action. At destination, Finish trip explains the existing ending-odometer form rather than implying the swipe alone completes the trip.

Cargo pickup/delivery warnings still name verification and Fleet clearance. Neither the proposal nor the fixtures claim those approvals are present. Completion is a simulated confirmed server event: Cargo retains its completion reference/details/dismiss surface; Passenger returns to its existing standby view. Neither retains the former target/route.

These are concept comparisons, not a final approved design. Extra context can take more vertical map space; map visibility and information density must be agreed before applying a production layout. No new workflow or authority is implied.

Verification: rebuilt current/proposal bundles; checked all 12 browser states and their actual current/proposed action names; waited for frame fonts; saved all 12 readable captures. Completion records contain no former stop names. Prior audit test totals are recorded separately; no fresh full/native test pass is claimed for this visual follow-up. Evidence: scratch/mobile-map-audit-2026-10-30/cycle-browser-checks.json.

Sample account, map, GPS and routing services replace native boundaries. API writes are blocked. Physical-phone layout, driving, permissions, screen readers and all-theme/large-text acceptance remain unverified.
