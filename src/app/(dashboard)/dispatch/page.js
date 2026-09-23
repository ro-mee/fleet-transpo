import { redirect } from "next/navigation";

// The status-lane Dispatch Board was removed 2026-09-23: the Reservation
// Queue is the triage desk, and /dispatch/calendar is the schedule view.
// Kept as a route stub so old links, dashboards, and bookmarks land on the
// calendar instead of a 404. NAV_ROLES["/dispatch"] still gates /dispatch/*.
export default function DispatchBoardRedirectPage() {
  redirect("/dispatch/calendar");
}
