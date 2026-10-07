import {
  COMPLETED_SPECS, DRIVER_SPECS, FUTURE_SPECS, LOCATION_SPECS,
  GUEST, MARK, ROUTE_MEASURES, VEHICLE_SPECS, VIP, WINDOW,
} from "./config.mjs";

const DAY_MS = 86_400_000;
const pad = (n) => String(n).padStart(2, "0");
const time = (day, hour) => `${day}T${pad(Math.floor(hour))}:${pad(Math.round((hour % 1) * 60))}:00+08:00`;
const dayPlus = (day, offset) => new Date(Date.parse(`${day}T12:00:00+08:00`) + offset * DAY_MS).toISOString().slice(0, 10);
const weekday = (day) => new Date(`${day}T12:00:00+08:00`).getUTCDay();
const GUEST_NAMES = [
  "Isabella Cruz", "Miguel Santos", "Sofia Lim", "Daniel Reyes", "Camille Tan",
  "Adrian Mendoza", "Hannah Garcia", "Lorenzo Bautista", "Chloe Navarro", "Gabriel Sy",
  "Natalia Ramos", "Marco Villanueva", "Alyssa Dela Cruz", "Ethan Co", "Bianca Fernandez",
  "Lucas Chua", "Patricia Aquino", "Sebastian Yu", "Mikaela Torres", "Nathan Ong",
  "Andrea Salazar", "Rafael Castillo", "Jasmine Go", "Oliver Chan", "Elena Mercado",
  "Joshua Valdez", "Gabriela Flores", "Benjamin Lee", "Francesca Rivera", "Noah Tan",
  "Clara Santiago", "Alexander Wong", "Isabel Domingo", "Leonardo Tan", "Maya Lopez",
  "Christian Diaz", "Serena David", "Matteo Gonzales", "Nicole Abad", "Samuel Uy",
  "Amelia Santos", "Julian Garcia", "Vivian Cheng", "Diego Cruz", "Olivia Reyes",
];
const guestPhone = (index) => `+63 917 000 ${String(1001 + index).padStart(4, "0")}`;
const BREAK_SLOTS = [
  ["11:30", "12:30"], ["12:00", "13:00"], ["12:30", "13:30"], ["13:00", "14:00"],
];

function makeSchedule(driver, weekdayNumber) {
  const rest = weekdayNumber === driver.index % 7;
  const [breakStart, breakEnd] = BREAK_SLOTS[driver.index % BREAK_SLOTS.length];
  return {
    key: `${driver.key}-W${weekdayNumber}`, driver: driver.key,
    weekday: weekdayNumber, rest,
    start: rest ? "00:00" : "06:00",
    end: rest ? "00:00" : "22:00",
    breakStart: rest ? null : breakStart, breakEnd: rest ? null : breakEnd,
  };
}

export function buildDefensePlan() {
  const drivers = DRIVER_SPECS.map(([key, firstName, lastName, licenseExpiry, years, vehicle], index) => ({
    key, index, firstName, lastName, licenseExpiry, years, vehicle,
    licenseNumber: `DEMO-PH-${pad(index + 1)}-2026`, licenseType: "Professional",
    licenseClass: "B B1", fictional: true,
  }));
  const vehicles = VEHICLE_SPECS.map(([key, category, make, model, variant, year, color, seats, plate, fuel, tankLiters, kmPerLiter], index) => ({
    key, category, make, model, variant, year, color, seats, plate, fuel, tankLiters, kmPerLiter,
    insuranceExpiry: key === "V08" ? "2026-09-20" : "2027-08-31",
    registrationExpiry: "2027-08-31", initialOdometer: 18000 + index * 2700,
    fictional: true,
  }));
  const assignments = drivers.filter((d) => d.vehicle).map((d) => ({ key: `${d.key}-${d.vehicle}`, driver: d.key, vehicle: d.vehicle, active: true }));
  const schedules = drivers.flatMap((d) => Array.from({ length: 7 }, (_, wd) => makeSchedule(d, wd)));
  const leaveBalances = drivers.flatMap((d) => ["Vacation", "Personal", "Medical"].map((type) => ({
    key: `${d.key}-${type}`, driver: d.key, type,
    allocated: type === "Vacation" ? 15 : type === "Personal" ? 5 : 10,
    used: d.key === "D07" && type === "Vacation" ? 2 : 0,
  })));
  const leaveRequests = [
    { key: "L01", driver: "D04", day: WINDOW.defense, endDay: WINDOW.defense, type: "Vacation", status: "Pending", reason: "Family commitment" },
    { key: "L02", driver: "D07", day: WINDOW.defense, endDay: "2026-10-04", type: "Vacation", status: "Approved", reason: "Planned leave" },
    { key: "L03", driver: "D02", day: "2026-09-20", endDay: "2026-09-20", type: "Personal", status: "Declined", reason: "Personal appointment" },
    { key: "L04", driver: "D03", day: "2026-09-13", endDay: "2026-09-13", type: "Medical", status: "Approved", reason: "Medical appointment" },
    { key: "L05", driver: "D05", day: "2026-09-25", endDay: "2026-09-25", type: "Vacation", status: "Approved", reason: "Planned leave" },
    { key: "L06", driver: "D06", day: "2026-10-06", endDay: "2026-10-06", type: "Personal", status: "Pending", reason: "Personal appointment" },
    { key: "L07", driver: "D08", day: "2026-09-22", endDay: "2026-09-22", type: "Medical", status: "Declined", reason: "Medical appointment" },
    { key: "L08", driver: "D10", day: "2026-09-28", endDay: "2026-09-28", type: "Vacation", status: "Approved", reason: "Planned leave" },
    { key: "L09", driver: "D04", day: "2026-09-19", endDay: "2026-09-19", type: "Vacation", status: "Approved", reason: "Historical planned leave; D10 covers V04" },
  ];
  for (const balance of leaveBalances) {
    const approved = leaveRequests.filter((r) => r.driver === balance.driver && r.type === balance.type && r.status === "Approved");
    balance.used = approved.reduce((sum, r) => sum + 1 + Math.round((Date.parse(r.endDay) - Date.parse(r.day)) / DAY_MS), 0);
  }
  const locations = LOCATION_SPECS.map(([key, name, lat, lng]) => ({ key, name, lat, lng }));
  const routes = ROUTE_MEASURES.flatMap(([other, km, minutes]) => [
    { key: `HOTEL-${other}`, origin: "HOTEL", destination: other, km, minutes },
    { key: `${other}-HOTEL`, origin: other, destination: "HOTEL", km, minutes: minutes + 3 },
  ]);
  const routeByPair = new Map(routes.map((r) => [`${r.origin}-${r.destination}`, r]));
  const tripSpecs = [...COMPLETED_SPECS.map((r) => [...r, "Completed"]), ...FUTURE_SPECS.map((r) => [...r, "Assigned"])];
  const trips = tripSpecs.map(([day, driver, vehicle, origin, destination, passengers, hour, status], index) => {
    const route = routeByPair.get(`${origin}-${destination}`);
    if (!route) throw new Error(`Missing route ${origin}-${destination}`);
    const start = time(day, hour);
    const end = new Date(Date.parse(start) + route.minutes * 60_000).toISOString();
    return {
      key: `T${String(index + 1).padStart(3, "0")}`, day, driver, vehicle, origin, destination,
      passengers, start, end, route: route.key, distanceKm: route.km, durationMinutes: route.minutes, status,
      request: `R${String(index + 1).padStart(3, "0")}`, dispatch: `DS${String(index + 1).padStart(3, "0")}`,
    };
  });
  const requests = trips.map((trip, index) => ({
    key: trip.request, trip: trip.key, status: trip.status, day: trip.day,
    pickup: trip.start, origin: trip.origin, destination: trip.destination,
    passengers: trip.passengers, category: vehicles.find((v) => v.key === trip.vehicle).category,
    guestName: GUEST_NAMES[index], guestPhone: guestPhone(index), source: "defense-synthetic",
    created: time(dayPlus(trip.day, -2) < WINDOW.start ? WINDOW.start : dayPlus(trip.day, -2), 7),
  }));
  const extra = ["Pending", "Pending", "Pending", "Pending", "Scheduled", "Scheduled", "Cancelled", "Cancelled"];
  for (const [index, status] of extra.entries()) {
    const key = `R${String(trips.length + index + 1).padStart(3, "0")}`;
    const day = index < 4 ? "2026-10-03" : "2026-10-05";
    requests.push({ key, trip: null, status, day, pickup: time(day, 10 + index), origin: "HOTEL",
      destination: index % 2 ? "T1" : "BGC", passengers: 1 + index % 5,
      category: index % 3 === 0 ? VIP : GUEST, guestName: GUEST_NAMES[trips.length + index],
      guestPhone: guestPhone(trips.length + index),
      source: "defense-synthetic", created: time("2026-10-02", 9 + index),
    });
  }
  const attendance = trips.filter((t, index, all) => t.status === "Completed" && all.findIndex((other) => other.status === "Completed" && other.driver === t.driver && other.day === t.day) === index).map((t) => ({
    key: `A-${t.key}`, day: t.day, driver: t.driver, vehicle: t.vehicle, start: time(t.day, 7), end: time(t.day, 19), status: "Completed",
  }));
  const inspections = [
    ...attendance.flatMap((a) => [
      { key: `SHIFT-${a.key}`, day: a.day, driver: a.driver, vehicle: a.vehicle, trip: null, type: "Pre-Shift", result: "Passed" },
      { key: `POST-${a.key}`, day: a.day, driver: a.driver, vehicle: a.vehicle, trip: null, type: "Post-Shift", result: "Passed" },
    ]),
    ...trips.filter((t) => t.status === "Completed").map((t) => ({
      key: `PRE-${t.key}`, day: t.day, driver: t.driver, vehicle: t.vehicle, trip: t.key, type: "Pre-Trip", result: "Passed",
    })),
  ];
  const completed = trips.filter((t) => t.status === "Completed");
  const fuelRecords = [0, 3, 6, 9, 11, 15, 18, 21, 24, 26, 28, 29].map((tripIndex, index) => ({
    key: `FR${pad(index + 1)}`, trip: completed[tripIndex].key,
    vehicle: completed[tripIndex].vehicle, driver: completed[tripIndex].driver,
    day: completed[tripIndex].day, liters: 20 + index * 2, pricePerLiter: 64,
    status: "Approved", receipt: `FUEL_${pad(index + 1)}`,
  }));
  const fuelRequests = [
    ["D01", "V01", "2026-10-02", "Pending"],
    ["D02", "V02", "2026-10-02", "Approved"],
    ["D03", "V03", "2026-09-16", "Fulfilled"],
    ["D06", "V06", "2026-09-21", "Fulfilled"],
    ["D09", "V09", "2026-09-24", "Rejected"],
  ].map(([driver, vehicle, day, status], index) => ({ key: `FQ${pad(index + 1)}`, driver, vehicle, day, status,
    liters: 18 + index * 2, gauge: `GAUGE_${pad(index + 1)}` }));
  const maintenance = [
    ["V02", "2026-09-04", "Completed", "Routine", 1800],
    ["V03", "2026-09-08", "Completed", "Routine", 2300],
    ["V04", "2026-09-12", "Completed", "Preventive", 3500],
    ["V05", "2026-09-18", "Completed", "Routine", 1950],
    ["V08", "2026-09-22", "Completed", "Preventive", 4200],
    ["V09", "2026-09-29", "Completed", "Routine", 2100],
    ["V02", "2026-10-01", "Completed", "Preventive", 2800],
    ["V03", "2026-10-02", "Completed", "Routine", 1750],
    ["V06", "2026-10-08", "Scheduled", "Preventive", 0],
    ["V10", "2026-10-02", "In Progress", "Repair", 0],
  ].map(([vehicle, day, status, type, cost], index) => ({ key: `M${pad(index + 1)}`, vehicle, day, status, type, cost }));
  const incidents = [
    { key: "I01", driver: "D06", vehicle: "V06", trip: completed[5].key, day: "2026-09-09", severity: "Minor", status: "Resolved", description: "Low-speed parking scrape; no injuries" },
    { key: "I02", driver: "D08", vehicle: "V08", trip: completed[18].key, day: "2026-09-17", severity: "Minor", status: "Resolved", description: "Mirror contact in hotel parking; no injuries" },
    { key: "I03", driver: "D10", vehicle: "V10", trip: null, day: "2026-10-02", severity: "Moderate", status: "Open", description: "Vehicle fault reported in hotel parking; repair in progress" },
  ];
  const expenses = [1, 4, 10, 18, 24, 28].map((tripIndex, index) => ({
    key: `EXP${pad(index + 1)}`, trip: completed[tripIndex].key,
    driver: completed[tripIndex].driver, vehicle: completed[tripIndex].vehicle,
    day: completed[tripIndex].day, category: index % 2 ? "Parking" : "Toll",
    amount: 100 + index * 25, receipt: `EXPENSE_${pad(index + 1)}`, status: index < 4 ? "Approved" : "Pending",
  }));
  return {
    version: 1, marker: MARK, window: WINDOW, drivers, vehicles, assignments, schedules,
    leaveBalances, leaveRequests, locations, routes, requests, trips, attendance, inspections,
    fuelRecords, fuelRequests, maintenance, incidents, expenses,
  };
}
