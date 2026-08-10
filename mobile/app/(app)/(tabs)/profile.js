import { useCallback, useEffect, useState } from "react";
import {
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
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
      >
        <ScreenTitle eyebrow="Driver" title="Your profile" />
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
              <Detail label="License number" value={license?.number ?? "—"} />
              <Detail label="Class" value={license?.class ?? "—"} />
              <Detail label="Type" value={license?.type ?? "—"} />
              <Detail label="Expires" value={license?.expiry ? new Date(license.expiry).toLocaleDateString() : "—"} />
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

            <Button label="Sign out" variant="outline" onPress={signOut} />
          </>
        )}
      </ScrollView>
    </View>
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
});

function initialsOf(first, last) {
  return `${(first || "")[0] || ""}${(last || "")[0] || ""}`.toUpperCase() || "?";
}
