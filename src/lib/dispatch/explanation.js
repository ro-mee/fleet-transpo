import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { LOCATION_POLICY_VERSION } from './location-relevance';

// Phase 2 — verified "what changed?" explanations.
// A signed, size-bounded snapshot of the last displayed evaluation. Never
// assignment authority: purpose string differs from plan/assign tokens and
// verifyExplanationSnapshot rejects any cross-purpose use by construction
// (it only parses its own envelope).
export const EXPLANATION_SNAPSHOT_VERSION = 1;
const PURPOSE = 'fleet-dispatch-explanation-v1';
const MAX_PAIRS = 12;

function slackBand(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return 'unknown';
  const m = Number(minutes);
  if (m < 0) return 'infeasible';
  if (m < 15) return 'tight';
  return 'sufficient';
}

function pairKey(p) {
  return `${p.vehicleId}:${p.driverId}`;
}

// Minimal snapshot: request/date, pair IDs, check states, schedule/workload
// facts, provenance, policy version, evaluated time. Bounded to 12 pairs.
export function buildExplanationSnapshot(evidence = {}) {
  const pairs = (evidence.pairs ?? []).slice(0, MAX_PAIRS).map(p => ({
    vehicleId: Number(p.vehicleId),
    driverId: Number(p.driverId),
    state: p.state ?? null,
    routeVerdict: p.routeVerdict ?? null,
    slack: p.scheduleEvidence?.usableSlackMinutes ?? null,
    band: slackBand(p.scheduleEvidence?.usableSlackMinutes),
    releaseAt: p.scheduleEvidence?.releaseAt ?? null,
    releaseSource: p.scheduleEvidence?.releaseSource ?? null,
    workload: p.workloadEvidence?.complete
      ? { serviceDate: p.workloadEvidence.serviceDate, completed: p.workloadEvidence.completedTrips ?? null, active: p.workloadEvidence.activeTrips ?? null, scheduled: p.workloadEvidence.scheduledTrips ?? null }
      : null,
    checks: (p.checks ?? []).map(c => ({ id: c.id ?? c.label ?? null, status: c.status ?? null })),
    decision: p.decisionEvidence?.explanation ?? p.decisionEvidence?.code ?? null,
  }));
  return {
    v: EXPLANATION_SNAPSHOT_VERSION,
    policyVersion: LOCATION_POLICY_VERSION,
    requestId: evidence.requestId ?? null,
    pickupAt: evidence.pickupAt ?? null,
    evaluatedAt: evidence.evaluatedAt ?? null,
    recommended: evidence.recommended ? { vehicleId: Number(evidence.recommended.vehicleId), driverId: Number(evidence.recommended.driverId) } : null,
    pairs,
    exclusions: (evidence.exclusions ?? []).slice(0, 30).map(e => ({ vehicleId: e.vehicleId ?? null, reason: e.reason ?? null, prefiltered: e.prefiltered === true })),
  };
}

function signPayload(payload) {
  const key = process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('Explanation signing is not configured.');
  return createHmac('sha256', key).update(`${PURPOSE}:${payload}`).digest('base64url');
}

export function signExplanationSnapshot(snapshot) {
  const payload = Buffer.from(JSON.stringify(snapshot)).toString('base64url');
  return `${payload}.${signPayload(payload)}`;
}

// Verify signature, request scope and schema. Returns {snapshot} or throws
// with .code: 'STALE' | 'SCOPE' | 'TAMPERED'. Revision mismatch is expected
// over time and surfaces as STALE (facts stay readable, never authorizing).
export function verifyExplanationSnapshot(token, { requestId = null } = {}) {
  const fail = code => { const e = new Error('Explanation baseline is unavailable.'); e.code = code; throw e; };
  try {
    if (typeof token !== 'string' || token.length > 16_000) fail('TAMPERED');
    const [payload, mac, extra] = token.split('.');
    if (!payload || !mac || extra) fail('TAMPERED');
    const expected = Buffer.from(signPayload(payload));
    const actual = Buffer.from(mac);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('TAMPERED');
    const snapshot = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (snapshot?.v !== EXPLANATION_SNAPSHOT_VERSION || !Array.isArray(snapshot?.pairs)) fail('TAMPERED');
    if (requestId != null && Number(snapshot.requestId) !== Number(requestId)) fail('SCOPE');
    if (snapshot.policyVersion !== LOCATION_POLICY_VERSION) fail('STALE');
    return snapshot;
  } catch (e) {
    if (e?.code) throw e;
    fail('TAMPERED');
  }
}

// Compare by stable pair identity, not Option 1/2 position. Suppresses
// timestamp-only refreshes and insignificant numeric jitter (slack band).
export function diffExplanationSnapshots(prev, curr) {
  const changes = [];
  if (!prev || !curr) return { changed: false, fingerprint: null, changes };
  const before = new Map((prev.pairs ?? []).map(p => [pairKey(p), p]));
  const after = new Map((curr.pairs ?? []).map(p => [pairKey(p), p]));
  for (const [key, a] of after) {
    const b = before.get(key);
    if (!b) { changes.push({ type: 'appeared', vehicleId: a.vehicleId, driverId: a.driverId, before: null, after: a.state }); continue; }
    if (b.state !== a.state) changes.push({ type: 'eligibility', vehicleId: a.vehicleId, driverId: a.driverId, before: b.state, after: a.state });
    if (b.routeVerdict !== a.routeVerdict) changes.push({ type: 'feasibility', vehicleId: a.vehicleId, driverId: a.driverId, before: b.routeVerdict, after: a.routeVerdict });
    if (b.band !== a.band) changes.push({ type: 'reliability', vehicleId: a.vehicleId, driverId: a.driverId, before: b.band, after: a.band });
    if (JSON.stringify(b.checks) !== JSON.stringify(a.checks)) changes.push({ type: 'checks', vehicleId: a.vehicleId, driverId: a.driverId, before: b.checks, after: a.checks });
    if ((b.decision ?? null) !== (a.decision ?? null)) changes.push({ type: 'rationale', vehicleId: a.vehicleId, driverId: a.driverId, before: b.decision, after: a.decision });
  }
  for (const [key, b] of before) {
    if (!after.has(key)) changes.push({ type: 'disappeared', vehicleId: b.vehicleId, driverId: b.driverId, before: b.state, after: null });
  }
  const prevRec = prev.recommended ? pairKey(prev.recommended) : null;
  const currRec = curr.recommended ? pairKey(curr.recommended) : null;
  if (prevRec !== currRec) changes.push({ type: 'recommendation', vehicleId: curr?.recommended?.vehicleId ?? null, driverId: curr?.recommended?.driverId ?? null, before: prevRec, after: currRec });
  const fingerprint = changes.length ? createHash('sha256').update(JSON.stringify(changes.map(c => [c.type, c.vehicleId, c.driverId, c.before, c.after]))).digest('hex').slice(0, 16) : null;
  return { changed: changes.length > 0, fingerprint, changes: changes.slice(0, 20) };
}

export function summarizeChanges(diff) {
  if (!diff?.changed) return 'No material change since the last verified evaluation.';
  return diff.changes.slice(0, 4).map(c => {
    if (c.type === 'appeared') return `Vehicle #${c.vehicleId} / driver #${c.driverId} is now evaluated (${c.after ?? 'listed'}).`;
    if (c.type === 'disappeared') return `Vehicle #${c.vehicleId} / driver #${c.driverId} is no longer in the evaluation.`;
    if (c.type === 'recommendation') return 'The recommended pair changed.';
    return `Vehicle #${c.vehicleId} / driver #${c.driverId}: ${c.type} changed from ${c.before ?? 'unknown'} to ${c.after ?? 'unknown'}.`;
  }).join(' ');
}
