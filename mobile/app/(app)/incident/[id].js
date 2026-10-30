import React, { useLayoutEffect, useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, RefreshControl, AppState } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useAuth } from '../../../lib/auth';
import { useConnectivity } from '../../../lib/connectivity-context';
import { runResponderAction } from '../../../lib/responder-action';
import { api } from "../../../lib/api";
import { fonts } from "../../../lib/theme";
import { useTheme } from "../../../lib/theme-context";
import { AppAlert } from "../../../components/AppAlert";
import { ClayCard, ClayButton, ClayTile, ClayBadge } from "../../../components/clay";

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
  const { user } = useAuth();
  const { status: connection } = useConnectivity();
  const routeContext = useRef(null), readAuthority = useRef(null), responderBusy = useRef(false);
  useLayoutEffect(() => {
    routeContext.current = `${user?.employeeId}:${id}:${connection}`;
    return () => { routeContext.current = null; readAuthority.current = null; };
  }, [user?.employeeId, id, connection]);
  const currentMission = () => connection === 'online' && routeContext.current === `${user?.employeeId}:${id}:${connection}` && readAuthority.current === routeContext.current;

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [loadError, setLoadError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
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
    const context = routeContext.current;
    readAuthority.current = null;
    try {
      const data = await api.get("/api/driver/incidents");
      if (routeContext.current !== context) return;
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
        const missions = await api.get("/api/driver/incidents?role=responder");
        if (routeContext.current !== context) return;
        const mission = Array.isArray(missions)
          ? missions.find((m) => String(m.incident_id) === String(id))
          : null;
        setIncident(null);
        setResponderMission(mission || null);
      }
      readAuthority.current = context;
      setLoadError(null);
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      if (routeContext.current !== context) return;
      setLoadError(error?.message || "Could not refresh the incident. Check your connection and retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, postLocation]);

  useFocusEffect(useCallback(() => {
    const refresh = () => { if (AppState.currentState === "active") load(); };
    const first = setTimeout(refresh, 0);
    const poll = setInterval(refresh, 30000);
    const subscription = AppState.addEventListener("change", next => { if (next === "active") load(); });
    return () => { clearTimeout(first); clearInterval(poll); subscription.remove(); };
  }, [load]));

  const confirmResolution = async () => {
    try {
      setConfirming(true);
      const result = await api.post(`/api/driver/incidents/${id}/confirm-resolution`, undefined, { queueOnFailure: false });
      if (result?.queued) throw new Error("Confirmation has not reached the server. Please retry when connected.");
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
      const result = await api.post(`/api/driver/incidents/${id}/reopen`, { reason }, { queueOnFailure: false });
      if (result?.queued) throw new Error("Reopening was not confirmed. Your reason is kept; please retry when connected.");
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
    if (responderBusy.current) return;
    responderBusy.current = true;
    try {
      setArriving(true);
      const result = await runResponderAction({ incidentId: id, actorId: user?.employeeId, action: "arrived", isCurrent: currentMission });
      if (result?.queued) throw new Error("Arrival was not confirmed. Please retry when connected.");
      await load();
    } catch (e) {
      AppAlert.alert("Could not confirm arrival", e?.message || "Please try again.");
    } finally {
      responderBusy.current = false;
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
            if (role === "responder" && responderBusy.current) return;
            if (role === "responder") responderBusy.current = true;
            try {
              setResolving(true);
              const result = role === "responder"
                ? await runResponderAction({ incidentId: id, actorId: user?.employeeId, action: "resolve", isCurrent: currentMission })
                : await api.post(`/api/driver/incidents/${id}/resolve`, undefined, { queueOnFailure: false });
              if (result?.queued) throw new Error("Resolution was not confirmed. Please retry when connected.");
              if (role === "responder") setMissionResolved(true);
              await load();
            } catch (e) {
              AppAlert.alert("Could not resolve", e?.message || "Please try again.");
            } finally {
              responderBusy.current = false;
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
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
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
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
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
        {loadError ? <View style={{ padding: 16, gap: 8 }}><Text accessibilityLiveRegion="polite" style={{ color: colors.error }}>{incident || responderMission ? "Showing last known status. " : "Incident status unavailable. "}{loadError}</Text><ClayButton label="Retry incident status" onPress={load} variant="tonal" /></View> : null}
        {lastUpdated ? <Text style={{ color: colors.onSurfaceVariant }}>Last updated {formatWhen(lastUpdated)}</Text> : null}
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
        ) : !incident && !responderMission && loadError ? null : !incident && !responderMission ? (
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

            <ClayCard style={styles.card}>
              <View style={styles.summaryRow}>
                <ClayTile icon="warning-outline" size={38} style={{ backgroundColor: colors.errorContainer }} />
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
                    <ClayBadge key={need} text={need} tone="danger" />
                  ))}
                </View>
              ) : null}
            </ClayCard>

            <ClayCard style={styles.card}>
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
              <ClayButton
                label="Navigate to driver"
                variant="primary"
                icon="navigate"
                onPress={openNavigation}
                style={{ alignSelf: 'stretch', marginTop: 8 }}
              />
            </ClayCard>

            {responderMission.response_status === "Arrived" ? (
              // On scene — the responder can close the whole incident from the
              // field; the fleet team and the driver are notified, and the
              // driver still gets their confirm-or-dispute prompt.
              <ClayCard style={styles.card}>
                <Text style={[styles.confirmPrompt, { color: colors.onSurface }]}>
                  All handled? You can close this incident yourself — the fleet team and the driver will be notified.
                </Text>
                <ClayButton
                  label={resolving ? "Resolving…" : "Mission complete — resolved"}
                  variant="primary"
                  icon="checkmark-done"
                  loading={resolving}
                  disabled={resolving || !!loadError || connection !== "online"}
                  onPress={() => confirmFieldResolve("responder")}
                  style={{ alignSelf: 'stretch', marginTop: 8 }}
                />
              </ClayCard>
            ) : (
              <ClayCard style={styles.card}>
                <Text style={[styles.confirmPrompt, { color: colors.onSurface }]}>
                  Arrived? GPS marks it automatically — use this if your signal is weak.
                </Text>
                <ClayButton
                  label={arriving ? "Updating…" : "I've arrived"}
                  variant="secondary"
                  icon="checkmark-circle"
                  loading={arriving}
                  disabled={arriving || !!loadError || connection !== "online"}
                  onPress={markArrived}
                  style={{ alignSelf: 'stretch', marginTop: 8 }}
                />
              </ClayCard>
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
              <ClayCard style={styles.card}>
                <View style={styles.summaryRow}>
                  <ClayTile icon="medkit-outline" size={38} style={{ backgroundColor: colors.primaryContainer }} />
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
              </ClayCard>
            ) : null}

            {/* Field resolution — the driver knows when the situation is
                actually handled (help fixed it, or it was a false alarm), so
                they can close it themselves once the fleet team has
                acknowledged. The fleet team is notified automatically. */}
            {!resolved && acknowledged ? (
              <ClayCard style={styles.card}>
                <Text style={[styles.confirmPrompt, { color: colors.onSurface }]}>
                  All good? You can close this incident yourself once it is fully handled — the fleet team will be notified.
                </Text>
                <ClayButton
                  label={resolving ? "Resolving…" : "I'm safe — resolved"}
                  variant="primary"
                  icon="checkmark-done"
                  loading={resolving}
                  disabled={resolving || !!loadError || connection !== "online"}
                  onPress={() => confirmFieldResolve("driver")}
                  style={{ alignSelf: 'stretch', marginTop: 8 }}
                />
              </ClayCard>
            ) : null}

            {/* Summary card */}
            <ClayCard style={styles.card}>
              <View style={styles.summaryRow}>
                <ClayTile icon="warning-outline" size={38} style={{ backgroundColor: colors.errorContainer }} />
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
                    <ClayBadge key={need} text={need} tone="danger" />
                  ))}
                </View>
              ) : null}
            </ClayCard>

            {/* Soft confirmation loop — the resolution only truly closes when the
                driver says they are safe. Dispute reopens the incident. */}
            {awaitingConfirmation ? (
              <ClayCard style={styles.card}>
                <Text style={[styles.confirmPrompt, { color: colors.onSurface }]}>
                  Are you safe now? Confirm this resolution, or tell us if you still need help.
                </Text>
                <ClayButton
                  label={confirming ? "Confirming…" : "I'm safe — confirm"}
                  variant="primary"
                  icon="checkmark-circle"
                  loading={confirming}
                  disabled={confirming}
                  onPress={confirmResolution}
                  style={{ alignSelf: 'stretch' }}
                />
                <ClayButton
                  label="Still need help"
                  variant="outline"
                  icon="alert-circle-outline"
                  onPress={() => setDisputeOpen((v) => !v)}
                  style={{ alignSelf: 'stretch', marginTop: 8 }}
                />
                {disputeOpen ? (
                  <View style={{ gap: 8, marginTop: 8 }}>
                    <TextInput
                    accessibilityLabel="Reason this incident still needs help"
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
                    <ClayButton
                      label={disputeSubmitting ? "Sending…" : "Reopen this incident"}
                      variant="danger"
                      icon="refresh"
                      loading={disputeSubmitting}
                      disabled={disputeSubmitting}
                      onPress={submitReopen}
                      style={{ alignSelf: 'stretch' }}
                    />
                  </View>
                ) : null}
              </ClayCard>
            ) : null}

            {/* Timeline */}
            <Text style={[styles.sectionTitle, { color: colors.onSurface }]}>Response Timeline</Text>
            <ClayCard style={styles.card}>
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
              {incident.dispute_reason ? (
                <TimelineStep
                  icon="refresh"
                  iconBg={colors.errorContainer}
                  iconColor={colors.error}
                  title="Driver requested more help"
                  subtitle={formatWhen(incident.reopened_at)}
                  body={incident.dispute_reason}
                  colors={colors}
                />
              ) : null}
              {resolved && !incident.driver_confirmed_at ? (
                <TimelineStep
                  icon="checkmark"
                  iconBg={colors.secondaryContainer}
                  iconColor={colors.secondary}
                  title="Marked resolved by fleet team"
                  subtitle={formatWhen(incident.resolved_at)}
                  body="Pending your confirmation that you are safe."
                  colors={colors}
                  last
                />
              ) : resolved && incident.reopened_at ? (
                <TimelineStep
                  icon="warning-outline"
                  iconBg={colors.errorContainer}
                  iconColor={colors.error}
                  title="Reopened"
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
            </ClayCard>
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
  incidentType: { fontSize: 16, fontFamily: fonts.displaySemiBold || fonts.bodySemiBold },
  incidentMeta: { fontSize: 12, fontFamily: fonts.body, marginTop: 2 },
  detailLine: { fontSize: 13, fontFamily: fonts.body, lineHeight: 18 },
  detailBody: { fontSize: 13, fontFamily: fonts.body, lineHeight: 19 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
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
});
