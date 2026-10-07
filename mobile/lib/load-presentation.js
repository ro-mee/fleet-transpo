// Mirror of src/lib/trips/load-presentation.js (mobile cannot import from
// src/, following the inspection-checklist mirror pattern). Byte-identical
// display contract — the parity test in
// src/lib/trips/load-presentation.test.js fails the suite on any drift.
// Uses no Expo SDK APIs (pure JS), so the installed-vs-v57 SDK discrepancy
// does not affect this module.

/** True only for the explicit Cargo load type. Legacy rows stay passenger. */
export function isCargoLoad(row) {
  return row?.load_type === "Cargo";
}

/** Card/detail title: consignment for cargo, guest name otherwise. */
export function loadTitle(row) {
  if (isCargoLoad(row)) {
    const description = String(row?.cargo_description ?? "").trim();
    return description || "Cargo consignment";
  }
  const name = String(row?.guest_name ?? row?.passenger_name ?? "").trim();
  return name || "Guest";
}

/**
 * Card/detail subtitle: kilograms for cargo (null when honestly unknown),
 * passenger count otherwise. Null is not a fabrication — callers hide the
 * line when it is null.
 */
export function loadSubtitle(row) {
  if (isCargoLoad(row)) {
    const weight = Number(row?.cargo_weight_kg);
    return Number.isFinite(weight) && weight > 0 ? `${weight} kg declared` : null;
  }
  const count = row?.passenger_count;
  if (count === null || count === undefined) return null;
  return `${count} passenger${Number(count) === 1 ? "" : "s"}`;
}

/**
 * Display label for an internal trip status. Cargo maps the two
 * load-conditioned states; every other state — and every passenger or legacy
 * row — renders unchanged.
 */
export function tripStatusLabel(tripStatus, loadType) {
  if (loadType === "Cargo") {
    if (tripStatus === "Passenger Onboard" || tripStatus === "PASSENGER_ONBOARD") return "Cargo Loaded";
    if (tripStatus === "Drop-off" || tripStatus === "DROP_OFF") return "At Delivery";
  }
  return tripStatus;
}
