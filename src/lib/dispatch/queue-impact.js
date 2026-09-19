// Phase 4 — downstream queue impact comparison (pure).
// Compares two planner runs over the SAME queue with the candidate choice
// pinned to A vs B. Never claims global optimality; callers must label
// partial/capped results "Within the evaluated queue".
export function compareQueueImpact(runA, runB, { requestId = null } = {}) {
  const map = proposals => new Map((proposals ?? []).map(p => [Number(p.requestId), p]));
  const a = map(runA?.proposals);
  const b = map(runB?.proposals);
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  const affected = [];
  for (const id of ids) {
    if (Number(id) === Number(requestId)) continue;
    const pa = a.get(id), pb = b.get(id);
    const oa = pa?.outcome ?? 'NOT_EVALUATED', ob = pb?.outcome ?? 'NOT_EVALUATED';
    if (oa !== ob) affected.push({ requestId: id, withChoiceA: oa, withChoiceB: ob });
  }
  const coverage = run => ({
    served: run?.servedCount ?? null,
    evaluated: run?.evaluatedRequests ?? null,
    total: run?.totalRequests ?? null,
    complete: run?.analysisComplete === true,
    incompleteReason: run?.incompleteReason ?? null,
  });
  return {
    withinEvaluatedQueue: true,
    affected,
    coverageA: coverage(runA),
    coverageB: coverage(runB),
    scopeDate: runA?.window?.date ?? runB?.window?.date ?? null,
  };
}
