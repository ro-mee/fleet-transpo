import { createAdminClient } from "@/lib/supabase/admin";
import { v4 as uuidv4 } from "uuid";
import { validateImage } from "@/lib/uploads/validator";
import crypto from "crypto";

export async function storeExpenseReceipt(file, driverId, submissionId) {
  if (!file || typeof file === "string") {
    throw new Error("A valid receipt image file is required.");
  }

  const fileBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(fileBuffer);
  const validation = validateImage(file, uint8Array);
  
  if (validation.error) {
    throw new Error(validation.error);
  }

  // Calculate SHA-256 hash of the file
  const hashSum = crypto.createHash('sha256');
  hashSum.update(uint8Array);
  const receipt_sha256 = hashSum.digest('hex');

  const contentType = validation.contentType;
  const suppliedExt = file.name?.split(".").pop()?.toLowerCase();
  const fallbackExt = validation.extension || "jpg";
  
  // Predictable protected namespace: expenses/{driver_id}/{client_submission_id}/receipt.*
  const safeSubmissionId = String(submissionId || uuidv4()).replace(/[^a-zA-Z0-9-]/g, "");
  const fileName = `${driverId}/${safeSubmissionId}/receipt.${suppliedExt || fallbackExt}`;
  const supabase = createAdminClient();

  const { error: uploadError } = await supabase.storage
    .from("expense-receipts")
    .upload(fileName, fileBuffer, {
      contentType,
      upsert: true, // Upsert allowed for idempotency since we are using client_submission_id in path
    });

  if (uploadError) {
    console.error("Supabase expense receipt upload error:", uploadError);
    throw new Error("Failed to upload receipt image.");
  }

  return {
    receipt_storage_key: fileName,
    receipt_sha256,
  };
}

export async function getExpenseReceiptSignedUrl(storageKey) {
  const supabase = createAdminClient();
  // Short-lived signed URL (e.g. 1 hour) for Finance views
  const { data: signedData, error: signedUrlError } = await supabase.storage
    .from("expense-receipts")
    .createSignedUrl(storageKey, 3600);
    
  if (signedUrlError || !signedData?.signedUrl) {
    console.error("Supabase expense receipt signed URL error:", signedUrlError);
    throw new Error("Failed to create a secure receipt URL.");
  }
  
  return signedData.signedUrl;
}
