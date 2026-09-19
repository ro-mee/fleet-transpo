import { it, expect } from 'vitest';
import { compareQueueImpact } from '@/lib/dispatch/queue-impact';

it('separates fixed conflicts from competition without claiming optimality', () => {
  const runA = { window: { date: '2026-09-16' }, servedCount: 2, evaluatedRequests: 3, totalRequests: 3, analysisComplete: true, incompleteReason: null, proposals: [{ requestId: 1, outcome: 'VERIFIED' }, { requestId: 2, outcome: 'VERIFIED' }, { requestId: 3, outcome: 'REVIEW_REQUIRED' }] };
  const runB = { ...runA, servedCount: 1, proposals: [{ requestId: 1, outcome: 'VERIFIED' }, { requestId: 2, outcome: 'HARD_CONFLICT' }, { requestId: 3, outcome: 'REVIEW_REQUIRED' }] };
  const impact = compareQueueImpact(runA, runB, { requestId: 1 });
  expect(impact.withinEvaluatedQueue).toBe(true);
  expect(impact.affected).toEqual([{ requestId: 2, withChoiceA: 'VERIFIED', withChoiceB: 'HARD_CONFLICT' }]);
  expect(impact.scopeDate).toBe('2026-09-16');
});
