# FleetOps Schema Diagnostic Report

**Date:** 2026-07-27
**Scope:** All migrations (001–006) applied in order
**Tables remaining:** 23 (after 005 cleanup dropped 17+ tables)
**Service files analyzed:** 12 in `src/services/`

---

## 1. Redundant / Duplicated Columns

### 1.1 License info in `employees` vs `drivers`

| Table | Columns |
|-------|---------|
| `employees` | `license_number VARCHAR(100)`, `license_expiry DATE` |
| `drivers` | `license_number VARCHAR(100)`, `license_expiry DATE` |

Every driver is an employee (via `drivers.employee_id → employees`), so the copies on `employees` are redundant for any driver record. Only non-driver employees would need license info on `employees`, but a license is logically a driver attribute.

**Recommendation:** Drop `employees.license_number` and `employees.license_expiry`. Migrate any existing data to `drivers` for driver records, then remove the columns.

### 1.2 Origin/destination location text in `routes`, `trips`, `vehiclereservations`

| Table | Columns |
|-------|---------|
| `routes` | `origin`, `origin_latitude`, `origin_longitude`, `destination`, `destination_latitude`, `destination_longitude` |
| `trips` | `origin`, `destination` (text only, no coordinates) |
| `vehiclereservations` | `pickup_location`, `pickup_latitude`, `pickup_longitude`, `dropoff_location`, `dropoff_latitude`, `dropoff_longitude` |

Three tables model the same concept (a location with a name and optional coordinates) in slightly different column names. `trips.origin/destination` is a snapshot of route text at trip time (justified for historical accuracy), but `routes` and `vehiclereservations` represent the same kind of location data in parallel structures.

**Recommendation:** Extract a `locations` table (location_id, name, address, latitude, longitude). Replace `routes.origin/origin_latitude/origin_longitude` with `route.origin_location_id → locations`, and similarly `routes.destination_location_id`. For `vehiclereservations`, also replace with `pickup_location_id` and `dropoff_location_id`. Keep `trips.origin/destination` as historical snapshots (they record what was displayed at trip time).

### 1.3 Estimated distance/duration in `routes`, `dispatchschedules`, and `trips`

| Table | Columns |
|-------|---------|
| `routes` | `estimated_distance`, `estimated_duration` |
| `dispatchschedules` | `estimated_distance`, `estimated_duration` |
| `trips` | `estimated_distance`, `estimated_duration` |

`dispatchschedules` has `route_id` FK, `trips` has both `route_id` and `dispatch_id` FKs. The estimated values on `dispatchschedules` and `trips` are copies of route data.

**Recommendation:** Drop `dispatchschedules.estimated_distance` and `dispatchschedules.estimated_duration` — these are always derivable from the linked route. For `trips`, the `estimated_distance`/`estimated_duration` may be kept as a snapshot of what was planned vs actual (they represent pre-trip estimates that could differ from route defaults), so they are borderline acceptable.

---

## 2. JSONB Misuse

### 2.1 `roles.permissions` JSONB

Originally created with normalized `permissions` + `role_permissions` tables (migration 001). Migration 005 denormalized into `roles.permissions JSONB DEFAULT '[]'` and dropped both tables.

**Issues:**
- Cannot enforce referential integrity on permission values
- Cannot query "which roles have permission X" efficiently (requires `jsonb_array_elements`)
- RLS policies cannot check individual permissions — they rely on `has_role()` which checks role name only
- Application code must parse JSONB to check permissions client-side
- Migration 005's comment says "Simplify RBAC" but sacrifices data integrity

**Recommendation:** Restore `permissions` and `role_permissions` tables if the application needs to check granular permissions. If roles are only ever checked by name (current RLS only checks role name), JSONB is acceptable but document that granular permission checks are not supported.

### 2.2 `vehicles.documents` JSONB

Originally a proper `vehicledocuments` table (migration 001) with columns: `document_type`, `document_number`, `file_url`, `expiry_date`, `status`. Migration 005 merged into `vehicles.documents JSONB` and dropped the table.

**Issues:**
- Cannot query "which vehicles have expired insurance" or "count documents by type"
- The notification trigger for document expiry (`notify_document_expiry`) was dropped (005:117-118) because the structured table no longer exists
- File URLs and expiry dates inside JSONB have no type enforcement
- No UNIQUE constraint possible on document number

**Recommendation:** Restore `vehicledocuments` table. The structured document data (type, number, file_url, expiry_date, status) is not genuinely schema-less. Reinstate the `notify_document_expiry` trigger.

### 2.3 `routes.waypoints` JSONB

**Assessment:** Acceptable. Waypoints are genuinely variable-length data with no fixed schema. The service layer (`route.service.js`) does not query into waypoints — it reads/writes the full column as a unit.

**Recommendation:** Keep as JSONB. Add a CHECK constraint to validate shape if needed.

### 2.4 `vehiclereservations.ai_vehicle_recommendation` and `ai_driver_recommendation` JSONB

**Assessment:** Borderline. These contain structured fields (vehicle_id, score, reasons) that could be relational. However, they are written once by the AI service and read as opaque blobs in the reservation detail view. The service files never query into these JSONB fields with path operators.

**Recommendation:** Keep as JSONB but document that if querying becomes necessary (e.g., "which reservations got recommended vehicle X"), extract to `ai_recommendations` instead.

---

## 3. Derived / Aggregate Data Stored as Columns

### 3.1 `drivers` aggregate columns

| Column | Derivation |
|--------|-----------|
| `performance_score DECIMAL(3,2)` | From `tripperformance.smooth_driving_score`, dispatch feedback, etc. |
| `total_trips INT` | `SELECT COUNT(*) FROM trips WHERE driver_id = drivers.driver_id` |
| `total_distance DECIMAL(12,2)` | `SELECT COALESCE(SUM(distance),0) FROM trips WHERE driver_id = drivers.driver_id` |
| `total_hours DECIMAL(10,2)` | `SELECT COALESCE(SUM(actual_duration),0) FROM trips WHERE driver_id = drivers.driver_id` |
| `rating DECIMAL(2,1)` | `SELECT AVG(customer_rating) FROM tripperformance WHERE driver_id = drivers.driver_id` |

**Usage in services:** `ai.service.js:147-152` reads `performance_score` and `total_trips` to score drivers for dispatch recommendations. `report.service.js:103` reads `performance_score`, `total_trips`, `rating` for the driver performance report.

**Recommendation:** These are write-heavy aggregates (every trip completion changes them). Keep as cached columns but add a trigger on `trips` and `tripperformance` to recalculate them on INSERT/UPDATE/DELETE. Currently there is no trigger keeping them in sync — they will drift out of date.

### 3.2 `tripcostanalysis.total_cost` and `tripcostanalysis.cost_per_km`

| Column | Derivation |
|--------|-----------|
| `total_cost` | `fuel_cost + toll_fees + parking_fees + driver_cost + maintenance_cost + miscellaneous_cost` |
| `cost_per_km` | `total_cost / trips.distance` |

**Recommendation:** `total_cost` is a simple sum of other columns in the same row — it should be a generated column (`GENERATED ALWAYS AS (...) STORED`). `cost_per_km` depends on `trips.distance`, which is in a different table, so it cannot be a generated column — compute it in a view or application code.

### 3.3 `fuelrecords.price_per_liter`

Derivable as `amount / liters`. Only one of (liters, amount, price_per_liter) is strictly needed.

**Usage:** `fuel.service.js:54` computes `avgCostPerLiter` from `amount / liters` rather than reading `price_per_liter`.

**Recommendation:** Drop `price_per_liter` or make it a generated column.

### 3.4 `vehiclemaintenance.next_schedule_date` and `next_schedule_mileage`

Partially derivable from `maintenance_date`, `mileage_at_service`, `recurring_interval_days`, `recurring_interval_km`. However, the business logic for recalculating these may involve dispatcher discretion (manual override). Acceptable to keep as editable columns.

---

## 4. Columns with the Same Meaning Across Tables

### 4.1 Location data (3 representations)

See §1.2 above — same root cause.

### 4.2 Estimated distance/duration (3 tables)

See §1.3 above — same root cause.

### 4.3 `vehiclereservations.guest_name/guest_phone/guest_email` + parent-system `guest_id`

These are explicitly documented as "denormalized cache" of parent system data (004 migration comments). The parent system is the source of truth; these are cached for quick display.

**Recommendation:** Acceptable as cached data, but add a `guest_synced_at TIMESTAMPTZ` column to track cache staleness.

---

## 5. 1:1 Tables That Could Be Merged

### 5.1 `tripcostanalysis` ↔ `trips`

Every `tripcostanalysis` record references exactly one `trip` via `tripcostanalysis.trip_id → trips.trip_id (UNIQUE)`. The seven cost columns (fuel_cost, toll_fees, parking_fees, driver_cost, maintenance_cost, miscellaneous_cost, total_cost, cost_per_km) are attributes of the trip itself.

**Service usage:** No service file queries `tripcostanalysis` directly — not used in any `src/services/` file. It's only populated by triggers or background processes.

**Recommendation:** Merge into `trips` as nullable columns (`cost_fuel`, `cost_toll`, `cost_parking`, `cost_driver`, `cost_maintenance`, `cost_misc`, `cost_total`, `cost_per_km`). Drop the `tripcostanalysis` table.

### 5.2 `tripperformance` ↔ `trips`

Every `tripperformance` record references exactly one `trip` via `tripperformance.trip_id → trips.trip_id (UNIQUE)`. Columns are: `driver_id`, `on_time_completion`, `time_variance`, `fuel_efficiency`, `avg_speed`, `max_speed`, `idle_time`, `smooth_driving_score`, `customer_rating`, `notes`.

**Note:** Many of these columns overlap with `trips` (which already has `avg_speed`, `max_speed`, `idle_time`). `tripperformance.avg_speed`/`max_speed`/`idle_time` duplicate `trips.avg_speed`/`max_speed`/`idle_time`.

**Service usage:** Not queried directly in any `src/services/` file. The driver performance report (`report.service.js:101-103`) reads aggregate columns from `drivers` instead.

**Recommendation:** Merge unique tripperformance columns into `trips` (`on_time_completion`, `time_variance`, `fuel_efficiency`, `smooth_driving_score`, `customer_rating`, `performance_notes`). Drop the redundant `avg_speed`/`max_speed`/`idle_time` copies from `tripperformance`. Drop `tripperformance.driver_id` (already on `trips`). Drop the `tripperformance` table.

### 5.3 `drivers` ↔ `employees`

Every driver is an employee (FK `drivers.employee_id` is NOT NULL). Not all employees are drivers. This is a genuine subtype/supertype relationship.

**Recommendation:** Keep separate — this is correct for 1:0..1 relationships. Non-driver employees should not have driver-specific columns cluttering the `employees` table.

---

## 6. Redundant FK References

### 6.1 `gpstracking.vehicle_id` and `gpstracking.driver_id`

The `gpstracking.trip_id` FK already links to `trips`, which has `vehicle_id` and `driver_id`. Both `vehicle_id` and `driver_id` on `gpstracking` are derivable through the trip join.

| Column | Reachable via |
|--------|--------------|
| `vehicle_id` | `trip_id → trips.vehicle_id` |
| `driver_id` | `trip_id → trips.driver_id` |

**However:**
- `trip_id` is nullable — GPS data can exist without an active trip
- `getLatestLocations()` in `trip.service.js:151` queries `gpstracking` directly by `vehicle_id` (no join to trips). This is a hot path (checking latest positions for active vehicles).

**Recommendation:** Keep `vehicle_id` for time-series query performance (it's queried by vehicle_id without a trip join). Drop `driver_id` — it is never queried directly from `gpstracking` in any service file. If driver-specific GPS lookups are needed, they can join through `trip_id`.

### 6.2 `dispatchschedules.vehicle_id` and `dispatchschedules.driver_id`

Reachable through `reservation_id → vehiclereservations.vehicle_id/driver_id`. However:
- `reservation_id` is nullable on dispatchschedules
- The dispatch represents a concrete assignment that may differ from reservation defaults
- Service code queries dispatches directly without joining through reservations

**Recommendation:** Keep both — this is intentional denormalization for dispatch snapshot integrity.

### 6.3 `tripperformance.driver_id`

Reachable through `trip_id → trips.driver_id`. The trip already knows which driver performed it.

**Recommendation:** Drop — the driver is always reachable from `trips.driver_id`. See §5.2 for the full merge recommendation.

---

## 7. Additional Issues

### 7.1 Polymorphic foreign keys

| Table | Columns | Issue |
|-------|---------|-------|
| `audit_logs` | `resource VARCHAR(100), resource_id INT` | No FK enforcement — can reference any table or a nonexistent row |
| `ai_recommendations` | `reference_type VARCHAR(100), reference_id INT` | Same polymorphic anti-pattern |
| `notifications` | `reference_type VARCHAR(100), reference_id INT` | Same issue |

**Recommendation:** Replace with separate nullable FK columns per resource type (e.g., `trip_id INT REFERENCES trips`, `vehicle_id INT REFERENCES vehicles`) or accept the polymorphic pattern as a pragmatic trade-off for a generic notification/audit system. Document that no referential integrity is enforced.

### 7.2 `notifications.employee_id` vs `notifications.user_id`

Two columns reference the recipient, one via employee FK and one via auth.users FK. This is confusing and redundant — one should be sufficient.

**Recommendation:** Pick one. `employee_id` is preferred (it's already Fked to employees). Drop `user_id` and adjust the `getCurrentEmployee()` lookup pattern in notification queries.

### 7.3 `trips.estimated_duration` vs `trips.actual_duration`

`estimated_duration` is an INT (minutes), while `actual_duration` is also an INT. But `actual_duration` is computed in `completeTrip()` as `Math.round((new Date() - new Date(endData.start_time)) / 60000)` and stored as INT. The column type is correct but the name `estimated_duration` vs `actual_duration` could be clearer (both are INT, right now).

**Recommendation:** Minor — rename `trips.estimated_duration` to `trips.estimated_duration_min` and `trips.actual_duration` to `trips.actual_duration_min` for clarity, or add column comments.

### 7.4 `trips.distance` re-computed in application code

In `trip.service.js:101`:
```js
const distance = endData.end_odometer - (endData.start_odometer || 0);
```
This is computed client-side and then stored. The database has `start_odometer` and `end_odometer` — `distance` is derivable from them.

**Recommendation:** Make `trips.distance` a generated column: `GENERATED ALWAYS AS (end_odometer - start_odometer) STORED`. Or keep as-is since it allows manual override.

---

## Summary of Recommended Actions

| Priority | Category | Action | Affected Tables |
|----------|----------|--------|----------------|
| **High** | Redundant columns | Drop `employees.license_number`, `employees.license_expiry` | `employees`, `drivers` |
| **High** | JSONB misuse | Restore `vehicledocuments` table from JSONB blob | `vehicles` |
| **High** | Derived data | Add triggers to sync `drivers.performance_score`, `total_trips`, `total_distance`, `total_hours`, `rating` | `drivers` |
| **High** | Redundant FKs | Drop `gpstracking.driver_id` | `gpstracking` |
| **Medium** | JSONB misuse | Consider restoring `permissions`/`role_permissions` if granular permission checks needed | `roles` |
| **Medium** | 1:1 tables | Merge `tripcostanalysis` into `trips` as nullable columns | `tripcostanalysis`, `trips` |
| **Medium** | 1:1 tables | Merge `tripperformance` into `trips` (dedup avg_speed/max_speed/idle_time) | `tripperformance`, `trips` |
| **Medium** | Redundant columns | Drop `dispatchschedules.estimated_distance`, `estimated_duration` | `dispatchschedules` |
| **Medium** | Derived data | Make `tripcostanalysis.total_cost` a generated column | `tripcostanalysis` |
| **Medium** | Derived data | Drop `fuelrecords.price_per_liter` or make generated | `fuelrecords` |
| **Low** | Same-meaning columns | Extract `locations` table; reference from `routes` and `vehiclereservations` | `routes`, `vehiclereservations`, new `locations` |
| **Low** | Redundant FKs | Drop `tripperformance.driver_id` | `tripperformance` |
| **Low** | Polymorphic FKs | Consider replacing `audit_logs.resource+resource_id` with typed FKs | `audit_logs`, `ai_recommendations`, `notifications` |
| **Low** | Redundant columns | Drop `notifications.user_id` (keep `employee_id`) | `notifications` |
| **Low** | Derived data | Make `trips.distance` a generated column | `trips` |
