"use client";

import React, { useReducer, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Camera, ExternalLink, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { CargoDecisionHistory } from "./cargo-decision-history";
import { CargoFeedbackStatus } from "./cargo-feedback-status";
import { CargoQuantityTable } from "./cargo-quantity-table";
import { CargoHandoverEvidence, CargoHandoverEvidenceContent } from "./cargo-handover-evidence";
import { createCargoDecisionCommandManager } from "./cargo-decision-command";
import { useCargoHandoverAnchor } from "./use-cargo-handover-anchor";
import {
  clearCargoDeparture,
  getCargoEvidence,
  getCargoExecution,
  recordManualCargoDecision,
  resolveCargoSourceHref,
  retryCargoFeedback,
} from "@/services/cargo-execution.client";

const EMPTY_DECISION = {
  action: "ACCEPT_OBSERVED",
  reason: "",
  approver_identity: "",
  approver_reference: "",
  communicated_at: "",
  communication_evidence_ids: "",
};

export const initialCargoReviewState = {
  decisionDraft: { ...EMPTY_DECISION },
  clearanceReason: "",
  actionError: "",
  actionNotice: "",
  refreshRequired: false,
  refreshError: "",
  photoUrl: "",
  photoId: "",
  photoError: "",
};

export function cargoReviewReducer(state, action) {
  switch (action.type) {
    case "decision-draft":
      return { ...state, decisionDraft: { ...state.decisionDraft, ...action.patch } };
    case "clearance-reason":
      return { ...state, clearanceReason: action.value };
    case "action-started":
      return { ...state, actionError: "", actionNotice: "", refreshError: "" };
    case "action-rejected":
      return { ...state, actionError: action.message, refreshRequired: action.refreshRequired || state.refreshRequired };
    case "refresh-required":
      return { ...state, refreshRequired: true, refreshError: "" };
    case "refresh-failed":
      return { ...state, refreshRequired: true, refreshError: action.message };
    case "action-accepted":
      return { ...state, actionNotice: action.message, actionError: "" };
    case "fresh-view-loaded":
      return {
        ...state,
        refreshRequired: false,
        refreshError: "",
        actionNotice: action.notice || state.actionNotice,
        actionError: action.clearActionError ? "" : state.actionError,
        ...(action.clearDraft === "decision" ? { decisionDraft: { ...EMPTY_DECISION } } : {}),
        ...(action.clearDraft === "clearance" ? { clearanceReason: "" } : {}),
      };
    case "photo-loading":
      return { ...state, photoId: action.evidenceId, photoUrl: "", photoError: "" };
    case "photo-loaded":
      return { ...state, photoId: action.evidenceId, photoUrl: action.url, photoError: "" };
    case "photo-failed":
      return { ...state, photoUrl: "", photoError: action.message };
    case "photo-closed":
      return { ...state, photoId: "", photoUrl: "", photoError: "" };
    default:
      return state;
  }
}

function receiptPayload(receipt) {
  return receipt?.payload ?? receipt ?? null;
}

function timeForCommand(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function communicationEvidenceIds(value) {
  return value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
}

function sourceLabel(manifest) {
  if (manifest?.manifest_ref?.kind === "REQUEST") return "Reservation request";
  if (manifest?.manifest_ref?.kind === "SUPPLY") return "Supply shipment";
  return "Cargo source";
}

function unavailableDescription(error) {
  if (error?.status === 503 || error?.code === "CARGO_CONFIGURATION_REQUIRED") {
    return "Cargo review is unavailable because its source or approval configuration is not enabled.";
  }
  return error?.message || "The cargo record could not be loaded.";
}

function CargoReviewForm({ view, reviewerState, busy, decisionRetryPending, onDecisionDraft, onClearanceReason, onSubmitDecision, onSubmitClearance }) {
  const capabilities = view?.capabilities || {};
  const pickup = view?.pickup_receipt;
  const decisionAllowed = capabilities.manual_decision === true && pickup;
  const clearanceAllowed = capabilities.clearance === true && pickup;
  const blocked = busy || reviewerState.refreshRequired;
  const decisionFieldsBlocked = blocked || decisionRetryPending;

  if (!decisionAllowed && !clearanceAllowed) {
    return <p className="rounded-md bg-muted/20 px-3 py-2 text-xs text-foreground-secondary">This cargo record is read-only for the current server-approved capabilities.</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {decisionAllowed && (
        <form className="space-y-3 rounded-lg border border-border p-3" onSubmit={(event) => { event.preventDefault(); onSubmitDecision(); }}>
          <div>
            <h4 className="text-xs font-semibold text-foreground">Record source decision</h4>
            <p className="mt-1 text-[11px] text-foreground-secondary">Use this only after source communication has been independently verified.</p>
          </div>
          {decisionRetryPending && (
            <p role="status" className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
              The original details are locked until the result is confirmed. Retrying uses the same command ID and payload.
            </p>
          )}
          <label className="block space-y-1 text-xs font-medium text-foreground-secondary">
            Decision
            <select disabled={decisionFieldsBlocked} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground disabled:opacity-50" value={reviewerState.decisionDraft.action} onChange={(event) => onDecisionDraft({ action: event.target.value })}>
              <option value="WAIT">Wait for a new count or source review</option>
              <option value="ACCEPT_OBSERVED">Accept the observed pickup count</option>
              <option value="REJECT_PICKUP">Reject this pickup</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs font-medium text-foreground-secondary">
            Reason
            <textarea disabled={decisionFieldsBlocked} required maxLength={2000} className="min-h-20 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-50" value={reviewerState.decisionDraft.reason} onChange={(event) => onDecisionDraft({ reason: event.target.value })} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1 text-xs font-medium text-foreground-secondary">Source approver
              <input disabled={decisionFieldsBlocked} required maxLength={255} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground disabled:opacity-50" value={reviewerState.decisionDraft.approver_identity} onChange={(event) => onDecisionDraft({ approver_identity: event.target.value })} />
            </label>
            <label className="block space-y-1 text-xs font-medium text-foreground-secondary">Verified reference
              <input disabled={decisionFieldsBlocked} required maxLength={255} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground disabled:opacity-50" value={reviewerState.decisionDraft.approver_reference} onChange={(event) => onDecisionDraft({ approver_reference: event.target.value })} />
            </label>
          </div>
          <label className="block space-y-1 text-xs font-medium text-foreground-secondary">When the source was contacted
            <input disabled={decisionFieldsBlocked} required type="datetime-local" className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground disabled:opacity-50" value={reviewerState.decisionDraft.communicated_at} onChange={(event) => onDecisionDraft({ communicated_at: event.target.value })} />
          </label>
          <label className="block space-y-1 text-xs font-medium text-foreground-secondary">Communication evidence IDs
            <input disabled={decisionFieldsBlocked} required maxLength={1900} className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground disabled:opacity-50" value={reviewerState.decisionDraft.communication_evidence_ids} onChange={(event) => onDecisionDraft({ communication_evidence_ids: event.target.value })} aria-describedby="cargo-communication-evidence-help" />
          </label>
          <p id="cargo-communication-evidence-help" className="text-[11px] text-foreground-muted">Enter the private evidence record IDs separated by commas. The server checks that they belong to this source and receipt.</p>
          <button type="submit" disabled={blocked} className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-3 text-xs font-semibold text-surface disabled:opacity-50">{decisionRetryPending ? "Retry same decision" : "Save source decision"}</button>
        </form>
      )}

      {clearanceAllowed && (
        <form className="space-y-3 rounded-lg border border-border p-3" onSubmit={(event) => { event.preventDefault(); onSubmitClearance(); }}>
          <div>
            <h4 className="text-xs font-semibold text-foreground">Fleet departure clearance</h4>
            <p className="mt-1 text-[11px] text-foreground-secondary">The server checks the current pickup, source decision, and separate post-load securement evidence.</p>
          </div>
          <label className="block space-y-1 text-xs font-medium text-foreground-secondary">Fleet review note
            <textarea required maxLength={2000} className="min-h-20 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground" value={reviewerState.clearanceReason} onChange={(event) => onClearanceReason(event.target.value)} />
          </label>
          <button type="submit" disabled={blocked} className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-3 text-xs font-semibold text-surface disabled:opacity-50">Record Fleet clearance</button>
        </form>
      )}
    </div>
  );
}

export function CargoVerificationPanelContent({
  tripId,
  linkedRequestId,
  view,
  isLoading = false,
  error = null,
  reviewerState = initialCargoReviewState,
  busy = false,
  decisionRetryPending = false,
  onRefresh,
  onDecisionDraft,
  onClearanceReason,
  onSubmitDecision,
  onSubmitClearance,
  onRetryFeedback,
  retrying = false,
  handoverEvidence,
}) {
  const section = useCargoHandoverAnchor(tripId, isLoading);
  const manifest = view?.manifest;
  const pickup = view?.pickup_receipt ?? null;
  const delivery = view?.delivery_receipt ?? null;
  const sourceHref = resolveCargoSourceHref(manifest, view?.source_link, linkedRequestId);
  const decisionHistoryView = {
    ...view,
    receiver_confirmed: view?.receiver_confirmed === true,
    fleet_clearance: view?.fleet_clearance ? {
      ...view.fleet_clearance,
      securement_confirmed: view?.securement_confirmed === true,
    } : null,
  };

  return (
    <section ref={section} tabIndex={-1} className="scroll-mt-24 overflow-hidden rounded-xl border border-border bg-surface shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2" aria-labelledby={`cargo-verification-${tripId}`}>
      <header className="flex flex-col gap-2 border-b border-border/70 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Truck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id={`cargo-verification-${tripId}`} className="text-sm font-semibold text-foreground">Cargo verification</h2>
            <p className="text-[11px] text-foreground-secondary">Trip #{tripId} · one source for this execution</p>
          </div>
        </div>
        {view && onRefresh && (
          <button type="button" onClick={onRefresh} disabled={isLoading} className="inline-flex h-8 items-center justify-center gap-1.5 self-start rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50 sm:self-auto">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh current record
          </button>
        )}
      </header>

      <div className="space-y-4 p-4">
        {isLoading && !view && <p role="status" className="text-sm text-foreground-secondary">Loading cargo record…</p>}
        {error && (
          <div role="alert" className="flex gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0"><p className="font-semibold">{view ? "Could not refresh the cargo record" : "Cargo review unavailable"}</p><p className="mt-0.5 text-xs text-foreground-secondary">{unavailableDescription(error)}</p></div>
          </div>
        )}
        {reviewerState.actionError && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger-800 dark:text-rose-200">{reviewerState.actionError}</p>}
        {reviewerState.actionNotice && <p role="status" className="rounded-md border border-success/30 bg-success-bg px-3 py-2 text-xs text-success">{reviewerState.actionNotice}</p>}
        {reviewerState.refreshRequired && (
          <div role="alert" className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
            <p className="font-semibold">This review is out of date. Load the current server record before submitting again.</p>
            {reviewerState.refreshError && <p className="mt-1 text-foreground-secondary">{reviewerState.refreshError}</p>}
          </div>
        )}

        {!view && !isLoading && error && null}
        {view && manifest && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">{sourceLabel(manifest)} <span className="font-normal text-foreground-secondary">· {manifest.source_ref?.system || "Source unavailable"}</span></p>
                <p className="mt-0.5 text-[11px] text-foreground-muted">Revision {manifest.manifest_ref?.revision ?? "unavailable"}</p>
              </div>
              {sourceHref ? (
                <a href={sourceHref} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  Open source record <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : manifest.manifest_ref?.kind === "SUPPLY" ? (
                <span className="text-[11px] text-foreground-muted">Linked shipment detail is unavailable.</span>
              ) : null}
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">Quantity comparison</h3>
              <CargoQuantityTable manifest={manifest} pickup={pickup} delivery={delivery} />
              {manifest.physical_contract_version === 1 && <p className="text-xs text-foreground-secondary">Package facts are the source-declared transport requirements. They do not replace vehicle capacity checks, Fleet clearance or post-load securement.</p>}
            </div>

            <PrivateCargoPhotos tripId={tripId} pickup={pickup} delivery={delivery} reviewerState={reviewerState} />
            {handoverEvidence ?? <CargoHandoverEvidenceContent />}

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">Review actions</h3>
              <CargoReviewForm
                view={view}
                reviewerState={reviewerState}
                busy={busy}
                decisionRetryPending={decisionRetryPending}
                onDecisionDraft={onDecisionDraft}
                onClearanceReason={onClearanceReason}
                onSubmitDecision={onSubmitDecision}
                onSubmitClearance={onSubmitClearance}
              />
              <p className="flex items-start gap-1.5 text-[11px] text-foreground-muted"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Vehicle inspection remains a separate safety check; cargo approval does not replace it.</p>
            </div>

            <CargoDecisionHistory view={decisionHistoryView} />

            <section className="rounded-lg border border-border px-3 py-3" aria-labelledby={`cargo-feedback-${tripId}`}>
              <h3 id={`cargo-feedback-${tripId}`} className="mb-2 text-xs font-semibold text-foreground">Partner message delivery</h3>
              <CargoFeedbackStatus
                feedback={view.feedback}
                canRetry={view.capabilities?.feedback_retry === true}
                onRetry={onRetryFeedback}
                isRetrying={retrying}
              retryError={reviewerState.retryError}
              />
            </section>
          </>
        )}
        {view && !manifest && <p role="alert" className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-foreground-secondary">The cargo execution has no readable manifest. No item count or source decision is assumed.</p>}
      </div>
    </section>
  );
}

function PrivateCargoPhotos({ tripId, pickup, delivery, reviewerState }) {
  const lines = [
    ...receiptPayload(pickup)?.lines?.map((line) => ({ stage: "Pickup", ...line }) || []) ?? [],
    ...receiptPayload(delivery)?.lines?.map((line) => ({ stage: "Delivery", ...line }) || []) ?? [],
  ];
  const evidence = lines.flatMap((line) => (line.evidence_ids || []).map((evidenceId) => ({ evidenceId, stage: line.stage, item: line.name || line.line_id })));
  const [localPhoto, setLocalPhoto] = useState({ id: "", url: "", loadingId: "", error: "" });

  async function openPhoto(evidenceId) {
    setLocalPhoto({ id: evidenceId, url: "", loadingId: evidenceId, error: "" });
    try {
      const result = await getCargoEvidence(tripId, evidenceId);
      setLocalPhoto({ id: evidenceId, url: result.url, loadingId: "", error: "" });
    } catch (error) {
      setLocalPhoto({ id: evidenceId, url: "", loadingId: "", error: error.message || "The private photo could not be opened." });
    }
  }

  if (!evidence.length) return null;
  const shownPhoto = localPhoto.url ? localPhoto : reviewerState.photoUrl ? { url: reviewerState.photoUrl, id: reviewerState.photoId } : null;

  return (
    <section className="space-y-2" aria-labelledby={`cargo-evidence-${tripId}`}>
      <h3 id={`cargo-evidence-${tripId}`} className="text-xs font-semibold text-foreground">Private receipt photos</h3>
      <ul className="flex flex-wrap gap-2">
        {evidence.map((item, index) => (
          <li key={`${item.evidenceId}-${index}`}>
            <button type="button" disabled={localPhoto.loadingId === item.evidenceId} onClick={() => openPhoto(item.evidenceId)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground hover:bg-hover disabled:opacity-50">
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              {localPhoto.loadingId === item.evidenceId ? "Opening photo…" : `${item.stage}: ${item.item}`}
            </button>
          </li>
        ))}
      </ul>
      {localPhoto.error && <p role="alert" className="text-xs text-danger-800 dark:text-rose-200">{localPhoto.error}</p>}
      {shownPhoto && (
        <div className="max-w-xl rounded-lg border border-border bg-muted/10 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Private cargo photo</p>
            <button type="button" onClick={() => setLocalPhoto({ id: "", url: "", loadingId: "", error: "" })} className="text-xs text-primary hover:underline">Close photo</button>
          </div>
          <img src={shownPhoto.url} alt="Private cargo receipt evidence" className="max-h-80 w-full rounded object-contain" />
        </div>
      )}
    </section>
  );
}

function conflictError(error) {
  return error?.status === 409 || /CONFLICT|STALE|OUTDATED/.test(error?.code || "");
}

function commandId() {
  return globalThis.crypto?.randomUUID?.() || null;
}

export function CargoVerificationPanel({ tripId, linkedRequestId }) {
  const id = Number(tripId);
  const query = useQuery({
    queryKey: ["cargo-execution", id],
    queryFn: () => getCargoExecution(id),
    enabled: Number.isSafeInteger(id) && id > 0,
    retry: false,
    staleTime: 0,
  });
  const [reviewerState, dispatch] = useReducer(cargoReviewReducer, initialCargoReviewState);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [decisionRetryTripIds, setDecisionRetryTripIds] = useState(() => new Set());
  const decisionCommandManager = useRef(null);
  if (decisionCommandManager.current == null) {
    decisionCommandManager.current = createCargoDecisionCommandManager({
      send: recordManualCargoDecision,
      createId: commandId,
    });
  }

  function updateDecisionRetryState(tripId, retryPending) {
    setDecisionRetryTripIds((current) => {
      const next = new Set(current);
      if (retryPending) next.add(tripId);
      else next.delete(tripId);
      return next;
    });
  }

  async function loadCurrent({ clearDraft, notice, clearActionError = false } = {}) {
    const result = await query.refetch();
    if (result.isSuccess && result.data) {
      dispatch({ type: "fresh-view-loaded", clearDraft, notice, clearActionError });
      return true;
    }
    dispatch({ type: "refresh-failed", message: result.error?.message || "The current cargo record could not be loaded." });
    return false;
  }

  async function runAction(payload) {
    setBusy(true);
    dispatch({ type: "action-started" });
    try {
      await clearCargoDeparture(id, payload);
      dispatch({ type: "action-accepted", message: "The request was accepted. Reloading the current cargo state." });
      dispatch({ type: "refresh-required" });
      await loadCurrent({ clearDraft: "clearance", notice: "The request was accepted. Current cargo state has been reloaded.", clearActionError: true });
    } catch (error) {
      const isConflict = conflictError(error);
      dispatch({ type: "action-rejected", message: error.message || "The cargo review could not be saved.", refreshRequired: isConflict });
      if (isConflict) {
        dispatch({ type: "refresh-required" });
        await loadCurrent();
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision() {
    const view = query.data;
    const pickup = view?.pickup_receipt;
    const communicatedAt = timeForCommand(reviewerState.decisionDraft.communicated_at);
    if (!pickup?.receipt_id || !view?.manifest?.manifest_ref?.hash || !communicatedAt) {
      dispatch({ type: "action-rejected", message: "The current pickup or communication time is missing. Refresh the record and complete each field." });
      return;
    }
    const evidenceIds = communicationEvidenceIds(reviewerState.decisionDraft.communication_evidence_ids);
    setBusy(true);
    dispatch({ type: "action-started" });
    try {
      const submission = await decisionCommandManager.current.submit({
        tripId: id,
        createPayload: (eventId) => ({
          event_id: eventId,
          receipt_id: pickup.receipt_id,
          manifest_hash: view.manifest.manifest_ref.hash,
          action: reviewerState.decisionDraft.action,
          reason: reviewerState.decisionDraft.reason.trim(),
          approver_identity: reviewerState.decisionDraft.approver_identity.trim(),
          approver_reference: reviewerState.decisionDraft.approver_reference.trim(),
          communicated_at: communicatedAt,
          communication_evidence_ids: evidenceIds,
        }),
      });
      if (submission.status === "invalid") {
        updateDecisionRetryState(id, false);
        dispatch({ type: "action-rejected", message: "The current pickup or communication time is missing. Refresh the record and complete each field." });
        return;
      }
      if (submission.status === "uncertain") {
        updateDecisionRetryState(id, true);
        dispatch({
          type: "action-rejected",
          message: "The server did not confirm whether the decision was saved. Retry the same decision to safely check its result.",
        });
        return;
      }
      updateDecisionRetryState(id, false);
      if (submission.status === "rejected") {
        const error = submission.error;
        const isConflict = conflictError(error);
        dispatch({ type: "action-rejected", message: error?.message || "The cargo review could not be saved.", refreshRequired: isConflict });
        if (isConflict) {
          dispatch({ type: "refresh-required" });
          await loadCurrent();
        }
        return;
      }
      dispatch({ type: "action-accepted", message: "The request was accepted. Reloading the current cargo state." });
      dispatch({ type: "refresh-required" });
      await loadCurrent({ clearDraft: "decision", notice: "The request was accepted. Current cargo state has been reloaded.", clearActionError: true });
    } catch (error) {
      if (decisionCommandManager.current.hasPending(id)) {
        updateDecisionRetryState(id, true);
        dispatch({ type: "action-rejected", message: "The server did not confirm whether the decision was saved. Retry the same decision to safely check its result." });
      } else {
        updateDecisionRetryState(id, false);
        dispatch({ type: "action-rejected", message: error?.message || "The cargo review could not be saved." });
      }
    } finally {
      setBusy(false);
    }
  }

  function submitClearance() {
    const pickup = query.data?.pickup_receipt;
    if (!pickup?.receipt_id || !Number.isSafeInteger(query.data?.version)) {
      dispatch({ type: "action-rejected", message: "The current pickup version is unavailable. Refresh the record before submitting." });
      return;
    }
    runAction({
      receipt_id: pickup.receipt_id,
      expected_version: query.data.version,
      reason: reviewerState.clearanceReason.trim(),
    });
  }

  async function retryFeedback() {
    const view = query.data;
    const feedback = view?.feedback;
    if (view?.capabilities?.feedback_retry !== true || feedback?.state !== "FAILED" || !feedback?.event_id || !view?.manifest?.source_ref) return;
    setRetrying(true);
    setRetryError("");
    try {
      const source = view.manifest.source_ref;
      await retryCargoFeedback({ tripId: id, sourceSystem: source.system, organizationId: source.organization_id, eventId: feedback.event_id });
      dispatch({ type: "refresh-required" });
      await loadCurrent({ notice: "The partner message retry was queued. Cargo approval has not changed." });
    } catch (error) {
      setRetryError(error.message || "The partner message could not be retried.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <CargoVerificationPanelContent
      tripId={id}
      linkedRequestId={linkedRequestId}
      view={query.data}
      handoverEvidence={<CargoHandoverEvidence tripId={id} manifest={query.data?.manifest} pickupRecorded={!!query.data?.pickup_receipt} deliveryRecorded={!!query.data?.delivery_receipt} />}
      isLoading={query.isLoading || query.isFetching && !query.data}
      error={query.error}
      reviewerState={{ ...reviewerState, retryError }}
      busy={busy}
      decisionRetryPending={decisionRetryTripIds.has(id)}
      onRefresh={() => loadCurrent()}
      onDecisionDraft={(patch) => dispatch({ type: "decision-draft", patch })}
      onClearanceReason={(value) => dispatch({ type: "clearance-reason", value })}
      onSubmitDecision={submitDecision}
      onSubmitClearance={submitClearance}
      onRetryFeedback={retryFeedback}
      retrying={retrying}
    />
  );
}
