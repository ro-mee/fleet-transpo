import { expect, it } from 'vitest';
import { evaluateSupplyLoad } from './capacity';

const manifest = ranges => ({ pickup: { ready: true }, lines: ranges.map((temperature_c, index) => ({
  external_line_id: `line-${index}`, transport_package_count: 1, gross_weight_kg_per_package: 1,
  dimensions_m: { length: 0.1, width: 0.1, height: 0.1 }, temperature_c,
})) });
const vehicle = { temperature_min_c: -20, temperature_max_c: 80 };
it('blocks incompatible same-compartment source temperatures instead of approving a broad vehicle envelope', () => {
  const result = evaluateSupplyLoad(manifest([{ min_c: 0, max_c: 4 }, { min_c: 6, max_c: 8 }]), vehicle);
  expect(result.checks.find(check => check.id === 'temperature').status).toBe('BLOCK');
  expect(result.load_checks_pass).toBe(false);
});
it('accepts a common permissible setpoint intersection and rejects invalid or unknown ranges', () => {
  const load = manifest([{ min_c: 0, max_c: 4 }, { min_c: 2, max_c: 6 }]);
  expect(evaluateSupplyLoad(load, { temperature_min_c: 3, temperature_max_c: 10 }).checks.find(check => check.id === 'temperature'))
    .toMatchObject({ status: 'PASS', common_min_c: 3, common_max_c: 4 });
  expect(evaluateSupplyLoad(load, {}).checks.find(check => check.id === 'temperature').status).toBe('UNKNOWN');
  expect(evaluateSupplyLoad(manifest([{ min_c: 'NaN', max_c: 3 }]), vehicle).checks.find(check => check.id === 'temperature').status).toBe('BLOCK');
});
