"use client";

import { useEffect, useRef, useState } from "react";
import { manilaDate } from "@/lib/dispatch/plan-window";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConflictBlock } from "@/components/reservations/conflict-block";
import { CopilotConversation, setReservationMessages } from "./copilot-conversation";
import { CopilotBubble, CopilotOptionFlow, PairTemporalFacts } from "@/components/reservations/copilot-option-flow";
import { deriveOptions, optionKey as pairKey } from "@/components/reservations/copilot-options";
import { useNow } from "@/components/reservations/trip-summary";
import {
  getRecommendation,
  getTransportRequest,
  assignResources,
} from "@/services/transport.service";
import { dispatchDecision, dispatchConfirmation } from "@/lib/dispatch/decision";
import { formatDateTime, cn } from "@/lib/utils";
import { useRoleAccess } from "@/hooks/use-role-access";
import { parseCopilotIntent } from '@/lib/dispatch/conversation';
import {
  RefreshCw,
} from "lucide-react";

const pairLabel = (p) =>
  p
    ? `${p.vehicle?.plate_number || "Vehicle #" + p.vehicle_id} + ${
        p.driver?.driver_name || "Driver #" + p.driver_id
      }`
    : "No current selection";

export function AiRecommendationPanel({
  requestId,
  selectedRequest = null,
  canAssign = false,
  alreadyAssigned = false,
  onAssigned,
  onBusyChange,
  className,
  hideHeader = false,
  planProposal = null,
  planToken = null,
  planExpiresAt = null,
  onPlanStale,
  pickupAt,
  plan = null,
  planError = null,
  onReanalyze = null,
  isAnalyzing = false,
  queueMode = false,
  planValidation = null,
  planInvalidReason = null,
}) {
  const client = useQueryClient();
  const now = useNow(1000);
  const { can } = useRoleAccess();

  const [selected, setSelected] = useState(null);
  const [pinnedKeys, setPinnedKeys] = useState(null);
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState(null);
  const [committed, setCommitted] = useState(null);
  const [selectionCheck, setSelectionCheck] = useState(null);
  const selectionGeneration = useRef(0);
  const submitting = useRef(false);

  // Reset local review & mutation states whenever active request changes
  const [activeRequest,setActiveRequest]=useState(requestId);
  if(activeRequest!==requestId){
    setActiveRequest(requestId);
    setSelected(null);
    setPinnedKeys(null);
    setReason("");
    setFailure(null);
    setCommitted(null);
    setSelectionCheck(null);
  }
  useEffect(() => () => { selectionGeneration.current++; }, [requestId]);

  // Request-level recommendation query
  const query = useQuery({
    queryKey: ["reservation-recommendation", requestId, "decision"],
    queryFn: () => getRecommendation(requestId),
    enabled: !!requestId && !alreadyAssigned && !committed,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const rec = query.data;
  const candidates = rec?.pair?.candidates ?? [];
  const options = deriveOptions({
    candidates,
    recommended: (plan?.selectedPair ? rec?.pair?.recommended : planProposal?.pair ?? rec?.pair?.recommended) ?? null,
    proposalPair: planProposal?.pair ?? null,
    pinnedKeys,
  });
  const pair = selected
    ? (pairKey(planProposal?.pair) === selected ? planProposal.pair : null) ?? candidates.find((p) => pairKey(p) === selected) ??
      options.find((o) => pairKey(o.pair) === selected)?.pair ??
      null
    : null;
  const effectivePlanToken = queueMode ? planToken : null;
  const analysisDate = pickupAt && Number.isFinite(+new Date(pickupAt)) ? manilaDate(pickupAt) : manilaDate();


  // Handle scheduled horizon re-check
  const contextBoundary = rec?.requestContext?.nextBoundaryAt ? +new Date(rec.requestContext.nextBoundaryAt) : null;

  const refetch = query.refetch;
  useEffect(() => {
    if (
      contextBoundary == null ||
      !Number.isFinite(contextBoundary) ||
      alreadyAssigned ||
      committed
    )
      return;
    const delay = contextBoundary - Date.now();
    if (delay < 0 || delay > 30_000) return;
    const timer = setTimeout(() => { if (document.visibilityState === 'visible') refetch(); }, delay + 1);
    return () => clearTimeout(timer);
  }, [contextBoundary, rec?.evaluatedAt, alreadyAssigned, committed, refetch]);

  const planExpired =
    !!planProposal &&
    (!planToken ||
      !planExpiresAt ||
      !Number.isFinite(+new Date(planExpiresAt)) ||
      +new Date(planExpiresAt) <= now);



  const queueCurrent =
    queueMode && !!plan && !planInvalidReason && +new Date(plan.expiresAt) > now && planValidation?.isSuccess;

  const decision = dispatchDecision(pair,{now,stale:query.isError || planExpired || (!!planProposal && !queueCurrent)});

  const complete = (res) => {
    setCommitted(res);
    setReservationMessages(requestId, previous => [...previous.slice(-29), {role:'assistant',content:`Assignment completed. ${pair ? pairLabel(pair) : 'The selected resources'} assigned to this reservation.`,at:Date.now()}]);
    setFailure(null);
    client.setQueryData(["dispatch-plan"], null);
    for (const key of [
      "transport-request",
      "transport-requests",
      "reservation-recommendation",
      "reservation-timeline",
      "dispatches",
      "dispatches-status",
    ]) {
      client.invalidateQueries({ queryKey: [key] });
    }
    onAssigned?.(res);
  };

  const assignment = useMutation({
    mutationFn: (choice) =>
      assignResources(requestId, {
        vehicleId: choice.vehicle_id,
        driverId: choice.driver_id,
        force: choice.force,
        overrideReason: choice.reason,
        planToken: choice.planToken,
      }),
    onSuccess: complete,
    onSettled: () => { submitting.current = false; },
    onError: async (error, choice) => {
        setFailure({
        message: error.message,
        previous: choice.label,
        conflicts:
          error.data?.conflicts ??
          (error.data?.conflict ? [error.data.conflict] : []),
      });
      if (planToken && error.status === 409) {
        onPlanStale?.(error);
      }
      if (!error.status || error.status >= 500) {
        setFailure({
          message:
            "Outcome uncertain. Checking the current request before retrying.",
          previous: choice.label,
          checking: true,
        });
        try {
          const current = await getTransportRequest(requestId);
          if (
            current.fleet_status === "Assigned" &&
            Number(current.vehicle_id) === Number(choice.vehicle_id) &&
            Number(current.driver_id) === Number(choice.driver_id)
          ) {
            complete(current);
          } else {
            setFailure({
              message:
                "Current request loaded. Review the record and recheck before retrying.",
              previous: choice.label,
            });
          }
        } catch {
          setFailure({
            message:
              "Unable to verify the assignment outcome. Open the current request before retrying.",
            previous: choice.label,
            checking: true,
          });
        }
      }
    },
  });

  const chooseOption = async (option, message = null) => {
    if (assignment.isPending || failure?.checking || option.unavailable || dispatchDecision(option.pair).state === 'BLOCKED') return;
    const operation = ++selectionGeneration.current;
    const key = pairKey(option.pair);
    setReservationMessages(requestId, previous => [...previous.slice(-29), {role:'user',content:message || `Option ${option.index+1}`,at:Date.now()}]);
    setSelected(pairKey(option.pair));
    setPinnedKeys(options.map(o => pairKey(o.pair)));
    setFailure(null);
    setReason("");
    setSelectionCheck({key,pending:true});
    try {
      if (queueMode && onReanalyze) {
        const baseline = plan?.planToken && !planInvalidReason && +new Date(plan.expiresAt)>now ? plan : await onReanalyze(analysisDate);
        if (operation !== selectionGeneration.current) return;
        if (!baseline?.planToken) throw new Error('Queue analysis is required before confirming this option.');
        await onReanalyze({date:analysisDate,selection:{requestId:Number(requestId),vehicleId:Number(option.pair.vehicle_id),driverId:Number(option.pair.driver_id)},basePlanToken:baseline.planToken});
      }
      const fresh = await query.refetch();
      if (fresh?.isError) throw fresh.error;
      if (operation === selectionGeneration.current) setSelectionCheck({key,pending:false});
    } catch(error) {
      if (operation !== selectionGeneration.current) return;
      setSelectionCheck(null);
      setFailure({message:error.message || 'This option could not be rechecked.',previous:pairLabel(option.pair)});
    }
  };

  const recheck = async () => {
    setFailure(null);
    setReason("");
    const option = options.find(o => pairKey(o.pair) === selected);
    if (option) await chooseOption(option, 'Recheck selected option');
    else await query.refetch();
  };

  const chooseAnother = () => {
    selectionGeneration.current++;
    setSelected(null);
    setPinnedKeys(null);
    setFailure(null);
    setReason("");
    setSelectionCheck(null);
  };

  useEffect(()=>{onBusyChange?.(assignment.isPending || !!failure?.checking || !!selectionCheck?.pending);},[assignment.isPending,failure?.checking,selectionCheck?.pending,onBusyChange]);

  const action = dispatchConfirmation({
    canAssign, pair, decision, fetching: query.isFetching, error: query.isError,
    pending: assignment.isPending, failure, reason, now,
    queue: queueMode
      ? { plan, proposal: planProposal, token: planToken, validation: planValidation,
          invalidReason: planInvalidReason || planError, analyzing: isAnalyzing }
      : null,
  });

  if (action.recovery === "analyze") action.message = "This option needs a fresh queue check. Recheck the reservation before assigning.";
  const manual = !!pair && !decision.canConfirm;
  const canRecommend = can("reservations", "recommend");
  // The checked-pair reply is the review. Choosing never commits an assignment.
  const reviewCurrent = !!pair && selectionCheck?.key === selected && !selectionCheck.pending && action.canSubmit;
  const confirmSelection = (message = 'Assign it') => {
    if (!action.canSubmit || !reviewCurrent || submitting.current) return;
    submitting.current = true;
    setReservationMessages(requestId, previous => [...previous.slice(-29), {role:'user',content:typeof message === 'string' ? message : 'Assign it',at:Date.now()}]);
    assignment.mutate({vehicle_id:pair.vehicle_id,driver_id:pair.driver_id,force:manual,reason:reason.trim(),label:pairLabel(pair),planToken:effectivePlanToken});
  };
  const handleCommand = message => {
    const intent = parseCopilotIntent(message);
    if (!intent) return null;
    if (assignment.isPending || failure?.checking) return 'An assignment is still being checked. Wait for its result.';
    if (intent.type === 'change') { chooseAnother(); return 'Choose a current option below.'; }
    if (intent.type === 'choose') {
      const option = options[intent.index];
      if (!option || option.unavailable || dispatchDecision(option.pair).state === 'BLOCKED') return 'That option is not available in the current evidence.';
      chooseOption(option,message); return {handled:true};
    }
    if (!pair) return 'Choose an option first so the assignment identifies a specific driver and vehicle.';
    if (!action.canSubmit) return action.message;
    if (!reviewCurrent) return 'I am still double-checking this option. Wait for the confirmation reply before assigning.';
    confirmSelection(message); return {handled:true};
  };

  if (!requestId) {
    return (
      <section
        id="dispatch-copilot"
        tabIndex={-1}
        aria-label="Dispatch copilot"
        className={cn(
          "flex flex-col h-full items-center justify-center p-6 text-center text-foreground-secondary space-y-3.5",
          className
        )}
      >
        <div className="relative w-20 h-20 rounded-3xl p-1 bg-gradient-to-b from-emerald-500/20 to-emerald-600/5 border border-emerald-500/25 shadow-sm flex items-center justify-center">
          <img
            src="/images/copilot-avatar.png"
            alt="Dispatch Copilot Mascot"
            className="w-full h-full object-contain drop-shadow-md select-none pointer-events-none"
          />
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-600 border-2 border-surface" />
          </span>
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-foreground">Dispatch Copilot Ready</h3>
          <p className="text-xs max-w-xs text-foreground-muted leading-relaxed">
            Select a reservation row from the queue to inspect AI pair analysis, feasibility evidence, and confirm assignment.
          </p>
        </div>
      </section>
    );
  }

  // The confirmation action lives inside the conversation as Copilot's reply,
  // so the flow and its gating are composed as slots of the option message.
  const busy = assignment.isPending || !!failure?.checking;
  const recovery =
    action.recovery === "request" ? (
      <Link className="text-xs text-primary underline" href={`/reservations/${requestId}`}>Open current request</Link>
    ) : (action.recovery === "recheck" || action.recovery === "analyze") ? (
      <Button size="xs" variant="outline" className="rounded-lg text-[11px]" onClick={recheck} disabled={query.isFetching || busy}>Recheck reservation</Button>
    ) : null;
  const reasonSlot =
    canAssign && manual && decision.canReview ? (
      <div>
        <label htmlFor="dispatch-manual-reason" className="block text-xs font-bold text-foreground mb-1">
          Reason <span className="text-danger">*</span>
        </label>
        <textarea
          id="dispatch-manual-reason"
          disabled={busy}
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full text-xs rounded-xl border border-border bg-surface p-2.5 placeholder:text-foreground-muted focus:outline-none focus:border-primary"
          placeholder="e.g. Driver confirmed availability by phone"
        />
      </div>
    ) : null;
  const actionSlot = pair ? (
    <CopilotBubble>
      <div id="copilot-option-result" tabIndex={-1} className="space-y-3">
        <p className="text-xs text-foreground-secondary">Option {options.findIndex(o=>pairKey(o.pair)===selected)+1} selected</p>
        <p className="font-semibold">{pairLabel(pair)}</p>
        {selectionCheck?.pending ? <p role="status">I am double-checking this option against the current schedule and queue.</p> : <>
          {pair.decisionEvidence?.explanation && <p>{pair.decisionEvidence.explanation}</p>}
          <PairTemporalFacts pair={pair} now={now}/>
          <ul className="space-y-1 text-xs text-foreground-secondary">{(pair.checks ?? []).map(c => <li key={c.id}>{c.label}: {c.status === 'verified' ? c.message || 'Verified' : c.message || 'Needs verification'}</li>)}</ul>
          {reasonSlot}
          <p id="dispatch-confirmation-status" role="status" className="text-xs text-foreground-secondary">{reviewCurrent ? 'I have rechecked this pairing. Shall I assign it? Type "Assign it" or use the button below.' : action.message}</p>
          {recovery}
          <Button className="w-full" disabled={!reviewCurrent || busy} onClick={confirmSelection}>
            {assignment.isPending ? 'Assigning...' : 'Assign ' + pairLabel(pair)}
          </Button>
        </>}
        <Button variant="ghost" size="sm" disabled={busy || selectionCheck?.pending} onClick={chooseAnother}>Change selection</Button>
      </div>
    </CopilotBubble>
  ) : null;
  // Pre-choice gating (permission, queue analysis, failures) is spoken by
  // Copilot as a status message instead of a disabled footer button.
  const preChoiceStatus =
    !pair && !action.canSubmit && action.recovery !== "analyze" && action.message !== "No current pair is selected. Review exclusions or recheck this reservation."
      ? action
      : null;
  const flowNode = (
    <div className="space-y-3">
      <CopilotOptionFlow
        options={options}
        exclusionReason={(rec?.pair?.none_reasons ?? [])[0] ?? (rec?.pair?.recommended && dispatchDecision(rec.pair.recommended,{now}).state === 'BLOCKED' ? {reason:`Blocked: ${dispatchDecision(rec.pair.recommended,{now}).reasons.join(' ')}`} : null)}
        busy={busy || !!selectionCheck?.pending || !!selected}
        onChoose={chooseOption}
        now={now}
      />
      {!!plan?.changedProposals?.length && <p className="text-xs text-warning">Queue proposals changed for requests {plan.changedProposals.join(', ')}. Review the updated arrangement before confirmation.</p>}
      {preChoiceStatus && (
        <CopilotBubble>
          <div className="space-y-1.5">
            <p id="dispatch-confirmation-status" role="status" aria-live="polite" className="text-xs text-foreground-secondary">
              {preChoiceStatus.message}
            </p>
            {recovery}
          </div>
        </CopilotBubble>
      )}
    </div>
  );

  return (
    <section
      id="dispatch-copilot"
      tabIndex={-1}
      aria-label="Dispatch copilot"
      className={cn(
        "flex flex-col h-full bg-surface text-foreground overflow-hidden",
        className
      )}
    >
      {/* ── 1. Top Header: Title, Analysis State, Scope & Action ── */}
      {!hideHeader && (
        <div className="p-4 border-b border-border/80 bg-muted/20 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="relative w-8 h-8 rounded-full overflow-hidden shrink-0 border border-emerald-500/30 bg-emerald-500/10 shadow-2xs">
                <img
                  src="/images/copilot-avatar.png"
                  alt="Dispatch Copilot Avatar"
                  className="w-full h-full object-cover select-none pointer-events-none"
                />
                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-surface" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5 leading-none">
                  Dispatch Copilot
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {query.isFetching ? "Checking" : decision.stale ? "Stale" : query.isError ? "Unavailable" : "Evidence"}
                  </span>
                </h2>
                <p className="text-[11px] text-foreground-secondary mt-1">
                  {rec?.evaluatedAt
                    ? `Evidence evaluated ${formatDateTime(rec.evaluatedAt)}`
                    : "Evaluating pair options…"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                onClick={recheck}
                disabled={query.isFetching || assignment.isPending || failure?.checking}
                className="h-7 text-xs rounded-lg border-border/80"
                title="Recheck evidence for this reservation"
              >
                <RefreshCw
                  className={cn("w-3 h-3 mr-1", query.isFetching && "animate-spin")}
                />
                {query.isFetching ? "Checking…" : "Recheck reservation"}
              </Button>
            </div>
          </div>

          {queueMode && plan?.generatedAt && (
            <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-foreground-muted">
              <span>Plan date: {plan.window?.date || "Today"}{plan.window?.includesOverdue ? " + overdue" : ""}</span>
              <span>Expires {formatDateTime(plan.expiresAt)}</span>
            </div>
          )}
        </div>
      )}

      {planError && <p role="alert" className="p-3 text-sm text-danger">Queue analysis failed: {planError}. Choose or recheck an option to try again.</p>}
      <div className="min-h-0 flex-1 flex flex-col">
        <CopilotConversation
          key={requestId}
          requestId={requestId}
          selectedRequest={selectedRequest}
          planToken={queueMode ? effectivePlanToken : null}
          hasPair={options.length > 0}
          selectedPair={pair ? {vehicleId:Number(pair.vehicle_id),driverId:Number(pair.driver_id)} : null}
          selectedPairLabel={pair ? pairLabel(pair) : null}
          displayedOptions={options.map(o=>({vehicleId:Number(o.pair.vehicle_id),driverId:Number(o.pair.driver_id)}))}
          displayedEvaluatedAt={rec?.evaluatedAt ?? null}
          disabled={busy || !canRecommend || alreadyAssigned || !!committed}
          completed={alreadyAssigned || !!committed}
          onCommand={handleCommand}
          reply={<>
            {query.isLoading && <CopilotBubble><p role="status">I am checking the eligible pairs and their schedules.</p></CopilotBubble>}
            {query.isError && <CopilotBubble><p role="alert">I could not refresh the evidence. {query.error.message}</p>{recovery}</CopilotBubble>}
            {failure && <CopilotBubble><p role="alert">{failure.message}</p><ConflictBlock conflicts={failure.conflicts ?? []}/>{recovery}</CopilotBubble>}
            {assignment.isPending && <CopilotBubble><p role="status">Assigning {pairLabel(pair)}. I am revalidating availability and conflicts before saving.</p></CopilotBubble>}
            {!alreadyAssigned && !committed && !assignment.isPending && actionSlot}
            {(alreadyAssigned || committed) && <CopilotBubble>
              <p className="font-semibold text-success">Assignment completed</p>
              <p className="mt-1 text-xs">{pair ? pairLabel(pair) : 'The driver and vehicle'} assigned to this reservation.</p>
              <Link className="mt-2 inline-block text-xs text-primary underline" href={'/reservations/'+requestId}>View reservation</Link>
            </CopilotBubble>}
          </>}
        >
          {!alreadyAssigned && !committed && !query.isLoading && flowNode}
        </CopilotConversation>
      </div>
    </section>
  );
}
