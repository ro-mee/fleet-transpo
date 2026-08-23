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
import { StatusPill, FilledButton, OutlinedButton } from "../../components/ui";
import { moderateScale } from "../../lib/scaling";
import { fonts } from "../../lib/theme";

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

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface }]}>
        <Pressable onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(app)/(tabs)');
          }
        }} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[type.titleLg, { color: colors.onSurface }]}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          wide && { alignSelf: "center", width: "100%", maxWidth: moderateScale(640) },
          { paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* DISPLAY SECTION */}
        <Text style={[type.sectionTitle, { color: colors.primary, marginBottom: -16, marginLeft: 8 }]}>DISPLAY</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>

          <View style={[styles.themeBlock, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="moon" size={18} color={colors.onSurfaceVariant} />
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
                    style={[styles.segmentOption, active && { backgroundColor: colors.primary }]}
                  >
                    <Text style={[type.labelLg, { color: active ? colors.onPrimary : colors.onSurfaceVariant }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable onPress={openTextSizeModal} style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="text" size={18} color={colors.onSurfaceVariant} />
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
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="contrast" size={18} color={colors.onSurfaceVariant} />
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
        <Text style={[type.sectionTitle, { color: colors.primary, marginBottom: -16, marginLeft: 8 }]}>PREFERENCES</Text>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>

          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="notifications" size={18} color={colors.onSurfaceVariant} />
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

          <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
            <View style={styles.rowLeft}>
              <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                <Ionicons name="location" size={18} color={colors.onSurfaceVariant} />
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

        {/* PERMISSIONS SECTION */}
        <Text style={[type.sectionTitle, { color: colors.primary, marginBottom: -16, marginLeft: 8 }]}>PERMISSIONS</Text>
        <View style={[styles.cluster, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
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
                    { borderColor: colors.outline },
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

        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          {permissionRows.map((row, index) => {
            const isLast = index === permissionRows.length - 1;
            const presentation = describePermissionState(row.status);
            const expanded = expandedKey === row.key;
            const approved = row.status?.status === "granted";
            const blocked = row.status?.status === "denied" && !row.status.canAskAgain;
            return (
              <View key={row.key} style={[!isLast && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }]}>
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
                  <View style={[styles.iconBox, { backgroundColor: colors.surfaceContainer }]}>
                    <Ionicons name={row.icon} size={18} color={colors.onSurfaceVariant} />
                  </View>
                  <Text style={[type.bodyMd, styles.permissionTitle, { color: colors.onSurface }]}>{row.title}</Text>
                  <View style={styles.rowRight}>
                    {row.status ? (
                      <StatusPill label={presentation.label} tone={presentation.tone} />
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
                      <OutlinedButton
                        label="Open device settings"
                        size="sm"
                        onPress={() => openSystemSettingsFor(row)}
                        style={styles.permissionAction}
                      />
                    ) : !approved ? (
                      <FilledButton
                        label="Allow"
                        size="sm"
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
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
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
              <Pressable onPress={() => setTextSizeModalVisible(false)} style={styles.modalBtn}>
                <Text style={[type.labelLg, { color: colors.onSurfaceVariant }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmTextSize} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backBtn: { padding: 4 },
  scroll: { padding: 16, paddingTop: 24, gap: 24 },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  themeBlock: {
    padding: 16,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },

  cluster: {
    borderRadius: 12,
    borderWidth: 1,
    padding: moderateScale(16),
    gap: moderateScale(12),
  },
  clusterTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  },
  tick: {
    width: moderateScale(38),
    height: moderateScale(18),
    borderRadius: moderateScale(5),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  permissionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(14),
    minHeight: moderateScale(56),
  },
  permissionTitle: { flex: 1 },
  permissionPane: {
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(16),
    paddingLeft: moderateScale(64),
    gap: moderateScale(10),
  },
  permissionConsequence: { lineHeight: moderateScale(16) },
  permissionAction: { alignSelf: "flex-start", marginTop: moderateScale(2) },
  permissionApprovedNote: { lineHeight: moderateScale(16) },
  permissionsFootnote: {
    fontSize: moderateScale(12),
    fontFamily: fonts.body,
    lineHeight: moderateScale(17),
    marginTop: -16,
    marginLeft: 8,
    marginRight: 8,
  },
  segment: {
    flexDirection: "row",
    marginTop: 12,
    borderRadius: 10,
    padding: 3,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
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
    borderRadius: 16,
    padding: 24,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 24,
    gap: 12,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
});
