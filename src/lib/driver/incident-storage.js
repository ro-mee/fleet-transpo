import { createAdminClient } from "@/lib/supabase/admin";
import { v4 as uuidv4 } from "uuid";
import { validateImage } from "@/lib/uploads/validator";

export async function storeIncidentPhoto(file, driverId) {
  if (!file || typeof file === "string") {
    throw new Error("A valid incident photo is required.");
  }

  const fileBuffer = await file.arrayBuffer();
  const validation = validateImage(file, new Uint8Array(fileBuffer));

  if (validation.error) {
    throw new Error(validation.error);
  }

  const contentType = validation.contentType;

  const suppliedExt = file.name?.split(".").pop()?.toLowerCase();
  const fallbackExt = validation.extension || "jpg";
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
