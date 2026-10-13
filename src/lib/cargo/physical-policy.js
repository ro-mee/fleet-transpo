const nonblank = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 255;

// Stored with the existing dispatch policy; no new environment switch or
// runtime provider is installed by consolidation.
export function cargoPhysicalPolicy(policy = {}) {
  const raw = policy?.cargoPhysical;
  const mode = raw?.mode ?? 'OFF';
  const version = nonblank(raw?.version) ? raw.version.trim() : null;
  const configured = mode === 'OFF' || (mode === 'SHADOW' && !!version) ||
    (mode === 'ENFORCE' && !!version && ['vehicleStandardsApprovalRef', 'sourceContractApprovalRef', 'massBasisApprovalRef'].every(key => nonblank(raw?.[key])));
  return { mode, version, configured };
}

export function cargoPhysicalConflict(result, policy) {
  if (!result || policy?.mode === 'OFF') return null;
  if (result.eligible && policy.configured) return null;
  return {
    type: 'cargo_physical', code: result.code ?? 'CARGO_PHYSICAL_UNKNOWN',
    severity: policy.mode === 'SHADOW' ? 'warning' : 'blocking',
    message: result.blocker ?? 'Cargo contents and measured vehicle capability require review.',
    detail: { status: result.status, rule_version: result.rule_version, policy_version: policy.version,
      required: result.totals?.gross_weight_kg ?? null, capacity: result.usable_payload_kg ?? null },
  };
}

export function vehicleWithCargoPhysical(vehicle, result) {
  if (!vehicle || !result) return vehicle;
  return { ...vehicle, cargoPhysical: result,
    ...(result.mode === 'ENFORCE' ? { recorded_cargo_capacity_kg: vehicle.cargo_capacity_kg,
      cargo_capacity_kg: result.usable_payload_kg } : {}) };
}
