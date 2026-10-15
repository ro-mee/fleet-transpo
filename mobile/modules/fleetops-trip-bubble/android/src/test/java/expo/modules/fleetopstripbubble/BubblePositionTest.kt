package expo.modules.fleetopstripbubble

import org.junit.Assert.assertEquals
import org.junit.Test

class BubblePositionTest {
  @Test fun snapsLeftBeforeMidpoint() {
    assertEquals(0, BubblePosition.snapX(200, 56, 1080))
  }

  @Test fun snapsRightAfterMidpoint() {
    assertEquals(1024, BubblePosition.snapX(800, 56, 1080))
  }

  @Test fun midpointSnapsRight() {
    assertEquals(1024, BubblePosition.snapX(512, 56, 1080))
  }

  @Test fun respectsBothHorizontalInsets() {
    assertEquals(30, BubblePosition.snapX(-100, 56, 1080, 30, 40))
    assertEquals(984, BubblePosition.snapX(2000, 56, 1080, 30, 40))
    assertEquals(984, BubblePosition.clampX(2000, 56, 1080, 30, 40))
    assertEquals(30, BubblePosition.clampX(-100, 56, 1080, 30, 40))
  }

  @Test fun clampsFullBubbleAboveBottomInset() {
    assertEquals(24, BubblePosition.clampY(-100, 24, 1800))
    assertEquals(1800, BubblePosition.clampY(2000, 24, 1800))
    assertEquals(700, BubblePosition.clampY(700, 24, 1800))
  }

  @Test fun tinyBoundsDoNotThrow() {
    assertEquals(30, BubblePosition.clampX(100, 56, 40, 30, 10))
    assertEquals(24, BubblePosition.clampY(100, 24, 10))
  }
}
