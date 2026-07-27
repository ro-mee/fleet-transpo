---
name: database-normalization
description: Guide for analyzing, planning, and executing database normalization on Supabase/PostgreSQL schemas. Use this whenever the user asks about database design, schema refactoring, normalization (1NF/2NF/3NF), reducing data redundancy, cleaning up denormalized columns, migrating JSONB to relational tables, or writing database migrations for a Supabase project. Also trigger on questions about database best practices, schema optimization, data integrity improvements, or any task involving restructuring database tables. This skill covers the full workflow: schema audit → normalization plan → migration SQL → RLS policy updates → service layer updates. Do NOT use for purely analytical queries (SELECT/aggregate/reporting) that don't involve schema changes.
compatibility:
  requires: ["supabase/migrations/ directory", "src/services/ directory with Supabase query files"]
---

# Database Normalization for Supabase/PostgreSQL

This skill guides you through normalizing a Supabase PostgreSQL schema. The goal is to reduce data redundancy, eliminate update anomalies, and improve data integrity — while keeping the schema practical for real-world query patterns.

## Philosophy

Normalization is a spectrum, not a binary. Every normalization step trades query simplicity for write integrity. Before making changes, understand the data access patterns by reading the service files in `src/services/`. If a denormalized field is read 1000x more often than it's written, keeping it denormalized — but adding a trigger to keep it in sync — is often the right call. If it's written frequently and keeping it consistent is error-prone, normalize it.

Three questions to ask before every normalization decision:
1. **How is this data written?** — Single source? Multiple places? Manual entry or system-generated?
2. **How is this data read?** — Always joined with its parent, or queried independently?
3. **What breaks if it gets out of sync?** — Cosmetic display issue? Or incorrect billing/reporting?

## Diagnostic checklist

Read the migration files in `supabase/migrations/` (they define the current schema state) and cross-reference with the ERD docs in `docs/erd/`. Look for these patterns:

### 1. Redundant / duplicated columns
Columns that store the same information in multiple tables.

**Example** — The `routes` table stores `origin` and `destination` as text alongside `origin_latitude/origin_longitude` and `destination_latitude/destination_longitude`. The lat/lng pairs are attributes of locations, not of the route itself. If you ever need to look up a location by coordinates, you'd scan the routes table or create duplicates.

**Fix:** Extract locations into their own table:
```sql
CREATE TABLE locations (
  location_id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
Then reference `origin_location_id` and `destination_location_id` from routes.

### 2. JSONB used where relational tables fit better
JSONB is great for truly variable or schema-less data. It's a warning sign when:
- You query into the JSONB with path operators (`->>`, `#>`) in application code
- You need referential integrity on the data inside the JSONB
- Other tables need to FK-reference the data inside the JSONB

**Example** — `roles.permissions` JSONB (from migration 005's simplification). Permissions are now opaque blobs; you can't FK to them, can't query them efficiently, and any application logic that checks permissions must parse the JSONB client-side.

**Consider:** Restoring a normalized permissions structure if app code needs to check individual permissions. If only the full set is ever read/written together and permissions are always managed through admin UI, JSONB may be fine.

**Example** — `vehicles.documents` JSONB (also from migration 005). Documents have structure (document_type, document_number, file_url, expiry_date, status). If you need to query "which vehicles have expired insurance" or "count documents by type", a `vehicledocuments` table with proper columns is better.

### 3. Derived / aggregate columns stored as data
When a column can be computed from other data in the database, storing it introduces a sync risk.

**Examples in the current schema:**
- `drivers.performance_score`, `drivers.total_trips`, `drivers.total_distance`, `drivers.total_hours`, `drivers.rating` — all derivable from trips, dispatch, and feedback data.
- `tripcostanalysis.total_cost` and `tripcostanalysis.cost_per_km` — derivable from the individual cost columns.

**Fix:** Either (a) remove the derived columns and compute them in views or application code, or (b) keep them as materialized caches with triggers to recalculate on relevant changes. Document which approach you chose and why.

### 4. Columns that exist in multiple tables with the same meaning
When the same concept is stored in different places with different names, or the same data lives in two tables.

**Examples:**
- `employees.license_number` / `employees.license_expiry` and `drivers.license_number` / `drivers.license_expiry` — licenses are driver-specific, so the copies in `employees` are redundant if a driver record exists.
- `trips.origin` / `trips.destination` and `routes.origin` / `routes.destination` and `vehiclereservations.pickup_location` / `dropoff_location` — these represent the same kind of data (a location with a name and optional coordinates) but are stored in three different formats.
- `dispatchschedules.estimated_distance` / `dispatchschedules.estimated_duration` and `routes.estimated_distance` / `routes.estimated_duration` — these are route properties, not dispatch properties.

### 5. 1:1 tables that could be merged
When two tables have a one-to-one relationship, consider if they should be a single table.

**Examples:**
- `tripcostanalysis` ↔ `trips` (1:1) — every trip cost analysis record corresponds to exactly one trip.
- `tripperformance` ↔ `trips` (1:1) — same pattern.
- `drivers` ↔ `employees` (1:1) — every driver is an employee, but employee can exist without being a driver.

The drivers/employees case is often best kept separate (not all employees are drivers). But tripperformance and tripcostanalysis can reasonably be folded into `trips` as nullable columns.

### 6. Redundant FK references
When a table FKs a parent that's already reachable through another FK.

**Example** — `gpstracking` has `vehicle_id`, `driver_id`, and `trip_id`. Since `trip_id` already links to a trip which has vehicle and driver, storing all three is redundant. The GPS tracking record only needs `trip_id` — the vehicle and driver can be joined through the trip.

However, this may be intentional for query performance on time-series data (avoiding the join on every GPS point). Document the trade-off.

## Output format

For each normalization task, produce:
1. **A diagnostic report** listing what you found and your recommended changes
2. **Migration SQL** in a new file `supabase/migrations/00X_normalization.sql` (use the next sequence number)
3. **Updated service files** in `src/services/` if the schema changes affect query patterns
4. **Updated RLS policies** if your changes alter table structure

### Migration SQL structure

Each migration should be idempotent (use `IF NOT EXISTS` / `IF EXISTS`) and organized into clearly commented sections:

```sql
-- ============================================
-- MIGRATION 00X: [Descriptive Name]
-- ============================================

-- 1. CREATE new tables
-- ============================================

-- 2. MIGRATE data from old structure
-- ============================================
-- Use INSERT INTO ... SELECT to copy data before dropping old columns

-- 3. ADD new FK constraints
-- ============================================

-- 4. DROP old columns/tables (only after data is migrated)
-- ============================================

-- 5. UPDATE RLS policies
-- ============================================

-- 6. UPDATE service layer comments
-- ============================================
```

## Handling trade-offs

After identifying each issue, decide on a approach:

| Pattern | Recommended approach |
|---|---|
| Simple redundancy (same field in 2 tables) | Normalize: remove from one, add FK |
| Derived/aggregate columns | Remove, use a VIEW or computed cache with trigger |
| JSONB that's queried by key | Extract to relational table |
| JSONB that's read/written as a unit | Keep JSONB, add a CHECK constraint |
| 1:1 tables | Merge unless there's a clear access-pattern reason to keep separate |
| GPS-level redundant FKs | Keep if time-series query perf matters, remove if not |
| Cached denormalized guest data in reservations | Keep as cache (it's from external parent system), add sync timestamp |

Write a brief rationale for each decision in the migration SQL comments.

## Service layer updates

When columns move between tables, update the affected service files:

1. **Imports stay the same** — the service files import from `@/lib/supabase/client` and use the Supabase JS client
2. **Update `.select()` strings** to reflect new table/column names
3. **Update `.insert()` / `.update()` objects** if the shape changed
4. **Add `.eq()` filters** for new FK columns where needed
5. **If columns moved to related tables**, add the appropriate `select` joins: `select("*, new_table(*)")`

### Example — after extracting locations

```js
// Before
export async function getRoutes() {
  return supabase
    .from("routes")
    .select("*");
}

// After
export async function getRoutes() {
  return supabase
    .from("routes")
    .select("*, origin_location:origin_location_id(*), destination_location:destination_location_id(*)");
}
```

## Order of operations

When normalizing multiple areas, work in this order to minimize conflicts:

1. **New base tables** (locations, documents, permissions) — these have no dependencies on other new tables
2. **FK additions** — add new columns and constraints referencing the new base tables
3. **Data migration** — INSERT INTO new tables, UPDATE FK columns
4. **Drop redundant columns** — after data is migrated and verified
5. **Drop redundant tables** — last, after all data is migrated
6. **Update RLS** — mirrored to match new table structure
7. **Update service layer** — queries and mutations reflect new schema
8. **Add indexes** — based on query patterns from the service files
