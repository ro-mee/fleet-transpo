import { describe, expect, it } from 'vitest';
import * as contracts from './contracts';

const id = '11111111-1111-4111-8111-111111111111';
const base = { submission_id: id, receipt_id: id, expected_version: 2, kind: 'SOURCE', action: 'ACCEPT_OBSERVED', reason: 'Counts and photos checked.', reviewed_evidence_ids: [] };
describe('internal manager review contract', () => {
  it('accepts source review without outside communication or client authority', () => {
    expect(contracts.internalReviewSchema?.safeParse(base).success).toBe(true);
  });
  it('requires actual securement confirmations for CLEAR', () => {
    const value = { ...base, kind: 'SECUREMENT', action: 'CLEAR' };
    expect(contracts.internalReviewSchema?.safeParse(value).success).toBe(false);
    expect(contracts.internalReviewSchema?.safeParse({ ...value, securement_checks: { load_secured: true, vehicle_safe: true, counts_reviewed: true } }).success).toBe(true);
  });
  it('rejects wrong-stage actions and caller-supplied authority', () => {
    expect(contracts.internalReviewSchema?.safeParse({ ...base, kind: 'RECEIVER' }).success).toBe(false);
    expect(contracts.internalReviewSchema?.safeParse({ ...base, employee_id: 7 }).success).toBe(false);
    expect(contracts.internalReviewSchema?.safeParse({ ...base, reviewed_evidence_ids: [id, id] }).success).toBe(false);
  });
  it('can review every photo in a maximum-size receipt', () => {
    const ids = Array.from({ length:2501 },(_,index)=>`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`);
    expect(contracts.internalReviewSchema.safeParse({ ...base,reviewed_evidence_ids:ids.slice(0,2500) }).success).toBe(true);
    expect(contracts.internalReviewSchema.safeParse({ ...base,reviewed_evidence_ids:ids }).success).toBe(false);
  });
});
