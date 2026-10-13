import { serviceLoadFor } from "@/lib/integration/contracts";

export const CARGO_SERVICE_OPTIONS = [
  ["GUEST_TRANSPORT", "Guest transport"],
  ["VIP_GUEST_TRANSPORT", "VIP guest transport"],
  ["RESTAURANT_SUPPLY_PICKUP", "Supply Chain · Restaurant supply pickup"],
  ["RESTAURANT_FOOD_DELIVERY", "Supply Chain · Restaurant food delivery"],
  ["HOTEL_SUPPLY_TRANSFER", "Supply Chain · Hotel supply transfer"],
];
export const CARGO_HANDLING_OPTIONS = ["FRAGILE", "NO_STACK", "FOOD_SEPARATION", "SECURE_LOAD", "SPILL_CONTAINMENT"];

export function blankCargoDraftLine(id) {
  return { line_id: id, name: "", source_sku_ref: "", package_description: "", expected_quantity: "", quantity_basis: "UNIT", unit: "", transport_package_count: "", gross_weight_kg_per_package: "", length_m: "", width_m: "", height_m: "", package_can_rotate: null, handling: [], temperature_mode: "UNKNOWN", temperature_min_c: "", temperature_max_c: "" };
}

function positiveDecimal(value, max, precision = 3) {
  const raw = String(value ?? "").trim();
  return new RegExp(`^\\d+(?:\\.\\d{1,${precision}})?$`).test(raw) && Number(raw) > 0 && Number(raw) <= max;
}
function grams(value) {
  const [whole, fraction = ""] = String(value).trim().split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
function kg(value) {
  return `${value / 1000n}${value % 1000n ? `.${String(value % 1000n).padStart(3, "0").replace(/0+$/, "")}` : ""}`;
}

export function validateCargoDraft({ description, declaredWeight, lines }) {
  const errors = {};
  if (!String(description ?? "").trim() || String(description).trim().length > 2000) errors.description = "Enter a cargo description of up to 2,000 characters.";
  if (!positiveDecimal(declaredWeight, 999999999.999)) errors.declaredWeight = "Enter positive gross kg with at most three decimal places.";
  if (!Array.isArray(lines) || !lines.length || lines.length > 500) errors.lines = "Add between 1 and 500 cargo items.";
  let total = 0n;
  let weightsComplete = true;
  for (const [index, line] of (Array.isArray(lines) ? lines : []).entries()) {
    const prefix = `line.${index}.`;
    if (!line.name.trim() || line.name.trim().length > 500) errors[`${prefix}name`] = "Enter the item name (up to 500 characters).";
    if (!positiveDecimal(line.expected_quantity, 1000000000) || (line.quantity_basis === "TRANSPORT_PACKAGE" && !Number.isInteger(Number(line.expected_quantity)))) errors[`${prefix}expected_quantity`] = "Enter a positive quantity; package quantities must be whole numbers.";
    if (!line.unit.trim() || line.unit.trim().length > 32) errors[`${prefix}unit`] = "Enter the counting unit (up to 32 characters).";
    const packagesValid = /^\d+$/.test(line.transport_package_count) && Number(line.transport_package_count) > 0 && Number(line.transport_package_count) <= 100000;
    if (!packagesValid) errors[`${prefix}transport_package_count`] = "Enter 1 to 100,000 transport packages.";
    if (line.quantity_basis === "TRANSPORT_PACKAGE" && packagesValid && Number(line.expected_quantity) !== Number(line.transport_package_count)) errors[`${prefix}expected_quantity`] = "Package-based expected quantity must match the transport package count.";
    const weightValid = positiveDecimal(line.gross_weight_kg_per_package, 50000);
    if (!weightValid) errors[`${prefix}gross_weight_kg_per_package`] = "Enter gross kg per package (maximum 50,000; up to three decimals).";
    if (packagesValid && weightValid) total += BigInt(line.transport_package_count) * grams(line.gross_weight_kg_per_package);
    else weightsComplete = false;
    for (const field of ["length_m", "width_m", "height_m"]) if (!positiveDecimal(line[field], 100, 4)) errors[`${prefix}${field}`] = "Enter a dimension greater than 0 and at most 100 metres (up to four decimals).";
    if (typeof line.package_can_rotate !== "boolean") errors[`${prefix}package_can_rotate`] = "Confirm whether the package may rotate during loading.";
    if (line.temperature_mode === "UNKNOWN") errors[`${prefix}temperature_mode`] = "Confirm whether this item needs temperature control.";
    if (line.temperature_mode === "REQUIRED") {
      const min = Number(line.temperature_min_c), max = Number(line.temperature_max_c);
      if (line.temperature_min_c === "" || line.temperature_max_c === "" || !Number.isFinite(min) || !Number.isFinite(max) || min < -80 || max > 80 || min > max) errors[`${prefix}temperature_mode`] = "Enter an ordered temperature range within −80 to 80 °C.";
    }
  }
  const calculatedKg = weightsComplete && lines?.length ? kg(total) : null;
  if (calculatedKg != null && !errors.declaredWeight && grams(String(declaredWeight)) !== total) errors.declaredWeight = `Declared kg must match the package total: ${calculatedKg} kg.`;
  return { errors, calculatedKg, valid: Object.keys(errors).length === 0 };
}

// This staff simulator has no machine-source credentials. The source authority
// stays PMS, and a Cargo draft cannot become a weight-only saved request while
// its separate manifest writer remains unavailable.
export function buildPassengerSimulationEnvelope(form) {
  if (serviceLoadFor(form.service_code) !== "Passenger") throw new Error("Cargo contents are an unsaved local draft. Manifest intake is unavailable; no request was sent.");
  const request = Object.fromEntries(["external_booking_id", "booking_reference", "guest_name", "pickup_location", "dropoff_location", "pickup_datetime", "special_requests", "requested_vehicle_type", "priority"].map(key => [key, form[key]]));
  return { contract_version: 2, external_request_id: form.external_booking_id.trim(), external_revision: 1, event_id: `staff-simulation:${form.external_booking_id.trim()}`, event_kind: "create", request: { ...request, source_system: "PMS", service_code: form.service_code, load_type: "Passenger", passenger_count: Number(form.passenger_count) } };
}

export function cargoWeightLabel(value) {
  const parsed = Number(value);
  return value != null && value !== "" && Number.isFinite(parsed) && parsed > 0 ? `${parsed} kg declared` : "Cargo weight not recorded";
}

export function candidateCapacityLabel(pair) {
  const vehicle = pair?.vehicle;
  if (pair?.cargoPhysical) return pair.cargoPhysical.usable_payload_kg != null ? `${pair.cargoPhysical.usable_payload_kg} kg usable payload` : "Usable cargo payload unavailable";
  if (vehicle?.operational_use === "Cargo" || pair?.load_type === "Cargo") {
    const capacity = Number(vehicle?.cargo_capacity_kg);
    return Number.isFinite(capacity) && capacity > 0 ? `${capacity} kg recorded payload` : "Cargo capacity not recorded";
  }
  return vehicle?.seating_capacity != null ? `${vehicle.seating_capacity} seats` : null;
}
