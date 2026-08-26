const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const FORMATS = {
  "image/jpeg": { extension: "jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": { extension: "png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
};

/**
 * Validates an image file against size and format restrictions.
 * Enforces magic byte signatures for security.
 * 
 * @param {File|Blob} file - The uploaded file object (e.g. from FormData).
 * @param {Uint8Array} [bytes] - Optional byte array of the file contents. If not provided, magic bytes are not checked.
 * @returns {{ error?: string, contentType?: string, extension?: string }}
 */
export function validateImage(file, bytes) {
  const contentType = file.type?.toLowerCase();
  
  if (!contentType || !FORMATS[contentType]) {
    return { error: "Image must be a JPEG or PNG file." };
  }

  if (!file.size || file.size > MAX_BYTES) {
    return { error: "Image must be between 1 byte and 5 MB." };
  }

  const format = FORMATS[contentType];

  if (bytes) {
    const startsWith = (signature, offset = 0) =>
      signature.every((byte, index) => bytes[offset + index] === byte);
      
    if (!startsWith(format.signature)) {
      return { error: "The uploaded file does not match its image type." };
    }
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
