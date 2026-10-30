import React, { useRef, useEffect, useMemo, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { WebView } from 'react-native-webview';
import { useTheme } from '../lib/theme-context';
import { palettes } from '../lib/theme';
import { ROUTE_CONTROLLER_SCRIPT } from '../lib/navigation-route';
import {
  escapeHtmlText,
  finiteNumberInRange,
  normalizeRadarMarkers,
  serializeCssString,
  serializeInlineScriptValue,
} from '../lib/map-webview-data';
import {
  buildFleetPositionJs,
  buildMapActiveJs,
  fleetRespondersSignature,
  normalizeFleetResponders,
  shouldPushFleetBridge,
} from '../lib/fleet-bridge';

let cachedCarImage = '';
let cachedMapFontsCss = '';

const TomTomMap = forwardRef(({ 
  origin, 
  locationObservedAt,
  locationFresh = true,
  mapActive = true,
  destination,
  originAddress,
  destAddress,
  style, 
  scrollEnabled = true,
  pickupLabel = "Pickup",
  dropoffLabel = "Destination",
  showCarIcon = false,
  autoSwoop = false,
  radarMode = false,
  radarRadiusKm = 3,
  radarMarkers = [],
  responders = [],
  showVehicleMarker = true,
  topInset = 36,
  viewportInsets = {},
  onNavigationLayout,
  onMarkerPress,
  onMapDragged,
  onRouteData,
  routeSessionKey = "preview",
  routeTripId = null,
  routePreferences = {},
  onMapReady,
  onMapLoading,
  onMapError
}, ref) => {
  const webViewRef = useRef(null);
  const [carImage, setCarImage] = useState(cachedCarImage);
  useEffect(() => {
    let active = true;
    async function loadCar() {
      try {
        const asset = await Asset.fromModule(require('../assets/images/carlive.png')).downloadAsync();
        let base64 = '';
        if (typeof FileSystem?.File !== 'undefined' && asset.localUri) {
          try {
            base64 = await new FileSystem.File(asset.localUri).base64();
          } catch (_) {}
        }
        if (!base64 && asset.localUri && FileSystem?.readAsStringAsync) {
          try {
            base64 = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 });
          } catch (_) {}
        }
        if (base64) {
          cachedCarImage = 'data:image/png;base64,' + base64;
        } else if (typeof asset.uri === 'string' && asset.uri.startsWith('https://')) {
          cachedCarImage = asset.uri;
        }
        if (active && cachedCarImage) {
          setCarImage(cachedCarImage);
          webViewRef.current?.injectJavaScript(`if(window.setCarMarkerImage) window.setCarMarkerImage(${serializeInlineScriptValue(cachedCarImage)}); true;`);
        }
      } catch (error) {
        console.warn('Map car image could not load', error);
      }
    }
    loadCar();
    async function loadMapFonts() {
      try {
        if (!cachedMapFontsCss) {
          const faces = [
            [600, require('@expo-google-fonts/plus-jakarta-sans/600SemiBold/PlusJakartaSans_600SemiBold.ttf')],
            [700, require('@expo-google-fonts/plus-jakarta-sans/700Bold/PlusJakartaSans_700Bold.ttf')],
          ];
          const rules = await Promise.all(faces.map(async ([weight, source]) => {
            const asset = await Asset.fromModule(source).downloadAsync();
            if (!asset.localUri) return '';
            let base64 = '';
            if (typeof FileSystem?.File !== 'undefined') base64 = await new FileSystem.File(asset.localUri).base64();
            else if (FileSystem?.readAsStringAsync) base64 = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 });
            return base64 ? `@font-face{font-family:FleetMap;src:url(data:font/ttf;base64,${base64}) format('truetype');font-weight:${weight};font-display:swap;}` : '';
          }));
          cachedMapFontsCss = rules.join('');
        }
        if (active && cachedMapFontsCss) webViewRef.current?.injectJavaScript(`if(window.__setMapFonts) window.__setMapFonts(${serializeInlineScriptValue(cachedMapFontsCss)}); true;`);
      } catch (_) {
        // The system font remains readable if an optional bundled font fails.
      }
    }
    loadMapFonts();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (carImage && webViewRef.current) {
      webViewRef.current.injectJavaScript(`if(window.setCarMarkerImage) window.setCarMarkerImage(${serializeInlineScriptValue(carImage)}); true;`);
    }
  }, [carImage]);
  const { colors, scheme } = useTheme();
  const safeRadarMode = radarMode === true;
  const safeAutoSwoop = autoSwoop === true;
  const safeShowCarIcon = showCarIcon === true;
  const safeShowVehicleMarker = showVehicleMarker !== false;
  const safeScrollEnabled = scrollEnabled !== false;
  const safeRadarRadiusKm = finiteNumberInRange(radarRadiusKm, 0.25, 50) ?? 3;
  const safeRadarMarkers = normalizeRadarMarkers(radarMarkers);
  const radarMarkersJs = serializeInlineScriptValue(safeRadarMarkers);
  const radarRadiusJs = serializeInlineScriptValue(safeRadarRadiusKm);

  // Bridge readiness + throttle state. injectJavaScript before MAP_READY is
  // silently dropped by the WebView, and unthrottled per-fix injects are the
  // frame-drop source this module exists to remove.
  const isMapReadyRef = useRef(false);
  const mapErrorRef = useRef(false);
  const mapActiveRef = useRef(mapActive === true);
  const lastBridgePushRef = useRef(0);
  const latestFleetRef = useRef({ lat: null, lng: null, heading: null, respondersJson: '[]' });
  // Stable responder identity: per-fix array identities must not re-fire
  // bridge pushes (or document rebuilds) on their own — only a changed
  // payload crosses. Live responders therefore never enter the useMemo
  // document below; they travel exclusively via the throttled bridge.
  const respondersSignature = fleetRespondersSignature(responders);
  const safeResponders = useMemo(
    () => normalizeFleetResponders(responders),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signature only; identity churns per fix
    [respondersSignature]
  );
  const safeRespondersJson = fleetRespondersSignature(safeResponders);

  // One GPS tick → one direct global-function call (no postMessage
  // round-trip), throttled to FLEET_BRIDGE_PUSH_MS and sent only after
  // MAP_READY. Returns false when the inject was skipped.
  const pushFleetPosition = useCallback((lat, lng, heading, respondersPayload, force = false, observedAt) => {
    const view = webViewRef.current;
    if (!view || isMapReadyRef.current !== true) return false;
    const now = Date.now();
    if (!force && !shouldPushFleetBridge(now, lastBridgePushRef.current)) return false;
    const script = buildFleetPositionJs(lat, lng, heading, respondersPayload, observedAt);
    if (!script) return false;
    lastBridgePushRef.current = now;
    try {
      view.injectJavaScript(script);
    } catch (_) {
      return false;
    }
    return true;
  }, []);

  const reportMapError = useCallback((reason) => {
    isMapReadyRef.current = false;
    if (mapErrorRef.current) return;
    mapErrorRef.current = true;
    onMapError?.({ type: 'MAP_ERROR', reason });
  }, [onMapError]);
  useEffect(() => {
    const active = mapActive === true;
    if (active && !mapActiveRef.current) lastBridgePushRef.current = 0;
    mapActiveRef.current = active;
    if (isMapReadyRef.current) webViewRef.current?.injectJavaScript(buildMapActiveJs(active));
  }, [mapActive]);

  useImperativeHandle(ref, () => ({
    recenter: () => webViewRef.current?.injectJavaScript(`if(window.recenterRadar && ${serializeInlineScriptValue(safeRadarMode)}) window.recenterRadar(); else if(window.recenterMap) window.recenterMap(); true;`),
    overview: () => webViewRef.current?.injectJavaScript(`if(window.showOverview) window.showOverview(); true;`),
    applyRoutePreferences: (preferences) => webViewRef.current?.injectJavaScript(`if(window.applyRoutePreferences) window.applyRoutePreferences(${serializeInlineScriptValue({ avoidTolls: preferences?.avoidTolls === true, selectedIndex: Number.isInteger(preferences?.selectedIndex) && preferences.selectedIndex >= 0 ? preferences.selectedIndex : 0 })}); true;`),
    setRadarRadius: (km) => webViewRef.current?.injectJavaScript(`if(window.updateRadarCoverage) window.updateRadarCoverage(${serializeInlineScriptValue(finiteNumberInRange(km, 0.25, 50) ?? 3)}); true;`),
    setRadarMarkers: (markers) => webViewRef.current?.injectJavaScript(`if(window.renderRadarMarkers) window.renderRadarMarkers(${serializeInlineScriptValue(normalizeRadarMarkers(markers))}, ${radarRadiusJs}); true;`),
    setVehicleVisible: (visible) => webViewRef.current?.injectJavaScript(`if(window.setVehicleVisible) window.setVehicleVisible(${serializeInlineScriptValue(visible === true)}); true;`),
    // Throttled live-GPS entry point for screens that own a watcher
    // (map.js, incident/navigate.js): one tick in, at most one throttled
    // bridge call out. Prefer letting the origin effect below drive this.
    updateFleetPosition: (fix) => pushFleetPosition(
      fix?.lat, fix?.lng, fix?.heading,
      Array.isArray(fix?.responders) ? fleetRespondersSignature(fix.responders) : safeRespondersJson,
      false, fix?.observedAt
    ),
    // Tab/background lifecycle: pause rAF interpolation + camera glides when
    // the map is not visible, resume on focus.
    setMapActive: (active) => {
      if (active === true && !mapActiveRef.current) lastBridgePushRef.current = 0;
      mapActiveRef.current = active === true;
      if (isMapReadyRef.current) webViewRef.current?.injectJavaScript(buildMapActiveJs(active));
    },
  }));

  useEffect(() => {
    if (safeRadarMode && webViewRef.current) {
      webViewRef.current.injectJavaScript(`if(window.updateRadarCoverage) window.updateRadarCoverage(${radarRadiusJs}); true;`);
    }
  }, [safeRadarMode, radarRadiusJs]);

  useEffect(() => {
    if (safeRadarMode && webViewRef.current) {
      webViewRef.current.injectJavaScript(`if(window.renderRadarMarkers) window.renderRadarMarkers(${radarMarkersJs}, ${radarRadiusJs}); true;`);
    }
  }, [safeRadarMode, radarMarkersJs, radarRadiusJs]);

  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`if(window.setVehicleVisible) window.setVehicleVisible(${serializeInlineScriptValue(safeShowVehicleMarker)}); true;`);
    }
  }, [safeShowVehicleMarker]);

  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`if(window.applyFleetMapTheme) window.applyFleetMapTheme(${serializeInlineScriptValue(scheme === 'dark')}); true;`);
    }
  }, [scheme]);
  useEffect(() => {
    if (isMapReadyRef.current) webViewRef.current?.injectJavaScript(`if(window.__setLocationFresh) window.__setLocationFresh(${serializeInlineScriptValue(locationFresh === true)}); true;`);
  }, [locationFresh]);
  const tomtomKey = process.env.EXPO_PUBLIC_TOMTOM_API_KEY || "";
  const safeOriginLat = finiteNumberInRange(origin?.lat, -90, 90);
  const safeOriginLng = finiteNumberInRange(origin?.lng, -180, 180);
  const safeOriginHeading = finiteNumberInRange(origin?.heading, 0, 360);
  const legacyObservedAt = useMemo(() => safeOriginLat != null && safeOriginLng != null ? Date.now() : null, [safeOriginLat, safeOriginLng]);
  const safeObservedAt = locationObservedAt === undefined ? legacyObservedAt : finiteNumberInRange(locationObservedAt, 1, 8640000000000000);
  const safeDestinationLat = finiteNumberInRange(destination?.lat, -90, 90);
  const safeDestinationLng = finiteNumberInRange(destination?.lng, -180, 180);
  const safeTopInset = finiteNumberInRange(topInset, 0, 300) ?? 36;
  const viewportInsetsJs = serializeInlineScriptValue({
    top: finiteNumberInRange(viewportInsets?.top, 0, 10000) ?? 0,
    bottom: finiteNumberInRange(viewportInsets?.bottom, 0, 10000) ?? 0,
    left: finiteNumberInRange(viewportInsets?.left, 0, 10000) ?? 0,
    right: finiteNumberInRange(viewportInsets?.right, 0, 10000) ?? 0,
  });
  const layoutBridgeJs = `if(window.__setViewportInsets) window.__setViewportInsets(${viewportInsetsJs}, ${safeTopInset}); true;`;
  const latestLayoutBridgeRef = useRef(layoutBridgeJs);
  latestLayoutBridgeRef.current = layoutBridgeJs;
  useEffect(() => {
    if (isMapReadyRef.current) webViewRef.current?.injectJavaScript(layoutBridgeJs);
  }, [layoutBridgeJs]);
  const hasOriginFix = safeOriginLat != null && safeOriginLng != null;
  // Latest fix snapshot for the MAP_READY flush: the origin effect below
  // does not re-fire for values that arrived before the document finished
  // loading, so readiness replays the newest fix once instead of dropping it.
  latestFleetRef.current = {
    lat: safeOriginLat,
    lng: safeOriginLng,
    heading: safeOriginHeading,
    respondersJson: safeRespondersJson,
    observedAt: safeObservedAt,
  };
  const documentOriginLat = safeShowCarIcon ? null : safeOriginLat;
  const documentOriginLng = safeShowCarIcon ? null : safeOriginLng;
  const documentOriginHeading = safeShowCarIcon ? null : safeOriginHeading;
  const originAddressJs = serializeInlineScriptValue(typeof originAddress === "string" ? originAddress : "");
  const destinationAddressJs = serializeInlineScriptValue(typeof destAddress === "string" ? destAddress : "");
  const tomtomKeyJs = serializeInlineScriptValue(tomtomKey);
  const pickupPopupJs = serializeInlineScriptValue(`<h4 class="popup-title">${escapeHtmlText(typeof pickupLabel === "string" ? pickupLabel : "Pickup")}</h4>`);
  const dropoffPopupJs = serializeInlineScriptValue(`<h4 class="popup-title">${escapeHtmlText(typeof dropoffLabel === "string" ? dropoffLabel : "Destination")}</h4>`);
  const primaryColorJs = serializeInlineScriptValue(colors.primary);
  const secondaryColorJs = serializeInlineScriptValue(colors.secondary);
  const surfaceColorJs = serializeInlineScriptValue(colors.surface);
  const errorColorJs = serializeInlineScriptValue(colors.error);
  const htmlContent = useMemo(() => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
          <link rel="stylesheet" type="text/css" href="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css" />
          <script src="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js"></script>
          <script src="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/services/services-web.min.js"></script>
          <style id="fleetMapFonts"></style>
          <style>
              :root { color-scheme: ${scheme}; }
              * { box-sizing: border-box; }
              body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: ${colors.background}; }
              #map { height: 100vh; width: 100vw; }
              
              .tt-popup-content { padding: 5px 9px; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.18); border: 1px solid ${colors.outlineVariant}50; background: ${colors.surface}; }
              .tt-popup-panel { background: ${colors.surface}; }
              .popup-title { font-family: system-ui, -apple-system, sans-serif; font-size: 11px; font-weight: 700; color: ${colors.onSurface}; margin: 0; white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
              
              .origin-marker-car {
                  width: 60px; height: 60px; flex-shrink: 0;
                  background-image: ${(cachedCarImage || carImage) ? `url(${serializeCssString(cachedCarImage || carImage)})` : 'radial-gradient(circle, #70B991 0 6px, transparent 7px)'};
                  background-size: contain; background-repeat: no-repeat; background-position: center;
                  position: relative; z-index: 1;
                  filter: drop-shadow(0 3px 5px rgba(18, 38, 28, 0.28));
                  will-change: transform;
                  transition: transform 0.2s cubic-bezier(0.2, 0.6, 0.35, 1);
              }
              .scheme-dark .origin-marker-car {
                  filter: drop-shadow(0 0 1.5px rgba(220, 245, 232, 0.60)) drop-shadow(0 3px 6px rgba(0, 0, 0, 0.65));
              }
              .origin-marker-dot { align-items: center; justify-content: center; display: flex; flex-direction: column; position: relative; }
              .origin-dot-outer { width: 22px; height: 22px; border-radius: 11px; background: ${colors.primary}2e; display: flex; align-items: center; justify-content: center; position: absolute; top: -15px; }
              .origin-dot-inner { width: 9px; height: 9px; border-radius: 5px; background: ${colors.primary}; box-shadow: 0 0 0 3px ${colors.surface}; }

              .dest-marker { align-items: center; justify-content: center; display: flex; flex-direction: column; position: relative; }
              .dest-dot-outer { width: 22px; height: 22px; border-radius: 11px; background: ${colors.secondary}2e; display: flex; align-items: center; justify-content: center; position: absolute; top: -15px; }
              .dest-dot-inner { width: 9px; height: 9px; border-radius: 5px; background: ${colors.secondary}; box-shadow: 0 0 0 3px ${colors.surface}; }

              /* ETA Box Styling */
              .eta-box { position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%); background: white; padding: 12px 24px; border-radius: 30px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); display: none; flex-direction: column; align-items: center; justify-content: center; z-index: 999; font-family: sans-serif; border: 1px solid #e2e8f0; }
              .eta-time { font-size: 18px; font-weight: 800; color: #0f172a; }
              .eta-delay { font-size: 13px; font-weight: 700; color: #ef4444; margin-top: 2px; display: none; }
              
              /* On-Route Delay Badge */
              .on-route-badge { background: ${colors.error}; color: ${colors.onError}; padding: 5px 9px; border-radius: 12px; font-size: 11px; font-weight: 800; font-family: system-ui, sans-serif; box-shadow: 0 4px 12px rgba(22,37,31,0.2); border: 2px solid ${colors.surface}; white-space: nowrap; pointer-events: none; }
              .on-route-badge.yellow { background: ${colors.secondary}; color: ${colors.onSecondary}; }

              .nav-header { position: absolute; top: ${safeTopInset}px; left: 16px; right: 16px; display: none; flex-direction: column; z-index: 1000; font-family: FleetMap, system-ui, sans-serif; pointer-events: none; background: ${colors.surfaceContainerLow}; color: ${colors.onSurface}; border-radius: 20px; overflow: hidden; box-shadow: 0 8px 24px rgba(18,38,28,.16); border-top: 1px solid ${scheme === 'dark' ? 'rgba(255,255,255,.13)' : 'rgba(255,255,255,.95)'}; }
              .nav-main-banner { display: flex; align-items: center; gap: 12px; padding: 12px 14px; width: 100%; }
              .nav-icon-wrapper { width: 52px; height: 52px; border-radius: 16px; background: ${colors.primary}; color: ${colors.onPrimary}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: inset 0 1px 1px rgba(255,255,255,.15); }
              .nav-icon { width: 32px; height: 32px; }
              .nav-icon svg, .nav-then-icon svg { width: 100%; height: 100%; }
              .nav-info { flex: 1; min-width: 0; }
              .nav-dist-row { display: flex; align-items: baseline; flex-wrap: wrap; column-gap: 4px; }
              .nav-dist { font-size: 28px; line-height: 34px; font-weight: 800; letter-spacing: -.6px; }
              .nav-dist-unit { font-size: 13px; color: ${colors.onSurfaceVariant}; margin-right: 8px; }
              .nav-action { font-size: 17px; line-height: 23px; font-weight: 650; color: ${colors.primary}; overflow-wrap: anywhere; }
              .nav-street { font-size: 13px; line-height: 19px; font-weight: 500; color: ${colors.onSurfaceVariant}; overflow-wrap: anywhere; }
              .nav-then-badge { display: none; align-items: center; gap: 7px; padding: 6px 14px 6px 78px; background: ${colors.surfaceContainer}; border-top: 1px solid ${colors.outlineVariant}55; font-size: 11px; line-height: 15px; color: ${colors.onSurfaceVariant}; }
              .nav-then-icon { width: 14px; height: 14px; flex-shrink: 0; color: ${colors.primary}; }
              .nav-then-text { overflow-wrap: anywhere; }
              button.radar-marker-item, button.radar-cluster-badge { appearance: none; font-family: inherit; text-align: inherit; cursor: pointer; }
              button.radar-marker-item { border: 0; padding: 0; background: transparent; min-height: 48px; }
              button.radar-cluster-badge { min-width: 48px; min-height: 48px; }
              button:focus-visible { outline: 3px solid ${colors.primary}; outline-offset: 4px; }

              /* Map Controls (Hidden in favor of Native controls) */
              .overview-btn { display: none !important; }
              .recenter-btn { display: none !important; }
              

              /* Geographic coverage boundary and slightly visible radar pulse. */
              .radar-pulse-container {
                  position: absolute; top: 50%; left: 50%;
                  transform: translate3d(-50%, -50%, 0);
                  pointer-events: none; z-index: 0;
                  border-radius: 50%; border: 1.5px dashed rgba(61, 145, 99, .65);
                  background: rgba(135, 210, 157, .16); box-sizing: border-box;
                  -webkit-backface-visibility: hidden;
                  backface-visibility: hidden;
              }
              .standby-radar-pulse {
                  position: absolute; inset: 0; border-radius: 50%;
                  border: 1.5px solid rgba(40, 95, 80, .75);
                  background: radial-gradient(circle, rgba(135, 210, 157, .24) 0%, rgba(135, 210, 157, .06) 65%, transparent 100%);
                  animation: standbyRadarPulse 3.6s cubic-bezier(0.2, 0.6, 0.35, 1) infinite;
                  will-change: transform, opacity;
                  -webkit-backface-visibility: hidden;
                  backface-visibility: hidden;
                  transform: translate3d(0, 0, 0);
              }
              .standby-radar-pulse-2 {
                  animation-delay: 1.8s;
              }
              .map-interacting .standby-radar-pulse {
                  animation-play-state: paused !important;
              }
              @keyframes standbyRadarPulse {
                  0% { transform: scale(.08); opacity: 0; }
                  15% { opacity: .72; }
                  50% { opacity: .42; }
                  80% { opacity: .18; }
                  100% { transform: scale(1); opacity: 0; }
              }
              .radar-radius-label {
                  position: absolute; bottom: calc(100% + 8px); left: 50%;
                  transform: translateX(-50%); white-space: nowrap;
                  padding: 5px 10px; border-radius: 14px;
                  background: #f4faf5; color: #315640; font: 600 11px sans-serif;
                  box-shadow: 0 3px 8px rgba(38, 70, 50, .12), inset 0 1px 1px white;
              }
              .scheme-dark .radar-pulse-container {
                  border-color: rgba(92, 255, 220, .45);
                  background: rgba(36, 95, 80, .18);
              }
              .scheme-dark .standby-radar-pulse {
                  border-color: rgba(92, 255, 220, .85);
                  background: radial-gradient(circle, rgba(92, 255, 220, .26) 0%, rgba(92, 255, 220, .06) 65%, transparent 100%);
              }
              .scheme-dark .radar-radius-label { background: #233c30; color: #d1edda; box-shadow: 0 3px 8px #0003; }
              @media (prefers-reduced-motion: reduce) {
                  .standby-radar-pulse { animation: none; opacity: 0; }
              }

              /* Incident / Emergency Marker Pulse (1:1 Web .fleet-marker-pulse Parity) */
              .fleet-marker-pulse {
                  position: absolute;
                  top: -3px;
                  left: -3px;
                  width: 34px;
                  height: 34px;
                  border-radius: 50%;
                  background-color: #ef4444;
                  border: none !important;
                  will-change: transform, opacity;
                  -webkit-backface-visibility: hidden;
                  backface-visibility: hidden;
                  transform: translate3d(0, 0, 0);
                  animation: fleet-pulse-ring 1.8s cubic-bezier(0.24, 0, 0.38, 1) infinite;
                  pointer-events: none;
                  z-index: 0;
              }
              @keyframes fleet-pulse-ring {
                  0% { transform: translate3d(0, 0, 0) scale(0.9); opacity: 0.85; }
                  60% { transform: translate3d(0, 0, 0) scale(1.85); opacity: 0; }
                  100% { transform: translate3d(0, 0, 0) scale(1.85); opacity: 0; }
              }

              /* Interactive Radar Markers & Clusters */
              .radar-marker-item {
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  cursor: pointer;
                  pointer-events: auto;
                  transition: transform 0.15s cubic-bezier(0.2, 0, 0, 1);
              }
              .radar-marker-item:active {
                  transform: scale(0.94);
              }

              .radar-marker-icon-box {
                  width: 28px;
                  height: 28px;
                  border-radius: 14px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  box-shadow: 0 3px 10px rgba(0,0,0,0.32);
                  border: 2px solid ${colors.surface};
                  flex-shrink: 0;
              }

              .priority-emergency .radar-marker-icon-box {
                  background: ${colors.error};
                  color: ${colors.onError};
                  box-shadow: 0 0 12px rgba(168, 67, 64, 0.6);
              }
              .priority-priority .radar-marker-icon-box {
                  background: ${colors.secondary};
                  color: ${colors.onSecondary};
                  box-shadow: 0 0 12px rgba(138, 99, 44, 0.6);
              }
              .priority-normal .radar-marker-icon-box {
                  background: ${colors.primary};
                  color: ${colors.onPrimary};
                  box-shadow: 0 0 12px rgba(40, 84, 72, 0.6);
              }
              .priority-vehicle .radar-marker-icon-box {
                  background: #286B54;
                  color: #FFFFFF;
                  box-shadow: 0 0 12px rgba(40, 107, 84, 0.5);
              }
              .priority-station .radar-marker-icon-box {
                  background: #0284c7;
                  color: #FFFFFF;
                  box-shadow: 0 0 12px rgba(2, 132, 199, 0.55);
              }
              .priority-vehicle-busy .radar-marker-icon-box {
                  background: ${colors.outline};
                  color: ${colors.surface};
              }
              .priority-alert .radar-marker-icon-box {
                  background: ${colors.secondary};
                  color: ${colors.onSecondary};
              }

              .radar-marker-label {
                  background: ${colors.surface};
                  color: ${colors.onSurface};
                  border: 1px solid ${colors.outlineVariant};
                  padding: 4px 9px;
                  border-radius: 12px;
                  box-shadow: 0 4px 14px rgba(0,0,0,0.22);
                  font-family: system-ui, -apple-system, sans-serif;
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  white-space: nowrap;
                  max-width: 200px;
              }
              .radar-marker-name {
                  font-size: 11px;
                  font-weight: 700;
                  overflow: hidden;
                  text-overflow: ellipsis;
              }
              .radar-marker-dist {
                  font-size: 10px;
                  font-weight: 600;
                  color: ${colors.onSurfaceVariant};
              }

              /* Marker Clusters */
              .radar-cluster-badge {
                  width: 34px;
                  height: 34px;
                  border-radius: 17px;
                  background: ${colors.surface};
                  border: 2px solid ${colors.primary};
                  color: ${colors.primary};
                  font-family: system-ui, -apple-system, sans-serif;
                  font-weight: 800;
                  font-size: 13px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  box-shadow: 0 4px 14px rgba(0,0,0,0.22);
                  cursor: pointer;
                  transition: transform 0.15s cubic-bezier(0.2, 0, 0, 1);
              }
              .radar-cluster-badge:active {
                  transform: scale(0.92);
              }
          </style>
      </head>
      <body class="scheme-${scheme === 'dark' ? 'dark' : 'light'}">
          <div id="map"></div>
          
          <div id="navHeader" class="nav-header">
              <div class="nav-main-banner">
                  <div class="nav-icon-wrapper">
                      <div id="navIcon" class="nav-icon"></div>
                  </div>
                  <div class="nav-info">
                      <div class="nav-dist-row">
                          <span id="navDistVal" class="nav-dist">--</span>
                          <span id="navDistUnit" class="nav-dist-unit">m</span>
                          <span id="navAction" class="nav-action">Calculating directions</span>
                      </div>
                      <div id="navStreet" class="nav-street"></div>
                  </div>
              </div>
              <div id="navThenBanner" class="nav-then-badge">
                  <span>Then</span><div id="navThenIcon" class="nav-then-icon" aria-hidden="true"></div><span id="navThenText" class="nav-then-text"></span>
              </div>
          </div>
          
          <button type="button" id="overviewBtn" aria-label="Show route overview" class="overview-btn" onclick="window.showOverview()" style="display: none;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="6" r="3"/>
                  <path d="M6 15v-1a4 4 0 0 1 4-4h4a4 4 0 0 0 4-4V9"/>
              </svg>
          </button>
          
          <button type="button" id="recenterBtn" aria-label="Recenter map on your location" class="recenter-btn" onclick="window.recenterMap()">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
          </button>

          <div id="etaBox" class="eta-box" style="display: none !important;">
              <div id="etaTime" class="eta-time">ETA: -- min</div>
              <div id="etaDelay" class="eta-delay">⚠️ +-- min traffic</div>
          </div>
          
          <script>
              window.__mapLoaded = false;
              window.__mapErrorReported = false;
              window.__reportMapError = function(reason) {
                  if (window.__mapErrorReported) return;
                  window.__mapErrorReported = true;
                  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_ERROR', reason: reason }));
              };
              if (typeof tt !== 'undefined' && typeof tt.setProductInfo === 'function') tt.setProductInfo('fleetops', '1.0');
              
              window.originMarker = null;
              window.destMarker = null;
              window.ttMap = null;
              window.isFollowing = true;
              window.__cameraMode = 'follow';
              window.__viewportInsets = { top: 0, bottom: 0, left: 0, right: 0 };
              window.__navigationTop = ${safeTopInset};
              window.__navigationHeight = 0;
              window.__reportedNavigationHeight = null;
              // UI measurements change framing only. Route preferences, GPS and
              // provider calculations never run through this bridge.
              window.__cameraPadding = function() {
                  const inset = window.__viewportInsets;
                  const container = window.ttMap && window.ttMap.getContainer ? window.ttMap.getContainer() : null;
                  const width = (container && container.clientWidth) || window.innerWidth || 390;
                  const height = (container && container.clientHeight) || window.innerHeight || 800;
                  let top = Math.max(inset.top, window.__navigationHeight ? window.__navigationTop + window.__navigationHeight + 12 : 0) + 24;
                  let bottom = inset.bottom + 24;
                  let left = inset.left + 24;
                  let right = inset.right + 24;
                  // Keep a usable map center even when large text/sheets leave
                  // less space than the requested clearance.
                  const vertical = Math.min(1, Math.max(0, height - 80) / (top + bottom));
                  const horizontal = Math.min(1, Math.max(0, width - 80) / (left + right));
                  return { top: top * vertical, bottom: bottom * vertical, left: left * horizontal, right: right * horizontal };
              };
              window.__applyViewportCamera = function() {
                  if (!window.ttMap || !window.__mapActive) return;
                  if (window.__cameraMode === 'overview' && window.showOverview) window.showOverview();
                  else if (window.isFollowing) {
                      if (${safeRadarMode} && window.recenterRadar) window.recenterRadar();
                      else if (window.recenterMap) window.recenterMap();
                  }
              };
              window.__setViewportInsets = function(insets, top) {
                  const next = {};
                  ['top', 'bottom', 'left', 'right'].forEach(function(edge) {
                      next[edge] = typeof insets[edge] === 'number' && Number.isFinite(insets[edge]) ? Math.min(10000, Math.max(0, insets[edge])) : 0;
                  });
                  const navigationTop = typeof top === 'number' && Number.isFinite(top) ? Math.min(300, Math.max(0, top)) : 36;
                  const changed = JSON.stringify(next) !== JSON.stringify(window.__viewportInsets) || navigationTop !== window.__navigationTop;
                  window.__viewportInsets = next;
                  window.__navigationTop = navigationTop;
                  const header = document.getElementById('navHeader');
                  if (header) header.style.top = navigationTop + 'px';
                  if (changed) window.__applyViewportCamera();
              };
              window.__reportNavigationLayout = function() {
                  const header = document.getElementById('navHeader');
                  const height = header && header.style.display !== 'none' ? Math.ceil(header.getBoundingClientRect().height) : 0;
                  if (height === window.__reportedNavigationHeight) return;
                  const changed = height !== window.__navigationHeight;
                  window.__navigationHeight = height;
                  window.__reportedNavigationHeight = height;
                  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'NAVIGATION_LAYOUT', height: height }));
                  if (changed) window.__applyViewportCamera();
              };
              window.__setMapFonts = function(css) {
                  const style = document.getElementById('fleetMapFonts');
                  if (!style || typeof css !== 'string' || style.textContent === css) return;
                  style.textContent = css;
                  if (document.fonts && document.fonts.ready) document.fonts.ready.then(window.__reportNavigationLayout);
              };
              


              window.createGeoJsonCircle = function(centerLng, centerLat, radiusInMeters, points) {
                  if (!points) points = 64;
                  const coords = [];
                  const km = radiusInMeters / 1000;
                  const distanceX = km / (111.32 * Math.cos(centerLat * Math.PI / 180));
                  const distanceY = km / 110.574;

                  for (let i = 0; i < points; i++) {
                      const theta = (i / points) * (2 * Math.PI);
                      const x = distanceX * Math.cos(theta);
                      const y = distanceY * Math.sin(theta);
                      coords.push([centerLng + x, centerLat + y]);
                  }
                  coords.push(coords[0]);
                  return {
                      type: 'Feature',
                      geometry: {
                          type: 'Polygon',
                          coordinates: [coords]
                      },
                      properties: {}
                  };
              };

              window.currentRadarKm = ${radarRadiusJs};
              window.currentRadarZoom = ${safeRadarRadiusKm <= 1 ? 15.5 : safeRadarRadiusKm <= 3 ? 14.2 : safeRadarRadiusKm <= 5 ? 13.0 : 11.8};
              window.radarMarkerInstances = [];
              window.currentMarkersData = [];

              window.updateRadarCirclePositions = function() {
                  window.updateRadarBloomScale();
              };

              window.updateRadarBloomScale = function() {
                  const bloom = document.getElementById('radarBloomContainer');
                  const map = window.ttMap;
                  if (!bloom || !map || !window.originMarker) return;
                  const center = window.originMarker.getLngLat();
                  const edge = window.createGeoJsonCircle(center.lng, center.lat, window.currentRadarKm * 1000).geometry.coordinates[0][0];
                  const a = map.project(center);
                  const b = map.project(edge);
                  const diameter = 2 * Math.hypot(b.x - a.x, b.y - a.y);
                  bloom.style.width = diameter + 'px';
                  bloom.style.height = diameter + 'px';
              };

              window.updateRadarCoverage = function(km) {
                  window.currentRadarKm = km;
                  if (window.isFollowing) window.recenterRadar();
                  window.updateRadarBloomScale();
              };

              window.recenterRadar = function() {
                  const map = window.ttMap;
                  if (!map || !window.originMarker) return;
                  window.isFollowing = true;
                  window.__cameraMode = 'follow';
                  const center = window.originMarker.getLngLat();
                  const bounds = new tt.LngLatBounds();
                  window.createGeoJsonCircle(center.lng, center.lat, window.currentRadarKm * 1000).geometry.coordinates[0].forEach(p => bounds.extend(p));
                  map.fitBounds(bounds, { padding: window.__cameraPadding(), bearing: 0, pitch: 0, duration: 0 });
                  window.currentRadarZoom = map.getZoom();
                  window.updateRadarBloomScale();
              };

              window.setVehicleVisible = function(visible) {
                  if (window.originMarker) {
                      const el = window.originMarker.getElement();
                      if (el) el.style.display = visible ? 'flex' : 'none';
                  }
                  try {
                      const fleetMap = window.ttMap;
                      if (fleetMap && fleetMap.getLayer('driver-layer')) fleetMap.setLayoutProperty('driver-layer', 'visibility', visible ? 'visible' : 'none');
                      if (fleetMap && fleetMap.getLayer('driver-halo')) fleetMap.setLayoutProperty('driver-halo', 'visibility', visible ? 'visible' : 'none');
                  } catch (e) {}
              };

              // Fleet live layers (driver + responders as WebGL GeoJSON).
              // High-frequency GPS ticks arrive via window.__updateFleetPositions
              // and only mutate source data — no tt.Marker is created per tick,
              // so per-fix DOM churn stays flat on low-end devices.
              window.__mapActive = ${serializeInlineScriptValue(mapActive === true)};
              window.__fleetAnimId = 0;
              window.__fleetRendered = null;
              window.__lastCamLng = null;
              window.__lastCamLat = null;
              window.__lastRespondersJson = '';

              // Tab/background lifecycle: pause rAF interpolation and camera
              // glides while hidden; the next tick repaints instantly on resume.
              window.__setMapActive = function(active) {
                  const wasActive = window.__mapActive;
                  window.__mapActive = active === true;
                  if (!window.__mapActive && window.__fleetAnimId) {
                      try { cancelAnimationFrame(window.__fleetAnimId); } catch (e) {}
                      window.__fleetAnimId = 0;
                  }
                  if (!wasActive && window.__mapActive) window.__refreshOnNextFix = true;
                  if (!wasActive && window.__mapActive && window.__applyViewportCamera) window.__applyViewportCamera();
              };
              window.__setLocationFresh = function(fresh) {
                  window.__locationFresh = fresh === true;
                  if (!window.__locationFresh) {
                      const header = document.getElementById('navHeader');
                      if (header) header.style.display = 'none';
                      if (window.__reportNavigationLayout) window.__reportNavigationLayout();
                  }
                  if (window.__locationFresh && window.__refreshOnNextFix && window.__refreshRouteIfNeeded && window.__refreshRouteIfNeeded()) window.__refreshOnNextFix = false;
              };

              window.__fleetPoint = function(lng, lat) {
                  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} };
              };

              window.__ensureFleetSources = function() {
                  const fleetMap = window.ttMap;
                  if (!fleetMap || typeof fleetMap.addSource !== 'function') return false;
                  try {
                      if (!fleetMap.getSource('driver-source')) {
                          fleetMap.addSource('driver-source', { type: 'geojson', data: window.__fleetPoint(0, 0) });
                      }
                      if (!fleetMap.getLayer('driver-halo')) {
                          fleetMap.addLayer({ id: 'driver-halo', type: 'circle', source: 'driver-source', paint: { 'circle-radius': 16, 'circle-color': ${primaryColorJs}, 'circle-opacity': 0.22 } });
                      }
                      if (!fleetMap.getLayer('driver-layer')) {
                          fleetMap.addLayer({ id: 'driver-layer', type: 'circle', source: 'driver-source', paint: { 'circle-radius': 8, 'circle-color': ${primaryColorJs}, 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' } });
                      }
                      if (!fleetMap.getSource('responders-source')) {
                          fleetMap.addSource('responders-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
                      }
                      if (!fleetMap.getLayer('responders-layer')) {
                          fleetMap.addLayer({ id: 'responders-layer', type: 'circle', source: 'responders-source', paint: { 'circle-radius': 7, 'circle-color': ${secondaryColorJs}, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
                      }
                      return true;
                  } catch (e) { return false; }
              };

              window.__paintDriverPoint = function(lng, lat) {
                  try {
                      const fleetMap = window.ttMap;
                      if (fleetMap && fleetMap.getSource('driver-source')) fleetMap.getSource('driver-source').setData(window.__fleetPoint(lng, lat));
                  } catch (e) {}
                  window.__fleetRendered = { lng: lng, lat: lat };
                  try {
                      if (window.originMarker) window.originMarker.setLngLat([lng, lat]);
                  } catch (e) {}
              };

              // Responders repaint only when the payload actually changed.
              window.__paintResponders = function(responders) {
                  const list = Array.isArray(responders) ? responders : [];
                  let nextJson = '';
                  try { nextJson = JSON.stringify(list); } catch (e) { return; }
                  if (nextJson === window.__lastRespondersJson) return;
                  window.__lastRespondersJson = nextJson;
                  try {
                      const fleetMap = window.ttMap;
                      if (!fleetMap || !fleetMap.getSource('responders-source')) return;
                      fleetMap.getSource('responders-source').setData({
                          type: 'FeatureCollection',
                          features: list.filter(function (entry) {
                              return entry && typeof entry.lat === 'number' && typeof entry.lng === 'number' &&
                                  isFinite(entry.lat) && isFinite(entry.lng) &&
                                  entry.lat >= -90 && entry.lat <= 90 && entry.lng >= -180 && entry.lng <= 180;
                          }).map(function (entry) {
                              return { type: 'Feature', geometry: { type: 'Point', coordinates: [entry.lng, entry.lat] }, properties: { id: entry.id || null } };
                          })
                      });
                  } catch (e) {}
              };

              // Single per-tick entry point for live GPS. Snapping, banner,
              // rotation, interpolation and camera follow all happen here, so
              // the native side sends four numbers and nothing else.
              window.__updateFleetPositions = function(lat, lng, heading, responders, observedAt) {
                  if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return;
                  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
                  const capturedAt = observedAt === undefined ? Date.now() : observedAt;
                  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) || capturedAt <= 0 || capturedAt > Date.now() + 30000) return;
                  const previousAt = window.currentFixObservedAt;
                  const validPreviousAt = typeof previousAt === 'number' && Number.isFinite(previousAt) && previousAt > 0 && previousAt <= Date.now() + 30000;
                  if (validPreviousAt && capturedAt < previousAt) return;
                  const h = (typeof heading === 'number' && isFinite(heading)) ? heading : (window.lastHeading || 0);
                  window.lastHeading = h;
                  window.currentCarLng = lng;
                  window.currentCarLat = lat;
                  window.currentFixObservedAt = capturedAt;
                  window.__observedFix = { lng: lng, lat: lat, observedAt: capturedAt };
                  if (window.__mapActive && window.__refreshOnNextFix && window.__refreshRouteIfNeeded && window.__refreshRouteIfNeeded()) window.__refreshOnNextFix = false;

                  let finalLng = lng;
                  let finalLat = lat;
                  let snap = null;
                  if (window.getSnappedPosition) {
                      try {
                          snap = window.getSnappedPosition(finalLng, finalLat);
                          finalLng = snap.lng;
                          finalLat = snap.lat;
                          window.currentCarLng = finalLng;
                          window.currentCarLat = finalLat;
                      } catch (e) {}
                  }
                  if (window.updateNavigationBanner) {
                      // Arrival uses the observed fix, never the road-snapped car.
                      try { window.updateNavigationBanner(lng, lat, snap); } catch (e) {}
                  }
                  if (window.updateCarRotation) {
                      try { window.updateCarRotation(); } catch (e) {}
                  }
                  window.__paintResponders(responders);

                  if (${safeRadarMode} && window.updateRadarCirclePositions) {
                      window.updateRadarCirclePositions(finalLng, finalLat);
                  }

                  const from = window.__fleetRendered || { lng: finalLng, lat: finalLat };
                  if (!window.__mapActive) {
                      if (window.__fleetAnimId) { try { cancelAnimationFrame(window.__fleetAnimId); } catch (e) {} window.__fleetAnimId = 0; }
                      window.__paintDriverPoint(finalLng, finalLat);
                      return;
                  }
                  if (window.__fleetAnimId) { try { cancelAnimationFrame(window.__fleetAnimId); } catch (e) {} window.__fleetAnimId = 0; }
                  // Smooth linear interpolation (~1200 ms) from the last
                  // painted point to the new fix before committing setData.
                  let startMs = null;
                  const step = function (nowMs) {
                      if (!window.__mapActive) { window.__fleetAnimId = 0; window.__paintDriverPoint(finalLng, finalLat); return; }
                      if (startMs == null) startMs = nowMs;
                      const t = Math.min(1, (nowMs - startMs) / 1200);
                      const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                      const clng = from.lng + (finalLng - from.lng) * eased;
                      const clat = from.lat + (finalLat - from.lat) * eased;
                      window.__paintDriverPoint(clng, clat);
                      if (t < 1) {
                          window.__fleetAnimId = requestAnimationFrame(step);
                      } else {
                          window.__fleetAnimId = 0;
                          try { if (window.updateRadarBloomScale) window.updateRadarBloomScale(); } catch (e) {}
                      }
                  };
                  window.__fleetAnimId = requestAnimationFrame(step);

                  // Camera follow re-fires only after real movement (~16 m),
                  // so heading-only ticks never restart the glide.
                  try {
                      const navMap = window.ttMap;
                      const lastLng = window.__lastCamLng;
                      const lastLat = window.__lastCamLat;
                      const moved = lastLng == null || lastLat == null ||
                          (Math.abs(finalLat - lastLat) + Math.abs(finalLng - lastLng)) > 0.00015;
                      if (navMap && window.isFollowing && moved) {
                          window.__lastCamLng = finalLng;
                          window.__lastCamLat = finalLat;
                          const routeBearing = window.getRouteBearing ? window.getRouteBearing(finalLng, finalLat) : (window.lastHeading || 0);
                          const isRadar = ${safeRadarMode};
                          navMap.easeTo({
                              center: [finalLng, finalLat],
                              zoom: isRadar ? (window.currentRadarZoom || 14.2) : 18.5,
                              pitch: 0,
                              bearing: isRadar ? 0 : routeBearing,
                              padding: window.__cameraPadding(),
                              duration: 1200
                          });
                      }
                  } catch (e) {}
              };

              // Route geometry updates only on fetch/recalculate — never on
              // GPS ticks. The route controller below funnels through this.
              window.__updateRoutePolyline = function(geojson) {
                  const routeMap = window.ttMap;
                  if (!routeMap || !geojson) return false;
                  try {
                      if (routeMap.getLayer('route') && routeMap.getSource('route')) {
                          routeMap.getSource('route').setData(geojson);
                          return true;
                      }
                      if (typeof routeMap.removeLayer === 'function' && routeMap.getLayer('route')) routeMap.removeLayer('route');
                      if (typeof routeMap.removeSource === 'function' && routeMap.getSource('route')) routeMap.removeSource('route');
                      routeMap.addLayer({ id: 'route', type: 'line', source: { type: 'geojson', data: geojson }, paint: { 'line-color': ['get', 'color'], 'line-width': 6, 'line-opacity': 1 } });
                      return true;
                  } catch (e) { return false; }
              };

              // Release the WebGL context cleanly when the document unloads.
              window.addEventListener('pagehide', function() { try { if (window.ttMap) window.ttMap.remove(); } catch (e) {} });
              window.addEventListener('beforeunload', function() { try { if (window.ttMap) window.ttMap.remove(); } catch (e) {} });

              window.carMarkerImageUrl = ${serializeInlineScriptValue(cachedCarImage || carImage || '')};
              window.cssUrl = function(value) {
                  const quote = String.fromCharCode(34);
                  const slash = String.fromCharCode(92);
                  const escaped = Array.from(String(value || '')).map(function(character) {
                      const code = character.codePointAt(0);
                      return code <= 32 || code === 127 || character === quote || character === slash || character === '<' || character === '>'
                          ? slash + code.toString(16) + ' '
                          : character;
                  }).join('');
                  return 'url(' + quote + escaped + quote + ')';
              };
              window.setCarMarkerImage = function(imgUrl) {
                  window.carMarkerImageUrl = imgUrl || '';
                  const el = document.getElementById('carInnerIcon');
                  if (el && imgUrl) {
                      el.style.backgroundImage = window.cssUrl(imgUrl);
                  }
              };

              function getMarkerIconSymbol(marker) {
                  if (marker.type === 'gas_station') {
                      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.77 7.23l.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33 0 1.38 1.12 2.5 2.5 2.5.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></svg>';
                  }
                  if (marker.type === 'vehicle' || marker.type === 'driver') {
                      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4.66l.12-.34h13.77l.11.34V17z"/><circle cx="7.5" cy="14.5" r="1.5"/><circle cx="16.5" cy="14.5" r="1.5"/></svg>';
                  }
                  if (marker.priority === 'emergency') {
                      return 'H';
                  }
                  if (marker.priority === 'priority') {
                      return '★';
                  }
                  if (marker.type === 'alert') {
                      return '!';
                  }
                  return '●';
              }

              // Native buttons keep Enter/Space activation. Only activation
              // keys stop at a button, leaving Escape and map gestures alone.
              window.__mapButtonKeydown = function(event) {
                  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
              };

              window.renderRadarMarkers = function(markers, selectedKm) {
                  if (!window.ttMap || !Array.isArray(markers)) return;
                  window.currentMarkersData = markers;
                  const effectiveKm = selectedKm !== undefined ? selectedKm : (window.currentRadarKm || 3);

                  // Clear old markers
                  if (window.radarMarkerInstances) {
                      window.radarMarkerInstances.forEach(function(m) {
                          try { m.remove(); } catch(e) {}
                      });
                  }
                  window.radarMarkerInstances = [];

                  // Filter by selected range (range 10 = 'All')
                  const visible = markers.filter(function(m) {
                      if (m.lat == null || m.lng == null) return false;
                      if (effectiveKm >= 10) return true;
                      if (m.distanceKm == null) return true;
                      return m.distanceKm <= (effectiveKm + 0.35);
                  });

                  // Simple proximity clustering (~150m threshold)
                  const clusters = [];
                  const used = new Set();

                  for (let i = 0; i < visible.length; i++) {
                      if (used.has(i)) continue;
                      const cluster = [visible[i]];
                      used.add(i);

                      for (let j = i + 1; j < visible.length; j++) {
                          if (used.has(j)) continue;
                          const dLat = Math.abs(visible[i].lat - visible[j].lat);
                          const dLng = Math.abs(visible[i].lng - visible[j].lng);
                          if (dLat < 0.0018 && dLng < 0.0018) {
                              cluster.push(visible[j]);
                              used.add(j);
                          }
                      }
                      clusters.push(cluster);
                  }

                  clusters.forEach(function(group) {
                      if (group.length > 1) {
                          // Render Cluster Badge
                          const avgLat = group.reduce((s, g) => s + g.lat, 0) / group.length;
                          const avgLng = group.reduce((s, g) => s + g.lng, 0) / group.length;

                          const clusterEl = document.createElement('button');
                          clusterEl.type = 'button';
                          clusterEl.className = 'radar-cluster-badge';
                          clusterEl.innerText = group.length;
                          clusterEl.title = group.length + ' nearby dispatches';
                          clusterEl.setAttribute('aria-label', 'Zoom in to ' + group.length + ' nearby dispatches');
                          clusterEl.onkeydown = window.__mapButtonKeydown;
                          clusterEl.onclick = function(e) {
                              e.stopPropagation();
                              window.isFollowing = false;
                              window.__cameraMode = 'manual';
                              window.ttMap.flyTo({
                                  center: [avgLng, avgLat],
                                  zoom: Math.min(window.ttMap.getZoom() + 2, 17.5),
                                   padding: window.__cameraPadding(),
                                  duration: 600
                              });
                          };

                          const markerObj = new tt.Marker({ element: clusterEl, anchor: 'center' })
                              .setLngLat([avgLng, avgLat])
                              .addTo(window.ttMap);
                          window.radarMarkerInstances.push(markerObj);
                      } else {
                          // Render Single Marker
                          const m = group[0];
                          const priorityClass = m.priority === 'emergency' 
                              ? 'priority-emergency' 
                              : m.priority === 'priority' 
                                  ? 'priority-priority' 
                                  : m.type === 'gas_station'
                                      ? 'priority-station'
                                      : (m.type === 'vehicle' || m.type === 'driver')
                                          ? (m.status === 'busy' ? 'priority-vehicle-busy' : 'priority-vehicle')
                                          : m.type === 'alert'
                                              ? 'priority-alert'
                                              : 'priority-normal';

                          const markerEl = document.createElement('button');
                          markerEl.type = 'button';
                          markerEl.setAttribute('aria-label', 'Open ' + (m.title || 'assignment') + (m.distanceKm != null ? ', ' + m.distanceKm + ' kilometers straight-line distance' : ''));
                          markerEl.onkeydown = window.__mapButtonKeydown;
                          markerEl.className = 'radar-marker-item ' + priorityClass;
                          
                          const iconWrap = document.createElement('div');
                          iconWrap.className = 'radar-marker-icon-wrap';
                          iconWrap.style.position = 'relative';
                          iconWrap.style.display = 'flex';
                          iconWrap.style.alignItems = 'center';
                          iconWrap.style.justifyContent = 'center';

                          if (m.priority === 'emergency') {
                              const pulseEl = document.createElement('span');
                              pulseEl.className = 'fleet-marker-pulse';
                              iconWrap.appendChild(pulseEl);
                          }

                          const iconBox = document.createElement('div');
                          iconBox.className = 'radar-marker-icon-box';
                          iconBox.style.position = 'relative';
                          iconBox.style.zIndex = '1';
                          iconBox.innerHTML = getMarkerIconSymbol(m);
                          iconWrap.appendChild(iconBox);
                          markerEl.appendChild(iconWrap);

                          const labelEl = document.createElement('div');
                          labelEl.className = 'radar-marker-label';
                          const nameEl = document.createElement('span');
                          nameEl.className = 'radar-marker-name';
                          nameEl.textContent = m.title || 'Assignment';
                          labelEl.appendChild(nameEl);
                          if (m.distanceKm != null) {
                              const distanceEl = document.createElement('span');
                              distanceEl.className = 'radar-marker-dist';
                              distanceEl.textContent = m.distanceKm + ' km';
                              labelEl.appendChild(distanceEl);
                          }
                          markerEl.appendChild(labelEl);

                          markerEl.onclick = function(e) {
                              e.stopPropagation();
                              if (window.ReactNativeWebView) {
                                  window.ReactNativeWebView.postMessage(JSON.stringify({
                                      type: 'MARKER_TAPPED',
                                      marker: m
                                  }));
                              }
                          };

                          const markerObj = new tt.Marker({ element: markerEl, anchor: 'center' })
                              .setLngLat([m.lng, m.lat])
                              .addTo(window.ttMap);
                          window.radarMarkerInstances.push(markerObj);
                      }
                  });
              };

              window.updateCarRotation = function(heading) {
                  if (heading === undefined) {
                      if (window.getRouteBearing && window.currentCarLng) {
                          heading = window.getRouteBearing(window.currentCarLng, window.currentCarLat);
                      } else {
                          heading = window.lastHeading || 0;
                      }
                  }
                  if (!window.ttMap) return;
                  const mapBearing = window.ttMap.getBearing();
                  const el = document.getElementById('carInnerIcon');
                  if (el) {
                      el.style.transform = 'rotate(' + (heading - mapBearing) + 'deg)';
                  }
              };

              window.showOverview = function() {
                  window.isFollowing = false;
                  window.__cameraMode = 'overview';
                  document.getElementById('recenterBtn').style.display = 'flex';
                  
                  if (window.routeCoords && window.routeCoords.length > 0) {
                      const bounds = new tt.LngLatBounds();
                      window.routeCoords.forEach(coord => {
                          const lng = Array.isArray(coord) ? coord[0] : (coord.lng !== undefined ? coord.lng : coord.longitude);
                          const lat = Array.isArray(coord) ? coord[1] : (coord.lat !== undefined ? coord.lat : coord.latitude);
                          bounds.extend([lng, lat]);
                      });
                      window.ttMap.fitBounds(bounds, { padding: window.__cameraPadding(), pitch: 0, bearing: 0, duration: 800 });
                  }
              };

              window.getRouteBearing = function(lng, lat) {
                  if (!window.routeCoords || window.routeCoords.length < 2) return window.lastHeading || 0;
                  const snap = window.getSnappedPosition ? window.getSnappedPosition(lng, lat) : { closestIdx: 0 };
                  const idx1 = snap.closestIdx;
                  
                  const pt1 = window.routeCoords[idx1];
                  let lng1 = Array.isArray(pt1) ? pt1[0] : (pt1.lng !== undefined ? pt1.lng : pt1.longitude);
                  let lat1 = Array.isArray(pt1) ? pt1[1] : (pt1.lat !== undefined ? pt1.lat : pt1.latitude);
                  
                  // Haversine distance function
                  function getDist(latA, lonA, latB, lonB) {
                      const R = 6371e3;
                      const p1 = latA * Math.PI/180;
                      const p2 = latB * Math.PI/180;
                      const dp = (latB-latA) * Math.PI/180;
                      const dl = (lonB-lonA) * Math.PI/180;
                      const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
                      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                      return R * c;
                  }

                  let pt2 = null;
                  let lng2, lat2;
                  
                  // Look ahead at least 10 meters to get a stable bearing
                  for (let i = idx1 + 1; i < window.routeCoords.length; i++) {
                      const p = window.routeCoords[i];
                      const ln = Array.isArray(p) ? p[0] : (p.lng !== undefined ? p.lng : p.longitude);
                      const lt = Array.isArray(p) ? p[1] : (p.lat !== undefined ? p.lat : p.latitude);
                      if (getDist(lat1, lng1, lt, ln) > 10) {
                          pt2 = p;
                          lng2 = ln;
                          lat2 = lt;
                          break;
                      }
                  }
                  
                  // If too close to the end, look backwards to get the final bearing
                  if (!pt2) {
                      for (let i = idx1 - 1; i >= 0; i--) {
                          const p = window.routeCoords[i];
                          const ln = Array.isArray(p) ? p[0] : (p.lng !== undefined ? p.lng : p.longitude);
                          const lt = Array.isArray(p) ? p[1] : (p.lat !== undefined ? p.lat : p.latitude);
                          if (getDist(lat1, lng1, lt, ln) > 10) {
                              lng2 = lng1; lat2 = lat1; // Target is current point
                              lng1 = ln; lat1 = lt; // Origin is a past point
                              pt2 = p;
                              break;
                          }
                      }
                  }
                  
                  if (!pt2) return window.lastHeading || 0;
                  
                  const toRad = x => x * Math.PI / 180;
                  const toDeg = x => x * 180 / Math.PI;
                  const dLng = toRad(lng2 - lng1);
                  const lat1R = toRad(lat1);
                  const lat2R = toRad(lat2);
                  const y = Math.sin(dLng) * Math.cos(lat2R);
                  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
                  let brng = toDeg(Math.atan2(y, x));
                  return (brng + 360) % 360;
              };

              window.recenterMap = function() {
                  window.isFollowing = true;
                  window.__cameraMode = 'follow';
                  document.getElementById('recenterBtn').style.display = 'none';
                  
                  if (window.ttMap && window.currentCarLng != null && window.currentCarLat != null) {
                      const routeBearing = window.getRouteBearing(window.currentCarLng, window.currentCarLat);
                      window.ttMap.flyTo({ 
                          center: [window.currentCarLng, window.currentCarLat], 
                          zoom: 18.5, 
                          pitch: 0, 
                          bearing: routeBearing,
                           padding: window.__cameraPadding(),
                          duration: 800 
                      });
                  }
              };
              
              const icons = {
                  LEFT: '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M24 27V18a7 7 0 0 0-7-7H6M12 5l-6 6 6 6" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                  RIGHT: '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M8 27V18a7 7 0 0 1 7-7h11M20 5l6 6-6 6" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                  STRAIGHT: '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M16 27V5M8 13l8-8 8 8" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
                  UNKNOWN: '<svg aria-hidden="true" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="11" stroke="currentColor" stroke-width="3"/><path d="M16 15v8M16 9v1" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
                  ARRIVE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>'
              };

              window.getManeuverIcon = function(maneuver) {
                  const code = typeof maneuver === 'string' ? maneuver.toUpperCase() : '';
                  if (code.includes('ARRIVE')) return icons.ARRIVE;
                  if (code.includes('ROUNDABOUT') || code.includes('UTURN')) return icons.UNKNOWN;
                  if (code.includes('LEFT')) return icons.LEFT;
                  if (code.includes('RIGHT')) return icons.RIGHT;
                  if (code.includes('STRAIGHT') || code === 'DEPART') return icons.STRAIGHT;
                  return icons.UNKNOWN;
              };

              window.getSnappedPosition = function(lng, lat) {
                  if (!window.routeCoords || window.routeCoords.length === 0) return { lng, lat, isSnapped: false };
                  
                  function getDist(lat1, lon1, lat2, lon2) {
                      const R = 6371e3;
                      const p1 = lat1 * Math.PI/180;
                      const p2 = lat2 * Math.PI/180;
                      const dp = (lat2-lat1) * Math.PI/180;
                      const dl = (lon2-lon1) * Math.PI/180;
                      const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
                      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                      return R * c;
                  }

                  function searchRange(start, end) {
                      let minDist = Infinity;
                      let closestIdx = 0;
                      for (let i = start; i < end; i++) {
                          const pt = window.routeCoords[i];
                          const ptLng = Array.isArray(pt) ? pt[0] : (pt.lng !== undefined ? pt.lng : pt.longitude);
                          const ptLat = Array.isArray(pt) ? pt[1] : (pt.lat !== undefined ? pt.lat : pt.latitude);

                          if (ptLat !== undefined && ptLng !== undefined) {
                              const d = getDist(lat, lng, ptLat, ptLng);
                              if (d < minDist) {
                                  minDist = d;
                                  closestIdx = i;
                              }
                          }
                      }
                      return { minDist: minDist, closestIdx: closestIdx };
                  }

                  window.lastClosestIdx = window.lastClosestIdx || 0;
                  // Fast path: search a window around the last known position.
                  let found = searchRange(Math.max(0, window.lastClosestIdx - 5), Math.min(window.routeCoords.length, window.lastClosestIdx + 150));

                  // Not near the road? Scan the FULL route before declaring the
                  // driver off-route — the windowed search misses fixes that
                  // land behind or far ahead of the last index (detours, loops).
                  if (found.minDist >= 35) {
                      found = searchRange(0, window.routeCoords.length);
                  }

                  const minDist = found.minDist;
                  const closestIdx = found.closestIdx;
                  window.lastClosestIdx = closestIdx;
                  
                  // If we are within 35 meters of the road, snap to it!
                  if (minDist < 35) {
                      const pt = window.routeCoords[closestIdx];
                      const snappedLng = Array.isArray(pt) ? pt[0] : (pt.lng !== undefined ? pt.lng : pt.longitude);
                      const snappedLat = Array.isArray(pt) ? pt[1] : (pt.lat !== undefined ? pt.lat : pt.latitude);
                      return { lng: snappedLng, lat: snappedLat, isSnapped: true, closestIdx, minDist };
                  }
                  
                  return { lng, lat, isSnapped: false, closestIdx, minDist };
              };

              window.fleetRouteConfig = ${serializeInlineScriptValue({ key: tomtomKey, traffic: safeAutoSwoop, alternatives: safeAutoSwoop, primary: colors.primary, sessionKey: routeSessionKey, tripId: routeTripId, avoidTolls: routePreferences.avoidTolls === true, selectedIndex: routePreferences.selectedIndex || 0 })};
              ${ROUTE_CONTROLLER_SCRIPT}

              window.updateNavigationBanner = function(carLng, carLat, snapInfo = null) {
                  const observedAt = window.currentFixObservedAt;
                  if (${safeShowCarIcon} && (window.__locationFresh === false || typeof observedAt !== 'number' || !Number.isFinite(observedAt) || observedAt > Date.now() + 30000 || Date.now() - observedAt > 90000)) {
                      const header = document.getElementById('navHeader');
                      if (header) header.style.display = 'none';
                      if (window.__reportNavigationLayout) window.__reportNavigationLayout();
                      window.offRouteCount = 0;
                      return;
                  }
                  if (!window.routeCoords || window.routeCoords.length === 0) {
                      document.getElementById('navHeader').style.display = 'none';
                      if (window.__reportNavigationLayout) window.__reportNavigationLayout();
                      return;
                  }
                  
                  function getDist(lat1, lon1, lat2, lon2) {
                      const R = 6371e3;
                      const p1 = lat1 * Math.PI/180;
                      const p2 = lat2 * Math.PI/180;
                      const dp = (lat2-lat1) * Math.PI/180;
                      const dl = (lon2-lon1) * Math.PI/180;
                      const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
                      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                      return R * c;
                  }

                  const validTarget = typeof window.currentDestLat === 'number' && Number.isFinite(window.currentDestLat) && typeof window.currentDestLng === 'number' && Number.isFinite(window.currentDestLng);
                  const observed = window.__observedFix;
                  const actualLng = observed && observed.observedAt === observedAt ? observed.lng : carLng;
                  const actualLat = observed && observed.observedAt === observedAt ? observed.lat : carLat;
                  const distanceToDestination = validTarget ? getDist(actualLat, actualLng, window.currentDestLat, window.currentDestLng) : Infinity;
                  const arrived = distanceToDestination < 50;
                  const navHeader = document.getElementById('navHeader');
                  const paintNeutral = function(action, icon) {
                      document.getElementById('navAction').innerText = action;
                      document.getElementById('navStreet').innerText = '';
                      document.getElementById('navDistVal').innerText = '';
                      document.getElementById('navDistUnit').innerText = '';
                      document.getElementById('navIcon').innerHTML = window.getManeuverIcon(icon);
                      document.getElementById('navThenBanner').style.display = 'none';
                      navHeader.style.display = 'flex';
                      if (window.__reportNavigationLayout) window.__reportNavigationLayout();
                  };
                  if (arrived) {
                      paintNeutral('Arrived', 'ARRIVE');
                      return;
                  }

                  let minDist = snapInfo ? snapInfo.minDist : 0;
                  let closestIdx = snapInfo ? snapInfo.closestIdx : 0;
                  
                  if (!snapInfo) {
                      const fallbackSnap = window.getSnappedPosition(carLng, carLat);
                      minDist = fallbackSnap.minDist;
                      closestIdx = fallbackSnap.closestIdx;
                  }
                  
                  // Auto-Rerouting: a single noisy fix must not trigger a full
                  // recalculation (urban-canyon jitter easily reads >50m off).
                  // Require two consecutive off-route fixes first.
                  if (minDist > 50 && validTarget && window.__mapActive) {
                      window.offRouteCount = (window.offRouteCount || 0) + 1;
                      if (window.offRouteCount >= 2) {
                          window.offRouteCount = 0;
                          window.recalculateRoute(carLng, carLat);
                      }
                      paintNeutral('Updating directions', null);
                      return;
                  }
                  window.offRouteCount = 0;
                  
                  // Cache cumulative route distances for the next maneuver.
                  if (!window.cumDist) {
                      window.cumDist = [0];
                      for (let i = 1; i < window.routeCoords.length; i++) {
                          const p1 = window.routeCoords[i-1];
                          const p2 = window.routeCoords[i];
                          const l1 = Array.isArray(p1) ? p1[0] : (p1.lng !== undefined ? p1.lng : p1.longitude);
                          const a1 = Array.isArray(p1) ? p1[1] : (p1.lat !== undefined ? p1.lat : p1.latitude);
                          const l2 = Array.isArray(p2) ? p2[0] : (p2.lng !== undefined ? p2.lng : p2.longitude);
                          const a2 = Array.isArray(p2) ? p2[1] : (p2.lat !== undefined ? p2.lat : p2.latitude);
                          window.cumDist.push(window.cumDist[i-1] + getDist(a1, l1, a2, l2));
                      }
                  }
                  
                  const carOffset = window.cumDist[closestIdx];
                  
                  // Find instructions that are strictly AHEAD of the car (tolerance of 15m so we drop them right as we turn)
                  const upcoming = (Array.isArray(window.routeInstructions) ? window.routeInstructions : []).filter(inst => {
                      if (!inst || typeof inst !== 'object') return false;
                      const instOffset = inst.routeOffsetInMeters !== undefined ? inst.routeOffsetInMeters : window.cumDist[inst.pointIndex];
                      return instOffset > carOffset + 15;
                  });
                  const isArrivalInstruction = function(inst) {
                      return typeof inst.maneuver === 'string' && inst.maneuver.toUpperCase().includes('ARRIVE');
                  };
                  const instructionText = function(inst) {
                      let text = typeof inst.message === 'string' ? inst.message.trim() : '';
                      const street = typeof inst.street === 'string' ? inst.street.trim() : '';
                      // Keep provider wording (including unfamiliar maneuvers),
                      // removing only a matching trailing road for its own line.
                      if (street && text.endsWith(street)) text = text.slice(0, -street.length).replace(/\\s+(onto|on|toward|towards)\\s*$/i, '').trim();
                      return text || 'Follow route guidance';
                  };
                  
                  if (upcoming.length > 0) {
                      const nextInst = upcoming[0];
                      const thenInst = upcoming[1];
                      if (isArrivalInstruction(nextInst)) {
                          paintNeutral('Continue to destination', null);
                          return;
                      }
                      
                      navHeader.style.display = 'flex';
                      
                      let distToManeuver = 0;
                      if (nextInst.routeOffsetInMeters !== undefined) {
                          distToManeuver = nextInst.routeOffsetInMeters - carOffset;
                      } else {
                          distToManeuver = window.cumDist[nextInst.pointIndex] - carOffset;
                      }
                      
                      let distVal = "--";
                      let distUnit = "m";
                      if (!isNaN(distToManeuver) && distToManeuver >= 0) {
                          if (distToManeuver >= 1000) {
                              distVal = (distToManeuver / 1000).toFixed(1);
                              distUnit = "km";
                          } else {
                              // Exact meters (no more arbitrary 10m rounding!)
                              distVal = Math.round(distToManeuver);
                              distUnit = "m";
                          }
                      }
                      
                      document.getElementById('navDistVal').innerText = distVal;
                      document.getElementById('navDistUnit').innerText = distUnit;
                      
                      document.getElementById('navAction').innerText = instructionText(nextInst);
                      document.getElementById('navStreet').innerText = typeof nextInst.street === 'string' ? nextInst.street : '';
                      document.getElementById('navIcon').innerHTML = window.getManeuverIcon(nextInst.maneuver);
                      
                      const thenBanner = document.getElementById('navThenBanner');
                      if (thenInst && !isArrivalInstruction(thenInst)) {
                          thenBanner.style.display = 'inline-flex';
                          document.getElementById('navThenIcon').innerHTML = window.getManeuverIcon(thenInst.maneuver);
                          document.getElementById('navThenText').innerText = instructionText(thenInst);
                      } else {
                          thenBanner.style.display = 'none';
                      }
                  } else {
                      paintNeutral(window.routeInstructions && window.routeInstructions.length ? 'Continue to destination' : 'Directions unavailable', null);
                  }
                  if (window.__reportNavigationLayout) window.__reportNavigationLayout();
              };

              async function initMap() {
                  let originLat = ${serializeInlineScriptValue(safeOriginLat)};
                  let originLng = ${serializeInlineScriptValue(safeOriginLng)};
                  let destLat = ${serializeInlineScriptValue(safeDestinationLat)};
                  let destLng = ${serializeInlineScriptValue(safeDestinationLng)};
                  
                  const originAddr = ${originAddressJs};
                  const destAddr = ${destinationAddressJs};

                  if (!${safeShowCarIcon} && originLat === null && originAddr) {
                      try {
                          const res = await tt.services.fuzzySearch({ key: ${tomtomKeyJs}, query: originAddr, countrySet: 'PH' });
                          if (res.results && res.results.length > 0) {
                              originLng = res.results[0].position.lng;
                              originLat = res.results[0].position.lat;
                          }
                      } catch(e) {}
                  }

                  if (!${safeShowCarIcon} && destLat === null && destAddr) {
                      try {
                          const res = await tt.services.fuzzySearch({ key: ${tomtomKeyJs}, query: destAddr, countrySet: 'PH' });
                          if (res.results && res.results.length > 0) {
                              destLng = res.results[0].position.lng;
                              destLat = res.results[0].position.lat;
                          }
                      } catch(e) {}
                  }

                  const hasCoordinate = (value, min, max) => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
                  const hasOrigin = hasCoordinate(originLat, -90, 90) && hasCoordinate(originLng, -180, 180);
                  const hasDestination = hasCoordinate(destLat, -90, 90) && hasCoordinate(destLng, -180, 180);
                  if (!hasOrigin) {
                      originLat = null;
                      originLng = null;
                  } else {
                      originLat = Number(originLat);
                      originLng = Number(originLng);
                  }
                  if (!hasDestination) {
                      destLat = null;
                      destLng = null;
                  } else {
                      destLat = Number(destLat);
                      destLng = Number(destLng);
                  }
                  const centerLat = hasOrigin ? Number(originLat) : hasDestination ? Number(destLat) : 14.6;
                  const centerLng = hasOrigin ? Number(originLng) : hasDestination ? Number(destLng) : 121.0;
                  
                  // Store globally for rerouting
                  window.currentDestLat = hasDestination ? Number(destLat) : null;
                  window.currentDestLng = hasDestination ? Number(destLng) : null;
                  window.currentCarLat = hasOrigin ? Number(originLat) : null;
                  window.currentCarLng = hasOrigin ? Number(originLng) : null;
                  const bootstrapObservedAt = ${serializeInlineScriptValue(safeObservedAt)};
                  window.currentFixObservedAt = typeof bootstrapObservedAt === 'number' && Number.isFinite(bootstrapObservedAt) && bootstrapObservedAt > 0 && bootstrapObservedAt <= Date.now() + 30000 ? bootstrapObservedAt : null;

                  const map = tt.map({
                      key: ${tomtomKeyJs},
                      container: 'map',
                      center: [centerLng, centerLat],
                      zoom: ${safeRadarMode ? (safeRadarRadiusKm <= 1 ? 15.5 : safeRadarRadiusKm <= 3 ? 14.2 : 13.2) : 12}, // Zoom level adapted for radar or full route
                      pitch: 0, // Start flat for the full route overview
                      dragPan: ${safeScrollEnabled},
                      scrollZoom: ${safeScrollEnabled},
                      stylesVisibility: {
                          trafficIncidents: false,
                          trafficFlow: false
                      }
                  });
                  window.ttMap = map;
                  map.on('error', function() {
                      if (!window.__mapLoaded) window.__reportMapError('MAP_LOAD_FAILED');
                  });
                  window.applyFleetMapTheme = function(forceDark) {
                        const isDark = forceDark !== undefined ? forceDark : ${scheme === 'dark'};
                        document.body.className = isDark ? 'scheme-dark' : 'scheme-light';
                        const bgCol = isDark ? '${palettes.dark.background}' : '${palettes.light.background}';
                        const waterCol = isDark ? '${palettes.dark.surfaceVariant}' : ${safeRadarMode} ? '#CBE4EA' : '${palettes.light.surfaceVariant}';
                        const parkCol = isDark ? '${palettes.dark.surfaceContainerLow}' : ${safeRadarMode} ? '#DFEADF' : '${palettes.light.surfaceContainerLow}';
                        const bldgCol = isDark ? '${palettes.dark.surfaceContainerHigh}' : '${palettes.light.surfaceContainerHigh}';
                        const roadCol = isDark ? '${palettes.dark.surfaceBright}' : '${palettes.light.surfaceBright}';
                        const textCol = isDark ? '${palettes.dark.onSurface}' : ${safeRadarMode} ? '#788982' : '${palettes.light.onSurface}';
                        const haloCol = isDark ? '${palettes.dark.surface}' : '${palettes.light.surface}';

                        const layers = map.getStyle().layers || [];
                        layers.forEach(layer => {
                            const id = layer.id.toLowerCase();
                            try {
                                if (layer.type === 'background') {
                                    map.setPaintProperty(layer.id, 'background-color', bgCol);
                                } else if (layer.type === 'fill') {
                                    const fill = id.includes('water')
                                        ? waterCol
                                        : (id.includes('park') || id.includes('forest') || id.includes('landcover') || id.includes('green'))
                                            ? parkCol
                                            : id.includes('building')
                                                ? bldgCol
                                                : parkCol;
                                    map.setPaintProperty(layer.id, 'fill-color', fill);
                                } else if (layer.type === 'line') {
                                    if (id.includes('road') || id.includes('street') || id.includes('highway') || id.includes('bridge') || id.includes('path')) {
                                        map.setPaintProperty(layer.id, 'line-color', roadCol);
                                    }
                                } else if (layer.type === 'symbol') {
                                    if (${safeRadarMode} && /poi|transit|shield/.test(id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
                                    map.setPaintProperty(layer.id, 'text-color', textCol);
                                    map.setPaintProperty(layer.id, 'text-halo-color', haloCol);
                                    map.setPaintProperty(layer.id, 'text-halo-width', 1.25);
                                }
                            } catch(e) {}
                        });
                    };
                    
                    map.on('dragstart', () => {
                        document.body.classList.add('map-interacting');
                        if (window.swoopTimeout) clearTimeout(window.swoopTimeout);
                        window.isFollowing = false;
                        window.__cameraMode = 'manual';
                        if (window.ReactNativeWebView) {
                            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_DRAGGED' }));
                        }
                        if (${safeShowCarIcon} && !${safeRadarMode}) {
                            document.getElementById('recenterBtn').style.display = 'flex';
                        }
                    });
                    map.on('dragend', () => {
                        document.body.classList.remove('map-interacting');
                    });
                    let rotateRaf = null;
                    map.on('rotate', () => {
                        if (!rotateRaf) {
                            rotateRaf = requestAnimationFrame(() => {
                                rotateRaf = null;
                                if (window.updateCarRotation) window.updateCarRotation();
                            });
                        }
                    });
                    let zoomRaf = null;
                    map.on('zoom', () => {
                        if (!zoomRaf) {
                            zoomRaf = requestAnimationFrame(() => {
                                zoomRaf = null;
                                if (window.updateRadarBloomScale) window.updateRadarBloomScale();
                            });
                        }
                    });

                    if (${safeShowCarIcon}) {
                        map.setBearing(${safeOriginHeading ?? 0});
                        if (destLat !== null && destLng !== null && originLat !== null && originLng !== null) {
                            document.getElementById('navHeader').style.display = 'flex';
                            document.getElementById('navAction').innerText = "Calculating directions";
                        } else {
                            document.getElementById('navHeader').style.display = 'none';
                        }
                        document.getElementById('overviewBtn').style.display = ${safeRadarMode} ? 'none' : 'flex';
                    }

                    map.on('load', () => {
                        window.__mapLoaded = true;
                        // MAP_READY first: a theme failure must never strand the
                        // native loading overlay on globe.json forever.
                        if (window.ReactNativeWebView) {
                            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_READY' }));
                        }
                        try {
                            if (window.__ensureFleetSources) window.__ensureFleetSources();
                        } catch (e) {}
                        try {
                            window.applyFleetMapTheme();
                        } catch (e) {}
                        try {
                            if (typeof ResizeObserver !== 'undefined') {
                                window.__navigationObserver = new ResizeObserver(window.__reportNavigationLayout);
                                window.__navigationObserver.observe(document.getElementById('navHeader'));
                            }
                            window.addEventListener('resize', function() {
                                window.__reportNavigationLayout();
                                window.__applyViewportCamera();
                            });
                            window.__reportNavigationLayout();
                        } catch (e) {}

                        if (${safeRadarMode} && hasOrigin) {
                            window.renderRadarMarkers(${radarMarkersJs}, ${radarRadiusJs});
                        }

                        // Do not invent a driver marker when the trip has no
                        // valid origin/GPS coordinate.
                        if (!hasOrigin) return;

                        // Origin Marker (carlive.png: 60x60 canvas, ~51px visible car, centered GPS anchor)
                        const originEl = document.createElement('div');
                        if (${safeShowCarIcon} || ${safeRadarMode}) {
                            originEl.className = 'origin-marker-container' + (${safeRadarMode} ? ' radar-origin-mode' : '');
                            originEl.style.width = '60px';
                            originEl.style.height = '60px';
                            originEl.style.display = 'flex';
                            originEl.style.alignItems = 'center';
                            originEl.style.justifyContent = 'center';
                            originEl.style.pointerEvents = 'none';
                            originEl.style.position = 'relative';

                            if (${safeRadarMode}) {
                                const bloomWrap = document.createElement('div');
                                bloomWrap.className = 'radar-pulse-container';
                                bloomWrap.id = 'radarBloomContainer';
                                bloomWrap.innerHTML = '<div class="standby-radar-pulse"></div><div class="standby-radar-pulse standby-radar-pulse-2"></div>';
                                const radiusLabel = document.createElement('span');
                                radiusLabel.className = 'radar-radius-label';
                                radiusLabel.textContent = window.currentRadarKm + ' km radius';
                                originEl.appendChild(radiusLabel);
                                originEl.appendChild(bloomWrap);
                            }

                            const carInner = document.createElement('div');
                            carInner.className = 'origin-marker-car';
                            carInner.id = 'carInnerIcon';
                            if (window.carMarkerImageUrl) {
                                carInner.style.backgroundImage = window.cssUrl(window.carMarkerImageUrl);
                            }
                            originEl.appendChild(carInner);

                            const initHeading = ${safeOriginHeading ?? 0};
                            if (initHeading) {
                                carInner.style.transform = 'rotate(' + initHeading + 'deg)';
                            }
                        } else {
                            originEl.className = 'origin-pin-container';
                            originEl.style.width = '28px';
                            originEl.style.height = '34px';
                            originEl.style.display = 'flex';
                            originEl.style.alignItems = 'center';
                            originEl.style.justifyContent = 'center';
                            originEl.style.cursor = 'pointer';
                            originEl.innerHTML = '<svg width="28" height="34" viewBox="0 0 24 30" fill="none"><path d="M12 0C5.373 0 0 5.373 0 12c0 8.5 12 18 12 18s12-9.5 12-18c0-6.627-5.373-12-12-12z" fill=' + ${primaryColorJs} + '/><circle cx="12" cy="11" r="4.5" fill=' + ${surfaceColorJs} + '/></svg>';
                        }

                        const originPopup = new tt.Popup({ offset: [0, -32], closeButton: false }).setHTML(${pickupPopupJs});
                        window.originMarker = new tt.Marker({ element: originEl, anchor: ${safeShowCarIcon || safeRadarMode ? "'center'" : "'bottom'"} })
                            .setLngLat([originLng, originLat])
                            ${!safeShowCarIcon && !safeRadarMode ? '.setPopup(originPopup)' : ''}
                            .addTo(map);

                        // Seed the driver GeoJSON layer with the initial fix
                        // (and pin the camera baseline) so the first bridge
                        // tick interpolates instead of gliding from nowhere.
                        try {
                            if (window.__ensureFleetSources) window.__ensureFleetSources();
                            window.__fleetRendered = { lng: originLng, lat: originLat };
                            window.__lastCamLng = originLng;
                            window.__lastCamLat = originLat;
                            if (window.ttMap && window.ttMap.getSource('driver-source')) {
                                window.ttMap.getSource('driver-source').setData(window.__fleetPoint(originLng, originLat));
                            }
                        } catch (e) {}

                        if (${safeRadarMode}) window.recenterRadar();

                        if (!${safeShowVehicleMarker}) {
                            originEl.style.display = 'none';
                        }

                      // Destination Marker
                      const hasValidDest = hasDestination && (originLat !== destLat || originLng !== destLng);
                      if (!hasValidDest) return;

                      const destEl = document.createElement('div');
                      destEl.className = 'dest-pin-container';
                      destEl.style.width = '28px';
                      destEl.style.height = '34px';
                      destEl.style.display = 'flex';
                      destEl.style.alignItems = 'center';
                      destEl.style.justifyContent = 'center';
                      destEl.style.cursor = 'pointer';
                      destEl.innerHTML = '<svg width="28" height="34" viewBox="0 0 24 30" fill="none"><path d="M12 0C5.373 0 0 5.373 0 12c0 8.5 12 18 12 18s12-9.5 12-18c0-6.627-5.373-12-12-12z" fill=' + ${secondaryColorJs} + '/><circle cx="12" cy="11" r="4.5" fill=' + ${surfaceColorJs} + '/></svg>';
                      
                      const destPopup = new tt.Popup({ offset: [0, -32], closeButton: false }).setHTML(${dropoffPopupJs});
                      window.destMarker = new tt.Marker({ element: destEl, anchor: 'bottom' })
                          .setLngLat([destLng, destLat])
                          .setPopup(destPopup)
                          .addTo(map);

                      // Fit map to show both markers even before route resolves
                      const initialBounds = new tt.LngLatBounds();
                      initialBounds.extend([originLng, originLat]);
                      initialBounds.extend([destLng, destLat]);
                      map.fitBounds(initialBounds, { padding: window.__cameraPadding(), duration: 400 });

                      // Initial and refreshed routes share one provider controller.
                          window.buildTrafficSegments = (feature, route, isAltRoute) => {
                              const coords = feature.geometry.coordinates;
                              const props = feature.properties || {};
                              // Sections/summary are documented on routes[n]; the geojson
                              // properties copy is kept only as a fallback.
                              const secs = (route && route.sections && route.sections.length) ? route.sections : (props.sections || []);
                              const summary = (route && route.summary) || props.summary || {};
                              const features = [];

                              if (${safeAutoSwoop} && secs.length > 0) {
                                  // Prefer the per-section delay when the SDK
                                  // exposes it (delayInSeconds on the traffic
                                  // section); otherwise fall back to splitting
                                  // the route-level total by segment length so
                                  // badges add up — clearly marked as estimates.
                                  const totalDelay = summary.trafficDelayInSeconds || 0;
                                  const trafficSecs = secs.filter(s => s.sectionType === 'TRAFFIC');
                                  const havMeters = function(lat1, lon1, lat2, lon2) {
                                      const R = 6371e3;
                                      const p1 = lat1 * Math.PI / 180;
                                      const p2 = lat2 * Math.PI / 180;
                                      const dp = (lat2 - lat1) * Math.PI / 180;
                                      const dl = (lon2 - lon1) * Math.PI / 180;
                                      const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
                                      return 2 * R * Math.asin(Math.sqrt(a));
                                  };
                                  const weights = trafficSecs.map(sec => {
                                      let w = 0;
                                      for (let i = sec.startPointIndex + 1; i <= sec.endPointIndex && i < coords.length; i++) {
                                          w += havMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
                                      }
                                      return w;
                                  });
                                  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;

                                  let lastIndex = 0;
                                  let t = 0;
                                  secs.forEach(sec => {
                                      if (sec.sectionType === 'TRAFFIC') {
                                          if (sec.startPointIndex > lastIndex) {
                                              const normalSegment = coords.slice(lastIndex, sec.startPointIndex + 1);
                                              if (normalSegment.length >= 2) {
                                                  features.push({ type: 'Feature', properties: { color: ${primaryColorJs} }, geometry: { type: 'LineString', coordinates: normalSegment } });
                                              }
                                          }

                                          // magnitudeOfDelay: 0 unknown, 1 minor, 2 moderate,
                                          // 3 serious, 4 undefined (used for road closure).
                                          // TomTom category is ROAD_CLOSURE (accept the
                                          // legacy ROAD_CLOSED string defensively).
                                          let color = ${secondaryColorJs};
                                          let badgeClass = 'on-route-badge yellow';
                                          if ((sec.magnitudeOfDelay || 0) >= 3 || sec.simpleCategory === 'ROAD_CLOSURE' || sec.simpleCategory === 'ROAD_CLOSED') {
                                              color = ${errorColorJs};
                                              badgeClass = 'on-route-badge';
                                          }

                                          const trafficSegment = coords.slice(sec.startPointIndex, sec.endPointIndex + 1);
                                          if (trafficSegment.length >= 2) {
                                              features.push({ type: 'Feature', properties: { color: color }, geometry: { type: 'LineString', coordinates: trafficSegment } });
                                          }

                                          // Only put text badges on the main route, not the alternative.
                                          // Exact per-section delay when present; "~" marks the
                                          // length-weighted fallback estimate.
                                          if (!isAltRoute && totalDelay > 0 && trafficSegment.length >= 2) {
                                              const secExact = Number(sec.delayInSeconds);
                                              const hasExact = Number.isFinite(secExact) && secExact > 0;
                                              const delaySec = hasExact ? secExact : (totalDelay * (weights[t] || 0) / totalWeight);
                                              const delayMin = Math.ceil(delaySec / 60);
                                              if (delayMin >= 2) {
                                                  const midIndex = Math.floor(trafficSegment.length / 2);
                                                  const badgeEl = document.createElement('div');
                                                  badgeEl.className = badgeClass;
                                                  badgeEl.innerHTML = hasExact ? ('🚗 +' + delayMin + ' min') : ('🚗 ~' + delayMin + ' min');
                                                  const badgeMarker = new tt.Marker({ element: badgeEl, anchor: 'center' }).setLngLat(trafficSegment[midIndex]).addTo(map);
                                                  // Tracked so a recalculation can remove stale badges.
                                                  (window.badgeMarkers = window.badgeMarkers || []).push(badgeMarker);
                                              }
                                          }
                                          t++;
                                          lastIndex = sec.endPointIndex;
                                      }
                                  });
                                  if (lastIndex < coords.length - 1) {
                                      const rem = coords.slice(lastIndex, coords.length);
                                      if (rem.length >= 2) features.push({ type: 'Feature', properties: { color: ${primaryColorJs} }, geometry: { type: 'LineString', coordinates: rem } });
                                  }
                              } else {
                                  features.push({ type: 'Feature', properties: { color: ${primaryColorJs} }, geometry: { type: 'LineString', coordinates: coords } });
                              }
                              return { type: 'FeatureCollection', features: features };
                          };

                      const initialObservedAt = window.currentFixObservedAt;
                      const initialFixFresh = typeof initialObservedAt === 'number' && Number.isFinite(initialObservedAt) && initialObservedAt <= Date.now() + 30000 && Date.now() - initialObservedAt <= 90000;
                      if (window.__mapActive && (!${safeShowCarIcon} || initialFixFresh)) window.recalculateRoute(window.currentCarLng, window.currentCarLat).then(function (ok) {
                          if (!ok) return;
                          var bounds = new tt.LngLatBounds();
                          window.routeCoords.forEach(function (coord) { bounds.extend(coord); });
                          // A late provider response must not reclaim a camera
                          // the driver moved while the route was loading.
                          if (window.__cameraMode !== 'manual') map.fitBounds(bounds, { padding: window.__cameraPadding(), duration: 1200 });
                          if (window.fleetRouteConfig.traffic) window.swoopTimeout = setTimeout(function () {
                              if (window.isFollowing) map.flyTo({ center: [window.currentCarLng, window.currentCarLat], zoom: 18.5, pitch: 0, padding: window.__cameraPadding(), speed: 0.8 });
                          }, 5000);
                      });
                      else window.__refreshOnNextFix = true;

                      // Periodic refresh: a route calculated once at load goes
                      // stale (traffic, ETA) over a long trip. Re-request it
                      // every 2 minutes while the car is actually moving — and
                      // at least every ~4 minutes even when barely moving, so
                      // sitting in congestion still refreshes the traffic ETA
                      // (movement-only refresh would starve exactly when the
                      // driver most needs a new estimate).
                      window.__refreshRouteIfNeeded = function() {
                          if (!window.__mapActive || window.currentCarLng == null || window.currentDestLng == null || window.isRecalculating) return false;
                          if (window.__locationFresh === false) return false;
                          const observedAt = window.currentFixObservedAt;
                          if (typeof observedAt !== 'number' || !Number.isFinite(observedAt) || observedAt > Date.now() + 30000 || Date.now() - observedAt > 90000) return false;
                          var routeAgeMs = window.lastRouteAt ? (Date.now() - window.lastRouteAt) : Infinity;
                          if (window.lastCalcCarLng != null) {
                              const moved = Math.abs(window.currentCarLng - window.lastCalcCarLng) + Math.abs(window.currentCarLat - window.lastCalcCarLat);
                              // ~20m: parked, nothing new to calculate — unless
                              // the last traffic route is getting old.
                              if (moved < 0.0002 && routeAgeMs < 4 * 60 * 1000) return true;
                          }
                          window.recalculateRoute(window.currentCarLng, window.currentCarLat);
                          return true;
                      };
                      setInterval(window.__refreshRouteIfNeeded, 120000);
                  });
              }

              initMap().catch(function() { window.__reportMapError('INITIALIZATION_FAILED'); });
          </script>
      </body>
      </html>
    `;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    colors,
    scheme,
    safeRadarMode,
    hasOriginFix,
    // Live fixes move through the bridge without replacing the map document.
    documentOriginLat,
    documentOriginLng,
    documentOriginHeading,
    safeDestinationLat,
    safeDestinationLng,
    originAddressJs,
    destinationAddressJs,
    tomtomKeyJs,
    radarMarkersJs,
    radarRadiusJs,
    dropoffLabel,
    pickupLabel,
    safeScrollEnabled,
    safeShowCarIcon,
    safeAutoSwoop,
    routeSessionKey,
    routeTripId,
  ]);
  // Live GPS crosses the bridge throttled (<=1 inject per 1500 ms) through
  // window.__updateFleetPositions — snapping, banner, rotation, GeoJSON
  // interpolation and camera follow all happen inside the WebView, so the
  // native side sends four numbers and never rebuilds the map document.
  useEffect(() => {
    // Only the live map (showCarIcon = true) streams fixes; static pins keep
    // their document-baked coordinates.
    if (!safeShowCarIcon || safeOriginLat == null || safeOriginLng == null) return;
    pushFleetPosition(safeOriginLat, safeOriginLng, safeOriginHeading, safeRespondersJson, false, safeObservedAt);
  }, [safeOriginLat, safeOriginLng, safeOriginHeading, safeRespondersJson, safeShowCarIcon, safeObservedAt, pushFleetPosition]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        // Keep every navigation inside the refusal callback; a narrow whitelist
        // makes this WebView adapter open rejected URLs in external apps.
        originWhitelist={["*"]}
        source={{ html: htmlContent, baseUrl: 'about:blank' }}
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        style={styles.map}
        bounces={false}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        androidHardwareAccelerationDisabled={false}
        androidLayerType="hardware"
        javaScriptEnabled={true}
        overScrollMode="never"
        onLoadStart={() => {
          isMapReadyRef.current = false;
          mapErrorRef.current = false;
          onMapLoading?.();
        }}
        onError={() => reportMapError('WEBVIEW_LOAD_FAILED')}
        onHttpError={() => {
          if (!isMapReadyRef.current) reportMapError('WEBVIEW_HTTP_FAILED');
        }}
        onRenderProcessGone={() => reportMapError('WEBVIEW_PROCESS_TERMINATED')}
        onContentProcessDidTerminate={() => reportMapError('WEBVIEW_PROCESS_TERMINATED')}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if ((data.type === 'ROUTE_CALCULATED' || data.type === 'ROUTE_UNAVAILABLE' || data.type === 'ROUTE_REFRESHING') && onRouteData) {
              onRouteData(data);
            }
            // MAP_READY must fire even when the caller passes no onRouteData
            // (the idle map) — otherwise the loading overlay never lifts.
            // It also opens the throttled fleet bridge: fixes that arrived
            // before the document finished loading are replayed once here
            // instead of being silently dropped.
            if (data.type === 'MAP_READY') {
              isMapReadyRef.current = true;
              mapErrorRef.current = false;
              webViewRef.current?.injectJavaScript(buildMapActiveJs(mapActiveRef.current));
              webViewRef.current?.injectJavaScript(latestLayoutBridgeRef.current);
              if (cachedMapFontsCss) webViewRef.current?.injectJavaScript(`if(window.__setMapFonts) window.__setMapFonts(${serializeInlineScriptValue(cachedMapFontsCss)}); true;`);
              webViewRef.current?.injectJavaScript(`if(window.__setLocationFresh) window.__setLocationFresh(${serializeInlineScriptValue(locationFresh === true)}); true;`);
              const activeCar = cachedCarImage || carImage;
              if (activeCar && webViewRef.current) {
                webViewRef.current.injectJavaScript(`if(window.setCarMarkerImage) window.setCarMarkerImage(${serializeInlineScriptValue(activeCar)}); true;`);
              }
              const latest = latestFleetRef.current;
              if (latest.lat != null && latest.lng != null) {
                lastBridgePushRef.current = 0;
                pushFleetPosition(latest.lat, latest.lng, latest.heading, latest.respondersJson, true, latest.observedAt);
              }
              if (onMapReady) onMapReady();
            }
            if (data.type === 'MAP_ERROR') reportMapError(data.reason);
            if (data.type === 'NAVIGATION_LAYOUT' && typeof data.height === 'number' && Number.isFinite(data.height) && data.height >= 0 && data.height <= 10000) {
              onNavigationLayout?.({ height: data.height });
            }
            if (data.type === 'MARKER_TAPPED' && onMarkerPress) {
              onMarkerPress(data.marker);
            }
            if (data.type === 'MAP_DRAGGED' && onMapDragged) {
              onMapDragged();
            }
          } catch(e){}
        }}
      />
    </View>
  );
});

TomTomMap.displayName = "TomTomMap";

export default React.memo(TomTomMap);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
