import { moderateScale } from '../../../lib/scaling';
import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  TextInput,
  Alert,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api, apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";

function InfoRow({ label, value, colors }) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.surfaceContainerHigh }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

function Section({ title, children, colors }) {
  return (
    <View style={[styles.section, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant }]}>
      <Text style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}>{title}</Text>
      {children}
    </View>
  );
}

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { colors } = useTheme();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [editingPhone, setEditingPhone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoutModal, setLogoutModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api.get("/api/driver/me");
      setProfile(me);
      setPhone(me?.phone ?? "");
    } catch {
      // use fallback from auth context
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const savePhone = async () => {
    if (!phone.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/api/driver/me", {
        method: "PATCH",
        body: JSON.stringify({ phone: phone.trim() }),
      });
      setEditingPhone(false);
      Alert.alert("Saved", "Phone number updated.");
    } catch (e) {
      Alert.alert("Error", e.message || "Could not save phone.");
    } finally {
      setSaving(false);
    }
  };

  const currentUser = profile || user;
  const driverName = currentUser?.name || currentUser?.full_name || "Driver";
  const initials = driverName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Top App Bar */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant, paddingTop: insets.top },
        ]}
      >
        <Text style={[styles.topBarBrand, { color: colors.primary }]}>FleetOps</Text>
        <Text style={[styles.pageTitle, { color: colors.onSurface }]}>Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar Card */}
        <View
          style={[
            styles.avatarCard,
            { backgroundColor: colors.primary },
          ]}
        >
          <View style={[styles.avatarCircle, { backgroundColor: colors.primaryContainer }]}>
            <Text style={[styles.avatarInitials, { color: colors.onPrimaryContainer }]}>{initials}</Text>
          </View>
          <Text style={[styles.profileName, { color: colors.onPrimary }]}>{driverName}</Text>
          <View style={[styles.roleBadge, { backgroundColor: colors.primaryContainer }]}>
            <Text style={[styles.roleBadgeText, { color: colors.onPrimaryContainer }]}>
              DRIVER
            </Text>
          </View>
        </View>

        {/* Personal Info */}
        <Section title="PERSONAL INFORMATION" colors={colors}>
          <InfoRow label="Full Name" value={currentUser?.name || currentUser?.full_name} colors={colors} />
          <InfoRow label="Employee ID" value={currentUser?.driver_id || currentUser?.id} colors={colors} />
          <InfoRow label="Email" value={currentUser?.email} colors={colors} />
          {/* Phone — editable */}
          <View style={[styles.infoRow, { borderBottomColor: colors.surfaceContainerHigh }]}>
            <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>Phone</Text>
            {editingPhone ? (
              <View style={styles.phoneEdit}>
                <TextInput
                  style={[styles.phoneInput, { borderColor: colors.outline, color: colors.onSurface }]}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="Phone number"
                  placeholderTextColor={colors.outline}
                />
                <Pressable onPress={savePhone} disabled={saving}>
                  <Ionicons name="checkmark-circle" size={24} color={colors.secondary} />
                </Pressable>
                <Pressable onPress={() => setEditingPhone(false)}>
                  <Ionicons name="close-circle" size={24} color={colors.outline} />
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.phoneRow} onPress={() => setEditingPhone(true)}>
                <Text style={[styles.infoValue, { color: colors.onSurface }]}>
                  {phone || "—"}
                </Text>
                <Ionicons name="pencil-outline" size={16} color={colors.primary} />
              </Pressable>
            )}
          </View>
        </Section>

        {/* License Info */}
        <Section title="LICENSE & COMPLIANCE" colors={colors}>
          <InfoRow label="License No." value={currentUser?.license_number} colors={colors} />
          <InfoRow label="License Class" value={currentUser?.license_class} colors={colors} />
          <InfoRow
            label="Expiry"
            value={
              currentUser?.license_expiry
                ? new Date(currentUser.license_expiry).toLocaleDateString()
                : null
            }
            colors={colors}
          />
        </Section>

        {/* Consent Status */}
        <Section title="PRIVACY CONSENT" colors={colors}>
          <View style={[styles.infoRow, { borderBottomColor: "transparent" }]}>
            <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>
              Data Consent
            </Text>
            <View
              style={[
                styles.consentBadge,
                {
                  backgroundColor:
                    currentUser?.data_consent_given ? colors.secondaryContainer : colors.errorContainer,
                },
              ]}
            >
              <Ionicons
                name={currentUser?.data_consent_given ? "checkmark-circle" : "close-circle"}
                size={14}
                color={
                  currentUser?.data_consent_given
                    ? colors.onSecondaryContainer
                    : colors.onErrorContainer
                }
              />
              <Text
                style={[
                  styles.consentText,
                  {
                    color: currentUser?.data_consent_given
                      ? colors.onSecondaryContainer
                      : colors.onErrorContainer,
                  },
                ]}
              >
                {currentUser?.data_consent_given ? "GIVEN" : "NOT GIVEN"}
              </Text>
            </View>
          </View>
        </Section>

        {/* Sign Out */}
        <Pressable
          onPress={() => setLogoutModal(true)}
          style={({ pressed }) => [
            styles.logoutBtn,
            { borderColor: colors.error, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={[styles.logoutText, { color: colors.error }]}>Sign Out</Text>
        </Pressable>
      </ScrollView>

      {/* Logout Confirm Modal */}
      <Modal visible={logoutModal} transparent animationType="fade" onRequestClose={() => setLogoutModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant }]}>
            <Text style={[styles.modalTitle, { color: colors.onSurface }]}>Sign Out?</Text>
            <Text style={[styles.modalBody, { color: colors.onSurfaceVariant }]}>
              You will be returned to the login screen.
            </Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setLogoutModal(false)} style={[styles.modalCancelBtn, { borderColor: colors.outline }]}>
                <Text style={[styles.modalCancelText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={signOut} style={[styles.modalConfirmBtn, { backgroundColor: colors.error }]}>
                <Text style={[styles.modalConfirmText, { color: colors.onError }]}>Sign Out</Text>
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
  topBar: {
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(12),
    borderBottomWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  topBarBrand: { fontSize: moderateScale(24), fontFamily: fonts.displayBold, lineHeight: moderateScale(32) },
  pageTitle: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  scroll: { gap: moderateScale(16), paddingHorizontal: moderateScale(16), paddingTop: moderateScale(20) },
  avatarCard: {
    borderRadius: moderateScale(16),
    padding: moderateScale(24),
    alignItems: "center",
    gap: moderateScale(8),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarCircle: {
    width: moderateScale(80),
    height: moderateScale(80),
    borderRadius: moderateScale(40),
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { fontSize: moderateScale(32), fontFamily: fonts.displayBold },
  profileName: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  roleBadge: { paddingHorizontal: moderateScale(16), paddingVertical: moderateScale(4), borderRadius: moderateScale(999) },
  roleBadgeText: { fontSize: moderateScale(12), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(16), letterSpacing: 0.5 },
  section: {
    borderRadius: moderateScale(12),
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: moderateScale(12),
    fontFamily: fonts.bodySemiBold,
    lineHeight: moderateScale(16),
    letterSpacing: 1,
    textTransform: "uppercase",
    padding: moderateScale(16),
    paddingBottom: moderateScale(12),
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(12),
    borderBottomWidth: 1,
    minHeight: TOUCH_TARGET,
  },
  infoLabel: { fontSize: moderateScale(14), fontFamily: fonts.body, lineHeight: moderateScale(20), flex: 1 },
  infoValue: { fontSize: moderateScale(14), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(20), textAlign: "right", flex: 1 },
  phoneEdit: { flexDirection: "row", alignItems: "center", gap: moderateScale(8), flex: 1 },
  phoneInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: moderateScale(8),
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(6),
    fontSize: moderateScale(14),
    fontFamily: fonts.body,
    height: moderateScale(36),
  },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(8), flex: 1, justifyContent: "flex-end" },
  consentBadge: { flexDirection: "row", alignItems: "center", gap: moderateScale(4), paddingHorizontal: moderateScale(10), paddingVertical: moderateScale(3), borderRadius: moderateScale(999) },
  consentText: { fontSize: moderateScale(12), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(16) },
  logoutBtn: {
    height: moderateScale(56),
    borderRadius: moderateScale(12),
    borderWidth: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
  },
  logoutText: { fontSize: moderateScale(14), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(20) },
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
  modalTitle: { fontSize: moderateScale(20), fontFamily: fonts.displayBold, lineHeight: moderateScale(28) },
  modalBody: { fontSize: moderateScale(14), fontFamily: fonts.body, lineHeight: moderateScale(20) },
  modalActions: { flexDirection: "row", gap: moderateScale(12), marginTop: moderateScale(4) },
  modalCancelBtn: { flex: 1, height: moderateScale(48), borderRadius: moderateScale(8), borderWidth: 1, alignItems: "center", justifyContent: "center" },
  modalCancelText: { fontSize: moderateScale(14), fontFamily: fonts.bodySemiBold },
  modalConfirmBtn: { flex: 1, height: moderateScale(48), borderRadius: moderateScale(8), alignItems: "center", justifyContent: "center" },
  modalConfirmText: { fontSize: moderateScale(14), fontFamily: fonts.bodySemiBold },
});
