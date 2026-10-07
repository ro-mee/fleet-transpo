BEGIN;

-- Supply delivery snapshots stay separate from passenger bookings and from
-- inventory ownership. The API only stores an approved transport snapshot;
-- it does not write stock balances.
CREATE TABLE IF NOT EXISTS public.vehicle_cargo_profiles (
  vehicle_id integer PRIMARY KEY REFERENCES public.vehicles(vehicle_id) ON DELETE CASCADE,
  supports_supply_delivery boolean NOT NULL DEFAULT false,
  rated_payload_kg numeric(12,3),
  gross_vehicle_weight_limit_kg numeric(12,3),
  operating_mass_kg numeric(12,3),
  operational_reserve_kg numeric(12,3),
  usable_volume_m3 numeric(12,6),
  compartment_length_m numeric(10,4),
  compartment_width_m numeric(10,4),
  compartment_height_m numeric(10,4),
  opening_length_m numeric(10,4),
  opening_width_m numeric(10,4),
  opening_height_m numeric(10,4),
  temperature_min_c numeric(5,2),
  temperature_max_c numeric(5,2),
  handling_capabilities text[] NOT NULL DEFAULT '{}',
  verification_reference varchar(255),
  verification_valid_until date,
  verified_at timestamptz,
  verified_by integer REFERENCES public.employees(employee_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_vehicle_cargo_positive_measurements CHECK (
    (rated_payload_kg IS NULL OR rated_payload_kg > 0) AND
    (gross_vehicle_weight_limit_kg IS NULL OR gross_vehicle_weight_limit_kg > 0) AND
    (operating_mass_kg IS NULL OR operating_mass_kg > 0) AND
    (operational_reserve_kg IS NULL OR operational_reserve_kg >= 0) AND
    (gross_vehicle_weight_limit_kg IS NULL OR operating_mass_kg IS NULL OR gross_vehicle_weight_limit_kg > operating_mass_kg) AND
    (usable_volume_m3 IS NULL OR usable_volume_m3 > 0) AND
    (compartment_length_m IS NULL OR compartment_length_m > 0) AND
    (compartment_width_m IS NULL OR compartment_width_m > 0) AND
    (compartment_height_m IS NULL OR compartment_height_m > 0) AND
    (opening_length_m IS NULL OR opening_length_m > 0) AND
    (opening_width_m IS NULL OR opening_width_m > 0) AND
    (opening_height_m IS NULL OR opening_height_m > 0)
  ),
  CONSTRAINT chk_vehicle_cargo_temperature CHECK (
    temperature_min_c IS NULL OR temperature_max_c IS NULL OR temperature_min_c <= temperature_max_c
  ),
  CONSTRAINT chk_vehicle_cargo_enabled_is_verified CHECK (
    NOT supports_supply_delivery OR (
      rated_payload_kg IS NOT NULL AND gross_vehicle_weight_limit_kg IS NOT NULL AND
      operating_mass_kg IS NOT NULL AND operational_reserve_kg IS NOT NULL AND usable_volume_m3 IS NOT NULL AND
      compartment_length_m IS NOT NULL AND compartment_width_m IS NOT NULL AND compartment_height_m IS NOT NULL AND
      opening_length_m IS NOT NULL AND opening_width_m IS NOT NULL AND opening_height_m IS NOT NULL AND
      verification_reference IS NOT NULL AND verification_valid_until IS NOT NULL AND
      verified_at IS NOT NULL AND verified_by IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.supply_shipments (
  supply_shipment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_organization_id varchar(128) NOT NULL,
  external_request_id varchar(128) NOT NULL,
  external_approver_ref varchar(128) NOT NULL,
  current_manifest_revision integer NOT NULL CHECK (current_manifest_revision > 0),
  status varchar(32) NOT NULL CHECK (status IN (
    'INGESTED', 'WAITING_FOR_PICKUP', 'READY_FOR_PLANNING', 'BLOCKED', 'ALLOCATED',
    'LOADING', 'LOADED', 'IN_TRANSIT', 'ARRIVED', 'AWAITING_RECEIPT',
    'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCEL_REQUESTED', 'CANCELLED',
    'DELIVERY_EXCEPTION', 'CLOSED_WITH_EXCEPTION'
  )),
  pickup_snapshot jsonb NOT NULL,
  delivery_snapshot jsonb NOT NULL,
  requested_timezone varchar(64) NOT NULL,
  delivery_window_start timestamptz NOT NULL,
  delivery_window_end timestamptz NOT NULL,
  source_sequence bigint NOT NULL CHECK (source_sequence > 0),
  source_correlation_id varchar(255) NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_supply_shipment_source_request UNIQUE (source_organization_id, external_request_id),
  CONSTRAINT chk_supply_shipment_delivery_window CHECK (delivery_window_start < delivery_window_end)
);

CREATE TABLE IF NOT EXISTS public.supply_manifest_revisions (
  supply_manifest_revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_shipment_id uuid NOT NULL REFERENCES public.supply_shipments(supply_shipment_id) ON DELETE RESTRICT,
  manifest_revision integer NOT NULL CHECK (manifest_revision > 0),
  schema_version varchar(16) NOT NULL,
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  manifest_snapshot jsonb NOT NULL,
  source_event_id varchar(255) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_supply_manifest_revision UNIQUE (supply_shipment_id, manifest_revision)
);

CREATE TABLE IF NOT EXISTS public.supply_integration_inbox (
  supply_inbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_organization_id varchar(128) NOT NULL,
  external_request_id varchar(128) NOT NULL,
  source_event_id varchar(255) NOT NULL,
  event_type varchar(64) NOT NULL CHECK (event_type IN ('TransportRequestApproved', 'ManifestUpdated')),
  source_sequence bigint NOT NULL CHECK (source_sequence > 0),
  correlation_id varchar(255) NOT NULL,
  schema_version varchar(16) NOT NULL,
  event_hash char(64) NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  processing_status varchar(16) NOT NULL CHECK (processing_status IN ('ACCEPTED', 'REJECTED')),
  response_snapshot jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_supply_inbox_event UNIQUE (source_organization_id, source_event_id),
  CONSTRAINT uq_supply_inbox_sequence UNIQUE (source_organization_id, external_request_id, source_sequence)
);

CREATE TABLE IF NOT EXISTS public.supply_shipment_events (
  supply_shipment_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_shipment_id uuid NOT NULL REFERENCES public.supply_shipments(supply_shipment_id) ON DELETE RESTRICT,
  event_type varchar(64) NOT NULL,
  manifest_revision integer,
  source_event_id varchar(255),
  correlation_id varchar(255),
  actor_type varchar(32) NOT NULL CHECK (actor_type IN ('SCM_SANDBOX', 'FLEET_EMPLOYEE', 'DRIVER', 'RECEIVER')),
  actor_ref varchar(255),
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supply_shipment_source_event
  ON public.supply_shipment_events (supply_shipment_id, source_event_id)
  WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supply_shipments_status_window
  ON public.supply_shipments (status, delivery_window_start);
CREATE INDEX IF NOT EXISTS idx_supply_manifest_revisions_shipment
  ON public.supply_manifest_revisions (supply_shipment_id, manifest_revision DESC);
CREATE INDEX IF NOT EXISTS idx_supply_inbox_received
  ON public.supply_integration_inbox (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_supply_shipment_events_timeline
  ON public.supply_shipment_events (supply_shipment_id, recorded_at, supply_shipment_event_id);

ALTER TABLE public.vehicle_cargo_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_manifest_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_integration_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supply_shipment_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.vehicle_cargo_profiles FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.supply_shipments FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.supply_manifest_revisions FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.supply_integration_inbox FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.supply_shipment_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_supply_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable; record a new revision or event instead', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS supply_manifest_revisions_immutable ON public.supply_manifest_revisions;
CREATE TRIGGER supply_manifest_revisions_immutable
  BEFORE UPDATE OR DELETE ON public.supply_manifest_revisions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supply_history_mutation();

DROP TRIGGER IF EXISTS supply_shipment_events_immutable ON public.supply_shipment_events;
CREATE TRIGGER supply_shipment_events_immutable
  BEFORE UPDATE OR DELETE ON public.supply_shipment_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_supply_history_mutation();

COMMIT;
