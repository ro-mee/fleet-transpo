import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import {
  resolveVehiclePairing,
  vehicleOperationallyAvailable,
  PAIRING_KIND,
} from "@/lib/ai/pair-scoring";
import {
  loadVehicleTravelContext,
  vehicleCanTravel,
} from "@/lib/uvvrp/uvvrp.service";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";

// Pair-coupled availability for the Resource Availability board.
//
// Reports HARD eligibility per vehicle (capacity, operational status, travel
// docs/coding, custodial pairing) using the SAME rule the assignment path
// enforces (`resolveVehiclePairing` + `vehicleOperationallyAvailable`), plus
// every overlapping dispatch in the window as `clashes[]` DATA — never a
// verdict. The board classifies for display: today-mode shows schedule
// activity as "Has trips today"; exact-window mode treats window overlap as
// blocking. Read-only composition — no new rules.
//
// Query:
//   pickup_at / return_at (explicit window from the client),
//   min_capacity (optional seat floor), category_id (optional).
// Response:
//   ready[] = hard-ok (each with clashes[]), blocked[] = hard-blocked
//   (each with clashes[]), unpaired_vehicles[], unassigned_drivers[].
function actionFor({ reason = "", vehicleId, driverId, unpaired }) {
  if (/No substitute driver is assigned/i.test(reason)) {
    return { label: "Assign Substitute", href: `/fleet/assignments?vehicle=${vehicleId}` };
  }
  if (/no designated driver/i.test(reason)) {
    return { label: "Manage Pairing", href: `/fleet/assignments?vehicle=${vehicleId}` };
  }
  if (/Under Maintenance/i.test(reason)) {
    return { label: "View Maintenance", href: `/maintenance?vehicle=${vehicleId}` };
  }
  if (/Registration Expired|registration|insurance|license/i.test(reason)) {
    return vehicleId
      ? { label: "View Compliance", href: `/fleet/vehicles/${vehicleId}` }
      : { label: "View Driver", href: `/drivers/${driverId}` };
  }
  if (/number-coding|coding/i.test(reason)) {
    return { label: "View Exemptions", href: "/uvvrp" };
  }
  if (unpaired) {
    return { label: "Manage Pairings", href: "/fleet/assignments" };
  }
  return null;
}

export async function GET(req) {
  try {
    await requirePermission(req, "dispatch", "read_all");
    const sp = new URL(req.url).searchParams;

    const now = new Date();
    const pickupAt = sp.get("pickup_at") ? new Date(sp.get("pickup_at")) : now;
    const returnAt = sp.get("return_at")
      ? new Date(sp.get("return_at"))
      : new Date(pickupAt.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(pickupAt.getTime()) || Number.isNaN(returnAt.getTime())) {
      return ok({ error: "Invalid pickup_at / return_at" }, 400);
    }
    const minCapacity = sp.get("min_capacity") ? Number(sp.get("min_capacity")) : null;
    const categoryId = sp.get("category_id") ? Number(sp.get("category_id")) : null;

    const [vehiclesRes, driversRes, pairsRes, subsRes, clashesRes] = await Promise.all([
      query(
        `SELECT v.vehicle_id, v.vehicle_name, v.plate_number, v.vehicle_status,
                v.seating_capacity, v.registration_expiry, v.insurance_expiry,
                v.category_id, vc.category_name
           FROM vehicles v
           LEFT JOIN vehiclecategories vc ON vc.category_id = v.category_id
          WHERE v.deleted_at IS NULL
            AND ($1::int IS NULL OR v.category_id = $1::int)
          ORDER BY v.plate_number ASC`,
        [categoryId]
      ),
      query(
        `SELECT d.driver_id, d.driver_status, d.license_expiry,
                e.first_name, e.last_name
           FROM drivers d
           LEFT JOIN employees e ON e.employee_id = d.employee_id
          WHERE d.deleted_at IS NULL
          ORDER BY e.first_name ASC, e.last_name ASC`
      ),
      query(
        `SELECT driver_id, vehicle_id FROM driver_vehicle_assignments WHERE assigned_until IS NULL`
      ),
      query(
        `SELECT vehicle_id, substitute_driver_id, effective_from, effective_until
           FROM substitute_vehicle_schedules`
      ),
      // Half-open overlap against the requested window — the authority on
      // time-specific availability, not the cached status label.
      query(
        `SELECT dispatch_id, dispatch_number, vehicle_id, driver_id, status,
                scheduled_departure, scheduled_arrival
           FROM dispatchschedules
          WHERE deleted_at IS NULL
            AND status = ANY(ARRAY['Scheduled','In Progress'])
            AND scheduled_departure < $2::timestamptz
            AND COALESCE(scheduled_arrival, scheduled_departure + INTERVAL '1 hour') > $1::timestamptz
          ORDER BY scheduled_departure ASC`,
        [pickupAt.toISOString(), returnAt.toISOString()]
      ),
    ]);

    const vehicles = vehiclesRes.rows || [];
    const drivers = driversRes.rows || [];
    const activePairs = pairsRes.rows || [];
    const activeSubstitutes = subsRes.rows || [];
    const clashes = clashesRes.rows || [];

    const vehicleClash = new Map();
    for (const c of clashes) {
      if (c.vehicle_id == null) continue;
      const id = Number(c.vehicle_id);
      if (!vehicleClash.has(id)) vehicleClash.set(id, []);
      vehicleClash.get(id).push(c);
    }
    const driverLoad = new Map();
    for (const c of clashes) {
      if (c.driver_id == null) continue;
      const id = Number(c.driver_id);
      driverLoad.set(id, (driverLoad.get(id) || 0) + 1);
    }

    const driverById = new Map(
      drivers.map((d) => [
        Number(d.driver_id),
        { ...d, _schedule_load: driverLoad.get(Number(d.driver_id)) || 0 },
      ])
    );

    const scheduleCtx = await loadDriverScheduleContext(drivers.map((d) => d.driver_id));
    // Travel-date context (coding / registration / insurance / paired driver).
    // Failure-tolerant: a ctx read error degrades to the pairing-only check.
    let travelCtx = null;
    try {
      travelCtx = await loadVehicleTravelContext(pickupAt);
    } catch (e) {
      console.warn("availability-pairs: travel context skipped:", e.message);
    }

    const ready = [];
    const blocked = [];

    for (const v of vehicles) {
      const vehicleId = Number(v.vehicle_id);
      const seats = Number(v.seating_capacity) || 0;
      // Schedule activity for this vehicle in the window — attached as DATA to
      // every entry, never a verdict here. The board classifies: today-mode
      // shows it as "Has trips today", exact-window mode treats it as blocking.
      const tripClashes = (vehicleClash.get(vehicleId) || []).map(slimClash);

      if (minCapacity && seats > 0 && seats < minCapacity) {
        const reason = `Seats ${seats} — below required ${minCapacity}.`;
        blocked.push({
          vehicle: slimVehicle(v),
          driver: null,
          pairing_kind: PAIRING_KIND.NONE,
          block_reason: reason,
          unpaired: false,
          action: null,
          clashes: tripClashes,
        });
        continue;
      }

      if (!vehicleOperationallyAvailable(v)) {
        const reason = `Vehicle status is ${v.vehicle_status}.`;
        blocked.push({
          vehicle: slimVehicle(v),
          driver: null,
          pairing_kind: PAIRING_KIND.NONE,
          block_reason: reason,
          unpaired: false,
          action: actionFor({ reason, vehicleId }),
          clashes: tripClashes,
        });
        continue;
      }

      if (travelCtx && !vehicleCanTravel({ ...v, vehicle_id: vehicleId }, travelCtx)) {
        const reason = travelBlockReason(v, travelCtx, pickupAt);
        blocked.push({
          vehicle: slimVehicle(v),
          driver: null,
          pairing_kind: PAIRING_KIND.NONE,
          block_reason: reason,
          unpaired: false,
          action: actionFor({ reason, vehicleId }),
          clashes: tripClashes,
        });
        continue;
      }

      // THE shared rule — same function the assign path enforces.
      const pairing = resolveVehiclePairing({
        vehicleId,
        pickupDate: pickupAt,
        activePairs,
        activeSubstitutes,
        driverById,
        now,
        returnAt,
        scheduleContext: scheduleCtx,
      });

      if (!pairing.ok) {
        const unpaired = /no designated driver|no substitute driver is assigned/i.test(
          pairing.reason || ""
        );
        blocked.push({
          vehicle: slimVehicle(v),
          driver: pairing.designated ? slimDriver(pairing.designated) : null,
          pairing_kind: PAIRING_KIND.NONE,
          block_reason: pairing.reason,
          unpaired,
          action: actionFor({ reason: pairing.reason || "", vehicleId, unpaired }),
          clashes: tripClashes,
        });
        continue;
      }

      ready.push({
        vehicle: slimVehicle(v),
        driver: slimDriver(pairing.driver),
        pairing_kind: pairing.kind,
        pairing_note: pairing.kind === PAIRING_KIND.SUBSTITUTE ? pairing.reason : null,
        clashes: tripClashes,
      });
    }

    // Drivers attached to no vehicle (neither custodian nor booked substitute
    // for the date) — shown as a footer count, not a dispatchable resource.
    const pairedDriverIds = new Set(activePairs.map((p) => Number(p.driver_id)));
    for (const s of activeSubstitutes) {
      try {
        const from = new Date(s.effective_from);
        const until = s.effective_until ? new Date(s.effective_until) : null;
        if (pickupAt >= from && (!until || pickupAt <= until)) {
          pairedDriverIds.add(Number(s.substitute_driver_id));
        }
      } catch {
        /* ignore malformed rows */
      }
    }
    const unassignedDrivers = drivers
      .filter((d) => !pairedDriverIds.has(Number(d.driver_id)))
      .map(slimDriver);

    const unpairedVehicles = blocked.filter((b) => b.unpaired);

    return ok({
      window: { pickup_at: pickupAt.toISOString(), return_at: returnAt.toISOString() },
      counts: {
        ready: ready.length,
        blocked: blocked.length,
        unpaired_vehicles: unpairedVehicles.length,
        unassigned_drivers: unassignedDrivers.length,
      },
      ready,
      blocked,
      unpaired_vehicles: unpairedVehicles,
      unassigned_drivers: unassignedDrivers,
    });
  } catch (e) {
    return handleError(e);
  }
}

function slimVehicle(v) {
  return {
    vehicle_id: v.vehicle_id,
    vehicle_name: v.vehicle_name,
    plate_number: v.plate_number,
    vehicle_status: v.vehicle_status,
    seating_capacity: v.seating_capacity,
    category_name: v.category_name ?? null,
  };
}

function slimDriver(d) {
  if (!d) return null;
  const name = [d.first_name, d.last_name].filter(Boolean).join(" ") || `Driver #${d.driver_id}`;
  return {
    driver_id: d.driver_id,
    name,
    driver_status: d.driver_status ?? null,
  };
}

function slimClash(c) {
  return {
    dispatch_id: c.dispatch_id,
    dispatch_number: c.dispatch_number,
    status: c.status ?? null,
    scheduled_departure: c.scheduled_departure,
    scheduled_arrival: c.scheduled_arrival,
  };
}

// Specific, actionable travel-block reason (vehicleCanTravel is boolean-only).
function travelBlockReason(v, ctx, date) {
  const day = date instanceof Date ? date : new Date(date);
  const expired = (val) => {
    if (!val) return false;
    const t = new Date(val).getTime();
    return Number.isFinite(t) && t <= day.getTime();
  };
  if (expired(v.registration_expiry) || expired(v.insurance_expiry)) {
    const which = expired(v.registration_expiry) ? "Registration expired" : "Insurance expired";
    return `${which} — cannot travel on this date.`;
  }
  if (ctx?.policy?.enabled && v.plate_number && !ctx.exemptVehicleIds?.has?.(v.vehicle_id)) {
    return "Number-coding restriction on this date.";
  }
  return "Paired driver cannot travel on this date (license / duty status).";
}
