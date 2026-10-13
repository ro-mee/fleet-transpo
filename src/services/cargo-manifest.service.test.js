import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ingestRequestManifest, resolveTripManifest, adaptSupplyManifest, adaptSupplyPhysicalManifest, adaptRequestManifest, assertCargoConfiguration } from './cargo-manifest.service';
const hash = 'a'.repeat(64);
it.each(['bad', '-1', '0', '1.5'])('returns the invalid-manifest 400 before opening a transaction for quantity %s', async expected_quantity => {
  const principal = { system: 'PMS', organization_id: 'simulated:hotel', capabilities: ['cargo:manifest:write'] };
  const db = { withTransaction: vi.fn(), cargoConfig: { dataApprovalRef: 'simulated:data', privacyApprovalRef: 'simulated:privacy', schemaReady: true, simulated: true, environment: 'test' } };
  const input = { event_id: 'simulated:event', revision: 1, manifest: {
    source_ref: { system: 'PMS', organization_id: 'simulated:hotel', external_request_id: 'r1' },
    service_code: 'HOTEL_SUPPLY_TRANSFER',
    lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity, unit: 'box', reference_image_ref: null, handling: [] }],
  } };
  await expect(ingestRequestManifest(input, principal, db)).rejects.toMatchObject({ code: 'CARGO_INVALID_MANIFEST', status: 400 });
  expect(db.withTransaction).not.toHaveBeenCalled();
});
it('refuses writes before querying when approval or schema configuration is absent', async () => {
  const db = { query: vi.fn(), withTransaction: vi.fn() };
  await expect(ingestRequestManifest({}, {}, db)).rejects.toMatchObject({ code: 'CARGO_CONFIGURATION_REQUIRED', status: 503 });
  expect(db.query).not.toHaveBeenCalled(); expect(db.withTransaction).not.toHaveBeenCalled();
});
it('does not accept blank approval references, missing schema readiness or simulated production configuration', () => {
  const fixture = { dataApprovalRef: 'simulated:data', privacyApprovalRef: 'simulated:privacy', schemaReady: true, simulated: true, environment: 'test' };
  expect(() => assertCargoConfiguration(fixture)).not.toThrow();
  for (const patch of [{ dataApprovalRef: '' }, { privacyApprovalRef: ' ' }, { schemaReady: false }, { environment: 'production' }]) {
    expect(() => assertCargoConfiguration({ ...fixture, ...patch })).toThrow(expect.objectContaining({ status: 503 }));
  }
});
it('uses only supply packages, exact allocation revision and an explicit service mapping', () => {
  const row = { supply_manifest_revision_id: '11111111-1111-4111-8111-111111111111', manifest_revision: 2, manifest_hash: hash, source_organization_id: 'simulated:scm', external_request_id: 's1', manifest_snapshot: { lines: [{ external_line_id: 'oil', sku_ref: 'SKU', description: 'Oil', transport_package_count: 3, ordered_quantity: 60, ordered_uom: 'litre', handling: [] }] } };
  expect(() => adaptSupplyManifest(row)).toThrow(expect.objectContaining({ code: 'CARGO_SERVICE_REQUIRED' }));
  const result = adaptSupplyManifest(row, 'HOTEL_SUPPLY_TRANSFER');
  expect(result.lines[0]).toMatchObject({ line_id: 'oil', expected_quantity: '3', unit: 'packages', quantity_basis: 'TRANSPORT_PACKAGE' });
  expect(result.manifest_ref).toMatchObject({ revision: 2, hash });
  expect(() => adaptSupplyManifest({ ...row, manifest_snapshot: { lines: [{ ...row.manifest_snapshot.lines[0], transport_package_count: 1.5 }] } }, 'HOTEL_SUPPLY_TRANSFER')).toThrow();
});
it('preserves passenger reads and blocks conflicting or missing manifest linkage', async () => {
  const db = { query: vi.fn(async () => ({ rows: [{ service_type: 'PASSENGER', request_id: 1, load_type: 'Passenger' }] })) };
  expect(await resolveTripManifest(1, db)).toBeNull();
  db.query.mockResolvedValue({ rows: [{ service_type: 'SUPPLY_DELIVERY', request_id: 1, load_type: 'Cargo' }] });
  await expect(resolveTripManifest(1, db)).rejects.toMatchObject({ code: 'CARGO_LINKAGE_CONFLICT' });
  db.query.mockResolvedValue({ rows: [{ service_type: 'PASSENGER', request_id: 1, load_type: 'Cargo' }] });
  await expect(resolveTripManifest(1, db)).rejects.toMatchObject({ code: 'CARGO_MANIFEST_REQUIRED' });
});

const physicalContent = () => ({
  physical_contract_version: 1,
  source_ref: { system: 'PMS', organization_id: 'simulated:hotel', external_request_id: 'r1' }, service_code: 'HOTEL_SUPPLY_TRANSFER',
  lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '2', unit: 'boxes', reference_image_ref: null, handling: [], physical: {
    transport_package_count: 2, package_description: 'sealed boxes', gross_weight_kg_per_package: '0.1',
    dimensions_m: { length: '0.1', width: '0.2', height: '0.3' }, package_can_rotate: false, temperature_c: null,
  } }],
});
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const contentHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const savedPhysical = () => {
  const manifest_snapshot = physicalContent();
  return { request_id: 1, request_cargo_manifest_revision_id: '11111111-1111-4111-8111-111111111111', revision: 1, manifest_snapshot, manifest_hash: contentHash(manifest_snapshot), source_organization_id: 'simulated:hotel' };
};
const currentRequest = () => ({ request_id: 1, load_type: 'Cargo', source_system: 'PMS', external_request_id: 'r1', service_code: 'HOTEL_SUPPLY_TRANSFER', cargo_weight_kg: '0.200' });

it('validates an exact saved request manifest hash, identity and declared mass', () => {
  const row = savedPhysical();
  expect(adaptRequestManifest(row, currentRequest()).manifest_ref.hash).toBe(row.manifest_hash);
  expect(row.manifest_snapshot).toEqual(physicalContent());
  for (const patch of [{ request_id: 2 }, { source_system: 'POS' }, { external_request_id: 'r2' }, { service_code: 'RESTAURANT_FOOD_DELIVERY' }]) {
    expect(() => adaptRequestManifest(row, { ...currentRequest(), ...patch })).toThrow(expect.objectContaining({ code: 'CARGO_LINKAGE_CONFLICT' }));
  }
  expect(() => adaptRequestManifest({ ...row, manifest_hash: 'b'.repeat(64) }, currentRequest())).toThrow(expect.objectContaining({ code: 'CARGO_LINKAGE_CONFLICT' }));
  expect(() => adaptRequestManifest(row, { ...currentRequest(), cargo_weight_kg: '0.201' })).toThrow(expect.objectContaining({ code: 'CARGO_WEIGHT_RECONCILIATION_REQUIRED' }));
});

it('resolves versioned trip contents against the current request declared kg', async () => {
  const db = { cargoConfig: { schemaReady: true }, query: vi.fn()
    .mockResolvedValueOnce({ rows: [{ ...currentRequest(), service_type: 'PASSENGER', dispatch_id: 4 }] })
    .mockResolvedValueOnce({ rows: [savedPhysical()] }) };
  const result = await resolveTripManifest(7, db);
  expect(result).toMatchObject({ physical_contract_version: 1, lines: [{ physical: { gross_weight_kg_per_package: '0.1' } }] });
  expect(db.query.mock.calls[0][0]).toContain('r.cargo_weight_kg');
  db.query.mockResolvedValueOnce({ rows: [{ ...currentRequest(), cargo_weight_kg: '0.201', service_type: 'PASSENGER', dispatch_id: 4 }] })
    .mockResolvedValueOnce({ rows: [savedPhysical()] });
  await expect(resolveTripManifest(7, db)).rejects.toMatchObject({ code: 'CARGO_WEIGHT_RECONCILIATION_REQUIRED' });
});

it('preserves old SUPPLY execution shape while an explicit physical projection retains source measurements', () => {
  const physical = physicalContent().lines[0].physical;
  const row = { supply_manifest_revision_id: '11111111-1111-4111-8111-111111111111', manifest_revision: 2, manifest_hash: hash, source_organization_id: 'simulated:scm', external_request_id: 's1', manifest_snapshot: {
    lines: [{ external_line_id: 'oil', sku_ref: 'SKU', description: 'Oil', ordered_quantity: 60, ordered_uom: 'litre', handling: [], ...physical }],
  } };
  const historical = adaptSupplyManifest(row, 'HOTEL_SUPPLY_TRANSFER');
  expect(historical).not.toHaveProperty('physical_contract_version');
  expect(historical.lines[0]).not.toHaveProperty('physical');
  const projected = adaptSupplyPhysicalManifest(row, 'HOTEL_SUPPLY_TRANSFER');
  expect(projected).toMatchObject({ physical_contract_version: 1, manifest_ref: historical.manifest_ref });
  expect(projected.lines[0]).toMatchObject({ expected_quantity: '2', unit: 'packages', source_sku_ref: 'SKU', physical });
  expect(row.manifest_snapshot.lines[0].ordered_quantity).toBe(60);
});

function simulatedIntake(weight = '0.200') {
  const tx = { query: vi.fn(async (sql, values) => {
    if (sql.includes('SELECT r.*')) return { rows: [{ ...currentRequest(), cargo_weight_kg: weight }] };
    if (sql.startsWith('INSERT INTO request_cargo_manifest_revisions')) return { rows: [{ ...savedPhysical(), manifest_hash: values[2], manifest_snapshot: JSON.parse(values[7]) }] };
    return { rows: [] };
  }) };
  const db = { cargoConfig: { dataApprovalRef: 'simulated:data', privacyApprovalRef: 'simulated:privacy', schemaReady: true, simulated: true, environment: 'test',
    requestOwnership: [{ system: 'PMS', external_request_id: 'r1', organization_id: 'simulated:hotel' }],
  }, withTransaction: work => work(tx) };
  const principal = { system: 'PMS', organization_id: 'simulated:hotel', capabilities: ['cargo:manifest:write'] };
  return { tx, db, principal };
}
it('persists only reconciled initial physical contents under the existing source and transaction rules', async () => {
  const good = simulatedIntake();
  const input = { event_id: 'physical-event', revision: 1, manifest: physicalContent() };
  expect(await ingestRequestManifest(input, good.principal, good.db)).toMatchObject({ replayed: false, manifest_ref: { hash: contentHash(input.manifest) } });
  expect(good.tx.query.mock.calls[0][0]).toBe('LOCK TABLE transportation_requests, request_cargo_manifest_revisions IN SHARE ROW EXCLUSIVE MODE');
  expect(good.tx.query.mock.calls[1][0]).toContain('FOR UPDATE OF r');
  expect(good.tx.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO request_cargo_manifest_revisions'))).toHaveLength(1);
  const mismatch = simulatedIntake('0.201');
  await expect(ingestRequestManifest(input, mismatch.principal, mismatch.db)).rejects.toMatchObject({ code: 'CARGO_WEIGHT_RECONCILIATION_REQUIRED', status: 409 });
  expect(mismatch.tx.query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
});
