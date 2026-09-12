import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  Pressable,
  AppState,
  Platform,
  LayoutAnimation,
  AccessibilityInfo,
  useWindowDimensions,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../../lib/theme-context";
import { useSettings } from "../../../lib/settings-context";
import { api } from "../../../lib/api";
import { requestPushPermission, dismissAllLocalNotifications } from "../../../lib/notifications/push";
import {
  describePermissionState,
  getPermissionStatuses,
  listAppPermissions,
  openSystemSettings,
  requestAppPermission,
  summarizeStatuses,
} from "../../../lib/permissions";
import { AppAlert } from "../../../components/AppAlert";
import ClayScreenHeader from "../../../components/ClayScreenHeader";
import { ClayCard, ClayButton, ClayBadge, ClayTile } from "../../../components/clay";
import { statusColorForTone } from "../../../lib/theme";
import { moderateScale } from "../../../lib/scaling";
import { fonts } from "../../../lib/theme";

// Device-access rows rendered in the DEVICE ACCESS section. Foreground
// location and notifications are shown inline under their app-control
// toggles instead, so they are deliberately not duplicated here.
const DEVICE_ACCESS_KEYS = ["locationBackground", "camera", "mediaLibrary"];

/**
 * App-level control: what FleetOps itself does with a capability. The toggle
 * only governs FleetOps behavior — the OS permission underneath may remain
 * granted, so the device state is always shown alongside, and the OFF
 * wording says FleetOps will not use the feature, never "permission revoked".
 */
function AppControlRow({ icon, title, description, value, onValueChange, permissionStatus, colors, type, isLast }) {
  const presentation = permissionStatus ? describePermissionState(permissionStatus) : null;
  const palette = presentation ? statusColorForTone(colors, presentation.tone) : null;
  return (
    <View style={[!isLast && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "55" }]}>
      <View style={styles.controlRow}>
        <ClayTile
          icon={icon}
          size="sm"
          backgroundColor={colors.primaryContainer}
          color={colors.onPrimaryContainer}
        />
        <View style={styles.controlText}>
          <View style={styles.controlHeader}>
            <Text style={[type.bodyMd, styles.controlTitle, { color: colors.onSurface }]}>{title}</Text>
            <Switch
              value={value}
              onValueChange={onValueChange}
              trackColor={{ false: colors.surfaceContainerHigh, true: colors.primary }}
              thumbColor={"white"}
            />
          </View>
          <Text style={[type.caption, styles.controlCaption, { color: colors.onSurfaceVariant }]}>
            {value ? description : "FleetOps will not use this feature while it is off."}
          </Text>
          <Text style={[type.caption, styles.controlCaption, palette ? { color: palette.fg } : { color: colors.onSurfaceVariant }]}>
            Device permission: {presentation ? presentation.label : "checking…"}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function AppPermissionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const wide = windowWidth >= 768;

  const { settings, updateSetting } = useSettings();

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

  // App-level Location Tracking toggle. ON needs the OS location permission
  // first (requested if missing); OFF only stops FleetOps from using it —
  // the OS permission is untouched and may remain granted.
  const toggleLocationTracking = async (val) => {
    if (val) {
      const alreadyGranted = permissionRows.find((r) => r.key === "location")?.status?.status === "granted";
      if (!alreadyGranted) {
        const result = await requestAppPermission("location");
        await refreshPermissions();
        if (!result || result.status !== "granted") {
          if (result && !result.canAskAgain) {
            AppAlert.alert(
              "Location is blocked",
              "Enable location for FleetOps in your device settings, then turn tracking back on.",
              [{ text: "OK" }]
            );
          } else {
            AppAlert.alert(
              "Location permission needed",
              "FleetOps needs the device location permission before tracking can be turned on.",
              [{ text: "OK" }]
            );
          }
          updateSetting("locationTracking", false);
          return;
        }
      }
      updateSetting("locationTracking", true);
    } else {
      updateSetting("locationTracking", false);
    }
  };

  // App-level Push Notifications toggle. ON needs OS notification
  // permission (requested if missing); OFF stops FleetOps push behavior and
  // dismisses queued local notifications — the OS permission is untouched.
  // The toggle ALSO syncs a bulk server preference: remote FCM pushes are
  // delivered by the OS regardless of this app-local setting, so without
  // the server-side opt-out a driver who turned Push off here would still
  // get real pushes. Best-effort — a sync failure never blocks the toggle.
  const syncPushPreference = (enabled) => {
    api
      .put("/api/notifications/preferences", { channel: "push", enabled, bulk: true })
      .catch(() => {});
  };

  const togglePushNotifications = async (val) => {
    if (val) {
      const granted = await requestPushPermission();
      await refreshPermissions();
      if (!granted) {
        AppAlert.alert(
          "Notifications blocked",
          "Enable notifications for FleetOps in your device settings to get push-style alerts.",
          [{ text: "OK" }]
        );
        updateSetting("pushNotifications", false);
        return;
      }
      updateSetting("pushNotifications", true);
      syncPushPreference(true);
    } else {
      await dismissAllLocalNotifications();
      updateSetting("pushNotifications", false);
      syncPushPreference(false);
    }
  };

  const statusByKey = Object.fromEntries(permissionRows.map((r) => [r.key, r.status]));
  const deviceRows = permissionRows.filter((r) => DEVICE_ACCESS_KEYS.includes(r.key));
  const summary = summarizeStatuses(deviceRows.map((r) => r.status));

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(app)/(tabs)');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="App Permissions" onBack={goBack} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          wide && { alignSelf: "center", width: "100%", maxWidth: moderateScale(640) },
          { paddingBottom: insets.bottom + 20 },
        ]}
      >
        {/* APP CONTROLS — what FleetOps itself does with a capability.
            The OS permission underneath is shown, never implied revocable here. */}
        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>APP CONTROLS</Text>
        <ClayCard variant="standard" style={{ padding: 0, gap: 0 }}>
          <AppControlRow
            icon="location"
            title="Location Tracking"
            description="Tracks your location for active trip operations."
            value={settings.locationTracking}
            onValueChange={toggleLocationTracking}
            permissionStatus={statusByKey.location}
            colors={colors}
            type={type}
          />
          <AppControlRow
            icon="notifications"
            title="Push Notifications"
            description="Delivers dispatch assignments and operational alerts."
            value={settings.pushNotifications}
            onValueChange={togglePushNotifications}
            permissionStatus={statusByKey.notifications}
            colors={colors}
            type={type}
            isLast
          />
        </ClayCard>

        {/* DEVICE ACCESS — OS-level permissions. Status + manage only;
            these are never shown as ON/OFF switches because the app cannot
            revoke an OS permission. */}
        <Text style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>DEVICE ACCESS</Text>
        <ClayCard variant="standard" style={{ padding: 0, gap: 0 }}>
          <View style={styles.clusterTop}>
            <Text style={[type.labelLg, { color: colors.primary }]}>PERMISSIONS</Text>
            <Text style={[styles.clusterCount, { color: colors.onSurface }]}>
              {summary.pending ? "CHECKING" : `${summary.approved} OF ${summary.total}`}
            </Text>
          </View>
          <View style={styles.clusterTicks}>
            {deviceRows.map((row) => {
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
        </ClayCard>

        <ClayCard variant="standard" style={{ padding: 0, gap: 0 }}>
          {deviceRows.map((row, index) => {
            const isLast = index === deviceRows.length - 1;
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
                  <ClayTile
                    icon={row.icon}
                    size="sm"
                    backgroundColor={colors.primaryContainer}
                    color={colors.onPrimaryContainer}
                  />
                  <Text style={[type.bodyMd, styles.permissionTitle, { color: colors.onSurface }]}>{row.title}</Text>
                  <View style={styles.rowRight}>
                    {row.status ? (
                      <ClayBadge label={presentation.label} tone={presentation.tone} size="sm" />
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
                      <ClayButton
                        variant="outline"
                        size="sm"
                        label="Open device settings"
                        onPress={() => openSystemSettingsFor(row)}
                        style={styles.permissionAction}
                      />
                    ) : !approved ? (
                      <ClayButton
                        variant="primary"
                        size="sm"
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
        </ClayCard>
        <Text style={[styles.permissionsFootnote, { color: colors.onSurfaceVariant }]}>
          App controls decide whether FleetOps uses a feature; device access is granted in your OS settings and cannot be revoked from here. Tap any device-access item to review or change what you allow.
        </Text>

      </ScrollView>
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
  controlRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(12),
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(16),
  },
  controlText: {
    flex: 1,
    gap: 3,
  },
  controlHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: moderateScale(12),
  },
  controlTitle: { flexShrink: 1 },
  controlCaption: { lineHeight: moderateScale(16) },

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
});
