import { it, expect, vi } from 'vitest';
import { ingestRequestManifest, resolveTripManifest, adaptSupplyManifest, assertCargoConfiguration } from './cargo-manifest.service';
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
