-- 030_dispatch_cancel_reason
-- Capture an operator-supplied reason when a dispatch is cancelled, so a
-- stand-down is auditable instead of a bare status flip.

ALTER TABLE dispatchschedules
  ADD COLUMN cancel_reason TEXT;

COMMENT ON COLUMN dispatchschedules.cancel_reason IS
  'Operator-supplied reason for cancelling the dispatch. NULL unless status is Cancelled.';
