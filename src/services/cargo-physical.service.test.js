import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn() }));
vi.mock('@/lib/api/utils', () => ({ AuthError: class extends Error { constructor(message, status = 401, code) { super(message); this.status = status; this.code = code; } } }));
import { assertCargoPhysicalAssignment, loadCargoPhysicalAssessments } from './cargo-physical.service';
import { cargoPhysicalConflict } from '@/lib/cargo/physical-policy';

const now = new Date('2026-10-13T12:00:00Z');
const policy = (mode = 'ENFORCE') => ({ cargoPhysical: { mode, version: 'simulated:packaged-v1', vehicleStandardsApprovalRef: 'simulated:vehicles', sourceContractApprovalRef: 'simulated:source', massBasisApprovalRef: 'simulated:mass' } });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const saved = () => {
  const manifest_snapshot = { physical_contract_version: 1, source_ref: { system: 'PMS', organization_id: 'simulated:hotel', external_request_id: 'request-12' }, service_code: 'HOTEL_SUPPLY_TRANSFER',
    lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'UNIT', expected_quantity: '100', unit: 'bottles', reference_image_ref: null, handling: [], physical: { transport_package_count: 2, package_description: null, gross_weight_kg_per_package: '0.1', dimensions_m: { length: '0.1', width: '0.2', height: '0.3' }, package_can_rotate: false, temperature_c: null } }],
  };
  return { request_id: 12, load_type: 'Cargo', source_system: 'PMS', external_request_id: 'request-12', service_code: 'HOTEL_SUPPLY_TRANSFER', cargo_weight_kg: '0.2', request_cargo_manifest_revision_id: '11111111-1111-4111-8111-111111111111', revision: 1, source_organization_id: 'simulated:hotel', manifest_snapshot, manifest_hash: createHash('sha256').update(JSON.stringify(canonical(manifest_snapshot))).digest('hex') };
};
const profile = (patch = {}) => ({ vehicle_id: 7, vehicle_status: 'Available', supports_supply_delivery: true, rated_payload_kg: '1', gross_vehicle_weight_limit_kg: '3', operating_mass_kg: '2', operational_reserve_kg: '0', usable_volume_m3: '1', compartment_length_m: '1', compartment_width_m: '1', compartment_height_m: '1', opening_length_m: '1', opening_width_m: '1', opening_height_m: '1', verified_at: '2026-10-12T12:00:00Z', verified_by: 7, verification_reference: 'simulated:measured', verification_valid_until: '2026-10-20', handling_capabilities: [], cargo_capacity_kg: '999999', ...patch });
function database({ stored = saved(), vehicles = [profile()], settings = policy() } = {}) {
  return { query: vi.fn(async (sql, args) => {
    if (sql.includes('system_settings')) return { rows: [{ setting_value: settings }] };
    if (sql.includes('LEFT JOIN LATERAL')) return { rows: stored && !stored.deleted_at ? [stored] : [] };
    if (sql.includes('FROM vehicle_cargo_profiles')) return { rows: vehicles.filter(vehicle => args[0].includes(vehicle.vehicle_id)) };
    if (sql.startsWith('SELECT request_id,load_type')) {
      expect(sql).toContain('deleted_at IS NULL');
      return { rows: stored && !stored.deleted_at ? [{ request_id: stored.request_id, load_type: stored.load_type }] : [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }) };
}
const current = { request_id: 12, load_type: 'Cargo' };

describe('source-bound cargo physical loading', () => {
  it('OFF performs no manifest/profile reads or interpretation', async () => {
    const db = database({ settings: policy('OFF') });
    const result = await loadCargoPhysicalAssessments(current, [7], { db, policy: policy('OFF'), now });
    expect(result.policy.mode).toBe('OFF'); expect(result.results.size).toBe(0); expect(db.query).not.toHaveBeenCalled();
    await expect(assertCargoPhysicalAssignment({ requestId: 12, vehicleId: 7 }, db, now)).resolves.toBeNull();
    expect(db.query).toHaveBeenCalledOnce(); expect(db.query.mock.calls[0][0]).toContain('system_settings');
  });
  it('unconfigured ENFORCE refuses before cargo reads', async () => {
    const settings = { cargoPhysical: { mode: 'ENFORCE', version: 'simulated:v1' } };
    const db = database({ settings });
    const result = await loadCargoPhysicalAssessments(current, [7], { db, policy: settings, now });
    expect(result.results.get(7)).toMatchObject({ status: 'UNKNOWN', code: 'CARGO_PHYSICAL_POLICY_REQUIRED', eligible: false });
    expect(db.query).not.toHaveBeenCalled();
    await expect(assertCargoPhysicalAssignment({ requestId: 12, vehicleId: 7 }, db, now)).rejects.toMatchObject({ status: 409, code: 'CARGO_PHYSICAL_POLICY_REQUIRED' });
    expect(db.query.mock.calls.some(([sql]) => sql.includes('LEFT JOIN LATERAL') || sql.includes('FROM vehicle_cargo_profiles'))).toBe(false);
  });
  it('SHADOW reports missing source contents as advisory and does not read vehicle profiles', async () => {
    const stored = { ...saved(), manifest_snapshot: null };
    const db = database({ stored, settings: policy('SHADOW') });
    const context = await loadCargoPhysicalAssessments(current, [7], { db, policy: policy('SHADOW'), now });
    const result = context.results.get(7);
    expect(result).toMatchObject({ mode: 'SHADOW', eligible: false, code: 'CARGO_MANIFEST_REQUIRED' });
    expect(cargoPhysicalConflict(result, context.policy).severity).toBe('warning');
    expect(db.query).toHaveBeenCalledOnce();
    await expect(assertCargoPhysicalAssignment({ requestId: 12, vehicleId: 7 }, db, now)).resolves.toMatchObject({ code: 'CARGO_MANIFEST_REQUIRED' });
  });
  it('uses persisted kg, contents and measured profiles over caller and legacy capacity fields', async () => {
    const db = database();
    const caller = { ...current, cargo_weight_kg: '9000', source_system: 'SCM', service_code: 'FAKE', manifest_snapshot: {}, cargo_capacity_kg: 9000, profile: { rated_payload_kg: 9000 } };
    const context = await loadCargoPhysicalAssessments(caller, [7, 7, -1, NaN], { db, policy: policy(), now });
    expect(context.results.size).toBe(1);
    expect(context.results.get(7)).toMatchObject({ mode: 'ENFORCE', eligible: true, status: 'PASS', usable_payload_kg: 1, remaining_payload_kg: 0.8, totals: { gross_weight_kg: 0.2, nominal_volume_m3: 0.012 } });
    expect(context.manifest.source_ref.external_request_id).toBe('request-12');
    expect(db.query.mock.calls[0][1]).toEqual([[12]]);
    expect(db.query.mock.calls[1][1]).toEqual([[7]]);
  });
  it('ENFORCE blocks the commit when the measured profile cannot carry the persisted load', async () => {
    const db = database({ vehicles: [profile({ rated_payload_kg: '0.1' })] });
    await expect(assertCargoPhysicalAssignment({ requestId: 12, vehicleId: 7, cargo_weight_kg: 0.01, cargo_capacity_kg: 999999 }, db, now)).rejects.toMatchObject({ status: 409, code: 'CARGO_OVER_PAYLOAD' });
  });
  it.each([null, { ...saved(), deleted_at: '2026-10-12T10:00:00Z' }])('ENFORCE refuses a missing/deleted request before reading manifests or profiles', async stored => {
    const db = database({ stored });
    await expect(assertCargoPhysicalAssignment({ requestId: 12, vehicleId: 7 }, db, now)).rejects.toMatchObject({ status: 409, code: 'CARGO_REQUEST_NOT_FOUND' });
    expect(db.query.mock.calls.some(([sql]) => sql.includes('LEFT JOIN LATERAL') || sql.includes('FROM vehicle_cargo_profiles'))).toBe(false);
  });
  it('requires capability validity through planned return even when still valid now and at pickup', async () => {
    const db = database({ stored: { ...saved(), pickup_datetime: '2026-10-13T13:00:00Z' }, vehicles: [profile({ verification_valid_until: '2026-10-14' })] });
    const returnAt = '2026-10-14T12:00:00Z';
    const context = await loadCargoPhysicalAssessments({ ...current, scheduled_arrival: returnAt }, [7], { db, policy: policy(), now });
    expect(context.results.get(7)).toMatchObject({ eligible: false, status: 'BLOCK', code: 'CARGO_PROFILE_SERVICE_WINDOW' });
    expect(context.results.get(7).checks).toContainEqual(expect.objectContaining({ id: 'profile_service_window', status: 'BLOCK' }));
    await expect(assertCargoPhysicalAssignment({ requestId: 12, vehicleId: 7, returnAt }, db, now)).rejects.toMatchObject({ status: 409, code: 'CARGO_PROFILE_SERVICE_WINDOW' });
  });
  it('refuses a changed stored mass/hash before loading cargo profiles', async () => {
    for (const patch of [{ cargo_weight_kg: '0.201' }, { manifest_hash: 'b'.repeat(64) }]) {
      const db = database({ stored: { ...saved(), ...patch } });
      const context = await loadCargoPhysicalAssessments(current, [7], { db, policy: policy(), now });
      expect(context.results.get(7).eligible).toBe(false);
      expect(cargoPhysicalConflict(context.results.get(7), context.policy).severity).toBe('blocking');
      expect(db.query).toHaveBeenCalledOnce();
    }
  });
});
