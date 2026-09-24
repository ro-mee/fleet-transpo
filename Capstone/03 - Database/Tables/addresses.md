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
| `address_type` | varchar(16) | `home` \| `office` \| `other` |
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

## Referenced by

Five nullable FKs, all `ON DELETE SET NULL`:

- `locations.address_id` — the canonical location identity (also covers the hotel base)
- `drivers.address_id` — driver residential address
- `drivers.emergency_contact_address_id` — next-of-kin address
- `transportation_requests.pickup_location_id` → `locations(location_id)`
- `transportation_requests.dropoff_location_id` → `locations(location_id)`

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

- **Nothing is backfilled and nothing is bulk-geocoded.** Legacy rows keep
  `address_id = NULL` and read from their existing text columns; a row is upgraded only
  when a human next edits it. The same holds for `psgc_barangay_code` — legacy rows are NULL
  until individually re-edited. Migration `123` deliberately declined a bulk backfill.
- **Two address surfaces write to this table so far.**
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

  The remaining surfaces — reservations, driver residential and driver emergency contact —
  still use their existing fields. Wiring them up is separate, per-surface work following the
  same shape.
- **A registry row is never edited, only appended.** `saveAddress` always inserts and
  repoints the referencing column; a superseded row is orphaned rather than mutated. That is
  what makes "one entity's edit silently rewrites another's address" impossible —
  `getAddress` is the only reader, and nothing joins by value.
- **Re-opening the cascade on an existing address starts blank.** `GET /api/locations`
  returns `address_id` but not the structured detail behind it, so the picker cannot
  pre-fill. Reconstructing a `psgc_barangay_code` from stored text is the fuzzy name match
  the whole design refuses, so the current address is shown read-only instead and picking a
  new one replaces it. A loader for the structured detail is the obvious follow-up, and all
  five surfaces will want it.
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

[[Migrations]] · [[Database Overview]] · [[Routes]] · [[Driver Management]] · [[Geography Tables]] · [[Why RLS Is Not A Boundary]]
