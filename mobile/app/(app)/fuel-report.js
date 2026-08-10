import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
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

/**
 * Driver fuel report.
 *
 * The vehicle is derived from the driver's active trip, never entered by hand:
 * mobile/README.md requires that the API derive vehicle and driver from the
 * authenticated identity, and a free-text vehicle id would let a driver file
 * fuel against someone else's vehicle.
 *
 * Receipt camera and OCR are the remaining piece of the fuel contract in
 * docs/mobile-mvp.md; this screen collects the reviewed values by hand.
 */
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
        if (data.extracted_data.station_name) setStation(data.extracted_data.station_name);
        if (data.extracted_data.liters) setLiters(String(data.extracted_data.liters));
        if (data.extracted_data.amount) setAmount(String(data.extracted_data.amount));
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
        // fuel_date is a DATE column; send date-only.
        fuel_date: new Date().toISOString().slice(0, 10),
        receipt_url: receiptUrl,
        // "Pending" is what the web review screen filters on. Anything else
        // would be invisible to the reviewer.
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
          // Without an active trip there is no vehicle to attribute fuel to.
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
            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Vehicle</Text>
              <View style={styles.plateRow}>
                <Plate plate={trip.plate_number ?? `#${trip.vehicle_id}`} />
              </View>
              <Detail
                label="Trip"
                value={`#${trip.trip_id} · ${trip.destination ?? "—"}`}
                mono
              />
              <Text style={[ui.bodyText, { color: colors.onSurfaceVariant }]}>
                {profile?.activeTrip ? "Taken from your active trip." : "Taken from your most recent trip."}
              </Text>
            </Card>

            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Receipt scan</Text>
              {receiptImage && (
                <View style={styles.imagePreview}>
                  <Text style={[ui.bodyText, { color: colors.primary, paddingBottom: space.sm }]}>✓ Receipt captured</Text>
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
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Receipt details</Text>
              <Field
                label="Fuel station"
                required
                value={station}
                onChangeText={setStation}
                placeholder="e.g. Shell Makati"
                editable={!submitting}
              />
              <Field
                label="Liters"
                required
                value={liters}
                onChangeText={setLiters}
                placeholder="0.00"
                keyboardType="decimal-pad"
                editable={!submitting}
              />
              <Field
                label="Total amount (₱)"
                required
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                keyboardType="decimal-pad"
                editable={!submitting}
              />
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
                <Text style={[styles.calculatedValue, { color: colors.onSurface }]}>₱ {pricePerLiter}</Text>
              </View>

              <Button
                label={submitting ? "Submitting" : "Submit fuel report"}
                onPress={onSubmit}
                loading={submitting}
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
  plateRow: { paddingVertical: space.xs },
  imagePreview: { marginBottom: space.sm },
  calculation: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: space.md,
    borderTopWidth: 1,
    marginTop: space.xs,
  },
  calculatedValue: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 16,
    lineHeight: 22,
    fontVariant: ["tabular-nums"],
  },
});
