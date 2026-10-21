import { beforeEach, afterEach, it, expect, vi } from 'vitest';
vi.mock('@/lib/api/utils', () => ({
    resolveIdentity: vi.fn(), AuthError: class extends Error {
        constructor(message, status, code) {
            super(message);
            Object.assign(this, { status, code });
        }
    }, ok: value => Response.json(value), handleError: e => Response.json({ error: e.message, code: e.code }, { status: e.status ?? 500 })
}));
vi.mock('@/lib/api/ownership', () => ({ assertTripOwnership: vi.fn(async (actor, id) => {
        if (id !== 7 || actor.user.role === 'driver' && actor.user.driverId !== 1) {
            throw Object.assign(new Error('Trip not found'), { status: 404 });
        }
        return { trip_id: id };
    }) }));
import { resolveIdentity } from '@/lib/api/utils';
import { createCargoApi, cargoApi } from './api';
import { createCargoReadAdapter } from './read-adapter';
const id = '11111111-1111-4111-8111-111111111111', hash = 'a'.repeat(64);
const driver = { user: {
        role: 'driver', driverId: 1, employeeId: 1
    } }, manager = { user: { role: 'management', employeeId: 2 } }, staff = { user: { role: 'dispatcher', employeeId: 2 } };
const receipt = {
    submission_id: id, manifest_ref: {
        kind: 'REQUEST', id, revision: 1, hash
    }, stage: 'PICKUP', observed_at: '2026-10-09T08:00:00Z', lines: [{
            line_id: 'oil', observed_quantity: '9', condition: 'INTACT', issue_code: 'SHORTAGE', remarks: 'One missing', evidence_ids: []
        }], receiver_confirmation_ref: null
};
const decision = {
    event_id: id, receipt_id: id, manifest_hash: hash, action: 'ACCEPT_OBSERVED', reason: 'Owner accepts nine'
};
const req = (body, suffix = '', headers = {}) => new Request(`http://localhost/api/trips/7/cargo${suffix}`, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined
});
const context = { params: Promise.resolve({ id: '7' }) };
const handover = { version: 1, signer_name: 'Private supplier', signer_role_or_dept: 'Supply', acknowledgment: 'CARGO_HANDOVER_V1', captured_at: '2026-10-09T08:00:00.000Z', signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80]]] }, location: { latitude: 14.6, longitude: 121, accuracy_m: 20, captured_at: '2026-10-09T08:00:00.000Z' } };
let api;
beforeEach(() => {
    resolveIdentity.mockResolvedValue(driver);
    api = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture:api', service: { submitCargoReceipt: async (_id, input) => ({ trip_id: 7, submission_id: input.submission_id }), getCargoExecution: async () => ({
                trip_id: 7, receiver_contact: 'secret', pickup_receipt: { evidence_ids: [id] }
            }) }, authorizeStaff: async () => true, readHistory: async () => ({ rows: [{
                    receipt_id: id, receiver_contact: 'secret', signed_url: 'https://secret'
                }], has_more: true }), signEvidence: async () => ({ url: 'https://private', expires_in: 300 })
    });
});
afterEach(() => vi.unstubAllEnvs());
it('uses actual promised params and records own-driver observations', async () => {
    const response = await api.receipts(req(receipt), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { trip_id: 7, submission_id: id } });
});
it.each(['driver', 'management', 'super_admin'])('only exposes current handovers on an explicitly authorized %s detail request', async role => {
    resolveIdentity.mockResolvedValue({ user: { ...driver.user, role } });
    const row = { receipt_id: id, stage: 'PICKUP', received_at: '2026-10-09T08:01:00.000Z', observed_at: receipt.observed_at, manifest_ref: receipt.manifest_ref, payload: { ...receipt, handover }, reporter_employee_id: 1, secret: 'hidden' };
    const detailed = createCargoApi({ simulated: true, environment: 'test', approvalRef: 'fixture:api', authorizeStaff: async () => true, service: { getCargoExecution: async () => ({ trip_id: 7, pickup_receipt: row, arbitrary: { handover, signer_name: 'Private supplier', signature: handover.signature, latitude: 14.6 } }) }, readHistory: async () => ({ rows: [{ handover, receiver_name: 'Private supplier' }] }) });
    const ordinaryResponse = await detailed.get(req(), context);
    const ordinary = await ordinaryResponse.json();
    expect(ordinaryResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(JSON.stringify(ordinary)).not.toMatch(/CARGO_HANDOVER_V1|Private supplier|strokes|latitude/);
    expect(ordinary.data.handovers).toBeUndefined();
    const response = await detailed.get(req(null, '?include_handovers=1'), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.handovers).toEqual({ pickup: { receipt_id: id, stage: 'PICKUP', received_at: row.received_at, observed_at: receipt.observed_at, manifest_ref: receipt.manifest_ref, lines: receipt.lines.map(({ evidence_ids: _evidence, ...line }) => line), handover }, delivery: null });
    expect(body.data.pickup_receipt.payload.handover).toBeUndefined();
    expect(body.data.handovers.pickup.reporter_employee_id).toBeUndefined();
});
it.each(['0', 'true', '2', '1&include_handovers=1'])('rejects unsupported explicit handover detail selection %s', async option => {
    expect((await api.get(req(null, `?include_handovers=${option}`), context)).status).toBe(400);
});
it('keeps historical unsigned detail empty and production authority disabled', async () => {
    expect((await (await api.get(req(null, '?include_handovers=1'), context)).json()).data.handovers).toEqual({ pickup: null, delivery: null });
    expect((await cargoApi.get(req(null, '?include_handovers=1'), context)).status).toBe(503);
    expect((await api.get(req(null, '?include_handovers=1'), { params: Promise.resolve({ id: '8' }) })).status).toBe(404);
});
it('refuses foreign trip with 404', async () => expect((await api.get(req(), { params: Promise.resolve({ id: '8' }) })).status).toBe(404));
it('refuses foreign driver with 404', async () => {
    resolveIdentity.mockResolvedValue({ user: { ...driver.user, driverId: 9 } });
    expect((await api.receipts(req(receipt), context)).status).toBe(404);
});
it('refuses unauthenticated callers', async () => {
    resolveIdentity.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401, code: 'SESSION_INVALID' }));
    expect((await api.get(req(), context)).status).toBe(401);
});
it.each(['driver_id', 'employee_id', 'signed_url', 'source_system'])('strictly refuses caller %s', async (key) => expect((await api.receipts(req({ ...receipt, [key]: 'forged' }), context)).status).toBe(400));
it('manager reads but cannot observe', async () => {
    resolveIdentity.mockResolvedValue(manager);
    expect((await api.get(req(), context)).status).toBe(200);
    expect((await api.receipts(req(receipt), context)).status).toBe(403);
});
it.each(['driver', 'management', 'mechanic'])('denies %s clearance and self approval', async (role) => {
    resolveIdentity.mockResolvedValue({ user: { ...driver.user, role } });
    expect((await api.clearance(req({
        receipt_id: id, expected_version: 1, reason: 'Checked'
    }), context)).status).toBe(403);
    expect((await api.manualDecision(req(decision), context)).status).toBe(403);
});
it('staff role alone cannot authorize clearance', async () => {
    resolveIdentity.mockResolvedValue(staff);
    const restricted = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture:api', authorizeStaff: async () => false
    });
    expect((await restricted.clearance(req({
        receipt_id: id, expected_version: 1, reason: 'Checked'
    }), context)).status).toBe(403);
});
it('default runtime authenticates and refuses valid observation with stable503', async () => {
    const response = await cargoApi.receipts(req(receipt), context);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('CARGO_CONFIGURATION_REQUIRED');
});
it('rejects simulated API injection in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture'
    })).toThrow();
});
it('bounds pagination and omits contact and URLs from history', async () => {
    const response = await api.get(req(null, '?history_limit=1'), context);
    const body = await response.json();
    expect(body.data.history).toEqual({ rows: [{ receipt_id: id }], has_more: true });
    expect(body.data.receiver_contact).toBeUndefined();
    expect((await api.get(req(null, '?history_limit=51'), context)).status).toBe(400);
});
it('projects only a persisted local source link, safe review metadata, and server-authorized feedback retry', async () => {
    resolveIdentity.mockResolvedValue({ user: { role: 'admin', employeeId: 2 } });
    const sourceManifest = {
        manifest_ref: { kind: 'SUPPLY', id, revision: 1, hash },
        source_ref: { system: 'SCM', organization_id: 'fixture:scm', external_request_id: 'must-not-become-a-link' },
        service_code: 'HOTEL_SUPPLY_TRANSFER', lines: []
    };
    const authorizeFeedbackRetry = vi.fn(async () => true);
    const projected = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture:api',
        authorizeStaff: async () => true,
        service: { getCargoExecution: async () => ({
            trip_id: 7, manifest: sourceManifest,
            pickup_receipt: { receipt_id: id, receiver_proof: { token: 'hidden' } },
            delivery_receipt: { receiver_proof: { phone: 'hidden' } },
            source_decision: { action: 'WAIT', manual_provenance: { approver_identity: 'private identity' } },
            fleet_clearance: { safety_proof: { token: 'hidden' }, safety_evidence_ref: 'private-ref' },
            receiver_contact: 'private contact'
        }) },
        readHistory: async () => ({ rows: [{ event_id: id, event_type: 'PARTNER_FEEDBACK', status: 'FAILED' }], latest_feedback: { event_id: id, status: 'FAILED', last_error_code: 'GATEWAY_TIMEOUT' } }),
        resolveSourceLink: async () => ({ kind: 'SUPPLY', local_id: '22222222-2222-4222-8222-222222222222', href: 'https://unsafe.test' }),
        authorizeFeedbackRetry
    });

    const body = await (await projected.get(req(), context)).json();
    expect(body.data.source_link).toEqual({ kind: 'SUPPLY', local_id: '22222222-2222-4222-8222-222222222222' });
    expect(body.data.source_link.href).toBeUndefined();
    expect(body.data.capabilities.feedback_retry).toBe(true);
    expect(authorizeFeedbackRetry).toHaveBeenCalledWith(expect.objectContaining({ tripId: 7, eventId: id, sourceSystem: 'SCM' }));
    expect(body.data.receiver_contact).toBeUndefined();
    expect(body.data.delivery_receipt.receiver_proof).toBeUndefined();
    expect(body.data.source_decision.manual_provenance).toBeUndefined();
    expect(body.data.fleet_clearance.safety_proof).toBeUndefined();
    expect(body.data.fleet_clearance.safety_evidence_ref).toBeUndefined();
});
it('does not enable feedback retry for a role outside integration execution scope', async () => {
    resolveIdentity.mockResolvedValue(driver);
    const authorizeFeedbackRetry = vi.fn(async () => true);
    const restricted = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture:api',
        service: { getCargoExecution: async () => ({ trip_id: 7, manifest: { source_ref: { system: 'POS', organization_id: 'o' } } }) },
        readHistory: async () => ({ rows: [], latest_feedback: { event_id: id, status: 'FAILED' } }),
        authorizeFeedbackRetry
    });
    const body = await (await restricted.get(req(), context)).json();
    expect(body.data.capabilities.feedback_retry).toBe(false);
    expect(authorizeFeedbackRetry).not.toHaveBeenCalled();
});
it('signs only explicit bounded detail reads', async () => {
    const response = await api.get(req(null, `?evidence_id=${id}`), context);
    expect((await response.json()).data.evidence).toEqual([{
            evidence_id: id, url: 'https://private', expires_in: 300
        }]);
});
it('manual decision requires actual approver and communication evidence', async () => {
    resolveIdentity.mockResolvedValue(staff);
    expect((await api.manualDecision(req(decision), context)).status).toBe(400);
});
it('machine decision refuses invalid bearer without calling cookie auth', async () => {
    resolveIdentity.mockClear();
    const response = await api.sourceDecision(req({ ...decision, external_request_id: 'r1' }, '', { authorization: 'Bearer invalid' }));
    expect(response.status).toBe(401);
    expect(resolveIdentity).not.toHaveBeenCalled();
});
it('redacts private handovers from machine source-decision responses and exact HTTP retries without changing saved snapshots', async () => {
    const snapshot = { trip_id: 7, version: 3, source_decision: { decision_id: id, action: decision.action }, pickup_receipt: { receipt_id: id, stage: 'PICKUP', payload: { ...receipt, handover } } };
    const machine = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture', credentials: [{ secret: 'fixture', system: 'PMS', organization_id: 'hotel', subject: 'owner', approval_ref: 'fixture', simulated: true, capabilities: ['cargo:decision:write'] }],
        resolveSourceRequest: async () => 7,
        service: { recordSourceDecision: async () => snapshot }
    });
    const request = () => req({ ...decision, external_request_id: 'r1' }, '', { authorization: 'Bearer fixture' });
    const firstResponse = await machine.sourceDecision(request());
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('cache-control')).toBe('private, no-store');
    const first = await firstResponse.json();
    expect(first.data).toMatchObject({ trip_id: 7, version: 3, pickup_receipt: { receipt_id: id, stage: 'PICKUP' }, source_decision: { action: 'ACCEPT_OBSERVED' } });
    expect(JSON.stringify(first)).not.toMatch(/CARGO_HANDOVER_V1|Private supplier|handover|signer_name|signature|strokes|latitude|longitude|accuracy_m/);
    const replayResponse = await machine.sourceDecision(request());
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual(first);
    expect(snapshot.pickup_receipt.payload.handover).toEqual(handover);
});
it('resolves source trip only from persisted credential-bound request and receipt', async () => {
    const principal = { system: 'PMS', organization_id: 'fixture:hotel' }, queries = [];
    const adapter = createCargoReadAdapter({
        simulated: true, environment: 'test', approvalRef: 'fixture:read', db: { query: async (sql, values) => {
                queries.push({ sql, values });
                return { rows: [{ trip_id: 7 }] };
            } }
    });
    expect(await adapter.resolveSourceRequest({
        principal, externalRequestId: 'r1', receiptId: id
    })).toBe(7);
    expect(queries[0].values).toEqual(['PMS', 'fixture:hotel', 'r1', id]);
    expect(queries[0].sql).toContain('JOIN cargo_receipts');
});
it('cannot use a route-level callback to fabricate manual authority', async () => {
    resolveIdentity.mockResolvedValue(staff);
    const input = {
        ...decision, approver_identity: 'Owner', approver_reference: 'owner-record', communicated_at: '2026-10-09T08:00:00Z', communication_evidence_ids: [id]
    };
    const recordManualDecision = vi.fn(async () => ({ trip_id: 7 }));
    const manual = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture:api', authorizeStaff: async () => true, resolveManualAuthority: async () => ({ authorized: false }), recordManualDecision
    });
    expect((await manual.manualDecision(req(input), context)).status).toBe(503);
    expect(recordManualDecision).not.toHaveBeenCalled();
});
it('does not permit admin observation without an approved correction contract', async () => {
    resolveIdentity.mockResolvedValue({ user: { role: 'super_admin', employeeId: 2 } });
    expect((await api.receipts(req(receipt), context)).status).toBe(403);
});
it('refuses a retained simulated seam after production environment changes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await api.get(req(), context)).status).toBe(503);
});
it('returns foreign evidence404 from the scoped signer', async () => {
    const scoped = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture', service: { getCargoExecution: async () => ({ trip_id: 7 }) }, readHistory: async () => ({ rows: [] }), signEvidence: async () => {
            throw Object.assign(new Error('Evidence not found'), { code: 'CARGO_EVIDENCE_NOT_FOUND', status: 404 });
        }
    });
    expect((await scoped.get(req(null, `?evidence_id=${id}`), context)).status).toBe(404);
});
it('does not replace the durable service with a canned manual callback', async () => {
    resolveIdentity.mockResolvedValue(staff);
    let recorded;
    const input = {
        ...decision, approver_identity: 'Owner', approver_reference: 'owner-record', communicated_at: '2026-10-09T08:00:00Z', communication_evidence_ids: [id]
    };
    const manual = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture', authorizeStaff: async () => true, resolveManualAuthority: async () => ({ authorized: true, reference: 'resolved-communication' }), recordManualDecision: async (command) => {
            recorded = command;
            return { trip_id: 7 };
        }
    });
    expect((await manual.manualDecision(req(input), context)).status).toBe(503);
    expect(recorded).toBeUndefined();
});
it('bounds actual multipart streamed bytes before attempting to parse them', async () => {
    let cancelled = false, chunks = 0;
    const stream = new ReadableStream({ pull(controller) {
            if (chunks++ === 8) {
                controller.close();
                return;
            }
            controller.enqueue(new Uint8Array(1024 * 1024));
        }, cancel() {
            cancelled = true;
        } });
    const request = new Request('http://localhost/api/trips/7/cargo/evidence', {
        method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=fixture' }
    });
    const response = await api.evidence(request, context);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('CARGO_INVALID_IMAGE');
    expect(cancelled).toBe(true);
});
it('returns upload CargoExecutionView and retained server evidence ID', async () => {
    const form = new FormData();
    form.append('submission_id', id);
    form.append('file', new File([new Uint8Array([255, 216, 255])], 'photo.jpg', { type: 'image/jpeg' }));
    const upload = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture', storeEvidence: async () => ({ evidence_id: id }), service: { recordCargoEvidenceUpload: async () => ({
                execution_id: id, trip_id: 7, version: 1, manifest: { manifest_ref: { id } }, evidence_upload: { evidence_id: id }
            }) }
    });
    const response = await upload.evidence(new Request('http://localhost/api/trips/7/cargo/evidence', { method: 'POST', body: form }), context);
    expect(await response.json()).toMatchObject({ data: {
            execution_id: id, trip_id: 7, evidence_upload: { evidence_id: id }
        } });
});
it.each(['trip_id', 'system', 'organization_id', 'actor_id'])('machine schema denies caller %s', async (key) => {
    const machine = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture', credentials: [{
                secret: 'fixture', system: 'PMS', organization_id: 'hotel', subject: 'owner', approval_ref: 'fixture', simulated: true, capabilities: ['cargo:decision:write']
            }]
    });
    expect((await machine.sourceDecision(req({
        ...decision, external_request_id: 'r1', [key]: 'forged'
    }, '', { authorization: 'Bearer fixture' }))).status).toBe(400);
});
it('bounds source decision payload bytes', async () => {
    const machine = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture', credentials: [{
                secret: 'fixture', system: 'PMS', organization_id: 'hotel', subject: 'owner', approval_ref: 'fixture', simulated: true, capabilities: ['cargo:decision:write']
            }]
    });
    expect((await machine.sourceDecision(req({
        ...decision, external_request_id: 'r1', reason: 'x'.repeat(131073)
    }, '', { authorization: 'Bearer fixture' }))).status).toBe(400);
});
it('provides read capabilities from approved action authority rather than role alone', async () => {
    resolveIdentity.mockResolvedValue(staff);
    const scoped = createCargoApi({
        simulated: true, environment: 'test', approvalRef: 'fixture', service: { getCargoExecution: async () => ({ trip_id: 7 }) }, readHistory: async () => ({ rows: [] }), authorizeStaff: async ({ action }) => action === 'read'
    });
    const response = await scoped.get(req(), context);
    expect((await response.json()).data.capabilities).toEqual({
        read: true, observe: false, clearance: false, manual_decision: false, feedback_retry: false
    });
});
