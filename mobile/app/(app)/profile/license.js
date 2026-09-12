import React, { useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Image, Modal } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../../lib/theme";
import { api } from "../../../lib/api";
import { useDriverProfile } from "../../../lib/driver-profile";
import { AppAlert } from '../../../components/AppAlert';
import ClayScreenHeader from '../../../components/ClayScreenHeader';
import { ClayBadge, ClayButton, ClayCard } from "../../../components/clay";
import { notify } from "../../../lib/notifications/notify";

const SCAN_MAX_WIDTH = 1400;
const SCAN_COMPRESS = 0.72;

function daysUntilExpiry(expiry) {
  const s = String(expiry || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000);
}

function formatExpiry(expiry) {
  const s = String(expiry || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString();
}

function InfoRow({ label, value, colors, isLast = false, isDark = false }) {
  return (
    <View style={[styles.infoRow, { borderBottomWidth: isLast ? 0 : 1, borderBottomColor: isDark ? colors.outlineVariant + "55" : "transparent" }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

function ScanSourceButtons({ side, busy, onPick }) {
  const disabled = busy !== null;
  const isUploading = busy === side;
  return (
    <View style={styles.sourceRow}>
      <ClayButton
        label={isUploading ? "Working…" : "Take Photo"}
        variant="primary"
        icon="camera-outline"
        loading={isUploading}
        disabled={disabled}
        onPress={() => onPick(side, "camera")}
        accessibilityLabel={`Take a photo of the ${side} of your license`}
        style={{ flex: 1 }}
      />
      <ClayButton
        label="Gallery"
        variant="outline"
        icon="images-outline"
        disabled={disabled}
        onPress={() => onPick(side, "gallery")}
        accessibilityLabel={`Choose an existing photo of the ${side} of your license`}
        style={{ flex: 1 }}
      />
    </View>
  );
}

export default function LicenseInformation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";

  // Cached /api/driver/me read — offline falls back to the saved profile
  // silently; the alert only fires when nothing was ever saved.
  const { profile, loading, reload } = useDriverProfile({
    onError: () => AppAlert.alert("Error", "Could not load license info."),
  });

  const [uploadingSide, setUploadingSide] = useState(null);
  const [viewerImage, setViewerImage] = useState(null);

  const toDataUrl = async (asset) => {
    const context = ImageManipulator.manipulate(asset.uri);
    if ((asset.width || 0) > SCAN_MAX_WIDTH) context.resize({ width: SCAN_MAX_WIDTH });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: SCAN_COMPRESS, format: SaveFormat.JPEG, base64: true });
    if (!saved.base64) throw new Error("The image could not be processed.");
    return `data:image/jpeg;base64,${saved.base64}`;
  };

  const verifyAndSaveScan = async (side, dataUrl) => {
    const result = await api.post(
      "/api/driver/license-scan",
      { side, file_url: dataUrl },
      { queueOnFailure: false }
    );
    if (!result?.ok) {
      const reason = result?.validation_issues?.[0];
      const title = /does not look like|not a/i.test(reason || "") ? "Not a License Card" : "Scan Unreadable";
      AppAlert.alert(
        title,
        reason ||
          "We could not read the license photo clearly. Retake with better lighting and keep the card flat and fully in frame."
      );
      return null;
    }
    return result;
  };

  const handleUpload = useCallback(async (side, source) => {
    if (uploadingSide !== null) return;
    try {
      setUploadingSide(side);
      const permission = source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== "granted") {
        AppAlert.alert(
          "Permission Required",
          source === "camera"
            ? "Camera permission is required to photograph your license."
            : "Photo library permission is required to select your license scan."
        );
        return;
      }
      const options = { mediaTypes: ["images"], quality: 0.8 };
      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        AppAlert.alert("File Too Large", "Please select an image smaller than 5MB.");
        return;
      }
      if (asset.mimeType && asset.mimeType !== "image/jpeg" && asset.mimeType !== "image/png") {
        AppAlert.alert("Invalid Format", "Only JPEG and PNG images are allowed.");
        return;
      }

      const dataUrl = await toDataUrl(asset);
      const saved = await verifyAndSaveScan(side, dataUrl);
      if (saved) {
        notify.toast({
          message: saved.applied_license_expiry
            ? `License ${side} updated — new expiry ${formatExpiry(saved.applied_license_expiry)}.`
            : `License ${side} scan updated successfully.`,
          tone: "success",
        });
        await reload();
      }
    } catch (e) {
      AppAlert.alert("Upload Failed", e.message || "The scan could not be uploaded. Check your connection and try again.");
    } finally {
      setUploadingSide(null);
    }
  }, [uploadingSide, reload]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const license = profile?.license;
  const EXPIRY_WARNING_DAYS = 30;

  const days = daysUntilExpiry(license?.expiry);
  let status;
  if (days === null) status = { tone: "neutral", label: "No expiry on file" };
  else if (days < 0) status = { tone: "danger", label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago` };
  else if (days <= EXPIRY_WARNING_DAYS) status = { tone: "warning", label: days === 0 ? "Expires today" : `Expires in ${days} day${days === 1 ? "" : "s"}` };
  else status = { tone: "success", label: "Valid" };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="License & Compliance" onBack={() => router.back()} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        <ClayCard variant="standard" style={styles.sectionCard}>
          <InfoRow label="License Number" value={license?.number} colors={colors} isDark={isDark} />
          <InfoRow label="License Class" value={license?.class} colors={colors} isDark={isDark} />
          <InfoRow label="License Type" value={license?.type} colors={colors} isDark={isDark} />
          <InfoRow
            label="Expiry Date"
            value={license?.expiry ? formatExpiry(license.expiry) : null}
            colors={colors}
            isDark={isDark}
          />
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>Compliance Status</Text>
            <ClayBadge label={status.label} tone={status.tone} dot />
          </View>
          <InfoRow label="Years Experience" value={`${license?.yearsExperience || 0} Years`} colors={colors} isLast={true} isDark={isDark} />
        </ClayCard>

        <ClayCard variant="standard" style={[styles.sectionCard, { padding: 20, gap: 16 }]}>
          <Text style={[styles.sectionHeading, { color: colors.primary }]}>Document Scans</Text>

          <ClayCard variant="compact" style={styles.scanBox}>
            <View style={styles.scanHeader}>
              <Text style={[styles.scanTitle, { color: colors.onSurface }]}>Front of License</Text>
              {license?.frontScanImageUrl ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.secondary || colors.primary} />
              ) : (
                <Ionicons name="alert-circle" size={20} color={colors.error} />
              )}
            </View>
            {license?.frontScanImageUrl && (
              <Pressable onPress={() => setViewerImage(license.frontScanImageUrl)} style={styles.previewWrap}>
                <Image source={{ uri: license.frontScanImageUrl }} style={styles.licensePreview} resizeMode="cover" />
                <View style={styles.previewOverlay}>
                  <Ionicons name="scan" size={20} color="#FFF" />
                  <Text style={styles.previewText}>Tap to View</Text>
                </View>
              </Pressable>
            )}
            {(!license?.frontScanImageUrl || status.tone !== "success") && (
              <ScanSourceButtons
                side="front"
                busy={uploadingSide}
                onPick={handleUpload}
              />
            )}
          </ClayCard>

          <ClayCard variant="compact" style={styles.scanBox}>
            <View style={styles.scanHeader}>
              <Text style={[styles.scanTitle, { color: colors.onSurface }]}>Back of License</Text>
              {license?.backScanImageUrl ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.secondary || colors.primary} />
              ) : (
                <Ionicons name="alert-circle" size={20} color={colors.error} />
              )}
            </View>
            {license?.backScanImageUrl && (
              <Pressable onPress={() => setViewerImage(license.backScanImageUrl)} style={styles.previewWrap}>
                <Image source={{ uri: license.backScanImageUrl }} style={styles.licensePreview} resizeMode="cover" />
                <View style={styles.previewOverlay}>
                  <Ionicons name="scan" size={20} color="#FFF" />
                  <Text style={styles.previewText}>Tap to View</Text>
                </View>
              </Pressable>
            )}
            {(!license?.backScanImageUrl || status.tone !== "success") && (
              <ScanSourceButtons
                side="back"
                busy={uploadingSide}
                onPick={handleUpload}
              />
            )}
          </ClayCard>

        </ClayCard>
      </ScrollView>

      <Modal visible={!!viewerImage} transparent={true} animationType="fade" onRequestClose={() => setViewerImage(null)}>
        <View style={styles.viewerContainer}>
          <Pressable style={styles.viewerCloseArea} onPress={() => setViewerImage(null)} />
          <Image source={{ uri: viewerImage }} style={styles.viewerImage} resizeMode="contain" />
          <Pressable onPress={() => setViewerImage(null)} style={[styles.viewerCloseBtn, { top: insets.top + 20 }]}>
            <Ionicons name="close" size={24} color="#FFF" />
          </Pressable>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  root: { flex: 1 },
  scroll: { paddingHorizontal: 18, paddingTop: 14, gap: 24 },

  sectionCard: {
    borderRadius: 30,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    minHeight: TOUCH_TARGET,
  },
  infoLabel: { fontSize: 14, fontFamily: fonts.body, flex: 1 },
  infoValue: { fontSize: 14, fontFamily: fonts.bodyMedium, textAlign: "right", flex: 1 },

  sectionHeading: { fontSize: 13, fontFamily: fonts.dataSemiBold, letterSpacing: 0.8, textTransform: "uppercase" },
  scanBox: {
    padding: 16,
    gap: 12,
  },
  scanHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  scanTitle: { fontSize: 14, fontFamily: fonts.bodyMedium },
  sourceRow: { flexDirection: "row", gap: 10 },

  previewWrap: {
    height: 140,
    borderRadius: 18,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#000",
  },
  licensePreview: {
    width: "100%",
    height: "100%",
    opacity: 0.8,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    gap: 4,
  },
  previewText: {
    color: "#FFF",
    fontSize: 12,
    fontFamily: fonts.bodySemiBold,
  },

  viewerContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  viewerCloseArea: {
    ...StyleSheet.absoluteFillObject,
  },
  viewerImage: {
    width: "100%",
    height: "80%",
  },
  viewerCloseBtn: {
    position: "absolute",
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
});
