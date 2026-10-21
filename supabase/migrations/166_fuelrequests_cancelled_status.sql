-- FE-06 (fuel request lifecycle): a terminal 'Cancelled' state for open
-- requests that end without a review decision —
--   * a driver withdraws a Pending/Approved request that was never fulfilled
--     (it otherwise blocks the vehicle's next request through
--     uq_fuelrequests_open_vehicle), and
--   * an open request whose trip was cancelled before review is closed.
-- Widening the CHECK is backward compatible: no existing row changes, and the
-- partial unique index already only covers Pending/Approved.
ALTER TABLE fuelrequests DROP CONSTRAINT IF EXISTS fuelrequests_status_check;

ALTER TABLE fuelrequests ADD CONSTRAINT fuelrequests_status_check CHECK (
  (status)::text = ANY ((ARRAY[
    'Pending'::character varying,
    'Approved'::character varying,
    'Rejected'::character varying,
    'Fulfilled'::character varying,
    'Cancelled'::character varying
  ])::text[])
);
