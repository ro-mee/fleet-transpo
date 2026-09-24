// mobile/lib/otp-cell-style.js

/**
 * OTP_DASH — geometry for the 3|4 group separator.
 *
 * The bug this replaces: the row used `gap: 6` while the separator box was
 * `width: 12` at `left: -12` holding a 7px dash — twice the size of the slot
 * it sits in, so the dash overran cell 3. The box now equals the gap and the
 * dash fits inside it with 0.5px clearance either side.
 *
 * Raw dp; the component wraps each value in `moderateScale()`.
 */
export const OTP_DASH = {
  rowGap: 8,
  separatorLeft: -8,
  separatorWidth: 8,
  dashWidth: 7,
};

/**
 * otpCellFill — recipe B: depth, not hue, carries progress.
 *
 * Filled cells lift (`surfaceContainerLowest` / `surfaceContainerHigh`),
 * empty cells are carved the other way. Error and success keep their
 * pre-existing tints — those are behavioural states, not the progress channel.
 *
 * `focused` is deliberately absent: focus draws the ring and cursor, it must
 * never introduce a third fill colour or the depth channel stops meaning
 * "filled vs empty".
 */
export function otpCellFill({ status, filled, isDark, colors }) {
  if (status === "error") {
    return isDark ? "rgba(242,163,156,0.10)" : "rgba(168,67,64,0.06)";
  }
  if (status === "success") {
    return isDark ? "rgba(130,190,163,0.12)" : "rgba(40,107,84,0.08)";
  }
  if (filled) {
    return isDark ? colors.surfaceContainerHigh : colors.surfaceContainerLowest;
  }
  return isDark ? colors.surfaceContainerLowest : colors.surfaceContainerHigh;
}
