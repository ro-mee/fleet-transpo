import { createHash } from 'node:crypto';

// Phase 5A — one actionable conversation update per meaningful issue.
// Pure evaluator over the committed pair's fresh evidence. The assignment's
// own commitment is excluded by the caller (same-request evaluation).
// Unknown evidence is a verification issue, never proven lateness.
export function evaluateAssignedIssue({ request, evidence } = {}) {
  const status = request?.fleet_status;
  if (['Cancelled', 'Completed'].includes(status)) return { issue: false, reason: 'closed' };
  if (!evidence || evidence.evaluated !== true) {
    return fin('verification', 'Current evidence for the assigned pair could not be verified. Recheck this reservation.', ['unverified']);
  }
  const blockers = [...(evidence.hardConflicts ?? []), ...(evidence.checks ?? []).filter(c => c.status === 'blocking')];
  const missing = (evidence.checks ?? []).filter(c => c.status === 'missing');
  if (blockers.length) {
    const kind = kindOf(blockers[0]);
    return fin(kind, `${blockers[0].message ?? 'The assigned pair has a new conflict.'} Check replacement options; the current assignment stays intact.`, blockers.map(b => b.type ?? b.id ?? b.message));
  }
  if (evidence.feasibility?.verdict === 'INFEASIBLE') {
    return fin('timing', `${evidence.feasibility.reasons?.[0] ?? 'Timing for the assigned pair deteriorated.'} Check replacement options; the current assignment stays intact.`, evidence.feasibility.reasons ?? []);
  }
  if (evidence.feasibility?.verdict === 'UNKNOWN' || missing.length) {
    return fin('verification', 'Some required evidence for the assigned pair is unverified. Verify the flagged records; this is not proven lateness.', missing.map(m => m.id ?? m.label));
  }
  if (evidence.readiness !== 'VERIFIED') {
    return fin('readiness', 'The assigned pair is not verified ready. Check readiness before departure.', [evidence.readiness]);
  }
  return { issue: false, reason: 'clear' };
}

function kindOf(blocker = {}) {
  const t = String(blocker.type ?? blocker.id ?? '');
  if (/maintenance/i.test(t)) return 'maintenance';
  if (/leave|schedule|driver_unavailable|driver_conflict/i.test(t)) return 'leave';
  if (/standby|readiness|gps/i.test(t)) return 'readiness';
  if (/vehicle_conflict|travel_buffer|capacity|registration|insurance|license|pairing|incident/i.test(t)) return 'resource';
  return 'resource';
}

function fin(kind, message, parts) {
  const fingerprint = createHash('sha256').update(JSON.stringify([kind, ...(parts ?? []).slice(0, 3)])).digest('hex').slice(0, 16);
  return { issue: true, kind, message, fingerprint };
}
