/**
 * AppAlert — Shared accessible native alert modal
 *
 * Drop-in replacement for React Native's Alert.alert()
 * Preserves the imperative alert and dismissal contracts.
 *
 * Usage:
 *   // Imperative (like Alert.alert):
 *   AppAlert.alert("Title", "Message", [{ text: "OK", onPress: () => {} }]);
 *   AppAlert.alert("Error", "Something went wrong", null, { type: 'error' });
 *
 *   // Mount once in your root layout:
 *   <AppAlertHost />
 */
import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable, Modal,
  Platform, ScrollView, useWindowDimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme-context';
import { fonts } from '../lib/theme';
import { useReducedMotion } from '../lib/use-reduced-motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Singleton event emitter ───────────────────────────────────────────────
let _showAlert = null;

const AppAlertEmitter = {
  show: (title, message, buttons, options) => {
    if (_showAlert) _showAlert({ title, message, buttons, options });
  },
};

// ─── Preset icon maps ──────────────────────────────────────────────────────
// Tones map to theme tokens (colors[tone]); the chip/border/aura alphas are
// derived at render time so dark mode gets the palette's own hues instead of
// a foreign pasted-in palette.
const ICON_MAP = {
  error: {
    tone: 'danger',
    render: (color) => (
      <Ionicons name="close-circle" size={32} color={color} />
    ),
  },
  success: {
    tone: 'success',
    render: (color) => (
      <Ionicons name="checkmark-circle" size={32} color={color} />
    ),
  },
  warning: {
    tone: 'warning',
    render: (color) => (
      <Ionicons name="alert-circle" size={32} color={color} />
    ),
  },
  info: {
    tone: 'info',
    render: (color) => (
      <Ionicons name="information-circle" size={32} color={color} />
    ),
  },
};

function deriveIcon(title = '', options = {}) {
  if (options?.type && ICON_MAP[options.type]) return ICON_MAP[options.type];
  const t = title.toLowerCase();
  if (/error|fail|cannot|denied|blocked|invalid|unauthorized|unable/.test(t)) return ICON_MAP.error;
  if (/success|complete|saved|done|updated|passed/.test(t)) return ICON_MAP.success;
  if (/warn|missing|required|incomplete|attention|alert|check/.test(t)) return ICON_MAP.warning;
  return ICON_MAP.info;
}

function notifyDismissed(alert) {
  if (!alert || alert.dismissed) return;
  alert.dismissed = true;
  alert.config.options?.onDismiss?.();
}

// ─── Host component — mount once in your root layout ──────────────────────
export function AppAlertHost() {
  const { colors, type } = useTheme();
  const reducedMotion = useReducedMotion();
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [config, setConfig]   = useState(null);
  const activeAlertRef = useRef(null);

  // Stable animated values preserve replacement and dismissal behavior.
  const [backdropOpacity] = useState(() => new Animated.Value(0));
  const [cardScale] = useState(() => new Animated.Value(0.98));
  const [cardOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    _showAlert = (cfg) => {
      const previous = activeAlertRef.current;
      const alert = { config: cfg, dismissing: false, dismissed: false };
      activeAlertRef.current = alert;
      notifyDismissed(previous);
      if (activeAlertRef.current !== alert) return;
      setConfig(cfg);
      setVisible(true);
      backdropOpacity.stopAnimation();
      cardScale.stopAnimation();
      cardOpacity.stopAnimation();
      if (reducedMotion) {
        backdropOpacity.setValue(1);
        cardScale.setValue(1);
        cardOpacity.setValue(1);
        return;
      }
      backdropOpacity.setValue(0);
      cardScale.setValue(0.98);
      cardOpacity.setValue(0);

      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.timing(cardScale, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    };
    return () => { _showAlert = null; };
  }, [backdropOpacity, cardScale, cardOpacity, reducedMotion]);

  const dismiss = (onPress) => {
    const alert = activeAlertRef.current;
    if (!alert || alert.config !== config || alert.dismissing || alert.dismissed) return;
    alert.dismissing = true;
    const finish = () => {
      if (activeAlertRef.current !== alert || alert.dismissed) return;
      activeAlertRef.current = null;
      setVisible(false);
      try { if (onPress) onPress(); }
      finally { notifyDismissed(alert); }
    };
    if (reducedMotion) { finish(); return; }
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(finish);
  };

  if (!config) return null;

  const buttons = config.buttons?.length
    ? config.buttons
    : [{ text: 'OK' }];
  const stackedButtons = config.options?.buttonLayout === 'stacked' || buttons.length > 2 || width < 360 || fontScale > 1.2;

  const icon = deriveIcon(config.title, config.options);
  // Icon chip colors derived from the live theme tone — one hex + alpha
  // triple replaces the old foreign literal palette, so dark alerts carry
  // the palette's own muted hues.
  const toneColor = colors[icon.tone] || colors.info;
  const iconColor = { color: toneColor, bg: toneColor + '1F' };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => dismiss(null)}
    >
      {/* Backdrop with atmospheric darkness */}
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />

      <View style={[styles.centred, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        {/* Bounded alert surface */}
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={() => dismiss(null)}
          style={[
            styles.outerShell,
            { maxHeight: Math.max(48, height - insets.top - insets.bottom - 32) },
            {
              borderColor: colors.outlineVariant + '45',
              backgroundColor: colors.surfaceContainerLowest,
              transform: [{ scale: cardScale }],
              opacity: cardOpacity,
            },
          ]}
        >
          {/* ── Inner Core ────────────────────────────────────────── */}
          <ScrollView style={styles.scroll} contentContainerStyle={[styles.inner, { backgroundColor: colors.surfaceContainerLow }]} bounces={false}>

            <View style={[styles.iconShell, { backgroundColor: iconColor.bg }]}>
              {icon.render(iconColor.color)}
            </View>

            {/* Title */}
            <Text accessibilityRole="header" style={[styles.title, type?.titleLg, { color: colors.onSurface }]}>
              {config.title}
            </Text>

            {/* Message Body */}
            {!!config.message && (
              <Text style={[styles.message, type?.bodyMd, { color: colors.onSurfaceVariant }]}>
                {config.message}
              </Text>
            )}

            {/* Recovery actions grow with their labels. */}
            <View style={[styles.btnGroup, stackedButtons ? styles.btnGroupStacked : buttons.length === 1 ? styles.btnGroupSingle : styles.btnGroupMultiple]}>
              {buttons.map((btn, i) => {
                const isDanger  = btn.style === 'destructive' || btn.destructive;
                const isCancel  = btn.style === 'cancel';
                const isPrimary = !isDanger && !isCancel;

                const bgBtn = isPrimary
                  ? colors.primary
                  : isDanger
                    ? colors.error
                    : colors.surfaceContainerHighest;

                const textBtnColor = isPrimary
                  ? colors.onPrimary
                  : isDanger
                    ? colors.onError
                    : colors.onSurface;

                return (
                  <Pressable
                    key={i}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      {
                        backgroundColor: bgBtn,
                        borderColor: isCancel ? colors.outlineVariant + '60' : 'transparent',
                        borderWidth: isCancel ? 1 : 0,
                        transform: [{ scale: !reducedMotion && pressed ? 0.98 : 1 }],
                        opacity: pressed ? 0.9 : 1,
                        flex: !stackedButtons && buttons.length > 1 ? 1 : undefined,
                        width: stackedButtons || buttons.length === 1 ? '100%' : undefined,
                        ...(stackedButtons ? { height: undefined, minHeight: 50, paddingVertical: 14 } : {}),
                      },
                    ]}
                    onPress={() => dismiss(btn.onPress)}
                    accessibilityRole="button"
                    accessibilityLabel={btn.text}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        { color: textBtnColor },
                        isPrimary && styles.btnTextPrimary,
                        type?.labelLg,
                      ]}

                    >
                      {btn.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Public API — matches Alert.alert() signature ─────────────────────────
export const AppAlert = {
  alert: (title, message, buttons, options) =>
    AppAlertEmitter.show(title, message, buttons, options),
};

// ─── Styles ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12, 18, 16, 0.65)',
  },
  centred: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  outerShell: {
    width: '100%',
    maxWidth: 350,
    borderRadius: 16,
    borderWidth: 1,
    padding: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
    }),
    overflow: 'hidden',
  },
  scroll: { flexShrink: 1 },
  inner: {
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 22,
    paddingBottom: 22,
  },
  iconShell: {
    width: 48,
    height: 48,
    borderRadius: 12,
    marginBottom: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 26,
    maxWidth: 290,
  },
  btnGroup: {
    width: '100%',
    gap: 10,
  },
  btnGroupSingle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGroupMultiple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  btnGroupStacked: {
    alignItems: 'stretch',
  },
  actionBtn: {
    minHeight: 50,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 4,
    elevation: 0,
  },
  btnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  btnTextPrimary: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    letterSpacing: 0.3,
  },
});

