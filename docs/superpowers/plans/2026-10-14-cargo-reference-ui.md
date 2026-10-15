# Cargo reference UI implementation plan

Goal: implement the supplied Cargo Home and Map layouts as native presentation variants, visibly distinct from the hotel Passenger UI, while reusing operational logic and controls.

Visual authority: the two user-supplied Cargo image boards and their implementation brief. Existing mobile forest-green/ivory/sage tokens remain authoritative for both themes. Repository data/lifecycle governs what can actually be shown or submitted.

## Home (main agent)

- [ ] Recompose Cargo Home: compact identity header; real Off Duty/On Duty/Standby/current-work state; assigned vehicle; compact assignment counts; quick actions; one shared cargo-variant TripCard; next real assignment or a single honest empty state.
- [ ] Use the reference's consignment-first assignment structure, pickup/delivery timeline, declared kg, vehicle and readiness; omit passenger scenery and the large passenger route preview on pre-start Cargo cards.
- [ ] Keep the hotel Passenger dashboard layout and guest/transfer presentation intact.
- [ ] Cover loading, offline, error, no vehicle, no assignment, start inspection/window gates and large text.

## Map (parallel owner: cargo_map_ui)

- [ ] Implement Cargo standby, assignment, pickup navigation, pickup arrival, loaded/delivery navigation and delivery arrival sheet variants around the reference's structure.
- [ ] Reuse canvas/tracking/lifecycle/route controls; remove passenger-avatar treatment from Cargo.
- [ ] Retain trusted coordinates, provider-backed alternatives/tolls, server proximity/overrides, cargo authority, manual completion and next-assignment cleanup.

## Supporting screens (parallel owner: cargo_supporting_ui)

- [ ] Cargo assignment/readiness detail follows the reference using real reference, load/kg, pickup/delivery, schedule and vehicle facts.
- [ ] Cargo Pre-Trip uses the three real checks and cargo-specific supporting copy; Pre-Shift remains the shift-wide baseline.
- [ ] Shared post-shift/profile surface shows saved Cargo identity and real existing actions; incident taxonomy stays unchanged.

## Verification and record

- [ ] Render/presentation tests distinguish Cargo layout from Passenger, not only labels. Preserve operational regression tests.
- [ ] Strict touched lint, focused mobile/API regressions, Android Hermes export and UTF-8/whitespace checks.
- [ ] Inspect available rendered component evidence against the references. Native device/keyboard/screen-reader acceptance remains explicit if no device is available.
- [ ] Update Capstone Mobile Architecture, Trips, Live Map Radar and SYSTEM.md with actual coverage/results and limitations.

Do not introduce fake shipment photos, recipient data, package counts, proof-of-delivery/signature/scanning, invented routes or disabled provider acceptance. Cargo production-provider holds remain visible and authoritative.

## Implementation record

Home, Cargo Map sheets/standby/confirmed completion, Assignment detail, Cargo Pre-Trip and saved Cargo Profile variants are implemented. Passenger child layouts remain separate, with controls and workflows reused. Existing completion, incidents, shift-wide Pre-Shift and atomic End Duty serve the corresponding reference states; unsupported photos, recipient/voice/traffic features and daily summary metrics are omitted rather than fabricated.

Source/render checks completed. Native visual comparison remains pending because no device/emulator is available; implementation checklist entries must not be interpreted as visual acceptance. See Capstone Mobile Architecture for exact verification results and limitations.
