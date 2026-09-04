// Resolve where a driver's notification should deep-link in the mobile app.
//
// The mobile app is driver-only, so this map is one flat reference_type -> tab
// route table. Destinations are tab routes: "/" is the Home tab where new
// dispatches appear for acceptance, "/profile" holds license/credentials for
// expiry alerts. A null target means "no deep link — just mark read".

export function mobileNotificationTarget(notification = {}) {
  const { reference_type: type, reference_id: referenceId } = notification;
  switch (type) {
    case "dispatch":
    case "trip":
      return "/";
    case "driver":
    case "vehicle":
      return "/profile";
    case "incident":
      // Deep-link to the live status screen (timeline + fleet response), not
      // the report form — the driver wants to see "help is on the way", not
      // file another report.
      return referenceId ? `/incident/${referenceId}` : "/submissions";
    default:
      return null;
  }
}