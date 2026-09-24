---
type: table
title: addresses
tags: [database, table, address, location, privacy]
source:
  - supabase/migrations/122_address_registry.sql
  - supabase/migrations/123_psgc_geography.sql
last_verified: 2026-09-24
---

# `addresses`

The single registry for every resolved address in the system. Created by migration
`122` (2026-09-23). **No other table carries its own `latitude`/`longitude` pair** —
address-bearing records point here by FK instead.

## Columns

| Column | Type | Notes |
|---|---|---|
| `address_id` | serial PK | |
| `raw_input` | text | exactly what the operator typed, before the provider answered |
| `formatted_address` | text NOT NULL | the provider's `freeformAddress`; CHECK-guarded against blank |
| `street_number`, `street_name` | varchar | house/building number and street |
| `unit_number`, `building` | varchar | |
| `subdivision` | varchar | Philippine subdivisions are a first-class component, not free text |
| `barangay` | varchar | **the component the PH mapping is least certain about** — see below |
| `city`, `municipality` | varchar | both kept: NCR cities and provincial municipalities are not the same thing |
| `province`, `region` | varchar | |
| `postal_code` | varchar(16) | **never invented** — NULL when the provider returns none |
| `postal_code_source` | varchar(16) | `provider` \| `manual` \| NULL |
| `country` | varchar(100) | defaults to `Philippines` |
| `latitude`, `longitude` | numeric(10,7) | all-or-nothing, CHECK-guarded |
| `provider`, `provider_place_id` | varchar / text | provider id kept so the server can re-resolve |
| `verified` | boolean NOT NULL | default false |
| `verified_at` | timestamptz | NULL unless verified |
| `created_at`, `updated_at` | timestamptz | `update_updated_at()` trigger |

### Added by migration `123`

| Column | Type | Notes |
|---|---|---|
| `address_type` | varchar(16) | `home` \| `office` \| `operational` \| `other` — see below |
| `landmark` | varchar(255) | a nearby place a driver would recognise |
| `additional_details` | text | gate colour, floor, who to ask for |
| `psgc_barangay_code` | varchar(10) | FK → `ph_barangays`, `ON DELETE SET NULL` |

`psgc_barangay_code` is the row's link into the picked hierarchy, and it is what makes
**server-side** validation possible: the server resolves the code to its region, province and
city from the `ph_*` tables and derives those components itself rather than believing the text
the client sent. A client cannot file a barangay of Santa Rosa under Cebu City, because the
city name is never read from the request. See [[Geography Tables]] and
`src/lib/address/validate-structured.js`.

`landmark` and `additional_details` are deliberately **excluded from `formatted_address`**.
They are instructions to a driver, not postal lines, and the composed address is what every
downstream consumer reads.

### `address_type`, and the one rule it changes

The column carries **no CHECK constraint** — `varchar(16)` with the allowed set enforced in
`src/lib/address/structured.js` (`ADDRESS_TYPES`, and `ADDRESS_TYPE_VALUES` derived from it).
Adding `operational` therefore needed **no migration**: it is 11 characters, and the database
was never the thing refusing it. That is worth stating because the opposite is easy to assume,
and a migration written to "allow the new type" would have been a no-op with a version number
spent on it.

| Value | Meaning |
|---|---|
| `home` | where someone lives — the **default**, because most addresses entered against a driver are this |
| `office` | a place of work |
| `operational` | a base, terminal or stop the fleet serves |
| `other` | anything else |

`operational` exists because the first two and `other` are all a *person's* vocabulary. The two
place-shaped surfaces — the canonical-location dialog and the hotel base — cannot honestly claim
`home` or `office`, and `other` is the statement that no answer was available rather than an
answer. Before it existed they recorded `other`; they now pass `forcedType="operational"` to
`AddressFormDialog`, which applies it for the **whole lifetime of the form**, not only at submit.
That detail matters: `operational` is the one type that relaxes a required field, so a form
validating the unforced `home` would demand a house number the server never asks for, and Save
would stay disabled with nothing the operator could type to satisfy it.

**One type relaxes one field.** An `operational` address does not have to carry
`street_number` (see `requiredDetailFields` in `src/lib/address/structured.js`): a terminal curb
has a road and a ZIP and no number, and requiring one leaves the operator to invent a number or
leave the address unrecorded. Everything else is unchanged — the street and the ZIP are still
required on an operational address, and **no other type is affected**. The accepted trade is
that `type` is a claim the caller makes, so a client wanting to skip the house number can now
declare itself operational; that is preferred over a general "optional" flag, which would be
indistinguishable from a bug and would relax the rule for surfaces that never asked.

## Referenced by

Three nullable FKs, all `ON DELETE SET NULL`:

- `locations.address_id` — the canonical location identity (also covers the hotel base)
- `drivers.address_id` — driver residential address
- `drivers.emergency_contact_address_id` — next-of-kin address

`transportation_requests.pickup_location_id` / `.dropoff_location_id` are **not** on that
list, though they were once written down here as if they were. They point at
`locations(location_id)`, not at this table: a request links to the canonical *place* it
names and reaches a structured address **through** that location rather than holding one of
its own. Nothing in the address layer writes them. They are filled at ingest by
`linkRequestLocations()` (`src/services/route-resolver.service.js`), matched against the
request's stored pickup/drop-off text — the same exact-name, exactly-one-match rule the route
resolver uses, and left NULL rather than guessed when the text matches no single active
location.

**The pair has an origin worth knowing, because it makes the gap look like an oversight
rather than a design.** Migration `007` gave a `pickup_location_id` / `dropoff_location_id`
pair to **`vehiclereservations`** and backfilled it, matching on name *and* coordinates
together. That table is gone — the `/api/reservations` tree was deleted with migration `036`
— and `122` re-declared the pair on `transportation_requests`, where **nothing ever wrote
one**. The newer table inherited the schema of a link without its writer, which is why the
columns looked alive in every artifact and resolved nothing at runtime.

`ON DELETE SET NULL` rather than a hard link because no `DELETE FROM locations` exists
anywhere in the codebase — locations are retired, never hard-deleted — so the FKs
introduce no new failure mode, and the safer default costs nothing.

## Constraints

```sql
chk_addresses_coords_pair      -- both lat/lng NULL, OR both present and in range
chk_addresses_formatted_not_blank  -- btrim(formatted_address) <> ''
```

The first makes a **half-pair unstorable**, which is the database half of the rule that
coordinates can never be paired with the wrong address. The second stops a row that
reads as a real place while carrying no place.

## Privacy

**`private`** in `scripts/lib/schema-contract.mjs`. A leaked row is a person's home
location — the most dangerous thing in this schema to disclose after live GPS. RLS is
enabled with no policies (deny-all for `anon`/`authenticated`) **and** all privileges are
revoked from both roles, on the table and on its sequence. The revoke is load-bearing:
row security does not apply to `TRUNCATE`, so RLS alone would leave the table emptyable
with the public anon key. `verify:anon` returns an explicit refusal (HTTP 401 / SQLSTATE
42501) rather than `200 []`.

## Not yet true

- **Three canonical locations were backfilled on 2026-09-24; nothing else has been, and
  nothing is bulk-geocoded.** `#1 CoCo Star Hotel`, `#8 NAIA Terminal 2 - Arrivals` and
  `#10 NAIA Terminal 3 - Arrivals (Bay 9)` took `address_id` **1, 2 and 3** via
  `scripts/backfill-location-addresses.mjs` — the registry's first three rows — each with
  `provider = 'manual'`, `verified = false` and NULL coordinates. Every other location and
  every other address-bearing row keeps `address_id = NULL` and reads from its existing text
  columns; a row is upgraded only when a human next edits it. The same holds for
  `psgc_barangay_code` — untouched rows are NULL until individually re-edited. Migration
  `123` declined a bulk backfill and so did this one: it is scoped to three named locations
  and skips any row that is already linked, retired or renamed. The authority boundary it
  implements is [[ADR-015 Address Owns Administration, Location Owns The Point]].
- **Four address surfaces write to this table.**
  1. **The canonical-location dialog.** Since 2026-09-24
     `src/app/(dashboard)/routes/locations/page.js` picks through the cascade and
     `POST`/`PUT /api/locations` resolve the pick server-side and write the `addresses` row
     and `locations.address_id` in one transaction (the service is called with the caller's
     `tx`, so the two commit together).
  2. **The hotel base location.** `src/app/(dashboard)/settings/general/page.js` +
     `PUT /api/settings/hotel` do the same. This surface stores the address in **two** places
     — the `locations` row *and* the `system_settings.setting_value` JSON blob — so
     `address_id` is written to both, in the same transaction, from the same value. The
     `physical_move` flag picks between UPDATE-in-place and INSERT-then-retire, and
     `address_id` is threaded through both branches.
  3. **Driver residential address.** Since 2026-09-24
     `src/components/address/address-picker-field.jsx` is mounted on `/drivers/new` and
     `/drivers/[id]/edit`, and `POST`/`PUT /api/drivers` resolve the pick into
     `drivers.address_id`. See (4) for the one structural difference.
  4. **Driver emergency contact address.** The same component, the same two routes, writing
     `drivers.emergency_contact_address_id` from `emergency_structured_address`. Both driver
     addresses are saved in **one** transaction so a driver cannot point at one of the two
     they picked.

  **The driver surface is where `chk_addresses_coords_pair`'s second branch is exercised.**
  Every row written before it — the three backfilled locations and the hotel — carries
  NULL/NULL, because those surfaces pass `showPinMap={false}`: the location already owns a
  point. A driver's home has no other coordinate owner, so the pin is enabled there and a
  real latitude/longitude pair is stored. That is the decision in
  [[ADR-015 Address Owns Administration, Location Owns The Point]], not a departure from it.

  **Both driver routes fail hard, and only one of them is atomic.** The difference is exact
  and worth stating rather than rounding off. `PUT`'s two `saveAddress` calls share one
  `withTransaction`; the driver `UPDATE` runs *after* it as a plain `query`, so a registry
  refusal costs a retry and writes nothing, while a driver-`UPDATE` failure leaves one
  orphaned registry row — harmless, because the registry is append-only and nothing joins
  it by value, and the caller still gets a failure. `POST` could not be atomic at all, and
  for a structural reason worth recording — its employee and driver inserts went through the
  **Supabase client** (PostgREST over HTTPS), and PostgREST is a separate HTTP service that
  cannot be enrolled in a `pg` `BEGIN`/`COMMIT`. There was no way to make the two halves
  share a transaction, so an address failure left a committed driver with both ids NULL,
  surfaced as a `warning` on the response.

  **`POST` is now atomic.** It writes the employee, both address rows and the driver on one
  `pg` transaction — the two inserts moved off the Supabase client
  onto `tx.query`, which is what buys the atomicity. Both were plain INSERTs with a
  `RETURNING` and a unique-violation check; neither needed anything only PostgREST
  provides. The addresses are written **before** the driver row, so their ids go straight
  into its column list and there is no follow-up `UPDATE`. A failure anywhere rolls back all
  of it: no employee, no driver, no address rows. The `warning` field is gone, and so is the
  old hand-rolled compensation that soft-deleted the employee when the driver insert failed —
  a rollback makes it dead code.

  The two guard `SELECT`s still run outside the transaction, on the Supabase client. They
  are reads; the authoritative guards are the unique constraints inside it, which is why a
  `23505` is translated to the same 409 rather than assumed unreachable.

  **Reservations is not on this list and is not an address surface.**
  `transportation_requests.pickup_location` / `.dropoff_location` are text naming a
  canonical location, and a reservation reaches a structured address **through** that
  location via `linkRequestLocations()`. Wiring the driver surfaces up closes the list as it
  stood; per-surface work following the same shape is what is left for any new surface.
- **A registry row is never edited, only appended.** `saveAddress` always inserts and
  repoints the referencing column; a superseded row is orphaned rather than mutated. That is
  what makes "one entity's edit silently rewrites another's address" impossible —
  `getAddress` is the only reader, and nothing joins by value.
- **Re-opening the cascade on an existing address starts blank.** `GET /api/locations`
  returns `address_id` but not the structured detail behind it, so the picker cannot
  pre-fill. Reconstructing a `psgc_barangay_code` from stored text is the fuzzy name match
  the whole design refuses, so the current address is shown read-only instead and picking a
  new one replaces it. A loader for the structured detail is the obvious follow-up, and every
  surface that picks an address will want it.
- **`barangay` is mapped from TomTom's `municipalitySubdivision`, and that is an
  assumption, not a measurement.** The live server key is not authorized for TomTom's
  Search API (it returns 403; Routing works), so no real payload has been observed. The
  unit tests cannot settle it — they only assert that a field the provider does not send
  stays NULL, which passes under either mapping. If the assumption is wrong, the correct
  fix is to leave `barangay` NULL rather than mislabel it; never invent one.
  **The cascading form does not depend on this.** It gets its barangay from a chosen PSGC
  code, which is not a mapping and cannot be wrong in the same way.
- **`verified` stays `false` for every address the cascading form writes.** A dropped pin
  is an operator's claim about where a door is, not a provider verification. Those rows
  carry `provider = 'manual'`. Nothing in the UI may imply otherwise.

## Related

[[Migrations]] · [[Database Overview]] · [[Routes]] · [[Driver Management]] · [[Geography Tables]] · [[Why RLS Is Not A Boundary]] · [[ADR-015 Address Owns Administration, Location Owns The Point]]
