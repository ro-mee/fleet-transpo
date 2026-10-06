"use client";

import { useEffect, useRef, useState } from "react";
import { manilaDate } from "@/lib/dispatch/plan-window";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConflictBlock } from "@/components/reservations/conflict-block";
import { CopilotConversation, setReservationMessages, getReservationSelection, setReservationSelection, clearReservationSelection } from "./copilot-conversation";
import { CopilotBubble, CopilotOptionFlow, SelectedPairSummary } from "@/components/reservations/copilot-option-flow";
import { CopilotAvatar } from "@/components/reservations/copilot-avatar";
import { HistoricRecommendationSummary } from "@/components/reservations/historic-recommendation-summary";
import { CopilotStateMessage } from "@/components/reservations/copilot-state-message";
import { deriveOptions, optionKey as pairKey, resolveRememberedOption } from "@/components/reservations/copilot-options";
import {
  canRestoreRememberedSelection,
  canStartSelectionCheck,
  historicRecommendationPairs,
  isCompletedRecommendation,
  recommendationStatusLabel,
  recheckSelectedRecommendation,
} from "./recommendation-panel-state";
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
  const selectedStatus = selectedRequest?.fleet_status;
  const status = ['In Progress', 'Completed', 'Cancelled'].includes(selectedStatus)
    ? selectedStatus
    : (committedPair || alreadyAssigned || selectedStatus === 'Assigned')
      ? 'Assigned'
      : selectedStatus || 'Completed';
  const isCompleted = status === "Completed";
  const isCancelled = status === "Cancelled";
  const isInProgress = status === "In Progress";

  const requestDriverName = selectedRequest?.drivers
    ? [selectedRequest.drivers.first_name, selectedRequest.drivers.last_name]
        .filter(Boolean)
        .join(" ") ||
      selectedRequest.drivers.driver_name ||
      `Driver #${selectedRequest.drivers.driver_id}`
    : null;
  const driverName = committedPair?.driver?.driver_name || requestDriverName;

  const vehiclePlate =
    committedPair?.vehicle?.plate_number ||
    selectedRequest?.vehicles?.plate_number ||
    null;
  const vehicleModel =
    committedPair?.vehicle?.vehicle_name ||
    selectedRequest?.vehicles?.model ||
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
                  "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.7)] motion-safe:animate-pulse",
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

        {/* ── Trip details card: single DESIGN.md card-radius layer ── */}
        {(pickupLoc ||
          dropoffLoc ||
          guestName ||
          vehiclePlate ||
          driverName ||
          categoryName) && (
          <div className="rounded-card border border-border/80 bg-surface p-3 space-y-3 shadow-2xs">
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
  // User-initiated recheck only. Keying the header chip / Recheck button on
  // `query.isFetching` made every 30s background poll look like a reload —
  // the same defect class as the Assign gate (AI Advisory 2026-09-19), which
  // was fixed then and this closes now.
  const [rechecking, setRechecking] = useState(false);
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
    setRechecking(false);
  }
  useEffect(() => () => { selectionGeneration.current++; }, [requestId]);

  const freshStatus = selectedRequest?.fleet_status;
  const freshCommittedRequestArrived = !!committed &&
    Number(selectedRequest?.request_id) === Number(requestId) &&
    ['Assigned', 'In Progress', 'Completed', 'Cancelled'].includes(freshStatus);
  const displayedRequest = committed && !freshCommittedRequestArrived
    ? { ...(selectedRequest ?? {}), ...committed, request_id: requestId, fleet_status: committed.fleet_status ?? 'Assigned' }
    : selectedRequest;
  const requestStatus = displayedRequest?.fleet_status;
  const isTerminal = ['Completed', 'Cancelled'].includes(requestStatus);
  const isAssignedOrActive = ['Assigned', 'In Progress'].includes(requestStatus) || alreadyAssigned;
  const assignmentClosed = isTerminal || isAssignedOrActive || !!committed;
  const conversationClosed = isTerminal;
  const readOnlyCommitted = !isTerminal && (isAssignedOrActive || !!committed);

  // Request-level recommendation query.
  //
  // Freshness follows the app-wide policy (providers.jsx): staleTime 30s,
  // refetchOnWindowFocus false, refetchOnMount default (refetch only when stale).
  // It used to set staleTime:0 with refetchOnMount/refetchOnWindowFocus "always",
  // which made every remount and every focus change a real re-evaluation — an
  // expensive server-side rerun, not a cache read. The 30s poll and the
  // horizon-boundary refresh below are the intended re-check cadence.
  const query = useQuery({
    queryKey: ["reservation-recommendation", requestId, "decision"],
    queryFn: () => getRecommendation(requestId),
    enabled: !!requestId && !assignmentClosed,
    staleTime: 30_000,
    refetchInterval: assignmentClosed ? false : 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  const rec = query.data;
  const completedRecommendation = isCompletedRecommendation(rec);
  const queueProposalIncomplete = queueMode && planProposal?.candidateEvaluationComplete === false;
  const currentRecommendation = completedRecommendation && !query.isError && !queueProposalIncomplete;
  const historicSummaryPairs = historicRecommendationPairs({
    queryError: query.isError,
    completedRecommendation,
    recommendation: rec,
  });
  const candidates = assignmentClosed || !currentRecommendation ? [] : (rec?.pair?.candidates ?? []);
  // Share one derivation rule across render, restore, and refreshed recheck so a
  // saved selection always resolves against the same option-construction logic.
  const deriveFor = (pinned = null, recommendation = rec) => deriveOptions({
    candidates: recommendation?.pair?.candidates ?? [],
    recommended: (plan?.selectedPair ? recommendation?.pair?.recommended : planProposal?.pair ?? recommendation?.pair?.recommended) ?? null,
    proposalPair: planProposal?.pair ?? null,
    pinnedKeys: pinned,
  });
  const options = assignmentClosed || !currentRecommendation ? [] : deriveFor(pinnedKeys);
  const pair = selected && (assignmentClosed || currentRecommendation)
    ? (pairKey(planProposal?.pair) === selected ? planProposal.pair : null) ?? candidates.find((p) => pairKey(p) === selected) ??
      options.find((o) => pairKey(o.pair) === selected)?.pair ??
      null
    : null;
  const effectivePlanToken = queueMode ? planToken : null;
  const analysisDate = pickupAt && Number.isFinite(+new Date(pickupAt)) ? manilaDate(pickupAt) : manilaDate();


  useEffect(() => {
    if (currentRecommendation || !selectionCheck) return;
    selectionGeneration.current++;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- invalidate a check as soon as its evidence is no longer current
    setSelectionCheck(null);
  }, [currentRecommendation, selectionCheck]);

  // Handle scheduled horizon re-check
  const contextBoundary = rec?.requestContext?.nextBoundaryAt ? +new Date(rec.requestContext.nextBoundaryAt) : null;

  const refetch = query.refetch;
  useEffect(() => {
    if (
      contextBoundary == null ||
      !Number.isFinite(contextBoundary) ||
      assignmentClosed
    )
      return;
    const delay = contextBoundary - Date.now();
    if (delay < 0 || delay > 30_000) return;
    const timer = setTimeout(() => { if (document.visibilityState === 'visible') refetch(); }, delay + 1);
    return () => clearTimeout(timer);
  }, [contextBoundary, rec?.evaluatedAt, assignmentClosed, refetch]);

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
    // The assignment is done; the reservation is no longer a draft awaiting a
    // choice, so the remembered selection is spent. The transcript records the
    // completion above.
    clearReservationSelection(requestId);
    setReservationMessages(requestId, previous => [...previous.slice(-29), {role:'assistant',content:`Assignment confirmed. ${pair ? pairLabel(pair) : 'The selected resources'} assigned to this reservation.`,at:Date.now()}]);
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
        assignmentSource: queueMode ? 'queue' : 'detail',
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

  // The selection check: everything that must happen before the review can open
  // for a pair. Shared by choosing and by restoring a remembered choice, because
  // the two must not drift — the sole difference is whether the transcript gets a
  // turn. A restore must not add one: the transcript already holds that turn, and
  // re-appending it would print a duplicate on every remount.
  //
  // `announce` is the transcript text, or null to stay silent. `pin` overrides
  // which option keys are held, so a restore can re-pin the list the dispatcher
  // actually saw rather than today's derivation.
  const runSelectionCheck = async (option, { announce = null, pin = undefined, recommendationRefreshed = false } = {}) => {
    if (!canStartSelectionCheck({
      currentRecommendation,
      recommendationRefreshed,
      assignmentPending: assignment.isPending,
      failureChecking: failure?.checking,
      unavailable: option.unavailable,
      blocked: dispatchDecision(option.pair).state === 'BLOCKED',
    })) return;
    const operation = ++selectionGeneration.current;
    const key = pairKey(option.pair);
    if (announce !== null) setReservationMessages(requestId, previous => [...previous.slice(-29), {role:'user',content:announce,at:Date.now(),action:'select-pair',selectedPair:{vehicleId:Number(option.pair.vehicle_id),driverId:Number(option.pair.driver_id)}}]);
    const pinned = pin === undefined ? options.map(o => pairKey(o.pair)) : (pin?.length ? pin : null);
    setSelected(key);
    setPinnedKeys(pinned);
    // A user's own choice is remembered so it survives leaving this reservation.
    // A restore does not re-remember: it is the same record coming back.
    if (announce !== null) setReservationSelection(requestId, {key, pinnedKeys: pinned ?? []});
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
      if (!recommendationRefreshed || (queueMode && onReanalyze)) {
        const fresh = await query.refetch();
        if (fresh?.isError) throw fresh.error;
      }
      if (operation === selectionGeneration.current) setSelectionCheck({key,pending:false});
    } catch(error) {
      if (operation !== selectionGeneration.current) return;
      setSelectionCheck(null);
      setFailure({message:error.message || 'This option could not be rechecked.',previous:pairLabel(option.pair)});
    }
  };

  const chooseOption = async (option, message = null, checkOptions = {}) =>
    runSelectionCheck(option, { announce: message || `Option ${option.index+1}`, ...checkOptions });

  const retryQueueAnalysis = async () => {
    if (!onReanalyze) return;
    try {
      await onReanalyze(analysisDate);
    } catch {
      // useDispatchPlan publishes the failure through planError.
    }
  };

  const recheck = async () => {
    setRechecking(true);
    setFailure(null);
    setReason("");
    const selectionKey = selected;
    let operation = null;
    try {
      await recheckSelectedRecommendation({
        query,
        selectionKey,
        invalidateSelectionCheck: () => {
          operation = ++selectionGeneration.current;
          setSelectionCheck(null);
        },
        isCurrent: () => operation === selectionGeneration.current,
        resolveCurrentOption: (recommendation, currentSelectionKey) => {
          if (assignmentClosed || queueProposalIncomplete) return null;
          const refreshedOptions = deriveFor(pinnedKeys, recommendation);
          const currentOption = refreshedOptions.find(o => pairKey(o.pair) === currentSelectionKey);
          if (!currentOption || currentOption.unavailable || dispatchDecision(currentOption.pair).state === 'BLOCKED') return null;
          return { option: currentOption, pinnedKeys: refreshedOptions.map(o => pairKey(o.pair)) };
        },
        chooseOption,
      });
    } finally {
      setRechecking(false);
    }
  };

  const chooseAnother = () => {
    selectionGeneration.current++;
    // "Change" must forget the choice, not just hide it: the panel is remounted
    // on every return to this reservation, so a remembered selection would come
    // back as though it had never been abandoned.
    clearReservationSelection(requestId);
    setSelected(null);
    setPinnedKeys(null);
    setFailure(null);
    setReason("");
    setSelectionCheck(null);
  };
  const resetDecision = () => {
    if (assignment.isPending || failure?.checking) return;
    chooseAnother();
  };
  const resetDisabled = assignment.isPending || !!failure?.checking;

  const hasSavedSelection = !!selected || !!getReservationSelection(requestId);

  // Restore a remembered choice. DispatchPlanPanel remounts this panel per
  // request (`key={selectedRequest?.request_id}`), so `selected` starts null and
  // the dispatcher would come back to unselected cards while the transcript
  // above them still shows the option they picked.
  //
  // The check is re-run rather than trusted: the review must never open on a
  // revalidation that happened in an earlier session.
  //
  // Guarded to at most one run per request. The check invalidates the
  // recommendation query, which recomputes `options`, so an unguarded effect
  // would re-fire on its own invalidation — one queue analysis per loop.
  const restoredFor = useRef(null);
  useEffect(() => {
    if (!canRestoreRememberedSelection({
      requestId,
      assignmentClosed,
      queryError: query.isError,
      completedRecommendation,
      optionCount: options.length,
    })) return;
    if (restoredFor.current === requestId) return;
    const remembered = getReservationSelection(requestId);
    restoredFor.current = requestId;
    if (!remembered) return;
    // Re-pin the list the dispatcher actually saw, so the restored card keeps its
    // number and a pair that is no longer a candidate still resolves — as an
    // unavailable card, which the check then refuses.
    const restored = resolveRememberedOption(remembered, deriveFor);
    if (!restored) return;
    // Reading the remembered choice back out of sessionStorage is the
    // external-system case this rule carves out, and the check has to start here
    // rather than in an event handler — there is no click to hang it on.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing React state from the persisted selection store on mount
    runSelectionCheck(restored, { announce: null, pin: remembered.pinnedKeys });
    // deriveFor/runSelectionCheck are rebuilt each render, so listing them would
    // fire this on every render; the ref above, not this list, is what holds the
    // restore to one run per request.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once-per-request guard is a ref
  }, [requestId, assignmentClosed, options.length, query.isError, completedRecommendation]);

  useEffect(()=>{onBusyChange?.(assignment.isPending || !!failure?.checking || !!selectionCheck?.pending || rechecking);},[assignment.isPending,failure?.checking,selectionCheck?.pending,rechecking,onBusyChange]);

  const action = dispatchConfirmation({
    canAssign, pair, decision, awaitingResult: query.isLoading, error: query.isError,
    pending: assignment.isPending, failure, reason, now,
    queue: queueMode
      ? { plan, proposal: planProposal, token: planToken, validation: planValidation,
          invalidReason: planInvalidReason || planError, analyzing: isAnalyzing }
      : null,
  });

  if (action.recovery === "analyze") action.message = "This option needs a fresh queue check. Recheck the reservation before assigning.";
  const manual = !!pair && !decision.canConfirm;
  const canRecommend = can("reservations", "recommend");
  // The checked-pair decision dock is the review. Choosing never commits an assignment.
  const reviewCurrent = currentRecommendation && !!pair && selectionCheck?.key === selected && !selectionCheck.pending && action.canSubmit;
  const confirmSelection = (message = 'Assign it') => {
    if (!action.canSubmit || !reviewCurrent || submitting.current) return;
    submitting.current = true;
    setReservationMessages(requestId, previous => [...previous.slice(-29), {role:'user',content:typeof message === 'string' ? message : 'Assign it',at:Date.now()}]);
    assignment.mutate({vehicle_id:pair.vehicle_id,driver_id:pair.driver_id,force:manual,reason:reason.trim(),label:pairLabel(pair),planToken:effectivePlanToken});
  };
  const handleCommand = message => {
    const intent = parseCopilotIntent(message);
    if (!intent) return null;
    if (readOnlyCommitted) {
      return ['choose', 'assign', 'change'].includes(intent.type)
        ? 'This trip is already committed. Use the authorized dispatch detail flow for any change.'
        : null;
    }
    if (assignment.isPending || failure?.checking) return 'An assignment is still being checked. Wait for its result.';
    if (intent.type === 'change') {
      chooseAnother();
      return queueProposalIncomplete
        ? 'Selection cleared. Reanalyze the queue before choosing another option.'
        : currentRecommendation
          ? 'Selection cleared. Choose a current option below.'
          : 'Selection cleared. Recheck before choosing another option.';
    }
    if (query.isError) return 'Current recommendation evidence is unavailable. Recheck before choosing an option.';
    if (queueProposalIncomplete) return 'The queue analysis is incomplete. Reanalyze before choosing an option.';
    if (!currentRecommendation) return 'The recommendation evaluation is incomplete. Recheck before choosing an option.';
    if (intent.type === 'choose') {
      const option = options[intent.index];
      if (!option || option.unavailable || dispatchDecision(option.pair).state === 'BLOCKED') return 'That option is not available in the current evidence.';
      chooseOption(option,message); return {handled:true};
    }
    if (!pair) return 'Choose an option first so the assignment identifies a specific driver and vehicle.';
    if (!action.canSubmit) return action.message;
    if (!reviewCurrent) return 'Rechecking current assignment evidence. Wait for the confirmation reply before assigning.';
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
            alt="" aria-hidden="true"
            className="w-full h-full object-contain drop-shadow-md select-none pointer-events-none"
          />
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 rounded-full bg-emerald-600 border-2 border-surface" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-foreground">Dispatch Copilot Ready</h3>
          <p className="text-xs max-w-xs text-foreground-muted leading-relaxed">
            Select a reservation row from the queue to review assignment options and supporting evidence, then confirm assignment.
          </p>
        </div>
      </section>
    );
  }

  // The current selection review and confirmation stay in one guarded decision dock,
  // and selecting an option never commits an assignment.
  const busy = assignment.isPending || !!failure?.checking;
  // First load or an explicit Recheck press — never a background poll.
  const recheckBusy = rechecking || (!query.isError && query.isLoading);
  const recovery =
    action.recovery === "request" ? (
      <Link className="text-xs text-primary underline" href={`/reservations/${requestId}`}>Open current request</Link>
    ) : (action.recovery === "recheck" || action.recovery === "analyze") ? (
      <Button size="xs" variant="outline" className="rounded-lg text-[11px]" onClick={recheck} disabled={recheckBusy || busy}>Recheck reservation</Button>
    ) : null;
  const selectionChangeButton = hasSavedSelection ? (
    <Button size="sm" variant="outline" disabled={busy} onClick={chooseAnother}>
      Change selection
    </Button>
  ) : null;
  const reasonSlot =
    canAssign && manual && decision.canReview ? (
      <div>
        <label htmlFor="dispatch-manual-reason" className="block text-xs font-bold text-foreground mb-1">
          Reason <span className="text-danger-700">*</span>
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
        {!selectionCheck?.pending && !decision.canConfirm && decision.reasons.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-foreground">{decision.label}</p>
            <ul aria-label={`${decision.label} reasons`} className="list-disc space-y-0.5 pl-4 text-xs text-foreground-secondary">
              {decision.reasons.map((reason,index)=><li key={`${index}-${reason}`}>{reason}</li>)}
            </ul>
          </div>
        )}
        {!selectionCheck?.pending && <>
          {reasonSlot}
          <p id="dispatch-confirmation-status" role="status" className="text-xs text-foreground-secondary">{reviewCurrent ? 'This option passed a fresh check. Dispatcher confirmation is required. Confirm assignment? Type "Assign it" or use Confirm assignment below.' : action.message}</p>
          {recovery}
          <Button className="w-full" disabled={!reviewCurrent || busy} onClick={confirmSelection}>
            {assignment.isPending ? 'Confirming assignment...' : 'Confirm assignment — ' + pairLabel(pair)}
          </Button>
        </>}
        <Button variant="ghost" size="sm" disabled={busy || query.isError || selectionCheck?.pending} onClick={chooseAnother}>Change selection</Button>
      </div>
    </CopilotBubble>
  ) : null;
  // Pre-choice gating (permission, queue analysis, failures) is spoken by
  // Copilot as a status message instead of a disabled footer button.
  const preChoiceStatus =
    !query.isError && !pair && !action.canSubmit && action.recovery !== "analyze" && action.message !== "No current pair is selected. Review exclusions or recheck this reservation."
      ? action
      : null;
  const flowNode = (
    <div className="space-y-3">
      <CopilotOptionFlow
        options={options}
        exclusionReason={(rec?.pair?.none_reasons ?? [])[0] ?? (rec?.pair?.recommended && dispatchDecision(rec.pair.recommended,{now}).state === 'BLOCKED' ? {reason:`Blocked: ${dispatchDecision(rec.pair.recommended,{now}).reasons.join(' ')}`} : null)}
        busy={busy || query.isError || !!selectionCheck?.pending || !!selected}
        onChoose={chooseOption}
        now={now}
      />
      {!!plan?.changedProposals?.length && <p className="text-xs text-warning-700">Queue proposals changed for requests {plan.changedProposals.join(', ')}. Review the updated arrangement before confirmation.</p>}
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
  const committedVehicleId = Number(displayedRequest?.vehicle_id);
  const committedDriverId = Number(displayedRequest?.driver_id);
  const pairMatchesCommittedRequest = pair &&
    Number(pair.vehicle_id) === committedVehicleId && Number(pair.driver_id) === committedDriverId;
  const committedCandidate = (rec?.pair?.candidates ?? []).find(candidate =>
    Number(candidate?.vehicle_id) === committedVehicleId && Number(candidate?.driver_id) === committedDriverId);
  const committedPairDetails = pairMatchesCommittedRequest ? pair : committedCandidate;
  const committedPairForDisplay = Number.isSafeInteger(committedVehicleId) && committedVehicleId > 0 &&
    Number.isSafeInteger(committedDriverId) && committedDriverId > 0
    ? {
        vehicle_id: committedVehicleId,
        driver_id: committedDriverId,
        vehicle: freshCommittedRequestArrived
          ? displayedRequest?.vehicles ?? committedPairDetails?.vehicle ?? null
          : committedPairDetails?.vehicle ?? displayedRequest?.vehicles ?? null,
        driver: freshCommittedRequestArrived
          ? displayedRequest?.drivers ?? committedPairDetails?.driver ?? null
          : committedPairDetails?.driver ?? displayedRequest?.drivers ?? null,
      }
    : null;

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
              <div className="relative">
                <CopilotAvatar size="md" decorative={false} label="Dispatch Copilot Avatar" />
                <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-1 ring-surface" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5 leading-none">
                  Dispatch Copilot
                  <span className="text-xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {/* Explicit retries show activity; otherwise an error outranks stale evidence.
                        Background polling remains non-disruptive. */}
                    {readOnlyCommitted ? 'Read-only trip' : recommendationStatusLabel({queryError:query.isError,stale:decision.stale,checking:recheckBusy || (queueProposalIncomplete && isAnalyzing),incomplete:!completedRecommendation || queueProposalIncomplete})}
                  </span>
                </h2>
                <p className="text-[11px] text-foreground-secondary mt-1">
                  {readOnlyCommitted
                    ? 'This trip is committed; no new options or eligibility checks are generated here.'
                    : query.isError
                      ? rec?.evaluatedAt
                        ? `Historic findings · last evaluated ${formatDateTime(rec.evaluatedAt)}`
                        : "Current recommendation unavailable."
                      : queueProposalIncomplete
                        ? isAnalyzing ? "Reanalyzing queue; choices remain unavailable." : "Queue candidate evaluation did not complete."
                        : completedRecommendation
                          ? `Evidence evaluated ${formatDateTime(rec.evaluatedAt)}`
                          : query.isLoading
                          ? "Evaluating pair options…"
                          : "Recommendation evaluation not completed."}
                </p>
              </div>
            </div>

            {!assignmentClosed && <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                onClick={recheck}
                disabled={recheckBusy || assignment.isPending || failure?.checking}
                className="h-7 text-xs rounded-lg border-border/80"
                title="Recheck evidence for this reservation"
              >
                <RefreshCw
                  className={cn("w-3 h-3 mr-1", recheckBusy && "motion-safe:animate-spin")}
                />
                {recheckBusy ? "Checking…" : "Recheck reservation"}
              </Button>
            </div>}
          </div>

          {queueMode && !assignmentClosed && plan?.generatedAt && (
            <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-foreground-muted">
              <span>Plan date: {plan.window?.date || "Today"}{plan.window?.includesOverdue ? " + overdue" : ""}</span>
              <span>Expires {formatDateTime(plan.expiresAt)}</span>
            </div>
          )}
        </div>
      )}

      {planError && !assignmentClosed && (
        <CopilotStateMessage
          title="Queue analysis failed"
          description={`${planError?.message ?? planError}. Any previous queue findings are historical until analysis succeeds. Retry before confirming a queue proposal.`}
        >
          {onReanalyze && (
            <Button size="sm" variant="outline" onClick={retryQueueAnalysis} disabled={isAnalyzing}>
              Retry queue analysis
            </Button>
          )}
          {!query.isError && selectionChangeButton}
        </CopilotStateMessage>
      )}
      <div className="min-h-0 flex-1 flex flex-col">
        <CopilotConversation
          key={requestId}
          requestId={requestId}
          selectedRequest={displayedRequest}
          planToken={!readOnlyCommitted && queueMode && currentRecommendation ? effectivePlanToken : null}
          hasPair={!readOnlyCommitted && currentRecommendation && !assignmentClosed && options.length > 0}
          selectedPair={!readOnlyCommitted && currentRecommendation && pair ? {vehicleId:Number(pair.vehicle_id),driverId:Number(pair.driver_id)} : null}
          selectedPairLabel={!readOnlyCommitted && currentRecommendation && pair ? pairLabel(pair) : null}
          displayedOptions={!readOnlyCommitted && currentRecommendation ? options.map(o=>({vehicleId:Number(o.pair.vehicle_id),driverId:Number(o.pair.driver_id)})) : []}
          displayedEvaluatedAt={!readOnlyCommitted && currentRecommendation ? rec?.evaluatedAt ?? null : null}
          disabled={busy || !canRecommend || (!readOnlyCommitted && (query.isError || !currentRecommendation || assignmentClosed))}
          completed={conversationClosed}
          readOnlyCommitted={readOnlyCommitted}
          onCommand={handleCommand}
           onResetDecision={resetDecision}
           resetDisabled={resetDisabled}
          planStatus={{ isInvalid: !!planInvalidReason, invalidReason: planInvalidReason ?? null }}
          decisionDock={!readOnlyCommitted && !assignmentClosed && currentRecommendation && !assignment.isPending ? actionSlot : null}
          reply={<>
            {!assignmentClosed && query.isError && (
              <CopilotStateMessage
                title="Recommendation evidence unavailable"
                description={completedRecommendation
                  ? `The prior evaluation is not current. ${historicSummaryPairs.length ? "Historic details are shown below for reference only. " : ""}Retry before selecting or assigning. ${query.error?.message ?? "The refresh failed."}`
                  : `Current eligibility is unknown because the recommendation request failed${query.error?.message ? `: ${query.error.message}` : ""}. Recheck before taking action.`}
              >
                <Button size="sm" variant="outline" onClick={recheck} disabled={recheckBusy || busy}>
                  Retry evidence
                </Button>
                {selectionChangeButton}
              </CopilotStateMessage>
            )}
            {!assignmentClosed && queueProposalIncomplete && !planError && (
              <CopilotStateMessage
                role="status"
                tone="warning"
                title="Queue analysis incomplete"
                description={isAnalyzing
                  ? "Queue reanalysis is in progress. Options remain unavailable until candidate evaluation completes."
                  : "This queue proposal is partial. Reanalyze the service date before selecting or confirming a resource pair."}
              >
                {onReanalyze && (
                  <Button size="sm" variant="outline" onClick={retryQueueAnalysis} disabled={isAnalyzing || busy}>
                    {isAnalyzing ? "Reanalyzing queue…" : "Retry queue analysis"}
                  </Button>
                )}
                {selectionChangeButton}
              </CopilotStateMessage>
            )}
            {!assignmentClosed && query.isError && completedRecommendation && <HistoricRecommendationSummary pairs={historicSummaryPairs} />}
            {!assignmentClosed && !query.isError && query.isLoading && <CopilotBubble><p role="status">Checking the eligible options and their schedules.</p></CopilotBubble>}
            {!assignmentClosed && !query.isError && !query.isLoading && !completedRecommendation && (
              <CopilotStateMessage
                role="status"
                tone="warning"
                title="Eligibility unknown"
                description="The recommendation response does not contain a completed evaluation. No fleet-wide exclusion can be inferred; recheck this reservation."
              >
                <Button size="sm" variant="outline" onClick={recheck} disabled={recheckBusy || busy}>
                  Recheck reservation
                </Button>
                {selectionChangeButton}
              </CopilotStateMessage>
            )}
            {!assignmentClosed && failure && <CopilotBubble><p role="alert">{failure.message}</p><ConflictBlock conflicts={failure.conflicts ?? []}/>{recovery}</CopilotBubble>}
            {!assignmentClosed && assignment.isPending && <CopilotBubble><p role="status">Confirming assignment for {pairLabel(pair)}. Revalidating availability and conflicts before saving.</p></CopilotBubble>}
            {assignmentClosed && (
              <CopilotTripDetailsBubble
                requestId={requestId}
                selectedRequest={displayedRequest}
                committedPair={committedPairForDisplay}
                alreadyAssigned={alreadyAssigned || readOnlyCommitted}
              />
            )}
          </>}
        >
          {!readOnlyCommitted && !assignmentClosed && currentRecommendation && flowNode}
        </CopilotConversation>
      </div>
    </section>
  );
}
