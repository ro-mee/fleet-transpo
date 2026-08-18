/**
 * SwipeButton — Awwwards-tier, Impeccable + High-End Visual Design
 *
 * Architecture:
 *   Outer Shell (Double-Bezel): semi-transparent ring wrapper, large radius
 *   Inner Track: solid primary pill — the swipe surface
 *   Thumb: machined white circle — floats above with real shadow depth
 *   Success Overlay: glass/frosted transparent layer — fades in, never opaque
 *
 * All animations: transform + opacity only (GPU-safe, useNativeDriver:true)
 */
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme-context';
import { fonts } from '../lib/theme';

const TRACK_HEIGHT  = 56;
const THUMB_SIZE    = 46;
const THUMB_MARGIN  = 5;
const THRESHOLD     = 0.48; // 48% — effortless one-handed flick

export default function SwipeButton({
  onSwipeSuccess,
  title,
  backgroundColor,
  textColor,
  icon = 'chevron-forward',
  disabled = false,
}) {
  const { colors } = useTheme();
  const [containerWidth, setContainerWidth] = useState(0);
  const [swiped, setSwiped]                 = useState(false);

  // ─── Refs — panResponder reads these fresh on every event ────────────────
  const swipedRef     = useRef(false);
  const disabledRef   = useRef(disabled);
  const onSuccessRef  = useRef(onSwipeSuccess);
  const maxXRef       = useRef(260);
  const playSuccessRef = useRef(null);

  useEffect(() => { disabledRef.current = disabled;       }, [disabled]);
  useEffect(() => { onSuccessRef.current = onSwipeSuccess; }, [onSwipeSuccess]);
  useEffect(() => {
    if (containerWidth > 0)
      maxXRef.current = containerWidth - THUMB_SIZE - THUMB_MARGIN * 2;
  }, [containerWidth]);

  // ─── Animated values (all useNativeDriver:true) ───────────────────────────
  const thumbX        = useRef(new Animated.Value(0)).current;
  // Success glass overlay
  const glassOpacity  = useRef(new Animated.Value(0)).current;
  const glassScale    = useRef(new Animated.Value(0.82)).current;
  // Label fade
  const labelOpacity  = thumbX.interpolate({
    inputRange: [0, maxXRef.current * 0.28, maxXRef.current],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });
  // Chevron arrow hint — pulses subtly at rest (handled via opacity)
  const thumbScale    = useRef(new Animated.Value(1)).current;

  // The green fill follows the thumb. We use a 2000px wide box shifted way left,
  // and translate it to perfectly align its right edge with the thumb center.
  // This achieves a GPU-accelerated "width" animation without layout thrashing.
  const fillTranslate = Animated.add(thumbX, THUMB_MARGIN + (THUMB_SIZE / 2));

  // Fade the fill out completely at rest so it's not visible under the glass thumb
  const fillOpacity = thumbX.interpolate({
    inputRange: [0, 20],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // ─── Success animation (glass overlay, not opaque) ────────────────────────
  const playSuccess = () => {
    Animated.parallel([
      Animated.timing(glassOpacity, {
        toValue: 1, duration: 260,
        useNativeDriver: true,
      }),
      Animated.spring(glassScale, {
        toValue: 1, bounciness: 10, speed: 16,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(glassOpacity, { toValue: 0, duration: 320, useNativeDriver: true }),
          Animated.timing(thumbX,       { toValue: 0, duration: 320, useNativeDriver: true }),
        ]).start(() => {
          glassScale.setValue(0.82);
          swipedRef.current = false;
          setSwiped(false);
        });
      }, 900);
    });
  };

  useEffect(() => { playSuccessRef.current = playSuccess; });

  // ─── PanResponder ─────────────────────────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder:         () => !disabledRef.current && !swipedRef.current,
      onStartShouldSetPanResponderCapture:  () => !disabledRef.current && !swipedRef.current,
      onMoveShouldSetPanResponder:          () => !disabledRef.current && !swipedRef.current,
      onMoveShouldSetPanResponderCapture:   () => !disabledRef.current && !swipedRef.current,

      onPanResponderGrant: () => {
        // Micro-scale press feedback — GPU-only
        Animated.spring(thumbScale, { toValue: 0.93, useNativeDriver: true, speed: 30, bounciness: 0 }).start();
      },

      onPanResponderMove: (_, g) => {
        if (swipedRef.current) return;
        const clamped = Math.max(0, Math.min(g.dx, maxXRef.current));
        thumbX.setValue(clamped);
        // Release press scale as thumb moves
        if (g.dx > 4) thumbScale.setValue(1);
      },

      onPanResponderRelease: (_, g) => {
        if (swipedRef.current) return;
        thumbScale.setValue(1);
        const max = maxXRef.current;

        if (g.dx >= max * THRESHOLD || g.vx >= 0.6) {
          // Velocity-aware: a fast flick triggers even if distance < threshold.
          // Fire success IMMEDIATELY (in parallel with the thumb spring) so the
          // next screen transition starts instantly instead of waiting ~1s for
          // the animation to settle.
          swipedRef.current = true;
          setSwiped(true);
          Animated.spring(thumbX, {
            toValue: max, bounciness: 0, speed: 22, useNativeDriver: true,
          }).start();
          if (onSuccessRef.current) onSuccessRef.current();
          if (playSuccessRef.current) playSuccessRef.current();
        } else {
          // Satisfying elastic snap-back
          Animated.spring(thumbX, {
            toValue: 0, bounciness: 12, speed: 16, useNativeDriver: true,
          }).start();
        }
      },

      onPanResponderTerminate: () => {
        thumbScale.setValue(1);
        if (swipedRef.current) return;
        Animated.spring(thumbX, { toValue: 0, bounciness: 8, useNativeDriver: true }).start();
      },
    })
  ).current;

  const bg = backgroundColor || colors.primary;
  const fg = textColor       || colors.onPrimary;

  return (
    /* ── Outer Shell: Double-Bezel ring ──────────────────────────────────── */
    <View style={[styles.outerShell, { borderColor: `${bg}40` }]}>

      {/* ── Inner Track: machined primary pill ────────────────────────────── */}
      <View
        style={[styles.track, { backgroundColor: disabled ? colors.surfaceContainerHighest : bg, opacity: disabled ? 0.55 : 1 }]}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >

        {/* Subtle inset highlight — top edge gleam */}
        <View style={styles.insetHighlight} pointerEvents="none" />

        {/* ── Dynamic Green Fill ── */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0, bottom: 0,
            left: -2000,
            width: 2000,
            // Premium Emerald Green — translucent so it overlays nicely
            backgroundColor: 'rgba(16, 185, 129, 0.65)', 
            opacity: fillOpacity,
            transform: [{ translateX: fillTranslate }],
          }}
        />

        {/* Label — padded to the right so it never sits under the thumb at rest */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.labelWrap, { opacity: labelOpacity }]}>
          <Text style={[styles.label, { color: fg }]} numberOfLines={1}>{title}</Text>
        </Animated.View>

        {/* ── Thumb (drag handle) ─────────────────────────────────────────── */}
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.thumb,
            {
              transform: [{ translateX: thumbX }, { scale: thumbScale }],
              width:  THUMB_SIZE,
              height: THUMB_SIZE,
              margin: THUMB_MARGIN,
            },
          ]}
        >
          {/* Inner thumb: icon is white for contrast against the glass thumb */}
          <View style={styles.thumbInner}>
            <Ionicons name={icon} size={22} color="#fff" />
          </View>
        </Animated.View>

        {/* ── Success glass overlay (transparent, not opaque) ─────────────── */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.centred,
            {
              // Frosted glass: semi-transparent white over the primary track
              backgroundColor: 'rgba(255,255,255,0.22)',
              opacity: glassOpacity,
              transform: [{ scale: glassScale }],
              borderRadius: TRACK_HEIGHT / 2,
            },
          ]}
        >
          <View style={[styles.successIconWrap, { borderColor: 'rgba(255,255,255,0.5)' }]}>
            <Ionicons name="checkmark" size={24} color="#fff" />
          </View>
        </Animated.View>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* Double-Bezel outer shell */
  outerShell: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 360,
    borderRadius: (TRACK_HEIGHT / 2) + 6,
    borderWidth: 1.5,
    padding: 4,
    // Outer ambient glow-shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },

  /* Inner machined pill */
  track: {
    width: '100%',
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: 'hidden',
    justifyContent: 'center',
  },

  /* Top-edge inset gleam — 1px white hairline at the top */
  insetHighlight: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: TRACK_HEIGHT / 2,
  },

  centred: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  labelWrap: {
    justifyContent: 'center',
    alignItems: 'center',
    // Push the text to the right of the resting thumb
    paddingLeft: THUMB_SIZE + (THUMB_MARGIN * 2),
    paddingRight: 16,
  },

  label: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  /* Machined thumb — now a translucent glass ring */
  thumb: {
    position: 'absolute',
    left: 0,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    // Lighter shadow for transparent object
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },

  /* Inner thumb: slight inset gradient feel */
  thumbInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: THUMB_SIZE / 2,
  },

  /* Success icon in frosted overlay */
  successIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
