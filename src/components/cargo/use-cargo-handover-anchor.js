"use client";

import { useEffect, useRef } from "react";

// Next's initial fragment scroll can run before the trip/cargo queries mount.
// Follow an explicit signature link after loading, including unavailable records.
export function useCargoHandoverAnchor(tripId, isLoading) {
  const section = useRef(null);
  const handledTrip = useRef(null);
  useEffect(() => {
    if (isLoading) return;
    function follow() {
      if (window.location.hash !== "#cargo-chain-of-custody") {
        handledTrip.current = null;
        return;
      }
      if (handledTrip.current === tripId || !section.current) return;
      const target = section.current.querySelector("#cargo-chain-of-custody") || section.current;
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
      handledTrip.current = tripId;
    }
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [tripId, isLoading]);
  return section;
}
