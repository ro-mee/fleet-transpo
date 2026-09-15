"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { bucketProposal } from "@/lib/dispatch/decision";
import { priorityRank } from "@/lib/scheduling/priority";
import { useNow } from "@/components/reservations/trip-summary";

const PLAN_ENDPOINT = "/api/integration/transport-requests/dispatch-plan";

export { bucketProposal };

/**
 * Shared hook to manage the dispatch plan lifecycle, live validation,
 * proposals sorting, and derived truthful decision counts.
 */
export function useDispatchPlan({ canRecommend = true, paused = false } = {}) {
  const queryClient = useQueryClient();
  const now = useNow(1000);
  const [stale, setStale] = useState(false);
  const [failure, setFailure] = useState(null);
  const generation = useRef(0);
  const lastRefresh = useRef(0);

  // Cached plan query (populated by analyze mutation)
  const { data: plan } = useQuery({
    queryKey: ["dispatch-plan"],
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });

  // Analyze queue mutation
  const analyze = useMutation({
    mutationFn: async (input) => {
      const operation = ++generation.current;
      try {
        const result = await apiFetch(PLAN_ENDPOINT, { method: "POST", body: typeof input === 'string' ? {date:input} : input });
        return {...result,operation};
      } catch (error) { error.operation = operation; throw error; }
    },
    onMutate: () => {
      setFailure(null);
      setStale(false);
      queryClient.setQueryData(["dispatch-plan"], null);
    },
    onSuccess: (result) => {
      if (result.operation !== generation.current) return;
      queryClient.setQueryData(["dispatch-plan"], result);
      queryClient.invalidateQueries({queryKey:['reservation-recommendation']});
    },
    onError: (err) => {
      if (err.operation !== generation.current) return;
      setFailure(err.message || "Failed to analyze queue");
    },
  });

  // Live validation poll every 10s while plan is active
  const validation = useQuery({
    queryKey: ["dispatch-plan-valid", plan?.planToken],
    queryFn: () =>
      apiFetch(PLAN_ENDPOINT, {
        method: "PATCH",
        body: { planToken: plan.planToken },
      }),
    enabled:
      !!plan?.planToken &&
      canRecommend &&
      !stale &&
      Number.isFinite(+new Date(plan.expiresAt)) &&
      +new Date(plan.expiresAt) > now,
    retry: false,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const isExpired = !!plan && (!Number.isFinite(+new Date(plan.expiresAt)) || +new Date(plan.expiresAt) <= now);
  const invalidReason = failure ? `Queue analysis failed: ${failure}`
    : stale ? 'Queue plan changed. Analyze this service date again.'
    : isExpired ? 'Queue plan expired. Analyze this service date again.'
    : validation.isError ? 'Queue validation failed. Analyze this service date again.' : null;
  const isInvalid = !!invalidReason;
  const refresh = analyze.mutate;
  useEffect(() => {
    if (!plan || !canRecommend || paused || analyze.isPending || !isInvalid || Date.now()-lastRefresh.current < 30_000 || document.visibilityState !== 'visible') return;
    lastRefresh.current = Date.now();
    refresh(plan.window?.date);
  }, [plan,canRecommend,paused,analyze.isPending,isInvalid,now,refresh]);

  // Proposals sorted by priority rank, pickup time, and requestId
  const proposals = useMemo(() => {
    if (!plan?.proposals) return [];
    return [...plan.proposals].sort((a, b) => {
      const pDiff =
        priorityRank(a.request?.derived_priority) -
        priorityRank(b.request?.derived_priority);
      if (pDiff !== 0) return pDiff;
      const tDiff =
        +new Date(a.request?.pickup_datetime || 0) -
        +new Date(b.request?.pickup_datetime || 0);
      if (tDiff !== 0) return tDiff;
      return Number(a.requestId) - Number(b.requestId);
    });
  }, [plan]);

  // Derived bucket counts across the entire plan scope
  const counts = useMemo(() => {
    if (!plan) {
      return {
        ready: 0,
        reviewRequired: 0,
        blocked: 0,
        needsVerification: 0,
        waiting: 0,
        notEvaluated: 0,
        total: 0,
        evaluated: 0,
        isAnalyzed: false,
      };
    }

    let ready = 0;
    let reviewRequired = 0;
    let blocked = 0;
    let needsVerification = 0;
    let waiting = 0;
    let notEvaluated = 0;

    for (const p of proposals) {
      const b = bucketProposal(p, now);
      if (b === "Ready for confirmation") ready++;
      else if (b === "Review required") reviewRequired++;
      else if (b === "Blocked") blocked++;
      else if (b === "Waiting for preceding request") waiting++;
      else if (b === "Needs verification") needsVerification++;
      else notEvaluated++;
    }

    if (plan.totalRequests > proposals.length) {
      notEvaluated += plan.totalRequests - proposals.length;
    }

    return {
      ready,
      reviewRequired,
      blocked,
      needsVerification,
      waiting,
      notEvaluated,
      total: plan.totalRequests || 0,
      evaluated: plan.evaluatedRequests || 0,
      isAnalyzed: true,
      isExpired,
      isInvalid,
    };
  }, [plan, proposals, now, isExpired, isInvalid]);

  const getProposal = useCallback(
    (requestId) => {
      if (!requestId || !proposals.length) return null;
      const numId = Number(requestId);
      return proposals.find((p) => Number(p.requestId) === numId) || null;
    },
    [proposals]
  );

  const invalidatePlan = useCallback(() => {
    setStale(true);
    queryClient.setQueryData(["dispatch-plan"], null);
    queryClient.invalidateQueries({ queryKey: ["dispatch-plan"] });
  }, [queryClient]);

  return {
    plan,
    analyze,
    validation,
    stale,
    setStale,
    failure,
    setFailure,
    isExpired,
    isInvalid,
    invalidReason,
    proposals,
    counts,
    now,
    getProposal,
    bucketProposal: (p) => bucketProposal(p, now),
    invalidatePlan,
  };
}
