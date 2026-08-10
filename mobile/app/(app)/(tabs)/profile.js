import { useCallback, useEffect, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, apiFetch } from "../../../lib/api";
import { useAuth } from "../../../lib/auth";
import { useTheme } from "../../../lib/theme-context";
import { fonts, space } from "../../../lib/theme";
import {
  Button,
  Card,
  Detail,
  EmptyState,
  ErrorNotice,
  Field,
  Metric,
  MetricRow,
  ScreenTitle,
  SkeletonCard,
  styles as ui,
} from "../../../components/ui";
import { BrandBar } from "../../../components/logo";

/**
 * Driver profile: contact info, license, and consent status. Editable fields
 * are limited to what the server allows (PATCH /api/driver/me whitelists
 * phone, face_image_url, license scans); the server remains the authority.
 */
export default function Profile() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { colors } = useTheme();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Full-screen license scan viewer. View-only: the driver can inspect the scan
  // the office holds on file, but re-uploads stay gated behind the server.
  const [viewingScan, setViewingScan] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const me = await api.get("/api/driver/me");
      setProfile(me);
      setPhone(me?.phone ?? "");
    } catch (e) {
      setError(e.message || "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const savePhone = useCallback(async () => {
    if (!phone.trim()) {
      setError("Phone number cannot be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch("/api/driver/me", {
        method: "PATCH",
        body: JSON.stringify({ phone: phone.trim() }),
      });
      setSaved(true);
    } catch (e) {
      setError(e.message || "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }, [phone]);

  const consent = profile?.consent;
  const license = profile?.license;
  const perf = profile?.performance;
  const vehicle = profile?.assignedVehicle;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
      >
        <ScreenTitle title="Your profile" />
        <ErrorNotice message={error} />

        {loading ? (
          <View style={styles.skeletons}>
            <SkeletonCard lines={2} />
            <SkeletonCard lines={3} />
          </View>
        ) : !profile ? (
          <EmptyState title="No profile" message="Could not load your details." />
        ) : (
          <>
            <Card>
              <View style={styles.identity}>
                <View style={[styles.avatarBlock, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.avatarText, { color: colors.onPrimary }]}>
                    {initialsOf(profile.firstName, profile.lastName)}
                  </Text>
                </View>
                <View style={styles.identityText}>
                  <Text style={[styles.identityName, { color: colors.onSurface }]}>
                    {profile.firstName} {profile.lastName}
                  </Text>
                  <Text style={[styles.identityMeta, { color: colors.onSurfaceVariant }]}>{profile.email}</Text>
                </View>
              </View>
            </Card>

            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Assigned Vehicle</Text>
              {vehicle ? (
                <>
                  <Detail
                    label="Plate number"
                    value={vehicle.plateNumber ?? "—"}
                    mono
                  />
                  <Detail
                    label="Vehicle"
                    value={[vehicle.name, vehicle.model].filter(Boolean).join(" · ") || "—"}
                  />
                  {vehicle.seatingCapacity ? (
                    <Detail label="Seats" value={String(vehicle.seatingCapacity)} />
                  ) : null}
                  {vehicle.assignedFrom ? (
                    <Detail
                      label="Assigned since"
                      value={new Date(vehicle.assignedFrom).toLocaleDateString()}
                    />
                  ) : null}
                  {vehicle.vehicleStatus ? (
                    <Detail label="Status" value={vehicle.vehicleStatus} />
                  ) : null}
                </>
              ) : (
                <Text style={[ui.bodyText, { color: colors.onSurfaceVariant }]}>
                  No vehicle is currently assigned to you. Dispatchers will assign a
                  vehicle when a trip is scheduled.
                </Text>
              )}
            </Card>

            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Performance</Text>
              <MetricRow>
                <Metric value={String(perf?.total_trips ?? "—")} label="Trips" />
                <Metric value={String(perf?.total_distance ?? "—")} label="Km" />
                <Metric value={perf?.rating != null ? `${perf.rating}` : "—"} label="Rating" />
              </MetricRow>
            </Card>

            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Contact</Text>
              <Detail label="Phone" value={profile.phone ?? "—"} />
              <Field
                label="Update phone"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                editable={!saving}
              />
              <Button
                label={saving ? "Saving…" : "Save phone"}
                onPress={savePhone}
                loading={saving}
                variant="secondary"
              />
              {saved ? (
                <Text style={[styles.saved, { color: colors.success }]}>Phone updated.</Text>
              ) : null}
            </Card>

            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>License</Text>
              <View style={styles.licenseRow}>
                <View style={styles.licenseFields}>
                  <Detail label="License number" value={license?.number ?? "—"} />
                  <Detail label="Class" value={license?.class ?? "—"} />
                  <Detail label="Type" value={license?.type ?? "—"} />
                  <Detail label="Expires" value={license?.expiry ? new Date(license.expiry).toLocaleDateString() : "—"} />
                </View>
                {/* Only shown once the office has at least one scan on file —
                    otherwise the card keeps its plain details-only layout. */}
                {license?.frontScanImageUrl || license?.backScanImageUrl ? (
                  <View style={styles.licenseScans}>
                    <LicenseScan
                      label="Front"
                      uri={license?.frontScanImageUrl}
                      onPress={() =>
                        setViewingScan({ uri: license.frontScanImageUrl, label: "License — front" })
                      }
                    />
                    <LicenseScan
                      label="Back"
                      uri={license?.backScanImageUrl}
                      onPress={() =>
                        setViewingScan({ uri: license.backScanImageUrl, label: "License — back" })
                      }
                    />
                  </View>
                ) : null}
              </View>
            </Card>

            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Consent</Text>
              <Detail
                label="Policy accepted"
                value={consent?.accepted ? "Yes" : "No"}
              />
              {consent?.acceptedAt ? (
                <Detail
                  label="Accepted on"
                  value={new Date(consent.acceptedAt).toLocaleDateString()}
                />
              ) : null}
              <Detail label="Via" value={consent?.acceptedVia ?? "—"} />
            </Card>

            <Button label="Sign out" variant="critical-tonal" onPress={signOut} />
          </>
        )}
      </ScrollView>

      {/* View-only full-screen scan. Tap anywhere (or Close) to dismiss. */}
      <Modal
        visible={!!viewingScan}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingScan(null)}
      >
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewingScan(null)}>
          <View style={[styles.viewerBar, { paddingTop: insets.top + space.base }]}>
            <Text style={styles.viewerTitle}>{viewingScan?.label}</Text>
          </View>
          <Image
            source={{ uri: viewingScan?.uri }}
            style={styles.viewerImage}
            resizeMode="contain"
            alt={viewingScan?.label ?? "License scan"}
            accessibilityLabel={viewingScan?.label}
          />
          <View style={[styles.viewerFooter, { paddingBottom: insets.bottom + space.xl }]}>
            <Text style={styles.viewerHint}>Tap anywhere to close</Text>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * A license scan thumbnail. Read-only by design — tapping opens the full-screen
 * view; there is no edit affordance here because re-uploads are server-gated
 * (see canUpdateLicenseScan in the driver-visibility config).
 */
function LicenseScan({ label, uri, onPress }) {
  const { colors } = useTheme();
  if (!uri) {
    return (
      <View
        style={[
          styles.scanThumb,
          styles.scanEmpty,
          { borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainer },
        ]}
      >
        <Text style={[styles.scanEmptyText, { color: colors.onSurfaceVariant }]}>
          No {label.toLowerCase()}
        </Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={`View license ${label.toLowerCase()} in full screen`}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      <Image
        source={{ uri }}
        style={[styles.scanThumb, { borderColor: colors.outlineVariant }]}
        resizeMode="cover"
        alt={`License ${label.toLowerCase()}`}
      />
      <Text style={[styles.scanCaption, { color: colors.onSurfaceVariant }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.lg, width: "100%", maxWidth: 720, alignSelf: "center" },
  skeletons: { gap: space.base },
  saved: { fontFamily: fonts.body, fontSize: 13, marginTop: space.xs },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.base,
  },
  avatarBlock: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
  },
  identityText: { flex: 1, gap: 2 },
  identityName: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 24,
  },
  identityMeta: {
    fontFamily: fonts.body,
    fontSize: 13,
  },
  // License card: details on the left, scan thumbnails stacked on the right.
  licenseRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.base,
  },
  licenseFields: { flex: 1, minWidth: 0 },
  licenseScans: { gap: space.sm },
  scanThumb: {
    width: 96,
    height: 62,
    borderRadius: 8,
    borderWidth: 1,
  },
  scanEmpty: { alignItems: "center", justifyContent: "center" },
  scanEmptyText: {
    fontFamily: fonts.body,
    fontSize: 11,
    textAlign: "center",
  },
  scanCaption: {
    fontFamily: fonts.body,
    fontSize: 11,
    marginTop: 2,
    textAlign: "center",
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    justifyContent: "center",
  },
  viewerBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.xl,
    paddingBottom: space.base,
  },
  viewerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    color: "#fff",
  },
  viewerImage: { width: "100%", height: "70%" },
  viewerFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  viewerHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
  },
});

function initialsOf(first, last) {
  return `${(first || "")[0] || ""}${(last || "")[0] || ""}`.toUpperCase() || "?";
}
