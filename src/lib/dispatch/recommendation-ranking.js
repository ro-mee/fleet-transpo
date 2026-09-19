// Evidence decides the band; unused buffer above SAFE has no further bonus.
export const pairIdentity = p => `${p?.vehicle_id}:${p?.driver_id}`;
const known = n => n != null && Number.isFinite(Number(n));
const band = p => (p?.hardConflicts?.some(c=>!c.reviewable) || p?.checks?.some(c=>c.status==='blocking') || p?.dispatchContext?.reasonCode==='STANDBY_NOT_VERIFIED') ? 4
  : p?.evaluated === false ? 3 : (!p?.checks?.length || p.checks.some(c=>c.status==='missing')) ? 2
    : p?.feasibility?.verdict === 'SAFE' && (p?.advisories?.length || p?.readiness !== 'VERIFIED') ? 1
      : ({ SAFE: 0, TIGHT: 1, UNKNOWN: 2, INFEASIBLE: 4 }[p?.feasibility?.verdict] ?? 3);
const travel = p => p?.scheduleEvidence?.transferMinutes ?? p?.proximity?.etaMinutes ?? p?.expectedRoute?.etaMinutes ?? p?.feasibility?.deadheadMin;
const workload = p => p?.workloadEvidence?.complete ? p.workloadEvidence : null;

export function comparePairEvidence(a, b, policy = {}) {
  const difference = band(a) - band(b);
  if (difference) return { order: difference, code: 'RELIABILITY', label: 'Larger timing margin', explanation: 'The timing evidence favors this pair over an option with tighter or unverified preparation time.' };
  const at = travel(a), bt = travel(b);
  if (known(at) && known(bt) && Math.abs(at - bt) > (policy.efficiencyTieMinutes ?? 10))
    return { order: at - bt, code: 'EFFICIENCY', label: 'Less transfer time', explanation: 'Both options have comparable timing reliability; this pair needs materially less estimated travel to pickup.' };
  const aw = workload(a), bw = workload(b);
  if (band(a) === 0 && aw && bw && aw.serviceDate === bw.serviceDate) {
    const load = aw.totalTrips - bw.totalTrips || (known(aw.serviceMinutes) && known(bw.serviceMinutes) ? aw.serviceMinutes - bw.serviceMinutes : 0);
    if (load) return { order: load, code: 'WORKLOAD', label: 'Better workload balance', explanation: 'Both options have sufficient timing margins. Extra unused buffer adds little benefit, so the lighter recorded service-date workload decides.' };
  }
  if (known(at) && known(bt) && at !== bt)
    return { order:at-bt,code:'EFFICIENCY',label:'Less transfer time',explanation:'The recorded workload does not distinguish these options; the shorter supported transfer estimate breaks the tie.' };
  const standing = Number(a.reason_type !== 'designated') - Number(b.reason_type !== 'designated');
  return { order: standing || Number(a.vehicle_id) - Number(b.vehicle_id) || Number(a.driver_id) - Number(b.driver_id),
    code: 'SCHEDULE_FIT', label: band(a) === 0 ? 'Best schedule fit' : 'Needs verification',
    explanation: band(a) === 0
      ? standing
        ? 'Both options have workable timing; the designated driver pairing puts this option first.'
        : 'The checked schedule fits; no supported material timing or workload difference distinguishes these options.'
      : standing
        ? 'Timing is still being checked; the designated driver pairing is the supported preference between these options.'
        : 'Neither option has a verified timing advantage yet; this option is listed first only by the stable tie-breaker.' };
}

export function rankDispatchPairs(candidates, policy = {}) {
  candidates.sort((a,b)=>Number(a.vehicle_id)-Number(b.vehicle_id)||Number(a.driver_id)-Number(b.driver_id));
  candidates.sort((a, b) => comparePairEvidence(a, b, policy).order);
  for (let i = 0; i < candidates.length; i++) {
    const pair = candidates[i], other = candidates[i === 0 ? 1 : 0];
    const comparison = other ? comparePairEvidence(pair, other, policy) : null;
    // A lone option has nothing to compare against, and saying so is not the
    // same as inviting a comparison that cannot exist. The generic sentence is
    // kept for the multi-pair fallback it was written for: it fires only when
    // the comparator left candidates[0] losing to candidates[1], whose own
    // decisionEvidence is not written yet.
    const alone = !other;
    pair.decisionEvidence = {
      reliability: pair.feasibility?.verdict ?? 'UNKNOWN',
      code: comparison?.code ?? 'ONLY_OPTION',
      label: i === 0 ? comparison?.label ?? 'Only evaluated option' : 'Alternative',
      explanation: comparison?.order <= 0 ? comparison.explanation
        : alone ? 'This is the only evaluated option, so there is nothing to compare it against.'
          : other?.decisionEvidence?.explanation ?? 'Compare the current evidence before choosing.',
      comparedPair: other ? { vehicleId: other.vehicle_id, driverId: other.driver_id } : null,
      alternativeAdvantage: other && workload(pair) && workload(other) && pair.workloadEvidence.totalTrips < other.workloadEvidence.totalTrips ? 'Lighter service-date workload' : null,
    };
    pair.reasons = [pair.decisionEvidence.explanation];
  }
  return candidates;
}
