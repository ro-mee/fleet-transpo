-- Routes integrity and lifecycle metadata.
-- Existing rows are repaired from their referenced location/request data; no
-- route or dispatch/trip history is deleted.

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz;

ALTER TABLE routes
  ADD COLUMN IF NOT EXISTS estimate_source varchar(30),
  ADD COLUMN IF NOT EXISTS estimate_updated_at timestamptz;

-- Reconnect legacy text-only routes to the canonical location records. Only
-- unambiguous normalized-name matches are eligible for the backfill.
WITH location_keys AS (
  SELECT
    location_id,
    lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) AS location_key,
    count(*) OVER (PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))) AS key_count
  FROM locations
)
UPDATE routes r
SET origin_location_id = lk.location_id
FROM location_keys lk
WHERE r.origin_location_id IS NULL
  AND lk.key_count = 1
  AND lower(regexp_replace(trim(r.origin), '\\s+', ' ', 'g')) = lk.location_key;

WITH location_keys AS (
  SELECT
    location_id,
    lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) AS location_key,
    count(*) OVER (PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))) AS key_count
  FROM locations
)
UPDATE routes r
SET destination_location_id = lk.location_id
FROM location_keys lk
WHERE r.destination_location_id IS NULL
  AND lk.key_count = 1
  AND lower(regexp_replace(trim(r.destination), '\\s+', ' ', 'g')) = lk.location_key;

-- Route names communicate direction explicitly. The endpoint columns remain
-- the source of truth for matching and navigation.
UPDATE routes
SET route_name = regexp_replace(route_name, '\\s*↔\\s*', ' → ', 'g'),
    updated_at = NOW()
WHERE route_name LIKE '%↔%';

-- Route 6 (and any future text-only route with dispatch history) inherits only
-- the estimates already recorded on its real transportation requests. A route
-- without usable request measurements stays blank and is marked unknown.
WITH request_estimates AS (
  SELECT
    d.route_id,
    avg(tr.estimated_distance) AS avg_distance,
    avg(tr.estimated_duration) AS avg_duration
  FROM dispatchschedules d
  JOIN transportation_requests tr ON tr.request_id = d.request_id
  WHERE d.route_id IS NOT NULL
    AND tr.estimated_distance > 0
    AND tr.estimated_duration > 0
  GROUP BY d.route_id
)
UPDATE routes r
SET estimated_distance = COALESCE(r.estimated_distance, round(e.avg_distance, 2)),
    estimated_duration = COALESCE(r.estimated_duration, round(e.avg_duration)::integer),
    estimate_source = COALESCE(r.estimate_source, 'Legacy / Unknown'),
    estimate_updated_at = COALESCE(r.estimate_updated_at, NOW()),
    updated_at = NOW()
FROM request_estimates e
WHERE r.route_id = e.route_id
  AND (r.estimated_distance IS NULL OR r.estimated_duration IS NULL);

UPDATE routes
SET estimate_source = 'Legacy / Unknown'
WHERE estimate_source IS NULL
  AND (estimated_distance IS NOT NULL OR estimated_duration IS NOT NULL);

-- Keep historical records, but leave one active reusable route per canonical
-- direction so a replacement can be created only after the old route is
-- deactivated.
WITH ranked AS (
  SELECT
    route_id,
    row_number() OVER (
      PARTITION BY origin_location_id, destination_location_id
      ORDER BY route_id
    ) AS route_rank
  FROM routes
  WHERE status = 'Active'
    AND deleted_at IS NULL
    AND origin_location_id IS NOT NULL
    AND destination_location_id IS NOT NULL
)
UPDATE routes r
SET status = 'Inactive', updated_at = NOW()
FROM ranked x
WHERE r.route_id = x.route_id
  AND x.route_rank > 1;

DROP INDEX IF EXISTS idx_routes_origin_location;
DROP INDEX IF EXISTS idx_routes_destination_location;

CREATE INDEX IF NOT EXISTS idx_locations_active_name
  ON locations (is_active, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_routes_active_direction
  ON routes (origin_location_id, destination_location_id)
  WHERE status = 'Active'
    AND deleted_at IS NULL
    AND origin_location_id IS NOT NULL
    AND destination_location_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'routes_status_check'
  ) THEN
    ALTER TABLE routes
      ADD CONSTRAINT routes_status_check
      CHECK (status IN ('Active', 'Inactive')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'routes_estimate_source_check'
  ) THEN
    ALTER TABLE routes
      ADD CONSTRAINT routes_estimate_source_check
      CHECK (estimate_source IS NULL OR estimate_source IN ('TomTom', 'Manual', 'Legacy / Unknown')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'routes_positive_estimates_check'
  ) THEN
    ALTER TABLE routes
      ADD CONSTRAINT routes_positive_estimates_check
      CHECK (
        (estimated_distance IS NULL OR estimated_distance > 0)
        AND (estimated_duration IS NULL OR estimated_duration > 0)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'routes_endpoint_pair_check'
  ) THEN
    ALTER TABLE routes
      ADD CONSTRAINT routes_endpoint_pair_check
      CHECK (
        (origin_location_id IS NULL AND destination_location_id IS NULL)
        OR (origin_location_id IS NOT NULL AND destination_location_id IS NOT NULL AND origin_location_id <> destination_location_id)
      ) NOT VALID;
  END IF;
END $$;
