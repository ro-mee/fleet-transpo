import { GUEST, VIP } from "./config.mjs";

const overlaps = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
const weekday = (day) => new Date(`${day}T12:00:00+08:00`).getUTCDay();

export function validateDefensePlan(plan) {
  const errors = [];
  const unique = (rows, name) => {
    const keys = rows.map((r) => r.key);
    if (new Set(keys).size !== keys.length) errors.push(`${name} has duplicate semantic keys`);
  };
  for (const [name, rows] of Object.entries(plan)) if (Array.isArray(rows) && rows.every((r) => r.key)) unique(rows, name);
  if (plan.window.start !== "2026-09-03" || plan.window.end !== "2026-10-02" || plan.window.defense !== "2026-10-03") errors.push("Defense date contract changed");
  if (weekday(plan.window.defense) !== 6) errors.push("Defense day must be Saturday in Manila");
  if (plan.drivers.length !== 10 || plan.vehicles.length !== 10 || plan.requests.length !== 45 || plan.trips.length !== 37) errors.push("Core entity counts changed");
  if (plan.trips.filter((t) => t.status === "Completed").length !== 30 || plan.trips.filter((t) => t.status === "Assigned").length !== 7) errors.push("Trip state counts changed");
  if (plan.schedules.length !== 70 || plan.leaveBalances.length !== 30 || plan.assignments.length !== 9) errors.push("Driver support counts changed");
  const vehicleMap = new Map(plan.vehicles.map((v) => [v.key, v]));
  const driverMap = new Map(plan.drivers.map((d) => [d.key, d]));
  const requestMap = new Map(plan.requests.map((r) => [r.key, r]));
  const scheduleMap = new Map(plan.schedules.map((s) => [`${s.driver}-${s.weekday}`, s]));
  const routeMap = new Map(plan.routes.map((r) => [r.key, r]));
  for (const v of plan.vehicles) {
    if (![VIP, GUEST].includes(v.category)) errors.push(`${v.key} has forbidden category`);
    if (![4, 5, 6, 7].includes(v.seats)) errors.push(`${v.key} has invalid capacity`);
  }
  for (const s of plan.schedules) {
    if (!s.rest && (s.start !== "06:00" || s.end !== "22:00")) errors.push(`${s.key} has wrong working hours`);
  }
  for (const r of plan.requests) {
    const localPickup = r.pickup.slice(11, 16);
    if (localPickup < "06:00" || localPickup >= "22:00") errors.push(`${r.key} pickup outside 06:00–22:00`);
    if (!r.guestName || /demo|test|fixture|seed/i.test(r.guestName)) errors.push(`${r.key} has invalid guest name`);
    if (!/^\+63 9\d{2} \d{3} \d{4}$/.test(r.guestPhone)) errors.push(`${r.key} has invalid Philippine guest phone format`);
  }
  for (const t of plan.trips) {
    const v = vehicleMap.get(t.vehicle), d = driverMap.get(t.driver), r = requestMap.get(t.request);
    if (!v || !d || !r) { errors.push(`${t.key} has broken driver/vehicle/request link`); continue; }
    if (!routeMap.has(t.route)) errors.push(`${t.key} has broken route link`);
    if (t.passengers > v.seats) errors.push(`${t.key} exceeds vehicle capacity`);
    if (r.category !== v.category) errors.push(`${t.key} category mismatch`);
    if (r.status !== t.status || r.trip !== t.key) errors.push(`${t.key} request state mismatch`);
    if (t.status === "Completed" && (t.day < plan.window.start || t.day > plan.window.end)) errors.push(`${t.key} completed outside history window`);
    if (t.status === "Assigned" && t.day < plan.window.defense) errors.push(`${t.key} assigned before defense day`);
    if (t.day > d.licenseExpiry) errors.push(`${t.key} driver license expired`);
    if (t.day > v.insuranceExpiry) errors.push(`${t.key} vehicle insurance expired`);
    if (Date.parse(t.end) <= Date.parse(t.start)) errors.push(`${t.key} has nonpositive duration`);
    const schedule = scheduleMap.get(`${t.driver}-${weekday(t.day)}`);
    if (!schedule || schedule.rest) errors.push(`${t.key} falls on rest day`);
    else {
      const localStart = t.start.slice(11, 16);
      const localEnd = new Date(Date.parse(t.end) + 8 * 3_600_000).toISOString().slice(11, 16);
      if (localStart < schedule.start || localEnd > schedule.end || localEnd > "22:00") errors.push(`${t.key} outside shift`);
      if (localStart < schedule.breakEnd && localEnd > schedule.breakStart) errors.push(`${t.key} crosses break`);
    }
    const approvedLeave = plan.leaveRequests.find((l) => l.driver === t.driver && l.status === "Approved" && l.day <= t.day && t.day <= l.endDay);
    if (approvedLeave) errors.push(`${t.key} conflicts with approved leave ${approvedLeave.key}`);
  }
  for (let i = 0; i < plan.trips.length; i++) for (let j = i + 1; j < plan.trips.length; j++) {
    const a = plan.trips[i], b = plan.trips[j];
    if (a.driver !== b.driver && a.vehicle !== b.vehicle) continue;
    if (overlaps(a, b)) errors.push(`${a.key}/${b.key} overlap`);
  }
  const d1 = plan.trips.filter((t) => t.driver === "D01");
  if (d1.filter((t) => t.status === "Completed").length !== 6 || d1.filter((t) => t.status === "Assigned").length !== 5) errors.push("D01 workload changed");
  if (d1.filter((t) => t.day === plan.window.defense && t.status === "Assigned").length < 2) errors.push("D01 defense schedule incomplete");
  if (plan.leaveRequests.some((l) => l.driver === "D01" && l.day <= plan.window.defense && l.endDay >= plan.window.defense)) errors.push("D01 has defense leave");
  if (!plan.leaveRequests.some((l) => l.driver === "D04" && l.status === "Pending" && l.day === plan.window.defense)) errors.push("D04 pending leave missing");
  if (!plan.leaveRequests.some((l) => l.driver === "D07" && l.status === "Approved" && l.day <= plan.window.defense && l.endDay >= plan.window.defense)) errors.push("D07 approved leave missing");
  for (const [index, driver] of plan.drivers.entries()) {
    if (!scheduleMap.get(`${driver.key}-${index % 7}`)?.rest) errors.push(`${driver.key} staggered rest day missing`);
  }
  const lunchSlots = new Set(plan.schedules.filter((schedule) => !schedule.rest).map((schedule) => `${schedule.breakStart}-${schedule.breakEnd}`));
  if (lunchSlots.size < 4) errors.push("Staggered lunch slots missing");
  if (plan.assignments.some((a) => a.driver === "D10")) errors.push("D10 must stay unpaired");
  if (plan.attendance.some((a) => a.driver === "D01" && a.day === plan.window.defense) || plan.inspections.some((i) => i.driver === "D01" && i.day === plan.window.defense)) errors.push("D01 has fake defense-day evidence");
  if (plan.fuelRecords.length !== 12 || plan.fuelRequests.length !== 5 || plan.maintenance.length !== 10 || plan.incidents.length !== 3 || plan.expenses.length !== 6) errors.push("Operations counts changed");
  for (const row of [...plan.fuelRecords, ...plan.expenses, ...plan.incidents.filter((i) => i.trip)]) {
    if (!plan.trips.some((t) => t.key === row.trip && t.status === "Completed")) errors.push(`${row.key} lacks completed trip`);
  }
  if (plan.fuelRecords.some((r) => r.day < plan.window.start || r.day > plan.window.end)) errors.push("Fuel history outside window");
  if (plan.maintenance.some((m) => m.status === "Scheduled" && m.cost !== 0)) errors.push("Future maintenance has incurred cost");
  return errors;
}
