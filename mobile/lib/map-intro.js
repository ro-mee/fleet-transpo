export const MAP_INTRO_STAGES = [
  {
    key: "start",
    status: "READY TO START",
    action: "START ROUTE",
    success: "Route started",
  },
  {
    key: "pickup",
    status: "EN ROUTE TO PICKUP",
    action: "ARRIVED AT PICKUP",
    success: "Pickup reached",
  },
  {
    key: "guest",
    status: "AT PICKUP",
    action: "PICKED UP GUEST",
    success: "Guest onboard",
  },
  {
    key: "destination",
    status: "EN ROUTE TO DESTINATION",
    action: "ARRIVED AT DESTINATION",
    success: "Destination reached",
  },
  {
    key: "dropoff",
    status: "ARRIVED AT DESTINATION",
    action: "DROPPED OFF GUEST",
    success: "Drop-off confirmed",
  },
];

export const MAP_INTRO_STAGE_COUNT = MAP_INTRO_STAGES.length;

export function advanceMapIntroStage(currentStage, success) {
  const stage = Number.isInteger(currentStage)
    ? Math.max(0, Math.min(currentStage, MAP_INTRO_STAGE_COUNT))
    : 0;

  if (!success) return stage;
  return Math.min(stage + 1, MAP_INTRO_STAGE_COUNT);
}

export function isMapTabIntent(routeName) {
  return routeName === "map";
}
