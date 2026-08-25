import { createAdminClient } from "@/lib/supabase/admin";
import { v4 as uuidv4 } from "uuid";
import { validateImage } from "@/lib/uploads/validator";

export async function storeFuelReceipt(file, driverId, folder = "") {
  if (!file || typeof file === "string") {
    throw new Error("A valid receipt image file is required.");
  }

  const fileBuffer = await file.arrayBuffer();
  const validation = validateImage(file, new Uint8Array(fileBuffer));
  
  if (validation.error) {
    throw new Error(validation.error);
  }

  const contentType = validation.contentType;
  const suppliedExt = file.name?.split(".").pop()?.toLowerCase();
  const fallbackExt = validation.extension || "jpg";
  const safeFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
  const fileName = [driverId, safeFolder, `${uuidv4()}.${suppliedExt || fallbackExt}`].filter(Boolean).join("/");
  const supabase = createAdminClient();

  const { error: uploadError } = await supabase.storage
    .from("fuel-receipts")
    .upload(fileName, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error("Supabase fuel receipt upload error:", uploadError);
    throw new Error("Failed to upload receipt image.");
  }

  const { data: signedData, error: signedUrlError } = await supabase.storage
    .from("fuel-receipts")
    .createSignedUrl(fileName, 60 * 60 * 24 * 365 * 10);

  if (signedUrlError || !signedData?.signedUrl) {
    console.error("Supabase fuel receipt signed URL error:", signedUrlError);
    throw new Error("Failed to create a secure receipt URL.");
  }

  return {
    fileBuffer,
    contentType,
    receiptUrl: signedData.signedUrl,
  };
}

export function isOwnedFuelReceiptUrl(value, driverId) {
  return isOwnedFuelImageUrl(value, driverId);
}

export function isOwnedFuelImageUrl(value, driverId, folder = "") {
  try {
    const url = new URL(value);
    const storageUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const path = decodeURIComponent(url.pathname);
    const safeFolder = String(folder || "").replace(/^\/+|\/+$/g, "");
    const driverPath = safeFolder
      ? `/storage/v1/object/sign/fuel-receipts/${driverId}/${safeFolder}/`
      : `/storage/v1/object/sign/fuel-receipts/${driverId}/`;
    return url.host === storageUrl.host
      && path.includes(driverPath)
      && Boolean(url.searchParams.get("token"));
  } catch {
    return false;
  }
}
