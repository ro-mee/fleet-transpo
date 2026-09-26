// UI mirror of src/lib/inspections/checklists.js (mobile cannot import from
// src/). The ids and their sets must stay in step with that module — the API
// rejects any item_id outside the type's set, so a drift here is a 400 the
// driver sees as a failed submit, not a test failure.
//
// Pre-Shift is the full daily baseline; Pre-Trip is the quick per-trip
// re-check, and its four items are a deliberate subset (the ones that decide
// whether the vehicle is safe to move right now).

export const PRE_SHIFT_CHECKLIST = [
  { id: "cabin", label: "Cabin Cleanliness & Sanitation" },
  { id: "aircon", label: "Air Conditioning & Ventilation" },
  { id: "dashboard", label: "Dashboard Warning Lights", passLabel: "NO LIGHTS", failLabel: "WARNING" },
  { id: "exterior", label: "Exterior & Basic Safety" },
  { id: "brakes", label: "Brake System & Responsiveness" },
  { id: "tires", label: "Tire Pressure & Condition" },
  { id: "fuel", label: "Fuel Level Check" },
];

// Built by mapping the canonical order over the Pre-Shift items rather than
// filtering them, for two reasons: the labels (and the dashboard PASS/FAIL
// wording) stay single-sourced, and the displayed order matches
// PRE_TRIP_ITEMS in src/lib/inspections/checklists.js. A bare `.filter()` would
// keep the labels in step but silently reorder the four to their Pre-Shift
// positions (dashboard, exterior, brakes, tires), which is not the order the
// spec or the server module names.
const PRE_TRIP_IDS = ["dashboard", "brakes", "tires", "exterior"];

export const PRE_TRIP_CHECKLIST = PRE_TRIP_IDS.map((id) =>
  PRE_SHIFT_CHECKLIST.find((item) => item.id === id)
);

export function checklistForMode(mode) {
  return mode === "pretrip" ? PRE_TRIP_CHECKLIST : PRE_SHIFT_CHECKLIST;
}

export function inspectionTypeForMode(mode) {
  return mode === "pretrip" ? "Pre-Trip" : "Pre-Shift";
}
