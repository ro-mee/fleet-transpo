import { SERVICE_CODES } from "@/lib/integration/contracts";
export const ACTIVE_TRIP_STATUSES = ["In Progress", "Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "Driver Accepted"];
export const TRIP_SERVICE_OPTIONS = SERVICE_CODES.map(code => ({ value: code, label: code.toLowerCase().replaceAll("_", " ") }));
export function validateServiceCode(code) {
  if (code && !SERVICE_CODES.includes(code)) return `Unknown service code '${code}'.`;
  return null;
}
/** Shared WHERE clauses for the visible register, JSON report and workbook. */
export function appendTripFilters(conditions, params, { serviceCode, status, search } = {}) {
  const error = validateServiceCode(serviceCode);
  if (error) throw new Error(error);
  const add = value => { params.push(value); return `$${params.length}`; };
  if (serviceCode) conditions.push(`st.service_code = ${add(serviceCode)}`);
  if (status && status !== "all") conditions.push(status === "Active" ? `t.trip_status = ANY(${add(ACTIVE_TRIP_STATUSES)})` : `t.trip_status = ${add(status)}`);
  if (search) {
    const p = add(`%${search}%`);
    conditions.push(`(t.trip_id::text ILIKE ${p} OR v.plate_number ILIKE ${p} OR de.first_name ILIKE ${p} OR de.last_name ILIKE ${p} OR r.route_name ILIKE ${p})`);
  }
}
