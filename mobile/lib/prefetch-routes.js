// Destinations of the Home quick-action row, prefetched while Home is idle.
// `/end-duty` is on the list because the row leads with an End Duty tile while
// the driver is on duty — see the `shortcuts` memo in (tabs)/index.js.
export const QUICK_ACTION_ROUTES = ["/work-schedule", "/submissions", "/incidents", "/fuel-report", "/end-duty"];
