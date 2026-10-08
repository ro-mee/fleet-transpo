"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, LoaderCircle, RotateCcw } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";
import { useRoleAccess } from "@/hooks/use-role-access";
import { CopilotAvatar } from "./copilot-avatar";
import { EvidenceDrawer, buildInspectorRows } from "./evidence-drawer";

// Latest comparison proof from assistant messages. Exported for tests.
export function latestComparisonFor(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "assistant" && m.comparisonProof?.ref) return m.comparisonProof;
  }
  return null;
}
// Latest clearance for the selected pair (else first reported pair) from
// assistant messages. Exported for tests. Reads stored messages only.
export function latestClearanceFor(messages = [], selectedPair = null) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant" || !Array.isArray(m.pairRecovery)) continue;
    const match = selectedPair
      ? m.pairRecovery.find(p => p.vehicleId === selectedPair.vehicleId && p.driverId === selectedPair.driverId)
      : null;
    const entry = match ?? m.pairRecovery[0];
    if (entry && Array.isArray(entry.clearance) && entry.clearance.length) {
      return {
        pair: { vehicleId: entry.vehicleId, driverId: entry.driverId },
        clearance: entry.clearance, meta: entry.meta ?? {},
        pairLabel: m.selectedPairLabel ?? null,
      };
    }
  }
  return null;
}

const clock = (value) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const CONVERSATION_STORAGE_KEY = "fleetops_dispatch_copilot_convo_map";
// Retain up to 30 most recently used reservations.
const MAX_MEMORY_ENTRIES = 30;

function readStoredMemoryMap() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Allowlisted recovery destinations (P1-08). Every target below is a route
// verified on disk under src/app/(dashboard): the fleet vehicle detail and
// directory, the driver detail and directory, the maintenance directory, and
// the reservation detail. IDs interpolate only when they are finite positive
// integers. The maintenance page reads no vehicle filter, so that record
// resolves to the directory; a schedule block resolves to a driver page only
// for DRIVER_UNAVAILABLE (which carries the driver id) — pairing blocks
// carry the vehicle id and must never interpolate into a driver route.
// The caller additionally gates every href through useRoleAccess; a null or
// unauthorized target renders as guidance text, never as a link.
function toSafeRecordId(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function recoveryHref(action) {
  if (!action || typeof action !== "object" || action.record == null) return null;
  const id = toSafeRecordId(action.id);
  switch (action.record) {
    case 'vehicle': return id != null ? `/fleet/vehicles/${id}` : '/fleet/vehicles';
    case 'driver': return id != null ? `/drivers/${id}` : '/drivers';
    case 'maintenance': return '/maintenance';
    case 'schedule':
      if (action.code !== 'DRIVER_UNAVAILABLE') return null;
      return id != null ? `/drivers/${id}` : '/drivers';
    case 'request': return id != null ? `/reservations/${id}` : null;
    default: return null;
  }
}

function writeStoredMemoryMap(map) {
  if (typeof window === "undefined") return;
  try {
    // Retain up to 30 most recently used reservations with up to 30 messages each
    const entries = Object.entries(map);
    const pruned = entries.slice(-MAX_MEMORY_ENTRIES).reduce((acc, [k, v]) => {
      acc[k] = Array.isArray(v) ? v.slice(-MAX_MEMORY_ENTRIES) : [];
      return acc;
    }, {});
    window.sessionStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify(pruned)
    );
  } catch {
    // Fallback for private mode or storage quota
  }
}

// The chosen pair is separate state from the conversation, and it needs its own
// record for one reason the transcript cannot cover: "change" clears the
// selection without appending a message, so a transcript can record a choice but
// never its absence — deriving the selection from the last `select-pair` message
// would resurrect a choice the dispatcher had abandoned. Written on choose,
// cleared on change/assign/clear, restored by the panel on mount.
const SELECTION_STORAGE_KEY = "fleetops_dispatch_copilot_selection_map";

function readStoredSelectionMap() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredSelectionMap(map) {
  if (typeof window === "undefined") return;
  try {
    const pruned = Object.entries(map).slice(-MAX_MEMORY_ENTRIES).reduce((acc, [k, v]) => {
      if (v && typeof v === "object" && typeof v.key === "string") acc[k] = v;
      return acc;
    }, {});
    window.sessionStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify(pruned)
    );
  } catch {
    // Fallback for private mode or storage quota
  }
}

let selectionCache = null;

function getSelectionMap() {
  if (selectionCache === null) selectionCache = readStoredSelectionMap();
  return selectionCache;
}

// The chosen pair for one reservation: { key: 'vehicleId:driverId', pinnedKeys: string[] }.
// No listener registry: the panel is the only reader, and it reads once at mount.
export function getReservationSelection(requestId) {
  if (!requestId) return null;
  const stored = getSelectionMap()[String(requestId)];
  return stored && typeof stored === "object" && typeof stored.key === "string" ? stored : null;
}

export function setReservationSelection(requestId, selection) {
  if (!requestId) return null;
  const map = { ...getSelectionMap() };
  const id = String(requestId);
  const next = selection && typeof selection.key === "string"
    ? { key: selection.key, pinnedKeys: Array.isArray(selection.pinnedKeys) ? selection.pinnedKeys : [] }
    : null;
  if (next) map[id] = next; else delete map[id];
  selectionCache = map;
  writeStoredSelectionMap(map);
  return next;
}

export function clearReservationSelection(requestId) {
  if (!requestId) return null;
  return setReservationSelection(requestId, null);
}

// Module-level shared map and listener registry
let memoryCache = null;
const memoryListeners = new Set();

function getMemoryMap() {
  if (memoryCache === null) {
    memoryCache = readStoredMemoryMap();
  }
  return memoryCache;
}

export function getReservationMessages(requestId) {
  if (!requestId) return [];
  const map = getMemoryMap();
  const list = map[String(requestId)];
  return Array.isArray(list) ? list : [];
}

export function setReservationMessages(requestId, updater) {
  if (!requestId) return [];
  const map = { ...getMemoryMap() };
  const key = String(requestId);
  const current = Array.isArray(map[key]) ? map[key] : [];
  const next = typeof updater === "function" ? updater(current) : updater;
  map[key] = next;
  memoryCache = map;
  writeStoredMemoryMap(map);
  memoryListeners.forEach((fn) => fn(map, key));
  return next;
}

export function clearReservationMessages(requestId) {
  if (!requestId) return [];
  clearReservationSelection(requestId);
  return setReservationMessages(requestId, []);
}

export function clearAllReservationMessages() {
  memoryCache = {};
  writeStoredMemoryMap({});
  selectionCache = {};
  writeStoredSelectionMap({});
  if (typeof window !== "undefined") {
    try {
      const baselineKeys = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (key?.startsWith("fleetops_dispatch_baseline_")) baselineKeys.push(key);
      }
      baselineKeys.forEach((key) => window.sessionStorage.removeItem(key));
    } catch {
      // Private mode or a restricted storage implementation.
    }
  }
  memoryListeners.forEach((fn) => fn({}, null));
  return {};
}

// Compatibility exports
export function getSharedMessages(requestId) {
  return getReservationMessages(requestId);
}

export function setSharedMessages(requestId, updater) {
  return setReservationMessages(requestId, updater);
}

export function clearSharedMessages(requestId) {
  if (requestId) {
    return clearReservationMessages(requestId);
  }
  return clearAllReservationMessages();
}

export function CopilotConversation({
  requestId,
  selectedRequest = null,
  planToken,
  hasPair,
  selectedPair = null,
  selectedPairLabel = null,
  displayedEvaluatedAt = null,
  displayedOptions = [],
  disabled = false,
  completed = false,
  readOnlyCommitted = false,
  children,
  reply,
  decisionDock,
  onResetDecision,
  resetDisabled = false,
  onCommand,
  planStatus = null,
}) {
  const [messages, setMessages] = useState(() => getReservationMessages(requestId));
  const [draft, setDraft] = useState("");
  const [newReplyAvailable, setNewReplyAvailable] = useState(false);
  // Open evidence proof (server-signed ref). The drawer is a pure read view:
  // opening it fetches one point-in-time snapshot and never validates.
  const [evidenceProof, setEvidenceProof] = useState(null);
  const [nestedEvidenceProof, setNestedEvidenceProof] = useState(null);
  const evidenceOpenerRef = useRef(null);
  const nestedEvidenceOpenerRef = useRef(null);
  const nestedProofCloseFocusRef = useRef(null);
  const openEvidence = (event, proof) => {
    evidenceOpenerRef.current = event.currentTarget;
    setNestedEvidenceProof(null);
    setEvidenceProof(proof);
  };
  const closeEvidence = () => {
    nestedProofCloseFocusRef.current = evidenceOpenerRef.current;
    setNestedEvidenceProof(null);
    setEvidenceProof(null);
  };
  const closeNestedEvidence = () => {
    nestedProofCloseFocusRef.current = nestedEvidenceOpenerRef.current;
    setNestedEvidenceProof(null);
  };
  const log = useRef(null);
  const follow = useRef(true);
  const lastObservedMessage = useRef(messages.at(-1) ?? null);
  const sending = useRef(false);
  const currentPair = readOnlyCommitted ? null : selectedPair;
  const currentSelection = useRef(currentPair);
  // Permission-aware recovery links: a null or unauthorized target renders
  // as plain guidance text, never as a link. Fail closed when no checker.
  const { canAccess } = useRoleAccess() ?? {};
  useEffect(() => { currentSelection.current = currentPair; }, [currentPair]);

  // The panel keys this component by requestId; switching reservations resets local state.
  // Sync state across module updates for this specific reservation
  useEffect(() => {
    const onSync = (_map, updatedKey) => {
      if (!updatedKey || updatedKey === String(requestId)) {
        const nextMessages = getReservationMessages(requestId);
        const latestMessage = nextMessages.at(-1) ?? null;
        if (!follow.current && latestMessage !== lastObservedMessage.current && latestMessage?.role === "assistant") {
          setNewReplyAvailable(true);
        }
        if (!updatedKey) setNewReplyAvailable(false);
        lastObservedMessage.current = latestMessage;
        setMessages(nextMessages);
      }
    };
    memoryListeners.add(onSync);
    return () => memoryListeners.delete(onSync);
  }, [requestId]);

  const currentRef =
    selectedRequest?.reservation_number ||
    selectedRequest?.booking_reference ||
    (requestId ? `RS-${requestId}` : null);
  const currentGuest = selectedRequest?.guest_name || null;

  const send = useMutation({
    mutationFn: ({ message, history, requestId: targetId, planToken: token, selectedPair: selection, displayedEvaluatedAt: viewedAt, displayedOptions: options }) => {
      let baseline = null;
      if (!readOnlyCommitted) {
        try { baseline = window.sessionStorage.getItem(`fleetops_dispatch_baseline_${targetId}`); } catch { baseline = null; }
      }
      const assignmentContext = readOnlyCommitted ? {} : {
        planToken: token,
        selectedPair: selection,
        displayedEvaluatedAt: viewedAt,
        ...(options ? {displayedOptions:options} : {}),
        ...(baseline ? {baseline} : {}),
      };
      return apiFetch(
        `/api/integration/transport-requests/${targetId}/conversation`,
        { method: "POST", body: { message, history, ...assignmentContext } }
      );
    },
    onMutate: ({ message, requestId: targetId, selectedPair: selection, selectedPairLabel: selectionLabel, displayedEvaluatedAt: viewedAt }) => {
      const userMsg = {
        role: "user",
        content: message,
        at: Date.now(),
        requestId: targetId,
        selectedPair: readOnlyCommitted ? null : selection,
        selectedPairLabel: readOnlyCommitted ? null : selectionLabel,
        displayedEvaluatedAt: readOnlyCommitted ? null : viewedAt,
        reservationNumber: currentRef,
        guestName: currentGuest,
      };
      setReservationMessages(targetId, (previous) => [...previous.slice(-29), userMsg]);
      setDraft("");
    },
    onSuccess: (response, { requestId: targetId, selectedPair: selection, selectedPairLabel: selectionLabel, displayedEvaluatedAt: viewedAt, displayedOptions: options }) => {
      try { if (response.snapshot) window.sessionStorage.setItem(`fleetops_dispatch_baseline_${targetId}`, response.snapshot); } catch { /* private mode */ }
      const choices = (response.choiceOptions ?? []).filter(index => options?.[index-1]);
      const prompt = !selection && !currentSelection.current && choices.length
        ? choices.length === 2 ? '\n\nWhich would you like to choose: Option 1 or Option 2?' : `\n\nWould you like to choose Option ${choices[0]}?`
        : '';
      const assistantMsg = {
        role: "assistant",
        ...response,
        content: response.answer + prompt,
        at: Date.now(),
        requestId: targetId,
        selectedPair: readOnlyCommitted ? null : selection,
        selectedPairLabel: readOnlyCommitted ? null : selectionLabel,
        displayedEvaluatedAt: readOnlyCommitted ? null : viewedAt,
        reservationNumber: currentRef,
        guestName: currentGuest,
      };
      setReservationMessages(targetId, (previous) => [...previous.slice(-29), assistantMsg]);
      if (String(targetId) === String(requestId) && !follow.current) setNewReplyAvailable(true);
    },
    onError: (_error, { message }) => setDraft(message),
    onSettled: () => {
      sending.current = false;
    },
  });

  useEffect(() => {
    if (follow.current && log.current) {
      log.current.scrollTop = log.current.scrollHeight;
    }
  }, [messages, send.isPending, reply, decisionDock, children]);

  const submit = (message) => {
    if (!message.trim() || sending.current || disabled) return;
    follow.current = true;
    setNewReplyAvailable(false);
    const commandResult = onCommand?.(message);
    if (commandResult) {
      if (!commandResult.handled) setReservationMessages(requestId, previous => [...previous.slice(-28),
        {role:'user',content:message.trim(),at:Date.now()},
        {role:'assistant',content:commandResult,at:Date.now()}]);
      setDraft('');
      return;
    }
    sending.current = true;
    follow.current = true;
    send.mutate({
      requestId,
      planToken: readOnlyCommitted ? null : planToken,
      selectedPair: currentPair,
      selectedPairLabel: readOnlyCommitted ? null : selectedPairLabel,
      displayedEvaluatedAt: readOnlyCommitted ? null : displayedEvaluatedAt,
      displayedOptions: readOnlyCommitted ? [] : displayedOptions,
      message: message.trim(),
      history: messages
        .slice(-8)
        .map(({ role, content, selectedPair: pastPair }) => ({
          role,
          content: `${!readOnlyCommitted && pastPair ? `[Asked about vehicle #${pastPair.vehicleId} / driver #${pastPair.driverId}] ` : ''}${content}`.slice(0, 2000),
        })),
    });
  };

  const resetCopilot = () => {
    if (resetDisabled || send.isPending) return;
    if (onResetDecision) onResetDecision();
    else clearReservationSelection(requestId);
    setMessages([]);
    setReservationMessages(requestId, []);
    follow.current = true;
    setNewReplyAvailable(false);
  };

  const jumpToLatest = () => {
    follow.current = true;
    setNewReplyAvailable(false);
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  };

  // Committed trips get a status-only route response (server lifecycle + IDs,
  // no ranking/proof/LLM). Suggestions must not promise details or next-step
  // answers the route does not provide; trip details render in the decision
  // bubble from the reservation record instead.
  const suggestions = readOnlyCommitted
    ? ["What is the current trip status?"]
    : hasPair
      ? ["Why this option?", "Any conflicts?", "Other options?"]
      : ["Why no match?", "What needs fixing?", "Other options?"];

  return (
    <section
      aria-label="Copilot conversation"
      className="min-h-0 flex-1 flex flex-col overflow-hidden bg-background relative"
    >
      {/* ── Context & Memory Header ── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/20 text-xs shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
          <span className="text-[11px] font-medium text-foreground-secondary truncate">
            Context:{" "}
            <strong className="text-foreground font-data font-semibold">
              {currentRef ? `#${currentRef}` : `Request #${requestId}`}
            </strong>
            {currentGuest ? ` · ${currentGuest}` : ""}
          </span>
        </div>
        {(messages.length > 0 || currentPair) && (
          <button
            type="button"
            disabled={resetDisabled || send.isPending}
            onClick={resetCopilot}
            className="text-xs text-foreground-muted hover:text-danger-700 hover:bg-hover px-2 min-h-[44px] rounded flex items-center gap-1 transition-colors cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed"
            title={resetDisabled ? "Wait for the assignment outcome before resetting Copilot." : send.isPending ? "Wait for the current Copilot reply before resetting." : "Reset Copilot conversation and selected pair for this reservation"}
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Reset Copilot
          </button>
        )}
      </div>
      {readOnlyCommitted && (
        <p role="note" className="border-b border-border/60 bg-muted/10 px-3 py-1.5 text-[11px] text-foreground-secondary">
          Earlier conversation is history; current trip details come from this reservation record.
        </p>
      )}

      {newReplyAvailable && (
        <div className="flex shrink-0 justify-end border-b border-border bg-muted/20 px-3 py-1.5">
          <button
            type="button"
            onClick={jumpToLatest}
            className="rounded-lg border border-border bg-surface px-2.5 min-h-[44px] text-xs font-medium text-foreground hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary"
          >
            New reply — jump to latest
          </button>
        </div>
      )}

      {/* ── Message Log ── */}
      <div
        ref={log}
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={() => {
          const el = log.current;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (follow.current) setNewReplyAvailable(false);
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-3 p-3"
      >
        {!readOnlyCommitted && children}
        {messages.length === 0 && !children && !reply && (
          <div className="flex items-start gap-2 max-w-[95%]">
            <CopilotAvatar size="xs" className="mt-0.5" />
            <div className="rounded-xl rounded-tl-sm border border-border bg-surface px-3 py-2 text-sm leading-relaxed shadow-xs">
              I can help you understand this reservation and compare options. What would you like to know?
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <Fragment key={i}>
          <div
            className={cn(
              "flex flex-col",
              m.role === "user" ? "items-end" : "items-start"
            )}
          >
                <div
                  className={cn(
                    "flex items-start gap-2 max-w-[95%]",
                    m.role === "user" && "justify-end flex-row-reverse"
                  )}
                >
                  {m.role === "assistant" && (
                    <CopilotAvatar size="xs" className="mt-0.5" />
                  )}
                  <div
                    className={cn(
                      "rounded-xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
                      m.role === "user"
                        ? "rounded-br-sm bg-info-bg text-info-700"
                        : "rounded-tl-sm border border-border bg-surface text-foreground shadow-xs"
                    )}
                  >
                    <span className="sr-only">
                      {m.role === "user" ? "You: " : "Copilot: "}
                    </span>
                    {m.content}
                    {m.mode === "evidence-only" && (
                      <p className="mt-2 text-xs text-foreground-secondary">
                        Chat is temporarily unavailable. These are the recorded findings.
                      </p>
                    )}
                    {!readOnlyCommitted && m.role === "assistant" && Array.isArray(m.recoveryActions) && m.recoveryActions.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {m.recoveryActions.slice(0, 2).map((action, idx) => {
                          if (action.proof?.ref) {
                            return (
                              <button key={`${action.code}-${idx}`} type="button"
                                onClick={event => openEvidence(event, { kind: "proof", type: action.proof.type, ref: action.proof.ref })}
                                className="rounded-lg border border-border px-2.5 min-h-[44px] text-xs text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary cursor-pointer">
                                Review Evidence
                              </button>
                            );
                          }
                          const href = recoveryHref(action);
                          const label = action.label || 'Check record';
                          const openable = href && typeof canAccess === "function" ? canAccess(href) : false;
                          return openable ? (
                            <a key={`${action.code}-${idx}`} href={href}
                              className="inline-flex min-h-[44px] items-center rounded-lg border border-border px-2.5 py-1 text-xs text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary">
                              {label}
                            </a>
                          ) : (
                            <span key={`${action.code}-${idx}`} className="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground-secondary">
                              {label}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <time
                  dateTime={new Date(m.at).toISOString()}
                  className={cn(
                    "mt-1 px-1 text-[11px] text-foreground-secondary",
                    m.role === "assistant" && "pl-8"
                  )}
                >
                  {clock(m.at)}
                </time>
                {m.selectedPair && (
                  <p className="mt-1 px-1 text-[11px] text-foreground-secondary">
                    Asked about {m.selectedPairLabel || `vehicle #${m.selectedPair.vehicleId} / driver #${m.selectedPair.driverId}`}
                  </p>
                )}
                {!readOnlyCommitted && m.evaluatedAt && (
                  <details className="mt-1 max-w-[90%] pl-8 text-[11px] text-foreground-secondary">
                    <summary className="cursor-pointer">Evidence details</summary>
                    <p>
                      Checked {formatDateTime(m.evaluatedAt)}. Recheck the decision card before confirming.
                    </p>
                    {m.coverage && <p>Context includes {m.coverage.pairs.included} of {m.coverage.pairs.total} candidate pairs and {m.coverage.exclusions.included} of {m.coverage.exclusions.total} exclusions in this evaluation.</p>}
                  </details>
                )}
              </div>
          </Fragment>
        ))}

        {send.isPending && (
          <div role="status" className="flex items-center gap-2 max-w-[95%]">
            <CopilotAvatar size="xs" />
            <div className="flex items-center gap-2 rounded-xl rounded-tl-sm border border-border bg-surface px-3 py-2 text-xs text-foreground-secondary">
              <LoaderCircle
                className="h-3.5 w-3.5 motion-safe:animate-spin text-primary"
                aria-hidden="true"
              />
              Copilot is checking…
            </div>
          </div>
        )}
        {reply}
        {!readOnlyCommitted && !completed && !currentPair && displayedOptions.length > 0 && !send.isPending && messages.length === 0 && <p className="pl-8 text-sm text-foreground-secondary">{displayedOptions.length === 2 ? 'Which would you like to choose: Option 1 or Option 2?' : 'Would you like to choose Option 1?'}</p>}
        {!readOnlyCommitted && !completed && !currentPair && messages.length > 0 && !send.isPending && <div className="flex flex-wrap gap-2 pl-8">
          {displayedOptions.map((option,index)=><button key={`${option.vehicleId}:${option.driverId}`} type="button" disabled={disabled}
            onClick={()=>submit(`Option ${index+1}`)} className="rounded-lg border border-border px-3 min-h-[44px] text-xs text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">Choose Option {index+1}</button>)}
        </div>}
        {!readOnlyCommitted && !completed && !send.isPending && (() => {
          const clearanceInfo = latestClearanceFor(messages, currentPair);
          const comparison = latestComparisonFor(messages);
          if (!clearanceInfo && !comparison) return null;
          return (
            <div className="flex flex-wrap gap-2 pl-8">
              {clearanceInfo && (
                <button type="button" disabled={disabled}
                  onClick={event => openEvidence(event, { kind: "inspector", ...clearanceInfo })}
                  className="rounded-lg border border-border px-3 min-h-[44px] text-xs text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">
                  Review eligibility
                </button>
              )}
              {comparison && (
                <button type="button" disabled={disabled}
                  onClick={event => openEvidence(event, { kind: "proof", type: comparison.type, ref: comparison.ref })}
                  className="rounded-lg border border-border px-3 min-h-[44px] text-xs text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">
                  Compare options
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {decisionDock && (
        <div
          role="region"
          aria-label="Current dispatch decision"
          className="min-h-0 max-h-[min(40vh,20rem)] shrink-0 overflow-y-auto overscroll-contain border-t border-border bg-surface p-3 scroll-py-2"
        >
          <p aria-hidden="true" className="mb-2 text-[11px] font-bold uppercase tracking-wider text-foreground-secondary">
            Current decision
          </p>
          {decisionDock}
        </div>
      )}

      {/* ── Action Suggestions & Composer ── */}
      {!completed && <div className="shrink-0 border-t border-border bg-surface p-3 space-y-2">
        <div className="flex flex-wrap justify-end gap-1.5">
          {suggestions.map((question) => (
            <button
              key={question}
              type="button"
              disabled={disabled || send.isPending}
              onClick={() => submit(question)}
              className="rounded-lg border border-border bg-surface px-2.5 min-h-[44px] text-xs text-foreground-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              {question}
            </button>
          ))}
        </div>
        {send.isError && (
          <p role="alert" className="text-xs text-danger-700">
            I couldn&apos;t get an answer. {send.error.message} Your question is ready to resend.
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
          className="rounded-lg border border-border bg-surface focus-within:border-primary"
        >
          <label className="sr-only" htmlFor="copilot-question">
            Message Copilot
          </label>
          <textarea
            id="copilot-question"
            rows={2}
            maxLength={1000}
            value={draft}
            disabled={send.isPending || disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder="Ask a question… English or Tagalog is fine."
            className="block w-full resize-none rounded-t-lg bg-transparent px-3 pt-2.5 text-sm leading-relaxed outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="pl-1 text-[11px] text-foreground-secondary">
              {draft.length}/1000
            </span>
            <button
              type="submit"
              aria-label="Send message"
              disabled={disabled || send.isPending || !draft.trim()}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 cursor-pointer"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>}
      {evidenceProof?.kind === "inspector" && (
        <EvidenceDrawer
          key="inspector"
          requestId={requestId}
          proof={null}
          inspector={{
            pairLabel: evidenceProof.pairLabel,
            horizon: evidenceProof.meta?.horizon ?? null,
            rows: buildInspectorRows(evidenceProof.clearance, evidenceProof.meta),
          }}
          planStatus={planStatus}
          openerRef={evidenceOpenerRef}
          onClose={closeEvidence}
          onReviewProof={(proof, reviewTrigger) => {
            nestedEvidenceOpenerRef.current = reviewTrigger;
            nestedProofCloseFocusRef.current = reviewTrigger;
            setNestedEvidenceProof({ kind: "proof", type: proof.type, ref: proof.ref });
          }}
        />
      )}
      {evidenceProof?.kind === "proof" && (
        <EvidenceDrawer
          key={evidenceProof.ref}
          requestId={requestId}
          proof={evidenceProof}
          planStatus={planStatus}
          openerRef={evidenceOpenerRef}
          onClose={closeEvidence}
        />
      )}
      {evidenceProof?.kind === "inspector" && nestedEvidenceProof && (
        <EvidenceDrawer
          key={nestedEvidenceProof.ref}
          requestId={requestId}
          proof={nestedEvidenceProof}
          backTo={evidenceProof}
          planStatus={planStatus}
          nested
          openerRef={nestedEvidenceOpenerRef}
          closeFocusRef={nestedProofCloseFocusRef}
          onClose={closeNestedEvidence}
          onCloseAll={closeEvidence}
          onBack={closeNestedEvidence}
        />
      )}
    </section>
  );
}
