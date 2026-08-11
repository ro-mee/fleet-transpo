import { query } from "@/lib/db";

// Human-facing reservation identifiers: RS-XXXX
//
// Dispatchers read these aloud over radio and type them into search. The format
// uses a short, fixed prefix and random alphanumeric characters.
//
// Uniqueness is guaranteed by the UNIQUE index on
// transportation_requests.reservation_number (migration 016), not by this
// function. If a collision occurs, generateReservationNumber() catches the 
// unique violation and retries.

const PREFIX = "RS";
const MAX_ATTEMPTS = 5;

/** Generate a random uppercase alphanumeric string. */
function generateRandomSuffix(length = 4) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Assign a reservation number to an existing request row.
 *
 * Claims the number with a conditional UPDATE, so a lost race surfaces as a
 * unique violation (23505) and is retried with a freshly-read sequence rather
 * than silently overwriting another request's number.
 *
 * @param {number|string} requestId
 * @param {Date} [when] the day to stamp (defaults to now)
 * @returns {Promise<string|null>} the assigned number, or null if it couldn't be assigned
 */
export async function assignReservationNumber(requestId, when = new Date()) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = `${PREFIX}-${generateRandomSuffix()}`;
    try {
      const { rows } = await query(
        `UPDATE transportation_requests
            SET reservation_number = $1
          WHERE request_id = $2 AND reservation_number IS NULL
        RETURNING reservation_number`,
        [candidate, requestId]
      );
      // Row already had a number (concurrent assignment) — read it back.
      if (!rows[0]) {
        const { rows: existing } = await query(
          `SELECT reservation_number FROM transportation_requests WHERE request_id = $1`,
          [requestId]
        );
        return existing[0]?.reservation_number ?? null;
      }
      return rows[0].reservation_number;
    } catch (e) {
      // 23505 = unique_violation: another ingest claimed this number first.
      if (e?.code === "23505") continue;
      console.warn("assignReservationNumber failed:", e?.message || e);
      return null;
    }
  }

  console.warn(`assignReservationNumber: exhausted retries for request ${requestId}`);
  return null;
}
