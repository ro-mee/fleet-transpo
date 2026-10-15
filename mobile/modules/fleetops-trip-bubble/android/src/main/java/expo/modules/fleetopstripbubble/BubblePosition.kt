package expo.modules.fleetopstripbubble

object BubblePosition {
  // Legacy window offsets are relative to the safe frame, not the whole display.
  fun frameX(currentX: Int, bubbleWidth: Int, frameLeft: Int, frameRight: Int, snap: Boolean): Int =
    if (snap) snapX(currentX, bubbleWidth, frameRight - frameLeft)
    else clampX(currentX, bubbleWidth, frameRight - frameLeft)

  fun frameY(currentY: Int, bubbleHeight: Int, frameTop: Int, frameBottom: Int): Int =
    clampY(currentY, 0, frameBottom - frameTop - bubbleHeight)

  fun clampX(currentX: Int, bubbleWidth: Int, screenWidth: Int, leftInset: Int = 0, rightInset: Int = 0): Int =
    currentX.coerceIn(leftInset, (screenWidth - rightInset - bubbleWidth).coerceAtLeast(leftInset))

  fun snapX(currentX: Int, bubbleWidth: Int, screenWidth: Int, leftInset: Int = 0, rightInset: Int = 0): Int {
    val right = (screenWidth - rightInset - bubbleWidth).coerceAtLeast(leftInset)
    return if (currentX < leftInset + (right - leftInset) / 2) leftInset else right
  }

  fun clampY(currentY: Int, topInset: Int, bottomLimit: Int): Int =
    currentY.coerceIn(topInset, bottomLimit.coerceAtLeast(topInset))
}
