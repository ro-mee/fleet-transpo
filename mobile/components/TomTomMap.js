import React, { useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../lib/theme-context';

const TomTomMap = forwardRef(({ 
  origin, 
  destination,
  originAddress,
  destAddress,
  style, 
  scrollEnabled = true,
  pickupLabel = "Pickup",
  dropoffLabel = "Destination",
  showCarIcon = false,
  autoSwoop = false,
  onRouteData
}, ref) => {
  const webViewRef = useRef(null);
  const { colors, scheme } = useTheme();

  useImperativeHandle(ref, () => ({
    recenter: () => webViewRef.current?.injectJavaScript(`if(window.recenterMap) window.recenterMap(); true;`),
    overview: () => webViewRef.current?.injectJavaScript(`if(window.showOverview) window.showOverview(); true;`)
  }));
  const tomtomKey = process.env.EXPO_PUBLIC_TOMTOM_API_KEY || "Eovwxfb6mUlNub48iBOiYpuQBZZWQHne";

  const safeOriginAddr = (originAddress || "").replace(/'/g, "\\'");
  const safeDestAddr = (destAddress || "").replace(/'/g, "\\'");

  const htmlContent = useMemo(() => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
          <link rel="stylesheet" type="text/css" href="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css" />
          <script src="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js"></script>
          <script src="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/services/services-web.min.js"></script>
          <style>
              :root { color-scheme: ${scheme}; }
              * { box-sizing: border-box; }
              body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: ${colors.background}; }
              #map { height: 100vh; width: 100vw; }
              
              .tt-popup-content { padding: 9px 12px; border-radius: 12px; box-shadow: 0 8px 24px rgba(22,37,31,0.16); border: none; background: ${colors.surface}; }
              .tt-popup-panel { background: ${colors.surface}; }
              .popup-title { font-family: system-ui, sans-serif; font-size: 13px; font-weight: 700; color: ${colors.onSurface}; margin: 0; }
              
              .origin-marker-car { 
                  width: 36px; 
                  height: 72px; 
                  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 128"><defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="%23475569"/><stop offset="50%" stop-color="%23cbd5e1"/><stop offset="100%" stop-color="%23475569"/></linearGradient><linearGradient id="glass" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="%230f172a"/><stop offset="100%" stop-color="%231e293b"/></linearGradient></defs><rect x="4" y="24" width="8" height="20" rx="3" fill="%23000"/><rect x="52" y="24" width="8" height="20" rx="3" fill="%23000"/><rect x="4" y="84" width="8" height="20" rx="3" fill="%23000"/><rect x="52" y="84" width="8" height="20" rx="3" fill="%23000"/><rect x="8" y="8" width="48" height="112" rx="16" fill="url(%23grad)"/><path d="M 14 40 L 50 40 L 46 90 L 18 90 Z" fill="%2394a3b8"/><path d="M 12 40 Q 32 28 52 40 L 50 48 L 14 48 Z" fill="url(%23glass)"/><path d="M 16 90 Q 32 100 48 90 L 46 84 L 18 84 Z" fill="url(%23glass)"/><path d="M 12 8 Q 16 6 20 8 L 20 12 L 12 12 Z" fill="%23fcd34d"/><path d="M 52 8 Q 48 6 44 8 L 44 12 L 52 12 Z" fill="%23fcd34d"/><rect x="12" y="116" width="14" height="4" rx="2" fill="%23ef4444"/><rect x="38" y="116" width="14" height="4" rx="2" fill="%23ef4444"/></svg>'); 
                  background-size: contain; 
                  background-repeat: no-repeat; 
                  background-position: center; 
                  filter: drop-shadow(0 6px 10px rgba(0,0,0,0.4)); 
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

              .nav-header { position: absolute; top: 36px; left: 16px; right: 16px; display: none; flex-direction: column; align-items: center; z-index: 1000; font-family: system-ui, sans-serif; pointer-events: none; }
              
              .nav-main-banner { 
                  background: ${colors.inverseSurface};
                  border-radius: 16px;
                  padding: 8px 18px 8px 8px;
                  display: flex; 
                  align-items: center; 
                  color: ${colors.inverseOnSurface};
                  box-shadow: 0 12px 32px rgba(22,37,31,0.24);
                  position: relative; 
                  max-width: 400px;
                  width: 100%;
              }
              
              .nav-icon-wrapper { 
                  width: 56px; 
                  height: 56px; 
                  border-radius: 12px;
                  background: ${colors.secondary};
                  display: flex; 
                  align-items: center; 
                  justify-content: center; 
                  flex-shrink: 0; 
                  position: relative;
              }
              
              .nav-icon { width: 26px; height: 26px; fill: ${colors.onSecondary}; }
              
              .nav-info { margin-left: 18px; flex-grow: 1; display: flex; flex-direction: column; justify-content: center; padding-right: 8px; }
              
              .nav-dist-row { display: flex; align-items: baseline; gap: 4px; margin-bottom: 2px; }
              .nav-dist { font-size: 28px; font-weight: 800; color: ${colors.inverseOnSurface}; }
              .nav-dist-unit { font-size: 13px; font-weight: 700; color: ${colors.inversePrimary}; text-transform: uppercase; letter-spacing: 0; }
              
              .nav-street { font-size: 16px; font-weight: 650; color: ${colors.inverseOnSurface}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
              
              .nav-then-badge { 
                  background: ${colors.secondaryContainer};
                  border-radius: 12px;
                  padding: 6px 18px; 
                  display: inline-flex; 
                  align-items: center; 
                  color: ${colors.onSecondaryContainer};
                  position: relative;
                  margin-top: 8px;
                  font-weight: 700; 
                  font-size: 12px; 
                  box-shadow: 0 6px 16px rgba(22,37,31,0.14);
                  letter-spacing: 0;
                  text-transform: uppercase;
              }
              .nav-then-icon { width: 14px; height: 14px; margin-left: 8px; fill: ${colors.onSecondaryContainer}; }

              /* Map Controls (Hidden in favor of Native controls) */
              .overview-btn { display: none !important; }
              .recenter-btn { display: none !important; }
              
              /* Car Customizer Modal */
              .car-customizer-overlay { position: absolute; inset: 0; background: rgba(17,24,22,0.58); display: flex; align-items: flex-end; justify-content: center; z-index: 2000; padding: 16px; }
              .car-customizer-modal { background: ${colors.surface}; padding: 24px; border-radius: 16px; width: 100%; max-width: 360px; box-shadow: 0 16px 40px rgba(22,37,31,0.24); font-family: system-ui, sans-serif; }
              .car-customizer-modal h3 { margin: 0 0 6px 0; font-size: 20px; color: ${colors.onSurface}; text-align: left; }
              .car-customizer-modal label { font-size: 13px; font-weight: 600; color: ${colors.onSurfaceVariant}; margin-bottom: 14px; display: block; text-align: left; }
              .color-options { display: flex; gap: 12px; margin-bottom: 24px; justify-content: center; flex-wrap: wrap; }
              .color-swatch { width: 48px; height: 48px; border-radius: 24px; cursor: pointer; box-shadow: 0 3px 10px rgba(22,37,31,0.14); border: 3px solid ${colors.surface}; outline: 1px solid ${colors.outlineVariant}; }
              .color-swatch.active { outline: 3px solid ${colors.secondary}; outline-offset: 2px; }
              .color-swatch:active { transform: scale(0.94); }
              .customizer-close { width: 100%; min-height: 48px; padding: 14px; background: ${colors.primary}; color: ${colors.onPrimary}; border: none; border-radius: 12px; font-size: 15px; font-weight: 700; cursor: pointer; }
          </style>
      </head>
      <body>
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
                      </div>
                      <div id="navStreet" class="nav-street">Calculating...</div>
                  </div>
              </div>
              <div id="navThenBanner" class="nav-then-badge">
                  Next <div id="navThenIcon" class="nav-then-icon"></div>
              </div>
          </div>
          
          <div id="overviewBtn" class="overview-btn" onclick="window.showOverview()" style="display: none;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="6" r="3"/>
                  <path d="M6 15v-1a4 4 0 0 1 4-4h4a4 4 0 0 0 4-4V9"/>
              </svg>
          </div>
          
          <div id="recenterBtn" class="recenter-btn" onclick="window.recenterMap()">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
          </div>

          <div id="etaBox" class="eta-box" style="display: none !important;">
              <div id="etaTime" class="eta-time">ETA: -- min</div>
              <div id="etaDelay" class="eta-delay">⚠️ +-- min traffic</div>
          </div>
          
          <!-- Car Customizer UI -->
          <div id="carCustomizer" class="car-customizer-overlay" style="display: none;">
              <div class="car-customizer-modal">
                  <h3>Customize vehicle</h3>
                  <label>Choose your map marker color</label>
                  <div class="color-options">
                      <div class="color-swatch active" data-color="forest" style="background: ${colors.primary};" onclick="window.setCarColor('forest')"></div>
                      <div class="color-swatch" data-color="brass" style="background: ${colors.secondary};" onclick="window.setCarColor('brass')"></div>
                      <div class="color-swatch" data-color="rust" style="background: ${colors.tertiary};" onclick="window.setCarColor('rust')"></div>
                      <div class="color-swatch" data-color="silver" style="background: #cbd5e1;" onclick="window.setCarColor('silver')"></div>
                      <div class="color-swatch" data-color="black" style="background: #334155;" onclick="window.setCarColor('black')"></div>
                  </div>
                  <button class="customizer-close" onclick="document.getElementById('carCustomizer').style.display = 'none';">Done</button>
              </div>
          </div>

          <script>
              tt.setProductInfo('fleetops', '1.0');
              
              window.originMarker = null;
              window.destMarker = null;
              window.ttMap = null;
              window.isFollowing = true;
              
              window.carColor = 'forest';

              window.generateCarSvg = function(color) {
                  let baseColor, lightColor;
                  switch(color) {
                      case 'forest': baseColor = '%23285448'; lightColor = '%23a9c8b9'; break;
                      case 'brass': baseColor = '%238a632c'; lightColor = '%23d2a765'; break;
                      case 'rust': baseColor = '%239d4f3f'; lightColor = '%23e0a08e'; break;
                      case 'red': baseColor = '%23b91c1c'; lightColor = '%23ef4444'; break;
                      case 'blue': baseColor = '%231d4ed8'; lightColor = '%233b82f6'; break;
                      case 'silver': baseColor = '%23475569'; lightColor = '%23cbd5e1'; break;
                      case 'black': baseColor = '%230f172a'; lightColor = '%23334155'; break;
                      case 'white': baseColor = '%23e2e8f0'; lightColor = '%23ffffff'; break;
                      default: baseColor = '%23475569'; lightColor = '%23cbd5e1';
                  }
                  
                  return \`url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 128"><defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="\${baseColor}"/><stop offset="50%" stop-color="\${lightColor}"/><stop offset="100%" stop-color="\${baseColor}"/></linearGradient><linearGradient id="glass" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="%230f172a"/><stop offset="100%" stop-color="%231e293b"/></linearGradient></defs><rect x="4" y="24" width="8" height="20" rx="3" fill="%23000"/><rect x="52" y="24" width="8" height="20" rx="3" fill="%23000"/><rect x="4" y="84" width="8" height="20" rx="3" fill="%23000"/><rect x="52" y="84" width="8" height="20" rx="3" fill="%23000"/><rect x="8" y="8" width="48" height="112" rx="16" fill="url(%23grad)"/><path d="M 14 40 L 50 40 L 46 90 L 18 90 Z" fill="\${lightColor}"/><path d="M 12 40 Q 32 28 52 40 L 50 48 L 14 48 Z" fill="url(%23glass)"/><path d="M 16 90 Q 32 100 48 90 L 46 84 L 18 84 Z" fill="url(%23glass)"/><path d="M 12 8 Q 16 6 20 8 L 20 12 L 12 12 Z" fill="%23fcd34d"/><path d="M 52 8 Q 48 6 44 8 L 44 12 L 52 12 Z" fill="%23fcd34d"/><rect x="12" y="116" width="14" height="4" rx="2" fill="%23ef4444"/><rect x="38" y="116" width="14" height="4" rx="2" fill="%23ef4444"/></svg>')\`;
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

              window.updateCarIcon = function() {
                  const el = document.getElementById('carInnerIcon');
                  if (el) {
                      el.style.backgroundImage = window.generateCarSvg(window.carColor);
                      el.style.width = '36px';
                  }
              };

              window.setCarColor = function(color) {
                  window.carColor = color;
                  document.querySelectorAll('.color-swatch').forEach(swatch => {
                      swatch.classList.toggle('active', swatch.dataset.color === color);
                  });
                  window.updateCarIcon();
              };
              
              window.showOverview = function() {
                  window.isFollowing = false;
                  document.getElementById('recenterBtn').style.display = 'flex';
                  
                  if (window.routeCoords && window.routeCoords.length > 0) {
                      const bounds = new tt.LngLatBounds();
                      window.routeCoords.forEach(coord => {
                          const lng = Array.isArray(coord) ? coord[0] : (coord.lng !== undefined ? coord.lng : coord.longitude);
                          const lat = Array.isArray(coord) ? coord[1] : (coord.lat !== undefined ? coord.lat : coord.latitude);
                          bounds.extend([lng, lat]);
                      });
                      window.ttMap.fitBounds(bounds, { padding: 50, pitch: 0, bearing: 0, duration: 800 });
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
                  document.getElementById('recenterBtn').style.display = 'none';
                  
                  if (window.currentCarLng && window.currentCarLat) {
                      const routeBearing = window.getRouteBearing(window.currentCarLng, window.currentCarLat);
                      window.ttMap.flyTo({ 
                          center: [window.currentCarLng, window.currentCarLat], 
                          zoom: 18.5, 
                          pitch: 0, 
                          bearing: routeBearing,
                          duration: 800 
                      });
                  }
              };
              
              const icons = {
                  LEFT: '<svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>',
                  RIGHT: '<svg viewBox="0 0 24 24"><path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z"/></svg>',
                  STRAIGHT: '<svg viewBox="0 0 24 24"><path d="M12 4l-7 7h4v9h6v-9h4z"/></svg>',
                  ARRIVE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>'
              };

              window.getManeuverIcon = function(maneuver) {
                  if (!maneuver) return icons.STRAIGHT;
                  if (maneuver.includes('LEFT')) return icons.LEFT;
                  if (maneuver.includes('RIGHT')) return icons.RIGHT;
                  if (maneuver.includes('ARRIVE')) return icons.ARRIVE;
                  return icons.STRAIGHT;
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

                  let minDist = Infinity;
                  let closestIdx = 0;
                  
                  window.lastClosestIdx = window.lastClosestIdx || 0;
                  const searchStart = Math.max(0, window.lastClosestIdx - 5);
                  const searchEnd = Math.min(window.routeCoords.length, window.lastClosestIdx + 150);

                  for (let i = searchStart; i < searchEnd; i++) {
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

              window.updateNavigationBanner = function(carLng, carLat, snapInfo = null) {
                  if (!window.routeInstructions || !window.routeCoords || window.routeCoords.length === 0) return;
                  
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

                  let minDist = snapInfo ? snapInfo.minDist : 0;
                  let closestIdx = snapInfo ? snapInfo.closestIdx : 0;
                  
                  if (!snapInfo) {
                      const fallbackSnap = window.getSnappedPosition(carLng, carLat);
                      minDist = fallbackSnap.minDist;
                      closestIdx = fallbackSnap.closestIdx;
                  }
                  
                  // Auto-Rerouting: If car is > 50m off the route, recalculate!
                  if (minDist > 50 && !window.isRecalculating && window.currentDestLng) {
                      window.isRecalculating = true;
                      document.getElementById('navStreet').innerText = "Rerouting...";
                      
                      tt.services.calculateRoute({
                          key: '${tomtomKey}',
                          traffic: ${autoSwoop},
                          computeTravelTimeFor: 'all',
                          maxAlternatives: 0,
                          sectionType: ${autoSwoop ? "'traffic'" : "undefined"},
                          instructionsType: 'text',
                          locations: carLng + ',' + carLat + ':' + window.currentDestLng + ',' + window.currentDestLat
                      }).then(response => {
                          window.isRecalculating = false;
                          const baseGeojson = response.toGeoJson();
                          if (!baseGeojson || !baseGeojson.features || !baseGeojson.features.length) return;
                          
                          const mainFeature = baseGeojson.features[0];
                          window.routeCoords = mainFeature.geometry.coordinates;
                          window.routeInstructions = response.routes[0].guidance ? response.routes[0].guidance.instructions : [];
                          
                          // Reset cache
                          window.cumDist = null;
                          window.lastClosestIdx = 0;
                          
                          // Redraw the green line instantly without full map reload!
                          const mainGeojson = window.buildTrafficSegments ? window.buildTrafficSegments(mainFeature, false) : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { color: '${colors.primary}' }, geometry: { type: 'LineString', coordinates: window.routeCoords } }] };
                          
                          if (window.ttMap && window.ttMap.getSource('route')) {
                              window.ttMap.getSource('route').setData(mainGeojson);
                          }
                          
                          window.updateNavigationBanner(carLng, carLat);
                      }).catch(e => {
                          window.isRecalculating = false;
                      });
                      return; // Stop updating banner while rerouting
                  }
                  
                  // 2. Precompute exact segment distances for 100% accuracy
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
                  const upcoming = window.routeInstructions.filter(inst => {
                      const instOffset = inst.routeOffsetInMeters !== undefined ? inst.routeOffsetInMeters : window.cumDist[inst.pointIndex];
                      return instOffset > carOffset + 15;
                  });
                  
                  const navHeader = document.getElementById('navHeader');
                  
                  if (upcoming.length > 0) {
                      const nextInst = upcoming[0];
                      const thenInst = upcoming[1];
                      
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
                      
                      let action = nextInst.message || "Continue";
                      if (nextInst.street && !action.includes(nextInst.street)) {
                          action += " onto " + nextInst.street;
                      }
                      document.getElementById('navStreet').innerText = action;
                      document.getElementById('navIcon').innerHTML = window.getManeuverIcon(nextInst.maneuver);
                      
                      const thenBanner = document.getElementById('navThenBanner');
                      if (thenInst) {
                          thenBanner.style.display = 'inline-flex';
                          document.getElementById('navThenIcon').innerHTML = window.getManeuverIcon(thenInst.maneuver);
                      } else {
                          thenBanner.style.display = 'none';
                      }
                  } else {
                      if (minDist < 50) {
                          document.getElementById('navStreet').innerText = "Arrived";
                          document.getElementById('navDistVal').innerText = "";
                          document.getElementById('navDistUnit').innerText = "";
                          document.getElementById('navIcon').innerHTML = window.getManeuverIcon("ARRIVE");
                          document.getElementById('navThenBanner').style.display = 'none';
                          navHeader.style.display = 'flex';
                      } else {
                          navHeader.style.display = 'none';
                      }
                  }
              };

              async function initMap() {
                  let originLat = ${origin?.lat || 'null'};
                  let originLng = ${origin?.lng || 'null'};
                  let destLat = ${destination?.lat || 'null'};
                  let destLng = ${destination?.lng || 'null'};
                  
                  const originAddr = '${safeOriginAddr}';
                  const destAddr = '${safeDestAddr}';

                  if (originLat === null && originAddr) {
                      try {
                          const res = await tt.services.fuzzySearch({ key: '${tomtomKey}', query: originAddr });
                          if (res.results && res.results.length > 0) {
                              originLng = res.results[0].position.lng;
                              originLat = res.results[0].position.lat;
                          }
                      } catch(e) {}
                  }

                  if (destLat === null && destAddr) {
                      try {
                          const res = await tt.services.fuzzySearch({ key: '${tomtomKey}', query: destAddr });
                          if (res.results && res.results.length > 0) {
                              destLng = res.results[0].position.lng;
                              destLat = res.results[0].position.lat;
                          }
                      } catch(e) {}
                  }

                  originLat = originLat || 14.5995;
                  originLng = originLng || 120.9842;
                  destLat = destLat || 14.5995;
                  destLng = destLng || 120.9842;
                  
                  // Store globally for rerouting
                  window.currentDestLat = destLat;
                  window.currentDestLng = destLng;

                  const map = tt.map({
                      key: '${tomtomKey}',
                      container: 'map',
                      center: [originLng, originLat],
                      zoom: 12, // Start zoomed out so the route reveal is smooth
                      pitch: 0, // Start flat for the full route overview
                      dragPan: ${scrollEnabled},
                      scrollZoom: ${scrollEnabled},
                      stylesVisibility: {
                          trafficIncidents: false,
                          trafficFlow: false
                      }
                  });
                  window.ttMap = map;

                  window.applyFleetMapTheme = function() {
                      const layers = map.getStyle().layers || [];
                      layers.forEach(layer => {
                          const id = layer.id.toLowerCase();
                          if (layer.type === 'background') {
                              map.setPaintProperty(layer.id, 'background-color', '${colors.primaryContainer}');
                          } else if (layer.type === 'fill') {
                              const fill = id.includes('water')
                                  ? '${colors.info}'
                                  : id.includes('park') || id.includes('forest') || id.includes('landcover')
                                      ? '${colors.primaryContainer}'
                                      : id.includes('building')
                                          ? '${colors.surfaceContainerHigh}'
                                          : '${colors.surfaceContainerLow}';
                              map.setPaintProperty(layer.id, 'fill-color', fill);
                          } else if (layer.type === 'line' && (id.includes('road') || id.includes('street') || id.includes('highway'))) {
                              map.setPaintProperty(layer.id, 'line-color', '${colors.surfaceBright}');
                          } else if (layer.type === 'symbol') {
                              map.setPaintProperty(layer.id, 'text-color', '${colors.onSurface}');
                              map.setPaintProperty(layer.id, 'text-halo-color', '${colors.surface}');
                              map.setPaintProperty(layer.id, 'text-halo-width', 1.25);
                          }
                      });
                  };
                  
                  map.on('dragstart', () => {
                      if (window.swoopTimeout) clearTimeout(window.swoopTimeout);
                      if (window.isFollowing && ${showCarIcon}) {
                          window.isFollowing = false;
                          document.getElementById('recenterBtn').style.display = 'flex';
                      }
                  });
                  map.on('rotate', () => {
                      if (window.updateCarRotation) window.updateCarRotation();
                  });
                  map.on('zoomstart', (e) => {
                      if (window.swoopTimeout) clearTimeout(window.swoopTimeout);
                      if (e.originalEvent && window.isFollowing && ${showCarIcon}) {
                          window.isFollowing = false;
                          document.getElementById('recenterBtn').style.display = 'flex';
                      }
                  });

                  if (${showCarIcon}) {
                      if (${destination ? 'true' : 'false'}) {
                          document.getElementById('navHeader').style.display = 'flex';
                          document.getElementById('navDistVal').innerText = "---";
                          document.getElementById('navDistUnit').innerText = "";
                          document.getElementById('navStreet').innerText = "Calculating route...";
                      } else {
                          document.getElementById('navHeader').style.display = 'none';
                      }
                      document.getElementById('overviewBtn').style.display = 'flex';
                  }

                  map.on('load', () => {
                      window.applyFleetMapTheme();

                      // Origin Marker
                      const originEl = document.createElement('div');
                      if (${showCarIcon}) {
                          originEl.className = 'origin-marker-container';
                          originEl.style.width = '40px';
                          originEl.style.height = '72px';
                          originEl.style.display = 'flex';
                          originEl.style.alignItems = 'center';
                          originEl.style.justifyContent = 'center';
                          originEl.style.pointerEvents = 'auto';
                          originEl.onclick = function() {
                              document.getElementById('carCustomizer').style.display = 'flex';
                          };
                          
                          const carInner = document.createElement('div');
                          carInner.className = 'origin-marker-car';
                          carInner.id = 'carInnerIcon';
                          originEl.appendChild(carInner);
                          window.updateCarIcon();
                      } else {
                          originEl.className = 'origin-marker-dot';
                          originEl.innerHTML = '<div class="origin-dot-outer"><div class="origin-dot-inner"></div></div><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colors.primary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 10px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
                      }

                      const originPopup = new tt.Popup({ offset: 35, closeButton: false }).setHTML('<h4 class="popup-title">${pickupLabel}</h4>');
                      window.originMarker = new tt.Marker({ element: originEl, anchor: 'center' })
                          .setLngLat([originLng, originLat])
                          ${!showCarIcon ? '.setPopup(originPopup)' : ''}
                          .addTo(map);
                          
                      ${!showCarIcon ? 'originPopup.addTo(map);' : ''}

                      // If no destination is provided, just stop here (Idle mode)
                      if (!${destination ? 'true' : 'false'} || (originLat === destLat && originLng === destLng)) return;

                      // Destination Marker
                      const destEl = document.createElement('div');
                      destEl.className = 'dest-marker';
                      destEl.innerHTML = '<div class="dest-dot-outer"><div class="dest-dot-inner"></div></div><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colors.secondary}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 10px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
                      
                      const destPopup = new tt.Popup({ offset: 35, closeButton: false }).setHTML('<h4 class="popup-title">${dropoffLabel}</h4>');
                      window.destMarker = new tt.Marker({ element: destEl })
                          .setLngLat([destLng, destLat])
                          .setPopup(destPopup)
                          .addTo(map);
                      destPopup.addTo(map);

                      // Request traffic-sectioned routing
                      tt.services.calculateRoute({
                          key: '${tomtomKey}',
                          traffic: ${autoSwoop},
                          computeTravelTimeFor: 'all',
                          maxAlternatives: ${autoSwoop ? 1 : 0},
                          sectionType: ${autoSwoop ? "'traffic'" : "undefined"},
                          instructionsType: 'text',
                          locations: originLng + ',' + originLat + ':' + destLng + ',' + destLat
                      }).then(response => {
                          const baseGeojson = response.toGeoJson();
                          if (!baseGeojson || !baseGeojson.features || !baseGeojson.features.length) return;
                          
                          const mainFeature = baseGeojson.features[0];
                          const mainCoords = mainFeature.geometry.coordinates; // Array of [lng, lat]
                          const mainProps = mainFeature.properties || {};
                          
                          const route = response.routes[0];
                          window.routeInstructions = route.guidance ? route.guidance.instructions : [];
                          window.routeCoords = mainCoords;
                          
                          if (${showCarIcon}) {
                              window.updateNavigationBanner(originLng, originLat);
                          }
                          
                          if (window.ReactNativeWebView && mainProps.summary) {
                              window.ReactNativeWebView.postMessage(JSON.stringify({
                                  type: 'ROUTE_CALCULATED',
                                  travelTimeInSeconds: mainProps.summary.travelTimeInSeconds,
                                  lengthInMeters: mainProps.summary.lengthInMeters,
                                  trafficDelayInSeconds: mainProps.summary.trafficDelayInSeconds
                              }));
                          }
                          
                          // ETA Box logic removed as it's displayed natively
                          // Helper function to dynamically slice a route into colored traffic segments
                          window.buildTrafficSegments = (feature, isAltRoute) => {
                              const coords = feature.geometry.coordinates;
                              const props = feature.properties || {};
                              const features = [];
                              
                              if (${autoSwoop} && props.sections && props.sections.length > 0) {
                                  let lastIndex = 0;
                                  props.sections.forEach(sec => {
                                      if (sec.sectionType === 'TRAFFIC') {
                                          if (sec.startPointIndex > lastIndex) {
                                              const normalSegment = coords.slice(lastIndex, sec.startPointIndex + 1);
                                              if (normalSegment.length >= 2) {
                                                  features.push({ type: 'Feature', properties: { color: '${colors.primary}' }, geometry: { type: 'LineString', coordinates: normalSegment } });
                                              }
                                          }
                                          
                                          let color = '${colors.error}';
                                          let badgeClass = 'on-route-badge';
                                          if (sec.magnitudeOfDelay === 1 || sec.simpleCategory === 'JAM_LIGHT') { color = '${colors.secondary}'; badgeClass += ' yellow'; }
                                          else if (sec.magnitudeOfDelay === 2 || sec.simpleCategory === 'JAM_MODERATE') { color = '${colors.secondary}'; badgeClass += ' yellow'; }
                                          
                                          const trafficSegment = coords.slice(sec.startPointIndex, sec.endPointIndex + 1);
                                          if (trafficSegment.length >= 2) {
                                              features.push({ type: 'Feature', properties: { color: color }, geometry: { type: 'LineString', coordinates: trafficSegment } });
                                          }
                                          
                                          // Only put text badges on the main route, not the alternative
                                          if (!isAltRoute) {
                                              const delayMin = Math.ceil((sec.delayInSeconds || 0) / 60);
                                              if (delayMin > 0 && trafficSegment.length >= 2) {
                                                  const midIndex = Math.floor(trafficSegment.length / 2);
                                                  const badgeEl = document.createElement('div');
                                                  badgeEl.className = badgeClass;
                                                  badgeEl.innerHTML = '🚗 ' + delayMin + ' min';
                                                  new tt.Marker({ element: badgeEl, anchor: 'center' }).setLngLat(trafficSegment[midIndex]).addTo(map);
                                              }
                                          }
                                          lastIndex = sec.endPointIndex;
                                      }
                                  });
                                  if (lastIndex < coords.length - 1) {
                                      const rem = coords.slice(lastIndex, coords.length);
                                      if (rem.length >= 2) features.push({ type: 'Feature', properties: { color: '${colors.primary}' }, geometry: { type: 'LineString', coordinates: rem } });
                                  }
                              } else {
                                  features.push({ type: 'Feature', properties: { color: '${colors.primary}' }, geometry: { type: 'LineString', coordinates: coords } });
                              }
                              return { type: 'FeatureCollection', features: features };
                          };

                          try {
                              // 1. Draw Alternative Route First (so it sits underneath)
                              if (${autoSwoop} && baseGeojson.features.length > 1) {
                                  const altGeojson = window.buildTrafficSegments(baseGeojson.features[1], true);
                                  map.addLayer({
                                      'id': 'alt-route',
                                      'type': 'line',
                                      'source': { 'type': 'geojson', 'data': altGeojson },
                                      'paint': {
                                          'line-color': ['get', 'color'],
                                          'line-width': 6,
                                          'line-opacity': 0.35 // Translucent!
                                      }
                                  });
                              }

                              // 2. Draw Main Route on top
                              const mainGeojson = window.buildTrafficSegments(mainFeature, false);
                              map.addLayer({
                                  'id': 'route',
                                  'type': 'line',
                                  'source': { 'type': 'geojson', 'data': mainGeojson },
                                  'paint': {
                                      'line-color': ['get', 'color'],
                                      'line-width': 6,
                                      'line-opacity': 1.0
                                  }
                              });
                          } catch (err) {
                              console.error("Traffic segmentation failed, falling back to basic route:", err);
                              map.addLayer({
                                  'id': 'route',
                                  'type': 'line',
                                  'source': { 'type': 'geojson', 'data': { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: mainCoords } } },
                                  'paint': { 'line-color': '${colors.primary}', 'line-width': 6 }
                              });
                          }

                          const bounds = new tt.LngLatBounds();
                          coords.forEach(coord => {
                              bounds.extend(tt.LngLat.convert(coord));
                          });
                          
                          // Smoothly fit the entire route on screen
                          map.fitBounds(bounds, { padding: 50, duration: 1200 });
                          
                          if (${autoSwoop}) {
                              // Let the user look at the full route for 5 seconds before swooping in
                              window.swoopTimeout = setTimeout(() => {
                                  if (window.isFollowing) {
                                      map.flyTo({ center: [originLng, originLat], zoom: 18.5, pitch: 0, speed: 0.8 });
                                  }
                              }, 5000);
                          }
                      }).catch((e) => {
                          console.error("Routing error:", e);
                          const bounds = new tt.LngLatBounds();
                          bounds.extend([originLng, originLat]);
                          bounds.extend([destLng, destLat]);
                          map.fitBounds(bounds, { padding: 50, duration: 1200 });
                          
                          if (${autoSwoop}) {
                              window.swoopTimeout = setTimeout(() => {
                                  if (window.isFollowing) {
                                      map.flyTo({ center: [originLng, originLat], zoom: 18.5, pitch: 0, speed: 0.8 });
                                  }
                              }, 5000);
                          }
                      });
                  });
              }

              initMap();
          </script>
      </body>
      </html>
    `;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors, scheme, destAddress, dropoffLabel, pickupLabel, scrollEnabled, showCarIcon, autoSwoop, destination?.lat, destination?.lng]);

  // When GPS 'origin' updates, inject javascript to move the car without reloading the map!
  useEffect(() => {
    // Only track movement if it's the live map (showCarIcon = true)
    if (showCarIcon && origin?.lat && origin?.lng && webViewRef.current) {
      const bearingScript = origin.heading !== undefined && origin.heading !== null && origin.heading >= 0 
          ? `, bearing: ${origin.heading}` 
          : '';
          
      const script = `
        if (window.originMarker) {
          let finalLng = ${origin.lng};
          let finalLat = ${origin.lat};
          
          if (window.getSnappedPosition) {
              const snap = window.getSnappedPosition(finalLng, finalLat);
              finalLng = snap.lng;
              finalLat = snap.lat;
              
              if (${showCarIcon} && window.updateNavigationBanner) {
                  window.updateNavigationBanner(finalLng, finalLat, snap);
              }
          } else if (${showCarIcon} && window.updateNavigationBanner) {
              window.updateNavigationBanner(finalLng, finalLat);
          }

          window.originMarker.setLngLat([finalLng, finalLat]);
          window.currentCarLng = finalLng;
          window.currentCarLat = finalLat;
          window.lastHeading = ${origin.heading !== undefined && origin.heading !== null && origin.heading >= 0 ? origin.heading : 'window.lastHeading'};
          
          if (window.updateCarRotation) window.updateCarRotation();
          
          if (window.ttMap && window.isFollowing) {
             const distToCenter = Math.abs(window.ttMap.getCenter().lng - finalLng) + Math.abs(window.ttMap.getCenter().lat - finalLat);
             if (distToCenter > 0.002) { 
                 const routeBearing = window.getRouteBearing ? window.getRouteBearing(finalLng, finalLat) : (window.lastHeading || 0);
                 window.ttMap.easeTo({ 
                     center: [finalLng, finalLat], 
                     zoom: 18.5,
                     pitch: 0,
                     bearing: routeBearing,
                     duration: 800 
                 });
             }
          }
        }
        
        true;
      `;
      webViewRef.current.injectJavaScript(script);
    }
  }, [origin?.lat, origin?.lng, origin?.heading, showCarIcon]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={{ html: htmlContent }}
        style={styles.map}
        bounces={false}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onMessage={(event) => {
          if (onRouteData) {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data.type === 'ROUTE_CALCULATED') {
                onRouteData(data);
              }
            } catch(e){}
          }
        }}
      />
    </View>
  );
});

export default TomTomMap;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
