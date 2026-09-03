import { query } from "@/lib/db";

/**
 * Authorizes a company card for a specific driver and vehicle.
 * Validates that the card exists, is active, and the current assignment matches.
 * 
 * @param {Object} params
 * @param {import("pg").PoolClient | null} params.tx - Optional database transaction client
 * @param {number} params.companyCardId - The ID of the company card
 * @param {number} params.employeeId - The employee ID associated with the driver
 * @param {number|null} params.vehicleId - The active vehicle ID assigned to the driver
 * @returns {Promise<boolean>} - Throws an error if invalid, or returns true
 */
export async function authorizeCompanyCardForDriver({ tx, companyCardId, employeeId, vehicleId }) {
  const dbQuery = tx ? tx.query.bind(tx) : query;

  const { rows: cards } = await dbQuery(
    `SELECT c.id, c.status
       FROM company_cards c
       JOIN company_card_assignments a ON a.company_card_id = c.id
      WHERE c.id = $1
        AND c.status = 'Active'
        AND a.unassigned_at IS NULL
        AND (a.employee_id = $2 OR (a.vehicle_id = $3 AND $3 IS NOT NULL))
      LIMIT 1`,
    [companyCardId, employeeId, vehicleId]
  );

  if (!cards[0]) {
    const error = new Error("Invalid, inactive, or unassigned Company Card");
    error.status = 403;
    throw error;
  }

  return true;
}
