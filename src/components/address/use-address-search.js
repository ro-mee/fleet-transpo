"use client";

// Typeahead state for an AddressValidator.
//
// Kept out of the component because three separate hazards live here, and each
// one is invisible in a small amount of code but obvious when the network is
// slow:
//
//   1. RACE — a slow response for "Dep" can land AFTER the response for
//      "Deparo". Without a guard the listbox shows results for a prefix the
//      operator has already typed past. Every request carries an id and a
//      response is discarded unless it is still the newest.
//   2. WASTE — one request per keystroke. Debounced, and any request still in
//      flight is aborted before the next one starts.
//   3. SILENT FAILURE — the provider being down must read as "search is
//      unavailable", never as "no such address". An empty list and a failed
//      request are different facts and are surfaced as different states.
//
// `live: false` (the privacy answer for personal addresses) makes this hook do
// NOTHING on its own. Typing costs no request; the caller triggers `run()`
// explicitly from a [Verify] button.

import { useCallback, useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 300;
// Mirrors MIN_QUERY_LENGTH in the provider. Also enforced server-side, so a
// shorter query that slips through costs nothing.
export const MIN_QUERY_LENGTH = 3;

export function useAddressSearch({ live = false, lat, lon } = {}) {
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  // Monotonic, so a late response can be recognised as superseded regardless of
  // how the network reorders things.
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  /**
   * Run a search now. Returns the suggestions so a caller can await a
   * selection flow directly.
   */
  const run = useCallback(
    async (text) => {
      const query = String(text ?? "").trim();
      if (query.length < MIN_QUERY_LENGTH) {
        abortRef.current?.abort();
        setSuggestions([]);
        setSearching(false);
        setError(null);
        return [];
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++requestIdRef.current;

      setSearching(true);
      setError(null);

      try {
        const params = new URLSearchParams({ q: query });
        // Only sent as a pair. A lone bias would be read as `Number(null) === 0`
        // downstream and pin results to the wrong hemisphere.
        if (lat != null && lat !== "" && lon != null && lon !== "") {
          params.set("lat", String(lat));
          params.set("lon", String(lon));
        }

        const response = await fetch(`/api/address/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`search failed (${response.status})`);
        const payload = await response.json();

        // Superseded by a newer keystroke — drop this answer entirely rather
        // than letting it overwrite a fresher list.
        if (requestId !== requestIdRef.current || !mountedRef.current) return [];

        const list = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
        setSuggestions(list);
        setSearching(false);
        return list;
      } catch (e) {
        if (e?.name === "AbortError") return [];
        if (requestId !== requestIdRef.current || !mountedRef.current) return [];
        setSuggestions([]);
        setSearching(false);
        // Distinct from "no matches": the operator needs to know the difference
        // between "this address is not in the map" and "the map is unreachable".
        setError("Unable to search addresses right now. You can still type the address.");
        return [];
      }
    },
    [lat, lon]
  );

  /** Clear results and any error — used when the field is cleared or closed. */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    requestIdRef.current += 1; // orphan any response still in flight
    setSuggestions([]);
    setSearching(false);
    setError(null);
  }, []);

  return { suggestions, searching, error, run, reset };
}

/**
 * Debounced live search, split out so the manual ([Verify]-button) flow pays
 * for none of it.
 *
 * @param {string} query      the current input text
 * @param {boolean} enabled   false for personal addresses — no request on typing
 * @param {(text: string) => Promise<unknown>} run
 * @param {string|null} [skip]  text that was just accepted as a selection; the
 *   effect must not re-search it, or choosing an address would immediately
 *   reopen the listbox on the very string that was picked from it.
 */
export function useDebouncedSearch(query, enabled, run, skip = null) {
  useEffect(() => {
    if (!enabled) return undefined;

    const text = String(query ?? "").trim();
    if (skip && skip === text) return undefined;

    if (text.length < MIN_QUERY_LENGTH) {
      run("");
      return undefined;
    }

    const timer = setTimeout(() => run(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, enabled, run, skip]);
}
