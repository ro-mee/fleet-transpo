import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvLocal } from '../../scripts/load-env.mjs';
import { createInternalCargoReservation } from './internal-reservation.service';

afterEach(() => vi.unstubAllGlobals());

// Uses real current catalog/FKs, but every service mutation is unconditionally rolled back.
describe.skipIf(process.env.INTERNAL_RESERVATION_ROLLBACK_TEST !== '1')('internal intake against live schema with unconditional rollback', () => {
  it('persists atomic contents/audit/timeline, replays safely, and leaves no marked rows after rollback', async () => {
    loadEnvLocal();
    const client = new pg.Client({ connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:5000 });
    const submissionId = randomUUID(), failedSubmissionId = randomUUID();
    let requestId = null, failedRequestId = null, transactionOpen = false, networkAttempts = 0, savepointNumber = 0;
    vi.stubGlobal('fetch', async () => { networkAttempts++; throw new Error('External network disabled for rollback verification'); });
    await client.connect();
    try {
      const actor = (await client.query(`SELECT e.employee_id FROM employees e JOIN roles ro ON ro.role_id=e.role_id
        WHERE ro.role_name='fleet_manager' AND e.status='Active' AND e.deleted_at IS NULL ORDER BY e.employee_id LIMIT 1`)).rows[0];
      const route = (await client.query(`SELECT r.route_id,r.origin_location_id,r.destination_location_id,r.estimated_distance,r.estimated_duration
        FROM routes r JOIN locations origin ON origin.location_id=r.origin_location_id
        JOIN locations destination ON destination.location_id=r.destination_location_id
        WHERE r.status='Active' AND r.deleted_at IS NULL AND r.estimated_distance>0 AND r.estimated_duration>0
          AND origin.location_id<>destination.location_id AND origin.is_active AND destination.is_active
          AND origin.retired_at IS NULL AND destination.retired_at IS NULL
          AND origin.latitude BETWEEN -90 AND 90 AND destination.latitude BETWEEN -90 AND 90
          AND origin.longitude BETWEEN -180 AND 180 AND destination.longitude BETWEEN -180 AND 180
        ORDER BY r.route_id LIMIT 1`)).rows[0];
      const service = (await client.query(`SELECT service_code FROM service_types WHERE status='Active' AND deleted_at IS NULL
        AND default_load_type='Cargo' AND service_code IN ('HOTEL_SUPPLY_TRANSFER','RESTAURANT_SUPPLY_PICKUP','RESTAURANT_FOOD_DELIVERY')
        ORDER BY service_type_id LIMIT 1`)).rows[0];
      expect(Boolean(actor && route && service),'Active canonical route, cargo service and real Fleet Manager are required').toBe(true);
      const input = {
        submission_id:submissionId,load_type:'Cargo',service_code:service.service_code,
        pickup_location_id:route.origin_location_id,dropoff_location_id:route.destination_location_id,
        pickup_datetime:new Date(Date.now()+86400000).toISOString(),priority:'Normal',
        cargo_description:'Rollback-only internal Cargo verification',cargo_weight_kg:'0.3',source_department:'Verification',
        lines:[{line_id:'rollback-line',name:'Verification package',expected_quantity:'3',quantity_basis:'TRANSPORT_PACKAGE',unit:'boxes',
          transport_package_count:'3',gross_weight_kg_per_package:'0.1',length_m:'0.2',width_m:'0.2',height_m:'0.2',
          package_can_rotate:false,handling:[],temperature_mode:'NONE'}],
      };
      const session = {user:{employeeId:actor.employee_id,role:'fleet_manager'}};
      await client.query('BEGIN'); transactionOpen = true;
      await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='30s'");
      const sqlMutations = [];
      const adapter = ({failAudit=false}={}) => ({withTransaction:async work=>{
        const savepoint = `internal_intake_${++savepointNumber}`;
        await client.query(`SAVEPOINT ${savepoint}`);
        try {
          const value = await work({query:async(sql,params=[])=>{
            if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) sqlMutations.push(sql.match(/^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/i)?.[1]);
            if (failAudit && /^\s*INSERT INTO audit_logs\b/i.test(sql)) return client.query('SELECT 1/0');
            const result = await client.query(sql,params);
            if (failAudit && /^\s*INSERT INTO transportation_requests\b/i.test(sql)) failedRequestId = result.rows[0].request_id;
            return result;
          }});
          await client.query(`RELEASE SAVEPOINT ${savepoint}`); return value;
        } catch(error) {
          await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await client.query(`RELEASE SAVEPOINT ${savepoint}`); throw error;
        }
      }});
      const created = await createInternalCargoReservation(input,session,{db:adapter()});
      requestId = created.request_id;
      expect(created).toMatchObject({source_system:'INTERNAL',fleet_status:'Pending',idempotent:false,manifest_ref:{kind:'REQUEST',revision:1}});
      expect(Number(created.estimated_distance)).toBe(Number(route.estimated_distance));
      expect(Number(created.estimated_duration)).toBe(Number(route.estimated_duration));
      const counts = async()=>(await client.query(`SELECT
        (SELECT count(*)::int FROM transportation_requests WHERE request_id=$1) AS requests,
        (SELECT count(*)::int FROM request_cargo_manifest_revisions WHERE request_id=$1) AS manifests,
        (SELECT count(*)::int FROM reservation_events WHERE request_id=$1 AND event_type='created') AS events,
        (SELECT count(*)::int FROM audit_logs WHERE resource='transportation_requests' AND resource_id=$1 AND event_key=$2) AS audits`,[requestId,submissionId])).rows[0];
      expect(await counts()).toEqual({requests:1,manifests:1,events:1,audits:1});
      const replayed = await createInternalCargoReservation(input,session,{db:adapter()});
      expect(replayed).toMatchObject({request_id:requestId,manifest_ref:created.manifest_ref,idempotent:true});
      expect(await counts()).toEqual({requests:1,manifests:1,events:1,audits:1});
      await expect(createInternalCargoReservation({...input,cargo_description:'Changed retry'},session,{db:adapter()})).rejects.toMatchObject({status:409,code:'INTERNAL_RESERVATION_REPLAY_CONFLICT'});
      expect(await counts()).toEqual({requests:1,manifests:1,events:1,audits:1});
      await expect(createInternalCargoReservation({...input,submission_id:failedSubmissionId},session,{db:adapter({failAudit:true})})).rejects.toMatchObject({code:'22012'});
      expect((await client.query('SELECT count(*)::int AS count FROM transportation_requests WHERE external_request_id=$1',[`internal:${failedSubmissionId}`])).rows[0].count).toBe(0);
      expect((await client.query('SELECT count(*)::int AS count FROM reservation_events WHERE request_id=$1',[failedRequestId])).rows[0].count).toBe(0);
      expect([...new Set(sqlMutations)].sort()).toEqual(['audit_logs','request_cargo_manifest_revisions','reservation_events','transportation_requests']);
      expect(networkAttempts).toBe(0);
      await client.query('ROLLBACK'); transactionOpen = false;
      const remaining = (await client.query(`SELECT
        (SELECT count(*)::int FROM transportation_requests WHERE external_request_id=ANY($1::text[])) AS requests,
        (SELECT count(*)::int FROM request_cargo_manifest_revisions WHERE source_event_id=ANY($2::text[])) AS manifests,
        (SELECT count(*)::int FROM reservation_events WHERE request_id=ANY($3::int[])) AS events,
        (SELECT count(*)::int FROM audit_logs WHERE event_key=ANY($4::uuid[])) AS audits`,
      [[`internal:${submissionId}`,`internal:${failedSubmissionId}`],[submissionId,failedSubmissionId],[requestId,failedRequestId],[submissionId,failedSubmissionId]])).rows[0];
      expect(remaining).toEqual({requests:0,manifests:0,events:0,audits:0});
    } finally {
      if (transactionOpen) await client.query('ROLLBACK');
      await client.end();
    }
  },60000);
});
