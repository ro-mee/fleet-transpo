const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const FORMATS = {
  "image/jpeg": { extension: "jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": { extension: "png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};

/**
 * Validates an image file against size and format restrictions.
 * Enforces magic byte signatures for security.
 *
 * `bytes` is REQUIRED. It used to be optional, with the signature check skipped
 * when it was absent — so the only thing standing between a caller and an
 * arbitrary stored payload was the `Content-Type` they chose themselves. Every
 * in-repo caller already has the buffer in hand and passes it; omitting it now
 * raises rather than silently downgrading the check, so the footgun cannot be
 * walked into from a future call site.
 *
 * @param {File|Blob} file - The uploaded file object (e.g. from FormData).
 * @param {Uint8Array} bytes - The file's bytes, for signature verification.
 * @returns {{ error?: string, contentType?: string, extension?: string }}
 */
export function validateImage(file, bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("validateImage requires the file bytes as a Uint8Array.");
  }

  const contentType = file.type?.toLowerCase();

  if (!contentType || !FORMATS[contentType]) {
    return { error: "Image must be a JPEG or PNG file." };
  }

  if (!file.size || file.size > MAX_BYTES) {
    return { error: "Image must be between 1 byte and 5 MB." };
  }

  const format = FORMATS[contentType];

  const startsWith = (signature, offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);

  if (!startsWith(format.signature)) {
    return { error: "The uploaded file does not match its image type." };
  }

  return { contentType, extension: format.extension };
}

/**
 * Validates a base64 image payload (used for legacy endpoints like license scanning).
 * 
 * @param {string} base64String - Data URI (e.g. data:image/jpeg;base64,...)
 * @returns {{ error?: string, contentType?: string, extension?: string, buffer?: Buffer }}
 */
export function validateBase64Image(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    return { error: "Invalid image payload." };
  }

  const matches = base64String.match(/^data:(image\/(jpeg|png));base64,(.+)$/i);
  if (!matches || matches.length !== 4) {
    return { error: "Image must be a JPEG or PNG data URI." };
  }

  const contentType = matches[1].toLowerCase();
  const format = FORMATS[contentType];
  if (!format) {
    return { error: "Image must be a JPEG or PNG file." };
  }

  const buffer = Buffer.from(matches[3], 'base64');
  
  if (buffer.length > MAX_BYTES) {
    return { error: "Image must be between 1 byte and 5 MB." };
  }

  const bytes = new Uint8Array(buffer);
  const startsWith = (signature, offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
    
  if (!startsWith(format.signature)) {
    return { error: "The uploaded file does not match its image type." };
  }

  return { contentType, extension: format.extension, buffer };
}
