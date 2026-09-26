"use client";

// The viewport centre for the address currently in the picker's form.
//
// WHAT THIS IS FOR, AND WHAT IT IS NOT
// ------------------------------------
// The pin map used to open on the whole Philippines, because nothing in this
// repo can say where a barangay is: the `ph_*` tables are an administrative
// hierarchy with no coordinate column at all (`schema.sql`, `ph_barangays` and
// friends). So the operator found their own street from country zoom.
//
// This asks TomTom Search where the address is and hands back a point to CENTRE
// the view on. It never places the pin. The returned coordinate is viewport
// state and nothing else — it is not written to the form's `latitude`/
// `longitude`, not stored, and not sent to the server. The pin stays something a
// person clicked, which is the whole reason the row records
// `provider = 'manual'` and `verified = false`.
//
// WHY THE BROWSER KEY, AND WHY THAT IS A CHOICE RATHER THAN A SHORTCUT
// -------------------------------------------------------------------
// `TOMTOM_API_KEY` is refused by Search (403, measured 2026-09-27) and fixing
// that is a portal permission grant, not code. The public key searches fine and
// calling it from here exposes no new secret: `rasterTileUrl` already ships that
// same key to the browser on every map render.
//
// The cost is privacy, and it is the reason this is written down rather than
// assumed: the query is a real person's address and this sends it to TomTom from
// the client rather than through our server. The tiles the map already loads
// reveal the area being viewed; this reveals the street and house number. If the
// server key is ever granted Search, the transport swap belongs here and
// nowhere else.
//
// NOTHING HERE IS EVER LOGGED, AND NOTHING CARRIES THE ADDRESS. The request URL
// contains it, so every failure path below sets a status and stops — no message,
// no error object kept, no console call. That is the standing rule for this
// surface: diagnostics print booleans or key NAMES, never a value.

import { useEffect, useRef, useState } from "react";
import { centreFromSearch, searchUrl } from "@/lib/tomtom";
import { formatStructuredAddress } from "@/lib/address/structured";

/**
 * How long a lookup may stay unresolved before it is called unavailable. A
 * hanging request that leaves the map captioned "Finding this address…" forever
 * is worse than a plain failure, because nothing tells the operator to stop
 * waiting.
 */
const LOOKUP_TIMEOUT_MS = 8000;

/**
 * `idle`      nothing to look up (no barangay chosen yet)
 * `looking`   a request is in flight
 * `found`     the map has been centred
 * `empty`     the provider answered, with no match
 * `unavailable` the request failed, timed out, or was refused
 *
 * `empty` and `unavailable` are deliberately not the same state and must never
 * be collapsed into one another: "we looked and there is no such place" and "we
 * could not look" tell the operator to do different things.
 *
 * @param {object} value  a structured address (the form's own value)
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true]  pass the dialog's `open`
 * @param {boolean} [opts.hasPin=false]  a pin already owns the view; do not move it
 * @returns {{centre: {lat: number, lng: number, zoom: number}|null, status: string}}
 */
export function useAddressCentre(value, { enabled = true, hasPin = false } = {}) {
  // The ANSWER we have, AND which barangay it is an answer for.
  //
  // Carrying the code is what lets "still looking" be DERIVED rather than stored.
  // An answer whose code is not the current code has not answered this question
  // yet, so the pending state needs no `setState` at all — which matters,
  // because setting it synchronously from inside the effect is a cascading
  // render, and it would be one for something already knowable from the two
  // values in hand.
  const [answer, setAnswer] = useState({ code: null, centre: null, status: "idle" });

  // The barangay this hook last FIRED FOR — not the last one it saw, and not the
  // last one it got an answer for. It is deliberately not advanced when a lookup
  // is skipped because a pin owns the view, so a lookup that was owed rather
  // than unnecessary still happens once the pin is cleared, instead of being
  // silently marked done.
  const firedFor = useRef(null);
  const controller = useRef(null);

  const code = value?.psgcBarangayCode ?? null;

  useEffect(() => {
    if (firedFor.current === code) return;

    // The barangay was cleared — a city change runs `clearBelow`, which drops
    // the whole chain. Cancel anything in flight; the derived return below is
    // what turns this into "no centre".
    if (!code) {
      firedFor.current = null;
      controller.current?.abort();
      controller.current = null;
      return;
    }

    // A pin already holds the view at `PIN_ZOOM`, and the barangay is picked
    // before the pin step — so this is the re-seed case: an address with a
    // stored pin, reopened. Moving the map out from under a placed pin is the
    // "fighting the control" failure `SyncView` exists to avoid.
    if (!enabled || hasPin) return;

    firedFor.current = code;

    const next = new AbortController();
    controller.current?.abort();
    controller.current = next;
    const timer = setTimeout(() => next.abort(), LOOKUP_TIMEOUT_MS);

    // The query is the address exactly as the row would store it — the same
    // `formatStructuredAddress` the preview and `formatted_address` use, so
    // there is no second string-building routine to drift from it. The barangay
    // pick has already set region and city, so this is worth asking even though
    // the street fields are still empty at the moment this fires.
    const query = formatStructuredAddress(value);

    (async () => {
      try {
        const response = await fetch(searchUrl(query), { signal: next.signal });
        // A newer lookup, or an unmount, has taken over. Whatever this one has
        // to say is about an address the operator has already moved on from, and
        // `setAnswer` would put it back on screen.
        if (controller.current !== next) return;
        if (!response.ok) {
          setAnswer({ code, centre: null, status: "unavailable" });
          return;
        }
        const centre = centreFromSearch(await response.json());
        if (controller.current !== next) return;
        setAnswer(
          centre
            ? { code, centre, status: "found" }
            : { code, centre: null, status: "empty" }
        );
      } catch {
        // Reaching here means the timeout fired or the network failed; a
        // superseded request returned above. Both are "we could not look",
        // never "there is nothing there".
        if (controller.current !== next) return;
        setAnswer({ code, centre: null, status: "unavailable" });
      } finally {
        clearTimeout(timer);
      }
    })();
  }, [value, code, enabled, hasPin]);

  // Unmount only. This must NOT live in the effect above: its cleanup would run
  // on every `value` change and abort the request the effect had just started.
  useEffect(() => () => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  // No barangay: no address to centre on, and nothing in flight.
  if (!code) return { centre: null, status: "idle" };

  // The answer we hold is about a DIFFERENT barangay — one the operator has just
  // moved away from, or none at all. Either way this one is still unanswered, and
  // an empty view is the honest thing to show while it is: nothing here knows
  // where the address is yet. The previous centre is deliberately not carried
  // over, because after an intervening city change it would put the map on the
  // barangay the operator just left before moving it to the new one.
  if (answer.code !== code) return { centre: null, status: "looking" };

  return { centre: answer.centre, status: answer.status };
}

export default useAddressCentre;
