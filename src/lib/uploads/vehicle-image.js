const MAX_BYTES = 5 * 1024 * 1024;

const FORMATS = {
  "image/jpeg": { extension: "jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": { extension: "png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  "image/webp": { extension: "webp", signature: [0x52, 0x49, 0x46, 0x46], suffix: [0x57, 0x45, 0x42, 0x50] },
};

export function validateVehicleImage(file, bytes) {
  const contentType = file.type?.toLowerCase();
  const format = FORMATS[contentType];
  if (!format) return { error: "Image must be a JPEG, PNG, or WebP file." };
  if (!file.size || file.size > MAX_BYTES) {
    return { error: "Image must be between 1 byte and 5 MB." };
  }
  if (!bytes) return { contentType, extension: format.extension };

  const startsWith = (signature, offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (!startsWith(format.signature) || (format.suffix && !startsWith(format.suffix, 8))) {
    return { error: "The uploaded file does not match its image type." };
  }

  return { contentType, extension: format.extension };
}
