import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '@/lib/db';
import { AuthError } from '@/lib/api/utils';
import { validateCargoFeedbackEnvelope, cargoFeedbackAckSchema } from '@/lib/cargo/feedback-contract';

const fail = (code, message, status = 409) => { throw new AuthError(message, status, code); };
const retryMinutes = attempt => [1, 5, 15, 60][attempt - 1] ?? 60;
const safeErrorCode = error => /^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code || '') ? error.code : (error?.code === 'GATEWAY_TIMEOUT' ? 'GATEWAY_TIMEOUT' : 'GATEWAY_DELIVERY_FAILED');
const defaultDb = { query, withTransaction };

function createWorker({ db = defaultDb, gateway = null, environment = process.env.NODE_ENV } = {}) {
  if (gateway && (environment === 'production' || !['test', 'development'].includes(environment))) {
    fail('CARGO_CONFIGURATION_REQUIRED', 'Injected gateways are limited to nonproduction fixtures.', 503);
  }
  return {
    async deliverCargoFeedback({ batchSize = 50, now = new Date() } = {}) {
      if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) fail('CARGO_INVALID_INPUT', 'Batch size must be between 1 and 100.', 400);
      const clock = new Date(now);
      if (Number.isNaN(clock.getTime())) fail('CARGO_INVALID_INPUT', 'Worker time is invalid.', 400);
      if (!gateway) fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo partner gateway is not configured.', 503);
      const token = randomUUID();
      const leased = await db.withTransaction(async tx => {
        const { rows } = await tx.query(`WITH due AS (
            SELECT o.event_id FROM cargo_feedback_outbox o
             WHERE o.status='PENDING' AND o.next_attempt_at <= $1
               AND (o.lease_token IS NULL OR o.lease_expires_at <= $1)
               AND NOT EXISTS (
                 SELECT 1 FROM cargo_feedback_outbox older
                  WHERE older.execution_id=o.execution_id
                    AND (older.execution_version,older.created_at,older.event_id) < (o.execution_version,o.created_at,o.event_id)
                    AND older.status <> 'ACKNOWLEDGED'
               )
             ORDER BY o.next_attempt_at,o.created_at,o.event_id
             FOR UPDATE SKIP LOCKED LIMIT $2
          )
          UPDATE cargo_feedback_outbox o SET lease_token=$3,lease_expires_at=$1 + interval '2 minutes',attempts=o.attempts+1
            FROM due WHERE o.event_id=due.event_id RETURNING o.*`, [clock, batchSize, token]);
        return rows;
      });
      let acknowledged=0, pending=0, failed=0;
      for (const row of leased) {
        try {
          const event = validateCargoFeedbackEnvelope({ event_id: row.event_id, payload: row.payload, payload_hash: row.payload_hash, attempt: row.attempts });
          if (event.payload.execution_id !== row.execution_id || event.payload.execution_version !== row.execution_version || event.payload.source_ref.system !== row.source_system || event.payload.source_ref.organization_id !== row.source_organization_id) fail('CARGO_EVENT_CONFLICT', 'Stored event identity does not match its payload.');
          const ackResult = cargoFeedbackAckSchema.safeParse(await gateway.send(event));
          if (!ackResult.success) fail('GATEWAY_ACK_INVALID', 'Partner acknowledgement was malformed.', 502);
          const ack = ackResult.data;
          if (ack.event_id !== row.event_id || ack.received !== true) fail('GATEWAY_ACK_INVALID', 'Partner acknowledgement did not match the event.', 502);
          const updated = await db.withTransaction(tx => tx.query(`UPDATE cargo_feedback_outbox SET status='ACKNOWLEDGED',acknowledgement=$1::jsonb,
            acknowledged_at=$2,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL WHERE event_id=$3 AND lease_token=$4`, [JSON.stringify(ack), clock, row.event_id, token]));
          if (updated.rowCount) acknowledged++;
          else pending++;
        } catch (error) {
          const attempts = Number(row.attempts);
          const isFinal = attempts >= 10;
          const code = safeErrorCode(error);
          const next = new Date(clock.getTime() + retryMinutes(attempts) * 60_000);
          const updated = await db.withTransaction(tx => tx.query(`UPDATE cargo_feedback_outbox SET status=$1,next_attempt_at=$2,lease_token=NULL,
            lease_expires_at=NULL,last_error_code=$3 WHERE event_id=$4 AND lease_token=$5`, [isFinal ? 'FAILED' : 'PENDING', next, code, row.event_id, token]));
          if (updated.rowCount) isFinal ? failed++ : pending++;
          else pending++;
        }
      }
      return { acknowledged, pending, failed };
    },
  };
}

export const createCargoFeedbackWorker = createWorker;
export async function deliverCargoFeedback({ batchSize = 50, now = new Date(), gateway = null } = {}) {
  return createWorker({ gateway }).deliverCargoFeedback({ batchSize, now });
}

async function listFeedback(db, { tripId, sourceSystem, organizationId, limit = 50 }) {
  if (!Number.isSafeInteger(tripId) || tripId < 1 || !['PMS','POS','SCM'].includes(sourceSystem) || typeof organizationId !== 'string' || !organizationId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('CARGO_INVALID_INPUT', 'Feedback scope is invalid.', 400);
  const { rows } = await db.query(`SELECT o.event_id,o.execution_version,o.event_type,o.status,o.attempts,o.next_attempt_at,o.acknowledged_at,o.last_error_code,o.created_at
    FROM cargo_feedback_outbox o JOIN cargo_trip_executions e USING(execution_id)
    WHERE e.trip_id=$1 AND o.source_system=$2 AND o.source_organization_id=$3 ORDER BY o.created_at DESC LIMIT $4`, [tripId,sourceSystem,organizationId,limit]);
  return rows;
}

async function retryFeedback(db, { eventId, tripId, sourceSystem, organizationId }) {
  if (!Number.isSafeInteger(tripId) || tripId < 1 || !/^[0-9a-f-]{36}$/i.test(eventId || '') || !['PMS','POS','SCM'].includes(sourceSystem) || typeof organizationId !== 'string' || !organizationId.trim()) fail('CARGO_INVALID_INPUT', 'Feedback scope is invalid.', 400);
  return db.withTransaction(async tx => {
    const { rows } = await tx.query(`UPDATE cargo_feedback_outbox o SET status='PENDING',next_attempt_at=now(),last_error_code=NULL
      FROM cargo_trip_executions e WHERE o.execution_id=e.execution_id AND e.trip_id=$1 AND o.event_id=$2
        AND o.source_system=$3 AND o.source_organization_id=$4 AND o.status='FAILED' AND o.lease_token IS NULL
      RETURNING o.event_id,o.status,o.attempts,o.next_attempt_at`, [tripId,eventId,sourceSystem,organizationId]);
    if (!rows[0]) fail('CARGO_FEEDBACK_NOT_FOUND', 'Retryable feedback was not found in this trip and source scope.', 404);
    return rows[0];
  });
}

export function createCargoFeedbackStaffFixture({ db, config, environment = process.env.NODE_ENV } = {}) {
  if (environment === 'production' || !['test','development'].includes(environment) || config?.simulated !== true || !config?.approvalRef?.trim() || typeof db?.query !== 'function' || typeof db?.withTransaction !== 'function') {
    fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo feedback staff authority is not configured.', 503);
  }
  return {
    listCargoFeedback: input => listFeedback(db,input),
    retryCargoFeedback: input => retryFeedback(db,input),
  };
}

// No runtime staff provider is installed; API routes stay closed until one is approved.
export async function listCargoFeedback() { fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo feedback read authority is not configured.', 503); }
export async function retryCargoFeedback() { fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo feedback retry authority is not configured.', 503); }
