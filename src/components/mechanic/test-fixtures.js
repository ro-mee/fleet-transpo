// Shared canned payloads for the mechanic Workshop tests.
//
// Shapes mirror the locked backend contracts verbatim:
// - summary rows: { maintenance_id, vehicle_id, maintenance_type,
//   maintenance_date, status, priority, diagnosis, ageMinutes,
//   source_inspection_id, source_incident_id,
//   vehicle: { plate_number, vehicle_name } }
// - lean list rows: MT_LIST_SELECT + assigned_mechanic_id
// - problems: listVehicleProblems shape()
// - predictive rows: predictVehicle shape() ({ predictions, summary } envelope
//   from GET /api/ai/predictive-maintenance)

export function summaryJob(overrides = {}) {
  return {
    maintenance_id: 7,
    vehicle_id: 12,
    maintenance_type: "Brake Service",
    maintenance_date: "2026-10-06",
    status: "Scheduled",
    priority: "High",
    diagnosis: "Worn brake pads, rotor scoring on the front axle.",
    ageMinutes: 125,
    source_inspection_id: 31,
    source_incident_id: null,
    vehicle: { plate_number: "ABC 1234", vehicle_name: "Toyota Hiace" },
    ...overrides,
  };
}

export function summaryPayload(overrides = {}) {
  const queue = [
    summaryJob(),
    summaryJob({
      maintenance_id: 9,
      maintenance_type: "Oil Change",
      status: "In Progress",
      priority: "Normal",
      diagnosis: null,
      ageMinutes: 40,
      source_inspection_id: null,
      source_incident_id: 18,
      vehicle: { plate_number: "XYZ 9876", vehicle_name: "Nissan Urvan" },
    }),
  ];
  return {
    counts: { assigned: 3, inProgress: 1, waitingApproval: 1, urgent: 1, overdue: 0 },
    upNext: queue[0],
    queue,
    attention: [
      {
        id: 51,
        title: "Work order assigned",
        message: "Brake Service for ABC 1234 is now on your line.",
        type: "Info",
        reference_type: "mechanic_maintenance",
        reference_id: 7,
        created_at: "2026-10-06T06:00:00Z",
        is_read: false,
      },
    ],
    upcoming: [],
    ...overrides,
  };
}

export function emptySummary() {
  return {
    counts: { assigned: 0, inProgress: 0, waitingApproval: 0, urgent: 0, overdue: 0 },
    upNext: null,
    queue: [],
    attention: [],
    upcoming: [],
  };
}

export function leanRow(overrides = {}) {
  return {
    maintenance_id: 7,
    vehicle_id: 12,
    maintenance_type: "Brake Service",
    maintenance_date: "2026-10-06",
    completed_date: null,
    status: "Scheduled",
    priority: "High",
    cost: 4500,
    mileage_at_service: 87250,
    description: "Grinding noise when braking downhill.",
    remarks: null,
    created_at: "2026-10-05T08:00:00Z",
    source_incident_id: null,
    vehicles: { plate_number: "ABC 1234", vehicle_name: "Toyota Hiace" },
    assigned_mechanic_id: 77,
    ...overrides,
  };
}

export function problemItem(overrides = {}) {
  return {
    inspectionId: 31,
    vehicleId: 12,
    plateNumber: "ABC 1234",
    vehicleName: "Toyota Hiace",
    driverName: "Juan Dela Cruz",
    inspectionType: "Post-Shift",
    inspectionDate: "2026-10-05",
    status: "Reported",
    severity: null,
    severityLabel: "Not assessed",
    report: { kind: "free_text", text: "Grinding noise when braking downhill." },
    workOrderId: 7,
    workOrderStatus: "Scheduled",
    bucket: "tracked",
    ...overrides,
  };
}

// One predictVehicle row: mechanic-scoped, endpoint sort order
// (effectiveDays ascending, unscheduled last).
export function predictiveItem(overrides = {}) {
  return {
    vehicle_id: 21,
    plate_number: "DEF 4567",
    vehicle_name: "Toyota Coaster",
    mileage: 91200,
    next_service_date: "2026-10-09",
    next_service_mileage: null,
    last_service_date: "2026-07-10",
    risk: "critical",
    score: 22,
    basis: "time",
    confidence: "high",
    daysToService: 3,
    kmToService: null,
    kmPerDay: 0,
    projectedDaysToService: null,
    effectiveDays: 3,
    recommendation: "Service due in 3 days — schedule it this week.",
    ...overrides,
  };
}

// GET /api/ai/predictive-maintenance envelope: two actionable rows
// (overdue + due-soon), one far-out row and one unscheduled row that the
// page-level filter must drop.
export function predictivePayload(overrides = {}) {
  const predictions = [
    predictiveItem({
      vehicle_id: 22,
      plate_number: "GHI 8901",
      vehicle_name: "Mitsubishi Rosa",
      risk: "overdue",
      basis: "mileage",
      effectiveDays: -3,
      recommendation: "Service mileage exceeded — ground the vehicle and service it now.",
    }),
    predictiveItem(),
    predictiveItem({
      vehicle_id: 23,
      plate_number: "JKL 2345",
      vehicle_name: "Ford Transit",
      risk: "medium",
      basis: "time",
      effectiveDays: 60,
      recommendation: "Service due in 60 days.",
    }),
    predictiveItem({
      vehicle_id: 24,
      plate_number: "MNO 6789",
      vehicle_name: "Isuzu NPR",
      risk: "low",
      basis: null,
      confidence: "low",
      daysToService: null,
      effectiveDays: null,
      next_service_date: null,
      recommendation: "No service schedule set — add a next service date or mileage to predict this vehicle.",
    }),
  ];
  return {
    predictions,
    summary: {
      overdue: 1,
      critical: 1,
      high: 0,
      medium: 1,
      low: 1,
      total: 4,
      unscheduled: 1,
    },
    ...overrides,
  };
}
