// Destinations of the Home quick-action row, prefetched while Home is idle.
// `/inspection` and `/end-duty` are on the list because the row includes Pre-Shift
// and on-duty End Duty tiles — see the `shortcuts` memo in (tabs)/index.js.
export const QUICK_ACTION_ROUTES = ["/inspection", "/work-schedule", "/submissions", "/incidents", "/fuel-report", "/end-duty"];
