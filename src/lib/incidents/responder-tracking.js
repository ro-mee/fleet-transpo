import { query, withTransaction } from "@/lib/db";
import { sendPush } from "@/services/push.service";
import { writeAudit } from "@/lib/audit";
import {
  haversineKm,
  etaFromDistanceKm,
  tomtomEtaMinutes,
} from "@/lib/scheduling/travel-buffer";

// The physical rescue, automated. When the help sent to a stranded driver is
// another fleet driver, that responder's phone already posts GPS to this
// system — so instead of a staff member clicking "En Route" and typing an
// ETA, the server watches the responder's position and advances the response
// ladder itself (Dispatched → En Route → Arrived), keeping response_eta live.
// External help (ambulance, tow company) has no phone posting here and keeps
// the manual form; a NULL responder_driver_id means exactly that.

/** Within this distance of the driver, the responder has arrived. */
export const ARRIVED_RADIUS_M = 200;
/** A position older than this is ignored — a stale fix must not drive decisions. */
export const POSITION_FRESH_MS = 5 * 60_000;
/** Only re-notify the driver when the ETA moves at least this much. */
export const ETA_NOTIFY_DELTA_MIN = 5;

const OVERSEER_ROLES = ["system_admin", "fleet_manager", "admin"];

/**
 * Distance and ETA between the responder and the stranded driver.
 * Pure; the TomTom call lives in evaluateResponder so this stays testable.
 *
 * @param {{ latitude: number, longitude: number }|null} responderPos
 * @param {{ latitude: number, longitude: number }|null} driverPos
 * @param {number|null} [etaMinutes] routing ETA when already computed (optional override)
 * @returns {{ distanceM: number|null, etaMinutes: number|null }}
 */
export function computeResponderState({ responderPos, driverPos, etaMinutes = null }) {
  if (!responderPos || !driverPos) return { distanceM: null, etaMinutes: null };
  const km = haversineKm(
    [Number(responderPos.latitude), Number(responderPos.longitude)],
    [Number(driverPos.latitude), Number(driverPos.longitude)]
  );
  if (km == null || !Number.isFinite(km)) return { distanceM: null, etaMinutes: null };
  const eta =
    etaMinutes != null && Number.isFinite(Number(etaMinutes))
      ? Math.max(1, Math.round(Number(etaMinutes)))
      : etaFromDistanceKm(km);
  return { distanceM: Math.round(km * 1000), etaMinutes: eta };
}

/**
 * The next auto-advance on the ladder, or null when nothing should change.
 * Never downgrades and never touches 'Arrived' (manual or auto — it is final
 * for the automation; only staff may re-log details).
 *
 * @param {{ currentStatus: string|null, distanceM: number|null, responderPostedAfterAssignment: boolean }} p
 * @returns {("En Route"|"Arrived")|null}
 */
export function nextResponderStatus({ currentStatus, distanceM, responderPostedAfterAssignment }) {
  if (distanceM != null && distanceM <= ARRIVED_RADIUS_M) return "Arrived";
  const status = currentStatus || "Dispatched";
  if (status === "Dispatched" && responderPostedAfterAssignment) return "En Route";
  return null;
}

/** How far the stored ETA (an absolute time) is from a fresh N-minutes-from-now estimate. */
function etaDeltaMinutes(previousEta, nextEtaMinutes) {
  if (previousEta == null) return Infinity; // first ETA is always worth telling
  const prev = new Date(previousEta).getTime();
  if (!Number.isFinite(prev)) return Infinity;
  return Math.abs((prev - Date.now()) / 60_000 - nextEtaMinutes);
}

/**
 * Evaluate one incident's responder GPS and advance the response if warranted.
 * Safe to fire-and-forget: resolves to a result object instead of throwing.
 *
 * @param {number} incidentId
 * @param {{ req?: object, session?: object }} [ctx] when provided, the change is audited
 * @returns {Promise<{ changed: boolean, responseStatus?: string, etaMinutes?: number|null, distanceM?: number|null }>}
 */
export async function evaluateResponder(incidentId, { req, session } = {}) {
  try {
    const { rows } = await query(
      `SELECT i.incident_id, i.status, i.response_status, i.response_eta,
              i.responder_driver_id, i.responder_assigned_at, i.driver_id,
              rd.current_latitude AS responder_latitude,
              rd.current_longitude AS responder_longitude,
              rd.last_location_update AS responder_location_at,
              dd.current_latitude AS driver_latitude,
              dd.current_longitude AS driver_longitude,
              re.employee_id AS responder_employee_id,
              re.first_name AS responder_first_name,
              re.last_name AS responder_last_name,
              de.employee_id AS reporter_employee_id
         FROM driverincidents i
         LEFT JOIN drivers rd ON rd.driver_id = i.responder_driver_id
         LEFT JOIN employees re ON re.employee_id = rd.employee_id
         LEFT JOIN drivers dd ON dd.driver_id = i.driver_id
         LEFT JOIN employees de ON de.employee_id = dd.employee_id
        WHERE i.incident_id = $1 AND i.deleted_at IS NULL`,
      [incidentId]
    );
    const pre = rows[0];
    if (!pre || pre.status !== "Open" || !pre.responder_driver_id) {
      return { changed: false };
    }
    if (pre.response_status === "Arrived") return { changed: false };

    // A stale or missing position means the automation simply has no signal —
    // the manual staff path stays the source of truth until GPS returns.
    const responderAt = pre.responder_location_at ? new Date(pre.responder_location_at).getTime() : null;
    if (responderAt == null || Date.now() - responderAt > POSITION_FRESH_MS) {
      return { changed: false };
    }
    const responderPos = pre.responder_latitude != null && pre.responder_longitude != null
      ? { latitude: Number(pre.responder_latitude), longitude: Number(pre.responder_longitude) }
      : null;
    // The responder drives to where the driver actually is (live), falling
    // back to the report-time coordinates if the driver's phone went quiet.
    const driverPos = pre.driver_latitude != null && pre.driver_longitude != null
      ? { latitude: Number(pre.driver_latitude), longitude: Number(pre.driver_longitude) }
      : null;
    if (!responderPos) return { changed: false };

    // Routing ETA over real roads; the haversine heuristic is the fallback
    // (tomtomEtaMinutes fail-opens to null). Network call stays outside the
    // transaction so the row lock is never held across it.
    let routedEta = null;
    if (driverPos) {
      routedEta = await tomtomEtaMinutes({
        origin: [responderPos.latitude, responderPos.longitude],
        destination: [driverPos.latitude, driverPos.longitude],
      }).catch(() => null);
    }
    const state = computeResponderState({
      responderPos,
      driverPos,
      etaMinutes: routedEta,
    });
    const postedAfterAssignment =
      responderAt >= new Date(pre.responder_assigned_at).getTime();

    const result = await withTransaction(async (tx) => {
      // Re-read under the lock: the driver's poll and the responder's post can
      // both trigger evaluation, and staff may have advanced status meanwhile.
      const cur = await tx.query(
        `SELECT status, response_status, response_eta, responder_driver_id,
                responder_assigned_at,
                rd.current_latitude AS responder_latitude,
                rd.current_longitude AS responder_longitude,
                rd.last_location_update AS responder_location_at,
                dd.current_latitude AS driver_latitude,
                dd.current_longitude AS driver_longitude
           FROM driverincidents i
           LEFT JOIN drivers rd ON rd.driver_id = i.responder_driver_id
           LEFT JOIN drivers dd ON dd.driver_id = i.driver_id
          WHERE i.incident_id = $1 AND i.deleted_at IS NULL
          FOR UPDATE OF i`,
        [incidentId]
      );
      const row = cur.rows[0];
      if (!row || row.status !== "Open" || !row.responder_driver_id) return { changed: false };
      if (row.response_status === "Arrived") return { changed: false, responseStatus: "Arrived" };

      const lockedResponderPos = row.responder_latitude != null
        ? { latitude: Number(row.responder_latitude), longitude: Number(row.responder_longitude) }
        : null;
      const lockedDriverPos = row.driver_latitude != null
        ? { latitude: Number(row.driver_latitude), longitude: Number(row.driver_longitude) }
        : null;
      const lockedAt = row.responder_location_at ? new Date(row.responder_location_at).getTime() : null;
      if (!lockedResponderPos || !lockedDriverPos || lockedAt == null) return { changed: false };
      if (Date.now() - lockedAt > POSITION_FRESH_MS) return { changed: false };

      const lockedState = computeResponderState({
        responderPos: lockedResponderPos,
        driverPos: lockedDriverPos,
        etaMinutes: routedEta,
      });
      const lockedPosted =
        lockedAt >= new Date(row.responder_assigned_at).getTime();
      const nextStatus = nextResponderStatus({
        currentStatus: row.response_status,
        distanceM: lockedState.distanceM,
        responderPostedAfterAssignment: lockedPosted,
      });

      const statusChanged = nextStatus != null && nextStatus !== row.response_status;
      const etaDelta = lockedState.etaMinutes != null
        ? etaDeltaMinutes(row.response_eta, lockedState.etaMinutes)
        : null;
      // Write when the ladder advances OR the ETA moved enough to re-notify.
      const etaWorthUpdating =
        lockedState.etaMinutes != null &&
        (statusChanged || (etaDelta != null && etaDelta >= ETA_NOTIFY_DELTA_MIN));
      if (!statusChanged && !etaWorthUpdating) {
        return { changed: false, responseStatus: row.response_status, etaMinutes: lockedState.etaMinutes, distanceM: lockedState.distanceM };
      }

      const newEta = etaWorthUpdating
        ? new Date(Date.now() + lockedState.etaMinutes * 60_000)
        : row.response_eta;
      const finalStatus = nextStatus || row.response_status;
      const { rows: updated } = await tx.query(
        `UPDATE driverincidents
            SET response_status = $2,
                response_eta = CASE WHEN $3::timestamptz IS NOT NULL THEN $3::timestamptz ELSE response_eta END,
                responded_at = NOW(),
                updated_at = NOW()
          WHERE incident_id = $1 AND deleted_at IS NULL
          RETURNING response_status, response_eta`,
        [incidentId, finalStatus, etaWorthUpdating ? newEta : null]
      );

      const responderName = `${pre.responder_first_name || ""} ${pre.responder_last_name || ""}`.trim() || "Fleet responder";
      const etaText = updated[0].response_eta
        ? ` — ETA ${new Date(updated[0].response_eta).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}`
        : "";
      const what = statusChanged
        ? `${finalStatus} — ${responderName}${etaText} (auto — responder GPS)`
        : `ETA updated — ${responderName}${etaText} (auto — responder GPS)`;
      await tx.query(
        `INSERT INTO incident_comments (incident_id, user_id, action_type, comment_text)
         VALUES ($1, $2, $3, $4)`,
        [incidentId, pre.responder_employee_id ?? null, "RESPONSE", what]
      );

      return {
        changed: true,
        statusChanged,
        responseStatus: updated[0].response_status,
        responseEta: updated[0].response_eta,
        previousStatus: row.response_status,
        previousEta: row.response_eta,
        etaMinutes: lockedState.etaMinutes,
        distanceM: lockedState.distanceM,
        responderName,
        responderEmployeeId: pre.responder_employee_id,
        reporterEmployeeId: pre.reporter_employee_id,
      };
    });

    if (!result.changed) return result;

    // Notifications after commit, best-effort — a push failure must never
    // roll back a status advance.
    if (result.reporterEmployeeId) {
      try {
        let title = "Help Update";
        let message;
        if (result.statusChanged && result.responseStatus === "Arrived") {
          message = `Help has arrived: ${result.responderName}.`;
        } else if (result.statusChanged && result.responseStatus === "En Route") {
          const eta = result.etaMinutes != null ? ` — ETA about ${result.etaMinutes} minutes` : "";
          message = `${result.responderName} is en route to your location${eta}.`;
        } else {
          title = "Help Update — New ETA";
          message = `Updated ETA: help arrives in about ${result.etaMinutes} minutes.`;
        }
        await query(
          `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [result.reporterEmployeeId, title, message, "Info", "incident", incidentId]
        );
        await sendPush({
          employeeIds: [result.reporterEmployeeId],
          title,
          body: message,
          data: { reference_type: "incident", reference_id: Number(incidentId) },
        });
      } catch (e) {
        console.warn("responder tracking driver notification failed:", e?.message || e);
      }
    }

    // Arrival is the moment the fleet team must take over (help on scene,
    // incident still open) — page the overseers like the reopen path does.
    if (result.statusChanged && result.responseStatus === "Arrived") {
      try {
        const { rows: overseers } = await query(
          `SELECT e.employee_id
             FROM employees e
             JOIN roles r ON r.role_id = e.role_id
            WHERE r.role_name = ANY($1) AND e.deleted_at IS NULL`,
          [OVERSEER_ROLES]
        );
        const message = `${result.responderName} has reached the driver — incident #${incidentId} (responder GPS). The incident is still open and awaiting resolution.`;
        for (const employee of overseers) {
          await query(
            `INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [employee.employee_id, "Responder On Scene", message, "Alert", "incident", incidentId]
          );
        }
        if (overseers.length) {
          await sendPush({
            employeeIds: overseers.map((employee) => employee.employee_id),
            title: "Responder On Scene",
            body: message,
            data: { reference_type: "incident", reference_id: Number(incidentId) },
          });
        }
      } catch (e) {
        console.warn("responder tracking overseer notification failed:", e?.message || e);
      }
    }

    if (req && session) {
      try {
        await writeAudit(req, session, {
          action: "responder_auto_update",
          resource: "driverincidents",
          resourceId: String(incidentId),
          oldValues: { response_status: result.previousStatus, response_eta: result.previousEta },
          newValues: { response_status: result.responseStatus, response_eta: result.responseEta },
        });
      } catch (e) {
        console.warn("responder tracking audit failed:", e?.message || e);
      }
    }

    return result;
  } catch (e) {
    console.warn("responder evaluation failed:", e?.message || e);
    return { changed: false };
  }
}
