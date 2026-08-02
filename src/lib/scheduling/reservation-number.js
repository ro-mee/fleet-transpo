import { query } from "@/lib/db";

// Human-facing reservation identifiers: RSV-YYYYMMDD-####
//
// Dispatchers read these aloud over radio and type them into search, so the
// format is deliberately short and day-scoped rather than a global sequence or
// a UUID. The ####  counter restarts each day.
//
// Uniqueness is guaranteed by the UNIQUE index on
// transportation_requests.reservation_number (migration 016), not by this
// function. Two concurrent ingests can compute the same next number; the loser
// takes a unique-violation and retries. generateReservationNumber() handles
// that retry internally so callers just get a usable number.

const PREFIX = "RSV";
const MAX_ATTEMPTS = 5;

/** Format a Date as YYYYMMDD in local time. */
function dateStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/**
 * Build the next candidate number for a given day by looking at the highest
 * existing suffix. Uses the string form so it works off the UNIQUE index and
 * doesn't need a separate counter table.
 */
async function nextCandidate(stamp) {
  const { rows } = await query(
    `SELECT reservation_number
       FROM transportation_requests
      WHERE reservation_number LIKE $1
      ORDER BY reservation_number DESC
      LIMIT 1`,
    [`${PREFIX}-${stamp}-%`]
  );

  const last = rows[0]?.reservation_number;
  const lastSeq = last ? parseInt(last.slice(-4), 10) : 0;
  const nextSeq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${PREFIX}-${stamp}-${String(nextSeq).padStart(4, "0")}`;
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
  const stamp = dateStamp(when);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = await nextCandidate(stamp);
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
