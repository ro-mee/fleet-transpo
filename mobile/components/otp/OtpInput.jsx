import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Animated, StyleSheet, TextInput, View } from "react-native";
import { useTheme } from "../../lib/theme-context";
import { fonts } from "../../lib/theme";
import { moderateScale } from "../../lib/scaling";
import { OTP_CODE_DIGITS, sanitizeOtpInput } from "../../lib/otp";

/**
 * OtpInput — FleetOps claymorphic multi-cell OTP entry.
 *
 * Six visual cells (matching the 6-digit emailed server challenge) backed by
 * a single `value` string owned by the parent. There is intentionally NO
 * submit affordance here: the parent auto-verifies when `value` is complete.
 *
 * Behavior:
 * - auto-focuses the first cell on mount
 * - typing a digit advances focus; backspace on an empty cell moves back
 * - pasting / SMS autofill distributes across cells from the focused index
 * - non-numeric input is rejected
 * - each entered digit pops (scale 0.92 → 1.04 → 1.0, ~200ms, ease-out)
 * - `shake()` exposes the subtle error shake for the parent state machine
 *
 * Pure React Native Animated API only — no extra native dependencies, so this
 * works identically on the repo's Expo SDK 54 runtime and the SDK 57 docs.
 */
export const OtpInput = forwardRef(function OtpInput(
  {
    value = "",
    onChange,
    length = OTP_CODE_DIGITS,
    disabled = false,
    status = "idle", // 'idle' | 'error' | 'verifying' | 'success'
    autoFocus = true,
    testID,
  },
  ref
) {
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const inputsRef = useRef([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const cursorAnim = useRef(new Animated.Value(1)).current;
  const popAnims = useRef([]);
  if (popAnims.current.length !== length) {
    popAnims.current = Array.from(
      { length },
      (_, i) => popAnims.current[i] || new Animated.Value(1)
    );
  }

  // Active cursor blink when focused on an empty cell.
  useEffect(() => {
    if (focusedIndex >= 0) {
      cursorAnim.setValue(1);
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(cursorAnim, {
            toValue: 0,
            duration: 450,
            useNativeDriver: true,
          }),
          Animated.timing(cursorAnim, {
            toValue: 1,
            duration: 450,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [cursorAnim, focusedIndex]);

  const focusCell = useCallback(
    (index) => {
      const clamped = Math.max(0, Math.min(length - 1, index));
      inputsRef.current[clamped]?.focus();
    },
    [length]
  );

  useImperativeHandle(
    ref,
    () => ({
      focusFirst: () => focusCell(0),
      focusLastFilled: () => focusCell(Math.max(0, Math.min(value.length, length - 1))),
      shake: () => {
        // Subtle horizontal shake: 0 → -6 → +6 → -4 → +4 → 0 over ~350ms.
        shakeAnim.setValue(0);
        Animated.sequence(
          [0, -6, 6, -4, 4, 0].map((toValue) =>
            Animated.timing(shakeAnim, {
              toValue,
              duration: 58,
              useNativeDriver: true,
            })
          )
        ).start();
      },
    }),
    [focusCell, length, shakeAnim, value.length]
  );

  // Auto-focus the first cell once mounted.
  useEffect(() => {
    if (!autoFocus || disabled) return;
    const timer = setTimeout(() => focusCell(0), 350);
    return () => clearTimeout(timer);
  }, [autoFocus, disabled, focusCell]);

  const popCell = useCallback((index) => {
    const anim = popAnims.current[index];
    if (!anim) return;
    anim.setValue(0.92);
    Animated.sequence([
      Animated.timing(anim, {
        toValue: 1.04,
        duration: 110,
        useNativeDriver: true,
      }),
      Animated.timing(anim, {
        toValue: 1.0,
        duration: 110,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const commit = useCallback(
    (next) => {
      onChange?.(next);
    },
    [onChange]
  );

  const handleChange = useCallback(
    (index, text) => {
      if (disabled || status === "verifying" || status === "success") return;
      const clean = sanitizeOtpInput(text, length);
      const digits = value.split("");

      if (clean.length > 1) {
        // Paste / SMS autofill: distribute from the edited cell.
        for (let k = 0; k < clean.length && index + k < length; k += 1) {
          digits[index + k] = clean[k];
        }
        const next = digits.slice(0, length).join("");
        commit(next);
        popCell(Math.min(index + clean.length - 1, length - 1));
        const nextFocus = Math.min(index + clean.length, length - 1);
        requestAnimationFrame(() => focusCell(nextFocus));
        return;
      }

      if (clean.length === 1) {
        digits[index] = clean;
        const next = digits.slice(0, length).join("");
        commit(next);
        popCell(index);
        if (index < length - 1) {
          requestAnimationFrame(() => focusCell(index + 1));
        } else {
          inputsRef.current[index]?.blur();
        }
        return;
      }

      // Empty text: user cleared the cell — drop that digit, keep focus.
      digits[index] = "";
      commit(digits.slice(0, length).join("").replace(/\s/g, ""));
    },
    [commit, disabled, focusCell, length, popCell, status, value]
  );

  const handleKeyPress = useCallback(
    (index, event) => {
      if (disabled) return;
      if (event.nativeEvent.key !== "Backspace") return;
      const digits = value.split("");
      if (digits[index]) {
        // Filled cell: clear it, stay put.
        digits[index] = "";
        commit(digits.slice(0, length).join(""));
      } else if (index > 0) {
        // Empty cell: step back and clear the previous one.
        const prev = index - 1;
        digits[prev] = "";
        commit(digits.slice(0, length).join(""));
        requestAnimationFrame(() => focusCell(prev));
      }
    },
    [commit, disabled, focusCell, length, value]
  );

  const resolveBorderColor = (index, focused, filled) => {
    if (status === "error") return colors.error;
    if (status === "success") return colors.success;
    if (status === "verifying") return colors.primary;
    if (focused) return colors.primary;
    if (filled) {
      return isDark ? "rgba(255,255,255,0.20)" : "rgba(40,84,72,0.32)";
    }
    return isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.09)";
  };

  const resolveCellBg = (focused, filled) => {
    if (status === "error") {
      return isDark ? "rgba(242,163,156,0.10)" : "rgba(168,67,64,0.06)";
    }
    if (status === "success") {
      return isDark ? "rgba(130,190,163,0.12)" : "rgba(40,107,84,0.08)";
    }
    if (focused) {
      return isDark ? colors.surfaceContainerHighest : "rgba(40,84,72,0.04)";
    }
    if (filled) {
      return isDark ? colors.surfaceContainerHigh : colors.surfaceContainerLowest;
    }
    return isDark ? colors.surfaceContainerHigh : colors.surfaceContainerLowest;
  };

  return (
    <View style={styles.container}>
      <Animated.View
        testID={testID}
        accessibilityRole="none"
        style={[styles.row, { transform: [{ translateX: shakeAnim }] }]}
      >
        {Array.from({ length }, (_, index) => {
          const digit = value[index] || "";
          const focused = focusedIndex === index;
          const filled = Boolean(digit);
          const borderColor = resolveBorderColor(index, focused, filled);
          const cellBg = resolveCellBg(focused, filled);
          const showDivider = length === 6 && index === 3;

          return (
            <View key={index} style={styles.cellWrapper}>
              {showDivider && (
                <View style={styles.separator} pointerEvents="none" aria-hidden="true">
                  <View
                    style={[
                      styles.separatorDash,
                      {
                        backgroundColor: isDark
                          ? "rgba(255,255,255,0.25)"
                          : "rgba(0,0,0,0.22)",
                      },
                    ]}
                  />
                </View>
              )}

              <Animated.View
                style={[
                  styles.cellShadow,
                  focused && {
                    shadowColor: colors.primary,
                    shadowOpacity: isDark ? 0.35 : 0.2,
                    shadowRadius: 5,
                    elevation: 3,
                  },
                  { transform: [{ scale: popAnims.current[index] || 1 }] },
                ]}
              >
                <View
                  style={[
                    styles.cell,
                    {
                      backgroundColor: cellBg,
                      borderColor,
                      borderTopColor:
                        focused || status !== "idle"
                          ? borderColor
                          : isDark
                          ? "rgba(255,255,255,0.16)"
                          : "#FFFFFF",
                      borderBottomColor:
                        focused || status !== "idle"
                          ? borderColor
                          : isDark
                          ? "rgba(0,0,0,0.32)"
                          : "rgba(0,0,0,0.10)",
                      opacity: status === "verifying" && !filled ? 0.6 : 1,
                    },
                    focused && styles.cellFocused,
                    status === "error" && styles.cellError,
                    status === "success" && styles.cellSuccess,
                  ]}
                >
                  <TextInput
                    ref={(el) => {
                      inputsRef.current[index] = el;
                    }}
                    value={digit}
                    onChangeText={(text) => handleChange(index, text)}
                    onKeyPress={(event) => handleKeyPress(index, event)}
                    onFocus={() => setFocusedIndex(index)}
                    onBlur={() => setFocusedIndex(-1)}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    importantForAutofill="yes"
                    maxLength={length > 1 ? length : 1}
                    selectTextOnFocus
                    editable={!disabled && status !== "verifying" && status !== "success"}
                    caretHidden
                    textAlign="center"
                    returnKeyType={index === length - 1 ? "done" : "next"}
                    onSubmitEditing={() => {
                      if (index < length - 1) focusCell(index + 1);
                    }}
                    accessibilityLabel={`Digit ${index + 1} of ${length}`}
                    accessibilityHint={
                      index === 0
                        ? "Enter the verification code. Verification starts automatically when all digits are entered."
                        : undefined
                    }
                    style={[
                      styles.cellText,
                      {
                        color:
                          status === "error"
                            ? colors.error
                            : status === "success"
                            ? colors.success
                            : colors.onSurface,
                      },
                    ]}
                  />

                  {/* Pulsing indicator when cell is focused and empty */}
                  {focused && !digit && status === "idle" && (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.cursorPill,
                        {
                          backgroundColor: colors.primary,
                          opacity: cursorAnim,
                        },
                      ]}
                    />
                  )}
                </View>
              </Animated.View>
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: "100%",
    maxWidth: moderateScale(320),
    alignSelf: "center",
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: moderateScale(6),
    width: "100%",
  },
  cellWrapper: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    maxWidth: moderateScale(44),
  },
  separator: {
    position: "absolute",
    left: -moderateScale(12),
    width: moderateScale(12),
    height: moderateScale(48),
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  separatorDash: {
    width: moderateScale(7),
    height: 2,
    borderRadius: 1,
  },
  cellShadow: {
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  cell: {
    width: "100%",
    height: moderateScale(48),
    borderRadius: moderateScale(12),
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderTopWidth: 1.2,
    borderBottomWidth: 1.8,
    position: "relative",
    overflow: "hidden",
  },
  cellFocused: {
    borderWidth: 1.5,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
  },
  cellError: {
    borderWidth: 1.5,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
  },
  cellSuccess: {
    borderWidth: 1.5,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
  },
  cursorPill: {
    position: "absolute",
    width: 2,
    height: moderateScale(20),
    borderRadius: 1,
    alignSelf: "center",
  },
  cellText: {
    width: "100%",
    height: "100%",
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: moderateScale(22),
    fontFamily: fonts.dataSemiBold,
    padding: 0,
    paddingVertical: 0,
    includeFontPadding: false,
  },
});
