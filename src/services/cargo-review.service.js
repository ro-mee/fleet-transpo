import { query } from '@/lib/db';

const STAGES = new Set(['all', 'unassigned', 'pickup', 'delivery', 'completed']);
const QUEUE = `WITH queue AS (
  SELECT r.request_id,r.reservation_number,r.pickup_datetime,r.pickup_location,r.dropoff_location,
    r.fleet_status,r.cargo_description,ds.dispatch_id,ds.dispatch_number,t.trip_id,t.trip_status,
    v.plate_number,v.vehicle_name,concat_ws(' ',e.first_name,e.last_name) AS driver_name,
    CASE WHEN t.trip_status='Completed' THEN 'completed'
      WHEN t.trip_id IS NULL THEN 'unassigned'
      WHEN delivery.receipt_id IS NOT NULL THEN 'delivery' ELSE 'pickup' END AS stage,
    pickup.receipt_id IS NOT NULL AS pickup_recorded,delivery.receipt_id IS NOT NULL AS delivery_recorded
  FROM transportation_requests r
  LEFT JOIN LATERAL (SELECT dispatch_id,dispatch_number,driver_id,vehicle_id FROM dispatchschedules
    WHERE request_id=r.request_id AND deleted_at IS NULL AND status<>'Cancelled'
    ORDER BY dispatch_id DESC LIMIT 1) ds ON TRUE
  LEFT JOIN LATERAL (SELECT trip_id,trip_status FROM trips WHERE dispatch_id=ds.dispatch_id
    AND deleted_at IS NULL AND trip_status<>'Cancelled' ORDER BY trip_id DESC LIMIT 1) t ON TRUE
  LEFT JOIN vehicles v ON v.vehicle_id=ds.vehicle_id
  LEFT JOIN drivers driver ON driver.driver_id=ds.driver_id
  LEFT JOIN employees e ON e.employee_id=driver.employee_id
  LEFT JOIN cargo_trip_executions execution ON execution.trip_id=t.trip_id
  LEFT JOIN LATERAL (SELECT receipt_id FROM cargo_receipts WHERE execution_id=execution.execution_id
    AND stage='PICKUP' ORDER BY execution_version DESC LIMIT 1) pickup ON TRUE
  LEFT JOIN LATERAL (SELECT receipt_id FROM cargo_receipts WHERE execution_id=execution.execution_id
    AND stage='DELIVERY' ORDER BY execution_version DESC LIMIT 1) delivery ON TRUE
  WHERE r.deleted_at IS NULL AND r.source_system='INTERNAL' AND r.load_type='Cargo'
    AND r.fleet_status<>'Cancelled'
)`;
const FIELDS = ['request_id','reservation_number','pickup_datetime','pickup_location','dropoff_location',
  'fleet_status','cargo_description','dispatch_id','dispatch_number','trip_id','trip_status',
  'plate_number','vehicle_name','driver_name','stage','pickup_recorded','delivery_recorded'];
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };

export async function listInternalCargoReviews(filters = {}) {
  const parseIntBound = (value, fallback, max, label) => {
    if (value == null || value === '') return fallback;
    if (!/^\d+$/.test(String(value))) invalid(`Enter a valid ${label}.`);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > max) invalid(`Enter a valid ${label}.`);
    return number;
  };
  const page = parseIntBound(filters.page, 1, 100000, 'page');
  const limit = parseIntBound(filters.limit, 20, 100, 'page size');
  const stage = filters.stage || 'all';
  if (!STAGES.has(stage)) invalid('Choose a valid Cargo stage.');
  const search = String(filters.search || '').trim();
  if (search.length > 100) invalid('Search must be100 characters or fewer.');
  const values = [], conditions = [];
  if (filters.trip_id != null && filters.trip_id !== '') {
    values.push(parseIntBound(filters.trip_id, null, 2147483647, 'trip'));
    conditions.push(`trip_id=$${values.length}`);
  }
  if (stage !== 'all') { values.push(stage); conditions.push(`stage=$${values.length}`); }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`concat_ws(' ',reservation_number,pickup_location,dropoff_location,driver_name,plate_number) ILIKE $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [{ rows: counts }, { rows }] = await Promise.all([
    query(`${QUEUE} SELECT COUNT(*)::int AS total FROM queue ${where}`, values),
    query(`${QUEUE} SELECT * FROM queue ${where}
      ORDER BY (stage='completed'),pickup_datetime ASC,request_id ASC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, (page - 1) * limit]),
  ]);
  return { rows: rows.map(row => Object.fromEntries(FIELDS.map(field => [field, row[field] ?? null]))), total: Number(counts[0]?.total || 0), page, limit };
}
