// Shared browser/server policy. Personal document data never belongs in the
// public vehicle-images bucket. Server validation also checks the actual bytes.
export const DOCUMENT_KINDS = Object.freeze({
  license_front: { resource: "drivers", bucket: "driver-licenses", label: "Front License", maxBytes: 10 * 1024 * 1024, accept: "image/jpeg,image/png", formats: "JPG or PNG · up to 10MB" },
  license_back: { resource: "drivers", bucket: "driver-licenses", label: "Back License", maxBytes: 10 * 1024 * 1024, accept: "image/jpeg,image/png", formats: "JPG or PNG · up to 10MB" },
  OR_CR: { resource: "vehicles", bucket: "vehicle-documents", label: "OR/CR", maxBytes: 10 * 1024 * 1024, accept: "image/jpeg,image/png,application/pdf", formats: "JPG, PNG or PDF · up to 10MB" },
  Insurance: { resource: "vehicles", bucket: "vehicle-documents", label: "Insurance", maxBytes: 10 * 1024 * 1024, accept: "image/jpeg,image/png,application/pdf", formats: "JPG, PNG or PDF · up to 10MB" },
});
export const UPLOAD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateDocumentFile(file, kind, bytes) {
  const policy = Object.hasOwn(DOCUMENT_KINDS, kind) ? DOCUMENT_KINDS[kind] : null;
  if (!policy) return { error: "Choose a supported document section." };
  if (!file || !file.size) return { error: "Choose a file that is not empty." };
  if (file.size > policy.maxBytes) return { error: `File must be ${policy.maxBytes / 1024 / 1024}MB or smaller.` };
  const type = file.type?.toLowerCase();
  if (!policy.accept.split(",").includes(type)) return { error: `Use ${policy.formats.split(" · ")[0]}.` };
  const formats = {
    "image/jpeg": { extension: "jpg", signature: [255, 216, 255] },
    "image/png": { extension: "png", signature: [137, 80, 78, 71, 13, 10, 26, 10] },
    "application/pdf": { extension: "pdf", signature: [37, 80, 68, 70, 45] },
  };
  const format = formats[type];
  if (bytes && (bytes.length !== file.size || !format.signature.every((v, i) => bytes[i] === v))) {
    return { error: "The file contents do not match its type. Choose a valid scan." };
  }
  return { contentType: type, extension: format.extension };
}

export function formatFileSize(bytes) {
  if (!bytes) return "0 KB";
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export function isPdfDocument(url, contentType) {
  return contentType === "application/pdf" || /^data:application\/pdf[;,]/i.test(url || "") || /\.pdf(?:$|[?#])/i.test(url || "");
}
