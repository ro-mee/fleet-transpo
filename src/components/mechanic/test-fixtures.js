// Shared canned payloads for the mechanic Workshop tests.
//
// Shapes mirror the locked backend contracts verbatim:
// - summary rows: { maintenance_id, vehicle_id, maintenance_type,
//   maintenance_date, status, priority, diagnosis, ageMinutes,
//   vehicle: { plate_number, vehicle_name } }
// - lean list rows: MT_LIST_SELECT + assigned_mechanic_id
// - problems: listVehicleProblems shape()

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
    service_provider: null,
    service_center: null,
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
