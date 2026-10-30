import { cargoError } from '@/services/cargo-manifest.service';
import { assertCargoDriver } from '@/services/cargo-execution.repository';
import { INTERNAL_CARGO_CONFIG } from './internal-policy';
import { assertInternalCargoTrip } from '@/services/cargo-internal-authority';
import { withTransaction } from '@/lib/db';

// The historical external adapter remains an explicit nonproduction fixture.
export function createCargoReadAdapter({db,config,simulated,environment,approvalRef,authorizeStaffRead}) {
  const configured=()=>{
    if(process.env.NODE_ENV==='production'||simulated!==true||!['test','development'].includes(environment)||!approvalRef?.trim())throw cargoError('CARGO_CONFIGURATION_REQUIRED','Cargo read authority is not configured.',503);
  };
  configured();
  return createReadAdapter({ db, config, configured, approvalRef, authorizeStaffRead });
}

export function createInternalCargoReadAdapter({ db }) {
  return createReadAdapter({ db, config: INTERNAL_CARGO_CONFIG, internal: true,
    configured: () => { if (typeof window !== 'undefined') throw cargoError('CARGO_FORBIDDEN', 'Cargo reads are server-only.', 403); },
  });
}

function createReadAdapter({db,config,configured,approvalRef,authorizeStaffRead,internal=false}) {
  async function authorize(tripId,session,tx) {
    if(internal) await assertInternalCargoTrip(tripId,session,tx);
    else if(session?.user?.role==='driver') await assertCargoDriver(tripId,session,tx);
    else if(!authorizeStaffRead||await authorizeStaffRead({tripId,session,tx,approvalRef})!==true)throw cargoError('CARGO_FORBIDDEN','Approved cargo read authority is required.',403);
  }
  return {
    async resolveSourceRequest({principal,externalRequestId,receiptId}) {
      configured();
      const rows=(await db.query(`SELECT x.trip_id FROM cargo_trip_executions x
        JOIN cargo_receipts r ON r.execution_id=x.execution_id
        WHERE x.manifest->'source_ref'->>'system'=$1
          AND x.manifest->'source_ref'->>'organization_id'=$2
          AND x.manifest->'source_ref'->>'external_request_id'=$3
          AND r.receipt_id=$4 LIMIT 2`,[principal.system,principal.organization_id,externalRequestId,receiptId])).rows;
      return rows.length===1?rows[0].trip_id:null;
    },
    async readHistory({tripId,session,limit,offset}) {
      configured();
      if(!Number.isSafeInteger(tripId)||!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>10000)throw cargoError('CARGO_INVALID_INPUT','Invalid cargo history page.',400);
      return db.withTransaction(async base=>{
        const tx={...base,cargoConfig:config};
        await authorize(tripId,session,tx);
        const rows=(await tx.query(`WITH events AS (
            SELECT r.receipt_id::text AS event_id,
              CASE r.stage WHEN 'PICKUP' THEN 'PICKUP_RECORDED' ELSE 'DELIVERY_RECORDED' END AS event_type,
              r.execution_version,r.received_at AS occurred_at,r.stage,NULL::text AS action,NULL::text AS status,NULL::text AS last_error_code
            FROM cargo_receipts r JOIN cargo_trip_executions x USING(execution_id) WHERE x.trip_id=$1
            UNION ALL
            SELECT d.decision_id::text,'SOURCE_DECISION_RECORDED',d.execution_version,d.created_at,
              NULL::text,d.action,NULL::text,NULL::text
            FROM cargo_decisions d JOIN cargo_receipts r USING(receipt_id) JOIN cargo_trip_executions x USING(execution_id) WHERE x.trip_id=$1
            UNION ALL
            SELECT c.clearance_id::text,'FLEET_CLEARANCE_RECORDED',c.version,c.created_at,
              NULL::text,NULL::text,NULL::text,NULL::text
            FROM cargo_fleet_clearances c JOIN cargo_trip_executions x USING(execution_id) WHERE x.trip_id=$1
            ${internal ? `UNION ALL
            SELECT review.review_id::text,'INTERNAL_'||review.kind||'_REVIEW',review.execution_version,review.reviewed_at,
              NULL::text,review.action,NULL::text,NULL::text
            FROM cargo_internal_reviews review JOIN cargo_trip_executions x USING(execution_id) WHERE x.trip_id=$1` : ''}
            ${internal ? '' : `UNION ALL
            SELECT f.event_id::text,'PARTNER_FEEDBACK',f.execution_version,COALESCE(f.acknowledged_at,f.created_at),
              NULL::text,NULL::text,f.status,f.last_error_code
            FROM cargo_feedback_outbox f JOIN cargo_trip_executions x USING(execution_id) WHERE x.trip_id=$1`}
          )
          SELECT event_id,event_type,execution_version,occurred_at,stage,action,status,last_error_code
          FROM events ORDER BY occurred_at DESC,event_id LIMIT $2 OFFSET $3`,[tripId,limit+1,offset])).rows;
        const latestFeedback=internal ? null : (await tx.query(`SELECT event_id::text,status,last_error_code
          FROM cargo_feedback_outbox f JOIN cargo_trip_executions x USING(execution_id)
          WHERE x.trip_id=$1 ORDER BY f.execution_version DESC,f.created_at DESC,f.event_id LIMIT 1`,[tripId])).rows[0]??null;
        return {rows:rows.slice(0,limit),has_more:rows.length>limit,latest_feedback:latestFeedback};
      });
    },
    async resolveSourceLink({tripId,session}) {
      configured();
      if(!Number.isSafeInteger(tripId)||tripId<1)throw cargoError('CARGO_INVALID_INPUT','Invalid cargo trip.',400);
      return db.withTransaction(async base=>{
        const tx={...base,cargoConfig:config};
        await authorize(tripId,session,tx);
        const rows=(await tx.query(`SELECT linked.kind,linked.local_id FROM (
            SELECT 'REQUEST'::text AS kind,m.request_id::text AS local_id
            FROM cargo_trip_executions e JOIN trips t ON t.trip_id=e.trip_id
            JOIN dispatchschedules d ON d.dispatch_id=t.dispatch_id
            JOIN request_cargo_manifest_revisions m ON m.request_cargo_manifest_revision_id=e.request_manifest_id
            JOIN transportation_requests r ON r.request_id=d.request_id AND r.request_id=m.request_id AND r.deleted_at IS NULL
            WHERE e.trip_id=$1 AND e.supply_allocation_id IS NULL
              AND e.manifest->'manifest_ref'->>'kind'='REQUEST'
              AND e.manifest->'manifest_ref'->>'id'=m.request_cargo_manifest_revision_id::text
              AND e.manifest->'manifest_ref'->>'revision'=m.revision::text
              AND e.manifest->'manifest_ref'->>'hash'=m.manifest_hash
            UNION ALL
            SELECT 'SUPPLY'::text,s.supply_shipment_id::text
            FROM cargo_trip_executions e JOIN trips t ON t.trip_id=e.trip_id
            JOIN supply_dispatch_allocations a ON a.supply_dispatch_allocation_id=e.supply_allocation_id AND a.dispatch_id=t.dispatch_id
            JOIN supply_shipments s ON s.supply_shipment_id=a.supply_shipment_id
            JOIN supply_manifest_revisions m ON m.supply_shipment_id=a.supply_shipment_id AND m.manifest_revision=a.manifest_revision
            WHERE e.trip_id=$1 AND e.request_manifest_id IS NULL
              AND e.manifest->'manifest_ref'->>'kind'='SUPPLY'
              AND e.manifest->'manifest_ref'->>'id'=m.supply_manifest_revision_id::text
              AND e.manifest->'manifest_ref'->>'revision'=m.manifest_revision::text
              AND e.manifest->'manifest_ref'->>'hash'=m.manifest_hash
          ) linked LIMIT 2`,[tripId])).rows;
        return rows.length===1?rows[0]:null;
      });
    },
  };
}

export function readInternalCargoHistory(input) {
  return createInternalCargoReadAdapter({ db: { withTransaction } }).readHistory(input);
}
export function resolveInternalCargoSourceLink(input) {
  return createInternalCargoReadAdapter({ db: { withTransaction } }).resolveSourceLink(input);
}
