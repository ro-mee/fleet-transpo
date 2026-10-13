import { expect, it } from 'vitest';
import { cargoPhysicalPolicy, cargoPhysicalConflict, vehicleWithCargoPhysical } from './physical-policy';
import { evaluateVehicleCapacity, formatCapacityBlocker } from '@/lib/scheduling/load-capacity';
import { validateDispatchPolicy } from '@/lib/dispatch-policy';

it('keeps the existing gate unchanged OFF/SHADOW and requires explicit enforcement references', () => {
  expect(cargoPhysicalPolicy().mode).toBe('OFF');
  expect(validateDispatchPolicy({ cargoPhysical: { mode: 'ENFORCE', version: 'v1' } }).ok).toBe(false);
  const shadow = { eligible: false, mode: 'SHADOW', blocker: 'Package exceeds loading opening.', usable_payload_kg: 500 };
  const vehicle = { operational_use: 'Cargo', cargo_capacity_kg: 1000 };
  expect(vehicleWithCargoPhysical(vehicle, shadow).cargo_capacity_kg).toBe(1000);
  expect(cargoPhysicalConflict(shadow, { mode: 'SHADOW', configured: true }).severity).toBe('warning');
});
it('uses measured payload and preserves the original recorded value when enforced', () => {
  const vehicle = vehicleWithCargoPhysical({ operational_use: 'Cargo', cargo_capacity_kg: 1000 }, { mode: 'ENFORCE', eligible: true, usable_payload_kg: 500 });
  expect(vehicle.recorded_cargo_capacity_kg).toBe(1000);
  expect(evaluateVehicleCapacity({ load_type: 'Cargo', cargo_weight_kg: 650 }, vehicle)).toMatchObject({ eligible: false, capacity: 500, code: 'OVER_CAPACITY' });
});
it('a physical failure cannot be waived by spare kg in the shared capacity gate', () => {
  const vehicle = vehicleWithCargoPhysical({ operational_use: 'Cargo', cargo_capacity_kg: 1000 }, { mode: 'ENFORCE', eligible: false, usable_payload_kg: 500, blocker: 'Package exceeds loading opening.' });
  const verdict = evaluateVehicleCapacity({ load_type: 'Cargo', cargo_weight_kg: 100 }, vehicle);
  expect(verdict.eligible).toBe(false);
  expect(formatCapacityBlocker(verdict)).toBe('Package exceeds loading opening.');
});
