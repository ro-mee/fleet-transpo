// Shared client-side image helpers. rotateBase64Image was previously copy-pasted
// into the staff driver create/edit pages; it lives here so the driver
// self-service scan upload uses the same rotation behavior.

/**
 * Rotate a base64 image by the given degrees, returning a JPEG data URL.
 * Resolves to the original value when rotation isn't possible (server-side or
 * a broken image), so callers can use it defensively.
 */
export function rotateBase64Image(base64Str, degrees = 90) {
  return new Promise((resolve) => {
    if (!base64Str || typeof window === "undefined") return resolve(base64Str);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      if (degrees === 90 || degrees === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      const ctx = canvas.getContext("2d");
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };
    img.onerror = () => resolve(base64Str);
    img.src = base64Str;
  });
}
