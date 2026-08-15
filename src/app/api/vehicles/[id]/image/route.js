import { requireAuth, requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { v4 as uuidv4 } from "uuid";

export async function POST(req, context) {
  try {
    // Require any authenticated role
    await requireAuth(req, ["*"]);
    
    const params = await context.params;
    const vehicleId = params.id;
    if (!vehicleId) return err("Vehicle ID is required", 400);

    const formData = await req.formData();
    const file = formData.get("image");

    if (!file || typeof file === "string") {
      return err("A valid image file is required.", 400);
    }

    const supabase = createAdminClient();
    
    // Ensure bucket exists (best effort)
    try {
      await supabase.storage.createBucket("vehicle-images", { public: true });
    } catch (e) {
      // Ignore if it already exists
    }

    const fileBuffer = await file.arrayBuffer();
    const fileExt = file.name ? file.name.split(".").pop() : "jpg";
    const fileName = `${vehicleId}/${uuidv4()}.${fileExt}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("vehicle-images")
      .upload(fileName, fileBuffer, {
        contentType: file.type || "image/jpeg",
        upsert: true,
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
      return err("Failed to generate URL for image.", 500);
    }

    // Update vehicle record with new image
    const { error: dbError } = await supabase
      .from("vehicles")
      .update({ image_url: imageUrl })
      .eq("vehicle_id", vehicleId);

    if (dbError) {
      console.error("Database update error:", dbError);
      return err("Failed to update vehicle record with image.", 500);
    }

    return ok({ image_url: imageUrl });
  } catch (error) {
    return handleError(error, "Failed to upload vehicle image");
  }
}
