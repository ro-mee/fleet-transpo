/**
 * Cargo booking schedule (Release C Task 9).
 *
 * A cargo booking is never just the drive ETA: the window must include
 * loading, securement, unloading and turnaround. A null scheduled arrival
 * extends the estimate by those buffers instead of silently creating a
 * zero-length booking; an unknown drive estimate yields no window at all
 * rather than a fabricated one.
 *
 * Buffer values are conservative policy data with named provenance, not
 * measured timings. Callers may pass site-surveyed buffers; the defaults
 * below apply otherwise and always say which policy they came from.
 */

export const CARGO_HANDLING_DEFAULTS = {
  loadingMin: 30,
  securementMin: 15,
  unloadingMin: 30,
  turnaroundMin: 15,
  provenance: "fleetops-cargo-handling-policy-v1",
};

/** Total handling minutes for a buffer set (defaults when omitted). */
export function cargoHandlingMinutes(buffers = {}) {
  const b = { ...CARGO_HANDLING_DEFAULTS, ...buffers };
  const values = [b.loadingMin, b.securementMin, b.unloadingMin, b.turnaroundMin];
  if (values.some(value => value == null || typeof value === "boolean" || String(value).trim() === "")) return null;
  const parts = values.map(Number);
  if (!parts.every((n) => Number.isFinite(n) && n >= 0)) return null;
  return parts.reduce((sum, n) => sum + n, 0);
}

/**
 * End of a cargo service window.
 *
 * @param {object} p
 * @param {Date|string} p.pickup
 * @param {Date|string|null} p.scheduledArrival dispatcher-planned end (null = estimate it)
 * @param {number|null} p.driveMinutes routed/estimated drive time
 * @param {object} [p.buffers] configured handling buffers with provenance
 * @returns {{ end:Date|null, basis:string, handlingMin:number|null, shortfallMin:number, provenance:string }}
 */
export function cargoServiceEnd({ pickup, scheduledArrival = null, driveMinutes = null, buffers = {} } = {}) {
  const provenance = buffers?.provenance ?? CARGO_HANDLING_DEFAULTS.provenance;
  const handlingMin = cargoHandlingMinutes(buffers);
  const pickupMs = pickup == null ? NaN : new Date(pickup).getTime();
  if (!Number.isFinite(pickupMs)) {
    return { end: null, basis: "unknown-pickup", handlingMin, shortfallMin: 0, provenance };
  }

  const arrivalMs =
    scheduledArrival == null ? NaN : new Date(scheduledArrival).getTime();
  if (scheduledArrival != null && (!Number.isFinite(arrivalMs) || arrivalMs <= pickupMs)) {
    return { end: null, basis: "invalid-arrival", handlingMin, shortfallMin: 0, provenance };
  }
  // A planned end cannot prove that the driving and handling fit without
  // a drive estimate. An unknown drive yields no window.
  // (Number(null) is 0, so absence is checked before coercion.)
  if (driveMinutes === null || driveMinutes === undefined || driveMinutes === "") {
    return { end: null, basis: "unknown-drive", handlingMin, shortfallMin: 0, provenance };
  }
  const drive = Number(driveMinutes);
  if (!Number.isFinite(drive) || drive < 0 || handlingMin == null) {
    return { end: null, basis: "unknown-drive", handlingMin, shortfallMin: 0, provenance };
  }
  const minimumEnd = pickupMs + (drive + handlingMin) * 60_000;
  if (Number.isFinite(arrivalMs)) {
    const shortfallMin = Math.max(0, Math.ceil((minimumEnd - arrivalMs) / 60_000));
    return {
      end: new Date(Math.max(arrivalMs, minimumEnd)),
      basis: shortfallMin > 0 ? "handling-buffered-plan" : "scheduled",
      handlingMin,
      shortfallMin,
      provenance,
    };
  }
  return {
    end: new Date(minimumEnd),
    basis: "handling-buffered-estimate",
    handlingMin,
    shortfallMin: 0,
    provenance,
  };
}
