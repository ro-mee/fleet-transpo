import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api } from "../../../lib/api";
import { fonts } from "../../../lib/theme";
import { useTheme } from "../../../lib/theme-context";
import { AppAlert } from "../../../components/AppAlert";

// Driver-facing live status of one incident report. The driver files a report
// (or an SOS) and then waits — this screen is where the wait ends: it shows
// the fleet team's acknowledgement, the physical rescue they dispatched
// (what/who/ETA, Dispatched → En Route → Arrived), and the final resolution.
// While the incident is open the screen also streams the driver's live
// position so dispatch can find them even if they moved since reporting.
// Resolution is a soft loop: the driver confirms "I'm safe" or disputes with
// a reason, which reopens the incident. Fed by GET /api/driver/incidents;
// refreshes every 30s so a fresh update appears while the driver is watching.

function formatWhen(value) {
  if (!value) return "";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEta(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function TimelineStep({ icon, iconBg, iconColor, title, subtitle, body, colors, last }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepRail}>
        <View style={[styles.stepIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={16} color={iconColor} />
        </View>
        {!last && <View style={[styles.stepLine, { backgroundColor: colors.outlineVariant + '60' }]} />}
      </View>
      <View style={styles.stepBody}>
        <Text style={[styles.stepTitle, { color: colors.onSurface }]}>{title}</Text>
        {subtitle ? <Text style={[styles.stepSub, { color: colors.onSurfaceVariant }]}>{subtitle}</Text> : null}
        {body ? (
          <View style={[styles.noteCard, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + '40' }]}>
            <Text style={[styles.noteText, { color: colors.onSurface }]}>{body}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function IncidentStatusScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [incident, setIncident] = useState(null);
  const [responderMission, setResponderMission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [arriving, setArriving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [missionResolved, setMissionResolved] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const locationPermissionAsked = useRef(false);

  // Best-effort heartbeat: refresh the driver's live position while an
  // incident is open so dispatch sees where they actually are, not just where
  // they were at report time. Silent on every failure — the report-time
  // coordinates still exist and the poll must never break because GPS did.
  const postLocation = useCallback(async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") {
        if (locationPermissionAsked.current) return;
        locationPermissionAsked.current = true;
        const asked = await Location.requestForegroundPermissionsAsync();
        if (asked.status !== "granted") return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      // Not queued on failure: a location heartbeat replayed minutes later
      // would overwrite the driver's live position with a stale one.
      await api.post(
        `/api/driver/incidents/${id}/location`,
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
        { queueOnFailure: false }
      );
    } catch {
      // Best-effort only.
    }
  }, [id]);

  const load = useCallback(async () => {
    try {
      const data = await api.get("/api/driver/incidents");
      const found = Array.isArray(data) ? data.find((i) => String(i.incident_id) === String(id)) : null;
      if (found) {
        setResponderMission(null);
        setMissionResolved(false);
        setIncident(found);
        if ((found.status || "").toLowerCase() !== "resolved") {
          postLocation();
        }
      } else {
        // Not the reporting driver — maybe this driver is the assigned fleet
        // responder (the assignment notification deep-links here). Fall
        // through to the mission view instead of "not found".
        setIncident(null);
        try {
          const missions = await api.get("/api/driver/incidents?role=responder");
          const mission = Array.isArray(missions)
            ? missions.find((m) => String(m.incident_id) === String(id))
            : null;
          setResponderMission(mission || null);
        } catch {
          setResponderMission(null);
        }
      }
    } catch {
      setIncident(null);
      setResponderMission(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, postLocation]);

  useEffect(() => {
    // Deferred one tick: mount-fetch semantics without sync setState in the effect body.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Keep the status current while the driver waits for a response.
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const confirmResolution = async () => {
    try {
      setConfirming(true);
      await api.post(`/api/driver/incidents/${id}/confirm-resolution`);
      await load();
    } catch (e) {
      AppAlert.alert("Could not confirm", e?.message || "Please try again.");
    } finally {
      setConfirming(false);
    }
  };

  const submitReopen = async () => {
    const reason = disputeReason.trim();
    if (reason.length < 10) {
      AppAlert.alert("Tell us what's wrong", "Describe what still needs help (at least 10 characters).");
      return;
    }
    try {
      setDisputeSubmitting(true);
      await api.post(`/api/driver/incidents/${id}/reopen`, { reason });
      setDisputeOpen(false);
      setDisputeReason("");
      await load();
    } catch (e) {
      AppAlert.alert("Could not reopen", e?.message || "Please try again.");
    } finally {
      setDisputeSubmitting(false);
    }
  };

  // Manual arrival fallback for GPS flakiness — advances the mission to
  // "Arrived" and tells the driver + fleet team through the same path the
  // automatic tracker uses.
  const markArrived = async () => {
    try {
      setArriving(true);
      await api.post("/api/driver/responder/arrived");
      await load();
    } catch (e) {
      AppAlert.alert("Could not confirm arrival", e?.message || "Please try again.");
    } finally {
      setArriving(false);
    }
  };

  // Field resolution: the reporter or the responder closes the incident
  // themselves — the fleet team (and the other party) is notified by the API.
  // A confirm dialog guards the tap; the server re-checks every rule anyway.
  const confirmFieldResolve = (role) => {
    AppAlert.alert(
      "Close this incident?",
      "This marks the incident as resolved and notifies the fleet team. Only confirm once the situation is fully handled.",
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "Resolved",
          onPress: async () => {
            try {
              setResolving(true);
              await api.post(
                role === "responder"
                  ? "/api/driver/responder/resolve"
                  : `/api/driver/incidents/${id}/resolve`
              );
              if (role === "responder") setMissionResolved(true);
              await load();
            } catch (e) {
              AppAlert.alert("Could not resolve", e?.message || "Please try again.");
            } finally {
              setResolving(false);
            }
          },
        },
      ]
    );
  };

  // Drive to where the stranded driver actually is (live) — on the in-app
  // live map, mirroring the guest-trip navigation. The nav screen itself
  // falls back to the report-time coordinates, so only a report with no
  // coordinates at all is blocked here.
  const openNavigation = () => {
    if (!responderMission) return;
    const lat = responderMission.driver_latitude ?? responderMission.latitude;
    const lng = responderMission.driver_longitude ?? responderMission.longitude;
    if (lat == null || lng == null) {
      AppAlert.alert("No coordinates", "The incident report has no location to navigate to.");
      return;
    }
    router.push({ pathname: "/incident/navigate", params: { id: String(responderMission.incident_id) } });
  };

  if (loading) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={[styles.topBar, { backgroundColor: colors.surface }]}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: colors.onSurface }]}>Incident Status</Text>
        </View>
        <View style={styles.centerBox}>
          <Text style={[styles.loadingText, { color: colors.onSurfaceVariant }]}>Loading report…</Text>
        </View>
      </View>
    );
  }

  const resolved = (incident?.status || "").toLowerCase() === "resolved";
  const acknowledged = Boolean(incident?.acknowledged_at);
  const responseNote = incident?.acknowledge_note || null;
  const responseStatus = incident?.response_status || null;
  const awaitingConfirmation = resolved && !incident?.driver_confirmed_at;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { backgroundColor: colors.surface, paddingTop: insets.top }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.topBarTitle, { color: colors.onSurface }]}>
            {responderMission && !incident ? "Rescue Mission" : "Incident Status"}
          </Text>
          {incident || responderMission ? (
            <Text style={[styles.topBarSub, { color: colors.onSurfaceVariant }]}>
              Report #{(incident || responderMission).incident_id}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {missionResolved && !incident && !responderMission ? (
          // The mission left the responder feed the moment it resolved — this
          // is the success state for the driver who just closed it, not a
          // "not found".
          <View style={styles.centerBox}>
            <Ionicons name="checkmark-done-circle" size={36} color={colors.secondary} />
            <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>Mission complete</Text>
            <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
              You resolved this incident from the field — the driver and the fleet team have been notified. Thank you.
            </Text>
          </View>
        ) : !incident && !responderMission ? (
          <View style={styles.centerBox}>
            <Ionicons name="warning-outline" size={36} color={colors.onSurfaceVariant} />
            <Text style={[styles.emptyTitle, { color: colors.onSurface }]}>Report not found</Text>
            <Text style={[styles.emptySub, { color: colors.onSurfaceVariant }]}>
              This incident is not linked to your account. Pull down to retry.
            </Text>
          </View>
        ) : responderMission && !incident ? (
          <>
            {/* Responder mission view — this driver is the dispatched help.
                Their GPS poster feeds the status ladder; this screen is for
                finding the driver and the manual arrival fallback. */}
            <View style={[styles.banner, { backgroundColor: colors.primaryContainer }]}>
              <Ionicons name="car-sport" size={22} color={colors.primary} />
              <Text style={[styles.bannerTitle, { color: colors.onSurface }]}>
                {responderMission.response_status === "Arrived"
                  ? "You are on scene"
                  : responderMission.response_status === "En Route"
                    ? `En route${responderMission.response_eta ? ` — ETA ${formatEta(responderMission.response_eta)}` : ""}`
                    : "You are the responder"}
              </Text>
            </View>

            <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.primary + "66" }]}>
              <View style={styles.summaryRow}>
                <View style={[styles.typeIcon, { backgroundColor: colors.errorContainer }]}>
                  <Ionicons name="warning-outline" size={20} color={colors.error} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.incidentType, { color: colors.onSurface }]}>
                    {(responderMission.incident_type || "Incident").replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())}
                  </Text>
                  <Text style={[styles.incidentMeta, { color: colors.onSurfaceVariant }]}>
                    {`${responderMission.driver_first_name || ""} ${responderMission.driver_last_name || ""}`.trim() || "Fleet driver"}
                    {responderMission.severity ? ` • ${responderMission.severity} Severity` : ""}
                    {responderMission.plate_number ? ` • ${responderMission.plate_number}` : ""}
                  </Text>
                </View>
              </View>
              {responderMission.location ? (
                <Text style={[styles.detailLine, { color: colors.onSurfaceVariant }]}>
                  <Ionicons name="location-outline" size={14} color={colors.onSurfaceVariant} /> {responderMission.location}
                </Text>
              ) : null}
              {responderMission.description ? (
                <Text style={[styles.detailBody, { color: colors.onSurface }]}>{responderMission.description}</Text>
              ) : null}
              {Array.isArray(responderMission.assistance_needed) && responderMission.assistance_needed.length > 0 ? (
                <View style={styles.chipWrap}>
                  {responderMission.assistance_needed.map((need) => (
                    <View key={need} style={[styles.chip, { backgroundColor: colors.errorContainer }]}>
                      <Text style={[styles.chipText, { color: colors.onErrorContainer }]}>{need}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + "40" }]}>
              <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>{"Driver's position"}</Text>
              {responderMission.driver_latitude != null && responderMission.driver_longitude != null ? (
                <Text style={[styles.detailLine, { color: colors.onSurfaceVariant }]}>
                  <Ionicons name="navigate" size={14} color={colors.primary} />
                  {"  "}Live{responderMission.driver_location_at ? ` — updated ${formatWhen(responderMission.driver_location_at)}` : ""}
                </Text>
              ) : (
                <Text style={[styles.detailLine, { color: colors.onSurfaceVariant }]}>
                  <Ionicons name="navigate" size={14} color={colors.onSurfaceVariant} />
                  {"  "}{"Using the report-time location (driver's phone is quiet)"}
                </Text>
              )}
              <Pressable
                onPress={openNavigation}
                accessibilityRole="button"
                accessibilityLabel="Open navigation to the driver"
                style={({ pressed }) => [
                  styles.confirmBtn,
                  { backgroundColor: colors.primary },
                  pressed && styles.actionPressed,
                ]}
              >
                <Ionicons name="navigate" size={20} color={colors.onPrimary} />
                <Text style={[styles.confirmBtnText, { color: colors.onPrimary }]}>Navigate to driver</Text>
              </Pressable>
            </View>

            {responderMission.response_status === "Arrived" ? (
              // On scene — the responder can close the whole incident from the
              // field; the fleet team and the driver are notified, and the
              // driver still gets their confirm-or-dispute prompt.
              <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + "40" }]}>
                <Text style={[styles.confirmPrompt, { color: colors.onSurface }]}>
                  All handled? You can close this incident yourself — the fleet team and the driver will be notified.
                </Text>
                <Pressable
                  onPress={() => confirmFieldResolve("responder")}
                  disabled={resolving}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm the incident is resolved"
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    { backgroundColor: colors.primary },
                    (pressed || resolving) && styles.actionPressed,
                  ]}
                >
                  {resolving ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Ionicons name="checkmark-done" size={20} color={colors.onPrimary} />
                  )}
                  <Text style={[styles.confirmBtnText, { color: colors.onPrimary }]}>
                    {resolving ? "Resolving…" : "Mission complete — resolved"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + "40" }]}>
                <Text style={[styles.confirmPrompt, { color: colors.onSurface }]}>
                  Arrived? GPS marks it automatically — use this if your signal is weak.
                </Text>
                <Pressable
                  onPress={markArrived}
                  disabled={arriving}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm you have arrived"
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    { backgroundColor: colors.secondary },
                    (pressed || arriving) && styles.actionPressed,
                  ]}
                >
                  {arriving ? (
                    <ActivityIndicator size="small" color={colors.onSecondary} />
                  ) : (
                    <Ionicons name="checkmark-circle" size={20} color={colors.onSecondary} />
                  )}
                  <Text style={[styles.confirmBtnText, { color: colors.onSecondary }]}>
                    {arriving ? "Updating…" : "I've arrived"}
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <>
            {/* Response banner — the single most important thing on the screen.
                Strongest signal wins: the rescue arriving beats "acknowledged". */}
            {resolved ? (
              <View style={[styles.banner, { backgroundColor: colors.secondaryContainer }]}>
                <Ionicons name="checkmark-circle" size={22} color={colors.secondary} />
                <Text style={[styles.bannerTitle, { color: colors.onSurface }]}>
                  {awaitingConfirmation ? "Resolved — please confirm" : "Resolved"}
                </Text>
              </View>
            ) : responseStatus === "Arrived" ? (
              <View style={[styles.banner, { backgroundColor: colors.secondaryContainer }]}>
                <Ionicons name="medkit" size={22} color={colors.secondary} />
                <Text style={[styles.bannerTitle, { color: colors.onSurface }]}>Help has arrived</Text>
              </View>
            ) : responseStatus ? (
              <View style={[styles.banner, { backgroundColor: colors.secondaryContainer }]}>
                <Ionicons name="medkit-outline" size={22} color={colors.secondary} />
                <Text style={[styles.bannerTitle, { color: colors.onSurface }]}>
                  {responseStatus === "En Route"
                    ? `Help is en route${incident.response_eta ? ` — ETA ${formatEta(incident.response_eta)}` : ""}`
                    : "Help has been dispatched"}
                </Text>
              </View>
            ) : acknowledged ? (
              <View style={[styles.banner, { backgroundColor: colors.secondaryContainer }]}>
                <Ionicons name="send-outline" size={22} color={colors.secondary} />
                <Text style={[styles.bannerTitle, { color: colors.onSurface }]}>Help is on the way</Text>
              </View>
            ) : (
              <View style={[styles.banner, { backgroundColor: colors.errorContainer }]}>
                <Ionicons name="time-outline" size={22} color={colors.error} />
                <Text style={[styles.bannerTitle, { color: colors.onSurface }]}>Waiting for fleet response</Text>
              </View>
            )}

            {/* Physical rescue card — what was sent, who, and when it lands */}
            {responseStatus ? (
              <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.primary + "66" }]}>
                <View style={styles.summaryRow}>
                  <View style={[styles.typeIcon, { backgroundColor: colors.primaryContainer }]}>
                    <Ionicons name="medkit-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.incidentType, { color: colors.onSurface }]}>
                      {responseStatus === "Arrived" ? "Help has arrived" : responseStatus === "En Route" ? "En route to you" : "Help dispatched"}
                    </Text>
                    <Text style={[styles.incidentMeta, { color: colors.onSurfaceVariant }]}>
                      {incident.response_type || "Responder"}
                      {responseStatus !== "Arrived" && incident.response_eta ? ` • ETA ${formatEta(incident.response_eta)}` : ""}
                      {incident.responded_at ? ` • updated ${formatWhen(incident.responded_at)}` : ""}
                    </Text>
                  </View>
                </View>
                {incident.response_details ? (
                  <Text style={[styles.detailBody, { color: colors.onSurface }]}>{incident.response_details}</Text>
                ) : null}
                {incident.responder_first_name ? (
                  <Text style={[styles.detailLine, { color: colors.onSurfaceVariant }]}>
                    <Ionicons name="navigate" size={14} color={colors.primary} />{"  "}
                    {`${incident.responder_first_name} ${incident.responder_last_name || ""}`.trim()} is GPS-tracked — this card updates automatically as they drive.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* Field resolution — the driver knows when the situation is
                actually handled (help fixed it, or it was a false alarm), so
                they can close it themselves once the fleet team has
                acknowledged. The fleet team is notified automatically. */}
            {!resolved && acknowledged ? (
              <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
                <Text style={[styles.confirmPrompt, { color: colors.onSurface }]}>
                  All good? You can close this incident yourself once it is fully handled — the fleet team will be notified.
                </Text>
                <Pressable
                  onPress={() => confirmFieldResolve("driver")}
                  disabled={resolving}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm the incident is resolved"
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    { backgroundColor: colors.primary },
                    (pressed || resolving) && styles.actionPressed,
                  ]}
                >
                  {resolving ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Ionicons name="checkmark-done" size={20} color={colors.onPrimary} />
                  )}
                  <Text style={[styles.confirmBtnText, { color: colors.onPrimary }]}>
                    {resolving ? "Resolving…" : "I'm safe — resolved"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* Summary card */}
            <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
              <View style={styles.summaryRow}>
                <View style={[styles.typeIcon, { backgroundColor: colors.errorContainer }]}>
                  <Ionicons name="warning-outline" size={20} color={colors.error} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.incidentType, { color: colors.onSurface }]}>
                    {(incident.incident_type || "Incident").replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())}
                  </Text>
                  <Text style={[styles.incidentMeta, { color: colors.onSurfaceVariant }]}>
                    {incident.severity || "Minor"} Severity
                    {incident.plate_number ? ` • ${incident.plate_number}` : ""}
                  </Text>
                </View>
              </View>
              {incident.location ? (
                <Text style={[styles.detailLine, { color: colors.onSurfaceVariant }]}>
                  <Ionicons name="location-outline" size={14} color={colors.onSurfaceVariant} /> {incident.location}
                </Text>
              ) : null}
              {incident.description ? (
                <Text style={[styles.detailBody, { color: colors.onSurface }]}>
                  {incident.description}
                </Text>
              ) : null}
              {Array.isArray(incident.assistance_needed) && incident.assistance_needed.length > 0 ? (
                <View style={styles.chipWrap}>
                  {incident.assistance_needed.map((need) => (
                    <View key={need} style={[styles.chip, { backgroundColor: colors.errorContainer }]}>
                      <Text style={[styles.chipText, { color: colors.onErrorContainer }]}>{need}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            {/* Soft confirmation loop — the resolution only truly closes when the
                driver says they are safe. Dispute reopens the incident. */}
            {awaitingConfirmation ? (
              <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
                <Text style={[styles.confirmPrompt, { color: colors.onSurface }]}>
                  Are you safe now? Confirm this resolution, or tell us if you still need help.
                </Text>
                <Pressable
                  onPress={confirmResolution}
                  disabled={confirming}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm you are safe"
                  style={({ pressed }) => [
                    styles.confirmBtn,
                    { backgroundColor: colors.primary },
                    (pressed || confirming) && styles.actionPressed,
                  ]}
                >
                  {confirming ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Ionicons name="checkmark-circle" size={20} color={colors.onPrimary} />
                  )}
                  <Text style={[styles.confirmBtnText, { color: colors.onPrimary }]}>
                    {confirming ? "Confirming…" : "I'm safe — confirm"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setDisputeOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel="Still need help"
                  style={({ pressed }) => [
                    styles.disputeBtn,
                    { borderColor: colors.error },
                    pressed && styles.actionPressed,
                  ]}
                >
                  <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
                  <Text style={[styles.disputeBtnText, { color: colors.error }]}>Still need help</Text>
                </Pressable>
                {disputeOpen ? (
                  <View style={{ gap: 8 }}>
                    <TextInput
                      value={disputeReason}
                      onChangeText={setDisputeReason}
                      placeholder="What still needs help? (required)"
                      placeholderTextColor={colors.onSurfaceVariant}
                      multiline
                      style={[
                        styles.disputeInput,
                        {
                          borderColor: colors.outlineVariant,
                          color: colors.onSurface,
                          backgroundColor: colors.surfaceContainerHighest,
                        },
                      ]}
                    />
                    <Pressable
                      onPress={submitReopen}
                      disabled={disputeSubmitting}
                      accessibilityRole="button"
                      accessibilityLabel="Send dispute and reopen incident"
                      style={({ pressed }) => [
                        styles.reopenBtn,
                        { backgroundColor: colors.error },
                        (pressed || disputeSubmitting) && styles.actionPressed,
                      ]}
                    >
                      {disputeSubmitting ? (
                        <ActivityIndicator size="small" color={colors.onError} />
                      ) : (
                        <Ionicons name="refresh" size={20} color={colors.onError} />
                      )}
                      <Text style={[styles.confirmBtnText, { color: colors.onError }]}>
                        {disputeSubmitting ? "Sending…" : "Reopen this incident"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Timeline */}
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Response Timeline</Text>
            <View style={[styles.card, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant + '40' }]}>
              <TimelineStep
                icon="flag-outline"
                iconBg={colors.primaryContainer}
                iconColor={colors.onPrimaryContainer}
                title="Report submitted"
                subtitle={formatWhen(incident.created_at || incident.incident_date)}
                body={incident.description || null}
                colors={colors}
              />
              <TimelineStep
                icon={acknowledged ? "checkmark-circle" : "ellipse-outline"}
                iconBg={acknowledged ? colors.secondaryContainer : colors.surfaceContainerHighest}
                iconColor={acknowledged ? colors.secondary : colors.onSurfaceVariant}
                title={acknowledged ? "Acknowledged by fleet team" : "Awaiting acknowledgement"}
                subtitle={acknowledged ? formatWhen(incident.acknowledged_at) : "The fleet team has been notified"}
                body={responseNote || null}
                colors={colors}
              />
              {responseStatus ? (
                <TimelineStep
                  icon="medkit"
                  iconBg={colors.primaryContainer}
                  iconColor={colors.primary}
                  title={
                    responseStatus === "Arrived"
                      ? "Help arrived"
                      : responseStatus === "En Route"
                        ? "Help en route to you"
                        : "Help dispatched"
                  }
                  subtitle={formatWhen(incident.responded_at)}
                  body={
                    [incident.response_type, incident.response_details]
                      .filter(Boolean)
                      .join(" · ") || null
                  }
                  colors={colors}
                />
              ) : null}
              <TimelineStep
                icon={resolved ? "checkmark-done-circle" : "ellipse-outline"}
                iconBg={resolved ? colors.secondaryContainer : colors.surfaceContainerHighest}
                iconColor={resolved ? colors.secondary : colors.onSurfaceVariant}
                title={resolved ? "Resolved" : "Resolution pending"}
                subtitle={resolved ? formatWhen(incident.resolved_at) : "We will notify you when this is closed out"}
                body={resolved && incident.actions_taken ? `Actions taken: ${incident.actions_taken}` : null}
                colors={colors}
                last={!(incident.reopened_at || (resolved && incident.driver_confirmed_at))}
              />
              {incident.reopened_at ? (
                <TimelineStep
                  icon="refresh"
                  iconBg={colors.errorContainer}
                  iconColor={colors.error}
                  title="You disputed the resolution"
                  subtitle={formatWhen(incident.reopened_at)}
                  body="This incident was reopened and is back with the fleet team."
                  colors={colors}
                  last
                />
              ) : resolved && incident.driver_confirmed_at ? (
                <TimelineStep
                  icon="checkmark-done"
                  iconBg={colors.secondaryContainer}
                  iconColor={colors.secondary}
                  title="You confirmed this resolution"
                  subtitle={formatWhen(incident.driver_confirmed_at)}
                  colors={colors}
                  last
                />
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: { fontSize: 17, fontFamily: fonts.displayBold },
  topBarSub: { fontSize: 12, fontFamily: fonts.body, marginTop: 1 },
  centerBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  loadingText: { fontSize: 14, fontFamily: fonts.body },
  emptyTitle: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  emptySub: { fontSize: 13, fontFamily: fonts.body, textAlign: "center", lineHeight: 19 },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  bannerTitle: { fontSize: 15, fontFamily: fonts.bodySemiBold },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  typeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  incidentType: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  incidentMeta: { fontSize: 12, fontFamily: fonts.body, marginTop: 2 },
  detailLine: { fontSize: 13, fontFamily: fonts.body, lineHeight: 18 },
  detailBody: { fontSize: 13, fontFamily: fonts.body, lineHeight: 19 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 11, fontFamily: fonts.bodySemiBold },
  sectionTitle: { fontSize: 14, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  stepRow: { flexDirection: "row", gap: 12 },
  stepRail: { alignItems: "center", width: 28 },
  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stepLine: { flex: 1, width: 2, marginVertical: 2 },
  stepBody: { flex: 1, paddingBottom: 18 },
  stepTitle: { fontSize: 14, fontFamily: fonts.bodySemiBold },
  stepSub: { fontSize: 12, fontFamily: fonts.body, marginTop: 2, marginBottom: 6 },
  noteCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteText: { fontSize: 13, fontFamily: fonts.body, lineHeight: 19 },
  confirmPrompt: { fontSize: 13, fontFamily: fonts.body, lineHeight: 19 },
  confirmBtn: {
    minHeight: 46,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  confirmBtnText: { fontSize: 14, fontFamily: fonts.bodySemiBold },
  disputeBtn: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  disputeBtnText: { fontSize: 14, fontFamily: fonts.bodySemiBold },
  disputeInput: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 13,
    fontFamily: fonts.body,
    minHeight: 84,
    textAlignVertical: "top",
  },
  reopenBtn: {
    minHeight: 46,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionPressed: { opacity: 0.86 },
});
