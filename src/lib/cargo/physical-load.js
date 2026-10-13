import { z } from 'zod';
import { evaluateSupplyLoad } from '@/lib/supply/capacity';

export const CARGO_PHYSICAL_RULE_VERSION = 'PACKAGED_LOAD_V1';

// Physical quantities use decimal integers for arithmetic. Display numbers are
// produced only after comparison; kg are limited to the request's 3dp contract.
export function normalizePhysicalDecimal(value, { scale = 3, max = 999999999.999, allowZero = false } = {}) {
  const source = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof source !== 'string' || source.length > 32 || !new RegExp(`^\\d{1,15}(?:\\.\\d{1,${scale}})?$`).test(source)) {
    throw new Error(`Use a bounded decimal with at most ${scale} decimal places.`);
  }
  const [whole, fraction = ''] = source.split('.');
  const scaled = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'));
  if ((!allowZero && scaled === 0n) || Number(source) > max) throw new Error('Physical measurement is outside its allowed range.');
  const tail = fraction.replace(/0+$/, '');
  return `${BigInt(whole)}${tail ? `.${tail}` : ''}`;
}

const decimal = options => z.union([z.string(), z.number()]).transform((value, ctx) => {
  try { return normalizePhysicalDecimal(value, options); } catch (error) {
    ctx.addIssue({ code: 'custom', message: error.message });
    return z.NEVER;
  }
});
const dimension = decimal({ scale: 4, max: 100 });
export const physicalManifestLineSchema = z.object({
  transport_package_count: z.number().int().positive().max(100000),
  package_description: z.string().trim().min(1).max(128).nullable(),
  gross_weight_kg_per_package: decimal({ scale: 3, max: 50000 }),
  dimensions_m: z.object({ length: dimension, width: dimension, height: dimension }).strict(),
  package_can_rotate: z.boolean(),
  temperature_c: z.object({
    min_c: z.number().finite().min(-80).max(80),
    max_c: z.number().finite().min(-80).max(80),
  }).strict().refine(range => range.min_c <= range.max_c, 'Minimum temperature must not exceed maximum temperature.').nullable(),
}).strict();

function scaledDecimal(value, scale, max, allowZero = false) {
  const [whole, fraction = ''] = normalizePhysicalDecimal(value, { scale, max, allowZero }).split('.');
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0'));
}
function decimalString(value, scale) {
  const denominator = 10n ** BigInt(scale);
  const fraction = (value % denominator).toString().padStart(scale, '0').replace(/0+$/, '');
  return `${value / denominator}${fraction ? `.${fraction}` : ''}`;
}
const resultCheck = (id, status, code, reason, values = {}) => ({ id, status, code, reason, ...values });

/** Missing or invalid profile measurements never fall back to legacy vehicle kg. */
export function deriveUsablePayload(profile) {
  try {
    const rated = scaledDecimal(profile?.rated_payload_kg, 3, 1000000);
    const gross = scaledDecimal(profile?.gross_vehicle_weight_limit_kg, 3, 1000000);
    const operating = scaledDecimal(profile?.operating_mass_kg, 3, 1000000);
    const reserve = scaledDecimal(profile?.operational_reserve_kg, 3, 1000000, true);
    const remaining = gross - operating;
    const payload = (rated < remaining ? rated : remaining) - reserve;
    return payload > 0n ? Number(decimalString(payload, 3)) : null;
  } catch { return null; }
}

export function calculateCargoPhysicalTotals(manifest) {
  if (manifest?.physical_contract_version !== 1) return {
    status: 'UNKNOWN', code: 'CARGO_PHYSICAL_MANIFEST_REQUIRED',
    reason: 'A versioned package manifest is required for physical load checks.',
    totals: { gross_weight_kg: null, nominal_volume_m3: null },
  };
  const lines = manifest.lines;
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > 500) return invalidMeasurements();
  let weight = 0n, volume = 0n;
  const normalized = [];
  for (const line of lines) {
    const parsed = physicalManifestLineSchema.safeParse(line.physical);
    if (!parsed.success || !line.line_id || normalized.some(item => item.line_id === line.line_id) ||
        !Array.isArray(line.handling)) return invalidMeasurements();
    const physical = parsed.data;
    if (line.quantity_basis === 'TRANSPORT_PACKAGE' && String(physical.transport_package_count) !== line.expected_quantity) return invalidMeasurements();
    const count = BigInt(physical.transport_package_count);
    weight += count * scaledDecimal(physical.gross_weight_kg_per_package, 3, 50000);
    volume += count * ['length', 'width', 'height'].reduce((product, axis) => product * scaledDecimal(physical.dimensions_m[axis], 4, 100), 1n);
    normalized.push({ ...line, physical });
  }
  if (weight > 999999999999n) return invalidMeasurements();
  return {
    status: 'PASS', code: null, reason: 'Package quantities and physical measurements are complete.',
    totals: { gross_weight_kg: Number(decimalString(weight, 3)), nominal_volume_m3: Number(decimalString(volume, 12)) },
    weight_decimal: decimalString(weight, 3), volume_decimal: decimalString(volume, 12),
    lines: normalized,
  };
}
function invalidMeasurements() {
  return {
    status: 'BLOCK', code: 'CARGO_PHYSICAL_DATA_INVALID',
    reason: 'Every package line needs valid bounded counts, gross kg, dimensions, rotation and declared temperature requirements.',
    totals: { gross_weight_kg: null, nominal_volume_m3: null },
  };
}

export function reconcileCargoDeclaredWeight(manifest, declaredWeightKg) {
  const calculated = calculateCargoPhysicalTotals(manifest);
  if (calculated.status !== 'PASS') return resultCheck('declared_weight', calculated.status, calculated.code, calculated.reason);
  let declared;
  try { declared = normalizePhysicalDecimal(declaredWeightKg); } catch {
    return resultCheck('declared_weight', 'UNKNOWN', 'CARGO_DECLARED_WEIGHT_REQUIRED', 'A positive declared consignment weight with at most three decimal places is required.');
  }
  const matches = declared === calculated.weight_decimal;
  return resultCheck('declared_weight', matches ? 'PASS' : 'BLOCK', matches ? null : 'CARGO_WEIGHT_RECONCILIATION_REQUIRED',
    matches ? 'Declared consignment kg matches the package-derived gross mass.' : `Declared consignment ${declared} kg differs from package-derived ${calculated.weight_decimal} kg. Review the source measurements.`,
    { declared_kg: Number(declared), calculated_kg: calculated.totals.gross_weight_kg });
}

/** Physical measurements only. Shared operational and custody gates still apply. */
export function evaluateCargoPhysicalLoad({ manifest, profile, declaredWeightKg, now = new Date() } = {}) {
  const calculated = calculateCargoPhysicalTotals(manifest);
  const usablePayload = deriveUsablePayload(profile);
  const checks = [resultCheck('manifest_measurements', calculated.status, calculated.code, calculated.reason)];
  if (calculated.status === 'PASS') {
    const supply = evaluateSupplyLoad({ lines: calculated.lines.map(line => ({
      external_line_id: line.line_id, ...line.physical, handling: line.handling,
    })) }, profile, now);
    // Readiness and operational status belong to the existing scheduling gate;
    // neither is inferred from a manifest containing only physical facts.
    checks.push(...supply.checks.filter(item => !['manifest_measurements', 'pickup_readiness', 'vehicle_operational_status', 'payload', 'volume'].includes(item.id)));
    if (usablePayload === null) {
      checks.push(resultCheck('payload', 'UNKNOWN', 'CARGO_PAYLOAD_REQUIRED', 'Verified payload, gross limit, operating mass and reserve must leave positive usable payload.'));
    } else {
      const fits = scaledDecimal(calculated.weight_decimal, 3, 999999999.999) <= scaledDecimal(usablePayload, 3, 1000000);
      checks.push(resultCheck('payload', fits ? 'PASS' : 'BLOCK', fits ? null : 'CARGO_OVER_PAYLOAD',
        fits ? 'Load is within profile-derived usable payload.' : `Cargo needs ${calculated.weight_decimal} kg; usable payload is ${usablePayload} kg.`,
        { load_kg: calculated.totals.gross_weight_kg, capacity_kg: usablePayload }));
    }
    let volume;
    try { volume = scaledDecimal(profile?.usable_volume_m3, 12, 10000); } catch { volume = null; }
    const fitsVolume = volume !== null && scaledDecimal(calculated.volume_decimal, 12, 50000000000000) <= volume;
    checks.push(resultCheck('volume', volume === null ? 'UNKNOWN' : fitsVolume ? 'PASS' : 'BLOCK', volume === null ? 'CARGO_VOLUME_REQUIRED' : fitsVolume ? null : 'CARGO_OVER_VOLUME',
      volume === null ? 'Verified usable cargo volume is required.' : fitsVolume ? 'Load is within nominal usable volume.' : 'Load exceeds nominal usable volume.',
      { load_m3: calculated.totals.nominal_volume_m3, capacity_m3: volume === null ? null : Number(decimalString(volume, 12)) }));
    if (manifest.source_ref?.system !== 'SCM' || declaredWeightKg !== undefined) checks.push(reconcileCargoDeclaredWeight(manifest, declaredWeightKg));
  }
  // The profile API stamps provenance. Missing/future provenance is never an
  // independent approval, and may not become a green physical result.
  if (profile && (!Number.isSafeInteger(Number(profile.verified_by)) || Number(profile.verified_by) <= 0 ||
      typeof profile.verification_reference !== 'string' || !profile.verification_reference.trim() ||
      !Number.isFinite(new Date(profile.verified_at).getTime()) || new Date(profile.verified_at).getTime() > now.getTime())) {
    checks.push(resultCheck('profile_provenance', 'BLOCK', 'CARGO_PROFILE_VERIFICATION_REQUIRED', 'Cargo profile needs valid recorded measurement provenance.'));
  }
  const failed = checks.find(item => item.status === 'BLOCK') ?? checks.find(item => item.status === 'UNKNOWN');
  return {
    eligible: !failed, load_checks_pass: !failed, status: failed?.status ?? 'PASS',
    code: failed?.code ?? (failed ? `CARGO_${failed.id.toUpperCase()}` : null), blocker: failed?.reason ?? null,
    usable_payload_kg: usablePayload,
    remaining_payload_kg: usablePayload === null || calculated.totals.gross_weight_kg === null ? null : Number((usablePayload - calculated.totals.gross_weight_kg).toFixed(3)),
    totals: calculated.totals, checks, rule_version: CARGO_PHYSICAL_RULE_VERSION,
    limitations: ['Physical checks do not establish collective packing, axle balance, trip-specific operating mass, post-load securement, driver/document eligibility or schedule availability.'],
  };
}
