import { requireAuth, err } from "@/lib/api/utils";

export async function PUT(req, { params }) {
  await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
  return err("Legacy reservation writes are deprecated. Create/update reservations through the Booking integration flow (POST /api/integration/transport-requests and its lifecycle endpoints).", 410);
}
