import { cargoError } from '@/services/cargo-manifest.service';
import { assertCargoDriver } from '@/services/cargo-execution.repository';

// Explicit fixture adapter only; routes do not install a database provider.
export function createCargoReadAdapter({db,config,simulated,environment,approvalRef,authorizeStaffRead}) {
  const configured=()=>{
    if(process.env.NODE_ENV==='production'||simulated!==true||!['test','development'].includes(environment)||!approvalRef?.trim())throw cargoError('CARGO_CONFIGURATION_REQUIRED','Cargo read authority is not configured.',503);
  };
  configured();
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
        if(session?.user?.role==='driver')await assertCargoDriver(tripId,session,tx);
        else if(!authorizeStaffRead||await authorizeStaffRead({tripId,session,tx,approvalRef})!==true)throw cargoError('CARGO_FORBIDDEN','Approved cargo read authority is required.',403);
        const rows=(await tx.query(`SELECT r.receipt_id,r.stage,r.execution_version,r.received_at
          FROM cargo_receipts r JOIN cargo_trip_executions x USING(execution_id)
          WHERE x.trip_id=$1 ORDER BY r.execution_version DESC,r.receipt_id LIMIT $2 OFFSET $3`,[tripId,limit+1,offset])).rows;
        return {rows:rows.slice(0,limit),has_more:rows.length>limit};
      });
    },
  };
}
