import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { useAuth } from "../../lib/auth";
import { AppAlert } from "../../components/AppAlert";
import { moderateScale } from "../../lib/scaling";
import { fonts } from "../../lib/theme";
import { apiFetch } from "../../lib/api";

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
  const { colors, type } = useTheme();
  const { clearAuth } = useAuth();
  
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
      setError(err.message || "Failed to load logged-in devices.");
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
      "Sign out this device?",
      isCurrent
        ? "This will sign you out of your current device. You will need to log in again."
        : `This will end the session on ${session.device}. The device will need to log in again to access your account.`,
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Sign Out", 
          style: "destructive",
          onPress: async () => {
            setRevoking(session.id);
            try {
              await apiFetch("/api/auth/sessions", {
                method: "DELETE",
                body: JSON.stringify({ id: session.id, kind: session.kind })
              });
              
              if (isCurrent) {
                await clearAuth();
                router.replace("/login");
              } else {
                setSessions(prev => prev.filter(s => s.id !== session.id));
              }
            } catch (err) {
              AppAlert.alert("Error", err.message || "Failed to sign out device.", [{ text: "OK" }]);
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
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.surface }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={[type.titleLg, { color: colors.onSurface }]}>Logged-in Devices</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <Text style={[type.bodyMd, { color: colors.error, textAlign: 'center', marginBottom: 16 }]}>{error}</Text>
          <Pressable 
            style={[styles.retryBtn, { backgroundColor: colors.primaryContainer }]} 
            onPress={fetchSessions}
          >
            <Text style={[type.labelLg, { color: colors.onPrimaryContainer }]}>Try Again</Text>
          </Pressable>
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="desktop-outline" size={64} color={colors.outline} style={{ marginBottom: 16 }} />
          <Text style={[type.titleMd, { color: colors.onSurface }]}>No logged-in devices</Text>
          <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, textAlign: 'center', marginTop: 8 }]}>
            You currently have no active sessions.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 20 }]}>
          <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, marginBottom: 8 }]}>
            {sessions.length} device{sessions.length === 1 ? '' : 's'}
          </Text>

          {currentSessions.length > 0 && (
            <>
              <Text style={[type.labelLg, { color: colors.primary, marginTop: 16, marginBottom: 8 }]}>CURRENT DEVICE</Text>
              {currentSessions.map(session => (
                <SessionCard 
                  key={session.id} 
                  session={session} 
                  colors={colors} 
                  type={type} 
                  isRevoking={revoking === session.id}
                  onRevoke={() => handleRevoke(session)} 
                />
              ))}
            </>
          )}

          {otherSessions.length > 0 && (
            <>
              <Text style={[type.labelLg, { color: colors.onSurfaceVariant, marginTop: 24, marginBottom: 8 }]}>OTHER DEVICES</Text>
              {otherSessions.map(session => (
                <SessionCard 
                  key={session.id} 
                  session={session} 
                  colors={colors} 
                  type={type} 
                  isRevoking={revoking === session.id}
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

function SessionCard({ session, colors, type, isRevoking, onRevoke }) {
  const isCurrent = session.is_current || session.current;
  const isMobile = session.kind === 'mobile';
  const IconName = isMobile ? 'phone-portrait-outline' : 'laptop-outline';
  
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.outlineVariant }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Ionicons name={IconName} size={20} color={colors.onSurfaceVariant} style={{ marginRight: 8 }} />
          <Text style={[type.titleMd, { color: colors.onSurface }]} numberOfLines={1}>
            {session.device || "Unknown Device"}
          </Text>
        </View>
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

        {session.ipAddress && (
          <View style={styles.infoRow}>
            <Ionicons name="git-network-outline" size={16} color={colors.onSurfaceVariant} />
            <Text style={[type.bodyMd, { color: colors.onSurfaceVariant, marginLeft: 8 }]}>
              IP: {session.ipAddress}
            </Text>
          </View>
        )}
        
        {isCurrent && (
          <View style={[styles.infoRow, { marginTop: 4 }]}>
            <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
            <Text style={[type.labelLg, { color: colors.primary, marginLeft: 8 }]}>This device</Text>
          </View>
        )}
      </View>

      <View style={[styles.cardFooter, { borderTopColor: colors.outlineVariant }]}>
        <Pressable 
          style={({ pressed }) => [
            styles.actionBtn, 
            pressed && { backgroundColor: colors.surfaceContainerHigh }
          ]} 
          onPress={onRevoke}
          disabled={isRevoking}
        >
          {isRevoking ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Text style={[type.labelLg, { color: colors.error }]}>Sign Out</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backBtn: { padding: 4 },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  scroll: {
    padding: 16,
    gap: 8,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardFooter: {
    borderTopWidth: 1,
  },
  actionBtn: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
