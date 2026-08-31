import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { storeIncidentPhoto } from "@/lib/driver/incident-storage";

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const formData = await req.formData();
    const file = formData.get("photo");

    try {
      const { photoPath, photoUrl } = await storeIncidentPhoto(file, session.user.driverId);
      return ok({ photo_path: photoPath, photo_url: photoUrl }, 201);
    } catch (error) {
      return err(error.message || "Failed to upload incident photo.", 400);
    }
  } catch (error) {
    return handleError(error, "Failed to upload incident photo");
  }
}
