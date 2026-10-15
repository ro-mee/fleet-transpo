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

  @Test fun zeroSmallWindowInsetsCannotEraseDisplayFrameTopOrBottom() {
    // A safely placed 56px window can report zero relative insets. The system's
    // display frame still begins at 24 and ends above the 48px navigation bar.
    assertEquals(0, BubblePosition.frameY(-100, 56, 24, 1872))
    assertEquals(10, BubblePosition.frameY(10, 56, 24, 1872))
    assertEquals(1792, BubblePosition.frameY(2000, 56, 24, 1872))
    assertEquals(24, 24 + BubblePosition.frameY(-100, 56, 24, 1872))
    assertEquals(1872, 24 + BubblePosition.frameY(2000, 56, 24, 1872) + 56)
  }

  @Test fun landscapeLeftBarUsesFrameLocalOriginOnce() {
    assertEquals(0, BubblePosition.frameX(-100, 56, 48, 1920, false))
    assertEquals(48, 48 + BubblePosition.frameX(100, 56, 48, 1920, true))
    assertEquals(1816, BubblePosition.frameX(2000, 56, 48, 1920, true))
    assertEquals(1920, 48 + BubblePosition.frameX(2000, 56, 48, 1920, false) + 56)
  }

  @Test fun landscapeRightBarAndCutoutRemainOutsideFullBubble() {
    assertEquals(0, BubblePosition.frameX(100, 56, 80, 1872, true))
    assertEquals(1736, BubblePosition.frameX(2000, 56, 80, 1872, false))
    assertEquals(1872, 80 + BubblePosition.frameX(2000, 56, 80, 1872, true) + 56)
    assertEquals(80, 80 + BubblePosition.frameY(-20, 56, 80, 1872))
  }

  @Test fun rotatedFrameReplacesOldPortraitBounds() {
    assertEquals(1792, BubblePosition.frameY(2000, 56, 24, 1872))
    assertEquals(1000, BubblePosition.frameY(2000, 56, 24, 1080))
    assertEquals(1816, BubblePosition.frameX(2000, 56, 48, 1920, true))
  }
}
