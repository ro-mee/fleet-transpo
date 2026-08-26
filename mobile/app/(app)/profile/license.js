import React, { useState, useCallback, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Image, Modal } from 'react-native';
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useTheme } from "../../../lib/theme-context";
import { fonts, TOUCH_TARGET, statusSurfaces } from "../../../lib/theme";
import { api } from "../../../lib/api";
import { AppAlert } from '../../../components/AppAlert';
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

function InfoRow({ label, value, colors, isLast = false }) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.surfaceContainerHigh, borderBottomWidth: isLast ? 0 : 1 }]}>
      <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.onSurface }]}>{value || "—"}</Text>
    </View>
  );
}

function ScanSourceButtons({ side, colors, busy, onPick }) {
  const disabled = busy !== null;
  const isUploading = busy === side;
  return (
    <View style={styles.sourceRow}>
      <Pressable
        onPress={() => onPick(side, "camera")}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Take a photo of the ${side} of your license`}
        style={({ pressed }) => [
          styles.sourceBtn,
          { backgroundColor: colors.primary, opacity: isUploading || pressed ? 0.85 : 1 },
        ]}
      >
        {isUploading ? (
          <ActivityIndicator size="small" color={colors.onPrimary} />
        ) : (
          <Ionicons name="camera-outline" size={16} color={colors.onPrimary} />
        )}
        <Text style={[styles.sourceBtnText, { color: colors.onPrimary }]}>
          {isUploading ? "Working…" : "Take Photo"}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onPick(side, "gallery")}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Choose an existing photo of the ${side} of your license`}
        style={({ pressed }) => [
          styles.sourceBtn,
          styles.sourceBtnSecondary,
          { borderColor: colors.outlineVariant, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="images-outline" size={16} color={colors.primary} />
        <Text style={[styles.sourceBtnText, { color: colors.primary }]}>Gallery</Text>
      </Pressable>
    </View>
  );
}

export default function LicenseInformation() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploadingSide, setUploadingSide] = useState(null);
  const [viewerImage, setViewerImage] = useState(null);

  const load = useCallback(async () => {
    try {
      const me = await api.get("/api/driver/me");
      setProfile(me);
    } catch {
      AppAlert.alert("Error", "Could not load license info.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
  // Deferred one tick: mount-fetch semantics without sync setState in the effect body.
  const t = setTimeout(load, 0);
  return () => clearTimeout(t);
}, [load]);

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
        await load();
      }
    } catch (e) {
      AppAlert.alert("Upload Failed", e.message || "The scan could not be uploaded. Check your connection and try again.");
    } finally {
      setUploadingSide(null);
    }
  }, [uploadingSide, load]);

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

  const surfaces = statusSurfaces(colors);
  const statusColorsMap = {
    danger: { bg: surfaces.danger, fg: colors.error },
    warning: { bg: surfaces.warning, fg: colors.warning },
    success: { bg: surfaces.success, fg: colors.success },
    neutral: { bg: surfaces.neutral, fg: colors.onSurfaceVariant },
  };
  const statusTone = statusColorsMap[status.tone];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[type.titleLg, styles.headerTitle, { color: colors.onSurface }]}>License & Compliance</Text>
        <View style={{ width: TOUCH_TARGET }} />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
          <InfoRow label="License Number" value={license?.number} colors={colors} />
          <InfoRow label="License Class" value={license?.class} colors={colors} />
          <InfoRow label="License Type" value={license?.type} colors={colors} />
          <InfoRow
            label="Expiry Date"
            value={license?.expiry ? formatExpiry(license.expiry) : null}
            colors={colors}
          />
          <View style={[styles.infoRow, { borderBottomColor: colors.surfaceContainerHigh, borderBottomWidth: 1 }]}>
            <Text style={[styles.infoLabel, { color: colors.onSurfaceVariant }]}>Compliance Status</Text>
            <View style={[styles.statusPill, { backgroundColor: statusTone.bg }]}>
              <Text style={[styles.statusPillText, { color: statusTone.fg }]}>{status.label}</Text>
            </View>
          </View>
          <InfoRow label="Years Experience" value={`${license?.yearsExperience || 0} Years`} colors={colors} isLast={true} />
        </View>

        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.outlineVariant, padding: 16, gap: 16 }]}>
          <Text style={[type.label, styles.sectionHeading, { color: colors.primary }]}>Document Scans</Text>

          <View style={[styles.scanBox, { borderColor: colors.outlineVariant }]}>
            <View style={styles.scanHeader}>
              <Text style={[styles.scanTitle, { color: colors.onSurface }]}>Front of License</Text>
              {license?.frontScanImageUrl ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : (
                <Ionicons name="alert-circle" size={20} color={colors.warning} />
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
                colors={colors}
                busy={uploadingSide}
                onPick={handleUpload}
              />
            )}
          </View>

          <View style={[styles.scanBox, { borderColor: colors.outlineVariant }]}>
            <View style={styles.scanHeader}>
              <Text style={[styles.scanTitle, { color: colors.onSurface }]}>Back of License</Text>
              {license?.backScanImageUrl ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              ) : (
                <Ionicons name="alert-circle" size={20} color={colors.warning} />
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
                colors={colors}
                busy={uploadingSide}
                onPick={handleUpload}
              />
            )}
          </View>

        </View>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  backBtn: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center" },
  scroll: { padding: 16, paddingTop: 24, gap: 24 },

  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: TOUCH_TARGET,
  },
  infoLabel: { fontSize: 14, fontFamily: fonts.body, flex: 1 },
  infoValue: { fontSize: 14, fontFamily: fonts.bodyMedium, textAlign: "right", flex: 1 },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusPillText: { fontSize: 12, fontFamily: fonts.bodySemiBold },

  sectionHeading: {},
  scanBox: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
  },
  scanHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  scanTitle: { fontSize: 14, fontFamily: fonts.bodyMedium },
  sourceRow: { flexDirection: "row", gap: 10 },
  sourceBtn: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  sourceBtnSecondary: { borderWidth: 1, backgroundColor: "transparent" },
  sourceBtnText: { fontSize: 13, fontFamily: fonts.bodySemiBold },

  previewWrap: {
    height: 140,
    borderRadius: 8,
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
