export const RECEIPT_FRAME = { left: 24, right: 24, top: 0.18, bottom: 0.22 };

export function receiptCropRect(image, preview, frame = RECEIPT_FRAME) {
  if (![image?.width, image?.height, preview?.width, preview?.height].every((value) => Number(value) > 0)) {
    return null;
  }

  const scale = Math.max(preview.width / image.width, preview.height / image.height);
  const offsetX = (image.width * scale - preview.width) / 2;
  const offsetY = (image.height * scale - preview.height) / 2;
  const left = (frame.left + offsetX) / scale;
  const top = (preview.height * frame.top + offsetY) / scale;
  const right = (preview.width - frame.right + offsetX) / scale;
  const bottom = (preview.height * (1 - frame.bottom) + offsetY) / scale;
  const originX = Math.max(0, Math.min(image.width - 1, Math.round(left)));
  const originY = Math.max(0, Math.min(image.height - 1, Math.round(top)));

  return {
    originX,
    originY,
    width: Math.max(1, Math.min(image.width, Math.round(right)) - originX),
    height: Math.max(1, Math.min(image.height, Math.round(bottom)) - originY),
  };
}
