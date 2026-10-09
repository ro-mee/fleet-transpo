import { it, expect } from 'vitest';
import { manifestSchema, receiptSchema, validateReceiptAgainstManifest } from './contracts';
export const manifest = () => ({
  manifest_ref: { kind: 'REQUEST', id: '11111111-1111-4111-8111-111111111111', revision: 1, hash: 'a'.repeat(64) },
  source_ref: { system: 'PMS', organization_id: 'simulated:hotel', external_request_id: 'r1' },
  service_code: 'HOTEL_SUPPLY_TRANSFER',
  lines: [{ line_id: 'oil', name: 'Oil', quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: '10', unit: 'box', reference_image_ref: null, handling: [] }],
});
it('accepts cargo and rejects passenger service and unknown fields', () => {
  expect(manifestSchema.safeParse(manifest()).success).toBe(true);
  expect(manifestSchema.safeParse({ ...manifest(), service_code: 'GUEST_TRANSPORT' }).success).toBe(false);
  expect(manifestSchema.safeParse({ ...manifest(), load_type: 'Passenger' }).success).toBe(false);
});
it.each(['bad', '-1', 'NaN', 'Infinity', '1.0001', '0', '1.5'])('returns a validation failure for invalid expected quantity %s', expected_quantity => {
  const input = manifest();
  input.lines[0].expected_quantity = expected_quantity;
  expect(manifestSchema.safeParse(input).success).toBe(false);
});
it('rejects duplicate, empty, oversized, zero and fractional-package manifests', () => {
  for (const lines of [[], Array(501).fill(manifest().lines[0]), Array(2).fill(manifest().lines[0]), [{ ...manifest().lines[0], expected_quantity: '0' }], [{ ...manifest().lines[0], expected_quantity: '1.1' }]]) {
    expect(manifestSchema.safeParse({ ...manifest(), lines }).success).toBe(false);
  }
  expect(manifestSchema.safeParse({ ...manifest(), lines: [{ ...manifest().lines[0], reference_image_ref: 'https://secret/image' }] }).success).toBe(false);
});
it('binds observations to exact manifest lines and basis without accepting units or expectations from caller', () => {
  const input = { submission_id: '22222222-2222-4222-8222-222222222222', manifest_ref: manifest().manifest_ref, stage: 'PICKUP', observed_at: '2026-10-09T08:00:00Z', lines: [{ line_id: 'oil', observed_quantity: '9', condition: 'INTACT', issue_code: 'SHORTAGE', remarks: '', evidence_ids: [] }], receiver_confirmation_ref: null };
  expect(validateReceiptAgainstManifest(input, manifest()).lines[0].observed_quantity).toBe('9');
  for (const line of [{ ...input.lines[0], line_id: 'unknown' }, { ...input.lines[0], observed_quantity: '0.5' }, { ...input.lines[0], unit: 'litre' }, { ...input.lines[0], expected_quantity: '9' }]) {
    expect(() => validateReceiptAgainstManifest({ ...input, lines: [line] }, manifest())).toThrow();
  }
  expect(receiptSchema.safeParse({ ...input, driver_id: 1 }).success).toBe(false);
  expect(() => validateReceiptAgainstManifest({ ...input, manifest_ref: { ...input.manifest_ref, hash: 'b'.repeat(64) } }, manifest())).toThrow();
});
