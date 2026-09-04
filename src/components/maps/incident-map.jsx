"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { rasterTileUrl } from "@/lib/tomtom";
import { Compass, AlertTriangle, Eye } from "lucide-react";
import { ImageViewer } from "@/components/ui/image-viewer";

const SEVERITY_COLOR = { Critical: "#dc2626", Major: "#ef4444", Moderate: "#f97316", Minor: "#f59e0b" };

function FitBounds({ points }) {
  const map = useMap();
  useMemo(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => [lat, lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [points, map]);
  return null;
}

function MapZoomHandler({ setShowOverlay }) {
  const map = useMap();
  const timeoutRef = useRef(null);

  useEffect(() => {
    map.scrollWheelZoom.disable();

    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (!map.scrollWheelZoom.enabled()) {
          map.scrollWheelZoom.enable();
        }
        setShowOverlay(false);
      } else {
        if (map.scrollWheelZoom.enabled()) {
          map.scrollWheelZoom.disable();
        }
        setShowOverlay(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setShowOverlay(false), 1200);
      }
    };

    const container = map.getContainer();
    container.addEventListener('wheel', onWheel, { capture: true });
    
    return () => {
      container.removeEventListener('wheel', onWheel, { capture: true });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [map, setShowOverlay]);

  return null;
}

export default function IncidentMap({ incidents = [] }) {
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const [showZoomMessage, setShowZoomMessage] = useState(false);
  const key = process.env.NEXT_PUBLIC_TOMTOM_API_KEY || "";

  const points = useMemo(
    () =>
      (incidents || [])
        .filter((i) => i && i.latitude != null && i.longitude != null)
        .map((i) => [Number(i.latitude), Number(i.longitude)]),
    [incidents]
  );



  if (typeof window === "undefined") return null;

  const center = points.length > 0 ? points[0] : [14.7519, 121.0573];

  return (
    <div className="relative h-full w-full select-none">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={false}
        className="h-full w-full z-0"
        style={{ height: "100%", width: "100%" }}
      >
        <MapZoomHandler setShowOverlay={setShowZoomMessage} />
        <TileLayer
          attribution='&copy; <a href="https://developer.tomtom.com">TomTom</a>'
          url={rasterTileUrl()}
        />

        {incidents
          .filter((i) => i && i.latitude != null && i.longitude != null)
          .map((inc, index) => {
            const lat = Number(inc.latitude);
            const lng = Number(inc.longitude);
            const type = inc.incident_type || "Incident";
            const severity = inc.severity || "Moderate";
            const color = SEVERITY_COLOR[severity] || "#f97316";
            const ts = inc.created_at
              ? new Date(inc.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "";
            const markerIcon = L.divIcon({
              className: "fleet-marker",
              html: `
                <div class="fleet-incident-pin">
                  <span class="fleet-incident-pulse" style="background-color: ${color}; opacity: 0.4;"></span>
                  <span class="fleet-incident-dot" style="background-color: ${color}; box-shadow: 0 0 8px ${color};"></span>
                </div>
              `,
              iconSize: [26, 26],
              iconAnchor: [13, 13],
              tooltipAnchor: [0, -14],
            });

            return (
              <Marker
                key={`incident-${inc.incident_id || index}`}
                position={[lat, lng]}
                icon={markerIcon}
                zIndexOffset={1000}
              >
                <Popup className="fleet-popup" minWidth={220}>
                  <div className="flex flex-col text-foreground font-sans">
                    {/* Header */}
                    <div className="flex items-center justify-between p-3 pb-2 border-b border-border/40 bg-surface">
                      <span className="font-bold text-sm capitalize flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-danger" />
                        {type}
                      </span>
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded text-white shadow-sm tracking-widest uppercase"
                        style={{ backgroundColor: color }}
                      >
                        {severity}
                      </span>
                    </div>

                    {/* Body */}
                    <div className="p-3 space-y-2.5 bg-surface/40">
                      {/* Driver & Vehicle */}
                      {(inc.driver || inc.plate_number || inc.vehicle_id) && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-foreground truncate">
                              {inc.driver ? `${inc.driver.first_name} ${inc.driver.last_name}` : "Unknown Driver"}
                            </p>
                            <p className="text-[11px] text-foreground-muted font-bold uppercase tracking-wider">
                              {inc.plate_number ? `Vehicle: ${inc.plate_number}` : inc.vehicle_id ? `Vehicle ID: #${inc.vehicle_id}` : "No Vehicle Assigned"}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Location */}
                      {inc.location && (
                        <div className="flex items-start gap-1.5 text-xs text-foreground-secondary font-medium">
                          <Compass className="w-3.5 h-3.5 text-danger/80 shrink-0 mt-0.5" />
                          <span className="leading-snug line-clamp-2">{inc.location}</span>
                        </div>
                      )}

                      {/* Assistance Needed Badges */}
                      {inc.assistance_needed && inc.assistance_needed.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pb-1 mt-1">
                          {inc.assistance_needed.map((req, i) => (
                            <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-sm bg-danger text-white text-[11px] font-bold tracking-widest uppercase shadow-[0_0_8px_rgba(239,68,68,0.5)]">
                              {req} NEEDED
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Highlighted Reason/Description */}
                      {inc.description && (
                        <div className="relative overflow-hidden rounded-lg bg-danger/5 border border-danger/20 p-2.5 shadow-2xs mt-1">
                          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-danger" />
                          <p className="text-xs font-bold text-foreground/90 leading-relaxed">
                            &ldquo;{inc.description}&rdquo;
                          </p>
                        </div>
                      )}

                      {/* Photos */}
                      {Array.isArray(inc.photo_urls) && inc.photo_urls.length > 0 && (
                        <div className="flex gap-1.5 mt-2 overflow-x-auto pb-0.5 hide-scrollbar">
                          {inc.photo_urls.map((url, idx) => (
                            <button 
                              key={idx} 
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFullScreenImage(url); }}
                              className="shrink-0 block group relative overflow-hidden rounded border border-border/40 shadow-xs cursor-pointer focus:outline-none"
                            >
                              <img src={url} alt={`Incident ${idx + 1}`} className="w-12 h-12 rounded object-cover bg-muted/50 group-hover:scale-105 transition-transform duration-300" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center text-white">
                                <Eye className="w-4 h-4 drop-shadow-md" />
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Footer/Meta */}
                      <div className="pt-2 mt-1 border-t border-border/40 flex flex-col gap-0.5">
                        <p className="font-data text-[11px] font-semibold text-foreground-secondary flex items-center justify-between">
                          <span>{lat.toFixed(4)}, {lng.toFixed(4)}</span>
                          <span>{ts}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </Popup>
                <Tooltip permanent offset={[0, -16]} direction="top" className="fleet-tooltip">
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 font-semibold text-xs capitalize">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      {type} · {severity}
                    </span>
                    {inc.driver && (
                      <span className="text-[11px] font-medium">
                        {inc.driver.first_name} {inc.driver.last_name}
                      </span>
                    )}
                  </div>
                </Tooltip>
              </Marker>
            );
          })}

        <FitBounds points={points} />
      </MapContainer>

      <style jsx global>{`
        .fleet-incident-pin {
          position: relative;
          width: 26px; height: 26px;
          display: flex; align-items: center; justify-content: center;
        }
        .fleet-incident-dot {
          width: 15px; height: 15px;
          border-radius: 50%;
          border: 2.5px solid #ffffff;
          z-index: 2;
        }
        .fleet-incident-pulse {
          position: absolute;
          width: 15px; height: 15px;
          border-radius: 50%;
          animation: fleet-incident-blink 1.4s ease-out infinite;
          z-index: 1;
        }
        @keyframes fleet-incident-blink {
          0% { transform: scale(1); opacity: 0.9; }
          70% { transform: scale(2.6); opacity: 0; }
          100% { transform: scale(2.6); opacity: 0; }
        }
        .fleet-popup .leaflet-popup-content { margin: 0 !important; width: 100% !important; }
        .fleet-popup .leaflet-popup-content-wrapper { background: var(--sf); padding: 0 !important; border-radius: 16px; overflow: hidden; border: 1px solid var(--br); box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1); }
        .fleet-popup p { margin: 0 !important; }
        .fleet-popup .leaflet-popup-close-button { top: 8px !important; right: 8px !important; color: var(--fg-muted) !important; z-index: 10; }
        .leaflet-popup-tip { background: var(--sf); }
      `}</style>

      {/* Zoom Message Overlay */}
      {showZoomMessage && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/20 pointer-events-none transition-opacity duration-300">
          <p className="px-5 py-2.5 bg-surface/90 backdrop-blur-md rounded-xl text-foreground font-semibold shadow-lg text-sm text-center">
            Use <kbd className="font-mono bg-muted/80 border border-border/50 px-1.5 py-0.5 rounded text-[11px] mx-1">ctrl</kbd> + scroll to zoom the map
          </p>
        </div>
      )}

      {/* Full Screen Image Viewer Overlay */}
      <ImageViewer 
        url={fullScreenImage} 
        onClose={() => setFullScreenImage(null)} 
      />
    </div>
  );
}
