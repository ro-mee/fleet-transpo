import { moderateScale } from '../../lib/scaling';
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, TextInput, KeyboardAvoidingView, Platform,  } from 'react-native';
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, radius, TOUCH_TARGET } from "../../lib/theme";
import { api } from "../../lib/api";
import * as ImagePicker from "expo-image-picker";
import { AppAlert } from '../../components/AppAlert';

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
          AppAlert.alert("Permission Required", "Camera permission is required to scan receipts.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          quality: 0.5,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          AppAlert.alert("Permission Required", "Photo library permission is required to upload receipts.");
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
      AppAlert.alert("Error", "Could not capture receipt image.");
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
        AppAlert.alert("Receipt Scanned", "Please verify the extracted details.");
      } else {
         AppAlert.alert("Scan Complete", "Could not automatically read details. Please enter them manually.");
         setMode("manual");
      }
    } catch (e) {
      AppAlert.alert("Scan Error", e.message || "Failed to process receipt.");
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async () => {
    if (!odometer || !liters || !cost) {
      AppAlert.alert("Missing Fields", "Enter Odometer, Volume, and Total Cost.");
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
      AppAlert.alert("Error", e.message || "Could not save fuel entry.");
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
                { 
                  backgroundColor: colors.primary, 
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  opacity: pressed ? 0.9 : 1 
                },
              ]}
            >
              <Text style={[styles.submitBtnText, { color: colors.onPrimary }]}>
                {submitting ? "Saving Entry..." : "Save Fuel Entry"}
              </Text>
              <View style={[styles.btnIconCapsule, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Ionicons name="checkmark" size={17} color={colors.onPrimary} />
              </View>
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
                { 
                  backgroundColor: colors.primary, 
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  opacity: pressed || scanning ? 0.9 : 1 
                },
              ]}
            >
              <Text style={[styles.receiptBtnText, { color: colors.onPrimary }]}>
                {scanning ? "Processing..." : "Scan Receipt (Camera)"}
              </Text>
              <View style={[styles.btnIconCapsule, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Ionicons name="scan" size={17} color={colors.onPrimary} />
              </View>
            </Pressable>

            <Pressable
              onPress={() => handleScan(false)}
              disabled={scanning}
              style={({ pressed }) => [
                styles.receiptBtn,
                {
                  backgroundColor: colors.surfaceContainerLow,
                  borderColor: colors.outlineVariant + '50',
                  borderWidth: 1,
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  opacity: pressed || scanning ? 0.8 : 1,
                },
              ]}
            >
              <Text style={[styles.receiptBtnText, { color: colors.onSurface }]}>
                Upload from Gallery
              </Text>
              <View style={[styles.btnIconCapsule, { backgroundColor: 'rgba(0,0,0,0.05)' }]}>
                <Ionicons name="cloud-upload-outline" size={17} color={colors.onSurface} />
              </View>
            </Pressable>
          </View>

          {/* OR Divider */}
          <View style={styles.orRow}>
            <View style={[styles.orLine, { backgroundColor: colors.outlineVariant + '40' }]} />
            <Text style={[styles.orText, { color: colors.onSurfaceVariant }]}>OR</Text>
            <View style={[styles.orLine, { backgroundColor: colors.outlineVariant + '40' }]} />
          </View>

          <Pressable
            onPress={() => setMode(mode === "manual" ? "overview" : "manual")}
            style={({ pressed }) => [
              styles.manualBtn,
              {
                borderColor: colors.primary,
                backgroundColor: "transparent",
                transform: [{ scale: pressed ? 0.97 : 1 }],
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Ionicons name={mode === "manual" ? "eye-off-outline" : "create-outline"} size={18} color={colors.primary} />
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
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  topBarLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: { fontSize: 17, fontFamily: fonts.displayBold },
  scroll: { paddingHorizontal: 16, paddingTop: 20, gap: 16 },
  heading: { gap: 4 },
  headingTitle: { fontSize: 24, fontFamily: fonts.displayBold, letterSpacing: -0.5 },
  headingSub: { fontSize: 14, fontFamily: fonts.body },
  infoGrid: { flexDirection: "row", gap: 12 },
  infoCard: {
    flex: 1,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 8,
  },
  infoCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  infoCardLabel: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 2 },
  infoCardValue: { fontSize: 16, fontFamily: fonts.bodySemiBold },
  infoCardSub: { fontSize: 13, fontFamily: fonts.body },
  infoCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  fuelLevelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fuelPercentage: { fontSize: 28, fontFamily: fonts.displayBold, letterSpacing: -0.5 },
  fuelBar: { height: 6, borderRadius: 3, overflow: "hidden", marginTop: 4 },
  fuelBarFill: { height: "100%", borderRadius: 3 },
  formCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  formTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  fieldGroup: { gap: 6 },
  fieldRow: { flexDirection: "row", gap: 12 },
  fieldLabel: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.6, textTransform: "uppercase" },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  submitBtn: {
    height: 52,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    marginTop: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  submitBtnText: { fontSize: 14, fontFamily: fonts.bodySemiBold, letterSpacing: 0.3 },
  receiptSection: { gap: 12, marginTop: 4 },
  receiptTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  receiptButtons: { gap: 10 },
  receiptBtn: {
    height: 52,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  receiptBtnPrimary: {},
  receiptBtnText: { fontSize: 14, fontFamily: fonts.bodySemiBold, letterSpacing: 0.3 },
  btnIconCapsule: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orRow: { flexDirection: "row", alignItems: "center", gap: 14, marginVertical: 4 },
  orLine: { flex: 1, height: 1 },
  orText: { fontSize: 11, fontFamily: fonts.dataSemiBold || fonts.bodySemiBold, letterSpacing: 0.8, textTransform: "uppercase" },
  manualBtn: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  manualBtnText: { fontSize: 14, fontFamily: fonts.bodySemiBold, letterSpacing: 0.3 },
});
