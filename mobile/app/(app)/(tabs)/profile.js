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
import { fonts } from "../../../lib/theme";
import { clayMaterials } from "../../../lib/clay";
import ClayMenuRow from "../../../components/ClayMenuRow";
import { ClayCard, ClayButton } from "../../../components/clay";


const ACCOUNT_ROWS = [
  { title: "Personal Information", icon: "person-outline", route: "/profile/personal" },
];

const PRIVACY_SECURITY_ROWS = [
  { title: "Privacy & Consent", icon: "lock-closed-outline", route: "/profile/privacy" },
  { title: "App Permissions", icon: "shield-checkmark-outline", route: "/profile/permissions" },
  { title: "Devices & Sessions", icon: "phone-portrait-outline", route: "/devices" },
];

const GENERAL_ROWS = [
  { title: "Help Center", icon: "help-circle-outline", route: "/profile/help" },
  { title: "About FleetOps", icon: "information-circle-outline", route: "/profile/about" },
  { title: "Settings", icon: "settings-outline", route: "/settings" },
];

function Section({ title, rows, colors, type, onNavigate }) {
  return (
    <View style={styles.section}>
      <Text style={[type.labelLg, styles.sectionTitle, { color: colors.onSurfaceVariant }]}>{title}</Text>
      <ClayCard variant="compact" style={styles.sectionCard} showSheen={false}>
        {rows.map((row, i) => (
          <ClayMenuRow
            key={row.route}
            title={row.title}
            icon={row.icon}
            isLast={i === rows.length - 1}
            onPress={() => onNavigate(row.route)}
          />
        ))}
      </ClayCard>
    </View>
  );
}

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === "dark");
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
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 96 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity — compact horizontal clay card */}
        <ClayCard variant="compact" style={styles.identityCard}>
          <View style={styles.avatarContainer}>

            <View
              style={[
                styles.avatarCircle,
                { backgroundColor: colors.primaryContainer, borderTopColor: mats.clayTile.borderTopColor, borderBottomWidth: 2, borderBottomColor: mats.clayTile.borderBottomColor },
              ]}
            >
              <Text style={[type.headlineMd, styles.avatarInitials, { color: colors.onPrimaryContainer }]}>{initials}</Text>
            </View>
            <View
              style={[
                styles.editBadge,
                {
                  backgroundColor: colors.surfaceContainerHigh,
                  borderTopWidth: 1,
                  borderTopColor: mats.clayTile.borderTopColor,
                  borderBottomWidth: 1.5,
                  borderBottomColor: mats.clayTile.borderBottomColor,
                  shadowColor: colors.shadow,
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: 0.12,
                  shadowRadius: 4,
                  elevation: 2,
                },
              ]}
            >
              <Ionicons name="pencil" size={12} color={colors.onSurfaceVariant} />
            </View>
          </View>
          <View style={styles.identityText}>
            <Text style={[type.titleLg, styles.profileName, { color: colors.onSurface }]}>{driverName}</Text>
            {currentUser?.status ? (
              <View style={[styles.statusPill, mats.clayPill, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 4, elevation: 2 }]}>
                <Text style={[type.caption, { color: colors.onPrimaryContainer }]}>
                  {String(currentUser.status)}
                </Text>
              </View>
            ) : null}
          </View>
        </ClayCard>

        <Section title="Account" rows={ACCOUNT_ROWS} colors={colors} type={type} onNavigate={router.push} />
        <Section title="Privacy & Security" rows={PRIVACY_SECURITY_ROWS} colors={colors} type={type} onNavigate={router.push} />
        <Section title="General" rows={GENERAL_ROWS} colors={colors} type={type} onNavigate={router.push} />

        {/* Sign Out — soft destructive clay: important, but not the same
            danger level as a destructive confirm, so no harsh red outline.
            Puffy clay edges (white top-light, shaded bottom) keep it in the
            clay language; the modal's confirm carries the strong error red. */}
        <Pressable
          onPress={() => setLogoutModal(true)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.logoutBtn,
            {
              backgroundColor: colors.errorContainer,
              borderColor: colors.error + "24",
              borderTopColor: mats.clayCta.borderTopColor,
              borderBottomColor: mats.clayCta.borderBottomColor,
              shadowColor: colors.shadow,
              opacity: pressed ? 0.92 : 1,
              transform: [{ scale: pressed ? 0.985 : 1 }],
            },
          ]}
        >
          <View
            style={[
              styles.logoutIconTile,
              {
                backgroundColor: colors.error + "14",
                borderTopColor: mats.clayTile.borderTopColor,
                borderBottomColor: mats.clayTile.borderBottomColor,
                shadowColor: colors.shadow,
              },
            ]}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.onErrorContainer} />
          </View>
          <Text style={[type.labelLg, styles.logoutText, { color: colors.onErrorContainer }]}>Sign Out</Text>
        </Pressable>
      </ScrollView>

      {/* Logout Confirm Modal — a raised clay card: soft-destructive
          medallion, centered copy, clay Cancel (raised surface) and clay
          Confirm (solid error, the actual destructive action). */}
      <Modal visible={logoutModal} transparent animationType="fade" onRequestClose={() => setLogoutModal(false)}>
        <View style={styles.modalBackdrop}>
          <ClayCard variant="standard" style={styles.modalCard}>
            <View
              style={[
                styles.modalIconWrap,
                {
                  backgroundColor: colors.errorContainer,
                  borderTopColor: mats.clayTile.borderTopColor,
                  borderBottomColor: mats.clayTile.borderBottomColor,
                  shadowColor: colors.shadow,
                },
              ]}
            >
              <Ionicons name="log-out-outline" size={26} color={colors.onErrorContainer} />
            </View>
            <Text style={[type.titleLg, styles.modalTitle, { color: colors.onSurface }]}>Sign Out?</Text>
            <Text style={[type.bodyMd, styles.modalBody, { color: colors.onSurfaceVariant }]}>
              You will be returned to the login screen.
            </Text>
            <View style={styles.modalActions}>
              <ClayButton
                label="Cancel"
                variant="tonal"
                onPress={() => setLogoutModal(false)}
                style={{ flex: 1 }}
              />
              <ClayButton
                label="Sign Out"
                variant="danger"
                onPress={signOut}
                style={{ flex: 1 }}
              />
            </View>
          </ClayCard>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 14 },

  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 14,
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
    borderTopWidth: 2,
  },
  avatarInitials: {
  },
  editBadge: {
    position: "absolute",
    bottom: -2,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  identityText: { flexShrink: 1, gap: 6 },
  profileName: {
  },
  statusPill: { alignSelf: "flex-start" },

  section: {
    gap: 6,
  },
  sectionTitle: {
    marginLeft: 8,
    fontFamily: fonts.dataSemiBold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionCard: {
    borderRadius: 24,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },

  logoutBtn: {
    minHeight: moderateScale(52),
    borderRadius: moderateScale(18),
    borderWidth: 1,
    borderTopWidth: 2,
    borderBottomWidth: 2.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(10),
    marginTop: moderateScale(12),
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  logoutIconTile: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(15),
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 1.5,
    borderBottomWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  logoutText: {
    fontFamily: fonts.bodySemiBold,
  },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: moderateScale(24) },
  modalCard: {
    width: "100%",
    borderRadius: 30,
    padding: moderateScale(24),
    gap: moderateScale(10),
    alignItems: "center",
  },
  modalIconWrap: {
    width: moderateScale(64),
    height: moderateScale(64),
    borderRadius: moderateScale(32),
    alignItems: "center",
    justifyContent: "center",
    marginTop: moderateScale(4),
    marginBottom: moderateScale(4),
    borderTopWidth: 2,
    borderBottomWidth: 3,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 7,
    elevation: 3,
  },
  modalTitle: { },
  modalBody: { textAlign: "center", paddingHorizontal: moderateScale(8) },
  modalActions: { flexDirection: "row", gap: moderateScale(12), marginTop: moderateScale(8), alignSelf: "stretch" },
});
