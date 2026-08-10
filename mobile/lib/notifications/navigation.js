// Resolve where a driver's notification should deep-link in the mobile app.
//
// The mobile app is driver-only, so this map is one flat reference_type -> tab
// route table. Destinations are tab routes: "/" is the Home tab where new
// dispatches appear for acceptance, "/profile" holds license/credentials for
// expiry alerts. A null target means "no deep link — just mark read".

export function mobileNotificationTarget(notification = {}) {
  const { reference_type: type } = notification;
  switch (type) {
    case "dispatch":
    case "trip":
      return "/";
    case "driver":
    case "vehicle":
      return "/profile";
    case "incident":
      return "/incidents";
    default:
      return null;
  }
}