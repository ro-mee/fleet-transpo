import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn() }));
vi.mock('@/lib/api/utils', () => ({
  requirePermission: vi.fn(),
  AuthError: class extends Error { constructor(message, status = 401, code) { super(message); this.status = status; this.code = code; } },
  ok: data => Response.json(data),
  handleError: error => Response.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status ?? 500 }),
}));
import { query } from '@/lib/db';
import { requirePermission } from '@/lib/api/utils';
import { GET } from './route';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const savedRequest = () => {
  const manifest_snapshot = {
    physical_contract_version: 1,
    source_ref: { system: 'PMS', organization_id: 'simulated:hotel', external_request_id: 'request-12' }, service_code: 'HOTEL_SUPPLY_TRANSFER',
    lines: [{ line_id: 'oil', name: 'Kitchen oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '2', unit: 'boxes', reference_image_ref: '22222222-2222-4222-8222-222222222222', handling: [], physical: {
      transport_package_count: 2, package_description: 'sealed boxes', gross_weight_kg_per_package: '0.1', dimensions_m: { length: '0.1', width: '0.2', height: '0.3' }, package_can_rotate: false, temperature_c: null,
    } }],
  };
  return { request_id: 12, load_type: 'Cargo', source_system: 'PMS', external_request_id: 'request-12', service_code: 'HOTEL_SUPPLY_TRANSFER', cargo_weight_kg: '0.2', deleted_at: null,
    request_cargo_manifest_revision_id: '11111111-1111-4111-8111-111111111111', revision: 2, manifest_snapshot, manifest_hash: hash(manifest_snapshot), source_organization_id: 'simulated:hotel',
    pickup_receipt: { secret: 'PRIVATE_PICKUP' }, delivery_receipt: { secret: 'PRIVATE_DELIVERY' }, safety_evidence_ref: 'PRIVATE_PROOF', contact_phone: 'PRIVATE_CONTACT', evidence: [{ url: 'PRIVATE_IMAGE_URL' }],
  };
};
const read = (id = '12') => GET(new Request(`http://localhost/api/integration/transport-requests/${id}/cargo-manifest`), { params: Promise.resolve({ id }) });
beforeEach(() => { vi.clearAllMocks(); requirePermission.mockResolvedValue({ user: { employeeId: 7, role: 'dispatcher' } }); query.mockResolvedValue({ rows: [savedRequest()] }); });

describe('request-owned cargo manifest read', () => {
  it.each([401, 403])('refuses missing/read-denied authorization (%s) before data access', async status => {
    requirePermission.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status }));
    expect((await read()).status).toBe(status);
    expect(requirePermission).toHaveBeenCalledWith(expect.any(Request), 'reservations', 'read');
    expect(query).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '1.5', '12x', '2147483648', '9007199254740992'])('rejects malformed or out-of-contract request ID %s before loading', async id => {
    expect((await read(id)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it('returns not found for absent and soft-deleted requests', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect((await read()).status).toBe(404);
    const deleted = { ...savedRequest(), deleted_at: '2026-10-12T10:00:00Z' };
    query.mockImplementationOnce(async sql => {
      expect(sql).toMatch(/r\.deleted_at IS NULL/);
      return { rows: deleted.deleted_at ? [] : [deleted] };
    });
    expect((await read()).status).toBe(404);
  });
  it.each([{ manifest_snapshot: null }, { load_type: 'Passenger' }])('reports missing contents without inventing physical evidence (%j)', async patch => {
    query.mockResolvedValueOnce({ rows: [{ ...savedRequest(), ...patch }] });
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { manifest: null, availability: 'MISSING' } });
  });
  it('projects the exact source revision and physical facts without image IDs, receipts, contacts or proof', async () => {
    const saved = savedRequest(); query.mockResolvedValueOnce({ rows: [saved] });
    const response = await read();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ availability: 'AVAILABLE', manifest: { manifest_ref: { id: saved.request_cargo_manifest_revision_id, revision: 2, hash: saved.manifest_hash }, physical_contract_version: 1 } });
    expect(body.data.manifest.lines[0]).toMatchObject({ reference_image_ref: null, physical: { transport_package_count: 2, gross_weight_kg_per_package: '0.1' } });
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|22222222-2222-4222-8222-222222222222|pickup_receipt|delivery_receipt|safety_evidence_ref|contact_phone/);
    expect(saved.manifest_snapshot.lines[0].reference_image_ref).toBe('22222222-2222-4222-8222-222222222222');
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]).toEqual([[12]]);
  });
  it.each([{ manifest_hash: 'b'.repeat(64) }, { external_request_id: 'foreign-request' }, { source_system: 'POS' }, { source_organization_id: 'foreign-organization' }, { service_code: 'RESTAURANT_FOOD_DELIVERY' }])('refuses a saved source/hash mismatch (%j)', async patch => {
    query.mockResolvedValueOnce({ rows: [{ ...savedRequest(), ...patch }] });
    const response = await read();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'CARGO_LINKAGE_CONFLICT' });
  });
});
