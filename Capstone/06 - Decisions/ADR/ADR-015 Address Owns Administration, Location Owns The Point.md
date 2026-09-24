---
type: adr
number: 015
title: Address Owns Administration, Location Owns The Point
date: 2026-09-24
status: accepted
tags: [decision, address, locations, geofence, routing, psgc]
source:
  - src/lib/address/structured.js
  - src/lib/address/validate-structured.js
  - src/services/address.service.js
  - src/services/route-resolver.service.js
  - src/services/trip-geofence.service.js
  - supabase/migrations/122_address_registry.sql
  - supabase/migrations/123_psgc_geography.sql
last_verified: 2026-09-24
---

# ADR-015: Address Owns Administration, Location Owns The Point

## Context

Migration `122` gave the system one address registry. Before it, address-shaped
facts were scattered across text columns with no owner; a canonical location
carried a free-text `locations.address` that nothing validated. That column is
where "CoCo Star Hotel, Manila, Philippines" survived on a building in Parañaque
— not because anyone believed it, but because no layer was responsible for it
being true.

Migration `122` also added `locations.address_id` → `addresses(address_id)`. So a
canonical location now holds **both**: a structured address row, and the older
`address` / `latitude` / `longitude` trio it always had. Since migration `108` it
also holds `pickup_radius_m` / `dropoff_radius_m`.

Two address-ish fields and a coordinate pair on one row is the shape that
produced the defect the registry exists to end. The migration therefore forces a
question that "add an address table" does not answer by itself: **which of these
is authoritative, and for what?**

The tempting answer — "`addresses` is the new truth, the old columns are legacy
to be dropped" — is wrong in both directions at once, and the two reasons are
structural rather than stylistic:

- **`addresses` has no radius column.** Geofence evaluation cannot run without
  one. `trip-geofence.service.js:83-85` reads coordinates *and*
  `pickup_radius_m`/`dropoff_radius_m` from the two `locations` rows behind a
  dispatch route. Those radii have nowhere to live on an address row.
- **A location needs a point even when nobody has street-addressed it.** The
  route resolver selects `location_id, name, address, latitude, longitude` from
  `locations` (`route-resolver.service.js:102`) and feeds those coordinates
  straight into routing (`:346`, `:380-381`). An address registry that becomes
  the only coordinate source makes routing depend on an optional field.

## Options considered

| Option | Why not |
|---|---|
| **Address authoritative for everything** — drop `locations.address` / `latitude` / `longitude` | Geofencing loses its only radius source, and routing loses its point for any location not yet street-addressed. Both are load-bearing today; neither can be reconstructed from an address row. |
| **Both carry a pin, kept in step** | Two coordinate pairs for one place is precisely the drift class the registry was created to prevent. It also means an operator places two pins for one stop and is then trusted to keep them equal. |
| **State no ownership** | This is the status quo that wrote "Manila" onto a Parañaque hotel: a field that is wrong and belongs to no one. Leaving it unstated is what makes the error durable. |

## Decision

**Split the two facts by what they are FOR, and say so explicitly.**

1. **The structured address is authoritative for administrative address data.**
   Region, province, city/municipality, barangay, street, ZIP, and the composed
   `formatted_address` all come from the `addresses` row. Administrative
   geography is never read back out of `locations.address`.

2. **The location's coordinates remain authoritative for routing and geofencing.**
   `locations.latitude` / `.longitude` are what the route resolver and the
   geofence evaluator read. `locations.pickup_radius_m` / `.dropoff_radius_m`
   remain the only radius source, with their existing `NOT NULL DEFAULT 100` and
   the 1–1000 m CHECK.

3. **The address carries no pin, and that is a decision rather than a leftover.**
   `addresses.latitude` / `.longitude` stay NULL on these rows. NULL is explicit
   at three independent layers, which is how you can tell it was chosen:
   - `chk_addresses_coords_pair` names `(NULL, NULL)` as its **first** branch;
   - `saveAddress` binds `?? null` rather than omitting the columns;
   - `validate-structured.js` Stage 4 refuses only a **half** pair.

   Three layers agreeing that no coordinates is a legal, ordinary state is not
   an accident. It is the schema saying the pin is optional here.

4. **`showPinMap={false}` follows from this, not the other way round.** The
   canonical-location dialog hides the pin map because the location already owns
   the point — one place, one point, one owner. The UI convention is a
   consequence of the model. Stated in the reverse order it would read as
   "addresses have no coordinates because a dialog was configured that way",
   which would invite someone to switch the dialog on and quietly create the
   second pin this decision exists to prevent.

5. **`locations.address` / `latitude` / `longitude` are a MAINTAINED
   denormalization**, the same shape `routes.origin` has against
   `routes.origin_location_id` (migration `076`). They are kept deliberately so
   geofence evaluation and the route resolver gain no join on a hot path. They
   are not dead columns and must not be treated as such.

6. **The legacy text is not rewritten in this phase.** The backfill creates one
   address row per location and performs exactly one statement against
   `locations`:

   ```sql
   UPDATE locations SET address_id = $1 WHERE location_id = $2
   ```

   No `latitude`, no `longitude`, no `address`, no `name`. The text an operator
   sees today is left exactly as it is, so the change is additive and reversible
   by clearing one FK.

7. **The registry is append-only, so the two cannot silently diverge.** `saveAddress`
   always INSERTs and repoints the referencing column; a superseded row is
   orphaned, never mutated. Combined with (6), the legacy text and the structured
   address coexist rather than one overwriting the other, and nothing joins by
   value — `getAddress` is the only reader.

**Provenance for rows this migration writes:** `provider = 'manual'`,
`provider_place_id = NULL`, `verified = false`, `verified_at = NULL`,
`postal_code_source = 'manual'`. A named or picked address is an operator's
claim about a place. It is not a geocoder verification, and nothing in the UI may
imply it is.

**Consequence worth naming: two facts about one place can disagree, and both are
shown.** Until each surface is migrated, an operator may see a legacy text line
and a structured address that say different things — as they do for the CoCo Star
Hotel today, where the old text says Manila and the picked address says City of
Parañaque. That is the honest state. The structured address is the one that is
authoritative; the text is display residue awaiting its surface's migration. It is
not reconciled automatically, because reconciling it would mean rewriting a field
this decision explicitly leaves alone.

## Status of the work this decision came out of — APPLIED 2026-09-24

**Applied and verified.** Three operational locations are in scope
(`#1 CoCo Star Hotel`, `#8 NAIA Terminal 2 - Arrivals`,
`#10 NAIA Terminal 3 - Arrivals (Bay 9)`), against
`scripts/backfill-location-addresses.mjs`. They took `address_id` **1, 2 and 3** —
the registry's first three rows. `--apply` refuses to start without a snapshot,
and the snapshot is written *before* the first write.

All nine post-apply checks passed against that snapshot: exactly three new
address rows (`0 → 3`), exactly three `address_id` changes and all on #1/#8/#10,
no unrelated location changed, no coordinate changed, no legacy
`locations.address` text changed, each row carrying its expected PSGC barangay
code with an `operational` type and a NULL province, all three unverified
(`verified = false`, `provider = 'manual'`), all three coordinate pairs NULL, and
no house number on any row.

Two notes on the state this leaves:

- **The two facts still disagree for the hotel, and that is the expected
  outcome.** The legacy text reads "CoCo Star Hotel, Manila, Philippines"; the
  address row it now points at says City of Parañaque. The verification asserts
  the legacy text is *unchanged*, not that it agrees — reconciling them would
  mean rewriting the field point (6) leaves alone.
- **The personal address surfaces were migrated on 2026-09-24, and they are what put
  point (3) under load.** Driver residential and driver emergency contact
  (`drivers.address_id` / `drivers.emergency_contact_address_id`) now resolve a
  picked address into the registry. They have no location behind them, so the
  ownership question in (1) and (2) does not arise there — but the PIN question in
  (3) does, and it is answered the other way: these two surfaces are the first to
  enable the map pin, because a person's home has no other coordinate owner. That is
  the boundary working as stated rather than an exception to it — (3) forbids a
  *second* pin for a place that already has one, not a first pin for a place that has
  none. See [[Driver Management]] and [[addresses]].
- **The Google Maps URL paste path stays**, and it is now confined to the two surfaces
  where a location's own coordinates are still the operational point (2) says they are:
  the canonical-location dialog (`locations.maps_url`) and the hotel settings
  (`system_settings.google_maps_url`). It is not on the driver surface, which has no
  location coordinate to paste over — a home's point comes from the address pin instead.

## Revisit if

- **Geofence anchoring moves off `locations`.** The radius argument in (2) is the
  strongest single reason the point stays where it is. If geofencing is ever
  anchored elsewhere, re-open whether the address should carry a pin.
- **An address is needed for something with no location.** Nothing in the fleet
  is addressed but unlocated today. The moment one is, the NULL-pin rule in (3) is
  the thing to re-examine — and the answer should be a new location, not a
  coordinate on an address.
- **`locations.address` is finally dropped.** When every surface reads the
  structured address, the denormalization in (5) narrows to the coordinates only
  — and at that point the legacy text stops being displayed residue at all.
- The `resolution → PSGC` correspondence is still unresolved: the codes in
  `ph_*` are self-consistent but their padding form does not match
  `jgngo/psgc-data` (see [[Geography Tables]]). That is a question about the
  geography tables, not about ownership, but it constrains any future backfill.

## Related

[[addresses]] · [[Routes]] · [[Geography Tables]] · [[Trips]] · [[Decision Log]] · [[Migrations]]
