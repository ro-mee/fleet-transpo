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
  StatusPill,
  styles as ui,
} from "../../components/ui";
import { BrandBar } from "../../components/logo";
import { Plate } from "../../components/plate";

export default function Submissions() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await api.get("/api/mobile/driver/submissions");
      setSubmissions(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message || "Could not load your submissions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const getStatusTone = (status, category) => {
    if (status === "Resolved" || status === "Approved") return "success";
    if (status === "Pending") return "warning";
    if (status === "Rejected") return "critical";
    return "neutral";
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
      >
        <ScreenTitle title="My Submissions" />
        
        <ErrorNotice message={error} />

        {loading ? (
          <>
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </>
        ) : submissions.length === 0 ? (
          <EmptyState
            title="No past submissions"
            message="Your incident reports and fuel logs will appear here."
          />
        ) : (
          submissions.map((item) => (
            <Card key={item.id} tone={getStatusTone(item.status, item.category)}>
              <View style={ui.rowBetween}>
                <View style={styles.headerTitle}>
                  <Text style={[ui.eyebrow, { color: colors.onSurfaceVariant }]}>
                    {item.category}
                  </Text>
                  <Text style={[styles.title, { color: colors.onSurface }]}>
                    {item.title}
                  </Text>
                </View>
                <StatusPill 
                  label={item.status || "Submitted"} 
                  tone={getStatusTone(item.status, item.category)} 
                />
              </View>

              <View style={styles.plateRow}>
                <Plate plate={item.plate_number ?? "Unknown"} size="sm" />
              </View>

              {item.description ? (
                <Text style={[ui.bodyText, { color: colors.onSurfaceVariant, marginTop: space.xs }]}>
                  {item.description}
                </Text>
              ) : null}

              <View style={styles.details}>
                <Detail 
                  label="Date" 
                  value={new Date(item.date).toLocaleDateString()} 
                />
                {item.amount ? (
                  <Detail label="Amount" value={`₱ ${item.amount}`} />
                ) : null}
                {item.severity ? (
                  <Detail label="Severity" value={item.severity} />
                ) : null}
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { 
    paddingHorizontal: space.xl, 
    paddingTop: space.xl, 
    gap: space.lg, 
    width: "100%", 
    maxWidth: 720, 
    alignSelf: "center" 
  },
  headerTitle: {
    gap: 2,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    lineHeight: 22,
  },
  plateRow: { 
    paddingTop: space.sm,
    alignItems: "flex-start",
  },
  details: {
    marginTop: space.sm,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
    gap: space.xs,
  },
});
