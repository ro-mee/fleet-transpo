import DriverGuideTrigger from '../coachmarks/DriverGuideTrigger';
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as Location from 'expo-location';
import * as FileSystem from "expo-file-system/legacy";
import { ClayButton } from "../clay";
import { resolveDriverWorkspace } from "../../lib/driver-workspace";
import ClayScreenHeader from "../ClayScreenHeader";
import { CargoWorkflowContent } from "./CargoWorkflowContent";
import { CargoSignatureModal } from "./CargoSignatureModal";
import { CargoPhysicalManifest } from "./CargoItemReceiptRow";
import { useDriverProfile } from "../../lib/driver-profile";
import { useAuth } from "../../lib/auth";
import { useConnectivity } from "../../lib/connectivity-context";
import { useTheme } from "../../lib/theme-context";
import { api } from "../../lib/api";
import { cargoApi } from "../../lib/cargo-api";
import { getCargoSyncState, captureCargoSession, isCurrentCargoSession } from "../../lib/cargo-sync";
import { readCargoForm, saveCargoForm, submitCargoObservation } from "../../lib/cargo-form-state";
import { blankCargoCounts, buildCargoViewModel, buildCargoReceipt, validateCargoCounts, readCargoScreenSources, workspaceModeLabel, workspaceBlockReason } from "../../lib/cargo-view-model";
import { cargoSignatureContextKey, captureCargoSignatureLocation } from "../../lib/cargo-signature";
const EMPTY_FORM = { counts: {}, issues: {} };
export default function CargoWorkflowScreen({ mode = "overview" }) {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const actorId = user?.employeeId;
  const { profile, serverConfirmed, reload: reloadProfile } = useDriverProfile();
  const driverType = profile?.driverType;
  const { status } = useConnectivity(), router = useRouter(), insets = useSafeAreaInsets(), { colors, type } = useTheme();
  const offline = status === "offline", stage = mode === "delivery" ? "DELIVERY" : "PICKUP";
  const identity = `${actorId}:${id}:${stage}:${mode}`;
  const [screen, setScreen] = useState({ identity: null, execution: null, trip: null, fresh: false, syncState: {}, loading: true, error: null });
  const [form, setForm] = useState(EMPTY_FORM), [errors, setErrors] = useState({}), [issueLine, setIssueLine] = useState(null), [review, setReview] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(null);
  const [signatureRequest, setSignatureRequest] = useState(null);
  const formRef = useRef(EMPTY_FORM), inFlight = useRef(false), requestNumber = useRef(0), formRevision = useRef(0), formIdentity = useRef(null);
  const context = { actorId, tripId: String(id), stage };
  const persist = async (next, validateAuthority) => { formRevision.current += 1; formRef.current = next; setForm(next); await saveCargoForm({ ...context, form: next, isAuthorized: validateAuthority }); };
  const load = useCallback(async () => {
    const snapshot = captureCargoSession(actorId);
    if (!snapshot) { setScreen(previous => ({ ...previous, identity, loading: false, fresh: false, error: "Sign in again to open cargo verification." })); return; }
    const request = ++requestNumber.current, revision = formRevision.current;
    setScreen(previous => ({ ...previous, loading: true, fresh: false }));
    const current = () => isCurrentCargoSession(snapshot) && request === requestNumber.current;
    try {
      const saved = await readCargoForm({ actorId, tripId: String(id), stage });
      if (!current()) return;
      let execution = saved?.execution || null, trip = saved?.trip || null, fresh = false, error = null;
      if (!offline) {
        try {
          const sources = await readCargoScreenSources(id, { driverType, readExecution: () => cargoApi.getExecution(id, actorId, snapshot.signal), readTrips: () => api.get(`/api/mobile/driver/trips?trip_id=${encodeURIComponent(String(id))}`, { queueOnFailure: false, cargoActorId: actorId, signal: snapshot.signal }) });
          if (!current()) return;
          trip = sources.trip;
          if (!sources.cargoAllowed) {
            execution = null;
            error = workspaceBlockReason(sources.workspace) || "This Passenger vehicle uses hotel transportation. Open Trip Details for this trip.";
          } else if (sources.executionError) throw sources.executionError;
          execution = sources.cargoAllowed ? sources.execution?.data ?? sources.execution : null;
          fresh = sources.trip != null;

        } catch (failure) {
          if (!current()) return;
          error = failure.status === 503 ? "Cargo verification is unavailable. The service is not enabled. Retry online or contact Fleet." : failure.kind === "reauthentication" ? "Sign in again to refresh cargo verification. Your saved draft is retained." : failure.kind === "stale_manifest" ? "The manifest changed. Refresh before a new count." : failure.message || "Cargo status could not be refreshed. Your saved draft is retained.";
        }
      } else error = "Offline — saved counts remain on this device. Server clearance is unavailable.";
      const syncState = await getCargoSyncState(actorId, id);
      if (!current()) return;
      const pendingRow = syncState.drafts.filter(row => row.draft.stage === stage && row.syncState !== "FLEET_SAVED").at(-1);
      const previous = (formIdentity.current === identity && formRevision.current !== revision ? formRef.current : saved) || { counts: blankCargoCounts(execution?.manifest), issues: {}, manifestHash: execution?.manifest?.manifest_ref?.hash };
      let next = { ...previous, execution, trip };
      if (pendingRow && !next.pendingSubmissionId) next = { ...next, pendingSubmissionId: pendingRow.submissionId, manifestHash: pendingRow.manifestHash, counts: Object.fromEntries(pendingRow.draft.lines.map(line => [line.line_id, line.observed_quantity])), issues: Object.fromEntries(pendingRow.draft.lines.map(line => [line.line_id, { remarks: line.remarks, damaged: line.condition === "DAMAGED", reported: line.issue_code != null, evidence: pendingRow.evidence.filter(item => item.lineId === line.line_id) }])) };
      formIdentity.current = identity; formRef.current = next; setForm(next);
      setScreen({ identity, session: snapshot, execution, trip, fresh, syncState, loading: false, error });
      if (execution) await saveCargoForm({ actorId, tripId: String(id), stage, form: next });
    } catch (failure) { if (current()) setScreen(previous => ({ ...previous, identity, fresh: false, loading: false, error: failure.message })); }
  }, [actorId, id, stage, identity, offline, driverType]);
  useFocusEffect(useCallback(() => { const timer = setTimeout(load, 0); return () => { clearTimeout(timer); requestNumber.current += 1; }; }, [load]));
  const refresh = () => Promise.allSettled([reloadProfile(), load()]);
  const active = screen.identity === identity;
  const workspace = resolveDriverWorkspace({ driverType, trip: active ? screen.trip : null });
  const cargoAllowed = workspace.tripReady === true && workspace.mode === "cargo" && screen.trip?.load_type === "Cargo";
  const execution = active && cargoAllowed ? screen.execution : null;
  const visibleForm = active ? form : EMPTY_FORM;
  const stale = !!(execution && visibleForm.manifestHash && visibleForm.manifestHash !== execution.manifest?.manifest_ref?.hash);
  const pendingRow = active ? screen.syncState.drafts?.find(row => row.submissionId === visibleForm.pendingSubmissionId) : null;
  const pending = !!(pendingRow && pendingRow.syncState !== "FLEET_SAVED");
  const localState = stale ? { state: "STALE_REVIEW" } : pendingRow ? { state: pendingRow.syncState } : screen.syncState;
  const canOperate = cargoAllowed && active && screen.fresh && isCurrentCargoSession(screen.session) && serverConfirmed && status === "online";
  const signatureKey = cargoSignatureContextKey({ identity, manifestHash: execution?.manifest?.manifest_ref?.hash, assignment: [driverType, screen.trip?.driver_id, screen.trip?.vehicle_id, screen.trip?.trip_status], form: visibleForm });
  const signatureVisible = Boolean(signatureRequest && signatureRequest.key === signatureKey && canOperate && isCurrentCargoSession(signatureRequest.session));
  const operationRef = useRef(null);
  useEffect(() => {
    operationRef.current = { identity, canOperate, trip: screen.trip, session: screen.session, request: requestNumber.current, signatureKey };
    return () => { operationRef.current = null; };
  }, [identity, canOperate, screen.trip, screen.session, signatureKey]);
  const isAuthorized = tripId => {
    const current = operationRef.current;
    return Boolean(current?.canOperate && current.identity === identity && current.request === requestNumber.current && String(tripId) === String(id) && String(current.trip?.trip_id) === String(id) && isCurrentCargoSession(current.session));
  };
  const view = buildCargoViewModel(execution, { driverType, offline: status !== "online", fresh: active && screen.fresh && isCurrentCargoSession(screen.session) && serverConfirmed, syncState: localState, trip: active ? screen.trip : null });
  const edit = next => { if (!canOperate || inFlight.current || pending || signatureVisible) return; setSignatureRequest(null); setErrors({}); setReview(false); persist(next, isAuthorized).catch(failure => setMessage(`Could not save on this device: ${failure.message}. Keep this screen open and retry.`)); };
  const sendObservation = async ({ reportIssue, acknowledgedForm, acknowledgedExecution, handover, session }) => {
    if (inFlight.current || !active || !canOperate) return;
    const snapshot = session || captureCargoSession(actorId);
    if (!isCurrentCargoSession(snapshot) || !isAuthorized(id)) return;
    try {
      inFlight.current = true; setBusy(true); setMessage(null);
      const row = await submitCargoObservation({ ...context, execution: acknowledgedExecution || execution, form: acknowledgedForm || formRef.current, handover, reportIssue, offline, isAuthorized, api: cargoApi, files: { getInfo: FileSystem.getInfoAsync } });
      if (!isCurrentCargoSession(snapshot) || !isAuthorized(id)) return;
      formRef.current = { ...formRef.current, pendingSubmissionId: row.submissionId }; setForm(formRef.current);
      setMessage(row.fleetSaved ? "Observation saved to Fleet. Refreshing the current decision; a saved receipt alone is not clearance." : "Saved on this device. Fleet has not accepted this observation. Retry this same submission when available.");
      await load();
    } catch (failure) { if (isCurrentCargoSession(snapshot) && operationRef.current?.identity === identity) { setMessage(failure.message); await load(); } }
    finally { inFlight.current = false; setBusy(false); setSignatureRequest(null); }
  };
  const submit = async reportIssue => {
    if (inFlight.current || !active || !canOperate) return;
    // A saved command is replayed exactly; it never asks for replacement signer data.
    if (pendingRow) return sendObservation({ reportIssue });
    if (!review || stale) return;
    const validation = validateCargoCounts(execution?.manifest, formRef.current.counts);
    setErrors(validation.errors);
    if (!validation.valid) { setReview(false); setMessage("Check each actual count. Zero is allowed; a blank count is not."); return; }
    try {
      const receipt = buildCargoReceipt(execution, { stage, counts: formRef.current.counts, issues: formRef.current.issues, reportIssue });
      if (stage === "PICKUP" && !reportIssue && receipt.lines.some(line => line.issue_code)) throw new Error("Use Report pickup issue for a different count or damaged item.");
      setSignatureRequest({ key: signatureKey, session: captureCargoSession(actorId), form: JSON.parse(JSON.stringify(formRef.current)), execution, reportIssue });
    } catch (failure) { setMessage(failure.message); }
  };
  const confirmSignature = async handover => {
    const current = operationRef.current;
    if (!signatureRequest || !current?.canOperate || current.identity !== identity || current.signatureKey !== signatureRequest.key || !isCurrentCargoSession(signatureRequest.session) || !isAuthorized(id)) { setSignatureRequest(null); return; }
    await sendObservation({ reportIssue: signatureRequest.reportIssue, acknowledgedForm: signatureRequest.form, acknowledgedExecution: signatureRequest.execution, handover, session: signatureRequest.session });
  };
  const photo = async () => {
    if (inFlight.current || !canOperate || !issueLine) return;
    const snapshot = captureCargoSession(actorId), lineId = issueLine;
    inFlight.current = true; setBusy(true);
    try {
      if (!isAuthorized(id)) return;
      if (!(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error("Camera access is needed for an observation photo. You can keep the count without a photo.");
      if (!isCurrentCargoSession(snapshot) || !isAuthorized(id)) return;
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
      if (!isCurrentCargoSession(snapshot) || !isAuthorized(id) || result.canceled) return;
      const image = result.assets?.[0]; if (!image?.uri || !FileSystem.documentDirectory) throw new Error("This device cannot retain the observation photo. Your count is unchanged.");
      const directory = `${FileSystem.documentDirectory}cargo-observations/${encodeURIComponent(String(actorId))}/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      if (!isCurrentCargoSession(snapshot) || !isAuthorized(id)) return;
      const extension = image.uri.match(/\.(jpe?g|png|heic|webp)(?:\?|$)/i)?.[1] || "jpg";
      const uri = `${directory}${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
      await FileSystem.copyAsync({ from: image.uri, to: uri });
      if (!isCurrentCargoSession(snapshot) || !isAuthorized(id)) return;
      const issue = formRef.current.issues?.[lineId] || {};
      await persist({ ...formRef.current, issues: { ...formRef.current.issues, [lineId]: { ...issue, reported: true, evidence: [...(issue.evidence || []), { uri, name: `cargo-observation.${extension}`, type: image.mimeType || "image/jpeg" }] } } }, isAuthorized);
    } catch (failure) { if (isCurrentCargoSession(snapshot)) setMessage(failure.message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const back = async () => { if (inFlight.current) return; try { if (active) await saveCargoForm({ ...context, form: formRef.current }); router.back(); } catch (failure) { setMessage(`Your count could not be saved: ${failure.message}. Retry before leaving.`); } };
  const recount = async () => { if (inFlight.current || !canOperate || !execution || (pending && !stale)) return; try { await persist({ execution, trip: screen.trip, manifestHash: execution.manifest.manifest_ref.hash, counts: blankCargoCounts(execution.manifest), issues: {} }, isAuthorized); setSignatureRequest(null); setReview(false); setIssueLine(null); setErrors({}); setMessage("New count started. Earlier observations remain saved. A fresh signature is required for the new count."); } catch (failure) { setMessage(failure.message); } };
  return <View style={[styles.root, { backgroundColor: colors.background }]}>
    <ClayScreenHeader title={mode === "overview" ? "Cargo manifest" : mode === "delivery" ? "Verify delivery" : "Verify pickup"} onBack={back} />
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Text style={[type.labelLg, { color: colors.onSurface, marginBottom: 12 }]}>{workspaceModeLabel(workspace)}</Text><DriverGuideTrigger guideId={issueLine ? 'cargo.issue' : mode === 'delivery' ? 'cargo.delivery' : mode === 'overview' ? 'cargo.departure' : review ? 'cargo.pickup_signature' : 'cargo.manifest'} trip={screen.trip} requireTrip enabled={cargoAllowed && active && screen.fresh && !signatureVisible} />
        {active && !screen.loading && !cargoAllowed ? <View style={{ gap: 16 }}>
          <Text accessibilityRole="alert" style={[type.supporting, { color: colors.onSurfaceVariant }]}>{screen.error || workspaceBlockReason(workspace) || "This Passenger vehicle uses hotel transportation. Open Trip Details for this trip."}</Text>
          <ClayButton label="Refresh assignment" onPress={refresh} />
          <ClayButton label="Open Trip Details" onPress={() => router.push(`/trip/${id}`)} />
        </View> : <CargoWorkflowContent canOperate={canOperate} mode={mode} execution={execution} trip={active ? screen.trip : null} view={view} form={visibleForm} errors={errors} issueLine={execution?.manifest?.lines?.some(line => line.line_id === issueLine) ? issueLine : null} review={review} loading={!active || screen.loading} busy={busy} pending={pending} stale={stale} error={active ? screen.error : null} message={active ? message : null} onRefresh={refresh} onOpen={route => router.push(`/trip/${id}/${route}`)} onChange={(lineId, value) => edit({ ...formRef.current, counts: { ...formRef.current.counts, [lineId]: value } })} onIssue={setIssueLine} onIssueChange={issue => edit({ ...formRef.current, issues: { ...formRef.current.issues, [issueLine]: issue } })} onPhoto={photo} onCloseIssue={() => setIssueLine(null)} onReview={setReview} onSubmit={submit} onRecount={recount} />}
        <ClayButton label="Return to Map" variant="tonal" disabled={busy} onPress={async () => { if (inFlight.current) return; try { if (active) await saveCargoForm({ ...context, form: formRef.current }); router.replace("/(app)/(tabs)/map"); } catch (failure) { setMessage(`Your count could not be saved: ${failure.message}. Retry before leaving.`); } }} />
        {mode === "overview" && cargoAllowed && execution?.manifest && <CargoPhysicalManifest manifest={execution.manifest} />}
      </ScrollView>
    </KeyboardAvoidingView>
    <CargoSignatureModal visible={signatureVisible} stage={stage} reviewedObservation={signatureRequest ? { manifest: signatureRequest.execution?.manifest, counts: signatureRequest.form.counts, issues: signatureRequest.form.issues } : null} busy={busy} onCancel={() => setSignatureRequest(null)} onConfirm={confirmSignature} getLocation={options => captureCargoSignatureLocation(Location, options)} />
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { paddingHorizontal: 20, paddingTop: 16, width: "100%", maxWidth: 640, alignSelf: "center" } });
