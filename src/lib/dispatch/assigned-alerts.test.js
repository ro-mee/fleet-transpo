import { it, expect } from 'vitest';
import { evaluateAssignedIssue } from './assigned-alerts';

it('stays silent for closed records and clear assignments', () => {
  expect(evaluateAssignedIssue({ request: { fleet_status: 'Cancelled' }, evidence: {} }).issue).toBe(false);
  expect(evaluateAssignedIssue({ request: { fleet_status: 'Scheduled' }, evidence: { evaluated: true, readiness: 'VERIFIED', feasibility: { verdict: 'SAFE' }, checks: [], hardConflicts: [] } }).issue).toBe(false);
});

it('raises one deduplicated issue per incident kind, verification is not lateness', () => {
  const blocking = { evaluated: true, readiness: 'REVIEW_REQUIRED', feasibility: { verdict: 'INFEASIBLE', reasons: ['Overlap'] }, checks: [], hardConflicts: [{ type: 'maintenance_conflict', message: 'Service overlaps.' }] };
  const a = evaluateAssignedIssue({ request: { fleet_status: 'Scheduled' }, evidence: blocking });
  const b = evaluateAssignedIssue({ request: { fleet_status: 'Scheduled' }, evidence: blocking });
  expect(a.issue).toBe(true);
  expect(a.fingerprint).toBe(b.fingerprint);
  expect(a.message).toMatch(/assignment stays intact/i);
  const unknown = evaluateAssignedIssue({ request: { fleet_status: 'Scheduled' }, evidence: { evaluated: true, readiness: 'REVIEW_REQUIRED', feasibility: { verdict: 'UNKNOWN' }, checks: [{ status: 'missing', id: 'route' }], hardConflicts: [] } });
  expect(unknown.kind).toBe('verification');
  expect(unknown.message).not.toMatch(/you are late|will be late|is running late/i);
});
