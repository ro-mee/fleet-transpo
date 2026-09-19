import { createAdminClient } from "@/lib/supabase/admin";
import { v4 as uuidv4 } from "uuid";
import { validateImage } from "@/lib/uploads/validator";
import { isSafeRemoteMediaUrl } from "@/lib/security/remote-url";

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

  const fallbackExt = validation.extension || "jpg";
  const fileName = `${Number(driverId)}/${uuidv4()}.${fallbackExt}`;
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
    .createSignedUrl(fileName, 60 * 60);

  if (signedUrlError || !signedData?.signedUrl) {
    console.error("Supabase incident photo signed URL error:", signedUrlError);
    throw new Error("Failed to create a secure photo URL.");
  }

  return {
    photoPath: fileName,
    photoUrl: signedData.signedUrl,
  };
}

/**
 * Resolve stored object paths only when an authorized detail view requests
 * them. Legacy signed URLs remain readable until their existing expiry.
 *
 * Legacy URLs are re-checked against the fleet-storage allowlist rather than
 * passed through: rows written before the incident endpoint validated its input
 * can hold any absolute URL, and both staff viewers bind whatever comes back to
 * an <img src>, so the reviewing browser — not the server — would be the one
 * calling the attacker's host. A reference that fails the allowlist is dropped
 * rather than returned.
 */
export async function getIncidentPhotoUrls(photoRefs, { expiresIn = 60 * 60 } = {}) {
  if (!Array.isArray(photoRefs) || photoRefs.length === 0) return [];
  const supabase = createAdminClient();
  const urls = [];
  for (const ref of photoRefs) {
    if (typeof ref !== "string" || !ref) continue;
    if (/^https?:\/\//i.test(ref)) {
      if (isSafeRemoteMediaUrl(ref)) urls.push(ref);
      continue;
    }
    const { data, error } = await supabase.storage
      .from("incident-evidence")
      .createSignedUrl(ref, expiresIn);
    if (!error && data?.signedUrl) urls.push(data.signedUrl);
  }
  return urls;
}
