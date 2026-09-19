import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { useAuth } from "../../lib/auth";
import { AppAlert } from "../../components/AppAlert";
import ClayScreenHeader from "../../components/ClayScreenHeader";
import { ClayBadge, ClayButton, ClayCard, ClayTile } from "../../components/clay";
import { apiFetch } from "../../lib/api";
import { fonts } from "../../lib/theme";

function formatDate(dateString) {
  if (!dateString) return "Unknown";
  const d = new Date(dateString);
  const now = new Date();
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

  if (isToday) {
    const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    return `Today at ${timeFormatter.format(d)}`;
  }

  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return formatter.format(d);
}

export default function LoggedInDevicesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type, scheme } = useTheme();
  const isDark = scheme === "dark";
  const { signOut } = useAuth();

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revoking, setRevoking] = useState(null);

  const fetchSessions = useCallback(async () => {
    // setLoading is already true initially; only set it if refreshing later
    setError(null);
    try {
      const data = await apiFetch("/api/auth/sessions");
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err.message || "Failed to load active sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSessions();
  }, [fetchSessions]);

  const handleRevoke = async (session) => {
    const isCurrent = session.is_current || session.current;

    AppAlert.alert(
      "Revoke this session?",
      isCurrent
        ? "This revokes the current app session and returns you to the sign-in screen."
        : `This immediately revokes the session on ${session.device}. The device will need to sign in again to access your account.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            const sessionKey = `${session.kind}:${session.id}`;
            setRevoking(sessionKey);
            try {
              await apiFetch("/api/auth/sessions", {
                method: "DELETE",
                body: JSON.stringify({ id: session.id, kind: session.kind })
              });

              if (isCurrent) {
                // The API already revoked this family; signOut clears local tokens and cache.
                await signOut();
                router.replace("/login");
              } else {
                setSessions(prev => prev.filter(s => s.id !== session.id || s.kind !== session.kind));
              }
            } catch (err) {
              AppAlert.alert("Error", err.message || "Failed to revoke session.", [{ text: "OK" }]);
            } finally {
              setRevoking(null);
            }
          }
        }
      ]
    );
  };

  const currentSessions = sessions.filter(s => s.is_current || s.current);
  const otherSessions = sessions.filter(s => !(s.is_current || s.current));

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ClayScreenHeader title="Devices & Sessions" onBack={() => router.back()} />

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <ClayTile icon="alert-circle-outline" size={56} variant="danger" style={{ marginBottom: 12 }} />
          <Text style={[type.bodyMd, { color: colors.error, textAlign: 'center', marginBottom: 16 }]}>{error}</Text>
          <ClayButton
            label="Try Again"
            variant="primary"
            onPress={fetchSessions}
          />
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.centerContainer}>
          <ClayTile icon="desktop-outline" size={56} variant="surface" style={{ marginBottom: 16 }} />
          <Text style={[type.titleMd, { color: colors.onSurface }]}>No active sessions</Text>
          <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 8 }]}>
            You currently have no active sessions.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, marginBottom: 8 }]}>
            {sessions.length} active session{sessions.length === 1 ? '' : 's'}
          </Text>
          <Text style={[type.caption, { color: colors.onSurfaceVariant, marginBottom: 8 }]}>
            The same IP can appear on multiple sessions when devices share Wi-Fi or a mobile network.
          </Text>

          {currentSessions.length > 0 && (
            <>
              <Text style={[styles.groupLabel, { color: colors.onSurfaceVariant }]}>CURRENT SESSION</Text>
              {currentSessions.map(session => (
                <SessionCard
                  key={`${session.kind}:${session.id}`}
                  session={session}
                  colors={colors}
                  type={type}
                  isDark={isDark}
                  isRevoking={revoking === `${session.kind}:${session.id}`}
                  onRevoke={() => handleRevoke(session)}
                />
              ))}
            </>
          )}

          {otherSessions.length > 0 && (
            <>
              <Text style={[styles.groupLabel, { color: colors.onSurfaceVariant, marginTop: 24 }]}>OTHER SESSIONS</Text>
              {otherSessions.map(session => (
                <SessionCard
                  key={`${session.kind}:${session.id}`}
                  session={session}
                  colors={colors}
                  type={type}
                  isDark={isDark}
                  isRevoking={revoking === `${session.kind}:${session.id}`}
                  onRevoke={() => handleRevoke(session)}
                />
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function SessionCard({ session, colors, type, isDark, isRevoking, onRevoke }) {
  const isCurrent = session.is_current || session.current;
  const isMobile = session.kind === 'mobile';
  const IconName = isMobile ? 'phone-portrait-outline' : 'laptop-outline';

  return (
    <ClayCard variant="standard" style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <ClayTile icon={IconName} size={38} variant="primary" />
          <Text style={[type.titleMd, { color: colors.onSurface, flex: 1 }]} numberOfLines={1}>
            {session.device || "Unknown Device"}
          </Text>
        </View>
        {isCurrent && (
          <ClayBadge label="This session" variant="primary" dot size="sm" />
        )}
      </View>

      <View style={styles.cardBody}>
        {session.location && (
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, marginLeft: 8 }]}>{session.location}</Text>
          </View>
        )}

        <View style={styles.infoRow}>
          <Ionicons name="time-outline" size={16} color={colors.onSurfaceVariant} />
          <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, marginLeft: 8 }]}>
            Active {formatDate(session.lastActiveAt)}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Ionicons name="log-in-outline" size={16} color={colors.onSurfaceVariant} />
          <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, marginLeft: 8 }]}>
            Session started {formatDate(session.createdAt)}
          </Text>
        </View>

        {session.ipAddress && (
          <View style={styles.infoRow}>
            <Ionicons name="git-network-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, marginLeft: 8 }]}>
              Network IP: {session.ipAddress}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.cardFooter, { borderTopColor: isDark ? colors.outlineVariant + "55" : "transparent" }]}>
        <ClayButton
          label="Revoke session"
          variant="danger"
          size="md"
          loading={isRevoking}
          disabled={isRevoking}
          onPress={onRevoke}
          accessibilityLabel={`Revoke ${session.device || "device"} session`}
        />
      </View>
    </ClayCard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 14,
    gap: 8,
  },
  groupLabel: {
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 8,
    fontSize: 12,
    fontFamily: fonts.dataSemiBold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  card: {
    padding: 20,
    marginBottom: 12,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  cardBody: {
    gap: 8,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardFooter: {
    borderTopWidth: 1,
    paddingTop: 14,
  },
});
