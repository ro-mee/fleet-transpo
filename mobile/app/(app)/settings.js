import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  Pressable,
  Modal,
  AppState,
  Platform,
  LayoutAnimation,
  AccessibilityInfo,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { useSettings } from "../../lib/settings-context";
import { requestPushPermission, dismissAllLocalNotifications } from "../../lib/notifications/push";
import {
  describePermissionState,
  getPermissionStatuses,
  listAppPermissions,
  openSystemSettings,
  requestAppPermission,
  summarizeStatuses,
} from "../../lib/permissions";
import { AppAlert } from "../../components/AppAlert";
import ClayScreenHeader from "../../components/ClayScreenHeader";
import { statusColorForTone } from "../../lib/theme";
import { clayShade, clayPill, clayCta, clayTile } from "../../lib/clay";
import { moderateScale } from "../../lib/scaling";
import { fonts } from "../../lib/theme";

/** Raised clay pill for a permission state (replaces ui.js StatusPill here). */
function ClayStatusPill({ label, tone }) {
  const { colors, type } = useTheme();
  const palette = statusColorForTone(colors, tone);
  return (
    <View style={[clayPill, { backgroundColor: palette.bg, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 4, elevation: 2 }]}>
      <Text style={[type.caption, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

/** Clay primary CTA with a loading state (replaces ui.js FilledButton here). */
function ClayPrimaryButton({ label, onPress, loading, disabled, style }) {
  const { colors, type } = useTheme();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.ctaBase,
        clayCta,
        { backgroundColor: colors.primary, shadowColor: colors.shadow, opacity: isDisabled ? 0.55 : pressed ? 0.88 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.onPrimary} />
      ) : (
        <Text style={[type.labelLg, { color: colors.onPrimary }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Clay outlined CTA (replaces ui.js OutlinedButton here). */
function ClayOutlineButton({ label, onPress, style }) {
  const { colors, type } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.ctaBase,
        clayCta,
        { borderWidth: 2, borderColor: colors.outline, opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Text style={[type.labelLg, { color: colors.onSurface }]}>{label}</Text>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, preference, setColorScheme, type } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= 768;

  const { settings, updateSetting } = useSettings();

  const [textSizeModalVisible, setTextSizeModalVisible] = useState(false);
  const [tempTextSize, setTempTextSize] = useState(settings.textSize || 'medium');
  const [permissionRows, setPermissionRows] = useState(() =>
    listAppPermissions().map((p) => ({ ...p, status: null }))
  );
  const [expandedKey, setExpandedKey] = useState(null);
  const [requestingKey, setRequestingKey] = useState(null);
  const openedSystemSettingsRef = useRef(false);
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => { reduceMotionRef.current = !!value; })
      .catch(() => {});
  }, []);

  const animateLayout = (update) => {
    if (!reduceMotionRef.current && Platform.OS !== "web") {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    update();
  };

  const refreshPermissions = useCallback(async () => {
    try {
      const statuses = await getPermissionStatuses();
      const byKey = Object.fromEntries(statuses.map((s) => [s.key, s]));
      animateLayout(() =>
        setPermissionRows(listAppPermissions().map((p) => ({ ...p, status: byKey[p.key] || null })))
      );
    } catch {
      setPermissionRows((prev) => prev.map((p) => ({ ...p, status: p.status ?? null })));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshPermissions();
    }, [refreshPermissions])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && openedSystemSettingsRef.current) {
        openedSystemSettingsRef.current = false;
        refreshPermissions();
      }
    });
    return () => sub.remove();
  }, [refreshPermissions]);

  const toggleExpanded = (key) => {
    animateLayout(() => setExpandedKey((prev) => (prev === key ? null : key)));
  };

  const openSystemSettingsFor = (row) => {
    AppAlert.alert(
      `${row.title} is blocked`,
      "FleetOps was denied permanently. Enable it in your device settings, then come back — this screen updates automatically.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Open Settings",
          onPress: () => {
            openedSystemSettingsRef.current = true;
            openSystemSettings();
          },
        },
      ]
    );
  };

  const allowPermission = async (row) => {
    if (requestingKey) return;
    setRequestingKey(row.key);
    try {
      const result = await requestAppPermission(row.key);
      if (result && result.status !== "granted" && !result.canAskAgain) {
        AppAlert.alert(
          `${row.title} is blocked`,
          "Enable it in your device settings to use features that depend on it.",
          [{ text: "OK" }]
        );
      }
      await refreshPermissions();
    } finally {
      setRequestingKey(null);
    }
  };

  const summary = summarizeStatuses(permissionRows.map((r) => r.status));

  const openTextSizeModal = () => {
    setTempTextSize(settings.textSize || 'medium');
    setTextSizeModalVisible(true);
  };

  const confirmTextSize = () => {
    updateSetting('textSize', tempTextSize);
    setTextSizeModalVisible(false);
  };

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)');
    }
  };

  // Clay card frame shared by every section below. Rows carry their own
  // padding; the card only supplies the raised surface + curve.
  const sectionCard = [
    styles.sectionCard,
    clayShade,
    { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Settings" onBack={goBack} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          wide && { alignSelf: "center", width: "100%", maxWidth: moderateScale(640) },
          { paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* DISPLAY SECTION */}
        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>DISPLAY</Text>
        <View style={sectionCard}>

          <View style={[styles.themeBlock, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "55" }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="moon" size={18} color={colors.onPrimaryContainer} />
              </View>
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>Theme</Text>
            </View>
            <View style={styles.segment}>
              {[
                { key: 'system', label: 'System' },
                { key: 'light', label: 'Light' },
                { key: 'dark', label: 'Dark' },
              ].map((opt) => {
                const active = preference === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setColorScheme(opt.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.segmentOption,
                      active && clayPill,
                      active && {
                        backgroundColor: colors.primary,
                        shadowColor: colors.shadow,
                        shadowOffset: { width: 0, height: 3 },
                        shadowOpacity: 0.14,
                        shadowRadius: 4,
                        elevation: 2,
                      },
                      !active && pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={[type.labelLg, { color: active ? colors.onPrimary : colors.onSurfaceVariant }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable onPress={openTextSizeModal} style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "55" }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="text" size={18} color={colors.onPrimaryContainer} />
              </View>
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>Text Size</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[type.bodyMd, { color: colors.onSurfaceVariant }]}>
                {(settings.textSize || 'medium').charAt(0).toUpperCase() + (settings.textSize || 'medium').slice(1)}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
            </View>
          </Pressable>

          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="contrast" size={18} color={colors.onPrimaryContainer} />
              </View>
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>High Contrast Mode</Text>
            </View>
            <Switch
              value={settings.highContrast}
              onValueChange={(val) => updateSetting('highContrast', val)}
              trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
              thumbColor={"white"}
            />
          </View>
        </View>

        {/* PREFERENCES SECTION */}
        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>PREFERENCES</Text>
        <View style={sectionCard}>

          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "55" }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="notifications" size={18} color={colors.onPrimaryContainer} />
              </View>
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>Push Notifications</Text>
            </View>
            <Switch
              value={settings.pushNotifications}
              onValueChange={async (val) => {
                if (val) {
                  const granted = await requestPushPermission();
                  if (!granted) {
                    AppAlert.alert(
                      "Notifications blocked",
                      "Enable notifications for FleetOps in your device settings to get push-style alerts.",
                      [{ text: "OK" }]
                    );
                    updateSetting("pushNotifications", false);
                    return;
                  }
                } else {
                  await dismissAllLocalNotifications();
                }
                updateSetting("pushNotifications", val);
              }}
              trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
              thumbColor={"white"}
            />
          </View>

          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "55" }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="location" size={18} color={colors.onPrimaryContainer} />
              </View>
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>Location Tracking</Text>
            </View>
            <Switch
              value={settings.locationTracking}
              onValueChange={(val) => updateSetting('locationTracking', val)}
              trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
              thumbColor={"white"}
            />
          </View>

        </View>

        {/* SECURITY SECTION */}
        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>SECURITY</Text>
        <View style={sectionCard}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceContainerHigh }]}
            onPress={() => router.push('/devices')}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.iconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                <Ionicons name="hardware-chip-outline" size={18} color={colors.onPrimaryContainer} />
              </View>
              <Text style={[type.bodyMd, { color: colors.onSurface }]}>Logged-in Devices</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

        {/* PERMISSIONS SECTION */}
        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>PERMISSIONS</Text>
        <View style={sectionCard}>
          <View style={styles.clusterTop}>
            <Text style={[type.labelLg, { color: colors.primary }]}>DEVICE ACCESS</Text>
            <Text style={[styles.clusterCount, { color: colors.onSurface }]}>
              {summary.pending ? "CHECKING" : `${summary.approved} OF ${summary.total}`}
            </Text>
          </View>
          <View style={styles.clusterTicks}>
            {permissionRows.map((row) => {
              const approved = row.status?.status === "granted";
              const denied = row.status?.status === "denied";
              const selected = expandedKey === row.key;
              return (
                <Pressable
                  key={row.key}
                  onPress={() => toggleExpanded(row.key)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title}, ${row.status ? describePermissionState(row.status).label : "checking"}`}
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.tick,
                    { borderColor: colors.outline, backgroundColor: colors.surfaceContainerHigh },
                    denied && { borderColor: colors.error },
                    approved && { backgroundColor: colors.primary, borderColor: colors.primary },
                    selected && { borderWidth: 2, borderColor: colors.primary },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  {approved ? (
                    <Ionicons name="checkmark" size={moderateScale(12)} color={colors.onPrimary} />
                  ) : denied ? (
                    <Ionicons name="alert" size={moderateScale(12)} color={colors.error} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={sectionCard}>
          {permissionRows.map((row, index) => {
            const isLast = index === permissionRows.length - 1;
            const presentation = describePermissionState(row.status);
            const expanded = expandedKey === row.key;
            const approved = row.status?.status === "granted";
            const blocked = row.status?.status === "denied" && !row.status.canAskAgain;
            return (
              <View key={row.key} style={[!isLast && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "55" }]}>
                <Pressable
                  onPress={() => toggleExpanded(row.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title}, ${row.status ? presentation.label : "checking"}`}
                  accessibilityHint={approved ? "Shows what this permission powers" : "Shows how to allow this permission"}
                  accessibilityState={{ expanded }}
                  style={({ pressed }) => [
                    styles.permissionRow,
                    pressed && { backgroundColor: colors.surfaceContainerHigh },
                  ]}
                >
                  <View style={[styles.iconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
                    <Ionicons name={row.icon} size={18} color={colors.onPrimaryContainer} />
                  </View>
                  <Text style={[type.bodyMd, styles.permissionTitle, { color: colors.onSurface }]}>{row.title}</Text>
                  <View style={styles.rowRight}>
                    {row.status ? (
                      <ClayStatusPill label={presentation.label} tone={presentation.tone} />
                    ) : (
                      <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>Checking…</Text>
                    )}
                    <Ionicons
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={colors.onSurfaceVariant}
                    />
                  </View>
                </Pressable>
                {expanded && (
                  <View style={styles.permissionPane}>
                    <Text style={[type.bodyMd, { color: colors.onSurface }]}>{row.why}</Text>
                    {!approved && row.withoutIt && (
                      <Text style={[type.caption, styles.permissionConsequence, { color: colors.onSurfaceVariant }]}>
                        Without it: {row.withoutIt}
                      </Text>
                    )}
                    {blocked ? (
                      <ClayOutlineButton
                        label="Open device settings"
                        onPress={() => openSystemSettingsFor(row)}
                        style={styles.permissionAction}
                      />
                    ) : !approved ? (
                      <ClayPrimaryButton
                        label="Allow"
                        loading={requestingKey === row.key}
                        onPress={() => allowPermission(row)}
                        style={styles.permissionAction}
                      />
                    ) : (
                      <Text style={[type.caption, styles.permissionApprovedNote, { color: colors.onSurfaceVariant }]}>
                        Managed in your device settings.
                      </Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
        <Text style={[styles.permissionsFootnote, { color: colors.onSurfaceVariant }]}>
          Only the access each feature needs. Tap any item to review it or change what you allow.
        </Text>

      </ScrollView>

      <Modal
        visible={textSizeModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setTextSizeModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, clayShade, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow }]}>
            <Text style={[type.titleLg, { color: colors.onSurface, marginBottom: 16 }]}>Select Text Size</Text>
            {['small', 'medium', 'large'].map((size) => (
              <Pressable
                key={size}
                style={[
                  styles.modalOption,
                  tempTextSize === size && { backgroundColor: colors.surfaceContainerHigh }
                ]}
                onPress={() => setTempTextSize(size)}
              >
                <Text style={[type.bodyMd, { color: colors.onSurface }]}>
                  {size.charAt(0).toUpperCase() + size.slice(1)}
                </Text>
                {tempTextSize === size && (
                  <Ionicons name="checkmark" size={20} color={colors.primary} />
                )}
              </Pressable>
            ))}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setTextSizeModalVisible(false)} style={[styles.modalBtn, { borderWidth: 2, borderColor: colors.outline }]}>
                <Text style={[type.labelLg, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmTextSize} style={[styles.modalBtn, clayCta, { backgroundColor: colors.primary, shadowColor: colors.shadow }]}>
                <Text style={[type.labelLg, { color: colors.onPrimary }]}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingTop: 10, gap: 22 },
  sectionLabel: {
    marginLeft: 8,
    marginBottom: -12,
    fontFamily: fonts.dataSemiBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionCard: {
    borderRadius: 30,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    minHeight: moderateScale(56),
  },
  themeBlock: {
    padding: 20,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 1,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    flexShrink: 1,
  },

  clusterTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    paddingBottom: 0,
  },
  clusterCount: {
    fontFamily: fonts.dataSemiBold,
    fontSize: moderateScale(13),
    letterSpacing: 1,
  },
  clusterTicks: {
    flexDirection: "row",
    gap: moderateScale(8),
    flexWrap: "wrap",
    padding: 20,
  },
  tick: {
    width: moderateScale(38),
    height: moderateScale(20),
    borderRadius: moderateScale(8),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  permissionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(14),
    minHeight: moderateScale(56),
  },
  permissionTitle: { flex: 1 },
  permissionPane: {
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(20),
    paddingLeft: moderateScale(70),
    gap: moderateScale(10),
  },
  permissionConsequence: { lineHeight: moderateScale(16) },
  permissionAction: { alignSelf: "flex-start", marginTop: moderateScale(2), paddingHorizontal: 24 },
  permissionApprovedNote: { lineHeight: moderateScale(16) },
  permissionsFootnote: {
    fontSize: moderateScale(12),
    fontFamily: fonts.body,
    lineHeight: moderateScale(17),
    marginTop: -10,
    marginLeft: 8,
    marginRight: 8,
  },
  segment: {
    flexDirection: "row",
    marginTop: 14,
    gap: 6,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaBase: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 24,
    padding: 24,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 18,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  modalBtn: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
