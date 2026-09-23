---
type: table
title: Geography Tables
tags: [database, table, address, geography, psgc, reference]
source:
  - supabase/migrations/123_psgc_geography.sql
  - supabase/migrations/124_barmm_region_code.sql
  - scripts/import-psgc.mjs
  - scripts/psgc-normalize.mjs
  - scripts/lib/psgc-normalize.mjs
  - scripts/lib/schema-contract.mjs
last_verified: 2026-09-24
---

# Geography tables (`ph_regions`, `ph_provinces`, `ph_cities`, `ph_barangays`)

The Philippine Standard Geographic Code hierarchy, added by migration `123`. These four
tables are what the cascading address form picks from, and what
`src/lib/address/validate-structured.js` derives a stored address's region, province and
city out of.

They exist because the geocoder route is blocked. TomTom's Search API answers `403` for the
server key, so `AddressValidator` cannot resolve anything today. Picking from the real
hierarchy makes an address already structurally valid with **no provider in the path** —
and it closes a hole a geocoder could never close, since a provider can confidently place a
pin at a barangay whose name appears in two different cities.

## Shape

| Table | Key | Parent | Rows |
|---|---|---|---|
| `ph_regions` | `psgc_code` varchar(10) PK | — | 17 (seeded) |
| `ph_provinces` | `psgc_code` PK | `region_code` → `ph_regions` | 82 |
| `ph_cities` | `psgc_code` PK | `region_code` → `ph_regions`, `province_code` → `ph_provinces` **NULLABLE** | 1,642 |
| `ph_barangays` | `psgc_code` PK | `city_code` → `ph_cities` | 42,001 |

Every FK is `ON DELETE CASCADE` — these are derived reference rows, unlike the `addresses`
rows that reference them. `addresses.psgc_barangay_code` is the exception and is
`ON DELETE SET NULL`, so retiring a code cannot delete a driver's home address.

## `ph_cities.province_code` is nullable, and that is load-bearing

**Metro Manila has no provinces.** Manila, Quezon City, Caloocan and the rest hang directly
off the region; several highly urbanised cities do the same. A `NOT NULL` province would
force those rows into a fabricated province, which is the "do not force every Philippine
address into an incorrect standardized format" rule.

`region_code` is therefore present on **every** row and is what the cascade can always rely
on; a missing `province_code` is *meaningful data*, not missing data. A cascade that assumes
four levels everywhere leaves Province permanently disabled and makes every NCR address
unsaveable — the failure this column exists to prevent.

## What is seeded, and what is not

**Regions are seeded by migration `123`; everything below them was imported on 2026-09-24.**
The four levels were originally split differently — regions written into the migration, the rest
left to an import — because regions are few, stable and enumerable, while writing provinces,
cities and barangays from memory would assert specific barangays that may not exist.

That distinction no longer separates two states of the database, only two provenance routes.
**All four levels are populated**, and the form's cascade works end to end today.

NIR (Negros Island Region) is not in the seed: it was abolished in 2017 and re-established in
2024, so it is newer than the stable set. Whether the import supplies it is the import file's
business rather than this note's.

## The importer takes parentage as input and validates it

`scripts/import-psgc.mjs <file> [--dry-run]` reads CSV or JSON whose rows state their `level`
and their parent codes explicitly.

It deliberately does **not** derive a parent by masking digits off the PSGC code. The digit
layout is not uniform — the province segment is meaningless for the province-less cities,
and block widths have changed between PSGC revisions — and a mask that is wrong for one
class of code files those addresses under the wrong parent, silently. The parent is read
from the file and then **validated**: every named parent must resolve to a row in the file or
already in the table, or the whole import is rejected before anything is written.

Everything imports in one transaction, upserts on `psgc_code` (so a re-import converges onto
a corrected export), and never deletes — removing a code would null out every address
pointing at it. PSGC churn is real; nothing schedules the re-import, which is a maintenance
task this design creates and does not automate.

## The converter, and the one rule it cannot prove

No public PSGC dataset is published in the flat shape the importer wants. They arrive as one
file per level, each with its own column names and its own idea of what a code looks like, so
`scripts/lib/psgc-normalize.mjs` (with the CLI at `scripts/psgc-normalize.mjs`) is the seam:

```
node scripts/psgc-normalize.mjs [source-dir] [--out <file>] [--dry-run]
node scripts/import-psgc.mjs scratch/psgc-normalized.csv --dry-run
```

It touches no database and needs no credentials. It emits the source's own codes rather than
re-encoding them, and it **checks** that they nest — see below. That check is not the same
thing as deriving parentage from digits, which the importer still refuses to do: the parent is
read from the source's `adm1`/`adm2`/`adm3` columns exactly as before, and the digits are only
ever used to contradict it.

**The codes are integers in the source, so the leading zero is gone by the time we see it.**
Region I arrives as `100000000` and the published code is `0100000000`. Left-padding to 10
recovers it; right-padding turns it into `1000000000`, which is Region X's code in that very
same file. Nothing raises — every Ilocos address is simply filed under Northern Mindanao, with
a code that validates, joins, and is wrong. That rule is one function (`deriveCode`), with the
evidence beside it, so a correction is a one-line change and a re-import.

Measured across all four files, the widths are **2/3/2/3** — region, province,
city-or-municipality, barangay:

| | raw | canonical |
|---|---|---|
| Region I | `100000000` | `0100000000` |
| Ilocos Norte | `102800000` | `0102800000` |
| Adams | `102801000` | `0102801000` |
| Amuyong (bgy) | `102801001` | `0102801001` |
| Region X | `1000000000` | `1000000000` |
| Bukidnon | `1001300000` | `1001300000` |
| Balintad (bgy) | `1001301001` | `1001301001` |

Every level is the next one down with its tail zeroed, in the 9-digit and 10-digit raw forms
alike, so the codes are **prefix-nested**: `LEFT(code, n)` rolls a barangay up to its city,
province and region. The converter asserts that nesting at the parent's own width and refuses
to write anything if a row's digits contradict the parent it names.

**What is not settled** is which published form this is. A second dataset, `jgngo/psgc-data`
(PSGC-DEC2017), agrees on the province *number* — Cavite is 21, Laguna is 34 — but not on
where its padding goes: it writes Cavite as `0421000000` where this source writes
`0402100000`. The two are not interchangeable, and mixing provinces from one with cities from
the other produces a hierarchy where nothing joins. The form used here wins on two counts and
is proven by neither: it nests by prefix (jgngo's does not — `0421000000` and `0400000000`
differ at digit 3) and it matches the regions migration `123` seeds. Until PSA's own
publication settles it, the import is self-consistent by construction and the converter is the
single place a correction lands.

## Two levels the four-level model does not have

The source is not a clean pyramid. Two of its levels have no column here, and the first run
of the converter dropped both **silently** — which orphaned 960 barangays and produced a
failure that named the orphans rather than the cause. The drops are now reported by level with
counts, and the two cases are handled differently because they are not the same kind of thing:

**Metro Manila interposes districts between a city and its barangays.** Tondo, Sampaloc,
Ermita — the barangays name one in `adm3`, and those district codes exist as **no row at any
level** the source publishes. Taken literally every one of Manila's 897 barangays orphans.
The district is therefore **collapsed**: the barangay attaches to the city that owns it, which
is the address people actually write, "Barangay 1, Manila". The fallback is narrow on purpose
— `adm2` is a city only in the province-less case, so a barangay anywhere else is never
silently re-pointed at a province. The digit check runs against `digitCityCode`, the district
the code genuinely nests under, rather than the city that was stored; checking against the
stored city would have flagged all 897 for a collapse that was deliberate.

**BARMM's Special Geographic Area is the reverse.** Its 63 barangays — the ones that joined
the region by plebiscite in 2019 — sit under clusters, not cities, and the clusters **are**
rows (`geo_level = SGU`). Dropping them as "not a city" orphans all 63, so they are kept in
the city table, which is the only slot this model has for them. They carry `is_city = false`,
because they are not cities and the column means what it says.

Both are consequences of modelling four levels where the country has five. They are recorded
rather than hidden: a future reader adding a district level should find these two paragraphs,
not rediscover them from an orphan count.

### The four rows that carry no level at all

The same run reported four rows dropped with a **blank** `geo_level` — two in the provinces
file, two in the barangays file. They are not a level this model lacks; the source does not say
what they are, which is why the report now separates the two cases rather than printing
`dropped ... at level ""` as though the converter were at fault. What they turned out to be,
checked against the files:

| Row | What it is |
|---|---|
| `900000000,990100000,City of Isabela (Not a Province)` | A **pseudo-province** that exists only to give the city an `adm2`. The city row is `990101000`, and its barangays nest `adm2=990100000, adm3=990101000`, so they resolve through the real city row regardless. |
| `1900000000,1909900000,<no name>` | BARMM's Special Geographic Area pseudo-province. **Referenced by nothing** — the SGU clusters nest under `1999900000`, not this. |
| `1303901906`, `1303901907` | Two **unnamed** Manila First District barangays. |

Keeping the first would put a "province" named *City of Isabela (Not a Province)* in the
dropdown and make Province **required** for that city, so dropping it is the correct read, not
a tolerated loss. The third row is the one worth remembering: `1303900000` is the
**`NCR, City of Manila, First District (Not a Province)`** `Dist` row, so these two barangays
have a non-city at *both* `adm3` and `adm2` and the collapse rule cannot place them at all.
They are dropped for having no name, and that drop is currently **masking** the fact. It is
harmless only because a nameless row is unusable anyway — `ph_barangays.name` is `NOT NULL` —
but if a future export names them they will orphan, and the failure will read as a hierarchy
problem rather than the gap it is.

The other Manila barangays are unaffected: they carry the City of Manila in `adm2`, which *is*
a city row, so the collapse reaches them. This export is also thin on First District — exactly
two rows — which is the source's own incompleteness rather than anything this converter did.

## Privacy

All four are **`private`** in `scripts/lib/schema-contract.mjs`, though none holds personal
data. The reason is the grant path rather than the contents: the application reads them over
its own owner-role connection, so nothing legitimate uses the anon path — and a *writable*
anon path to `ph_barangays` would let anyone holding the key that ships in the browser
bundle rewrite where a barangay sits in the hierarchy, silently repointing every address that
references it.

RLS is enabled explicitly on each (migration `100` was a one-time list of 20 tables, not a
standing rule — SEC-DB-003) **and** all privileges are revoked from `anon` and
`authenticated`, because row security does not apply to `TRUNCATE`. There is no sequence to
revoke: the primary key is the natural PSGC code.

## Verified state

Migration `123` is **applied** and all four tables were probed end to end on 2026-09-23:

| Gate | Result |
|---|---|
| `npm run db:up` | `123_psgc_geography.sql ... ok` |
| `npm run db:dump` | 65 tables, 1 view, 133 FKs, 163 standalone indexes, 15 functions, 24 triggers — every delta against the pre-123 figures (+4 tables, +5 FKs, +5 indexes, +4 triggers) is exactly what this migration writes |
| `npm run db:contract` | 66 relations, **0 violations**; all four `RLS on; anon has no SELECT; no anon policy` |
| `npm run verify:anon` | **PASS — `HTTP 401 (42501)`, explicitly refused**, for all four. Not `200 []` |

The anon verdict being a **refusal rather than an empty `200`** is the strongest form of the
result and is not luck: the `REVOKE` removed the SELECT grant entirely, so PostgREST refuses
at the privilege check before row security is even consulted. It also means the verdict does
not depend on the row count — which mattered at the time, because these tables were **empty
until the PSGC import ran**, and on empty tables `200 []` would have been INCONCLUSIVE rather
than a pass. That is precisely the trap `ai_prompt_templates` and `trip_monitor_alerts` fell
into.

Because that verdict was taken against empty tables, it is worth **re-running `verify:anon`
now that 42,001 barangays are in them**. The reasoning says nothing changes — a privilege
refusal cannot depend on how many rows it refuses — but this repository has a standing rule
that reasoning about a gate is not the gate, and the check costs one command.

### The import, 2026-09-24

`124_barmm_region_code.sql` applied first (BARMM `1500000000` → `1900000000`), then:

```
node scripts/psgc-normalize.mjs                    # 43,725 rows written
node scripts/import-psgc.mjs … --dry-run           # hierarchy validated, nothing written
node scripts/import-psgc.mjs …                     # written
```

| Level | Imported |
|---|---|
| province | 82 |
| city | 1,642 |
| barangay | 42,001 |

The **dry run** is the step that proves the region fix, not the write: the importer resolves
every stated parent against the live table and rejects the file as a unit, so the whole
43,725-row set could not have landed while region 19 was missing. Running it before the write
is what turns "the import worked" into "the import was allowed to work".

**Both gates were then re-run against the populated tables** — the check the 2026-09-23
verdict left open, since a refusal against an empty table is not the same claim as a refusal
against 42,001 rows:

| Gate | Result |
|---|---|
| `npm run verify:anon` | **PASS — `HTTP 401 (42501)`, refused**, all four, with `ph_barangays` holding 42,001 rows. `0 EXPOSED` across the schema |
| `npm run db:contract` | 66 relations, **0 violations, 0 unclassified**; all four `RLS on; anon has no SELECT; no anon policy` |

The scan's 49 `INCONCLUSIVE` entries are pre-existing and are resolved by the contract's own
footer — `RLS enabled, no anon policy → PROTECTED (proven regardless of row count)` — which is
the two gates working as a pair rather than an unanswered question.

> The control line reads `65/66 relations have RLS enabled`. The 66th is **`driver_stats`**,
> a view that reads `security_invoker=on` instead. That is SEC-DB-006 staying fixed, not a
> hole — a view needs `security_invoker` rather than RLS, because RLS on its base tables does
> not cover it.

## Not yet true

- **The form has not been exercised end to end.** The cascade can now be driven for the first
  time — CALABARZON → Laguna → Santa Rosa → Balibago is the path to try — and until someone
  does, "the data is loaded" and "the form works" are two different claims, only the first of
  which is established here.
- **Nothing schedules a re-import.** PSGC churn is real: barangays are created and renamed by
  plebiscite. The importer is re-runnable and idempotent, but this design creates that
  maintenance task and does not automate it.
- **`schema.sql` shows the structure but not the protection.** The four `CREATE TABLE`s are in
  it; the RLS flags, the revokes and the absence of policies are invisible to it by
  construction. `db:contract` is the only artifact that sees them (SEC-DB-004).

## Related

[[addresses]] · [[Migrations]] · [[Database Overview]] · [[Why RLS Is Not A Boundary]]
