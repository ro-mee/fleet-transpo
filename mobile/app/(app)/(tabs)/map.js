import React from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

export default function MapTab() {
  const tomtomKey = process.env.EXPO_PUBLIC_TOMTOM_API_KEY || "Eovwxfb6mUlNub48iBOiYpuQBZZWQHne";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>TomTom Map</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">
        <link rel="stylesheet" type="text/css" href="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps.css" />
        <script src="https://api.tomtom.com/maps-sdk-for-web/cdn/6.x/6.25.0/maps/maps-web.min.js"></script>
        <style>
            body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
            #map { height: 100vh; width: 100vw; }
            
            /* Custom styles matching the screenshot */
            .tt-popup-content { padding: 12px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.15); border: none; }
            .tt-popup-panel { background: white; }
            .popup-title { font-family: sans-serif; font-size: 14px; font-weight: bold; color: #0f172a; margin-bottom: 4px; margin-top: 0; }
            .popup-desc { font-family: sans-serif; font-size: 12px; color: #64748b; margin: 0; }
            .car-marker { background: white; padding: 2px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; }
            .car-inner { background: #475569; width: 100%; height: 100%; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
            
            .dest-marker { align-items: center; justify-content: center; display: flex; flex-direction: column; position: relative; }
            .dest-dot-outer { width: 20px; height: 20px; border-radius: 10px; background: rgba(14, 165, 233, 0.2); display: flex; align-items: center; justify-content: center; position: absolute; top: -14px; }
            .dest-dot-inner { width: 8px; height: 8px; border-radius: 4px; background: #0ea5e9; }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <script>
            tt.setProductInfo('fleetops', '1.0');
            
            const map = tt.map({
                key: '${tomtomKey}',
                container: 'map',
                center: [103.8791, 1.3253],
                zoom: 13,
                dragPan: true,
                stylesVisibility: {
                  trafficIncidents: true,
                  trafficFlow: true
                }
            });

            map.on('load', () => {
                // Add route polyline
                const routeCoords = [
                    [103.8659, 1.3323], // CTE
                    [103.8690, 1.3284],
                    [103.8705, 1.3255],
                    [103.8741, 1.3213], // Kallang
                    [103.8860, 1.3175], // KPE
                    [103.8924, 1.3184]  // Paya Lebar
                ];
                
                map.addLayer({
                    'id': 'route',
                    'type': 'line',
                    'source': {
                        'type': 'geojson',
                        'data': {
                            'type': 'Feature',
                            'properties': {},
                            'geometry': {
                                'type': 'LineString',
                                'coordinates': routeCoords
                            }
                        }
                    },
                    'layout': {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    'paint': {
                        'line-color': '#10b981', /* emerald-500 */
                        'line-width': 6
                    }
                });

                // Car Marker
                const carEl = document.createElement('div');
                carEl.className = 'car-marker';
                carEl.innerHTML = '<div class="car-inner"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11h14v-2a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v2z"></path><path d="M19 11v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6"></path><circle cx="8" cy="15" r="1.5"></circle><circle cx="16" cy="15" r="1.5"></circle></svg></div>';
                new tt.Marker({ element: carEl, anchor: 'center' }).setLngLat([103.8690, 1.3284]).addTo(map);

                // Destination Marker
                const destEl = document.createElement('div');
                destEl.className = 'dest-marker';
                destEl.innerHTML = '<div class="dest-dot-outer"><div class="dest-dot-inner"></div></div><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-top: 10px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
                
                const popup = new tt.Popup({ offset: 35, closeButton: false }).setHTML(
                    '<h4 class="popup-title">Proceed to Mall pick-up pt</h4>' +
                    '<p class="popup-desc">Head to Level 1, exit shopping mall, and meet dri...</p>'
                );

                new tt.Marker({ element: destEl })
                    .setLngLat([103.8924, 1.3184])
                    .setPopup(popup)
                    .addTo(map);
                    
                popup.addTo(map); // Open immediately
            });
        </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <WebView
        originWhitelist={["*"]}
        source={{ html: htmlContent }}
        style={styles.map}
        bounces={false}
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  map: {
    flex: 1,
  },
});
