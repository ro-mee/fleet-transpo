import { moderateScale } from '../../lib/scaling';
import { useState, useEffect, useCallback } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, TextInput, KeyboardAvoidingView, Platform, Image, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { useAuth } from "../../lib/auth";
import { fonts, radius, TOUCH_TARGET, statusColorForTone } from "../../lib/theme";
import { api } from "../../lib/api";
import * as ImagePicker from "expo-image-picker";
import { AppAlert } from '../../components/AppAlert';

export default function FuelReport() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { tripId: paramTripId, id, odometer: pOdometer, liters: pLiters, cost: pCost, station: pStation, fuelDate: pFuelDate } = useLocalSearchParams();
  const { colors } = useTheme();

  const [assignedTrip, setAssignedTrip] = useState(null);
  const [loadingTrip, setLoadingTrip] = useState(true);
  const [mode, setMode] = useState("overview"); // overview | details
  const [entryMethod, setEntryMethod] = useState(null); // scan | manual
  const [odometer, setOdometer] = useState(pOdometer || "");
  const [liters, setLiters] = useState(pLiters || "");
  const [cost, setCost] = useState(pCost || "");
  const [station, setStation] = useState(pStation || "");
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [receiptAsset, setReceiptAsset] = useState(null);
  const [submittedRecord, setSubmittedRecord] = useState(null);
  const [fuelDate, setFuelDate] = useState(pFuelDate || new Date().toISOString());
  const [submissionId] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get("/api/mobile/driver/trips?status=all");
        if (Array.isArray(data) && data.length > 0) {
          if (paramTripId) {
            const found = data.find((t) => String(t.trip_id) === String(paramTripId));
            if (found) {
              setAssignedTrip(found);
              return;
            }
          }
          // Prioritize active or pending assigned trips
          const activeOrPending = data.find((t) => !["Completed", "Cancelled"].includes(t.trip_status)) || data[0];
          setAssignedTrip(activeOrPending);
        }
      } catch (e) {
        // Fallback gracefully
      } finally {
        setLoadingTrip(false);
      }
    })();
  }, [paramTripId]);

  const activeTripId = paramTripId || (assignedTrip?.trip_id ? String(assignedTrip.trip_id) : null);

  const closeFuelReport = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(app)/(tabs)");
    }
  };

  const canSubmit = Boolean(odometer && liters && cost && receiptUrl) && !scanning && !submitting;

  const resetDetails = () => {
    setOdometer(pOdometer || "");
    setLiters(pLiters || "");
    setCost(pCost || "");
    setStation(pStation || "");
    setFuelDate(pFuelDate || new Date().toISOString());
  };

  const pickReceipt = async ({ useCamera = true, scanWithAi = false } = {}) => {
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
        setReceiptUrl(null);
        setReceiptAsset(asset);
        if (scanWithAi) {
          await processScannedReceipt(asset);
        } else {
          await uploadRawReceipt(asset);
        }
      }
    } catch (e) {
      AppAlert.alert("Error", "Could not capture receipt image.");
    }
  };

  const createReceiptFormData = (asset) => {
    const formData = new FormData();
    formData.append('receipt', {
      uri: asset.uri,
      name: asset.fileName || 'receipt.jpg',
      type: asset.mimeType || 'image/jpeg',
    });
    return formData;
  };

  const processScannedReceipt = async (asset) => {
    try {
      setScanning(true);

      const res = await api.post("/api/mobile/fuel/scan", createReceiptFormData(asset));

      if (res.receipt_url) {
        setReceiptUrl(res.receipt_url);
      }

      if (res.extracted_data && Object.keys(res.extracted_data).length > 0) {
        const d = res.extracted_data;
        if (d.liters) setLiters(String(d.liters));
        if (d.amount) setCost(String(d.amount));
        if (d.station_name) setStation(d.station_name);
        if (d.fuel_date) setFuelDate(d.fuel_date);
        setEntryMethod("scan");
        setMode("details");
        AppAlert.alert("Receipt Scanned", "Please verify the extracted details.");
      } else {
        setEntryMethod("scan");
        setMode("details");
        AppAlert.alert("Scan Complete", "Gemini could not read every detail. Review the receipt and complete the missing fields.");
      }
    } catch (e) {
      AppAlert.alert("Scan Error", e.message || "Failed to process receipt.");
    } finally {
      setScanning(false);
    }
  };

  const uploadRawReceipt = async (asset) => {
    try {
      setScanning(true);
      const res = await api.post("/api/mobile/fuel/upload", createReceiptFormData(asset));
      setReceiptUrl(res.receipt_url || null);
      if (!res.receipt_url) throw new Error("Receipt upload did not complete.");
    } catch (e) {
      setReceiptUrl(null);
      AppAlert.alert("Upload Error", e.message || "Failed to upload receipt photo.");
    } finally {
      setScanning(false);
    }
  };

  const startManualEntry = () => {
    resetDetails();
    setEntryMethod("manual");
    setMode("details");
    setReceiptUrl(null);
    setReceiptAsset(null);
  };

  const returnToOptions = () => {
    resetDetails();
    setMode("overview");
    setEntryMethod(null);
    setReceiptUrl(null);
    setReceiptAsset(null);
  };

  const handleSubmit = async () => {
    if (!odometer || !liters || !cost) {
      AppAlert.alert("Missing Fields", "Enter Odometer, Volume, and Total Cost.");
      return;
    }
    if (!receiptUrl) {
      AppAlert.alert("Receipt Photo Required", "Add a receipt photo from your camera or gallery so the entered details can be verified.");
      return;
    }
    const parsedOdometer = Number(odometer.replace(/,/g, ""));
    const parsedLiters = Number(liters.replace(/,/g, ""));
    const parsedCost = Number(cost.replace(/,/g, ""));
    if (![parsedOdometer, parsedLiters, parsedCost].every(Number.isFinite) || parsedOdometer < 0 || parsedLiters <= 0 || parsedCost <= 0) {
      AppAlert.alert("Invalid Values", "Enter valid positive numbers for odometer, volume, and total cost.");
      return;
    }
    try {
      setSubmitting(true);
      const payload = {
        odometer: parsedOdometer,
        liters: parsedLiters,
        amount: parsedCost,
        station_name: station || "Unspecified",
        fuel_date: fuelDate,
        receipt_url: receiptUrl,
        client_submission_id: submissionId,
      };

      let res;
      if (id) {
        res = await api.put(`/api/mobile/fuel/${id}`, payload);
      } else {
        payload.trip_id = activeTripId && activeTripId !== "undefined" ? parseInt(activeTripId, 10) : null;
        res = await api.post("/api/mobile/fuel", payload);
      }
      setSubmittedRecord({ ...res, amount: res?.amount ?? payload.amount });
    } catch (e) {
      AppAlert.alert("Unable to Save Fuel Log", e.message || "Please check your network connection and verify your receipt upload.");
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
            {submittedRecord.queued ? "Fuel Report Queued" : "Fuel Report Submitted"}
          </Text>
          <Text style={{ fontSize: moderateScale(16), color: colors.onSurfaceVariant, textAlign: 'center', marginBottom: moderateScale(32), lineHeight: moderateScale(24) }}>
            {submittedRecord.queued
              ? "Your report is saved on this device and will sync when the connection returns."
              : "Your fuel expense report has been successfully recorded."}
          </Text>

          <View style={{ width: '100%', backgroundColor: colors.surfaceContainerLow, borderRadius: moderateScale(16), padding: moderateScale(20), gap: moderateScale(16) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: moderateScale(15), fontWeight: '600', color: colors.onSurfaceVariant }}>Report ID</Text>
              <Text style={{ fontSize: moderateScale(18), fontWeight: '700', color: colors.onSurface }}>
                {submittedRecord.queued ? "Waiting for sync" : `FR-${String(submittedRecord.fuel_record_id || submittedRecord.id || "0000").padStart(5, '0')}`}
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
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: statusColorForTone(colors, "success").bg, paddingHorizontal: moderateScale(12), paddingVertical: moderateScale(6), borderRadius: moderateScale(8), gap: moderateScale(6) }}>
                <Ionicons name="time-outline" size={16} color={statusColorForTone(colors, "success").fg} />
                <Text style={{ fontSize: moderateScale(14), fontWeight: '700', color: statusColorForTone(colors, "success").fg }}>{submittedRecord.queued ? "Waiting for Sync" : "Pending Review"}</Text>
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
            onPress={closeFuelReport}
            hitSlop={8}
            style={styles.closeBtn}
            accessibilityRole="button"
            accessibilityLabel="Close fuel report"
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

        {/* Premium Double-Bezel Info Cards Grid */}
        <View style={styles.infoGrid}>
          {/* Assigned Vehicle Double-Bezel Card */}
          <View style={[styles.cardOuterShell, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant + '35' }]}>
            <View style={styles.topGleam} />
            <View style={[styles.cardInnerCore, { backgroundColor: colors.surfaceContainerLow }]}>
              <View style={styles.cardHeaderRow}>
                <View style={[styles.microBadge, { backgroundColor: colors.primaryContainer + '60', borderColor: colors.primary + '30' }]}>
                  <View style={[styles.microDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.microBadgeText, { color: colors.primary }]}>ASSIGNED VEHICLE</Text>
                </View>
                <View style={[styles.iconPill, { backgroundColor: colors.primaryContainer }]}>
                  <Ionicons name="car" size={16} color={colors.primary} />
                </View>
              </View>

              <Text style={[styles.vehicleModelTitle, { color: colors.onSurface }]} numberOfLines={1}>
                {assignedTrip?.vehicle_model || assignedTrip?.model || (assignedTrip?.vehicle_plate || assignedTrip?.plate_number ? `Plate ${assignedTrip?.vehicle_plate || assignedTrip?.plate_number}` : "Assigned Fleet Vehicle")}
              </Text>
              
              <View style={styles.vehicleMetaRow}>
                <View style={[styles.platePill, { backgroundColor: colors.surfaceContainerHigh, borderColor: colors.outlineVariant + '40' }]}>
                  <Ionicons name="barcode-outline" size={12} color={colors.onSurfaceVariant} />
                  <Text style={[styles.plateText, { color: colors.onSurface }]}>
                    {assignedTrip?.vehicle_plate || assignedTrip?.plate_number || "Active Vehicle"}
                  </Text>
                </View>
                <Text style={[styles.driverTagText, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
                  {user?.name ? `Driver: ${user.name}` : "Assigned to You"}
                </Text>
              </View>
            </View>
          </View>

          {/* Current Fuel Level Double-Bezel Card */}
          <View style={[styles.cardOuterShell, { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant + '35' }]}>
            <View style={styles.topGleam} />
            <View style={[styles.cardInnerCore, { backgroundColor: colors.surfaceContainerLow }]}>
              <View style={styles.cardHeaderRow}>
                <View style={[styles.microBadge, { backgroundColor: (liters ? colors.secondaryContainer : colors.surfaceContainerHigh), borderColor: (liters ? colors.secondary + '40' : colors.outlineVariant + '30') }]}>
                  <View style={[styles.microDot, { backgroundColor: (liters ? colors.secondary : colors.onSurfaceVariant) }]} />
                  <Text style={[styles.microBadgeText, { color: (liters ? colors.onSecondaryContainer : colors.onSurfaceVariant) }]}>FUEL GAUGE</Text>
                </View>
                <View style={[styles.iconPill, { backgroundColor: colors.secondaryContainer }]}>
                  <Ionicons name="water" size={15} color={colors.secondary} />
                </View>
              </View>

              <View style={styles.fuelValueRow}>
                <Text style={[styles.fuelLargeNumber, { color: colors.onSurface }]}>
                  {liters ? `${((parseFloat(liters) / 70) * 100).toFixed(0)}` : "--"}
                </Text>
                <Text style={[styles.fuelPercentSign, { color: colors.secondary }]}>%</Text>
                <Text style={[styles.fuelCapacityLabel, { color: colors.onSurfaceVariant }]}>
                  {liters ? `${parseFloat(liters).toFixed(1)} L` : "70L cap"}
                </Text>
              </View>

              {/* Tactical Progress Bar */}
              <View style={[styles.fuelTrack, { backgroundColor: colors.surfaceContainerHighest }]}>
                <View
                  style={[
                    styles.fuelProgress,
                    {
                      backgroundColor: colors.secondary,
                      width: liters ? `${Math.min((parseFloat(liters) / 70) * 100, 100)}%` : "20%",
                    },
                  ]}
                />
              </View>
            </View>
          </View>
        </View>

        {mode === "overview" ? (
          <View style={styles.methodSection}>
            <Text style={[styles.methodTitle, { color: colors.onBackground }]}>How do you want to log fuel?</Text>
            <Pressable
              onPress={() => pickReceipt({ useCamera: true, scanWithAi: true })}
              disabled={scanning}
              style={({ pressed }) => [
                styles.methodCard,
                { backgroundColor: colors.primary, opacity: pressed || scanning ? 0.85 : 1 },
              ]}
            >
              <View style={[styles.methodIcon, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                <Ionicons name="scan-outline" size={26} color={colors.onPrimary} />
              </View>
              <View style={styles.methodCopy}>
                <Text style={[styles.methodCardTitle, { color: colors.onPrimary }]}>{scanning ? "Scanning receipt..." : "Scan receipt"}</Text>
                <Text style={[styles.methodCardText, { color: colors.onPrimary }]}>Gemini reads the receipt and fills in the fuel details for you.</Text>
              </View>
              <Ionicons name="chevron-forward" size={21} color={colors.onPrimary} />
            </Pressable>

            <Pressable
              onPress={startManualEntry}
              disabled={scanning}
              style={({ pressed }) => [
                styles.methodCard,
                { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View style={[styles.methodIcon, { backgroundColor: colors.primaryContainer }]}>
                <Ionicons name="create-outline" size={24} color={colors.onPrimaryContainer} />
              </View>
              <View style={styles.methodCopy}>
                <Text style={[styles.methodCardTitle, { color: colors.onSurface }]}>Enter details manually</Text>
                <Text style={[styles.methodCardText, { color: colors.onSurfaceVariant }]}>Type the values yourself and attach the original receipt photo.</Text>
              </View>
              <Ionicons name="chevron-forward" size={21} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>
        ) : null}

        {mode === "details" ? (
          <View
            style={[
              styles.formCard,
              { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant },
            ]}
          >
            <View style={styles.formHeading}>
              <View>
                <Text style={[styles.formTitle, { color: colors.onSurface }]}>Refuel Details</Text>
                <Text style={[styles.formSubtitle, { color: colors.onSurfaceVariant }]}>
                  {entryMethod === "scan" ? "Gemini-filled details. Review before saving." : "Enter the receipt values exactly as shown."}
                </Text>
              </View>
              <View style={[styles.methodBadge, { backgroundColor: colors.primaryContainer }]}>
                <Ionicons name={entryMethod === "scan" ? "sparkles" : "create-outline"} size={14} color={colors.onPrimaryContainer} />
                <Text style={[styles.methodBadgeText, { color: colors.onPrimaryContainer }]}>{entryMethod === "scan" ? "AI scan" : "Manual"}</Text>
              </View>
            </View>

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

            <View style={styles.evidenceBlock}>
              <View style={styles.evidenceHeader}>
                <View style={styles.evidenceCopy}>
                  <Text style={[styles.fieldLabel, { color: colors.onSurfaceVariant }]}>RECEIPT PHOTO *</Text>
                  <Text style={[styles.evidenceHint, { color: colors.onSurfaceVariant }]}>Attach proof for the details you entered.</Text>
                </View>
                {receiptAsset ? (
                  <Image source={{ uri: receiptAsset.uri }} style={styles.receiptThumb} />
                ) : (
                  <View style={[styles.receiptThumbPlaceholder, { backgroundColor: colors.surfaceContainerHighest }]}>
                    <Ionicons name="receipt-outline" size={22} color={colors.onSurfaceVariant} />
                  </View>
                )}
              </View>
              {entryMethod === "manual" ? <View style={styles.evidenceButtons}>
                <Pressable
                  onPress={() => pickReceipt({ useCamera: true, scanWithAi: false })}
                  disabled={scanning}
                  style={({ pressed }) => [
                    styles.evidenceBtn,
                    { backgroundColor: colors.primary, opacity: pressed || scanning ? 0.8 : 1 },
                  ]}
                >
                  <Ionicons name="camera-outline" size={18} color={colors.onPrimary} />
                  <Text style={[styles.evidenceBtnText, { color: colors.onPrimary }]}>{scanning ? "Uploading..." : "Take photo"}</Text>
                </Pressable>
                <Pressable
                  onPress={() => pickReceipt({ useCamera: false, scanWithAi: false })}
                  disabled={scanning}
                  style={({ pressed }) => [
                    styles.evidenceBtn,
                    styles.evidenceBtnSecondary,
                    { backgroundColor: colors.surfaceContainerLowest, borderColor: colors.outlineVariant, opacity: pressed || scanning ? 0.8 : 1 },
                  ]}
                >
                  <Ionicons name="images-outline" size={18} color={colors.primary} />
                  <Text style={[styles.evidenceBtnText, { color: colors.primary }]}>Gallery</Text>
                </Pressable>
              </View> : (
                <Pressable
                  onPress={() => pickReceipt({ useCamera: true, scanWithAi: true })}
                  disabled={scanning}
                  style={({ pressed }) => [
                    styles.rescanBtn,
                    { borderColor: colors.outlineVariant, opacity: pressed || scanning ? 0.75 : 1 },
                  ]}
                >
                  <Ionicons name="scan-outline" size={18} color={colors.primary} />
                  <Text style={[styles.evidenceBtnText, { color: colors.primary }]}>{scanning ? "Scanning..." : "Scan receipt again"}</Text>
                </Pressable>
              )}
              {scanning ? (
                <Text style={[styles.evidencePending, { color: colors.onSurfaceVariant }]}>{entryMethod === "scan" ? "Gemini is reading the receipt..." : "Uploading receipt photo..."}</Text>
              ) : receiptUrl ? (
                <Text style={[styles.evidenceReady, { color: colors.success || colors.primary }]}>Receipt attached and ready for review</Text>
              ) : receiptAsset ? (
                <Text style={[styles.evidenceError, { color: colors.error }]}>Photo has not uploaded. Try again before saving.</Text>
              ) : null}
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.submitBtn,
                { 
                  backgroundColor: colors.primary, 
                  transform: [{ scale: pressed ? 0.97 : 1 }],
                  opacity: !canSubmit ? 0.45 : pressed ? 0.9 : 1
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit }}
            >
              <Text style={[styles.submitBtnText, { color: colors.onPrimary }]}>
                {submitting ? "Saving Entry..." : scanning ? "Uploading Receipt..." : "Save Fuel Entry"}
              </Text>
              <View style={[styles.btnIconCapsule, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                <Ionicons name="checkmark" size={17} color={colors.onPrimary} />
              </View>
            </Pressable>
          </View>
        ) : null}

        {mode === "details" ? <View style={styles.receiptSection}>
          <Pressable
            onPress={returnToOptions}
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
            <Ionicons name="swap-horizontal-outline" size={18} color={colors.primary} />
            <Text style={[styles.manualBtnText, { color: colors.primary }]}>
              Choose another method
            </Text>
          </Pressable>
        </View> : null}
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
  infoGrid: { flexDirection: "row", gap: 10 },
  cardOuterShell: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    padding: 3,
    position: 'relative',
    overflow: 'hidden',
  },
  topGleam: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    zIndex: 10,
  },
  cardInnerCore: {
    borderRadius: 17,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 6,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  microBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  microDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  microBadgeText: {
    fontSize: 9,
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  iconPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleModelTitle: {
    fontSize: 14,
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    letterSpacing: -0.2,
    marginTop: 2,
  },
  vehicleMetaRow: {
    gap: 4,
    marginTop: 2,
  },
  platePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plateText: {
    fontSize: 11,
    fontFamily: fonts.dataSemiBold || fonts.bodySemiBold,
    letterSpacing: 0.4,
  },
  driverTagText: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium || fonts.body,
  },
  fuelValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    marginTop: 2,
  },
  fuelLargeNumber: {
    fontSize: 26,
    fontFamily: fonts.displayBold,
    letterSpacing: -1,
    lineHeight: 30,
  },
  fuelPercentSign: {
    fontSize: 14,
    fontFamily: fonts.displayBold,
  },
  fuelCapacityLabel: {
    fontSize: 11,
    fontFamily: fonts.bodyMedium || fonts.body,
    marginLeft: 6,
  },
  fuelTrack: {
    height: 5,
    borderRadius: 2.5,
    overflow: 'hidden',
    marginTop: 6,
  },
  fuelProgress: {
    height: '100%',
    borderRadius: 2.5,
  },
  formCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 14,
  },
  methodSection: { gap: 12 },
  methodTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  methodCard: { minHeight: 94, borderRadius: 16, borderWidth: 1, borderColor: "transparent", padding: 16, flexDirection: "row", alignItems: "center", gap: 13 },
  methodIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  methodCopy: { flex: 1, gap: 4 },
  methodCardTitle: { fontSize: 15, fontFamily: fonts.bodySemiBold },
  methodCardText: { fontSize: 12, lineHeight: 17, fontFamily: fonts.body },
  formHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  formTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  formSubtitle: { fontSize: 12, lineHeight: 17, fontFamily: fonts.body, marginTop: 3 },
  methodBadge: { minHeight: 28, borderRadius: 8, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  methodBadgeText: { fontSize: 11, fontFamily: fonts.bodySemiBold },
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
  evidenceBlock: { gap: 10, marginTop: 2 },
  evidenceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  evidenceCopy: { flex: 1, gap: 4 },
  evidenceHint: { fontSize: 12, fontFamily: fonts.body, lineHeight: 17 },
  receiptThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: "#ddd" },
  receiptThumbPlaceholder: { width: 56, height: 56, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  evidenceButtons: { flexDirection: "row", gap: 10 },
  evidenceBtn: { flex: 1, minHeight: 46, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  evidenceBtnSecondary: { borderWidth: 1 },
  evidenceBtnText: { fontSize: 13, fontFamily: fonts.bodySemiBold },
  rescanBtn: { minHeight: 46, borderWidth: 1, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  evidencePending: { fontSize: 12, fontFamily: fonts.bodyMedium || fonts.body },
  evidenceReady: { fontSize: 12, fontFamily: fonts.bodySemiBold },
  evidenceError: { fontSize: 12, fontFamily: fonts.bodySemiBold },
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
