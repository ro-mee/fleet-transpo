export function getDriverDetailUnavailableMessage(errorMessage) {
  if (!errorMessage) return "This driver profile may have been archived or deleted.";
  if (errorMessage === "Driver not found") {
    return "This driver profile is unavailable. It may have been archived, deleted, or the link may be out of date.";
  }
  return errorMessage;
}
