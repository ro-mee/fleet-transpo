import { moderateScale } from '../lib/scaling';
import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../lib/theme-context";
import { fonts, space } from "../lib/theme";
import { ErrorNotice } from "../components/ui";
import { BrandBar } from "../components/logo";
import { ClayCard, ClayButton, ClayBadge, ClayTile } from "../components/clay";
import {
  describePermissionState,
  getPermissionStatuses,
  listAppPermissions,
  requestAppPermission,
} from "../lib/permissions";

function PermissionCard({ icon, title, description, state }) {
  const { colors, type } = useTheme();
  const presentation = describePermissionState(state);
  return (
    <ClayCard variant="compact" style={styles.cardItem}>
      <ClayTile
        icon={icon}
        size="md"
        backgroundColor={colors.primaryContainer}
        color={colors.onPrimaryContainer}
      />
      <View style={styles.cardText}>
        <View style={styles.titleRow}>
          <Text style={[type.titleMd, styles.cardTitle, { color: colors.onSurface }]} numberOfLines={1}>{title}</Text>
          {state && <ClayBadge label={presentation.label} tone={presentation.tone} size="sm" />}
        </View>
        <Text style={[type.bodyMd, { color: colors.onSurfaceVariant }]}>{description}</Text>
      </View>
    </ClayCard>
  );
}

export default function PermissionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, type } = useTheme();
  const permissions = listAppPermissions();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statuses, setStatuses] = useState({});

  useEffect(() => {
    let active = true;
    getPermissionStatuses().then((results) => {
      if (!active) return;
      setStatuses(Object.fromEntries(results.map((r) => [r.key, r])));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const onRequestPermissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      for (const entry of permissions) {
        const result = await requestAppPermission(entry.key);
        if (result) {
          setStatuses((prev) => ({ ...prev, [entry.key]: result }));
        }
      }
      router.replace("/");
    } catch (e) {
      setError(e.message || "Something went wrong while requesting permissions.");
    } finally {
      setLoading(false);
    }
  }, [permissions, router]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl + 80 },
        ]}
      >
        <View style={styles.header}>
          <ClayTile
            icon="devices"
            size="lg"
            backgroundColor={colors.secondaryContainer}
            color={colors.onSecondaryContainer}
            style={styles.iconTile}
          />
          <Text style={[type.headlineMd, styles.title, { color: colors.onSurface }]}>App Permissions</Text>
          <Text style={[type.bodyMd, styles.subtitle, { color: colors.onSurfaceVariant }]}>
            We need a few permissions to give you the best experience on the road.
          </Text>
        </View>

        <ErrorNotice message={error} />

        <View style={styles.cards}>
          {permissions.map((entry) => (
            <PermissionCard
              key={entry.key}
              icon={entry.icon}
              title={entry.title}
              description={entry.why}
              state={statuses[entry.key]}
            />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.stickyFooter, { 
        backgroundColor: colors.surface, 
        borderTopColor: colors.outlineVariant,
        paddingBottom: Math.max(insets.bottom, space.md)
      }]}>
        <ClayButton
          label="Enable Permissions"
          onPress={onRequestPermissions}
          loading={loading}
          size="lg"
          style={styles.fullButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { 
    paddingHorizontal: space.xl, 
    paddingTop: space.xl, 
    gap: space.xl, 
    width: "100%", 
    maxWidth: moderateScale(720), 
    alignSelf: "center" 
  },
  header: { alignItems: "center", gap: space.sm, marginTop: space.md },
  iconTile: {
    marginBottom: space.sm,
  },
  title: {
    fontFamily: fonts.displaySemiBold,
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    paddingHorizontal: space.md,
  },
  cards: { gap: space.md },
  cardItem: {
    flexDirection: "row",
    padding: space.md,
    gap: space.md,
    alignItems: "center"
  },
  cardText: { flex: 1, gap: 2 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  cardTitle: { flexShrink: 1 },
  stickyFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  fullButton: { width: "100%" }
});
