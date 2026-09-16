"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, LoaderCircle, RotateCcw } from "lucide-react";
import { formatDateTime, cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";

const clock = (value) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const CONVERSATION_STORAGE_KEY = "fleetops_dispatch_copilot_convo_map";

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

function writeStoredMemoryMap(map) {
  if (typeof window === "undefined") return;
  try {
    // Retain up to 30 most recently used reservations with up to 30 messages each
    const entries = Object.entries(map);
    const pruned = entries.slice(-30).reduce((acc, [k, v]) => {
      acc[k] = Array.isArray(v) ? v.slice(-30) : [];
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
  return setReservationMessages(requestId, []);
}

export function clearAllReservationMessages() {
  memoryCache = {};
  writeStoredMemoryMap({});
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
  children,
  reply,
  selectedReply,
  onCommand,
}) {
  const [messages, setMessages] = useState(() => getReservationMessages(requestId));
  const [draft, setDraft] = useState("");
  const log = useRef(null);
  const follow = useRef(true);
  const sending = useRef(false);
  const currentSelection = useRef(selectedPair);
  useEffect(() => { currentSelection.current = selectedPair; }, [selectedPair]);

  // The panel keys this component by requestId; switching reservations resets local state.
  // Sync state across module updates for this specific reservation
  useEffect(() => {
    const onSync = (map, updatedKey) => {
      if (!updatedKey || updatedKey === String(requestId)) {
        setMessages(getReservationMessages(requestId));
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
    mutationFn: ({ message, history, requestId: targetId, planToken: token, selectedPair: selection, displayedEvaluatedAt: viewedAt, displayedOptions: options }) =>
      apiFetch(
        `/api/integration/transport-requests/${targetId}/conversation`,
        {
          method: "POST",
          body: { message, history, planToken: token, selectedPair: selection, displayedEvaluatedAt: viewedAt, ...(options ? {displayedOptions:options} : {}) },
        }
      ),
    onMutate: ({ message, requestId: targetId, selectedPair: selection, selectedPairLabel: selectionLabel, displayedEvaluatedAt: viewedAt }) => {
      const userMsg = {
        role: "user",
        content: message,
        at: Date.now(),
        requestId: targetId,
        selectedPair: selection,
        selectedPairLabel: selectionLabel,
        displayedEvaluatedAt: viewedAt,
        reservationNumber: currentRef,
        guestName: currentGuest,
      };
      setReservationMessages(targetId, (previous) => [...previous.slice(-29), userMsg]);
      setDraft("");
    },
    onSuccess: (response, { requestId: targetId, selectedPair: selection, selectedPairLabel: selectionLabel, displayedEvaluatedAt: viewedAt, displayedOptions: options }) => {
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
        selectedPair: selection,
        selectedPairLabel: selectionLabel,
        displayedEvaluatedAt: viewedAt,
        reservationNumber: currentRef,
        guestName: currentGuest,
      };
      setReservationMessages(targetId, (previous) => [...previous.slice(-29), assistantMsg]);
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
  }, [messages, send.isPending, reply, selectedReply, children]);

  const submit = (message) => {
    if (!message.trim() || sending.current || disabled) return;
    follow.current = true;
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
      planToken,
      selectedPair,
      selectedPairLabel,
      displayedEvaluatedAt,
      displayedOptions,
      message: message.trim(),
      history: messages
        .slice(-8)
        .map(({ role, content, selectedPair: pastPair }) => ({
          role,
          content: `${pastPair ? `[Asked about vehicle #${pastPair.vehicleId} / driver #${pastPair.driverId}] ` : ''}${content}`.slice(0, 2000),
        })),
    });
  };

  const clearMemory = () => {
    clearReservationMessages(requestId);
  };

  const suggestions = hasPair
    ? ["Why this pair?", "Any conflicts?", "Other options?"]
    : ["Why no match?", "What needs fixing?", "Other options?"];

  // Keep the live review at its selection turn, never after subsequent Q&A.
  // If memory was cleared/pruned, retain the review above the remaining messages.
  const selectionTurn = selectedPair ? messages.findLastIndex(m =>
    m.action === 'select-pair' && m.selectedPair?.vehicleId === selectedPair.vehicleId &&
    m.selectedPair?.driverId === selectedPair.driverId) : -1;

  return (
    <section
      aria-label="Copilot conversation"
      className="min-h-0 flex-1 flex flex-col overflow-hidden bg-background"
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
        {messages.length > 0 && (
          <button
            type="button"
            disabled={send.isPending}
            onClick={clearMemory}
            className="text-xs text-foreground-muted hover:text-danger hover:bg-hover px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer select-none"
            title="Clear conversation for this reservation"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Clear memory
          </button>
        )}
      </div>

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
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-3 p-3"
      >
        {children}
        {selectionTurn === -1 && selectedReply}
        {messages.length === 0 && !children && !reply && (
          <div className="flex items-start gap-2 max-w-[95%]">
            <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 border border-emerald-500/30 bg-emerald-500/10 shadow-2xs mt-0.5">
              <img
                src="/images/copilot-avatar-blinking.gif"
                alt="Copilot"
                className="w-full h-full object-cover select-none pointer-events-none"
              />
            </div>
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
                    <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 border border-emerald-500/30 bg-emerald-500/10 shadow-2xs mt-0.5">
                      <img
                        src="/images/copilot-avatar-blinking.gif"
                        alt="Copilot"
                        className="w-full h-full object-cover select-none pointer-events-none"
                      />
                    </div>
                  )}
                  <div
                    className={cn(
                      "rounded-xl px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words",
                      m.role === "user"
                        ? "rounded-br-sm bg-info-bg text-info"
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
                {m.evaluatedAt && (
                  <details className="mt-1 max-w-[90%] pl-8 text-[11px] text-foreground-secondary">
                    <summary className="cursor-pointer">Evidence details</summary>
                    <p>
                      Checked {formatDateTime(m.evaluatedAt)}. Recheck the decision card before confirming.
                    </p>
                    {m.coverage && <p>Context includes {m.coverage.pairs.included} of {m.coverage.pairs.total} candidate pairs and {m.coverage.exclusions.included} of {m.coverage.exclusions.total} exclusions in this evaluation.</p>}
                  </details>
                )}
              </div>
          {i === selectionTurn && selectedReply}
          </Fragment>
        ))}

        {send.isPending && (
          <div role="status" className="flex items-center gap-2 max-w-[95%]">
            <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 border border-emerald-500/30 bg-emerald-500/10 shadow-2xs animate-pulse">
              <img
                src="/images/copilot-avatar-blinking.gif"
                alt="Copilot"
                className="w-full h-full object-cover select-none pointer-events-none"
              />
            </div>
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
        {!completed && !selectedPair && displayedOptions.length > 0 && !send.isPending && messages.length === 0 && <p className="pl-8 text-sm text-foreground-secondary">{displayedOptions.length === 2 ? 'Which would you like to choose: Option 1 or Option 2?' : 'Would you like to choose Option 1?'}</p>}
        {!completed && !selectedPair && messages.length > 0 && !send.isPending && <div className="flex flex-wrap gap-2 pl-8">
          {displayedOptions.map((option,index)=><button key={`${option.vehicleId}:${option.driverId}`} type="button" disabled={disabled}
            onClick={()=>submit(`Option ${index+1}`)} className="rounded-lg border border-border px-3 py-2 text-xs text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">Choose Option {index+1}</button>)}
        </div>}
      </div>

      {/* ── Action Suggestions & Composer ── */}
      {!completed && <div className="shrink-0 border-t border-border bg-surface p-3 space-y-2">
        <div className="flex flex-wrap justify-end gap-1.5">
          {suggestions.map((question) => (
            <button
              key={question}
              type="button"
              disabled={disabled || send.isPending}
              onClick={() => submit(question)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground-secondary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              {question}
            </button>
          ))}
        </div>
        {send.isError && (
          <p role="alert" className="text-xs text-danger">
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
              className="flex h-9 w-9 items-center justify-center rounded-lg text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 cursor-pointer"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>}
    </section>
  );
}
