BEGIN;

-- External SCM site identifiers must resolve to a Fleet-managed, active,
-- geocoded location before a cargo route can be planned. Keep this mapping
-- private and scoped to the sandbox source organization.
CREATE TABLE IF NOT EXISTS public.supply_site_mappings (
  supply_site_mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_organization_id varchar(128) NOT NULL,
  external_site_id varchar(128) NOT NULL,
  location_id integer NOT NULL REFERENCES public.locations(location_id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  verified_by integer NOT NULL REFERENCES public.employees(employee_id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_supply_site_mapping_source_site UNIQUE (source_organization_id, external_site_id),
  CONSTRAINT chk_supply_site_mapping_sandbox CHECK (source_organization_id LIKE 'sandbox:%'),
  CONSTRAINT chk_supply_site_mapping_external_id CHECK (length(trim(external_site_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_supply_site_mappings_location
  ON public.supply_site_mappings (location_id) WHERE is_active;

ALTER TABLE public.supply_site_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.supply_site_mappings FROM anon, authenticated;

COMMIT;
