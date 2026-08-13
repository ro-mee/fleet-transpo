import React, { useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

export default function TomTomMap({ 
  origin, 
  destination,
  originAddress,
  destAddress,
  style, 
  scrollEnabled = true,
  pickupLabel = "Pickup",
  dropoffLabel = "Destination",
  showCarIcon = false,
  autoSwoop = false
}) {
  const webViewRef = useRef(null);
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
              body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: #f8fafc; }
              #map { height: 100vh; width: 100vw; }
              
              .tt-popup-content { padding: 8px 12px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.15); border: none; }
              .tt-popup-panel { background: white; }
              .popup-title { font-family: sans-serif; font-size: 14px; font-weight: bold; color: #0f172a; margin: 0; }
              
              .origin-marker-car { width: 36px; height: 36px; background-image: url('https://cdn-icons-png.flaticon.com/512/3202/3202926.png'); background-size: cover; background-position: center; drop-shadow: 0 4px 6px rgba(0,0,0,0.3); }
              .origin-marker-dot { align-items: center; justify-content: center; display: flex; flex-direction: column; position: relative; }
              .origin-dot-outer { width: 20px; height: 20px; border-radius: 10px; background: rgba(30, 58, 138, 0.2); display: flex; align-items: center; justify-content: center; position: absolute; top: -14px; }
              .origin-dot-inner { width: 8px; height: 8px; border-radius: 4px; background: #1e3a8a; }

              .dest-marker { align-items: center; justify-content: center; display: flex; flex-direction: column; position: relative; }
              .dest-dot-outer { width: 20px; height: 20px; border-radius: 10px; background: rgba(14, 165, 233, 0.2); display: flex; align-items: center; justify-content: center; position: absolute; top: -14px; }
              .dest-dot-inner { width: 8px; height: 8px; border-radius: 4px; background: #0ea5e9; }

              /* ETA Box Styling */
              .eta-box { position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%); background: white; padding: 12px 24px; border-radius: 30px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); display: none; flex-direction: column; align-items: center; justify-content: center; z-index: 999; font-family: sans-serif; border: 1px solid #e2e8f0; }
              .eta-time { font-size: 18px; font-weight: 800; color: #0f172a; }
              .eta-delay { font-size: 13px; font-weight: 700; color: #ef4444; margin-top: 2px; display: none; }
              
              /* On-Route Delay Badge */
              .on-route-badge { background: #ef4444; color: white; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; font-family: sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,0.3); border: 2px solid white; white-space: nowrap; pointer-events: none; }
              .on-route-badge.yellow { background: #eab308; }
          </style>
      </head>
      <body>
          <div id="map"></div>
          
          <div id="etaBox" class="eta-box">
              <div id="etaTime" class="eta-time">ETA: -- min</div>
              <div id="etaDelay" class="eta-delay">⚠️ +-- min traffic</div>
          </div>

          <script>
              tt.setProductInfo('fleetops', '1.0');
              
              window.originMarker = null;
              window.destMarker = null;
              window.ttMap = null;

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

                  const map = tt.map({
                      key: '${tomtomKey}',
                      container: 'map',
                      center: [originLng, originLat],
                      zoom: 15,
                      pitch: ${autoSwoop ? 45 : 0},
                      dragPan: ${scrollEnabled},
                      scrollZoom: ${scrollEnabled},
                      stylesVisibility: {
                          trafficIncidents: false, // Turn off global traffic to keep background clean
                          trafficFlow: false
                      }
                  });
                  window.ttMap = map;

                  map.on('load', () => {
                      // Origin Marker
                      const originEl = document.createElement('div');
                      if (${showCarIcon}) {
                          originEl.className = 'origin-marker-car';
                      } else {
                          originEl.className = 'origin-marker-dot';
                          originEl.innerHTML = '<div class="origin-dot-outer"><div class="origin-dot-inner"></div></div><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1e3a8a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 10px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
                      }

                      const originPopup = new tt.Popup({ offset: 35, closeButton: false }).setHTML('<h4 class="popup-title">${pickupLabel}</h4>');
                      window.originMarker = new tt.Marker({ element: originEl, anchor: 'center' })
                          .setLngLat([originLng, originLat])
                          ${!showCarIcon ? '.setPopup(originPopup)' : ''}
                          .addTo(map);
                          
                      ${!showCarIcon ? 'originPopup.addTo(map);' : ''}

                      // Destination Marker
                      const destEl = document.createElement('div');
                      destEl.className = 'dest-marker';
                      destEl.innerHTML = '<div class="dest-dot-outer"><div class="dest-dot-inner"></div></div><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 10px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
                      
                      const destPopup = new tt.Popup({ offset: 35, closeButton: false }).setHTML('<h4 class="popup-title">${dropoffLabel}</h4>');
                      window.destMarker = new tt.Marker({ element: destEl })
                          .setLngLat([destLng, destLat])
                          .setPopup(destPopup)
                          .addTo(map);
                      destPopup.addTo(map);

                      if (originLat === destLat && originLng === destLng) return;

                      // Request traffic-sectioned routing
                      tt.services.calculateRoute({
                          key: '${tomtomKey}',
                          traffic: ${autoSwoop},
                          computeTravelTimeFor: 'all',
                          sectionType: ${autoSwoop ? "'traffic'" : "undefined"},
                          locations: originLng + ',' + originLat + ':' + destLng + ',' + destLat
                      }).then(response => {
                          const baseGeojson = response.toGeoJson();
                          if (!baseGeojson || !baseGeojson.features || !baseGeojson.features.length) return;
                          
                          const feature = baseGeojson.features[0];
                          const coords = feature.geometry.coordinates;
                          const props = feature.properties || {};
                          
                          // Display Total ETA Badge
                          if (${autoSwoop} && props.summary) {
                              const travelTimeMin = Math.ceil((props.summary.travelTimeInSeconds || 0) / 60);
                              const delayMin = Math.ceil((props.summary.trafficDelayInSeconds || 0) / 60);
                              
                              const etaBox = document.getElementById('etaBox');
                              const etaTime = document.getElementById('etaTime');
                              const etaDelay = document.getElementById('etaDelay');
                              
                              etaBox.style.display = 'flex';
                              etaTime.innerText = travelTimeMin + " min";
                              
                              if (delayMin > 0) {
                                  etaDelay.style.display = 'block';
                                  etaDelay.innerText = '⚠️ +' + delayMin + ' min traffic';
                              } else {
                                  etaDelay.style.display = 'none';
                              }
                          }

                          try {
                              const features = [];
                              // Slice route into colored segments based on traffic severity
                              if (${autoSwoop} && props.sections && props.sections.length > 0) {
                                  let lastIndex = 0;
                                  props.sections.forEach(sec => {
                                      if (sec.sectionType === 'TRAFFIC') {
                                          // Green line for normal segment before traffic
                                          if (sec.startPointIndex > lastIndex) {
                                              const normalSegment = coords.slice(lastIndex, sec.startPointIndex + 1);
                                              if (normalSegment.length >= 2) {
                                                  features.push({
                                                      type: 'Feature',
                                                      properties: { color: '#10b981' }, // Green
                                                      geometry: { type: 'LineString', coordinates: normalSegment }
                                                  });
                                              }
                                          }
                                          
                                          // Determine traffic color
                                          let color = '#ef4444'; // Red (Heavy)
                                          let badgeClass = 'on-route-badge';
                                          if (sec.magnitudeOfDelay === 1 || sec.simpleCategory === 'JAM_LIGHT') { color = '#eab308'; badgeClass += ' yellow'; } // Yellow
                                          else if (sec.magnitudeOfDelay === 2 || sec.simpleCategory === 'JAM_MODERATE') { color = '#eab308'; badgeClass += ' yellow'; } // Yellow
                                          
                                          const trafficSegment = coords.slice(sec.startPointIndex, sec.endPointIndex + 1);
                                          if (trafficSegment.length >= 2) {
                                              features.push({
                                                  type: 'Feature',
                                                  properties: { color: color },
                                                  geometry: { type: 'LineString', coordinates: trafficSegment }
                                              });
                                          }
                                          
                                          // Spawn an on-route delay badge precisely in the middle of this jam!
                                          const delayMin = Math.ceil((sec.delayInSeconds || 0) / 60);
                                          if (delayMin > 0 && trafficSegment.length >= 2) {
                                              const midIndex = Math.floor(trafficSegment.length / 2);
                                              const midCoord = trafficSegment[midIndex];
                                              
                                              const badgeEl = document.createElement('div');
                                              badgeEl.className = badgeClass;
                                              badgeEl.innerHTML = '🚗 ' + delayMin + ' min';
                                              
                                              new tt.Marker({ element: badgeEl, anchor: 'center' })
                                                  .setLngLat(midCoord)
                                                  .addTo(map);
                                          }
                                          
                                          lastIndex = sec.endPointIndex;
                                      }
                                  });
                                  
                                  // Remaining green line
                                  if (lastIndex < coords.length - 1) {
                                      const remainingSegment = coords.slice(lastIndex, coords.length);
                                      if (remainingSegment.length >= 2) {
                                          features.push({
                                              type: 'Feature',
                                              properties: { color: '#10b981' }, // Green
                                              geometry: { type: 'LineString', coordinates: remainingSegment }
                                          });
                                      }
                                  }
                              } else {
                                  // Static overview map (No traffic slice)
                                  features.push({
                                      type: 'Feature',
                                      properties: { color: '#10b981' }, // Green
                                      geometry: { type: 'LineString', coordinates: coords }
                                  });
                              }

                              const geojson = { type: 'FeatureCollection', features: features };

                              map.addLayer({
                                  'id': 'route',
                                  'type': 'line',
                                  'source': {
                                      'type': 'geojson',
                                      'data': geojson
                                  },
                                  'paint': {
                                      'line-color': ['get', 'color'],
                                      'line-width': 6
                                  }
                              });
                          } catch (err) {
                              console.error("Traffic segmentation failed, falling back to basic route:", err);
                              // Fallback: draw basic green route if segmentation fails
                              map.addLayer({
                                  'id': 'route',
                                  'type': 'line',
                                  'source': {
                                      'type': 'geojson',
                                      'data': {
                                          type: 'Feature',
                                          properties: {},
                                          geometry: { type: 'LineString', coordinates: coords }
                                      }
                                  },
                                  'paint': {
                                      'line-color': '#10b981',
                                      'line-width': 6
                                  }
                              });
                          }

                          const bounds = new tt.LngLatBounds();
                          coords.forEach(coord => {
                              bounds.extend(tt.LngLat.convert(coord));
                          });
                          map.fitBounds(bounds, { padding: 40 });
                          
                          if (${autoSwoop}) {
                              setTimeout(() => {
                                  map.flyTo({ center: [originLng, originLat], zoom: 17, pitch: 60, speed: 1.2 });
                              }, 3000);
                          }
                      }).catch((e) => {
                          console.error("Routing error:", e);
                          const bounds = new tt.LngLatBounds();
                          bounds.extend([originLng, originLat]);
                          bounds.extend([destLng, destLat]);
                          map.fitBounds(bounds, { padding: 40 });
                          
                          if (${autoSwoop}) {
                              setTimeout(() => {
                                  map.flyTo({ center: [originLng, originLat], zoom: 17, pitch: 60, speed: 1.2 });
                              }, 3000);
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
  }, [destAddress, dropoffLabel, pickupLabel, scrollEnabled, showCarIcon, autoSwoop]);

  // When GPS 'origin' updates, inject javascript to move the car without reloading the map!
  useEffect(() => {
    // Only track movement if it's the live map (showCarIcon = true)
    if (showCarIcon && origin?.lat && origin?.lng && webViewRef.current) {
      const bearingScript = origin.heading !== undefined && origin.heading !== null && origin.heading >= 0 
          ? `, bearing: ${origin.heading}` 
          : '';
          
      const script = `
        if (window.originMarker) {
          window.originMarker.setLngLat([${origin.lng}, ${origin.lat}]);
          if (window.ttMap) {
             window.ttMap.easeTo({ center: [${origin.lng}, ${origin.lat}] ${bearingScript} });
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#e2e8f0",
  },
  map: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
