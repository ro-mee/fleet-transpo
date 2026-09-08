/**
 * Shared Offline Read Mode UI — the visual half of the 4-state offline UX
 * (mobile/lib/offline-ux.js is the logic half).
 *
 * - SyncNote: ONE inline contextual note per screen ("Using your last synced
 *   {label} for offline access.") + a "Saved · {age}" chip. Microcopy, not a
 *   banner — the global ConnectivityBanner owns the app-wide "You're offline"
 *   announcement; this says what THIS screen is showing.
 * - SavedChip: just the age chip, for offline confirmed-empty copy
 *   ("No X were assigned when last synced." + chip).
 * - NeverSyncedCard: dedicated empty card for offline never-synced devices —
 *   never rows or skeletons pretending to be data.
 *
 * All theme-aware via useTheme(); styles ported from the work-schedule.js
 * template (moderateScale + fonts idioms).
 */

import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";
import { moderateScale } from "../lib/scaling";
import { formatLastSynced } from "../lib/offline-cache";

export function SavedChip({ syncedAt }) {
  const { colors } = useTheme();
  const age = formatLastSynced(syncedAt);
  if (!age) return null;
  return (
    <View style={[styles.savedChip, { borderColor: colors.outlineVariant }]}>
      <Text style={[styles.savedChipText, { color: colors.onSurfaceVariant }]}>Saved · {age}</Text>
    </View>
  );
}

export function SyncNote({ syncedAt, label }) {
  const { colors } = useTheme();
  if (syncedAt == null) return null;
  return (
    <View style={styles.syncNoteRow}>
      <Text style={[styles.syncNote, { color: colors.onSurfaceVariant }]}>
        {`Using your last synced ${label} for offline access.`}
      </Text>
      <SavedChip syncedAt={syncedAt} />
    </View>
  );
}

export function NeverSyncedCard({ title = "No offline data yet", body }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceContainerLowest }]}>
      <Ionicons name="cloud-offline-outline" size={34} color={colors.onSurfaceVariant} />
      <Text style={[styles.cardTitle, { color: colors.onSurface }]}>{title}</Text>
      {body ? <Text style={[styles.cardBody, { color: colors.onSurfaceVariant }]}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: moderateScale(18),
    alignItems: "center",
    gap: moderateScale(8),
    paddingVertical: moderateScale(26),
    paddingHorizontal: moderateScale(16),
  },
  cardTitle: { fontFamily: fonts.displaySemiBold, fontSize: moderateScale(15) },
  cardBody: { fontFamily: fonts.body, fontSize: moderateScale(12), lineHeight: moderateScale(18), textAlign: "center" },
  syncNoteRow: { flexDirection: "row", alignItems: "center", gap: moderateScale(8), flexWrap: "wrap" },
  syncNote: { fontFamily: fonts.body, fontSize: moderateScale(12), lineHeight: moderateScale(18), flex: 1, minWidth: moderateScale(120) },
  savedChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: moderateScale(9), paddingVertical: moderateScale(3) },
  savedChipText: { fontFamily: fonts.dataSemiBold, fontSize: moderateScale(10), letterSpacing: 0.4 },
});
