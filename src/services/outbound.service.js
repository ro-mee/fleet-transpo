import { query } from "@/lib/db";
import { getBookingGateway } from "@/lib/integration/booking-gateway";
import { toExternalStatus } from "@/lib/integration/status-map";

// Outbound status delivery: Fleet -> Booking.
//
// Whenever a transportation request's fleet_status advances (approved, rejected,
// scheduled, in transit, completed, cancelled), Fleet notifies Booking. Delivery
// goes through the booking gateway (mock today, HTTP later) and every attempt is
// recorded in integration_log for audit + retry.
//
// Best-effort: a delivery failure NEVER breaks the Fleet operation that
// triggered it. Failures are logged (status='failed') so a future reconciliation
// job can retry from integration_log.

function nowIso() {
  // Callers may pass occurredAt; default to server time. Isolated here so the
  // rest of the module stays pure-ish and easy to reason about.
  return new Date().toISOString();
}

/**
 * Emit a status event to Booking for a given request.
 *
 * @param {object} request  a transportation_requests row (needs external_booking_id, request_id, fleet_status)
 * @param {object} [extra]  optional { driver, vehicle, eta, occurredAt, fleetStatus }
 *                          fleetStatus overrides request.fleet_status for the mapping.
 * @returns {Promise<{ delivered: boolean }>}
 */
export async function emitTransportStatus(request, extra = {}) {
  if (!request?.external_booking_id) {
    // Nothing to correlate on the Booking side — this request didn't originate
    // from an external booking, so there's nobody to notify.
    return { delivered: false };
  }

  const fleetStatus = extra.fleetStatus || request.fleet_status;
  const event = {
    external_booking_id: request.external_booking_id,
    status: toExternalStatus(fleetStatus),
    fleet_reference: request.request_id ?? null,
    driver: extra.driver || null,
    vehicle: extra.vehicle || null,
    eta: extra.eta || null,
    occurred_at: extra.occurredAt || nowIso(),
  };

  const gateway = getBookingGateway();
  let logId = null;

  try {
    const { rows } = await query(
      `INSERT INTO integration_log
         (direction, source_system, event_type, reference_type, reference_id, external_booking_id, payload, status)
       VALUES ('outbound', $1, $2, 'transportation_request', $3, $4, $5, 'pending')
       RETURNING log_id`,
      [
        request.source_system || "fleet",
        `status_${event.status.toLowerCase()}`,
        request.request_id ?? null,
        request.external_booking_id,
        JSON.stringify(event),
      ]
    );
    logId = rows[0]?.log_id ?? null;
  } catch (e) {
    console.warn("emitTransportStatus: failed to write integration_log:", e?.message || e);
  }

  try {
    const result = await gateway.acknowledgeStatus(event);
    if (logId != null) {
      await query(
        `UPDATE integration_log SET status = 'processed', processed_at = NOW() WHERE log_id = $1`,
        [logId]
      );
    }
    return { delivered: result?.delivered ?? true };
  } catch (e) {
    console.warn("emitTransportStatus: delivery failed:", e?.message || e);
    if (logId != null) {
      await query(
        `UPDATE integration_log SET status = 'failed', error_message = $1 WHERE log_id = $2`,
        [String(e?.message || e).slice(0, 1000), logId]
      ).catch(() => {});
    }
    return { delivered: false };
  }
}

// Reconcile the outbound delivery log: retry every undelivered status event.
//
// emitTransportStatus writes each attempt to integration_log ('pending' →
// 'processed' or 'failed'). A failed delivery means Booking never heard about a
// real Fleet transition. This job re-drives those rows through the gateway and
// flips them to 'processed' when the retry lands. Best-effort like the emitter
// itself: a row that keeps failing is left as 'failed' with a fresh
// error_message, never silently dropped.
//
// Only outbound rows are retried. Inbound rows were ingested when they arrived;
// re-running ingest for them would be a different operation (and is idempotent
// on external_booking_id, so it does not belong here).
export async function reconcileFailedDeliveries({ max = 50 } = {}) {
  const { rows: stuck } = await query(
    `SELECT log_id, payload, error_message
       FROM integration_log
      WHERE direction = 'outbound'
        AND status IN ('pending', 'failed')
      ORDER BY log_id
      LIMIT $1`,
    [max]
  );

  const gateway = getBookingGateway();
  const results = [];
  for (const row of stuck) {
    if (!row.payload || typeof row.payload !== "object") {
      results.push({ logId: row.log_id, delivered: false, error: "payload is missing or not an object" });
      continue;
    }
    try {
      const result = await gateway.acknowledgeStatus(row.payload);
      await query(
        `UPDATE integration_log SET status = 'processed', processed_at = NOW(), error_message = NULL WHERE log_id = $1`,
        [row.log_id]
      );
      results.push({ logId: row.log_id, delivered: result?.delivered ?? true });
    } catch (e) {
      const message = String(e?.message || e).slice(0, 1000);
      await query(
        `UPDATE integration_log SET status = 'failed', error_message = $1 WHERE log_id = $2`,
        [message, row.log_id]
      ).catch(() => {});
      results.push({ logId: row.log_id, delivered: false, error: message });
    }
  }

  return {
    gateway: gateway.name,
    retried: stuck.length,
    delivered: results.filter((r) => r.delivered).length,
    stillFailed: results.filter((r) => !r.delivered).length,
    results,
  };
}
