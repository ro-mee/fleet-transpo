import { z } from 'zod';
import { resolveIdentity, AuthError, ok, handleError } from '@/lib/api/utils';
import { assertTripOwnership } from '@/lib/api/ownership';
import { rolesFor } from '@/lib/auth/permissions';
import { authorizeCargoSource } from '@/lib/integration/source-auth';
import { receiptSchema, decisionSchema } from './contracts';
import { manualDecisionSchema } from './manual-decision';
import { storeCargoEvidence } from './evidence-storage';
import * as execution from '@/services/cargo-execution.service';

const MAX_JSON_BYTES = 131072;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const fail = (code, message, status) => { throw new AuthError(message, status, code); };
const unavailable = () => fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo authority is not configured.', 503);
const text = max => z.string().trim().min(1).max(max).refine(value => !/https?:\/\//i.test(value));
const clearanceSchema = z.object({
  receipt_id: z.string().uuid(),
  expected_version: z.number().int().positive(),
  reason: text(2000),
}).strict();
const sourceSchema = decisionSchema.extend({ external_request_id: text(255) }).strict();

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) fail('CARGO_INVALID_INPUT', 'Invalid cargo input.', 400);
  return result.data;
}

// Bound the actual stream before either JSON or multipart parsing buffers it.
async function boundedBytes(req, maximum, code) {
  if (Number(req.headers.get('content-length')) > maximum) {
    fail(code, 'Cargo input is too large.', 400);
  }
  const reader = req.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          fail(code, 'Cargo input is too large.', 400);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function body(req) {
  const bytes = await boundedBytes(req, MAX_JSON_BYTES, 'CARGO_INVALID_INPUT');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail('BAD_REQUEST', 'Invalid JSON body.', 400);
  }
}

async function evidenceForm(req) {
  const bytes = await boundedBytes(req, MAX_UPLOAD_BYTES, 'CARGO_INVALID_IMAGE');
  try {
    return await new Response(bytes, {
      headers: { 'content-type': req.headers.get('content-type') || '' },
    }).formData();
  } catch {
    fail('CARGO_INVALID_IMAGE', 'Invalid cargo photo form.', 400);
  }
}

// Private read projection only. Never apply it to immutable mutation responses.
function privateRead(value) {
  if (Array.isArray(value)) return value.map(privateRead);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/url|contact|phone|email|receiver_name|proof|provenance|safety_evidence_ref|acknowledgement/i.test(key))
    .map(([key, item]) => [key, privateRead(item)]));
}

function safeSourceLink(value, manifest) {
  if (!value || value.kind !== manifest?.manifest_ref?.kind) return null;
  if (value.kind === 'REQUEST' && /^(?:[1-9]\d*)$/.test(String(value.local_id ?? '')) && Number.isSafeInteger(Number(value.local_id))) {
    return { kind: 'REQUEST', local_id: String(value.local_id) };
  }
  if (value.kind === 'SUPPLY' && z.string().uuid().safeParse(value.local_id).success) {
    return { kind: 'SUPPLY', local_id: value.local_id };
  }
  return null;
}

function pagination(req) {
  const options = new URL(req.url).searchParams;
  const allowed = ['history_limit', 'history_offset', 'evidence_id'];
  if ([...options.keys()].some(key => !allowed.includes(key))) {
    fail('CARGO_INVALID_INPUT', 'Unknown cargo read option.', 400);
  }
  const limit = options.get('history_limit') ?? '20';
  const offset = options.get('history_offset') ?? '0';
  if (!/^\d+$/.test(limit) || !/^\d+$/.test(offset) || Number(limit) < 1 || Number(limit) > 50 ||
    !Number.isSafeInteger(Number(offset)) || Number(offset) > 10000) {
    fail('CARGO_INVALID_INPUT', 'Invalid cargo history page.', 400);
  }
  const ids = options.getAll('evidence_id');
  if (ids.length > 5 || new Set(ids).size !== ids.length || ids.some(id => !z.string().uuid().safeParse(id).success)) {
    fail('CARGO_INVALID_INPUT', 'Invalid cargo evidence selection.', 400);
  }
  return { limit: Number(limit), offset: Number(offset), evidenceIds: ids };
}

function handlers(deps) {
  const wrap = work => async (...args) => {
    try {
      if (deps.simulated && process.env.NODE_ENV === 'production') unavailable();
      return await work(...args);
    } catch (error) {
      if (!(error instanceof AuthError) && /^CARGO_/.test(error?.code) && [400, 403, 404, 409, 503].includes(error.status)) {
        error = new AuthError(error.message, error.status, error.code);
      }
      return handleError(error);
    }
  };

  async function actor(req, context, action) {
    const session = await resolveIdentity(req);
    const { id } = await context.params;
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) {
      fail('CARGO_TRIP_NOT_FOUND', 'Cargo trip was not found.', 404);
    }
    const role = session.user.role;
    if (action === 'observe' && role !== 'driver') {
      fail('CARGO_FORBIDDEN', 'Only the assigned driver may record cargo observations.', 403);
    }
    if (!rolesFor('cargo', action).includes(role)) {
      fail('CARGO_FORBIDDEN', 'Cargo action is not permitted.', 403);
    }
    const tripId = Number(id);
    await assertTripOwnership(session, tripId);
    if (role !== 'driver') {
      if (!deps.approvalRef) unavailable();
      if (await deps.authorizeStaff?.({ session, tripId, action, approvalRef: deps.approvalRef }) !== true) {
        fail('CARGO_FORBIDDEN', 'Approved cargo authority is required.', 403);
      }
    }
    return { session, tripId };
  }

  async function approvedAction(session, tripId, action) {
    if (session.user.role === 'driver' || !rolesFor('cargo', action).includes(session.user.role) || !deps.approvalRef) return false;
    return await deps.authorizeStaff?.({ session, tripId, action, approvalRef: deps.approvalRef }) === true;
  }

  return {
    get: wrap(async (req, context) => {
      const { session, tripId } = await actor(req, context, 'read');
      const page = pagination(req);
      const view = await deps.service.getCargoExecution(tripId, session);
      if (!deps.readHistory) unavailable();
      const history = await deps.readHistory({ tripId, session, limit: page.limit, offset: page.offset });
      if (!Array.isArray(history?.rows) || history.rows.length > page.limit) unavailable();
      const data = privateRead({ ...view, history: { rows: history.rows, has_more: history.has_more === true } });
      const latestFeedback = history.latest_feedback;
      data.feedback = latestFeedback ? {
        ...(data.feedback || {}),
        state: latestFeedback.status,
        event_id: latestFeedback.event_id,
        last_error_code: latestFeedback.last_error_code ?? null,
      } : { state: 'NOT_QUEUED', last_error_code: null };
      if (view?.delivery_receipt) data.receiver_confirmed = view.delivery_receipt.receiver_proof != null;
      if (view?.fleet_clearance) data.securement_confirmed = view.fleet_clearance.safety_proof != null;
      const sourceLink = await deps.resolveSourceLink?.({ tripId, session, manifest: view?.manifest });
      const projectedSourceLink = safeSourceLink(sourceLink, view?.manifest);
      if (projectedSourceLink) data.source_link = projectedSourceLink;
      data.capabilities = {
        read: true,
        observe: session.user.role === 'driver',
        clearance: await approvedAction(session, tripId, 'clearance'),
        manual_decision: deps.service.manualDecisionAvailable?.() === true && await approvedAction(session, tripId, 'manual_decision'),
        feedback_retry: rolesFor('integrations', 'execute').includes(session.user.role) && data.feedback.state === 'FAILED' &&
          z.string().uuid().safeParse(data.feedback.event_id).success &&
          await deps.authorizeFeedbackRetry?.({ session, tripId, sourceSystem: view?.manifest?.source_ref?.system,
            organizationId: view?.manifest?.source_ref?.organization_id, eventId: data.feedback.event_id }) === true,
      };
      if (page.evidenceIds.length) {
        if (!deps.signEvidence) unavailable();
        data.evidence = [];
        for (const evidenceId of page.evidenceIds) {
          const signed = await deps.signEvidence({ evidenceId, tripId, session, expiresIn: 300, approvalRef: deps.approvalRef });
          if (!signed?.url || signed.expires_in !== 300) unavailable();
          data.evidence.push({ evidence_id: evidenceId, url: signed.url, expires_in: 300 });
        }
      }
      return ok({ data });
    }),
    receipts: wrap(async (req, context) => {
      const { session, tripId } = await actor(req, context, 'observe');
      const input = parse(receiptSchema, await body(req));
      return ok({ data: await deps.service.submitCargoReceipt(tripId, input, session) });
    }),
    evidence: wrap(async (req, context) => {
      const { session, tripId } = await actor(req, context, 'observe');
      // Refuse unavailable runtime before reading uploaded bytes.
      if (!deps.simulated) unavailable();
      const form = await evidenceForm(req);
      if ([...form.keys()].some(key => !['file', 'submission_id'].includes(key)) ||
        form.getAll('file').length !== 1 || form.getAll('submission_id').length !== 1) {
        fail('CARGO_INVALID_IMAGE', 'A single cargo file and submission are required.', 400);
      }
      const submissionId = parse(z.string().uuid(), form.get('submission_id'));
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function' || file.size > 5 * 1024 * 1024) {
        fail('CARGO_INVALID_IMAGE', 'Invalid cargo image.', 400);
      }
      const stored = await deps.storeEvidence({ file, tripId, submissionId }, session);
      // Task5 tracks the committed object even if this later audit/snapshot
      // transaction fails. Retry reuses its evidence ID and original view.
      if (!deps.service.recordCargoEvidenceUpload) unavailable();
      return ok({ data: await deps.service.recordCargoEvidenceUpload(tripId, stored.evidence_id, session) });
    }),
    clearance: wrap(async (req, context) => {
      const { session, tripId } = await actor(req, context, 'clearance');
      const input = parse(clearanceSchema, await body(req));
      return ok({ data: await deps.service.clearCargoDeparture(tripId, input, session) });
    }),
    manualDecision: wrap(async (req, context) => {
      const { session, tripId } = await actor(req, context, 'manual_decision');
      const input = parse(manualDecisionSchema, await body(req));
      if (!deps.service.recordManualCargoDecision) unavailable();
      // The durable service independently resolves actual source communication
      // inside its transaction; route callbacks cannot invent source authority.
      return ok({ data: await deps.service.recordManualCargoDecision(tripId, input, session) });
    }),
    sourceDecision: wrap(async req => {
      const principal = await authorizeCargoSource(req, {
        credentials: deps.credentials,
        allowSandbox: deps.simulated === true,
        environment: deps.environment,
      });
      if (!principal) fail('SESSION_INVALID', 'Source credentials are required.', 401);
      if (!principal.capabilities.includes('cargo:decision:write')) {
        fail('CARGO_SOURCE_FORBIDDEN', 'Source decision authority is required.', 403);
      }
      const { external_request_id, ...input } = parse(sourceSchema, await body(req));
      if (!deps.resolveSourceRequest) unavailable();
      const tripId = await deps.resolveSourceRequest({ principal, externalRequestId: external_request_id, receiptId: input.receipt_id });
      if (!Number.isSafeInteger(tripId) || tripId <= 0) fail('CARGO_RECEIPT_NOT_FOUND', 'Cargo receipt was not found.', 404);
      return ok({ data: await deps.service.recordSourceDecision(tripId, input, principal) });
    }),
  };
}

// No setter, runtime provider, credentials or factory is installed by routes.
export const cargoApi = handlers({ service: execution, storeEvidence: storeCargoEvidence, credentials: [] });
export function createCargoApi(deps) {
  if (process.env.NODE_ENV === 'production' || deps?.simulated !== true ||
    !['test', 'development'].includes(deps.environment) || !deps.approvalRef?.trim()) unavailable();
  return handlers({ ...deps, service: deps.service ?? execution, storeEvidence: deps.storeEvidence ?? storeCargoEvidence, credentials: deps.credentials ?? [] });
}
