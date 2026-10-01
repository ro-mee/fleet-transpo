// UI mirror of src/lib/inspections/checklists.js (mobile cannot import from
// src/). The ids and their sets must stay in step with that module — the API
// rejects any item_id outside the type's set, so a drift here is a 400 the
// driver sees as a failed submit, not a test failure.

export const PRE_SHIFT_CHECKLIST = [
  {
    id: "sounds",
    shortTitle: "Unusual Sounds",
    icon: "volume-high-outline",
    findingTone: "safety",
    label: "Unusual Sounds",
    question: "Does the vehicle make any unusual sounds?",
    passLabel: "NO UNUSUAL SOUND",
    failLabel: "UNUSUAL SOUND HEARD",
    remarksPrompt: "Describe the unusual sound you heard.",
  },
  {
    id: "lights",
    shortTitle: "Lights & Signals",
    icon: "bulb-outline",
    findingTone: "safety",
    label: "Headlights, Brake & Signal Lights",
    question: "Are the headlights, brake lights, and signal lights working?",
    passLabel: "ALL WORKING",
    failLabel: "ISSUE FOUND",
    remarksPrompt: "Describe which light is not working.",
  },
  {
    id: "dashboard",
    shortTitle: "Dashboard Warning",
    icon: "warning-outline",
    findingTone: "safety",
    label: "Dashboard Warning Lights",
    question: "Are there any critical warning lights on the dashboard?",
    passLabel: "NONE",
    failLabel: "WARNING LIGHT PRESENT",
    remarksPrompt: "Describe the dashboard warning shown.",
  },
  {
    id: "steering",
    shortTitle: "Steering Action",
    icon: "compass-outline",
    findingTone: "safety",
    label: "Steering",
    question: "Is the steering working normally?",
    passLabel: "NORMAL",
    failLabel: "ISSUE FOUND",
    remarksPrompt: "Describe the steering issue.",
  },
  {
    id: "brakes_tires",
    shortTitle: "Brakes & Tires",
    icon: "disc-outline",
    findingTone: "safety",
    label: "Brakes and Tires",
    question: "Are the brakes working properly and the tires in safe condition?",
    passLabel: "SAFE",
    failLabel: "ISSUE FOUND",
    remarksPrompt: "Describe the brake or tire issue.",
  },
];

export const PRE_TRIP_CHECKLIST = [
  {
    id: "brakes_tires",
    section: "Safety",
    shortTitle: "Brakes & Tires",
    icon: "disc-outline",
    findingTone: "safety",
    label: "Safety (Brakes & Tires)",
    question: "Are the brakes working properly and the tires in safe condition?",
    passLabel: "SAFE",
    failLabel: "ISSUE FOUND",
    remarksPrompt: "Please describe the brake or tire issue.",
  },
  {
    id: "passenger_items",
    section: "Passenger Check",
    shortTitle: "Passenger Items",
    icon: "briefcase-outline",
    findingTone: "service",
    label: "Passenger Items Check",
    question: "Are there any items left behind by the previous passenger?",
    passLabel: "NO ITEMS LEFT",
    failLabel: "ITEMS FOUND",
    remarksPrompt: "Describe the items found (e.g., umbrella, bag, wallet).",
  },
  {
    id: "cabin_ready",
    section: "CABIN READY?",
    shortTitle: "Cabin Readiness",
    icon: "sparkles-outline",
    findingTone: "readiness",
    label: "Cabin Ready Acknowledgment",
    kind: "acknowledgment",
    passLabel: "CABIN READY",
    buttonLabel: "✓ CABIN READY",
    reminders: [
      "The cabin is clean and tidy",
      "The air conditioning is working",
      "There are no unpleasant odors",
      "Freshen the cabin if needed",
    ],
    supportingText: "Make sure the vehicle is comfortable and presentable for the next passenger.",
  },
];

export function checklistForMode(mode) {
  return mode === "pretrip" ? PRE_TRIP_CHECKLIST : PRE_SHIFT_CHECKLIST;
}

export function inspectionTypeForMode(mode) {
  return mode === "pretrip" ? "Pre-Trip" : "Pre-Shift";
}
