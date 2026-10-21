ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS odometer_capture_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.trip_odometer_captures (
  capture_id uuid PRIMARY KEY,
  trip_id integer NOT NULL REFERENCES public.trips(trip_id),
  driver_id integer NOT NULL REFERENCES public.drivers(driver_id),
  vehicle_id integer NOT NULL REFERENCES public.vehicles(vehicle_id),
  stage text NOT NULL CHECK (stage IN ('start', 'end')),
  storage_key text NOT NULL UNIQUE,
  image_sha256 text NOT NULL CHECK (image_sha256 ~ '^[0-9a-f]{64}$'),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  state text NOT NULL DEFAULT 'uploaded'
    CHECK (state IN ('uploaded', 'scanning', 'ready', 'unreadable', 'failed', 'committed')),
  reading_text text,
  reading_km numeric(12,2) CHECK (reading_km > 0 AND reading_km <= 2000000),
  unit text CHECK (unit IN ('km', 'mi', 'unknown')),
  display_kind text CHECK (display_kind IN ('total', 'trip', 'unclear')),
  failure_code text,
  model_name text,
  scan_version text,
  scan_attempts integer NOT NULL DEFAULT 0 CHECK (scan_attempts BETWEEN 0 AND 3),
  scan_started_at timestamptz,
  uploaded_at timestamptz NOT NULL DEFAULT NOW(),
  scanned_at timestamptz,
  committed_at timestamptz,
  CHECK (state NOT IN ('ready', 'committed') OR
    ((reading_km IS NOT NULL AND unit = 'km' AND display_kind = 'total' AND scanned_at IS NOT NULL) IS TRUE)),
  CHECK ((state = 'committed') = (committed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS trip_odometer_one_committed_stage
  ON public.trip_odometer_captures (trip_id, stage) WHERE committed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS trip_odometer_owner_lookup
  ON public.trip_odometer_captures (driver_id, trip_id, stage, uploaded_at DESC);
ALTER TABLE public.trip_odometer_captures ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.trip_odometer_captures FROM anon, authenticated;

-- Server-only evidence storage; reconcile pre-existing bucket settings as well.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('trip-odometer-photos', 'trip-odometer-photos', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
