BEGIN;

-- SQL CHECK constraints accept UNKNOWN. Make the terminal allocation branch
-- explicitly reject a NULL end_reason instead of relying on btrim(NULL).
ALTER TABLE public.supply_dispatch_allocations
  DROP CONSTRAINT IF EXISTS chk_supply_allocation_end_state;

ALTER TABLE public.supply_dispatch_allocations
  ADD CONSTRAINT chk_supply_allocation_end_state CHECK (
    (allocation_status = 'ASSIGNED' AND ended_by IS NULL AND ended_at IS NULL AND end_reason IS NULL)
    OR
    (
      allocation_status IN ('RELEASED', 'CANCELLED', 'CLOSED')
      AND ended_at IS NOT NULL
      AND end_reason IS NOT NULL
      AND length(btrim(end_reason)) > 0
    )
  );

COMMIT;
