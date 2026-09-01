import { moderateScale } from '../../../lib/scaling';
import { useCallback, useEffect, useState } from "react";
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
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";

function MenuRow({ title, isNew = false, onPress, colors }) {
  const { type } = useTheme();
  return (
    <Pressable
      style={({ hovered, pressed }) => [
        styles.menuRow,
        { 
          borderBottomColor: colors.surfaceContainerHigh,
          backgroundColor: hovered || pressed ? colors.hover : "transparent"
        }
      ]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.menuRowLeft}>
        <Text style={[type.bodyLg, styles.menuTitle, { color: colors.onSurface }]}>{title}</Text>
      </View>
      <View style={styles.menuRowRight}>
        {isNew && (
          <View style={[styles.newBadge, { backgroundColor: colors.secondaryContainer }]}>
            <Text style={[type.caption, styles.newBadgeText, { color: colors.onSecondaryContainer }]}>New</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
      </View>
    </Pressable>
  );
}

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { colors, type } = useTheme();
  const router = useRouter();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoutModal, setLogoutModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api.get("/api/driver/me");
      setProfile(me);
    } catch {
      // use fallback from auth context
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
  // Deferred one tick: mount-fetch semantics without sync setState in the effect body.
  const t = setTimeout(load, 0);
  return () => clearTimeout(t);
}, [load]);

  const currentUser = profile || user;
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
        {/* Header Profile Section */}
        <View style={styles.headerProfile}>
          <View style={styles.avatarContainer}>
            <View style={[styles.avatarCircle, { backgroundColor: colors.primaryContainer }]}>
              <Text style={[type.headlineMd, styles.avatarInitials, { color: colors.onPrimaryContainer }]}>{initials}</Text>
            </View>
            <View style={[styles.editBadge, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
              <Ionicons name="pencil" size={12} color={colors.onSurfaceVariant} />
            </View>
          </View>
          <Text style={[type.titleLg, styles.profileName, { color: colors.onSurface }]}>{driverName}</Text>
        </View>

        {/* My Account Section */}
        <View style={styles.section}>
          <Text style={[type.labelLg, styles.sectionTitle, { color: colors.onSurface }]}>Account</Text>
          <MenuRow title="Personal Information" colors={colors} onPress={() => router.push('/profile/personal')} />
          <MenuRow title="License & Compliance" colors={colors} onPress={() => router.push('/profile/license')} />
          <MenuRow title="Assigned Vehicle" colors={colors} onPress={() => router.push('/profile/vehicle')} />
          <MenuRow title="Safety Settings" isNew={true} colors={colors} onPress={() => router.push('/profile/safety')} />
        </View>

        {/* General Section */}
        <View style={styles.section}>
          <Text style={[type.labelLg, styles.sectionTitle, { color: colors.onSurface }]}>General</Text>
          <MenuRow title="Help Center" colors={colors} onPress={() => router.push('/profile/help')} />
          <MenuRow title="Settings" colors={colors} onPress={() => router.push('/settings')} />
        </View>

        {/* Sign Out */}
        <Pressable
          onPress={() => setLogoutModal(true)}
          style={({ pressed }) => [
            styles.logoutBtn,
            { borderColor: colors.error, opacity: pressed ? 0.7 : 1 },
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
            <Pressable onPress={() => signOut({ allDevices: true })} style={[styles.modalAllBtn, { borderColor: colors.error }]}>
              <Text style={[type.labelLg, styles.modalAllText, { color: colors.error }]}>Sign Out All Devices</Text>
            </Pressable>
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
  scroll: { paddingHorizontal: moderateScale(24), gap: moderateScale(32) },
  
  headerProfile: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(16),
  },
  avatarContainer: {
    position: "relative",
  },
  avatarCircle: {
    width: moderateScale(64),
    height: moderateScale(64),
    borderRadius: moderateScale(32),
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
  },
  editBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: moderateScale(20),
    height: moderateScale(20),
    borderRadius: moderateScale(10),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  profileName: {
  },

  section: {
    gap: moderateScale(8),
  },
  sectionTitle: {
    marginBottom: moderateScale(8),
  },
  
  menuRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: moderateScale(16),
    borderBottomWidth: 1,
    minHeight: TOUCH_TARGET,
  },
  menuRowLeft: {
    flex: 1,
  },
  menuTitle: {
  },
  menuRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },
  newBadge: {
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(2),
    borderRadius: moderateScale(12),
  },
  newBadgeText: {
  },

  logoutBtn: {
    height: moderateScale(56),
    borderRadius: moderateScale(12),
    borderWidth: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
    marginTop: moderateScale(16),
  },
  logoutText: {
  },
  
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: moderateScale(24) },
  modalCard: {
    width: "100%",
    borderRadius: moderateScale(16),
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
  modalAllBtn: { height: moderateScale(44), borderRadius: moderateScale(8), borderWidth: 1, alignItems: "center", justifyContent: "center" },
  modalAllText: { },
  modalActions: { flexDirection: "row", gap: moderateScale(12), marginTop: moderateScale(4) },
  modalCancelBtn: { flex: 1, height: moderateScale(48), borderRadius: moderateScale(8), borderWidth: 1, alignItems: "center", justifyContent: "center" },
  modalCancelText: { },
  modalConfirmBtn: { flex: 1, height: moderateScale(48), borderRadius: moderateScale(8), alignItems: "center", justifyContent: "center" },
  modalConfirmText: { },
});
