"use client";

import { useEffect, useRef, useState } from "react";
import { manilaDate } from "@/lib/dispatch/plan-window";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConflictBlock } from "@/components/reservations/conflict-block";
import { CopilotConversation, setReservationMessages } from "./copilot-conversation";
import { CopilotBubble, CopilotOptionFlow, SelectedPairSummary } from "@/components/reservations/copilot-option-flow";
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
  AlertCircle,
  ArrowUpRight,
  Calendar,
  CarFront,
  Check,
  CheckCircle2,
  Clock,
  RefreshCw,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";

const pairLabel = (p) =>
  p
    ? `${p.vehicle?.plate_number || "Vehicle #" + p.vehicle_id} + ${
        p.driver?.driver_name || "Driver #" + p.driver_id
      }`
    : "No current selection";

export function CopilotTripDetailsBubble({
  requestId,
  selectedRequest,
  committedPair,
  alreadyAssigned,
}) {
  const status =
    selectedRequest?.fleet_status ||
    (committedPair ? "Assigned" : alreadyAssigned ? "Assigned" : "Completed");
  const isCompleted = status === "Completed";
  const isCancelled = status === "Cancelled";
  const isInProgress = status === "In Progress";

  const driverName = selectedRequest?.drivers
    ? [selectedRequest.drivers.first_name, selectedRequest.drivers.last_name]
        .filter(Boolean)
        .join(" ") ||
      selectedRequest.drivers.driver_name ||
      `Driver #${selectedRequest.drivers.driver_id}`
    : committedPair?.driver?.driver_name || null;

  const vehiclePlate =
    selectedRequest?.vehicles?.plate_number ||
    committedPair?.vehicle?.plate_number ||
    null;
  const vehicleModel =
    selectedRequest?.vehicles?.model ||
    committedPair?.vehicle?.vehicle_name ||
    null;

  const pickupLoc = selectedRequest?.pickup_location;
  const dropoffLoc = selectedRequest?.dropoff_location;
  const pickupRaw = selectedRequest?.pickup_datetime;
  const formattedPickup =
    pickupRaw && Number.isFinite(+new Date(pickupRaw))
      ? new Intl.DateTimeFormat("en-PH", {
          timeZone: "Asia/Manila",
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(pickupRaw))
      : null;

  const guestName = selectedRequest?.guest_name;
  const passengerCount = selectedRequest?.passenger_count;
  const categoryName =
    selectedRequest?.vehiclecategories?.category_name ||
    selectedRequest?.service_types?.service_name ||
    selectedRequest?.requested_vehicle_type;

  return (
    <CopilotBubble>
      <div className="space-y-3">
        {/* ── Top Header Row with Status & Live Dot ── */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 shadow-2xs",
                isCompleted &&
                  "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 ring-emerald-500/25",
                isCancelled &&
                  "bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400 ring-rose-500/25",
                isInProgress &&
                  "bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 ring-blue-500/25",
                !isCompleted &&
                  !isCancelled &&
                  !isInProgress &&
                  "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 ring-indigo-500/25"
              )}
            >
              {isCompleted && <CheckCircle2 className="size-4" />}
              {isCancelled && <XCircle className="size-4" />}
              {isInProgress && <Clock className="size-4" />}
              {!isCompleted && !isCancelled && !isInProgress && (
                <Check className="size-4" />
              )}
            </span>
            <div className="min-w-0">
              <h4 className="text-sm font-bold tracking-tight text-foreground leading-none">
                {isCompleted && "Trip Completed"}
                {isCancelled && "Reservation Cancelled"}
                {isInProgress && "Trip In Progress"}
                {!isCompleted &&
                  !isCancelled &&
                  !isInProgress &&
                  "Assignment Completed"}
              </h4>
              <p className="mt-1 text-[11px] text-foreground-muted truncate leading-none">
                {selectedRequest?.reservation_number
                  ? `Ref: ${selectedRequest.reservation_number}`
                  : `Request #${requestId}`}
              </p>
            </div>
          </div>

          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 shrink-0",
              isCompleted &&
                "bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 ring-emerald-500/20",
              isCancelled &&
                "bg-rose-100/80 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 ring-rose-500/20",
              isInProgress &&
                "bg-blue-100/80 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 ring-blue-500/20",
              !isCompleted &&
                !isCancelled &&
                !isInProgress &&
                "bg-indigo-100/80 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300 ring-indigo-500/20"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isCompleted &&
                  "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]",
                isCancelled &&
                  "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]",
                isInProgress &&
                  "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.7)] animate-pulse",
                !isCompleted &&
                  !isCancelled &&
                  !isInProgress &&
                  "bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.7)]"
              )}
            />
            {status}
          </span>
        </div>

        {/* ── Conversational Intro ── */}
        <p className="text-xs text-foreground-secondary leading-relaxed">
          {isCompleted &&
            "This trip has already been completed. Here are the trip details:"}
          {isCancelled &&
            "This reservation was cancelled and is no longer open for assignment. Here are the details:"}
          {isInProgress &&
            "This trip is currently active and en route. Here are the trip details:"}
          {!isCompleted &&
            !isCancelled &&
            !isInProgress &&
            (committedPair
              ? `${pairLabel(committedPair)} assigned to this reservation.`
              : "The driver and vehicle have been assigned to this reservation.")}
        </p>

        {/* ── Cancellation Reason Alert (if cancelled) ── */}
        {isCancelled && selectedRequest?.status_reason && (
          <div className="rounded-xl border border-rose-200/80 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20 p-2.5 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200 shadow-2xs">
            <AlertCircle className="size-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold block text-xs uppercase tracking-wider text-rose-700 dark:text-rose-300">
                Cancellation Reason
              </span>
              <span className="mt-0.5 block leading-normal">
                {selectedRequest.status_reason}
              </span>
            </div>
          </div>
        )}

        {/* ── Double-Bezel Hardware Card for Trip Details ── */}
        {(pickupLoc ||
          dropoffLoc ||
          guestName ||
          vehiclePlate ||
          driverName ||
          categoryName) && (
          <div className="rounded-2xl border border-border/80 bg-muted/40 dark:bg-muted/10 p-1.5 shadow-xs">
            <div className="rounded-xl border border-border/60 bg-surface/95 dark:bg-surface/85 backdrop-blur-xs p-3 space-y-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              {/* Route Transit Stops Wayfinding */}
              {(pickupLoc || dropoffLoc) && (
                <div className="rounded-lg border border-border/50 bg-background/50 dark:bg-background/20 p-2.5 space-y-2">
                  <div className="flex items-start gap-2.5">
                    <div className="flex flex-col items-center pt-1 shrink-0">
                      <span className="size-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" />
                      <div className="my-0.5 h-6 w-0.5 border-l border-dashed border-border" />
                      <span className="size-2 rounded-full bg-rose-500 ring-4 ring-rose-500/20" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-foreground-muted block leading-none">
                          Pickup Location
                        </span>
                        <span className="mt-0.5 font-medium text-foreground break-words block leading-snug">
                          {pickupLoc || "Pickup location"}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-foreground-muted block leading-none">
                          Dropoff Destination
                        </span>
                        <span className="mt-0.5 font-medium text-foreground break-words block leading-snug">
                          {dropoffLoc || "Dropoff location"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {formattedPickup && (
                    <div className="flex items-center gap-1.5 border-t border-border/50 pt-2 text-[11px] text-foreground-secondary">
                      <Calendar className="size-3 text-foreground-muted shrink-0" />
                      <span className="font-medium text-foreground-muted">
                        Pickup Schedule:
                      </span>
                      <span className="font-data font-semibold text-foreground">
                        {formattedPickup}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Bento Mini-Grid: Passenger & Assigned Resource */}
              <div
                className={cn(
                  "grid gap-2",
                  vehiclePlate || driverName ? "grid-cols-2" : "grid-cols-1"
                )}
              >
                {/* Guest Mini Card */}
                <div className="rounded-lg border border-border/50 bg-background/50 dark:bg-background/20 p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground-muted">
                    <UserRound className="size-3 text-foreground-muted" />
                    <span>Guest</span>
                  </div>
                  <p className="text-xs font-semibold text-foreground truncate">
                    {guestName || "Guest"}
                  </p>
                  {passengerCount != null && (
                    <p className="text-[11px] text-foreground-secondary flex items-center gap-1">
                      <Users className="size-3 text-foreground-muted shrink-0" />
                      <span>
                        {passengerCount} passenger
                        {passengerCount === 1 ? "" : "s"}
                      </span>
                    </p>
                  )}
                </div>

                {/* Resource Mini Card */}
                {vehiclePlate || driverName ? (
                  <div className="rounded-lg border border-border/50 bg-background/50 dark:bg-background/20 p-2.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground-muted">
                      <CarFront className="size-3 text-foreground-muted" />
                      <span>Resource</span>
                    </div>
                    {vehiclePlate && (
                      <p className="font-data text-xs font-semibold text-foreground truncate">
                        {vehiclePlate}
                        {vehicleModel ? ` · ${vehicleModel}` : ""}
                      </p>
                    )}
                    {driverName && (
                      <p className="text-[11px] text-foreground-secondary truncate">
                        {driverName}
                      </p>
                    )}
                  </div>
                ) : categoryName ? (
                  <div className="rounded-lg border border-border/50 bg-background/50 dark:bg-background/20 p-2.5 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground-muted">
                      <CarFront className="size-3 text-foreground-muted" />
                      <span>Category</span>
                    </div>
                    <p className="text-xs font-semibold text-foreground truncate">
                      {categoryName}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* ── Modern Executive Button-in-Button CTA ── */}
        {requestId && (
          <div className="pt-0.5">
            <Link
              href={`/reservations/${requestId}`}
              className="group flex w-full items-center justify-between rounded-xl border border-border/80 bg-surface hover:bg-muted/40 p-2.5 text-xs font-semibold text-foreground shadow-2xs hover:border-emerald-600/40 hover:shadow-xs transition-all duration-200"
            >
              <span className="truncate">View full reservation details</span>
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground-secondary group-hover:bg-primary group-hover:text-primary-foreground group-hover:translate-x-0.5 transition-all duration-200">
                <ArrowUpRight className="size-3.5" />
              </span>
            </Link>
          </div>
        )}
      </div>
    </CopilotBubble>
  );
}

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

  const requestStatus = selectedRequest?.fleet_status;
  const isTerminal = ['Completed', 'Cancelled'].includes(requestStatus);
  const isAssignedOrActive = ['Assigned', 'In Progress'].includes(requestStatus) || alreadyAssigned;
  const isClosed = isTerminal || isAssignedOrActive || !!committed;

  // Request-level recommendation query
  const query = useQuery({
    queryKey: ["reservation-recommendation", requestId, "decision"],
    queryFn: () => getRecommendation(requestId),
    enabled: !!requestId && !isClosed,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const rec = query.data;
  const candidates = isClosed ? [] : (rec?.pair?.candidates ?? []);
  const options = isClosed ? [] : deriveOptions({
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
      isClosed
    )
      return;
    const delay = contextBoundary - Date.now();
    if (delay < 0 || delay > 30_000) return;
    const timer = setTimeout(() => { if (document.visibilityState === 'visible') refetch(); }, delay + 1);
    return () => clearTimeout(timer);
  }, [contextBoundary, rec?.evaluatedAt, isClosed, refetch]);

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
    setReservationMessages(requestId, previous => [...previous.slice(-29), {role:'user',content:message || `Option ${option.index+1}`,at:Date.now(),action:'select-pair',selectedPair:{vehicleId:Number(option.pair.vehicle_id),driverId:Number(option.pair.driver_id)}}]);
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
            src="/images/copilot-avatar-blinking.gif"
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
        <SelectedPairSummary pair={pair} optionNumber={options.findIndex(o=>pairKey(o.pair)===selected)+1} pending={selectionCheck?.pending} now={now}/>
        {!selectionCheck?.pending && <>
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
                  src="/images/copilot-avatar-blinking.gif"
                  alt="Dispatch Copilot Avatar"
                  className="w-full h-full object-cover select-none pointer-events-none"
                />
                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-surface" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5 leading-none">
                  Dispatch Copilot
                  <span className="text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
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
          hasPair={!isClosed && options.length > 0}
          selectedPair={pair ? {vehicleId:Number(pair.vehicle_id),driverId:Number(pair.driver_id)} : null}
          selectedPairLabel={pair ? pairLabel(pair) : null}
          displayedOptions={options.map(o=>({vehicleId:Number(o.pair.vehicle_id),driverId:Number(o.pair.driver_id)}))}
          displayedEvaluatedAt={rec?.evaluatedAt ?? null}
          disabled={busy || !canRecommend || isClosed}
          completed={isClosed}
          onCommand={handleCommand}
          selectedReply={!isClosed && !assignment.isPending ? actionSlot : null}
          reply={<>
            {query.isLoading && <CopilotBubble><p role="status">I am checking the eligible pairs and their schedules.</p></CopilotBubble>}
            {query.isError && <CopilotBubble><p role="alert">I could not refresh the evidence. {query.error.message}</p>{recovery}</CopilotBubble>}
            {failure && <CopilotBubble><p role="alert">{failure.message}</p><ConflictBlock conflicts={failure.conflicts ?? []}/>{recovery}</CopilotBubble>}
            {assignment.isPending && <CopilotBubble><p role="status">Assigning {pairLabel(pair)}. I am revalidating availability and conflicts before saving.</p></CopilotBubble>}
            {isClosed && (
              <CopilotTripDetailsBubble
                requestId={requestId}
                selectedRequest={selectedRequest}
                committedPair={pair}
                alreadyAssigned={alreadyAssigned}
              />
            )}
          </>}
        >
          {!isClosed && !query.isLoading && flowNode}
        </CopilotConversation>
      </div>
    </section>
  );
}
