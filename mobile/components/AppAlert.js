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

// ─── Preset icon maps ──────────────────────────────────────────────────────
const ICON_MAP = {
  error:   { name: 'shield-half-outline', color: '#E05349', bg: 'rgba(224, 83, 73, 0.12)' },
  success: { name: 'checkmark-circle-outline', color: '#2E7D5E', bg: 'rgba(46, 125, 94, 0.14)' },
  warning: { name: 'alert-triangle-outline', color: '#D28522', bg: 'rgba(210, 133, 34, 0.14)' },
  info:    { name: 'information-circle-outline', color: '#327494', bg: 'rgba(50, 116, 148, 0.14)' },
};

function deriveIcon(title = '', options = {}) {
  if (options?.type && ICON_MAP[options.type]) return ICON_MAP[options.type];
  const t = title.toLowerCase();
  if (/error|fail|cannot|denied|blocked|invalid|unauthorized/.test(t)) return ICON_MAP.error;
  if (/success|complete|saved|done|updated|passed/.test(t)) return ICON_MAP.success;
  if (/warn|missing|required|incomplete|attention|alert/.test(t)) return ICON_MAP.warning;
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

            {/* Icon Double-Bezel Badge */}
            <View style={[styles.iconShell, { borderColor: icon.color + '30', backgroundColor: colors.surfaceContainerLowest }]}>
              <View style={[styles.iconCore, { backgroundColor: isDark ? icon.color + '22' : icon.bg }]}>
                <Ionicons name={icon.name} size={28} color={icon.color} />
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

            {/* ── Button Bar (Floating Pill Action Affordances) ─────── */}
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
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                        opacity: pressed ? 0.9 : 1,
                        flex: buttons.length > 1 ? 1 : undefined,
                        minWidth: buttons.length === 1 ? 140 : undefined,
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
    paddingTop: 28,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  iconShell: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconCore: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
    maxWidth: 280,
    opacity: 0.85,
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
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  btnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  btnTextPrimary: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    letterSpacing: 0.4,
  },
});

