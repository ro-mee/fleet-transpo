import { query, withTransaction } from '@/lib/db';
import { AuthError } from '@/lib/api/utils';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@/lib/consent/policies';
import { LIVE_TRIP_STATUSES } from '@/lib/constants';
import { qualifiedGps } from '@/lib/dispatch/location-relevance';
import { resolveVehiclePairing, vehicleOperationallyAvailable } from '@/lib/ai/pair-scoring';
import { loadDriverScheduleContext } from '@/services/driver-schedule.service';
import { driverBlockReason } from '@/lib/scheduling/driver-schedule';

export async function standbyState(driverId, db = { query }, excludeTripId = null) {
  const { rows } = await db.query(`SELECT d.*,
    (SELECT max(a.time_in) FROM driverattendance a WHERE a.driver_id=d.driver_id AND a.time_out IS NULL) AS duty_started_at,
    EXISTS (SELECT 1 FROM driverattendance a WHERE a.driver_id=d.driver_id
      AND a.date=(NOW() AT TIME ZONE 'Asia/Manila')::date AND a.time_in <= NOW() AND a.time_out IS NULL
      AND a.status IN ('Present','Late','Half-Day')) AS checked_in,
    EXISTS (SELECT 1 FROM driver_consents c WHERE c.driver_id=d.driver_id AND c.policy_version=$2) AS consented,
    EXISTS (SELECT 1 FROM trips t WHERE t.driver_id=d.driver_id AND t.deleted_at IS NULL AND t.trip_status=ANY($3::text[]) AND ($4::int IS NULL OR t.trip_id<>$4))
      OR EXISTS (SELECT 1 FROM driverincidents i WHERE (i.driver_id=d.driver_id OR i.responder_driver_id=d.driver_id)
        AND i.deleted_at IS NULL AND i.status='Open') AS busy,
    EXISTS (SELECT 1 FROM mobile_refresh_tokens m JOIN employees e ON e.employee_id=m.employee_id
      WHERE m.employee_id=d.employee_id AND m.family_id=d.standby_session_family
      AND m.revoked_at IS NULL AND m.expires_at>NOW() AND e.deleted_at IS NULL AND e.status='Active') AS session_live
    FROM drivers d WHERE d.driver_id=$1 AND d.deleted_at IS NULL`, [driverId, CURRENT_PRIVACY_POLICY_VERSION, LIVE_TRIP_STATUSES, excludeTripId]);
  return rows[0] ?? null;
}

export async function setDuty(driverId, active) {
  if (active) {
    const now = new Date();
    const block = driverBlockReason({ driverId,pickup:now,returnAt:now,ctx:await loadDriverScheduleContext([driverId]) });
    if (block?.blocked) throw new AuthError(block.reason,409,'DUTY_UNAVAILABLE');
  }
  return withTransaction(async (tx) => {
    await tx.query('SELECT driver_id FROM drivers WHERE driver_id=$1 FOR UPDATE', [driverId]);
    if (active) {
      const state = await standbyState(driverId, tx);
      if (!state?.consented) throw new AuthError('Accept the current privacy policy before starting duty.', 403);
      // One attendance row per local day is the existing attendance contract.
      await tx.query(`INSERT INTO driverattendance (driver_id,date,time_in,status,check_in_method)
        VALUES ($1,(NOW() AT TIME ZONE 'Asia/Manila')::date,NOW(),'Present','manual')
        ON CONFLICT (driver_id,date) DO UPDATE SET time_in=NOW(),time_out=NULL,status='Present'
        WHERE driverattendance.time_out IS NOT NULL OR driverattendance.time_in IS NULL`, [driverId]);
      await tx.query("UPDATE drivers SET driver_status='Available' WHERE driver_id=$1 AND driver_status='Off Duty'", [driverId]);
      await tx.query('UPDATE drivers SET standby_tracking_enabled=true WHERE driver_id=$1', [driverId]);
    } else {
      await tx.query('UPDATE driverattendance SET time_out=NOW() WHERE driver_id=$1 AND time_in IS NOT NULL AND time_out IS NULL', [driverId]);
      await tx.query('UPDATE drivers SET standby_tracking_enabled=false, standby_session_family=NULL WHERE driver_id=$1', [driverId]);
    }
    return { checkedIn: active };
  });
}

export async function effectiveStandbyVehicle(driverId, now = new Date()) {
  const [{ rows: pairs }, { rows: substitutes }, { rows: drivers }, { rows: vehicles }] = await Promise.all([
    query('SELECT driver_id,vehicle_id FROM driver_vehicle_assignments WHERE assigned_until IS NULL'),
    query('SELECT vehicle_id,substitute_driver_id,effective_from,effective_until FROM substitute_vehicle_schedules'),
    query('SELECT driver_id,driver_status,license_expiry FROM drivers WHERE deleted_at IS NULL'),
    query('SELECT vehicle_id,vehicle_status FROM vehicles WHERE deleted_at IS NULL'),
  ]);
  const scheduleContext = await loadDriverScheduleContext(drivers.map(d => d.driver_id));
  const driverById = new Map(drivers.map(d => [Number(d.driver_id), d]));
  const matches = vehicles.filter(vehicle => vehicleOperationallyAvailable(vehicle)).filter(vehicle => {
    const pair = resolveVehiclePairing({ vehicleId: vehicle.vehicle_id, pickupDate: now, returnAt: now,
      activePairs: pairs, activeSubstitutes: substitutes, driverById, scheduleContext, now });
    return pair.ok && Number(pair.driver?.driver_id) === Number(driverId);
  });
  return matches.length === 1 ? matches[0].vehicle_id : null;
}

export async function publishStandby(user, body) {
  const fix = { latitude: body?.latitude, longitude: body?.longitude, accuracy: body?.accuracy, observed_at: body?.recorded_at };
  if (!qualifiedGps(fix).eligible) throw new AuthError('A fresh location with accuracy within 100 m is required.', 400, 'GPS_NOT_QUALIFIED');
  if (!user.familyId) throw new AuthError('A current mobile session is required.', 403);
  const vehicleId = await effectiveStandbyVehicle(user.driverId);
  if (!vehicleId) throw new AuthError('No eligible vehicle pairing for standby.', 409, 'STANDBY_NOT_READY');
  return withTransaction(async (tx) => {
    await tx.query('SELECT driver_id FROM drivers WHERE driver_id=$1 FOR UPDATE', [user.driverId]);
    const state = await standbyState(user.driverId, tx);
    const { rows: sessions } = await tx.query(`SELECT 1 FROM mobile_refresh_tokens WHERE employee_id=$1
      AND family_id=$2 AND revoked_at IS NULL AND expires_at>NOW() LIMIT 1`, [user.employeeId, user.familyId]);
    if (!state?.checked_in || !state.consented || state.busy || !state.standby_tracking_enabled || !sessions.length)
      throw new AuthError('Checked-in standby duty is required.', 409, 'STANDBY_NOT_READY');
    if (!state.duty_started_at || new Date(fix.observed_at) < new Date(state.duty_started_at))
      throw new AuthError('Location predates the current duty session.', 409, 'GPS_OUT_OF_ORDER');
    const { rows } = await tx.query(`UPDATE drivers SET standby_latitude=$2,standby_longitude=$3,
      location_observed_at=$4,location_received_at=NOW(),location_accuracy_m=$5,location_source='standby',location_vehicle_id=$6,
      standby_session_family=$7
      WHERE driver_id=$1 AND (location_observed_at IS NULL OR location_observed_at<$4::timestamptz)
      RETURNING location_observed_at`, [user.driverId,fix.latitude,fix.longitude,fix.observed_at,fix.accuracy,vehicleId,user.familyId]);
    return { updated: rows.length > 0, observedAt: rows[0]?.location_observed_at ?? state.location_observed_at };
  });
}

// Operations visibility is separate from request-specific recommendation policy.
export async function standbyLocations() {
  const { rows } = await query(`SELECT d.driver_id, e.first_name, e.last_name, v.plate_number
    FROM drivers d JOIN employees e ON e.employee_id=d.employee_id
    JOIN vehicles v ON v.vehicle_id=d.location_vehicle_id AND v.deleted_at IS NULL
    WHERE d.deleted_at IS NULL AND d.standby_tracking_enabled=true`);
  const positions = [];
  // ponytail: small fleet, reuse authoritative per-driver checks; batch their
  // schedule/pairing reads if measured polling cost grows with fleet size.
  for (const driver of rows) {
    const state = await standbyState(driver.driver_id);
    if (!state?.checked_in || !state.consented || state.busy || !state.session_live || !state.standby_tracking_enabled) continue;
    const fix = { latitude:state.standby_latitude, longitude:state.standby_longitude,
      accuracy:state.location_accuracy_m, observed_at:state.location_observed_at };
    if (!qualifiedGps(fix).eligible || !state.duty_started_at || new Date(fix.observed_at) < new Date(state.duty_started_at)) continue;
    const vehicleId = await effectiveStandbyVehicle(driver.driver_id);
    if (!vehicleId || Number(vehicleId) !== Number(state.location_vehicle_id)) continue;
    const gps = qualifiedGps(fix);
    if (!gps.eligible) continue;
    positions.push({ tracking_id:`standby-${driver.driver_id}`, driver_id:driver.driver_id,
      vehicle_id:vehicleId, vehicle_status:'Standby', driver_name:`${driver.first_name || ''} ${driver.last_name || ''}`.trim(),
      plate_number:driver.plate_number, latitude:Number(fix.latitude), longitude:Number(fix.longitude),
      accuracy:Number(fix.accuracy), recorded_at:fix.observed_at, expires_at:gps.expiresAt });
  }
  return positions;
}
