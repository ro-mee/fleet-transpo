import { createHmac, timingSafeEqual } from 'node:crypto';
import { query } from '@/lib/db';
import { AuthError } from '@/lib/api/utils';
import { LOCATION_POLICY_VERSION } from '@/lib/dispatch/location-relevance';

// ponytail: conservatively invalidate the whole small-fleet plan on operational
// changes; narrow to dependency rows if measured false invalidations warrant it.
// Only a hash leaves the DB. No coordinates or employee data enter the token.
const TABLES = ['drivers', 'vehicles', 'vehiclecategories', 'vehiclemaintenance', 'routes', 'locations',
  'dispatchschedules', 'driver_vehicle_assignments', 'substitute_vehicle_schedules',
  'driver_work_schedules', 'driver_leave_requests', 'driverattendance', 'driver_consents',
  'employees', 'mobile_refresh_tokens', 'trips', 'driverincidents', 'system_settings'];

export async function readPlanRevision(db = { query }) {
  const parts = TABLES.map(table => `'${table}',(SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM ${table} t)`);
  // Pending -> Scheduled is intermediate lifecycle bookkeeping. Preserve every
  // requirement, excluding generated display/audit metadata.
  parts.push(`'requests',(SELECT md5(COALESCE(jsonb_agg(
    (to_jsonb(r) - ARRAY['fleet_status','updated_at','derived_priority','priority_updated_at','ai_vehicle_recommendation','ai_driver_recommendation'])
    || jsonb_build_object('fleet_status',CASE WHEN r.fleet_status IN ('Pending','Scheduled') THEN 'Actionable' ELSE r.fleet_status END)
    ORDER BY r.request_id)::text,'[]')) FROM transportation_requests r)`);
  const { rows } = await db.query(`SELECT md5(jsonb_build_object(${parts.join(',')})::text) AS revision`);
  if (!rows[0]?.revision) throw new Error('Queue revision could not be read.');
  return rows[0].revision;
}

function signature(payload) {
  const key = process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('Dispatch plan signing is not configured.');
  return createHmac('sha256', key).update(`fleet-dispatch-plan-v1:${payload}`).digest('base64url');
}

export function issuePlanToken({ revision, proposals, expiresAt, window = null }) {
  if (!revision || !Number.isFinite(new Date(expiresAt).getTime())) throw new Error('Plan evidence is incomplete.');
  const choices = proposals.filter(p => (p.outcome === 'VERIFIED' || p.confirmationMode === 'manual') && p.candidateEvaluationComplete !== false && !(p.dependsOnRequestIds?.length))
    .map(p => [Number(p.requestId), Number(p.pair.vehicle_id), Number(p.pair.driver_id), p.confirmationMode === 'manual' ? 'manual' : 'verified']);
  const coverage = proposals.filter(p => p.outcome === 'VERIFIED').map(p => Number(p.requestId));
  const payload = Buffer.from(JSON.stringify({ version: 2, policyVersion:LOCATION_POLICY_VERSION, revision, expiresAt, choices, coverage, window })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export async function verifyPlanToken(token, selection = {}, db = { query }) {
  const stale = () => new AuthError('This queue proposal is stale. Analyze the queue again.', 409, 'STALE_DISPATCH_PLAN');
  let evidence;
  try {
    if (typeof token !== 'string' || token.length > 32_000) throw stale();
    const [payload, mac, extra] = token.split('.');
    if (!payload || !mac || extra) throw stale();
    const expected = Buffer.from(signature(payload));
    const actual = Buffer.from(mac);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw stale();
    evidence = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (![1,2].includes(evidence.version) || (evidence.version === 2 && evidence.policyVersion !== LOCATION_POLICY_VERSION) || !Number.isFinite(new Date(evidence.expiresAt).getTime()) || new Date(evidence.expiresAt).getTime() <= Date.now()) throw stale();
    if (selection.requestId != null && !evidence.choices.some(([r,v,d,mode]) => r === Number(selection.requestId) && v === Number(selection.vehicleId) && d === Number(selection.driverId) && (!selection.mode || selection.mode === (mode ?? 'verified')))) throw stale();
  } catch { throw stale(); }
  if (await readPlanRevision(db) !== evidence.revision) throw stale();
  return evidence;
}
