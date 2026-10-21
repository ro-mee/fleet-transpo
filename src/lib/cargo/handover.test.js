import { describe, it, expect } from 'vitest';
import { validateCargoHandover, cargoSignaturePaths, CARGO_HANDOVER_ACKNOWLEDGMENT } from '../../../shared/cargo-handover';

const handover = () => ({ version: 1, signer_name: 'Receiving staff', signer_role_or_dept: 'Receiving', acknowledgment: 'CARGO_HANDOVER_V1', captured_at: '2026-10-20T02:00:00.000Z', signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80], [100, 40]]] }, location: null });

describe('private cargo handover contract', () => {
  it('normalizes a bounded acknowledgment with optional GPS without mutating it', () => {
    const value = { ...handover(), signer_name: '  Receiving staff  ' };
    expect(validateCargoHandover(value)).toEqual(handover());
    expect(value.signer_name).toBe('  Receiving staff  ');
    expect(CARGO_HANDOVER_ACKNOWLEDGMENT).toBe('CARGO_HANDOVER_V1');
  });
  it.each([
    { signer_name: ' ' }, { signer_role_or_dept: ' ' }, { signer_name: 'x'.repeat(161) },
    { signer_role_or_dept: 'x'.repeat(121) }, { signer_name: '<img src=x>' }, { signer_name: 'Name\u0000' },
    { version: 2 }, { acknowledgment: 'I agree' }, { captured_at: '2026-02-30T00:00:00Z' }, { captured_at: 'yesterday' },
    { html: '<svg onload="alert(1)" />' },
  ])('rejects malformed identity/metadata %j', value => expect(() => validateCargoHandover({ ...handover(), ...value })).toThrow());
  it.each([
    [], [[[20, 30]]], [[[20, 30], [20, 30]]], [[[20, 30], [20.1, 30.1]]],
    [[[20, 30], [NaN, 40]]], [[[20, 30], [Infinity, 40]]], [[[20, 30], ['60', 40]]],
    [[[20, 30], [601, 40]]], [[[20, 30], [60, -1]]], [[[20, 30], [60, 241]]],
    [[[20, 30], [60, 40, 70]]], Array.from({ length: 65 }, () => [[20, 30], [60, 80]]),
    [Array.from({ length: 2049 }, (_, i) => [i % 600, 40])],
  ].map((strokes, index) => ({ strokes, index })))('rejects blank, tap-only, excessive or unsafe strokes case $index', ({ strokes }) => expect(() => validateCargoHandover({ ...handover(), signature: { width: 600, height: 240, strokes } })).toThrow());
  it.each([{ width: 601 }, { height: 241 }, { svg: '<script />' }])('requires the fixed drawing format %j', patch => expect(() => validateCargoHandover({ ...handover(), signature: { ...handover().signature, ...patch } })).toThrow());
  it('accepts GPS bounds and normalizes equivalent timestamps deterministically for historical reads', () => {
    const value = { ...handover(), captured_at: '2026-10-20T10:00:00+08:00', location: { latitude: 14.6, longitude: 121, accuracy_m: 20, captured_at: '2026-10-20T01:59:00Z' } };
    const parsed = validateCargoHandover(value);
    expect(parsed.captured_at).toBe('2026-10-20T02:00:00.000Z');
    expect(parsed.location).toEqual({ latitude: 14.6, longitude: 121, accuracy_m: 20, captured_at: '2026-10-20T01:59:00.000Z' });
    expect(validateCargoHandover(parsed)).toEqual(parsed);
  });
  it.each([{ latitude: 91 }, { longitude: -181 }, { latitude: NaN }, { accuracy_m: -1 }, { accuracy_m: 10001 }, { captured_at: '2026-10-20T01:50:00Z' }, { captured_at: '2026-10-20T02:02:00Z' }, { url: 'https://example.test' }])('rejects invalid or stale GPS %j', patch => expect(() => validateCargoHandover({ ...handover(), location: { latitude: 14.6, longitude: 121, accuracy_m: 20, captured_at: handover().captured_at, ...patch } })).toThrow());
  it('returns only fixed SVG path data from validated numeric strokes', () => {
    expect(cargoSignaturePaths(handover().signature)).toEqual(['M 20 30 L 60 80 L 100 40']);
    expect(() => cargoSignaturePaths({ ...handover().signature, strokes: '<svg />' })).toThrow();
  });
  it('rejects untrusted prototypes and unknown nested drawing fields', () => {
    expect(() => validateCargoHandover(Object.assign(Object.create({ injected: true }), handover()))).toThrow();
    expect(() => validateCargoHandover({ ...handover(), signature: Object.assign(Object.create({ injected: true }), handover().signature) })).toThrow();
    expect(() => validateCargoHandover({ ...handover(), location: { latitude: 14.6, longitude: 121, accuracy_m: 20, captured_at: handover().captured_at, html: '<svg />' } })).toThrow();
  });
  it('rejects sparse or decorated point arrays rather than returning non-JSON coordinates', () => {
    const sparse = [[20, 30], , [60, 80]];
    const decorated = Object.assign([20, 30], { html: '<svg />' });
    expect(() => cargoSignaturePaths({ ...handover().signature, strokes: [sparse] })).toThrow();
    expect(() => cargoSignaturePaths({ ...handover().signature, strokes: [[decorated, [60, 80]]] })).toThrow();
  });
});
