"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatStructuredAddress } from "@/lib/address/structured";
import { isCurrentAddressLookup } from "@/lib/address/lookup-state";
import { isViewableCentre } from "@/lib/address/pin-view";

const LOOKUP_TIMEOUT_MS = 8000;
const MAX_QUERY_LENGTH = 1000;

function safeCandidate(candidate) {
  if (!isViewableCentre(candidate?.centre)) return null;
  return {
    centre: candidate.centre,
    label: typeof candidate.label === "string" ? candidate.label : null,
    precision: typeof candidate.precision === "string" ? candidate.precision : null,
    confidence: Number.isFinite(candidate.confidence) ? candidate.confidence : null,
  };
}

/**
 * Explicit address lookup for the pin map. The complete address is sent to the
 * authenticated server only after the operator presses Find on map. A provider
 * result moves the viewport; it never places or verifies the manual pin.
 */
export function useAddressCentre(value, { enabled = true, hasPin = false } = {}) {
  const query = formatStructuredAddress(value).trim();
  const [answer, setAnswer] = useState(null);
  const controllerRef = useRef(null);
  const currentQueryRef = useRef(query);
  const enoughDetail = Boolean(
    value?.psgcBarangayCode &&
    String(value?.houseBuildingNumber ?? "").trim() &&
    String(value?.streetRoad ?? "").trim()
  );
  const canFind = Boolean(enabled && !hasPin && enoughDetail && query.length <= MAX_QUERY_LENGTH);
  useLayoutEffect(() => {
    currentQueryRef.current = query;
  }, [query]);

  useEffect(() => {
    if (!enabled || answer?.query !== query) {
      controllerRef.current?.abort();
      controllerRef.current = null;
    }
  }, [query, enabled, answer?.query]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const find = useCallback(async () => {
    if (!canFind) return;

    const requestedQuery = query;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    setAnswer({ query: requestedQuery, status: "looking", centre: null, candidate: null, candidates: [] });

    try {
      const response = await fetch("/api/address/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: requestedQuery }),
        signal: controller.signal,
      });
      const data = response.ok ? await response.json() : null;
      if (!isCurrentAddressLookup({
        requestedQuery,
        currentQuery: currentQueryRef.current,
        requestController: controller,
        activeController: controllerRef.current,
      })) return;

      const candidates = Array.isArray(data?.candidates)
        ? data.candidates.map(safeCandidate).filter(Boolean)
        : [];
      if (data?.status === "ambiguous" && candidates.length > 1) {
        setAnswer({
          query: requestedQuery,
          status: "ambiguous",
          centre: null,
          candidate: null,
          candidates,
        });
      } else if (data?.status === "found" && candidates[0]) {
        setAnswer({
          query: requestedQuery,
          status: "found",
          centre: candidates[0].centre,
          candidate: candidates[0],
          candidates: [],
        });
      } else if (data?.status === "empty") {
        setAnswer({ query: requestedQuery, status: "empty", centre: null, candidate: null, candidates: [] });
      } else {
        setAnswer({ query: requestedQuery, status: "unavailable", centre: null, candidate: null, candidates: [] });
      }
    } catch {
      if (isCurrentAddressLookup({
        requestedQuery,
        currentQuery: currentQueryRef.current,
        requestController: controller,
        activeController: controllerRef.current,
      })) {
        setAnswer({ query: requestedQuery, status: "unavailable", centre: null, candidate: null, candidates: [] });
      }
    } finally {
      clearTimeout(timeout);
    }
  }, [canFind, query]);

  const chooseCandidate = useCallback((candidate) => {
    if (answer?.query !== query || answer.status !== "ambiguous") return;
    const selected = answer.candidates?.find((item) => item === candidate);
    if (!selected) return;
    setAnswer({
      query,
      status: "found",
      centre: selected.centre,
      candidate: selected,
      candidates: [],
    });
  }, [answer, query]);

  const currentAnswer = answer?.query === query ? answer : null;
  const status = currentAnswer?.status ?? (answer ? "stale" : "idle");
  return {
    centre: currentAnswer?.centre ?? null,
    candidate: currentAnswer?.candidate ?? null,
    candidates: currentAnswer?.candidates ?? [],
    status,
    canFind,
    find,
    chooseCandidate,
  };
}

export default useAddressCentre;
