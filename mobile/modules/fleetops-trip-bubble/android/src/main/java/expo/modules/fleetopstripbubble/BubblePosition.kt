package expo.modules.fleetopstripbubble

object BubblePosition {
  fun clampX(currentX: Int, bubbleWidth: Int, screenWidth: Int, leftInset: Int = 0, rightInset: Int = 0): Int =
    currentX.coerceIn(leftInset, (screenWidth - rightInset - bubbleWidth).coerceAtLeast(leftInset))

  fun snapX(currentX: Int, bubbleWidth: Int, screenWidth: Int, leftInset: Int = 0, rightInset: Int = 0): Int {
    val right = (screenWidth - rightInset - bubbleWidth).coerceAtLeast(leftInset)
    return if (currentX < leftInset + (right - leftInset) / 2) leftInset else right
  }

  fun clampY(currentY: Int, topInset: Int, bottomLimit: Int): Int =
    currentY.coerceIn(topInset, bottomLimit.coerceAtLeast(topInset))
}
