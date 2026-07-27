# Fleet Sub-System: Entity Relationship Diagram

## Legend

```
TABLE_NAME
├── column (PK)    ← Primary Key
├── column (FK)    ← Foreign Key
└── column         ← Regular column

Relationships:
   ───<   One to Many
   ───=   One to One
```

## Core Fleet Entities

```
BRANCHES
├── branch_id (PK)
├── branch_name
├── branch_code (UK)
├── address, city, province
├── phone, email
└── status, created_at, updated_at, deleted_at
    │
    │ 1 ───< * VEHICLES
    │ 1 ───< * VEHICLERESERVATIONS
    │ 1 ───< * EMPLOYEES
    │
    ▼

VEHICLECATEGORIES
├── category_id (PK)
├── category_name
├── base_rate, per_km_rate, per_hour_rate
├── seating_capacity
└── status, created_at, updated_at, deleted_at
    │
    │ 1 ───< * VEHICLES
    │ 1 ───< * SERVICE_TYPES (default_category_id FK)
    ▼

VEHICLES
├── vehicle_id (PK)
├── category_id (FK → VEHICLECATEGORIES)
├── branch_id (FK → BRANCHES)
├── plate_number (UK)
├── vehicle_name, model, manufacturer, year
├── fuel_type, seating_capacity
├── mileage, fuel_level
├── vehicle_status
├── insurance_expiry, registration_expiry
├── last_service_date, next_service_date
├── image_url
└── created_by, updated_by, created_at, updated_at, deleted_at
    │
    │ 1 ───< * VEHICLERESERVATIONS
    │ 1 ───< * DISPATCHSCHEDULES
    │ 1 ───< * TRIPS
    │ 1 ───< * GPS_TRACKING
    │ 1 ───< * VEHICLEMAINTENANCE
    │ 1 ───< * VEHICLEINSPECTION
    │ 1 ───< * VEHICLEDOCUMENTS
    │ 1 ───< * VEHICLEASSIGNMENT
    │ 1 ───< * FUELRECORDS
    │ 1 ───< * FUELCONSUMPTION
    │ 1 ───< * FUELREQUESTS
    │ 1 ───< * FUELALLOCATIONS
    │ 1 ───< * DRIVERINCIDENTS
    ▼

ROLES
├── role_id (PK)
├── role_name (UK)
└── description
    │
    │ 1 ───< * EMPLOYEES
    │ 1 ───< * ROLE_PERMISSIONS
    ▼

PERMISSIONS
├── permission_id (PK)
├── permission_name (UK)
├── resource, action
└── description
    │
    │ 1 ───< * ROLE_PERMISSIONS
    ▼

ROLE_PERMISSIONS (Junction)
├── role_permission_id (PK)
├── role_id (FK → ROLES)
├── permission_id (FK → PERMISSIONS)
└── UNIQUE(role_id, permission_id)

EMPLOYEES
├── employee_id (PK)
├── branch_id (FK → BRANCHES)
├── role_id (FK → ROLES)
├── user_id (FK → auth.users)
├── first_name, last_name
├── email (UK), phone
├── license_number, license_expiry
├── status, avatar_url
└── created_by, updated_by, created_at, updated_at, deleted_at
    │
    │ 1 ───< * DRIVERS
    │ 1 ───< * NOTIFICATIONS
    │ 1 ───< * AUDIT_LOGS
    │ 1 ───= AUTH.USERS (via user_id)
    ▼

DRIVERS
├── driver_id (PK)
├── employee_id (FK → EMPLOYEES) (UK)
├── license_number, license_expiry
├── license_type, license_class
├── years_of_experience
├── performance_score
├── total_trips, total_distance, total_hours
├── rating
├── driver_status
├── current_latitude, current_longitude
└── created_by, updated_by, created_at, updated_at, deleted_at
    │
    │ 1 ───< * VEHICLERESERVATIONS
    │ 1 ───< * DISPATCHSCHEDULES
    │ 1 ───< * TRIPS
    │ 1 ───< * GPS_TRACKING
    │ 1 ───< * VEHICLEINSPECTION
    │ 1 ───< * VEHICLEASSIGNMENT
    │ 1 ───< * FUELRECORDS
    │ 1 ───< * FUELREQUESTS
    │ 1 ───< * DRIVERATTENDANCE
    │ 1 ───< * DRIVERINCIDENTS
    │ 1 ───< * MOBILEDEVICES
    ▼

ROUTES
├── route_id (PK)
├── route_name
├── origin, destination
├── origin_lat/lng, dest_lat/lng
├── estimated_distance, estimated_duration
├── waypoints (JSONB)
└── status, created_at, updated_at, deleted_at
    │
    │ 1 ───< * DISPATCHSCHEDULES
    │ 1 ───< * TRIPS
    ▼
```

## Reservation & Dispatch (with Integration)

```
SERVICE_TYPES          ─── NEW (Migration 004)
├── service_type_id (PK)
├── service_name
├── description
├── requires_vehicle
├── requires_driver
├── default_category_id (FK → VEHICLECATEGORIES)
├── icon, color, sort_order
└── status, created_at, updated_at, deleted_at
    │
    │ 1 ───< * VEHICLERESERVATIONS
    ▼

BOOKING_CHANNELS       ─── NEW (Migration 004)
├── channel_id (PK)
├── channel_name
├── source_system
├── description
└── status, created_at
    │
    │ 1 ───< * VEHICLERESERVATIONS
    ▼

INTEGRATION_LOG        ─── NEW (Migration 004)
├── log_id (PK)
├── direction (inbound/outbound)
├── source_system
├── event_type
├── reference_type, reference_id
├── external_booking_id
├── payload (JSONB)
├── status (pending/processed/failed/skipped)
├── error_message
└── processed_at, created_at
    │
    (No FK — references external + internal IDs as strings)
    ▼

VEHICLERESERVATIONS    ─── MODIFIED (Migration 004)
├── reservation_id (PK)
├── branch_id (FK → BRANCHES)
├── vehicle_id (FK → VEHICLES)
├── driver_id (FK → DRIVERS)
├── service_type_id (FK → SERVICE_TYPES)       ← NEW
├── booking_channel_id (FK → BOOKING_CHANNELS)  ← NEW
├── external_booking_id (VARCHAR)               ← NEW
├── integration_source (VARCHAR)                ← NEW
├── guest_id (VARCHAR)                          ← NEW
├── room_number (VARCHAR)                       ← NEW
├── bill_to_room (BOOLEAN)                      ← NEW
├── cancellation_reason (TEXT)                  ← NEW
├── guest_name, guest_phone, guest_email       (cached from parent)
├── pickup_location, dropoff_location
├── pickup_lat/lng, dropoff_lat/lng
├── reservation_date, pickup_time
├── estimated_return_time
├── purpose, passenger_count
├── status (Pending/Approved/Rejected/Cancelled/Completed)
├── ai_vehicle_recommendation (JSONB)
├── ai_driver_recommendation (JSONB)
└── created_by, updated_by, created_at, updated_at, deleted_at
    │
    │ 1 ───< * DISPATCHSCHEDULES
    ▼

DISPATCHSCHEDULES
├── dispatch_id (PK)
├── reservation_id (FK → VEHICLERESERVATIONS)
├── vehicle_id (FK → VEHICLES)
├── driver_id (FK → DRIVERS)
├── route_id (FK → ROUTES)
├── dispatch_number (UK) — auto-generated
├── scheduled_departure, scheduled_arrival
├── actual_departure, actual_arrival
├── estimated_distance, estimated_duration
├── status, priority
└── created_by, updated_by, created_at, updated_at, deleted_at
    │
    │ 1 ───< * TRIPS
    ▼
```

## Operational Entities

```
TRIPS
├── trip_id (PK)
├── vehicle_id (FK → VEHICLES)
├── driver_id (FK → DRIVERS)
├── dispatch_id (FK → DISPATCHSCHEDULES)
├── route_id (FK → ROUTES)
├── start_time, end_time
├── distance, estimated_distance
├── estimated_duration, actual_duration
├── trip_status
├── start_odometer, end_odometer
├── fuel_consumed, avg_speed, max_speed
├── idle_time
├── route_data (JSONB)
└── created_by, updated_by, created_at, updated_at, deleted_at
    │
    │ 1 ───< * GPS_TRACKING
    │ 1 ───< * FUELRECORDS
    │ 1 ───< * FUELCONSUMPTION
    │ 1 ───< * TRIPCOSTANALYSIS
    │ 1 ───< * TRIPPERFORMANCE
    │ 1 ───< * DRIVERINCIDENTS
    ▼

GPS_TRACKING
├── tracking_id (PK, BIGSERIAL)
├── vehicle_id (FK → VEHICLES)
├── trip_id (FK → TRIPS)
├── driver_id (FK → DRIVERS)
├── latitude, longitude
├── speed, heading, altitude, accuracy
└── recorded_at

VEHICLEMAINTENANCE
├── maintenance_id (PK)
├── vehicle_id (FK → VEHICLES)
├── maintenance_type
├── description, maintenance_date, completed_date
├── cost, mileage_at_service
├── service_provider, service_center
├── next_schedule_date, next_schedule_mileage
├── status, priority
├── is_recurring, recurring_interval_days, recurring_interval_km
└── created_by, updated_by, created_at, updated_at, deleted_at

FUELRECORDS          FUELSTATIONS
├── fuel_record_id   ├── station_id
├── vehicle_id (FK)  ├── station_name
├── driver_id (FK)   ├── address, lat/lng
├── station_id (FK)──┼── phone
├── trip_id (FK)     ├── fuel_types_available (JSONB)
├── liters, amount   └── status
├── price_per_liter
├── odometer, fuel_type
├── fuel_date, receipt_url
└── status
```

## Integration Boundary Summary

```
┌──────────────────────────────────────────────────┐
│              PARENT SYSTEM (PMS/POS)              │
│                                                   │
│  guests │ rooms │ bookings │ billing / charges    │
│                                                   │
│  External Reference: "booking_id = PMS-12345"     │
└────────────────────┬─────────────────────────────┘
                     │
                     │ Integration via:
                     │ - service_types (what service)
                     │ - booking_channels (where booked)
                     │ - external_booking_id (link)
                     │ - integration_log (audit)
                     │
┌────────────────────▼─────────────────────────────┐
│              FLEET SUB-SYSTEM                     │
│                                                   │
│  vehicles │ drivers │ routes │ dispatch           │
│  reservations │ trips │ gps_tracking              │
│  maintenance │ fuel │ incidents │ attendance       │
│                                                   │
│  Owns: All fleet data, including the              │
│  integration layer to bridge with parent system   │
└──────────────────────────────────────────────────┘
```