import { query, withTransaction } from '@/lib/db';
import { evaluateDispatchCandidate } from '@/services/dispatch-radar.service';
import { resolveRequestEstimate } from '@/services/route-resolver.service';
import { evaluateAssignedIssue } from '@/lib/dispatch/assigned-alerts';
import { notificationRolesFor, employeeIdsForRoles, dedupeEmployeeIds } from '@/lib/notifications/recipients';
import { loadPreferenceRows, channelEnabled } from '@/lib/notifications/preferences';
import { flushOutbox, CHANNEL } from '@/services/push.service';

// Phase 5B — bounded upcoming-assignment scan for app-closed monitoring.
// Reuses the cron sync, preferences, audience policy and push outbox.
// Database-backed incident identity: (request, fingerprint) via the
// notifications table; transactional dedupe across overlapping workers via
// pg_advisory_xact_lock. Notifications carry minimal details and deep-link;
// opening re-fetches current state (text is not evidence).
const EVENT_KEY = 'assigned_trip_issue';
const TITLE = 'Assigned trip needs attention';

export async function syncAssignedTripAlerts({ now = new Date(), horizonHours = 24, cap = 50 } = {}) {
  try {
    const horizon = new Date(+now + Math.min(Math.max(Number(horizonHours) || 24, 1), 72) * 3_600_000);
    const { rows: assignments } = await query(`SELECT ds.dispatch_id, ds.request_id, ds.vehicle_id, ds.driver_id, ds.scheduled_departure,
        tr.pickup_datetime, tr.fleet_status
      FROM dispatchschedules ds JOIN transportation_requests tr ON tr.request_id=ds.request_id AND tr.deleted_at IS NULL
      WHERE ds.deleted_at IS NULL AND ds.status IN ('Scheduled','Driver Accepted')
        AND tr.fleet_status NOT IN ('Cancelled','Completed')
        AND ds.scheduled_departure >= $1::timestamptz AND ds.scheduled_departure <= $2::timestamptz
      ORDER BY ds.scheduled_departure LIMIT $3`, [now.toISOString(), horizon.toISOString(), Math.min(Math.max(Number(cap) || 50, 1), 100)]);
    if (!assignments.length) return { created: 0, pushes_attempted: 0, scanned: 0, errors: 0 };
    const dispatcherIds = await employeeIdsForRoles(notificationRolesFor('dispatch', 'update_all'));
    const preferenceRows = await loadPreferenceRows(dedupeEmployeeIds(dispatcherIds), [EVENT_KEY]);
    let created = 0, errors = 0;
    const pushIds = new Set();
    for (const a of assignments) {
      try {
        const { rows: reqRows } = await query(`SELECT * FROM transportation_requests WHERE request_id=$1 AND deleted_at IS NULL`, [a.request_id]);
        const request = reqRows[0];
        if (!request || ['Cancelled', 'Completed'].includes(request.fleet_status)) continue;
        const estimate = await resolveRequestEstimate(request, { query }, { persistRoute: false }).catch(() => null);
        const evidence = await evaluateDispatchCandidate({ request, estimate, vehicleId: Number(a.vehicle_id), driverId: Number(a.driver_id), now, deadline: Date.now() + 10_000 });
        const result = evaluateAssignedIssue({ request, evidence });
        if (!result.issue) continue;
        await withTransaction(async tx => {
          await tx.query(`SELECT pg_advisory_xact_lock(hashtext('assigned_alert_' || $1 || '_' || $2))`, [a.request_id, result.fingerprint]);
          for (const employeeId of dispatcherIds) {
            if (!channelEnabled({ preferenceRows, employeeId, eventKey: EVENT_KEY, channel: 'in_app' }) && !channelEnabled({ preferenceRows, employeeId, eventKey: EVENT_KEY, channel: 'push' })) continue;
            const { rows: seen } = await tx.query(`SELECT 1 FROM notifications WHERE employee_id=$1 AND title=$2 AND reference_type='dispatch' AND reference_id=$3 LIMIT 1`,
              [employeeId, `${TITLE} #${result.fingerprint}`, a.request_id]);
            if (seen.length) continue;
            const message = `Reservation #${a.request_id}: ${result.message} Open the reservation conversation for current evidence.`;
            if (channelEnabled({ preferenceRows, employeeId, eventKey: EVENT_KEY, channel: 'in_app' })) {
              await tx.query(`INSERT INTO notifications (employee_id, title, message, type, reference_type, reference_id) VALUES ($1,$2,$3,'Warning','dispatch',$4)`,
                [employeeId, `${TITLE} #${result.fingerprint}`, message, a.request_id]);
              created += 1;
            }
            if (channelEnabled({ preferenceRows, employeeId, eventKey: EVENT_KEY, channel: 'push' })) {
              await tx.query(`INSERT INTO push_outbox (employee_id, title, body, channel_id, reference_type, reference_id) VALUES ($1,$2,$3,$4,'dispatch',$5)`,
                [employeeId, TITLE, message, CHANNEL.PUSH.id, a.request_id]);
              created += 1;
              pushIds.add(employeeId);
            }
          }
        });
      } catch (e) { errors += 1; console.warn(`assigned-trip scan for request ${a.request_id} failed:`, e?.message || e); }
    }
    if (pushIds.size) { try { await flushOutbox({ employeeIds: [...pushIds] }); } catch (e) { console.warn('assigned-trip outbox flush failed:', e?.message || e); } }
    return { created, pushes_attempted: pushIds.size, scanned: assignments.length, errors };
  } catch (e) {
    console.warn('syncAssignedTripAlerts failed:', e?.message || e);
    return { created: 0, pushes_attempted: 0, scanned: 0, errors: 1 };
  }
}
