import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

const SEVERITIES = ["Minor", "Moderate", "Major", "Critical"];

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
  const [submitting, setSubmitting] = useState(false);

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
      await api.post("/api/driver/incidents", {
        incident_type: type.trim(),
        severity,
        description: description.trim(),
        location: location.trim() || undefined,
        incident_date: new Date().toISOString(),
      });
      Alert.alert("Report submitted", "Your dispatcher has been notified.", [
        { text: "Done" },
      ]);
      setType("");
      setDescription("");
      setLocation("");
      await load();
    } catch (e) {
      setError(e.message || "Could not submit the report.");
    } finally {
      setSubmitting(false);
    }
  }, [type, severity, description, location, load]);

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
});
