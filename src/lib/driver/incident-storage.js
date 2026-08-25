import { createAdminClient } from "@/lib/supabase/admin";
import { v4 as uuidv4 } from "uuid";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function storeIncidentPhoto(file, driverId) {
  if (!file || typeof file === "string") {
    throw new Error("A valid incident photo is required.");
  }

  const contentType = file.type || "image/jpeg";
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error("Photo must be a JPEG, PNG, WebP, HEIC, or HEIF image.");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error("Photo must be 10 MB or smaller.");
  }

  const fileBuffer = await file.arrayBuffer();
  const suppliedExt = file.name?.split(".").pop()?.toLowerCase();
  const fallbackExt = contentType.split("/").pop()?.replace("jpeg", "jpg") || "jpg";
  const fileName = `${driverId}/${uuidv4()}.${suppliedExt || fallbackExt}`;
  const supabase = createAdminClient();

  const { error: uploadError } = await supabase.storage
    .from("incident-evidence")
    .upload(fileName, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error("Supabase incident photo upload error:", uploadError);
    throw new Error("Failed to upload incident photo.");
  }

  const { data: signedData, error: signedUrlError } = await supabase.storage
    .from("incident-evidence")
    .createSignedUrl(fileName, 60 * 60 * 24 * 365 * 10);

  if (signedUrlError || !signedData?.signedUrl) {
    console.error("Supabase incident photo signed URL error:", signedUrlError);
    throw new Error("Failed to create a secure photo URL.");
  }

  return {
    fileBuffer,
    contentType,
    photoUrl: signedData.signedUrl,
  };
}
