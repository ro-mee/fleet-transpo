/**
 * AppAlert — Premium custom alert modal
 *
 * Drop-in replacement for React Native's Alert.alert()
 * Built with Vanguard Double-Bezel Architecture & Impeccable Design Standards.
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
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme-context';
import { fonts } from '../lib/theme';

// ─── Singleton event emitter ───────────────────────────────────────────────
let _showAlert = null;

const AppAlertEmitter = {
  show: (title, message, buttons, options) => {
    if (_showAlert) _showAlert({ title, message, buttons, options });
  },
};

// ─── Preset icon maps (Luxury Tone Profiles & Vector SVGs) ─────────────────
const ICON_MAP = {
  error: {
    color: '#F43F5E',
    bg: 'rgba(244, 63, 94, 0.12)',
    border: 'rgba(244, 63, 94, 0.28)',
    outerGlow: 'rgba(244, 63, 94, 0.08)',
    render: (color) => (
      <Ionicons name="close-circle" size={32} color={color} />
    ),
  },
  success: {
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.12)',
    border: 'rgba(16, 185, 129, 0.28)',
    outerGlow: 'rgba(16, 185, 129, 0.08)',
    render: (color) => (
      <Ionicons name="checkmark-circle" size={32} color={color} />
    ),
  },
  warning: {
    color: '#F59E0B',
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.28)',
    outerGlow: 'rgba(245, 158, 11, 0.08)',
    render: (color) => (
      <Ionicons name="alert-circle" size={32} color={color} />
    ),
  },
  info: {
    color: '#0EA5E9',
    bg: 'rgba(14, 165, 233, 0.12)',
    border: 'rgba(14, 165, 233, 0.28)',
    outerGlow: 'rgba(14, 165, 233, 0.08)',
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

// ─── Host component — mount once in your root layout ──────────────────────
export function AppAlertHost() {
  const { colors, isDark } = useTheme();
  const [visible, setVisible] = useState(false);
  const [config, setConfig]   = useState(null);

  // Animated values — GPU-only spring physics
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardScale       = useRef(new Animated.Value(0.9)).current;
  const cardOpacity     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    _showAlert = (cfg) => {
      setConfig(cfg);
      setVisible(true);
      backdropOpacity.setValue(0);
      cardScale.setValue(0.9);
      cardOpacity.setValue(0);

      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          friction: 7,
          tension: 75,
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
  }, []);

  const dismiss = (onPress) => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(cardScale, { toValue: 0.94, duration: 180, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      if (onPress) onPress();
    });
  };

  if (!config) return null;

  const buttons = config.buttons?.length
    ? config.buttons
    : [{ text: 'OK' }];

  const icon = deriveIcon(config.title, config.options);

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

      <View style={styles.centred}>
        {/* ── Outer Shell (Double-Bezel Doppelrand) ───────────────────────────── */}
        <Animated.View
          style={[
            styles.outerShell,
            {
              borderColor: colors.outlineVariant + '45',
              backgroundColor: colors.surfaceContainerLowest,
              transform: [{ scale: cardScale }],
              opacity: cardOpacity,
            },
          ]}
        >
          {/* Specular hairline top gleam */}
          <View style={styles.insetHighlight} />

          {/* ── Inner Core ────────────────────────────────────────── */}
          <View style={[styles.inner, { backgroundColor: colors.surfaceContainerLow }]}>

            {/* Glowing Icon Double-Bezel Badge */}
            <View style={[styles.iconOuterAura, { backgroundColor: icon.outerGlow }]}>
              <View style={[styles.iconShell, { borderColor: icon.border, backgroundColor: isDark ? colors.surfaceContainerLowest : '#FFFFFF' }]}>
                <View style={[styles.iconCore, { backgroundColor: icon.bg }]}>
                  {icon.render(icon.color)}
                </View>
              </View>
            </View>

            {/* Title */}
            <Text style={[styles.title, { color: colors.onSurface }]}>
              {config.title}
            </Text>

            {/* Message Body */}
            {!!config.message && (
              <Text style={[styles.message, { color: colors.onSurfaceVariant }]}>
                {config.message}
              </Text>
            )}

            {/* ── Button Bar (Floating Tactile Island Action Affordances) ─────── */}
            <View style={[styles.btnGroup, buttons.length === 1 ? styles.btnGroupSingle : styles.btnGroupMultiple]}>
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
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                        opacity: pressed ? 0.9 : 1,
                        flex: buttons.length > 1 ? 1 : undefined,
                        width: buttons.length === 1 ? '100%' : undefined,
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
                      ]}
                      numberOfLines={1}
                    >
                      {btn.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
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
    borderRadius: 28,
    borderWidth: 1,
    padding: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.18,
        shadowRadius: 32,
      },
      android: {
        elevation: 12,
      },
    }),
    overflow: 'hidden',
  },
  insetHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    zIndex: 10,
  },
  inner: {
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 22,
    paddingBottom: 22,
  },
  iconOuterAura: {
    padding: 6,
    borderRadius: 40,
    marginBottom: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconShell: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  iconCore: {
    width: '100%',
    height: '100%',
    borderRadius: 26,
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
    opacity: 0.9,
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
  actionBtn: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
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

