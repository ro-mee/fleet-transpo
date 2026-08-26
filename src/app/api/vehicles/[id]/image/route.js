import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { query } from "@/lib/db";
import { validateImage } from "@/lib/uploads/validator";
import { v4 as uuidv4 } from "uuid";

export async function POST(req, context) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    
    const params = await context.params;
    const vehicleId = Number(params.id);
    if (!Number.isInteger(vehicleId) || vehicleId < 1) {
      return err("A valid vehicle ID is required.", 400);
    }

    const formData = await req.formData();
    const file = formData.get("image");

    if (!file || typeof file === "string") {
      return err("A valid image file is required.", 400);
    }

    const fileBuffer = await file.arrayBuffer();
    const validation = validateImage(file, new Uint8Array(fileBuffer));
    if (validation.error) return err(validation.error, 400);

    const { rows: vehicles } = await query(
      `SELECT vehicle_id FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [vehicleId]
    );
    if (!vehicles.length) return err("Vehicle not found.", 404);

    const supabase = createAdminClient();
    const fileName = `${vehicleId}/${uuidv4()}.${validation.extension}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("vehicle-images")
      .upload(fileName, fileBuffer, {
        contentType: validation.contentType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase Storage Error:", uploadError);
      return err("Failed to upload vehicle image.", 500);
    }

    // Get public URL since bucket is public
    const { data: publicUrlData } = supabase.storage
      .from("vehicle-images")
      .getPublicUrl(fileName);
      
    const imageUrl = publicUrlData?.publicUrl;

    if (!imageUrl) {
      await supabase.storage.from("vehicle-images").remove([fileName]);
      return err("Failed to generate URL for image.", 500);
    }

    try {
      const { rowCount } = await query(
        `UPDATE vehicles SET image_url = $1, updated_at = NOW() WHERE vehicle_id = $2 AND deleted_at IS NULL`,
        [imageUrl, vehicleId]
      );
      if (!rowCount) throw new Error("Vehicle disappeared before image update.");
    } catch (dbError) {
      await supabase.storage.from("vehicle-images").remove([fileName]);
      console.error("Database update error:", dbError);
      return err("Failed to update vehicle record with image.", 500);
    }

    return ok({ image_url: imageUrl });
  } catch (error) {
    return handleError(error);
  }
}
