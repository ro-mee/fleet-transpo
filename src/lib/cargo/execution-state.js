import { manifestSchema, validateReceiptAgainstManifest } from './contracts';
import { compareQuantities, normalizeQuantity } from './quantities';

const error = () => Object.assign(new Error('Invalid immutable cargo observation.'), { code: 'CARGO_INVALID_RECEIPT', status: 400 });
const scaled = value => { const [whole, tail = ''] = value.split('.'); return BigInt(whole) * 1000n + BigInt(tail.padEnd(3, '0')); };
const shortage = (expected, observed) => {
  if (expected == null || observed == null) return null;
  const difference = scaled(expected) - scaled(observed);
  if (difference <= 0n) return '0';
  return normalizeQuantity(`${difference / 1000n}.${String(difference % 1000n).padStart(3, '0')}`, { basis: 'UNIT' });
};

// Proofs are server-resolved records, never a caller's receiver name/reference or pre-trip inspection.
export function matchesCargoAuthorityProof(proof, kind, receipt) {
  return Boolean(receipt && proof?.kind === kind && proof.receipt_id === receipt.receipt_id &&
    proof.manifest_hash === receipt.manifest_hash &&
    ['approval_ref', 'method', 'reference'].every(key => typeof proof[key] === 'string' && proof[key].trim()));
}

export function deriveCargoState({ manifest: rawManifest, pickup = null, delivery = null, decision = null, clearance = null }) {
  const parsed = manifestSchema.safeParse(rawManifest);
  if (!parsed.success) throw error();
  const manifest = parsed.data;
  const read = (row, stage) => {
    if (!row) return null;
    try {
      const payload = validateReceiptAgainstManifest(row.payload, manifest);
      if (payload.stage !== stage || row.manifest_hash !== manifest.manifest_ref.hash || !row.receipt_id || !Number.isSafeInteger(row.execution_version)) throw error();
      return payload;
    } catch { throw error(); }
  };
  const p = read(pickup, 'PICKUP'), d = read(delivery, 'DELIVERY');
  const lines = manifest.lines.map(original => {
    const collected = p?.lines.find(line => line.line_id === original.line_id), received = d?.lines.find(line => line.line_id === original.line_id);
    return { line_id: original.line_id, unit: original.unit, quantity_basis: original.quantity_basis, expected_quantity: original.expected_quantity,
      pickup_quantity: collected?.observed_quantity ?? null, delivery_quantity: received?.observed_quantity ?? null,
      order_shortage: shortage(original.expected_quantity, collected?.observed_quantity), delivery_shortage: shortage(collected?.observed_quantity, received?.observed_quantity),
      condition_issues: [collected?.condition === 'DAMAGED' ? 'PICKUP_DAMAGE' : null, received?.condition === 'DAMAGED' ? 'DELIVERY_DAMAGE' : null].filter(Boolean),
    };
  });
  const blockers = [];
  const block = (code, message) => blockers.push({ code, message });
  const currentDecision = pickup && decision?.receipt_id === pickup.receipt_id && decision.manifest_hash === manifest.manifest_ref.hash &&
    decision.source_system === manifest.source_ref.system && decision.source_organization_id === manifest.source_ref.organization_id &&
    decision.execution_version > pickup.execution_version && decision.decision_id ? decision : null;
  const pickupException = p?.lines.some((line, index) => line.condition !== 'INTACT' || line.issue_code !== null || compareQuantities(line.observed_quantity, manifest.lines.find(item => item.line_id === line.line_id)?.expected_quantity ?? manifest.lines[index].expected_quantity) !== 0);
  let pickup_state = 'NOT_RECORDED';
  if (!pickup) block('CARGO_PICKUP_REQUIRED', 'Verify cargo at pickup.');
  else if (currentDecision?.action === 'REJECT_PICKUP') { pickup_state = 'REJECTED'; block('CARGO_PICKUP_REJECTED', 'Source review rejected this pickup.'); }
  else if (currentDecision?.action === 'WAIT') { pickup_state = 'WAITING'; block('CARGO_SOURCE_WAIT', 'Wait for source review or record a new count.'); }
  else if (pickupException && currentDecision?.action !== 'ACCEPT_OBSERVED') { pickup_state = 'AWAITING_DECISION'; block('CARGO_SOURCE_DECISION_REQUIRED', 'Source acceptance is required for this observation.'); }
  else {
    pickup_state = 'WAITING';
    const bound = clearance && clearance.execution_id === pickup.execution_id && clearance.receipt_id === pickup.receipt_id && clearance.manifest_hash === manifest.manifest_ref.hash &&
      clearance.decision_id === (currentDecision?.decision_id ?? null) && clearance.version > Math.max(pickup.execution_version, currentDecision?.execution_version ?? 0);
    const secure = bound && matchesCargoAuthorityProof(clearance.safety_proof, 'POST_LOAD_SECUREMENT', pickup) && clearance.safety_evidence_ref === clearance.safety_proof.reference;
    if (!bound) block('CARGO_FLEET_CLEARANCE_REQUIRED', 'Fleet departure clearance is required.');
    if (!secure) block('CARGO_SECUREMENT_REQUIRED', 'Approved post-load safety and securement evidence is required.');
    if (bound && secure) pickup_state = 'READY';
  }
  let delivery_state = 'NOT_RECORDED';
  if (!delivery) block('CARGO_DELIVERY_REQUIRED', 'Verify cargo at delivery.');
  else {
    delivery_state = 'AWAITING_REVIEW';
    const chronological = pickup && delivery.execution_id === pickup.execution_id && delivery.execution_version > Math.max(pickup.execution_version, currentDecision?.execution_version ?? 0, clearance?.version ?? 0);
    const clean = p && d.lines.every(line => line.condition === 'INTACT' && line.issue_code === null && compareQuantities(line.observed_quantity, p.lines.find(item => item.line_id === line.line_id).observed_quantity) === 0);
    if (!clean || !chronological) block('CARGO_DELIVERY_REVIEW_REQUIRED', 'The delivery observation requires review.');
    const confirmed = matchesCargoAuthorityProof(delivery.receiver_proof, 'RECEIVER_CONFIRMATION', delivery);
    if (!confirmed) block('CARGO_RECEIVER_CONFIRMATION_REQUIRED', 'Approved receiver confirmation is required.');
    if (pickup_state === 'READY' && clean && chronological && confirmed) delivery_state = 'CONFIRMED';
  }
  return { pickup_state, delivery_state, can_depart: pickup_state === 'READY', can_complete: delivery_state === 'CONFIRMED', blockers, lines };
}
