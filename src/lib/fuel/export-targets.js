import { collectPagedRows } from "@/lib/export";

// Export targets for the Fuel console, one per VISIBLE view.
//
// The header button used to export fuel receipt claims whichever view was open,
// so the Permits view (45 permits) and the Monthly Budget view both produced a
// receipt-claim file — or, because the paginated envelope was passed straight to
// `exportToCSV`, no file at all. The target list makes "the button exports what
// is on screen" a testable fact rather than a convention.
//
// Each target exposes:
//   entity   – plural noun for toasts and the button's accessible name
//   label    – button text, naming the entity
//   filename – base name; `exportToCSV` appends the local date and `.csv`
//   columns  – export column definitions (label + key/accessor)
//   collect  – async () => rows, already unwrapped from any envelope

/** Views the Fuel page can show, in tab order. */
export const FUEL_EXPORT_VIEWS = ["registry", "budget", "permits"];

/** Columns for the receipt-claim registry. */
const RECEIPT_CLAIM_COLUMNS = [
  { label: "Refuel Date", key: "fuel_date" },
  { label: "Vehicle Plate", accessor: (r) => r.vehicles?.plate_number || "" },
  {
    label: "Driver",
    accessor: (r) =>
      r.drivers?.employees
        ? `${r.drivers.employees.first_name || ""} ${r.drivers.employees.last_name || ""}`.trim()
        : "",
  },
  { label: "Station", key: "station_name" },
  { label: "Fuel Type", key: "fuel_type" },
  { label: "Liters", key: "liters" },
  { label: "Total Amount", key: "amount" },
  { label: "Status", key: "status" },
];

/** Columns for the pre-pump permit queue. */
const PERMIT_COLUMNS = [
  { label: "Permit ID", key: "fuel_request_id" },
  { label: "Allocation Month", key: "allocation_month" },
  { label: "Vehicle Plate", key: "plate_number" },
  { label: "Driver", accessor: (r) => `${r.first_name || ""} ${r.last_name || ""}`.trim() },
  { label: "Trip", key: "trip_id" },
  { label: "Current Level (%)", key: "current_fuel_level_percent" },
  { label: "Forecast Distance (km)", key: "forecast_distance_km" },
  { label: "Requested (L)", key: "requested_liters" },
  { label: "Recommended (L)", key: "recommended_liters" },
  { label: "Authorized (L)", key: "approved_liters" },
  { label: "Status", key: "status" },
];

/** Columns for the monthly per-vehicle budget plan. */
const BUDGET_COLUMNS = [
  { label: "Vehicle Plate", key: "plate_number" },
  { label: "Vehicle", key: "vehicle_name" },
  { label: "Tank Capacity (L)", key: "tank_capacity_l" },
  { label: "Efficiency (km/L)", key: "fuel_efficiency_kmpl" },
  { label: "Allocated (L)", key: "allocated_liters" },
  { label: "Consumed (L)", key: "consumed_liters" },
  { label: "Committed (L)", key: "committed_liters" },
  { label: "Remaining (L)", key: "remaining_liters" },
];

/**
 * Build the export target for a view.
 *
 * @param {"registry"|"budget"|"permits"} view which list is on screen
 * @param {object} service endpoint functions ({ getFuelRecords, getFuelRequests, getFuelAllocations })
 * @param {object} [filters] the registry's active server-side filter ({ status, search })
 * @returns {{entity:string,label:string,filename:string,columns:Array,collect:()=>Promise<Array>}}
 */
export function fuelExportTarget(view, service, filters = {}) {
  const { getFuelRecords, getFuelRequests, getFuelAllocations } = service || {};

  if (view === "permits") {
    return {
      entity: "fuel permits",
      label: "Export permits",
      filename: "fuel-permits",
      columns: PERMIT_COLUMNS,
      // The permits endpoint is unpaginated: it answers `{ rows, counts }` once.
      collect: async () => (await getFuelRequests())?.rows || [],
    };
  }

  if (view === "budget") {
    return {
      entity: "monthly budget rows",
      label: "Export monthly budget",
      filename: "fuel-monthly-budget",
      columns: BUDGET_COLUMNS,
      collect: async () => (await getFuelAllocations())?.rows || [],
    };
  }

  return {
    entity: "receipt claims",
    label: "Export receipt claims",
    filename: "fuel-receipt-claims",
    columns: RECEIPT_CLAIM_COLUMNS,
    // The registry IS paginated and carries the page's filter, so the export
    // walks every page of the same filtered set the table is showing.
    collect: async () =>
      collectPagedRows((page, pageSize) =>
        getFuelRecords({ ...filters, page, pageSize })
      ),
  };
}
