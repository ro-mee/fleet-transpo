import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../lib/api";
import { useTheme } from "../../lib/theme-context";
import { fonts, space } from "../../lib/theme";
import {
  Card,
  Detail,
  EmptyState,
  ErrorNotice,
  ScreenTitle,
  SkeletonCard,
  styles as ui,
} from "../../components/ui";
import { BrandBar } from "../../components/logo";

/**
 * Vehicle inspection: the latest inspection snapshot for the vehicle currently
 * assigned to this driver (GET /api/driver/vehicle-inspection). Read-only — the
 * inspection lifecycle is managed on the web.
 */
export default function Inspection() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [inspection, setInspection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get("/api/driver/vehicle-inspection");
      setInspection(data || null);
    } catch (e) {
      setError(e.message || "Could not load the vehicle inspection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const checklist = inspection?.checklist;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
      >
        <ScreenTitle eyebrow="Driver" title="Vehicle inspection" />
        <ErrorNotice message={error} />

        {loading ? (
          <SkeletonCard lines={4} />
        ) : !inspection ? (
          <EmptyState
            title="No inspection on record"
            message="Your dispatcher will record inspections for your assigned vehicle."
          />
        ) : (
          <>
            <Card>
              <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Latest inspection</Text>
              <Detail label="Vehicle" value={inspection.plate_number ?? "—"} />
              <Detail label="Type" value={inspection.inspection_type ?? "—"} />
              <Detail
                label="Date"
                value={inspection.inspection_date ? new Date(inspection.inspection_date).toLocaleDateString() : "—"}
              />
              <Detail label="Status" value={inspection.status ?? "—"} />
              <Detail label="Severity" value={inspection.severity ?? "—"} />
              <Detail label="Vehicle status" value={inspection.vehicle_status ?? "—"} />
            </Card>

            {checklist ? (
              <Card>
                <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Checklist</Text>
                <Text style={[styles.checklist, { color: colors.onSurface }]}>
                  {typeof checklist === "string"
                    ? checklist
                    : JSON.stringify(checklist, null, 2)}
                </Text>
              </Card>
            ) : null}

            {inspection.findings ? (
              <Card>
                <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>Findings</Text>
                <Text style={[ui.bodyText, { color: colors.onSurfaceVariant }]}>{inspection.findings}</Text>
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.lg, width: "100%", maxWidth: 720, alignSelf: "center" },
  checklist: {
    fontFamily: fonts.data,
    fontSize: 13,
    lineHeight: 18,
  },
});
