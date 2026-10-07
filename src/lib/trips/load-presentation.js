/**
 * Load presentation for trip surfaces (Release C Task 8).
 *
 * Display mapping ONLY: the internal trip transition graph and DB state names
 * are unchanged. Cargo rows render the consignment and its kilograms — never a
 * guest name and never a "Passengers: 0" fabrication. Passenger and legacy
 * rendering is unchanged.
 *
 * Mirrored at mobile/lib/load-presentation.js (mobile cannot import from
 * src/); the parity test in load-presentation.test.js fails the suite if the
 * two drift apart.
 */

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
