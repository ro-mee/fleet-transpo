# FleetOps Schema Diagnostic Report

**Date:** 2026-07-27
**Scope:** All 6 migrations applied (001–006)
**Tables remaining:** 25

---

## 1. REDUNDANT COLUMNS

### 1a. `drivers.license_number`, `drivers.license_expiry`
- **Tables:** `employees.license_number`, `employees.license_expiry` vs. `drivers.license_number`, `drivers.license_expiry`
- **Issue:** `employees` already stores license fields. Since `drivers.employee_id` FK → `employees`, these columns are duplicated.
- **Action:** Drop `drivers.license_number`, `drivers.license_expiry`. Access via `employees` join.

### 1b. `drivers.current_latitude`, `drivers.current_longitude`, `drivers.last_location_update`
- **Issue:** Real-time driver location is also stored in `gpstracking` (per-trip GPS breadcrumbs). This denormalized copy drifts if the app fails to update it.
- **Action:** Drop these columns from `drivers`. Derive current location via `SELECT DISTINCT ON (driver_id) ... FROM gpstracking ORDER BY driver_id, recorded_at DESC`.

### 1c. `trips.estimated_distance`, `trips.estimated_duration`
- **Tables:** `routes.estimated_distance`, `routes.estimated_duration` vs. `trips.estimated_distance`, `trips.estimated_duration`
- **Issue:** `trips.route_id` → `routes`. The route's estimates are copied onto the trip row.
- **Action:** Drop `trips.estimated_distance`, `trips.estimated_duration`. Compute at query time from the joined route.

### 1d. `dispatchschedules.estimated_distance`, `dispatchschedules.estimated_duration`
- **Same issue as 1c.** `dispatchschedules.route_id` → `routes`.
- **Action:** Drop from `dispatchschedules`.

### 1e. `trips.avg_speed`, `trips.max_speed`, `trips.idle_time`
- **Table:** `tripperformance.avg_speed`, `tripperformance.max_speed`, `tripperformance.idle_time`
- **Issue:** These three columns are duplicated between `trips` and `tripperformance` (which is 1:1 with trips).
- **Action:** Drop from `trips`. Keep only in `tripperformance` (or merge that table into `trips` — see §4).

### 1f. `trips.distance` vs. computed odometer delta
- **Issue:** `trips.distance` is stored explicitly, but the service code (`trip.service.js:101`) computes `distance = end_odometer - start_odometer`. The stored column can drift from the computed value.
- **Action:** Keep as cached computed column or drop and compute on read.

### 1g. `vehicles.seating_capacity`
- **Tables:** `vehiclecategories.seating_capacity` vs. `vehicles.seating_capacity`
- **Issue:** The category defines a default capacity; the vehicle row copies it with a default of 4.
- **Action:** Keep only if vehicles genuinely have different capacity than their category. Otherwise drop and join to category.

### 1h. `vehicles.fuel_level`
- **Issue:** This is a scalar state column that represents a point-in-time measurement. It is not updated by any trigger and can only be kept current via application logic. It duplicates the data in `fuelrecords` (last known fill level).
- **Action:** Derive from latest `fuelrecords.odometer` + consumption model, or drop.

### 1i. `fuelrecords.price_per_liter`
- **Issue:** Computable as `amount / liters`. Storing it introduces a possible inconsistency.
- **Action:** Drop; compute as a generated column or on read.

---

## 2. DERIVED / AGGREGATE DATA

### 2a. `drivers.performance_score`, `drivers.total_trips`, `drivers.total_distance`, `drivers.total_hours`, `drivers.rating`
- **Tables:** `drivers` (aggregate columns) vs. `trips` + `tripperformance` + `tripcostanalysis`
- **Issue:** These are materialized aggregates that must be refreshed after every trip. The application may forget to update them, leading to stale reports.
- **Action:** Replace with a view or materialized view (`driver_aggregates`) that computes from `trips`, `tripperformance`, `tripcostanalysis`.

### 2b. `tripcostanalysis.total_cost`
- **Issue:** `fuel_cost + toll_fees + parking_fees + driver_cost + maintenance_cost + miscellaneous_cost`. Computed but stored.
- **Action:** Replace with a generated column (`GENERATED ALWAYS AS (...) STORED`) or drop.

### 2c. `tripcostanalysis.cost_per_km`
- **Issue:** `total_cost / trip.distance`. Computed but stored.
- **Action:** Drop or use generated column.

---

## 3. JSONB MISUSE

### 3a. `roles.permissions` (added in migration 005)
- **Table:** `roles.permissions JSONB DEFAULT '[]'`
- **Issue:** Replaced the normalized `role_permissions` / `permissions` tables with a JSONB array. This loses referential integrity, makes permission queries require `jsonb_array_elements`, and prevents FK enforcement.
- **Action:** **Strongly consider restoring a normalized `role_permissions` join table.** If JSONB must stay, add a CHECK constraint validating the structure and document that joins must be done in application code.

### 3b. `vehicles.documents` (added in migration 005)
- **Table:** `vehicles.documents JSONB DEFAULT '[]'`
- **Issue:** Replaced `vehicledocuments` table. Loses: FK to a document type table, per-document expiry indexing, per-document status tracking.
- **Action:** If document metadata needs querying (expiry notifications, filtering by type), restore the normalized table. Keep JSONB only if documents are purely display metadata.

### 3c. `vehiclereservations.ai_vehicle_recommendation`, `vehiclereservations.ai_driver_recommendation`
- **Table:** `vehiclereservations` (JSONB columns)
- **Issue:** These duplicate what `ai_recommendations` exists for. The AI recommendation table already supports `reference_type = 'reservation'` + `reference_id`.
- **Action:** Drop these two JSONB columns from `vehiclereservations`. Use `ai_recommendations` with a FK.

### 3d. `ai_insights.related_data`
- **Table:** `ai_insights.related_data JSONB`
- **Issue:** Generic catch-all JSONB with no schema validation. Data quality degrades over time.
- **Action:** Define a documented schema contract. Add a CHECK constraint (`jsonb_typeof(related_data) = 'object'`).

### 3e. `routes.waypoints`
- **Status:** ACCEPTABLE — waypoints are inherently schema-less geo coordinate lists. No action needed.

### 3f. `vehiclemaintenance.inspection_checklist`
- **Status:** ACCEPTABLE — checklist structure varies by maintenance type. Merged from `vehicleinspection` in m005. Valid JSONB use.

---

## 4. 1:1 TABLES (Merge Candidates)

### 4a. `tripcostanalysis` → `trips`
- **Relationship:** 1:1 with `trips` (`tripcostanalysis.trip_id` FK, no UNIQUE constraint declared but logically 1:1)
- **Columns:** `fuel_cost`, `toll_fees`, `parking_fees`, `driver_cost`, `maintenance_cost`, `miscellaneous_cost`, `total_cost` (derived), `cost_per_km` (derived)
- **Action:** Merge columns into `trips` table. Use generated columns for `total_cost` and `cost_per_km`. Drop `tripcostanalysis`.

### 4b. `tripperformance` → `trips`
- **Relationship:** 1:1 with `trips` (`tripperformance.trip_id` FK, also 1:1 logically)
- **Columns:** `on_time_completion`, `time_variance`, `fuel_efficiency`, `avg_speed`, `max_speed`, `idle_time`, `smooth_driving_score`, `customer_rating`, `notes`
- **Note:** `avg_speed`, `max_speed`, `idle_time` duplicate `trips` columns (see 1e).
- **Action:** Merge into `trips`. Drop duplicates during merge.

### 4c. `drivers` → `employees` (partial merge)
- **Relationship:** `drivers.employee_id` is effectively 1:1 (an employee is either a driver or not, but if they are, one driver record per employee)
- **Issue:** `drivers` extends `employees` with driver-specific fields. It's a subtype relationship.
- **Action:** This is a valid normalized pattern (class-table inheritance). **No merge needed**, but consider whether all employees could be drivers (eliminate the separate table) or if some truly are not. Current design with FK is fine.

---

## 5. REDUNDANT FOREIGN KEYS

### 5a. `trips.vehicle_id`, `trips.driver_id` (redundant with `dispatchschedules`)
- **Chain:** `trips.dispatch_id` → `dispatchschedules.dispatch_id` (which has `vehicle_id`, `driver_id`)
- **Issue:** Vehicle and driver are already known via the dispatch join. The trip-level FKs duplicate dispatch-level FKs.
- **Action:** Drop `trips.vehicle_id`, `trips.driver_id`. Resolve via `trips → dispatchschedules → vehicle/driver`.

### 5b. `gpstracking.vehicle_id`, `gpstracking.driver_id` (partially redundant with `trips`)
- **Issue:** When `gpstracking.trip_id` is set, `vehicle_id` and `driver_id` can be derived from the trip.
- **Note:** For time-series query performance, denormalizing these is acceptable. GPS data is append-only and joins are expensive.
- **Action:** No change needed — document as intentional denormalization for performance.

### 5c. `tripperformance.driver_id`
- **Issue:** Redundant with `trips.driver_id` (if 1e/4b merges are applied).
- **Action:** Drop if `tripperformance` is merged into `trips` (per §4b); otherwise drop the column.

### 5d. `vehiclereservations.vehicle_id`, `vehiclereservations.driver_id`
- **Issue:** Also stored in `dispatchschedules` (which references the reservation). But reservations can exist without a dispatch, so these are not strictly redundant.
- **Action:** Keep. Only redundant once a dispatch is created — acceptable design for the reservation lifecycle.

---

## 6. SUMMARY OF RECOMMENDED ACTIONS

| Priority | Table | Column(s) | Action |
|----------|-------|-----------|--------|
| HIGH | `drivers` | `license_number`, `license_expiry` | Drop |
| HIGH | `drivers` | `performance_score`, `total_trips`, `total_distance`, `total_hours`, `rating` | Move to view/MV |
| HIGH | `trips` | `estimated_distance`, `estimated_duration` | Drop |
| HIGH | `trips` | `vehicle_id`, `driver_id` | Drop (redundant w/ dispatch) |
| HIGH | `dispatchschedules` | `estimated_distance`, `estimated_duration` | Drop |
| HIGH | `tripcostanalysis` | entire table | Merge into `trips` |
| HIGH | `tripperformance` | entire table | Merge into `trips` |
| MEDIUM | `roles` | `permissions` (JSONB) | Restore normalized `role_permissions` |
| MEDIUM | `vehicles` | `documents` (JSONB) | Restore `vehicledocuments` table |
| MEDIUM | `vehiclereservations` | `ai_vehicle_recommendation`, `ai_driver_recommendation` | Drop, use `ai_recommendations` |
| MEDIUM | `tripperformance` | `driver_id` | Drop (redundant w/ trips) |
| LOW | `vehicles` | `fuel_level` | Drop or compute |
| LOW | `fuelrecords` | `price_per_liter` | Generated column |
| LOW | `tripcostanalysis` | `total_cost`, `cost_per_km` | Generated columns |
| LOW | `trips` | `avg_speed`, `max_speed`, `idle_time` | Drop (keep in performance merge) |
| LOW | `drivers` | `current_latitude`, `current_longitude`, `last_location_update` | Drop, derive from GPS |
| LOW | `ai_insights` | `related_data` | Add JSONB schema constraint |

**Total addressable issues: 16 (6 HIGH, 5 MEDIUM, 5 LOW)**
