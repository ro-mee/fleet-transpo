/**
 * AppAlert — Premium custom alert modal
 *
 * Drop-in replacement for React Native's Alert.alert()
 * Uses the same Double-Bezel, Impeccable design system as SwipeButton.
 *
 * Usage:
 *   // Imperative (like Alert.alert):
 *   AppAlert.alert("Title", "Message", [{ text: "OK", onPress: () => {} }]);
 *   AppAlert.alert("Error", "Something went wrong");
 *
 *   // Mount once in your root layout:
 *   <AppAlert.Host />
 */
import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable, Modal,
  StatusBar, Platform
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
  error:   { name: 'close-circle',     color: '#ef4444' },
  success: { name: 'checkmark-circle', color: '#22c55e' },
  warning: { name: 'warning',          color: '#f59e0b' },
  info:    { name: 'information-circle', color: '#3b82f6' },
};

function deriveIcon(title = '', options = {}) {
  if (options?.type) return ICON_MAP[options.type] || ICON_MAP.info;
  const t = title.toLowerCase();
  if (/error|fail|could not/.test(t))   return ICON_MAP.error;
  if (/success|complete|saved|started/.test(t)) return ICON_MAP.success;
  if (/warn|missing|required|incomplete|permission/.test(t)) return ICON_MAP.warning;
  return ICON_MAP.info;
}

// ─── Host component — mount once in your root layout ──────────────────────
export function AppAlertHost() {
  const { colors } = useTheme();
  const [visible, setVisible]   = useState(false);
  const [config,  setConfig]    = useState(null);

  // Animated values — GPU-only
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardScale       = useRef(new Animated.Value(0.88)).current;
  const cardOpacity     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    _showAlert = (cfg) => {
      setConfig(cfg);
      setVisible(true);
      backdropOpacity.setValue(0);
      cardScale.setValue(0.88);
      cardOpacity.setValue(0);

      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(cardScale,   { toValue: 1, bounciness: 10, speed: 16, useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    };
    return () => { _showAlert = null; };
  }, []);

  const dismiss = (onPress) => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(cardScale,   { toValue: 0.92, duration: 200, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0,    duration: 180, useNativeDriver: true }),
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
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />

      <View style={styles.centred}>
        {/* ── Outer Shell (Double-Bezel) ───────────────────────────── */}
        <Animated.View
          style={[
            styles.outerShell,
            {
              borderColor: colors.outlineVariant + '30',
              backgroundColor: colors.surface + 'F0',
              transform: [{ scale: cardScale }],
              opacity: cardOpacity,
            },
          ]}
        >
          {/* Top edge gleam */}
          <View style={styles.insetHighlight} />

          {/* ── Inner Core ────────────────────────────────────────── */}
          <View style={[styles.inner, { backgroundColor: colors.surfaceContainer }]}>

            {/* Icon badge */}
            <View style={[styles.iconBadge, { backgroundColor: icon.color + '18' }]}>
              <Ionicons name={icon.name} size={28} color={icon.color} />
            </View>

            {/* Title */}
            <Text style={[styles.title, { color: colors.onSurface }]}>
              {config.title}
            </Text>

            {/* Message */}
            {!!config.message && (
              <Text style={[styles.message, { color: colors.onSurfaceVariant }]}>
                {config.message}
              </Text>
            )}

            {/* ── Buttons ──────────────────────────────────────────── */}
            <View style={[
              styles.btnRow,
              buttons.length === 1 && styles.btnRowSingle,
              { borderTopColor: colors.outlineVariant + '30' }
            ]}>
              {buttons.map((btn, i) => {
                const isDanger      = btn.style === 'destructive';
                const isCancel      = btn.style === 'cancel';
                const isPrimary     = !isDanger && !isCancel;
                const btnColor = isDanger ? '#ef4444'
                  : isPrimary ? colors.primary
                  : colors.onSurfaceVariant;

                return (
                  <Pressable
                    key={i}
                    style={({ pressed }) => [
                      styles.btn,
                      buttons.length > 1 && i < buttons.length - 1 && {
                        borderRightWidth: 1,
                        borderRightColor: colors.outlineVariant + '30',
                      },
                      { opacity: pressed ? 0.65 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
                    ]}
                    onPress={() => dismiss(btn.onPress)}
                  >
                    <Text style={[
                      styles.btnText,
                      { color: btnColor },
                      isPrimary && styles.btnTextPrimary,
                    ]}>
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
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  centred: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  outerShell: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 28,
    borderWidth: 1,
    padding: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.35,
    shadowRadius: 40,
    elevation: 24,
    overflow: 'hidden',
  },
  insetHighlight: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    zIndex: 10,
  },
  inner: {
    borderRadius: 26,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: 32,
    paddingHorizontal: 24,
    paddingBottom: 0,
  },
  iconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    letterSpacing: 0.2,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 28,
    opacity: 0.8,
  },
  btnRow: {
    flexDirection: 'row',
    width: '100%',
    borderTopWidth: 1,
    marginTop: 4,
  },
  btnRowSingle: {
    justifyContent: 'center',
  },
  btn: {
    flex: 1,
    paddingVertical: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    letterSpacing: 0.1,
  },
  btnTextPrimary: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
  },
});
