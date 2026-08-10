import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { ACTIONS, canAction } from "../../lib/rbac";
import { useTheme } from "../../lib/theme-context";
import { fonts, space } from "../../lib/theme";
import {
  Button,
  Card,
  Detail,
  Field,
  EmptyState,
  ErrorNotice,
  ScreenTitle,
  SkeletonCard,
  styles as ui,
} from "../../components/ui";
import { BrandBar } from "../../components/logo";
import { Plate } from "../../components/plate";
import { Feather } from "@expo/vector-icons";

export default function FuelReport() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();

  const canReportFuel = canAction(user, ACTIONS.REPORT_FUEL);

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [station, setStation] = useState("");
  const [liters, setLiters] = useState("");
  const [amount, setAmount] = useState("");
  const [odometer, setOdometer] = useState("");
  const [fuelType, setFuelType] = useState("Diesel");
  const [receiptImage, setReceiptImage] = useState(null);
  const [receiptUrl, setReceiptUrl] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [autoFilled, setAutoFilled] = useState({ station: false, liters: false, amount: false });

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get("/api/mobile/driver/me");
        setProfile(me);
      } catch (e) {
        setError(e.message || "Could not load your vehicle.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const trip = profile?.activeTrip ?? profile?.recentTrip ?? null;

  const pricePerLiter =
    Number(liters) > 0 && Number(amount) > 0
      ? (Number(amount) / Number(liters)).toFixed(2)
      : "—";

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Camera permission is required to scan receipts.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      setReceiptImage(asset.uri);
      await uploadAndScanReceipt(asset);
    }
  };

  const uploadAndScanReceipt = async (asset) => {
    setScanning(true);
    setError(null);
    setAutoFilled({ station: false, liters: false, amount: false });
    try {
      const formData = new FormData();
      formData.append("receipt", {
        uri: asset.uri,
        name: "receipt.jpg",
        type: "image/jpeg",
      });
      const token = await import("../../lib/storage").then((m) => m.getAccessToken());
      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/mobile/fuel/scan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(`Scan failed (${res.status})`);
      const data = await res.json();
      
      setReceiptUrl(data.receipt_url);
      if (data.extracted_data) {
        const filled = { station: false, liters: false, amount: false };
        if (data.extracted_data.station_name) {
          setStation(data.extracted_data.station_name);
          filled.station = true;
        }
        if (data.extracted_data.liters) {
          setLiters(String(data.extracted_data.liters));
          filled.liters = true;
        }
        if (data.extracted_data.amount) {
          setAmount(String(data.extracted_data.amount));
          filled.amount = true;
        }
        setAutoFilled(filled);
      }
    } catch (e) {
      setError(e.message || "Failed to scan receipt. Please enter details manually.");
    } finally {
      setScanning(false);
    }
  };

  const onSubmit = useCallback(async () => {
    if (!station.trim() || !liters || !amount || !odometer) {
      setError("Station, liters, amount, and odometer are required.");
      return;
    }
    if (Number(liters) <= 0 || Number(amount) <= 0) {
      setError("Liters and amount must be greater than zero.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/mobile/fuel", {
        station_name: station.trim(),
        liters: Number(liters),
        amount: Number(amount),
        price_per_liter: Number(amount) / Number(liters),
        odometer: Number(odometer),
        fuel_type: fuelType,
        vehicle_id: trip.vehicle_id,
        trip_id: trip.trip_id,
        fuel_date: new Date().toISOString().slice(0, 10),
        receipt_url: receiptUrl,
        status: "Pending",
      });
      Alert.alert(
        "Fuel report submitted",
        "Your dispatcher will review it.",
        [{ text: "Done", onPress: () => router.back() }]
      );
    } catch (e) {
      setError(e.message || "Could not submit the report.");
    } finally {
      setSubmitting(false);
    }
  }, [station, liters, amount, odometer, fuelType, trip, receiptUrl, router]);

  const renderField = (label, value, setter, placeholder, keyboardType = "default", autoFilledKey) => {
    const isAutoFilled = autoFilled[autoFilledKey];
    return (
      <View style={{ marginBottom: space.sm }}>
        <Field
          label={
            isAutoFilled ? (
              <Text>
                {label} <Feather name="zap" size={12} color={colors.primary} />
              </Text>
            ) : (
              label
            )
          }
          required
          value={value}
          onChangeText={(val) => {
            setter(val);
            if (isAutoFilled) setAutoFilled(prev => ({ ...prev, [autoFilledKey]: false }));
          }}
          placeholder={placeholder}
          keyboardType={keyboardType}
          editable={!submitting}
          style={isAutoFilled ? { borderColor: colors.primary, backgroundColor: `${colors.primary}10` } : undefined}
        />
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenTitle eyebrow="Driver · Fuel" title="Fuel report" />

        <ErrorNotice message={error} />

        {loading ? (
          <SkeletonCard lines={3} />
        ) : !canReportFuel ? (
          <EmptyState
            title="Fuel reports not available"
            message="Your account does not have permission to submit fuel reports. Contact your dispatcher."
          />
        ) : !trip?.vehicle_id ? (
            <EmptyState
            title="No vehicle assigned"
            message="Fuel is reported against the vehicle on your trips. You must have at least one assigned trip on record."
            action={
              <Button
                label="Back to home"
                variant="secondary"
                onPress={() => router.back()}
              />
            }
          />
        ) : (
          <>
            <Card style={{ backgroundColor: `${colors.primary}10`, borderColor: colors.primary }}>
              <View style={styles.plateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[ui.eyebrow, { color: colors.primary }]}>Assigned Vehicle</Text>
                  <Text style={[ui.bodyText, { color: colors.onSurfaceVariant, fontSize: 13 }]}>
                    {profile?.activeTrip ? "Active trip" : "Most recent trip"}
                  </Text>
                </View>
                <Plate plate={trip.plate_number ?? `#${trip.vehicle_id}`} />
              </View>
            </Card>

            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant, marginBottom: space.sm }]}>Receipt scan</Text>
              
              {receiptImage ? (
                <View style={styles.receiptPreviewContainer}>
                  <Image source={{ uri: receiptImage }} style={styles.receiptImage} resizeMode="cover" />
                  <View style={[styles.receiptOverlay, { backgroundColor: `${colors.background}cc` }]}>
                    <Text style={[ui.bodyText, { color: colors.onBackground, fontWeight: 'bold' }]}>✓ Receipt captured</Text>
                  </View>
                </View>
              ) : (
                <View style={[styles.emptyImagePlaceholder, { borderColor: colors.outlineVariant, backgroundColor: colors.surfaceVariant }]}>
                  <Feather name="camera" size={32} color={colors.onSurfaceVariant} style={{ opacity: 0.5 }} />
                  <Text style={[ui.bodyText, { color: colors.onSurfaceVariant, marginTop: 8 }]}>Scan a receipt to auto-fill</Text>
                </View>
              )}
              
              <Button
                label={scanning ? "Scanning..." : receiptImage ? "Retake photo" : "Scan fuel receipt"}
                onPress={takePhoto}
                loading={scanning}
                variant={receiptImage ? "secondary" : "primary"}
              />
            </Card>

            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant, marginBottom: space.sm }]}>Receipt details</Text>
              
              {renderField("Fuel station", station, setStation, "e.g. Shell Makati", "default", "station")}
              {renderField("Liters", liters, setLiters, "0.00", "decimal-pad", "liters")}
              {renderField("Total amount (₱)", amount, setAmount, "0.00", "decimal-pad", "amount")}
              
              <Field
                label="Odometer"
                required
                value={odometer}
                onChangeText={setOdometer}
                placeholder="0"
                keyboardType="number-pad"
                editable={!submitting}
              />
              <Field
                label="Fuel type"
                value={fuelType}
                onChangeText={setFuelType}
                placeholder="Diesel"
                editable={!submitting}
              />

              <View style={styles.calculation}>
                <Text style={[ui.bodyText, { color: colors.onSurfaceVariant }]}>Price per liter</Text>
                <Text style={[styles.calculatedValue, { color: colors.primary }]}>₱ {pricePerLiter}</Text>
              </View>

              <Button
                label={submitting ? "Submitting" : "Submit fuel report"}
                onPress={onSubmit}
                loading={submitting}
                style={{ marginTop: space.md }}
              />
            </Card>

            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => router.back()}
              disabled={submitting}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.lg, width: "100%", maxWidth: 720, alignSelf: "center" },
  plateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.xs },
  receiptPreviewContainer: { 
    height: 160, 
    width: "100%", 
    borderRadius: 16, 
    overflow: "hidden", 
    marginBottom: space.md,
    position: 'relative'
  },
  receiptImage: { width: "100%", height: "100%" },
  receiptOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyImagePlaceholder: {
    height: 120,
    width: "100%",
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  calculation: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: space.md,
    borderTopWidth: 1,
    marginTop: space.sm,
    borderColor: "rgba(0,0,0,0.05)",
  },
  calculatedValue: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 18,
    lineHeight: 24,
    fontVariant: ["tabular-nums"],
  },
});
