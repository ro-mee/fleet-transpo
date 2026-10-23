-- Independent configured service cycles. No manufacturer intervals or mileage history are invented.
CREATE TABLE IF NOT EXISTS public.vehicle_service_plans (
 plan_id serial PRIMARY KEY,
 vehicle_id integer NOT NULL REFERENCES public.vehicles(vehicle_id),
 service_code varchar(20) NOT NULL CHECK (service_code IN ('routine','brakes','tires')),
 interval_days integer CHECK (interval_days > 0),
 interval_km numeric(12,2) CHECK (interval_km > 0),
 last_service_date date,
 last_service_mileage numeric(12,2) CHECK (last_service_mileage >= 0),
 next_service_date date,
 next_service_mileage numeric(12,2) CHECK (next_service_mileage >= 0),
 deferred_until date,
 defer_reason text,
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_at timestamptz NOT NULL DEFAULT NOW(),
 updated_at timestamptz NOT NULL DEFAULT NOW(),
 created_by integer REFERENCES public.employees(employee_id),
 updated_by integer REFERENCES public.employees(employee_id),
 CONSTRAINT vehicle_service_plans_vehicle_code_key UNIQUE(vehicle_id,service_code),
 CONSTRAINT vehicle_service_plans_plan_vehicle_key UNIQUE(plan_id,vehicle_id),
 CONSTRAINT vehicle_service_plans_configured CHECK(interval_days IS NOT NULL OR interval_km IS NOT NULL OR next_service_date IS NOT NULL OR next_service_mileage IS NOT NULL),
 CONSTRAINT vehicle_service_plans_deferral CHECK(deferred_until IS NULL OR NULLIF(BTRIM(defer_reason),'') IS NOT NULL)
);
ALTER TABLE public.vehicle_service_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.vehicle_service_plans FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.vehicle_service_plans_plan_id_seq FROM PUBLIC, anon, authenticated;

ALTER TABLE public.vehiclemaintenance ADD COLUMN IF NOT EXISTS service_plan_id integer;
ALTER TABLE public.vehiclemaintenance ADD COLUMN IF NOT EXISTS service_plan_version integer;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.vehiclemaintenance'::regclass AND conname='vehiclemaintenance_service_plan_vehicle_fk') THEN
  ALTER TABLE public.vehiclemaintenance ADD CONSTRAINT vehiclemaintenance_service_plan_vehicle_fk FOREIGN KEY(service_plan_id,vehicle_id) REFERENCES public.vehicle_service_plans(plan_id,vehicle_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.vehiclemaintenance'::regclass AND conname='vehiclemaintenance_service_plan_pair') THEN
  ALTER TABLE public.vehiclemaintenance ADD CONSTRAINT vehiclemaintenance_service_plan_pair CHECK(
   (service_plan_id IS NULL AND service_plan_version IS NULL) OR
   (service_plan_id IS NOT NULL AND vehicle_id IS NOT NULL AND service_plan_version IS NOT NULL AND service_plan_version > 0));
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS vehiclemaintenance_active_service_plan_key ON public.vehiclemaintenance(service_plan_id)
 WHERE service_plan_id IS NOT NULL AND deleted_at IS NULL AND status IN ('Scheduled','In Progress','Pending Inspection');

INSERT INTO public.vehicle_service_plans(vehicle_id,service_code,interval_days,interval_km,last_service_date,next_service_date,next_service_mileage)
 SELECT vehicle_id,'routine',CASE WHEN service_interval_days > 0 THEN service_interval_days END,
 CASE WHEN service_interval_km > 0 THEN service_interval_km END,last_service_date,next_service_date,
 CASE WHEN next_service_mileage >= 0 THEN next_service_mileage END
 FROM public.vehicles WHERE deleted_at IS NULL AND
 (service_interval_days > 0 OR service_interval_km > 0 OR next_service_date IS NOT NULL OR next_service_mileage >= 0)
 ON CONFLICT(vehicle_id,service_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.vehicle_odometer_observations (
 observation_id serial PRIMARY KEY,
 vehicle_id integer NOT NULL REFERENCES public.vehicles(vehicle_id),
 reading_km numeric(12,2) NOT NULL CHECK(reading_km >= 0 AND reading_km <= 2000000),
 observed_at timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_by integer NOT NULL REFERENCES public.employees(employee_id),
 reason text NOT NULL CHECK(NULLIF(BTRIM(reason),'') IS NOT NULL AND LENGTH(reason) <= 1000),
 CONSTRAINT vehicle_odometer_observations_no_future CHECK(observed_at <= recorded_at)
);
CREATE INDEX IF NOT EXISTS vehicle_odometer_observations_vehicle_time ON public.vehicle_odometer_observations(vehicle_id,observed_at DESC,observation_id DESC);
ALTER TABLE public.vehicle_odometer_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.vehicle_odometer_observations FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.vehicle_odometer_observations_observation_id_seq FROM PUBLIC, anon, authenticated;
