import { driverTypeFinding } from "./service-groups";

// Static classification gate for direct trip writes (POST /api/trips,
// PUT /api/trips/[id], mobile accept). Dispatch create/edit and trip start
// already funnel through validatePairAvailability; these three paths write
// trips directly, so they check here instead.
//
// Resolution is authoritative, never caller-supplied: the service comes from
// the stored dispatch -> request -> service_types chain, and the driver type
// from the stored drivers row. Unknown service (no dispatch, unlinked
// request, legacy/custom code with no group) or unknown driver skips —
// absence of data must not brick a write; FK/validation owns those cases.
export async function tripDriverTypeMismatch(db, { driverId, dispatchId }) {
  if (driverId == null || dispatchId == null) return null;
  const query = db?.query?.bind(db) ?? null;
  if (!query) return null;
  const { rows: dRows } = await query(
    `SELECT driver_id, driver_type FROM drivers WHERE driver_id = $1 AND deleted_at IS NULL`,
    [driverId]
  );
  const driver = dRows[0] ?? null;
  if (!driver) return null;
  const { rows: sRows } = await query(
    `SELECT st.service_code
       FROM dispatchschedules ds
       JOIN transportation_requests r ON r.request_id = ds.request_id AND r.deleted_at IS NULL
       LEFT JOIN service_types st ON st.service_type_id = r.service_type_id AND st.deleted_at IS NULL
      WHERE ds.dispatch_id = $1`,
    [dispatchId]
  );
  const serviceCode = sRows[0]?.service_code ?? null;
  if (!serviceCode) return null;
  return driverTypeFinding({ driver, serviceCode });
}
