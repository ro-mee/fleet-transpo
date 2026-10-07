/**
 * Server-owned readiness adapter (Release B Task 4).
 *
 * Bridges database-shaped rows to the pure `evaluateRoadReadiness` contract.
 * The caller supplies maintenance/safety clearance from server-owned queries
 * (active maintenance, open Major/Critical incidents) — clearance is NEVER read
 * from the vehicle row or from any client payload, so a forged flag cannot
 * clear the gate. Pre-migration rows that lack the Task 4 capability columns
 * read as Pending/uncleared and fail closed.
 */
import { evaluateRoadReadiness } from "./readiness.js";

export const OPERATIONAL_USES = ["Passenger", "Cargo"];

export const COMMISSIONING_STATUSES = ["Pending", "Ready"];

/**
 * Normalize database-shaped rows into the pure-contract DTO.
 *
 * Surplus row fields (status, mileage, expiries, …) are dropped here so they
 * cannot leak into the contract, which ignores them by design.
 */
export function buildReadinessInput({
  vehicleRow = {},
  documentRows = [],
  maintenanceClear = false,
  safetyClear = false,
} = {}) {
  const row = vehicleRow && typeof vehicleRow === "object" ? vehicleRow : {};
  const docs = Array.isArray(documentRows) ? documentRows : [];
  return {
    vehicle: {
      plate_number: row.plate_number ?? null,
      commissioning_status: row.commissioning_status ?? "Pending",
      maintenance_clear: maintenanceClear === true,
      safety_clear: safetyClear === true,
    },
    documents: docs.map((d) => ({
      document_type: d?.document_type,
      verification_status: d?.verification_status ?? "Pending",
      verified_by: d?.verified_by ?? null,
      verified_at: d?.verified_at ?? null,
      expiry_date: d?.expiry_date ?? null,
      deleted_at: d?.deleted_at ?? null,
    })),
  };
}

/**
 * Assess a vehicle's road readiness from server-owned evidence.
 *
 * @returns {{ ready: boolean, blockers: string[] }} contract codes only.
 */
export function assessVehicleReadiness({
  vehicleRow = {},
  documentRows = [],
  maintenanceClear = false,
  safetyClear = false,
  now,
} = {}) {
  const { vehicle, documents } = buildReadinessInput({
    vehicleRow,
    documentRows,
    maintenanceClear,
    safetyClear,
  });
  return evaluateRoadReadiness(vehicle, documents, now);
}
