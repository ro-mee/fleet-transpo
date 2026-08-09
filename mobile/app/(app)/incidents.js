import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme-context";
import { fonts, space } from "../../lib/theme";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  Field,
  ScreenTitle,
  SkeletonCard,
  styles as ui,
} from "../../components/ui";
import { BrandBar } from "../../components/logo";
import TripMap from "../../components/map";

const SEVERITIES = ["Minor", "Moderate", "Major", "Critical"];
const ASSISTANCE_OPTIONS = ["Tow", "Ambulance", "Police", "Mechanic"];

function severityTone(severity) {
  switch (severity) {
    case "Critical":
    case "Major":
      return "danger";
    case "Moderate":
      return "warning";
    default:
      return "info";
  }
}

/**
 * Driver incident / emergency reporting. Posting a breakdown-type report takes
 * the vehicle out of service and notifies dispatch — handled server-side by
 * POST /api/driver/incidents. This screen only collects the details.
 */
export default function Incidents() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("Minor");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [assistance, setAssistance] = useState([]);
  const [expenseAmount, setExpenseAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggleAssistance = (item) => {
    setAssistance((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  };

  // GPS auto-capture. The server accepts incidents without coordinates when
  // permission is denied, so a failed fix never blocks a report.
  const [fix, setFix] = useState(null);
  const [locError, setLocError] = useState(null);

  const captureFix = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocError("Location permission off — report will not include coordinates.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setFix({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      setLocError(null);

      try {
        const [address] = await Location.reverseGeocodeAsync(pos.coords);
        if (address) {
          const parts = [];
          if (address.street) parts.push(`${address.streetNumber ? address.streetNumber + " " : ""}${address.street}`);
          else if (address.name) parts.push(address.name);
          
          if (address.city) parts.push(address.city);
          else if (address.subregion) parts.push(address.subregion);
          
          if (parts.length > 0) {
            setLocation(parts.join(", "));
          }
        }
      } catch (e) {
        // non-fatal, user can still type location manually
      }
    } catch (e) {
      setLocError("Could not read your location — reporting without coordinates.");
    }
  }, []);

  // Pre-fetch a fix on mount so the submit path is fast.
  useEffect(() => {
    captureFix();
  }, [captureFix]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get("/api/driver/incidents");
      setIncidents(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || "Could not load your incidents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = useCallback(async () => {
    if (!type.trim() || !description.trim()) {
      setError("Incident type and description are required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Best-effort live fix at submit time; the mount-time fix covers the
      // common case, this covers long-dwell forms.
      let coords = fix;
      if (!coords) {
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        } catch {
          coords = null;
        }
      }
      await api.post("/api/driver/incidents", {
        incident_type: type.trim(),
        severity,
        description: description.trim(),
        location: location.trim() || undefined,
        assistance_needed: assistance.length > 0 ? assistance : undefined,
        incident_date: new Date().toISOString(),
        ...(expenseAmount.trim() ? { expense_amount: parseFloat(expenseAmount) } : {}),
        ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
      });
      Alert.alert("Report submitted", "Your dispatcher has been notified.", [
        { text: "Done" },
      ]);
      setType("");
      setDescription("");
      setLocation("");
      setAssistance([]);
      setExpenseAmount("");
      setFix(null);
      setLocError(null);
      await load();
    } catch (e) {
      setError(e.message || "Could not submit the report.");
    } finally {
      setSubmitting(false);
    }
  }, [type, severity, description, location, fix, load]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenTitle eyebrow="Driver" title="Report an incident" />
        <ErrorNotice message={error} />

        <Card>
          <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>New report</Text>
          <Field
            label="Incident type"
            required
            value={type}
            onChangeText={setType}
            placeholder="e.g. Flat tire, Engine trouble"
            editable={!submitting}
          />
          <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>Severity</Text>
          <View style={styles.severityRow}>
            {SEVERITIES.map((s) => (
              <Chip
                key={s}
                label={s}
                selected={s === severity}
                onPress={() => setSeverity(s)}
                disabled={submitting}
              />
            ))}
          </View>
          <Text style={[styles.label, { color: colors.onSurfaceVariant, marginTop: space.sm }]}>Assistance Needed (Optional)</Text>
          <View style={styles.severityRow}>
            {ASSISTANCE_OPTIONS.map((item) => (
              <Chip
                key={item}
                label={item}
                selected={assistance.includes(item)}
                onPress={() => toggleAssistance(item)}
                disabled={submitting}
              />
            ))}
          </View>
          <Field
            label="Out-of-Pocket Expense (₱) - Optional"
            value={expenseAmount}
            onChangeText={setExpenseAmount}
            placeholder="e.g. 500"
            keyboardType="numeric"
            editable={!submitting}
          />
          <Field
            label="Description"
            required
            value={description}
            onChangeText={setDescription}
            placeholder="What happened?"
            multiline
            editable={!submitting}
          />
          <Field
            label="Location"
            value={location}
            onChangeText={setLocation}
            placeholder="Where?"
            editable={!submitting}
          />
          {fix && (
            <View style={styles.mapPreview}>
              <TripMap
                origin={{ latitude: fix.latitude, longitude: fix.longitude }}
                destination={null}
                live={fix}
                height={140}
                showControls={false}
              />
              <Text style={[styles.label, { color: colors.onSurfaceVariant, marginTop: space.xs }]}>
                Current location captured — will be attached to this report
              </Text>
            </View>
          )}
          {locError && (
            <Text style={[styles.locError, { color: colors.warning }]}>{locError}</Text>
          )}
          <Button
            label={submitting ? "Submitting…" : "Submit report"}
            onPress={submit}
            loading={submitting}
          />
        </Card>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Past reports</Text>
          {loading ? (
            <SkeletonCard lines={2} />
          ) : incidents.length === 0 ? (
            <EmptyState
              title="No incidents reported"
              message="Your incident reports will appear here."
            />
          ) : (
            incidents.map((inc) => (
              <Card key={inc.incident_id} tone={severityTone(inc.severity)}>
                <Text style={[styles.incidentType, { color: colors.onSurface }]}>{inc.incident_type}</Text>
                <Text style={[ui.bodyText, { color: colors.onSurfaceVariant }]}>{inc.description}</Text>
                <Text style={[styles.meta, { color: colors.onSurfaceVariant }]}>
                  {inc.severity} · {inc.incident_date ? new Date(inc.incident_date).toLocaleDateString() : ""}
                  {inc.plate_number ? ` · ${inc.plate_number}` : ""}
                </Text>
              </Card>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.lg },
  label: {
    fontFamily: fonts.data,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: space.xs,
  },
  severityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
    marginBottom: space.base,
  },
  severityBtn: { minHeight: 36, paddingVertical: space.sm },
  section: { gap: space.md },
  sectionTitle: { fontFamily: fonts.display, fontSize: 18, lineHeight: 24 },
  incidentType: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
  },
  meta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, marginTop: space.xs },
  mapPreview: { marginBottom: space.base },
  locError: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: space.base,
  },
});
