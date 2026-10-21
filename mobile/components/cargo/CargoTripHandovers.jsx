import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { ClayButton, ClayCard } from "../clay";
import { useTheme } from "../../lib/theme-context";
import { cargoApi } from "../../lib/cargo-api";
import { isCurrentCargoSession } from "../../lib/cargo-sync";
import { cargoSignaturePaths, validateCargoHandover } from "../../../shared/cargo-handover";

const EMPTY = { opened: false, view: null, loading: false, error: null };

export function CargoTripHandovers({ tripId, actorId, session, confirmed, online, onRefreshTrip }) {
  const allowed = Boolean(confirmed && online && actorId != null && session?.actorId === String(actorId) && isCurrentCargoSession(session));
  // Remount before rendering private data under a different trip, account or connection.
  const scope = `${tripId}:${actorId}:${session?.generation}:${allowed}`;
  return <HandoverLoader key={scope} tripId={tripId} actorId={actorId} session={session} allowed={allowed} onRefreshTrip={onRefreshTrip} refreshDisabled={!online} />;
}

function HandoverLoader({ tripId, actorId, session, allowed, onRefreshTrip, refreshDisabled }) {
  const [state, setState] = useState(EMPTY);
  const request = useRef(null);
  useEffect(() => {
    const clear = () => { request.current?.abort(); setState(EMPTY); };
    session?.signal?.addEventListener("abort", clear);
    return () => { request.current?.abort(); session?.signal?.removeEventListener("abort", clear); };
  }, [session]);

  async function load() {
    if (!allowed || !isCurrentCargoSession(session)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState(current => ({ ...current, opened: true, loading: true, error: null }));
    const current = () => !controller.signal.aborted && isCurrentCargoSession(session);
    try {
      const view = await cargoApi.getHandovers(tripId, actorId, controller.signal);
      if (current()) setState({ opened: true, view, loading: false, error: null });
    } catch (error) {
      if (!current()) return;
      const revoked = [401, 403, 404].includes(error?.status);
      const message = error?.code === "CARGO_CONFIGURATION_REQUIRED"
        ? "Cargo records are unavailable until cargo operations are configured."
        : revoked ? "Signature access is unavailable. Refresh your trip and sign-in details."
          : "Signatures could not be refreshed. Please try again.";
      setState(previous => ({ ...previous, view: revoked ? null : previous.view, loading: false, error: message }));
    }
  }

  function hide() { request.current?.abort(); setState(EMPTY); }

  return <CargoTripHandoversContent {...state} disabled={!allowed} onView={load} onHide={hide} onRefreshTrip={onRefreshTrip} refreshDisabled={refreshDisabled} />;
}

function savedTime(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not recorded";
}

function HandoverStage({ label, stage, record, recorded, manifest }) {
  const { colors, type } = useTheme();
  let handover = null;
  try {
    if (record?.stage === stage && record?.handover) handover = validateCargoHandover(record.handover);
  } catch { /* Keep malformed historic drawings out of the rendering document. */ }
  const ink = /^#[0-9a-f]{6}$/i.test(colors.onSurface) ? colors.onSurface : "#1F2925";
  // Only validated numeric paths and a bounded theme color enter this script-free document.
  const html = handover ? `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;background:transparent;height:100%;overflow:hidden}svg{width:100%;height:100%}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${cargoSignaturePaths(handover.signature).map(path => `<path d="${path}"/>`).join("")}</svg></body></html>` : null;
  const matching = manifest?.manifest_ref && record?.manifest_ref && ["kind", "id", "revision", "hash"].every(key => manifest.manifest_ref[key] != null && manifest.manifest_ref[key] === record.manifest_ref[key]);
  const text = [type.supporting, { color: colors.onSurfaceVariant }];

  return <View style={{ gap: 10 }}>
    <Text accessibilityRole="header" style={type.cardTitle}>{label} handover</Text>
    {handover ? <>
      <View accessible accessibilityRole="image" accessibilityLabel={`${label} signature by ${handover.signer_name}`} style={{ aspectRatio: 2.5, backgroundColor: colors.surfaceContainerHigh, borderRadius: 12, overflow: "hidden" }}>
        <WebView source={{ html }} style={{ backgroundColor: "transparent" }} pointerEvents="none"
          accessible={false} importantForAccessibility="no-hide-descendants" javaScriptEnabled={false} domStorageEnabled={false}
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never" setSupportMultipleWindows={false} javaScriptCanOpenWindowsAutomatically={false}
          originWhitelist={["*"]} onShouldStartLoadWithRequest={request => request.url === "about:blank"}
          scrollEnabled={false} cacheEnabled={false} incognito />
      </View>
      <Text style={type.bodyMd}>{handover.signer_name}</Text>
      <Text style={text}>{handover.signer_role_or_dept}</Text>
      <Text style={text}>Signed on device: {savedTime(handover.captured_at)}</Text>
      <Text style={text}>{handover.location ? `Location: ${handover.location.latitude}, ${handover.location.longitude} (accuracy ${handover.location.accuracy_m} m)` : "Location not recorded"}</Text>
    </> : <Text style={text}>{record?.handover ? "Saved signature is unavailable" : record || recorded ? "No signature recorded for this receipt" : `No ${label.toLowerCase()} receipt recorded`}</Text>}
    {record && <>
      <Text style={text}>Server received: {savedTime(record.received_at)}</Text>
      <Text style={text}>Receipt: {record.receipt_id}</Text>
      <Text style={text}>Manifest revision: {record.manifest_ref?.revision ?? "Not recorded"}</Text>
      <Text style={type.supporting}>Acknowledged item counts</Text>
      {(record.lines || []).map(line => {
        const item = matching ? manifest.lines?.find(item => item.line_id === line.line_id) : null;
        return <View key={line.line_id} style={{ gap: 4 }}>
          <Text style={type.bodyMd}>{item?.name || line.line_id}: {line.observed_quantity}{item?.unit ? ` ${item.unit}` : ""}</Text>
          <Text style={text}>Condition: {line.condition === "INTACT" ? "Intact" : line.condition === "DAMAGED" ? "Damaged" : "Not recorded"}</Text>
          {line.issue_code && <Text style={text}>Issue: {line.issue_code}</Text>}
          {line.remarks && <Text style={text}>{line.remarks}</Text>}
        </View>;
      })}
    </>}
  </View>;
}

export function CargoTripHandoversContent({ opened = false, view, loading = false, error, disabled, onView, onHide, onRefreshTrip, refreshDisabled }) {
  const { type, colors } = useTheme();
  return <ClayCard style={{ marginBottom: 16, gap: 16 }}>
    <Text accessibilityRole="header" style={type.titleLg}>Pickup &amp; delivery signatures</Text>
    <Text style={type.supporting}>Saved acknowledgments for this cargo trip.</Text>
    {disabled && <Text style={type.supporting}>Connect online and refresh this trip to view saved signatures.</Text>}
    {disabled && onRefreshTrip && <ClayButton label="Refresh trip" variant="outline" disabled={refreshDisabled} onPress={onRefreshTrip} />}
    <ClayButton label={opened ? "Hide signatures" : "View signatures"} variant="outline" disabled={disabled} onPress={opened ? onHide : onView} />
    {opened && <>
      {loading && <Text accessibilityLiveRegion="polite" style={type.supporting}>Loading signatures...</Text>}
      {error && <Text accessibilityRole="alert" style={type.supporting}>{error}{view ? " Previously loaded receipt details are still shown." : ""}</Text>}
      {view && <>
        <HandoverStage label="Pickup" stage="PICKUP" record={view.handovers.pickup} recorded={!!view.pickup_receipt} manifest={view.manifest} />
        <View style={{ height: 1, backgroundColor: colors.outlineVariant }} />
        <HandoverStage label="Delivery" stage="DELIVERY" record={view.handovers.delivery} recorded={!!view.delivery_receipt} manifest={view.manifest} />
      </>}
      <ClayButton label={error ? "Retry signatures" : "Refresh signatures"} variant="outline" disabled={disabled || loading} onPress={onView} />
      <Text style={type.caption}>The signature acknowledges saved counts and condition. It does not verify identity or grant cargo clearance.</Text>
    </>}
  </ClayCard>;
}
