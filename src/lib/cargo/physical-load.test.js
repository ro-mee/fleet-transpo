import { describe, expect, it } from 'vitest';
import { calculateCargoPhysicalTotals, deriveUsablePayload, evaluateCargoPhysicalLoad, normalizePhysicalDecimal, reconcileCargoDeclaredWeight } from './physical-load';

const now = new Date('2026-10-13T12:00:00Z');
const physical = (patch = {}) => ({
  transport_package_count: 2, package_description: 'sealed boxes', gross_weight_kg_per_package: '0.1',
  dimensions_m: { length: '0.1', width: '0.2', height: '0.3' }, package_can_rotate: false, temperature_c: null,
  ...patch,
});
const manifest = (patch = {}) => ({
  physical_contract_version: 1, source_ref: { system: 'PMS' },
  lines: [{ line_id: 'oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '2', handling: [], physical: physical() }],
  ...patch,
});
const profile = (patch = {}) => ({
  supports_supply_delivery: true, rated_payload_kg: '1.000', gross_vehicle_weight_limit_kg: '3.000', operating_mass_kg: '2.000', operational_reserve_kg: '0.000',
  usable_volume_m3: '0.012000', compartment_length_m: '1.0000', compartment_width_m: '1.0000', compartment_height_m: '1.0000',
  opening_length_m: '1.0000', opening_width_m: '1.0000', opening_height_m: '1.0000',
  verified_at: '2026-10-12T12:00:00Z', verified_by: 7, verification_reference: 'MEASURED-7', verification_valid_until: '2026-10-20', handling_capabilities: [],
  ...patch,
});
const evaluate = (load = manifest(), vehicle = profile(), declaredWeightKg = '0.2') => evaluateCargoPhysicalLoad({ manifest: load, profile: vehicle, declaredWeightKg, now });

describe('versioned physical measurements', () => {
  it('calculates decimal package mass and volume without binary multiplication drift', () => {
    const result = calculateCargoPhysicalTotals(manifest());
    expect(result).toMatchObject({ status: 'PASS', weight_decimal: '0.2', volume_decimal: '0.012', totals: { gross_weight_kg: 0.2, nominal_volume_m3: 0.012 } });
    expect(evaluate()).toMatchObject({ eligible: true, usable_payload_kg: 1, remaining_payload_kg: 0.8, status: 'PASS' });
  });
  it('does not convert ordered units to transport package counts', () => {
    const load = manifest();
    load.lines[0].quantity_basis = 'UNIT'; load.lines[0].expected_quantity = '60.5';
    expect(calculateCargoPhysicalTotals(load).totals.gross_weight_kg).toBe(0.2);
    load.lines[0].quantity_basis = 'TRANSPORT_PACKAGE';
    expect(calculateCargoPhysicalTotals(load).status).toBe('BLOCK');
  });
  it('preserves absent historical physical facts as unknown', () => {
    const load = manifest(); delete load.physical_contract_version; delete load.lines[0].physical;
    expect(evaluate(load)).toMatchObject({ eligible: false, status: 'UNKNOWN', code: 'CARGO_PHYSICAL_MANIFEST_REQUIRED', totals: { gross_weight_kg: null, nominal_volume_m3: null } });
    expect(load).not.toHaveProperty('physical_contract_version');
  });
  it.each(['-1', 'NaN', 'Infinity', '0', '0.0001', '1e2', '50000.001'])('rejects invalid or out-of-contract package kg %s', weight => {
    const load = manifest(); load.lines[0].physical.gross_weight_kg_per_package = weight;
    expect(evaluate(load)).toMatchObject({ eligible: false, code: 'CARGO_PHYSICAL_DATA_INVALID' });
  });
  it('requires explicit temperature-none and rotation declarations', () => {
    const load = manifest(); delete load.lines[0].physical.temperature_c;
    expect(evaluate(load).status).toBe('BLOCK');
    load.lines[0].physical = physical(); delete load.lines[0].physical.package_can_rotate;
    expect(evaluate(load).status).toBe('BLOCK');
  });
  it('supports profile dimension precision and exact tiny nominal volumes', () => {
    const load = manifest(); load.lines[0].physical.dimensions_m = { length: '0.0001', width: '0.0001', height: '0.0001' };
    expect(calculateCargoPhysicalTotals(load).volume_decimal).toBe('0.000000000002');
    expect(evaluate(load).eligible).toBe(true);
  });
  it('rejects duplicate identities and totals exceeding the declared-weight contract', () => {
    const load = manifest(); load.lines.push({ ...load.lines[0] });
    expect(calculateCargoPhysicalTotals(load).status).toBe('BLOCK');
    load.lines = [{ ...load.lines[0], quantity_basis: 'UNIT', physical: physical({ transport_package_count: 100000, gross_weight_kg_per_package: '50000' }) }];
    expect(calculateCargoPhysicalTotals(load).status).toBe('BLOCK');
  });
  it('normalizes bounded decimals but never rounds source measurements', () => {
    expect(normalizePhysicalDecimal('0001.230')).toBe('1.23');
    expect(normalizePhysicalDecimal(0.1)).toBe('0.1');
    expect(() => normalizePhysicalDecimal('0.1001')).toThrow();
  });
  it('reconciles declared kg exactly at the existing three-decimal precision', () => {
    expect(reconcileCargoDeclaredWeight(manifest(), '0.200').status).toBe('PASS');
    expect(reconcileCargoDeclaredWeight(manifest(), '0.201')).toMatchObject({ status: 'BLOCK', code: 'CARGO_WEIGHT_RECONCILIATION_REQUIRED' });
    expect(reconcileCargoDeclaredWeight(manifest(), null).status).toBe('UNKNOWN');
    expect(evaluate(manifest(), profile(), 0.201).eligible).toBe(false);
  });
});

describe('one measured vehicle basis', () => {
  it('derives payload exactly from the lower limit and allows zero reserve', () => {
    expect(deriveUsablePayload(profile())).toBe(1);
    expect(deriveUsablePayload(profile({ rated_payload_kg: '0.3', gross_vehicle_weight_limit_kg: '2.3', operational_reserve_kg: '0.1' }))).toBe(0.2);
  });
  it.each([{}, { operational_reserve_kg: -1 }, { operating_mass_kg: 'NaN' }, { gross_vehicle_weight_limit_kg: 1 }, { rated_payload_kg: '1.0001' }])('fails closed for absent/invalid usable payload %j', patch => {
    expect(deriveUsablePayload(Object.keys(patch).length ? profile(patch) : patch)).toBeNull();
  });
  it('uses profile payload over an unrelated legacy kg value', () => {
    const vehicle = profile({ rated_payload_kg: '0.1', cargo_capacity_kg: 10000 });
    expect(evaluate(manifest(), vehicle)).toMatchObject({ eligible: false, code: 'CARGO_OVER_PAYLOAD', usable_payload_kg: 0.1 });
  });
  it('compares nominal volume exactly at its boundary', () => {
    expect(evaluate().checks.find(check => check.id === 'volume').status).toBe('PASS');
    expect(evaluate(manifest(), profile({ usable_volume_m3: '0.011999' })).checks.find(check => check.id === 'volume').status).toBe('BLOCK');
  });
  it('requires valid current provenance and never treats a profile stamp as safety proof', () => {
    for (const patch of [{ verified_at: '2026-10-14T12:00:00Z' }, { verified_by: -1 }, { verification_reference: ' ' }, { verification_valid_until: '2026-10-12' }]) {
      expect(evaluate(manifest(), profile(patch)).eligible).toBe(false);
    }
    expect(evaluate().limitations.join(' ')).toContain('post-load securement');
  });
  it('checks package orientation, loading opening and handling capabilities', () => {
    const load = manifest(); load.lines[0].physical.dimensions_m = { length: '0.2', width: '0.3', height: '0.4' };
    const vehicle = profile({ usable_volume_m3: 1, opening_length_m: '0.4', opening_width_m: '0.2', opening_height_m: '0.3' });
    expect(evaluate(load, vehicle).checks.find(check => check.id === 'package_fit').status).toBe('BLOCK');
    load.lines[0].physical.package_can_rotate = true;
    expect(evaluate(load, vehicle).eligible).toBe(true);
    load.lines[0].handling = ['FOOD_SEPARATION'];
    expect(evaluate(load, vehicle).checks.find(check => check.id === 'handling').status).toBe('BLOCK');
  });
});

describe('one-compartment cold chain', () => {
  const temperatureLoad = (first, second) => manifest({ lines: [first, second].map((temperature_c, index) => ({
    line_id: `line-${index}`, quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '1', handling: [],
    physical: physical({ transport_package_count: 1, temperature_c }),
  })) });
  it('blocks disjoint cargo requirements even with a broad vehicle range', () => {
    const load = temperatureLoad({ min_c: 0, max_c: 4 }, { min_c: 6, max_c: 8 });
    const verdict = evaluate(load, profile({ temperature_min_c: -20, temperature_max_c: 80 }));
    expect(verdict.checks.find(check => check.id === 'temperature').status).toBe('BLOCK');
    expect(verdict.eligible).toBe(false);
  });
  it('uses the common cargo and vehicle intersection, not full-range containment', () => {
    const load = temperatureLoad({ min_c: 0, max_c: 4 }, { min_c: 2, max_c: 6 });
    expect(evaluate(load, profile({ temperature_min_c: 3, temperature_max_c: 10 })).checks.find(check => check.id === 'temperature'))
      .toMatchObject({ status: 'PASS', common_min_c: 3, common_max_c: 4 });
    expect(evaluate(load).checks.find(check => check.id === 'temperature').status).toBe('UNKNOWN');
    expect(evaluate(load, profile({ temperature_min_c: 5, temperature_max_c: 10 })).eligible).toBe(false);
  });
});
