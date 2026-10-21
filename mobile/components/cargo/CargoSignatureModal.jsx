import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { ClayInput } from "../clay";
import { CargoButton } from "./CargoButton";
import { useTheme } from "../../lib/theme-context";
import { cargoSignatureHtml, parseCargoSignatureMessage } from "../../lib/cargo-signature";
import { CARGO_HANDOVER_ACKNOWLEDGMENT, validateCargoHandover } from "../../../shared/cargo-handover";

// Unmount on cancel/close or stage change, discarding every unsent signer value.
export function CargoSignatureModal({ visible, stage, busy, onCancel, onConfirm, getLocation, practiceLabel = false, onExit }) {
  return visible ? <SignatureForm key={stage} stage={stage} busy={busy} onCancel={onCancel} onConfirm={onConfirm} getLocation={getLocation} practiceLabel={practiceLabel} onExit={onExit} /> : null;
}
function SignatureForm({ stage, busy = false, onCancel, onConfirm, getLocation, practiceLabel = false, onExit }) {
  const { colors, type } = useTheme(), insets = useSafeAreaInsets();
  const [name, setName] = useState(""), [department, setDepartment] = useState("");
  const [signature, setSignature] = useState(null), [accepted, setAccepted] = useState(false), [drawingKey, setDrawingKey] = useState(0);
  const [error, setError] = useState(null), [capturing, setCapturing] = useState(false), [locationLabel, setLocationLabel] = useState(practiceLabel ? "Sample only. No location will be requested." : "Location is optional. A fresh location will be requested when you save.");
  const alive = useRef(true), saving = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const html = useMemo(() => cargoSignatureHtml({ ink: colors.onSurface, background: colors.surfaceContainerLow }), [colors.onSurface, colors.surfaceContainerLow]);
  const locked = busy || capturing;
  const cancel = () => { if (busy) return; alive.current = false; onCancel(); };
  const clear = () => { if (locked) return; setSignature(null); setAccepted(false); setError(null); setDrawingKey(value => value + 1); };
  const receive = event => {
    if (locked) return;
    try { setSignature(parseCargoSignatureMessage(event.nativeEvent.data)); setAccepted(false); setError(null); }
    catch { setSignature(null); setAccepted(false); setError("The drawing could not be read. Clear it and sign again."); }
  };
  const confirm = async () => {
    if (saving.current || busy || !accepted) return;
    let value;
    try { value = validateCargoHandover({ version: 1, signer_name: name, signer_role_or_dept: department, acknowledgment: CARGO_HANDOVER_ACKNOWLEDGMENT, captured_at: new Date().toISOString(), signature, location: null }); }
    catch { setError("Enter the staff name and role or department, then draw a signature. A tap alone is not a signature."); return; }
    saving.current = true; setCapturing(true); setError(null); setLocationLabel("Checking current location…");
    try {
      const location = getLocation ? await getLocation({ isCurrent: () => alive.current }) : null;
      if (!alive.current) return;
      setLocationLabel(location ? `Current location captured (accuracy ${Math.round(location.accuracy_m)} m).` : "Location unavailable. This acknowledgment will be saved without GPS.");
      await onConfirm(validateCargoHandover({ ...value, captured_at: new Date().toISOString(), location }));
    } catch (failure) { if (alive.current) setError(failure.message || "The signed observation could not be saved. Retry or cancel to keep the counts."); }
    finally { saving.current = false; if (alive.current) setCapturing(false); }
  };
  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={cancel}>
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      {practiceLabel ? <View style={{ padding: 16, paddingTop: insets.top + 16, gap: 8 }}><Text accessibilityRole="alert" style={type.bodyMd}>Practice mode - Sample data. Use a fictional staff name and drawing. Nothing will be submitted.</Text><CargoButton label="Exit practice" variant="tonal" onPress={onExit} /></View> : null}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
        <Text accessibilityRole="header" style={[type.headlineMd, { color: colors.onSurface }]}>{stage === "PICKUP" ? "Acknowledge pickup" : "Acknowledge delivery"}</Text>
        <Text style={[type.bodyMd, { color: colors.onSurface }]}>Ask the {stage === "PICKUP" ? "releasing" : "receiving"} staff member to review the current counts and conditions before signing. This signature applies only to the reviewed manifest and this {stage === "PICKUP" ? "pickup" : "delivery"} observation.</Text>
        <ClayInput label={stage === "PICKUP" ? "Releasing staff name" : "Receiving staff name"} accessibilityLabel={stage === "PICKUP" ? "Releasing staff name" : "Receiving staff name"} value={name} onChangeText={setName} maxLength={160} autoCapitalize="words" editable={!locked} inputStyle={type.bodyMd} placeholderTextColor={colors.onSurfaceVariant} />
        <ClayInput label={stage === "PICKUP" ? "Role or department" : "Receiving department or role"} accessibilityLabel={stage === "PICKUP" ? "Role or department" : "Receiving department or role"} value={department} onChangeText={setDepartment} maxLength={120} autoCapitalize="words" editable={!locked} inputStyle={type.bodyMd} placeholderTextColor={colors.onSurfaceVariant} />
        <Text style={[type.labelLg, { color: colors.onSurface }]}>Draw signature below</Text>
        {/* The wildcard routes every URL through our refusal callback; a narrow whitelist opens external apps. */}
        <View style={[styles.drawing, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.onSurfaceVariant }]} pointerEvents={locked ? "none" : "auto"}>
          <WebView key={drawingKey} source={{ html, baseUrl: "about:blank" }} originWhitelist={["*"]} onShouldStartLoadWithRequest={request => request.url === "about:blank"} onMessage={receive} onError={() => { setSignature(null); setAccepted(false); setError("The drawing pad is unavailable. Cancel to keep counts, then reopen signing."); }} javaScriptEnabled domStorageEnabled={false} allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never" setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false} scrollEnabled={false} bounces={false} cacheEnabled={false} incognito accessibilityLabel="Signature drawing pad. Draw with your finger." style={{ backgroundColor: colors.surfaceContainerLow }} />
        </View>
        <CargoButton label="Clear signature" variant="tonal" onPress={clear} disabled={locked} />
        <CargoButton label="I acknowledge these reviewed counts and conditions" variant={accepted ? "primary" : "tonal"} accessibilityRole="checkbox" accessibilityState={{ checked: accepted, disabled: locked }} onPress={() => setAccepted(value => !value)} disabled={locked} />
        <Text accessibilityLiveRegion="polite" style={[type.supporting, { color: colors.onSurfaceVariant }]}>{locationLabel}</Text>
        <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>This records a human acknowledgment. It does not verify identity, receiving authority, source approval or Fleet safety clearance.</Text>
        <Text style={[type.bodyMd, { color: colors.onSurface }]}>Refusing to sign or staff unavailable? Cancel to keep the counts and contact Fleet or use the existing incident process. A report alone does not clear the cargo.</Text>
        {error && <Text accessibilityRole="alert" style={[type.bodyMd, { color: colors.error }]}>{error}</Text>}
        <CargoButton label="Save signed observation" onPress={confirm} loading={locked} disabled={locked || !accepted || !name.trim() || !department.trim() || !signature?.strokes?.length} />
        <CargoButton label="Cancel and keep counts" variant="tonal" onPress={cancel} disabled={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  </Modal>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { paddingHorizontal: 20, gap: 16, width: "100%", maxWidth: 640, alignSelf: "center" }, drawing: { aspectRatio: 600 / 240, width: "100%", borderWidth: 1, borderRadius: 16, overflow: "hidden" } });
