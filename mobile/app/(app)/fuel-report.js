import { moderateScale } from '../../lib/scaling';
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, radius, TOUCH_TARGET } from "../../lib/theme";
import { api } from "../../lib/api";
import * as ImagePicker from "expo-image-picker";

export default function FuelReport() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tripId, id, odometer: pOdometer, liters: pLiters, cost: pCost, station: pStation } = useLocalSearchParams();
  const { colors } = useTheme();

  const [mode, setMode] = useState("overview"); // overview | manual
  const [odometer, setOdometer] = useState(pOdometer || "");
  const [liters, setLiters] = useState(pLiters || "");
  const [cost, setCost] = useState(pCost || "");
  const [station, setStation] = useState(pStation || "");
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [submittedRecord, setSubmittedRecord] = useState(null);

  const handleScan = async (useCamera = true) => {
    try {
      let result;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert("Permission Required", "Camera permission is required to scan receipts.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.5,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert("Permission Required", "Photo library permission is required to upload receipts.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.5,
        });
      }

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        await processReceipt(asset);
      }
    } catch (e) {
      Alert.alert("Error", "Could not capture receipt image.");
    }
  };

  const processReceipt = async (asset) => {
    try {
      setScanning(true);
      
      const formData = new FormData();
      formData.append('receipt', {
        uri: asset.uri,
        name: asset.fileName || 'receipt.jpg',
        type: asset.mimeType || 'image/jpeg',
      });

      const res = await api.post("/api/mobile/fuel/scan", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (res.receipt_url) {
        setReceiptUrl(res.receipt_url);
      }

      if (res.extracted_data) {
        const d = res.extracted_data;
        if (d.liters) setLiters(String(d.liters));
        if (d.amount) setCost(String(d.amount));
        if (d.station_name) setStation(d.station_name);
        setMode("manual"); // Open the form so they can verify the extracted data
        Alert.alert("Receipt Scanned", "Please verify the extracted details.");
      } else {
         Alert.alert("Scan Complete", "Could not automatically read details. Please enter them manually.");
         setMode("manual");
      }
    } catch (e) {
      Alert.alert("Scan Error", e.message || "Failed to process receipt.");
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async () => {
    if (!odometer || !liters || !cost) {
      Alert.alert("Missing Fields", "Enter Odometer, Volume, and Total Cost.");
      return;
    }
    try {
      const payload = {
        odometer: parseFloat(odometer.replace(/,/g, "")),
        liters: parseFloat(liters.replace(/,/g, "")),
        amount: parseFloat(cost.replace(/,/g, "")),
        total_cost: parseFloat(cost.replace(/,/g, "")),
        station_name: station || "Unspecified",
        fuel_date: new Date().toISOString(),
        fuel_type: "Diesel",
        receipt_url: receiptUrl,
      };

      let res;
      if (id) {
        res = await api.put(`/api/mobile/fuel/${id}`, payload);
      } else {
        payload.trip_id = tripId && tripId !== "undefined" ? parseInt(tripId, 10) : null;
        res = await api.post("/api/mobile/fuel", payload);
      }
      setSubmittedRecord(res);
    } catch (e) {
      Alert.alert("Error", e.message || "Could not save fuel entry.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedRecord) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, padding: moderateScale(24), justifyContent: 'center', alignItems: 'center' }]}>
        <View style={{ width: '100%', maxWidth: moderateScale(400), backgroundColor: colors.surfaceContainerLowest, borderRadius: moderateScale(24), padding: moderateScale(32), alignItems: 'center', borderWidth: 1, borderColor: colors.outlineVariant, shadowColor: "#000", shadowOffset: { width: 0, height: moderateScale(4) }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 8 }}>
          
          <View style={{ width: moderateScale(120), height: moderateScale(120), borderRadius: moderateScale(60), backgroundColor: colors.primaryContainer, justifyContent: 'center', alignItems: 'center', marginBottom: moderateScale(24) }}>
            <Ionicons name="checkmark" size={64} color={colors.primary} />
          </View>

          <Text style={{ fontSize: moderateScale(24), fontWeight: '700', color: colors.onSurface, marginBottom: moderateScale(12), textAlign: 'center' }}>
            Fuel Report Submitted
          </Text>
          <Text style={{ fontSize: moderateScale(16), color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: moderateScale(32), lineHeight: moderateScale(24) }}>
            Your fuel expense report has been successfully recorded.
          </Text>

          <View style={{ width: '100%', backgroundColor: colors.surfaceContainerLow, borderRadius: moderateScale(16), padding: moderateScale(20), gap: moderateScale(16) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: moderateScale(15), fontWeight: '600', color: colors.onSurfaceVariant }}>Report ID</Text>
              <Text style={{ fontSize: moderateScale(18), fontWeight: '700', color: colors.onSurface }}>
                FR-{String(submittedRecord.fuel_record_id || submittedRecord.id || "0000").padStart(5, '0')}
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: colors.outlineVariant, opacity: 0.5 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: moderateScale(15), fontWeight: '600', color: colors.onSurfaceVariant }}>Amount</Text>
              <Text style={{ fontSize: moderateScale(18), fontWeight: '700', color: colors.onSurface }}>
                ₱{parseFloat(submittedRecord.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: colors.outlineVariant, opacity: 0.5 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: moderateScale(15), fontWeight: '600', color: colors.onSurfaceVariant }}>Status</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#a7f3d0', paddingHorizontal: moderateScale(12), paddingVertical: moderateScale(6), borderRadius: moderateScale(8), gap: moderateScale(6) }}>
                <Ionicons name="time-outline" size={16} color="#065f46" />
                <Text style={{ fontSize: moderateScale(14), fontWeight: '700', color: "#065f46" }}>Pending Review</Text>
              </View>
            </View>
          </View>

          <Pressable
            onPress={() => router.back()}
            style={{ width: '100%', backgroundColor: colors.primary, paddingVertical: moderateScale(16), borderRadius: moderateScale(100), alignItems: 'center', marginTop: moderateScale(40) }}
          >
            <Text style={{ fontSize: moderateScale(16), fontWeight: '700', color: colors.onPrimary }}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      {/* Top App Bar */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surfaceContainerHigh, paddingTop: insets.top },
        ]}
      >
        <View style={styles.topBarLeft}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: colors.primary }]}>FleetOps</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 80 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Page Heading */}
        <View style={styles.heading}>
          <Text style={[styles.headingTitle, { color: colors.onBackground }]}>Refuel Log</Text>
          <Text style={[styles.headingSub, { color: colors.onSurfaceVariant }]}>
            Please document your refuel transaction.
          </Text>
        </View>

        {/* Info Cards Grid */}
        <View style={styles.infoGrid}>
          {/* Vehicle & Trip Info */}
          <View
            style={[
              styles.infoCard,
              { backgroundColor: colors.surfaceContainerLow, borderColor: colors.surfaceContainerHighest },
            ]}
          >
            <View style={styles.infoCardHeader}>
              <View>
                <Text style={[styles.infoCardLabel, { color: colors.onSurfaceVariant }]}>VEHICLE</Text>
                <Text style={[styles.infoCardValue, { color: colors.onSurface }]}>Assigned Vehicle</Text>
                <Text style={[styles.infoCardSub, { color: colors.onSurfaceVariant }]}>
                  {tripId ? `Trip #${tripId}` : "No active trip"}
                </Text>
              </View>
              <View style={[styles.infoCardIcon, { backgroundColor: colors.primaryContainer }]}>
                <Ionicons name="car" size={24} color={colors.onPrimaryContainer} />
              </View>
            </View>
          </View>

          {/* Fuel Level Card */}
          <View
            style={[
              styles.infoCard,
              { backgroundColor: colors.surfaceContainerLow, borderColor: colors.surfaceContainerHighest },
            ]}
          >
            <Text style={[styles.infoCardLabel, { color: colors.onSurfaceVariant }]}>CURRENT FUEL LEVEL</Text>
            <View style={styles.fuelLevelRow}>
              <Text style={[styles.fuelPercentage, { color: colors.error }]}>
                {liters ? `${((parseFloat(liters) / 70) * 100).toFixed(0)}%` : "--"}
              </Text>
              <Ionicons name="water" size={24} color={colors.error} />
            </View>
            <View style={[styles.fuelBar, { backgroundColor: colors.surfaceContainerHighest }]}>
              <View
                style={[
                  styles.fuelBarFill,
                  {
                    backgroundColor: colors.secondary,
                    width: liters ? `${Math.min((parseFloat(liters) / 70) * 100, 100)}%` : "15%",
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Manual Entry Form */}
        {mode === "manual" ? (
          <View
            style={[
              styles.formCard,
              { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant },
            ]}
          >
            <Text style={[styles.formTitle, { color: colors.onSurface }]}>Refuel Details</Text>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>ODOMETER (KM)</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                placeholder="e.g. 45250"
                placeholderTextColor={colors.outline}
                keyboardType="numeric"
                value={odometer}
                onChangeText={setOdometer}
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>VOLUME (L)</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                  placeholder="e.g. 45.5"
                  placeholderTextColor={colors.outline}
                  keyboardType="decimal-pad"
                  value={liters}
                  onChangeText={setLiters}
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>TOTAL COST (₱)</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                  placeholder="e.g. 3500"
                  placeholderTextColor={colors.outline}
                  keyboardType="decimal-pad"
                  value={cost}
                  onChangeText={setCost}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>STATION NAME</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.outline, color: colors.onSurface, backgroundColor: colors.surfaceContainerLowest }]}
                placeholder="e.g. Shell NLEX"
                placeholderTextColor={colors.outline}
                value={station}
                onChangeText={setStation}
              />
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              style={({ pressed }) => [
                styles.submitBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
              ]}
            >
              <Ionicons name="checkmark" size={20} color={colors.onPrimary} />
              <Text style={[styles.submitBtnText, { color: colors.onPrimary }]}>
                {submitting ? "Saving..." : "Save Fuel Entry"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Receipt Documentation Section */}
        <View style={styles.receiptSection}>
          <Text style={[styles.receiptTitle, { color: colors.onBackground }]}>
            Receipt Documentation
          </Text>

          <View style={styles.receiptButtons}>
            <Pressable
              onPress={() => handleScan(true)}
              disabled={scanning}
              style={({ pressed }) => [
                styles.receiptBtn,
                styles.receiptBtnPrimary,
                { backgroundColor: colors.primary, opacity: pressed || scanning ? 0.9 : 1 },
              ]}
            >
              <Ionicons name="scan" size={20} color={colors.onPrimary} />
              <Text style={[styles.receiptBtnText, { color: colors.onPrimary }]}>
                {scanning ? "Processing..." : "Scan Receipt"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleScan(false)}
              disabled={scanning}
              style={({ pressed }) => [
                styles.receiptBtn,
                {
                  backgroundColor: colors.surfaceContainerHigh,
                  borderColor: colors.outlineVariant,
                  borderWidth: 1,
                  opacity: pressed || scanning ? 0.7 : 1,
                },
              ]}
            >
              <Ionicons name="cloud-upload-outline" size={20} color={colors.onSurface} />
              <Text style={[styles.receiptBtnText, { color: colors.onSurface }]}>
                Upload Receipt
              </Text>
            </Pressable>
          </View>

          {/* OR Divider */}
          <View style={styles.orRow}>
            <View style={[styles.orLine, { backgroundColor: colors.surfaceContainerHighest }]} />
            <Text style={[styles.orText, { color: colors.onSurfaceVariant }]}>OR</Text>
            <View style={[styles.orLine, { backgroundColor: colors.surfaceContainerHighest }]} />
          </View>

          <Pressable
            onPress={() => setMode(mode === "manual" ? "overview" : "manual")}
            style={({ pressed }) => [
              styles.manualBtn,
              {
                borderColor: colors.primary,
                backgroundColor: "transparent",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Ionicons name="create-outline" size={20} color={colors.primary} />
            <Text style={[styles.manualBtnText, { color: colors.primary }]}>
              {mode === "manual" ? "Hide Manual Entry" : "Enter Details Manually"}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(12),
    height: TOUCH_TARGET + 0,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  topBarLeft: { flexDirection: "row", alignItems: "center", gap: moderateScale(16) },
  closeBtn: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: { fontSize: moderateScale(24), fontFamily: fonts.displayBold, lineHeight: moderateScale(32) },
  scroll: { paddingHorizontal: moderateScale(16), paddingTop: moderateScale(24), gap: moderateScale(16) },
  heading: { gap: moderateScale(4) },
  headingTitle: { fontSize: moderateScale(28), fontFamily: fonts.displayBold, lineHeight: moderateScale(36) },
  headingSub: { fontSize: moderateScale(18), fontFamily: fonts.body, lineHeight: moderateScale(28) },
  infoGrid: { flexDirection: "row", gap: moderateScale(16), flexWrap: "wrap" },
  infoCard: {
    flex: 1,
    minWidth: moderateScale(140),
    borderRadius: moderateScale(12),
    padding: moderateScale(20),
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    gap: moderateScale(8),
  },
  infoCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  infoCardLabel: { fontSize: moderateScale(12), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(16), letterSpacing: 0.5, textTransform: "uppercase", marginBottom: moderateScale(4) },
  infoCardValue: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  infoCardSub: { fontSize: moderateScale(16), fontFamily: fonts.body, lineHeight: moderateScale(24) },
  infoCardIcon: {
    width: moderateScale(48),
    height: moderateScale(48),
    borderRadius: moderateScale(24),
    alignItems: "center",
    justifyContent: "center",
  },
  fuelLevelRow: { flexDirection: "row", alignItems: "flex-end", gap: moderateScale(8) },
  fuelPercentage: { fontSize: moderateScale(44), fontFamily: fonts.displayBold, lineHeight: moderateScale(52) },
  fuelBar: { height: moderateScale(8), borderRadius: moderateScale(4), overflow: "hidden", marginTop: moderateScale(8) },
  fuelBarFill: { height: "100%", borderRadius: moderateScale(4) },
  formCard: {
    borderRadius: moderateScale(12),
    borderWidth: 1,
    padding: moderateScale(20),
    gap: moderateScale(16),
  },
  formTitle: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  fieldGroup: { gap: moderateScale(6) },
  fieldRow: { flexDirection: "row", gap: moderateScale(12) },
  fieldLabel: { fontSize: moderateScale(12), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(16), letterSpacing: 0.5, textTransform: "uppercase" },
  input: {
    height: TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: moderateScale(8),
    paddingHorizontal: moderateScale(12),
    fontSize: moderateScale(16),
    fontFamily: fonts.body,
  },
  submitBtn: {
    height: moderateScale(56),
    borderRadius: moderateScale(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
    marginTop: moderateScale(4),
  },
  submitBtnText: { fontSize: moderateScale(14), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(20) },
  receiptSection: { gap: moderateScale(12) },
  receiptTitle: { fontSize: moderateScale(20), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(28) },
  receiptButtons: { gap: moderateScale(12) },
  receiptBtn: {
    height: moderateScale(56),
    borderRadius: moderateScale(12),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  receiptBtnPrimary: {},
  receiptBtnText: { fontSize: moderateScale(14), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(20) },
  orRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(16) },
  orLine: { flex: 1, height: 1 },
  orText: { fontSize: moderateScale(12), fontFamily: fonts.bodyMedium, lineHeight: moderateScale(16), letterSpacing: 0.5, textTransform: "uppercase" },
  manualBtn: {
    height: moderateScale(56),
    borderRadius: moderateScale(12),
    borderWidth: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
  },
  manualBtnText: { fontSize: moderateScale(14), fontFamily: fonts.bodySemiBold, lineHeight: moderateScale(20) },
});
