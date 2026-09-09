import { moderateScale } from '../../../lib/scaling';
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useAuth } from "../../../lib/auth";
import { useDriverProfile } from "../../../lib/driver-profile";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { clayShade, clayCard, clayPill, clayCta, clayTile } from "../../../lib/clay";

function MenuRow({ title, icon, isNew = false, onPress, colors, type, isLast = false }) {
  return (
    <Pressable
      style={({ hovered, pressed }) => [
        styles.menuRow,
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "55" },
        (hovered || pressed) && { backgroundColor: colors.surfaceContainerHigh, borderRadius: 18 },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.menuRowLeft}>
        <View style={[styles.menuIconTile, clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
          <Ionicons name={icon} size={18} color={colors.onPrimaryContainer} />
        </View>
        <Text style={[type.bodyLg, styles.menuTitle, { color: colors.onSurface }]}>{title}</Text>
      </View>
      <View style={styles.menuRowRight}>
        {isNew && (
          <View style={[styles.newBadge, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 4, elevation: 2 }]}>
            <Text style={[type.caption, styles.newBadgeText, { color: colors.onPrimaryContainer }]}>New</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
      </View>
    </Pressable>
  );
}

const ACCOUNT_ROWS = [
  { title: "Personal Information", icon: "person-outline", route: "/profile/personal" },
  { title: "License & Compliance", icon: "card-outline", route: "/profile/license" },
  { title: "Assigned Vehicle", icon: "car-outline", route: "/profile/vehicle" },
  { title: "Safety Settings", icon: "shield-checkmark-outline", route: "/profile/safety", isNew: true },
];

const GENERAL_ROWS = [
  { title: "Help Center", icon: "help-circle-outline", route: "/profile/help" },
  { title: "Settings", icon: "settings-outline", route: "/settings" },
];

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { colors, type } = useTheme();
  const router = useRouter();

  // Cached /api/driver/me read — offline the tab falls back cached profile →
  // auth user, silently (the global offline banner is enough on Profile).
  const { profile: serverProfile } = useDriverProfile();

  const [logoutModal, setLogoutModal] = useState(false);
  const currentUser = serverProfile || user;
  const driverName =
    currentUser?.firstName && currentUser?.lastName
      ? `${currentUser.firstName} ${currentUser.lastName}`
      : currentUser?.firstName ||
        currentUser?.name ||
        currentUser?.full_name ||
        "Driver";
  const initials = driverName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity — raised clay card */}
        <View
          style={[
            styles.identityCard,
            clayShade,
            clayCard,
            { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow },
          ]}
        >
          <View style={styles.avatarContainer}>
            <View
              style={[
                styles.avatarCircle,
                { backgroundColor: colors.primaryContainer, borderTopColor: "#FFFFFF60", borderBottomWidth: 2, borderBottomColor: "#00000012" },
              ]}
            >
              <Text style={[type.headlineMd, styles.avatarInitials, { color: colors.onPrimaryContainer }]}>{initials}</Text>
            </View>
            <View style={[styles.editBadge, clayShade, { backgroundColor: colors.surfaceContainerHigh, shadowColor: colors.shadow }]}>
              <Ionicons name="pencil" size={13} color={colors.onSurfaceVariant} />
            </View>
          </View>
          <View style={styles.identityText}>
            <Text style={[type.titleLg, styles.profileName, { color: colors.onSurface }]}>{driverName}</Text>
            {currentUser?.status ? (
              <View style={[styles.statusPill, clayPill, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 4, elevation: 2 }]}>
                <Text style={[type.caption, { color: colors.onPrimaryContainer }]}>
                  {String(currentUser.status)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* My Account Section */}
        <View style={styles.section}>
          <Text style={[type.labelLg, styles.sectionTitle, { color: colors.onSurfaceVariant }]}>Account</Text>
          <View style={[styles.sectionCard, clayShade, clayCard, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow, paddingVertical: 8 }]}>
            {ACCOUNT_ROWS.map((row, i) => (
              <MenuRow
                key={row.route}
                title={row.title}
                icon={row.icon}
                isNew={row.isNew}
                colors={colors}
                type={type}
                isLast={i === ACCOUNT_ROWS.length - 1}
                onPress={() => router.push(row.route)}
              />
            ))}
          </View>
        </View>

        {/* General Section */}
        <View style={styles.section}>
          <Text style={[type.labelLg, styles.sectionTitle, { color: colors.onSurfaceVariant }]}>General</Text>
          <View style={[styles.sectionCard, clayShade, clayCard, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow, paddingVertical: 8 }]}>
            {GENERAL_ROWS.map((row, i) => (
              <MenuRow
                key={row.route}
                title={row.title}
                icon={row.icon}
                colors={colors}
                type={type}
                isLast={i === GENERAL_ROWS.length - 1}
                onPress={() => router.push(row.route)}
              />
            ))}
          </View>
        </View>

        {/* Sign Out */}
        <Pressable
          onPress={() => setLogoutModal(true)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.logoutBtn,
            clayCta,
            { borderColor: colors.error, shadowColor: colors.shadow, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={[type.labelLg, styles.logoutText, { color: colors.error }]}>Sign Out</Text>
        </Pressable>
      </ScrollView>

      {/* Logout Confirm Modal */}
      <Modal visible={logoutModal} transparent animationType="fade" onRequestClose={() => setLogoutModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant }]}>
            <Text style={[type.titleLg, styles.modalTitle, { color: colors.onSurface }]}>Sign Out?</Text>
            <Text
              style={[type.bodyMd, styles.modalBody, { color: colors.onSurfaceVariant }]}
            >
              You will be returned to the login screen.
            </Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setLogoutModal(false)} style={[styles.modalCancelBtn, { borderColor: colors.outline }]}>
                <Text style={[type.labelLg, styles.modalCancelText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={signOut} style={[styles.modalConfirmBtn, { backgroundColor: colors.error }]}>
                <Text style={[type.labelLg, styles.modalConfirmText, { color: colors.onError }]}>Sign Out</Text>
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
  scroll: { paddingHorizontal: 18, gap: 22 },

  identityCard: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatarContainer: {
    position: "relative",
  },
  avatarCircle: {
    width: moderateScale(64),
    height: moderateScale(64),
    borderRadius: moderateScale(32),
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 2,
  },
  avatarInitials: {
  },
  editBadge: {
    position: "absolute",
    bottom: -2,
    right: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  identityText: { flexShrink: 1, gap: 8 },
  profileName: {
  },
  statusPill: { alignSelf: "flex-start" },

  section: {
    gap: 10,
  },
  sectionTitle: {
    marginLeft: 8,
    fontFamily: fonts.dataSemiBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  menuRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: moderateScale(12),
    paddingHorizontal: 8,
    minHeight: TOUCH_TARGET,
  },
  menuRowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  menuIconTile: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  menuTitle: {
  },
  menuRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },
  newBadge: {
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(3),
    borderRadius: 12,
    borderTopWidth: 1,
    borderTopColor: "#FFFFFF60",
    borderBottomWidth: 1,
    borderBottomColor: "#00000010",
  },
  newBadgeText: {
  },

  logoutBtn: {
    borderWidth: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
    marginTop: moderateScale(4),
  },
  logoutText: {
  },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: moderateScale(24) },
  modalCard: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 1,
    padding: moderateScale(24),
    gap: moderateScale(12),
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  modalTitle: { },
  modalBody: { },
  modalActions: { flexDirection: "row", gap: moderateScale(12), marginTop: moderateScale(4) },
  modalCancelBtn: { flex: 1, minHeight: 48, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  modalCancelText: { },
  modalConfirmBtn: { flex: 1, minHeight: 48, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  modalConfirmText: { },
});
