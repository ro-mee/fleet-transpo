// The sheet and its restore/controls reserve the same safe area as the tab bar.
export function mapSheetGeometry({ height, top, bottom, content = 0, expanded, minimized, navigationHeight = 0 }) {
  const directionsBottom = Math.max(top, 20) + 10 + navigationHeight + 12;
  const available = Math.max(0, height - bottom - directionsBottom - 64);
  const maxHeight = Math.min(height * .72, available);
  const sheetHeight = minimized ? 0 : expanded ? maxHeight : Math.min(content, maxHeight);
  return { maxHeight, sheetHeight, sheetTop: height - bottom - sheetHeight, restoreBottom: bottom, controlBottom: bottom + (minimized ? 58 : sheetHeight + 10) };
}
