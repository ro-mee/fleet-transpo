BEGIN;

-- A supply allocation connects one approved manifest revision to the shared
-- Fleet dispatch slot. The relation stays private and preserves released
-- assignments as history; it does not itself create dispatches or trips.
CREATE TABLE IF NOT EXISTS public.supply_dispatch_allocations (
  supply_dispatch_allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_shipment_id uuid NOT NULL,
  dispatch_id integer NOT NULL,
  manifest_revision integer NOT NULL CHECK (manifest_revision > 0),
  allocation_status varchar(16) NOT NULL DEFAULT 'ASSIGNED'
    CHECK (allocation_status IN ('ASSIGNED', 'RELEASED', 'CANCELLED', 'CLOSED')),
  allocated_by integer NOT NULL REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  ended_by integer REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  ended_at timestamptz,
  end_reason varchar(500),
  CONSTRAINT fk_supply_allocation_shipment
    FOREIGN KEY (supply_shipment_id)
    REFERENCES public.supply_shipments(supply_shipment_id) ON DELETE RESTRICT,
  CONSTRAINT fk_supply_allocation_dispatch
    FOREIGN KEY (dispatch_id)
    REFERENCES public.dispatchschedules(dispatch_id) ON DELETE RESTRICT,
  CONSTRAINT fk_supply_allocation_manifest_revision
    FOREIGN KEY (supply_shipment_id, manifest_revision)
    REFERENCES public.supply_manifest_revisions(supply_shipment_id, manifest_revision) ON DELETE RESTRICT,
  CONSTRAINT uq_supply_allocation_dispatch UNIQUE (dispatch_id),
  CONSTRAINT chk_supply_allocation_end_state CHECK (
    (allocation_status = 'ASSIGNED' AND ended_by IS NULL AND ended_at IS NULL AND end_reason IS NULL)
    OR
    (allocation_status IN ('RELEASED', 'CANCELLED', 'CLOSED') AND ended_at IS NOT NULL AND length(btrim(end_reason)) > 0)
  )
);

-- P0 is one shipment on one dispatch. Released history remains, while only
-- one current assignment can exist for a shipment at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supply_allocation_assigned_shipment
  ON public.supply_dispatch_allocations (supply_shipment_id)
  WHERE allocation_status = 'ASSIGNED';
CREATE INDEX IF NOT EXISTS idx_supply_allocation_manifest
  ON public.supply_dispatch_allocations (supply_shipment_id, manifest_revision);

ALTER TABLE public.supply_dispatch_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.supply_dispatch_allocations FROM anon, authenticated;

COMMENT ON TABLE public.supply_dispatch_allocations IS
  'Private bridge from a supply shipment manifest revision to one shared Fleet dispatch. Does not represent inventory receipt.';
COMMENT ON COLUMN public.supply_dispatch_allocations.allocation_status IS
  'ASSIGNED links the current shipment plan to a dispatch; released/cancelled/closed rows preserve history. Trip completion alone does not close goods receipt.';

CREATE OR REPLACE FUNCTION public.assert_supply_dispatch_allocation(p_dispatch_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_service_type varchar(32);
  v_request_id integer;
  v_has_allocation boolean;
  v_has_stale_assignment boolean;
BEGIN
  SELECT d.service_type, d.request_id
    INTO v_service_type, v_request_id
    FROM public.dispatchschedules AS d
   WHERE d.dispatch_id = p_dispatch_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.supply_dispatch_allocations AS a
     WHERE a.dispatch_id = p_dispatch_id
  ) INTO v_has_allocation;

  SELECT EXISTS (
    SELECT 1
      FROM public.supply_dispatch_allocations AS a
      JOIN public.supply_shipments AS s
        ON s.supply_shipment_id = a.supply_shipment_id
     WHERE a.dispatch_id = p_dispatch_id
       AND a.allocation_status = 'ASSIGNED'
       AND a.manifest_revision <> s.current_manifest_revision
  ) INTO v_has_stale_assignment;

  IF v_service_type = 'SUPPLY_DELIVERY' THEN
    IF v_request_id IS NOT NULL THEN
      RAISE EXCEPTION 'Supply dispatch % cannot reference a passenger request', p_dispatch_id
        USING ERRCODE = '23514';
    END IF;
    IF NOT v_has_allocation THEN
      RAISE EXCEPTION 'Supply dispatch % requires a shipment allocation in the same transaction', p_dispatch_id
        USING ERRCODE = '23514';
    END IF;
    IF v_has_stale_assignment THEN
      RAISE EXCEPTION 'Supply dispatch % has an allocation for a stale manifest revision', p_dispatch_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF v_has_allocation THEN
    RAISE EXCEPTION 'Dispatch % cannot have a supply allocation unless service_type is SUPPLY_DELIVERY', p_dispatch_id
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_supply_dispatch_allocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_dispatch_id integer;
BEGIN
  IF TG_TABLE_NAME = 'supply_shipments' THEN
    FOR v_dispatch_id IN
      SELECT a.dispatch_id
        FROM public.supply_dispatch_allocations AS a
       WHERE a.supply_shipment_id = NEW.supply_shipment_id
         AND a.allocation_status = 'ASSIGNED'
    LOOP
      PERFORM public.assert_supply_dispatch_allocation(v_dispatch_id);
    END LOOP;
  ELSIF TG_TABLE_NAME = 'dispatchschedules' THEN
    PERFORM public.assert_supply_dispatch_allocation(NEW.dispatch_id);
    IF TG_OP = 'UPDATE' AND OLD.dispatch_id IS DISTINCT FROM NEW.dispatch_id THEN
      PERFORM public.assert_supply_dispatch_allocation(OLD.dispatch_id);
    END IF;
  ELSE
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      PERFORM public.assert_supply_dispatch_allocation(OLD.dispatch_id);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE')
       AND (TG_OP = 'INSERT' OR OLD.dispatch_id IS DISTINCT FROM NEW.dispatch_id) THEN
      PERFORM public.assert_supply_dispatch_allocation(NEW.dispatch_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_supply_dispatch_allocation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.supply_shipment_id IS DISTINCT FROM OLD.supply_shipment_id
     OR NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
     OR NEW.manifest_revision IS DISTINCT FROM OLD.manifest_revision
     OR NEW.allocated_by IS DISTINCT FROM OLD.allocated_by
     OR NEW.allocated_at IS DISTINCT FROM OLD.allocated_at THEN
    RAISE EXCEPTION 'Supply allocation identity is immutable; create a new allocation to reassign'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.allocation_status <> 'ASSIGNED'
     OR NEW.allocation_status NOT IN ('ASSIGNED', 'RELEASED', 'CANCELLED', 'CLOSED') THEN
    RAISE EXCEPTION 'A terminal supply allocation cannot be changed'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supply_allocation_identity_guard ON public.supply_dispatch_allocations;
CREATE TRIGGER supply_allocation_identity_guard
  BEFORE UPDATE ON public.supply_dispatch_allocations
  FOR EACH ROW EXECUTE FUNCTION public.guard_supply_dispatch_allocation_update();

DROP TRIGGER IF EXISTS supply_dispatch_allocation_consistency ON public.dispatchschedules;
CREATE CONSTRAINT TRIGGER supply_dispatch_allocation_consistency
  AFTER INSERT OR UPDATE ON public.dispatchschedules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_supply_dispatch_allocation();

DROP TRIGGER IF EXISTS supply_allocation_dispatch_consistency ON public.supply_dispatch_allocations;
CREATE CONSTRAINT TRIGGER supply_allocation_dispatch_consistency
  AFTER INSERT OR UPDATE OR DELETE ON public.supply_dispatch_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_supply_dispatch_allocation();

DROP TRIGGER IF EXISTS supply_manifest_revision_allocation_consistency ON public.supply_shipments;
CREATE CONSTRAINT TRIGGER supply_manifest_revision_allocation_consistency
  AFTER UPDATE ON public.supply_shipments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_supply_dispatch_allocation();

-- The invariant functions are trigger-only, not callable RPC endpoints.
REVOKE ALL PRIVILEGES ON FUNCTION public.assert_supply_dispatch_allocation(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.enforce_supply_dispatch_allocation() FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_supply_dispatch_allocation_update() FROM PUBLIC, anon, authenticated;

COMMIT;
