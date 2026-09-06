"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@/styles/map.css";
import { rasterTileUrl } from "@/lib/tomtom";
import {
  AlertTriangle,
  Eye,
  X,
  Wrench,
  MapPin,
  ShieldAlert,
} from "lucide-react";
import { ImageViewer } from "@/components/ui/image-viewer";
import { MapCtrlZoom, ZoomHintOverlay } from "@/components/maps/map-ctrl-zoom";
import {
  createMapEntityMarkerIcon,
  resolveMarkerConfig,
  MinimalMapLegend,
} from "@/components/maps/map-entity-marker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function FitBounds({ points }) {
  const map = useMap();
  useMemo(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map(([lat, lng]) => [lat, lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [points, map]);
  return null;
}

/**
 * @param {Array} incidents incident rows with latitude/longitude
 * @param {Array} [responders] optional live rescue-unit positions
 * @param {Function} [onSelectIncident] optional callback when an incident marker is selected
 */
export default function IncidentMap({
  incidents = [],
  responders = [],
  onSelectIncident,
  onAcknowledgeIncident,
}) {
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [fullScreenImage, setFullScreenImage] = useState(null);
  const [showZoomMessage, setShowZoomMessage] = useState(false);

  const points = useMemo(
    () =>
      (incidents || [])
        .filter((i) => i && i.latitude != null && i.longitude != null)
        .map((i) => [Number(i.latitude), Number(i.longitude)]),
    [incidents]
  );

  const responderMarkers = useMemo(
    () =>
      (responders || [])
        .filter((r) => r && r.latitude != null && r.longitude != null)
        .map((r) => ({
          ...r,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
        })),
    [responders]
  );

  if (typeof window === "undefined") return null;

  const center = points.length > 0 ? points[0] : [14.7519, 121.0573];

  const handleMarkerClick = (inc) => {
    setSelectedIncident(inc);
  };

  return (
    <div className="relative h-full w-full select-none overflow-hidden rounded-2xl">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={false}
        className="h-full w-full z-0"
        style={{ height: "100%", width: "100%" }}
      >
        <MapCtrlZoom setShowHint={setShowZoomMessage} />
        <TileLayer
          attribution='&copy; <a href="https://developer.tomtom.com">TomTom</a>'
          url={rasterTileUrl()}
        />

        {/* Incident Markers using the shared compact floating marker card pattern */}
        {incidents
          .filter((i) => i && i.latitude != null && i.longitude != null)
          .map((inc, index) => {
            const lat = Number(inc.latitude);
            const lng = Number(inc.longitude);
            const isSelected = selectedIncident?.incident_id === inc.incident_id;

            const markerConfig = resolveMarkerConfig(inc, {
              type: "incident",
              selectedId: selectedIncident?.incident_id,
            });

            const markerIcon = createMapEntityMarkerIcon({
              ...markerConfig,
              selected: isSelected,
            }, L);

            return (
              <Marker
                key={`incident-${inc.incident_id || index}`}
                position={[lat, lng]}
                icon={markerIcon}
                zIndexOffset={isSelected ? 3000 : markerConfig.zIndexOffset}
                eventHandlers={{
                  click: () => handleMarkerClick(inc),
                }}
              />
            );
          })}

        {/* Rescue Responder Markers using shared marker grammar */}
        {responderMarkers.map((r, index) => {
          const rescueConfig = resolveMarkerConfig(r, {
            type: "rescue",
          });
          const markerIcon = createMapEntityMarkerIcon({
            ...rescueConfig,
            title: r.label || "Rescue unit",
            status: "En route",
            tone: "blue",
            iconKey: "rescue",
          }, L);

          return (
            <Marker
              key={`responder-${r.incident_id || index}`}
              position={[r.latitude, r.longitude]}
              icon={markerIcon}
              zIndexOffset={1600}
            />
          );
        })}

        <FitBounds points={points.concat(responderMarkers.map((r) => [r.latitude, r.longitude]))} />
      </MapContainer>

      {/* Zoom Hint Overlay */}
      <ZoomHintOverlay show={showZoomMessage} />

      {/* Minimal Floating Map Legend (Section 9) */}
      <div className="absolute bottom-3 left-3 z-[1000] pointer-events-auto">
        <MinimalMapLegend />
      </div>

      {/* Incident Selection Drawer / Panel (Section 6) */}
      {selectedIncident && (
        <div
          role="dialog"
          aria-label={`Incident ${selectedIncident.incident_id} details`}
          className="absolute top-3 right-3 bottom-3 z-[1000] w-80 sm:w-96 max-w-[calc(100%-24px)] rounded-3xl bg-white/95 dark:bg-surface/95 backdrop-blur-md border border-slate-200/80 dark:border-border/80 shadow-2xl flex flex-col overflow-hidden pointer-events-auto animate-in slide-in-from-right-4 duration-200"
        >
          {/* Drawer Header */}
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-900/30">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 border border-rose-100 dark:border-rose-900/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4 text-rose-600" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  INC-{String(selectedIncident.incident_id).padStart(3, "0")}
                </h4>
                <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 truncate">
                  {selectedIncident.severity} · {selectedIncident.incident_type || "Incident"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider",
                selectedIncident.status === "Resolved"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : selectedIncident.acknowledged_at
                    ? "bg-blue-50 text-blue-700 border border-blue-200"
                    : "bg-rose-50 text-rose-700 border border-rose-200 animate-pulse"
              )}>
                {selectedIncident.status === "Resolved"
                  ? "Resolved"
                  : selectedIncident.acknowledged_at
                    ? "Acknowledged"
                    : "Open"}
              </span>

              <button
                type="button"
                onClick={() => setSelectedIncident(null)}
                aria-label="Close incident details"
                className="h-7 w-7 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Drawer Body */}
          <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
            {/* Immediate Operational Impact (Section 6) */}
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-3.5 space-y-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Immediate Operational Impact
              </p>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-400 font-normal">Vehicle</span>
                  <p className="font-bold text-slate-900 dark:text-white font-data mt-0.5">
                    {selectedIncident.plate_number || selectedIncident.vehicle?.plate_number || "Unassigned"}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 font-normal">Assigned Driver</span>
                  <p className="font-bold text-slate-900 dark:text-white truncate mt-0.5">
                    {selectedIncident.driver
                      ? `${selectedIncident.driver.first_name || ""} ${selectedIncident.driver.last_name || ""}`.trim()
                      : "Unassigned"}
                  </p>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
                <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-semibold text-[11px]">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {selectedIncident.severity === "Critical" || selectedIncident.severity === "Major"
                      ? "Vehicle grounded · Dispatch reassignment required"
                      : "Operational monitoring active"}
                  </span>
                </div>
              </div>

              {/* Assistance Requested Chips */}
              {Array.isArray(selectedIncident.assistance_needed) && selectedIncident.assistance_needed.length > 0 && (
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
                  <span className="text-slate-400 font-normal block mb-1.5">Assistance Requested</span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedIncident.assistance_needed.map((need) => (
                      <span
                        key={need}
                        className="px-2 py-0.5 rounded-md bg-rose-100/70 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-[11px] uppercase tracking-wide border border-rose-200/70 dark:border-rose-800/60"
                      >
                        {need}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Location & GPS Freshness */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Location & Coordinates
              </span>
              <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                <MapPin className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                <span className="leading-snug">
                  {selectedIncident.location || "Coordinates reported by driver"}
                </span>
              </div>
              <p className="text-[11px] font-data text-slate-400 pl-6">
                {Number(selectedIncident.latitude).toFixed(4)}, {Number(selectedIncident.longitude).toFixed(4)}
              </p>
            </div>

            {/* Driver Report / Description */}
            {selectedIncident.description && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Driver Report
                </span>
                <p className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 text-slate-800 dark:text-slate-200 leading-relaxed">
                  &ldquo;{selectedIncident.description}&rdquo;
                </p>
              </div>
            )}

            {/* Evidence Photos */}
            {Array.isArray(selectedIncident.photo_urls) && selectedIncident.photo_urls.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Evidence Photos ({selectedIncident.photo_urls.length})
                </span>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {selectedIncident.photo_urls.map((url, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setFullScreenImage(url)}
                      aria-label={`View evidence photo ${idx + 1}`}
                      className="h-14 w-14 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shrink-0 relative group"
                    >
                      <img src={url} alt="Evidence" className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                        <Eye className="h-4 w-4" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(selectedIncident.maintenance_id || selectedIncident.linked_maintenance_id) && (
            <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 p-3 bg-white dark:bg-slate-900/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100 dark:border-amber-900/40">
                  <Wrench className="h-3.5 w-3.5" />
                </div>
                <div>
                  <span className="font-bold text-slate-900 dark:text-white block">
                    Maintenance
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {selectedIncident.maintenance_type || "Incident repair"} · {selectedIncident.maintenance_status || "Open"}
                  </span>
                </div>
              </div>
              <Link
                href={`/maintenance?incident_id=${selectedIncident.incident_id}`}
                className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
              >
                View →
              </Link>
            </div>
            )}
          </div>

          {/* Drawer Actions */}
          <div className="p-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/30 flex items-center gap-2">
            {!selectedIncident.acknowledged_at && selectedIncident.status !== "Resolved" && (
              <Button
                size="sm"
                className="flex-1 text-xs font-semibold bg-primary text-white rounded-xl shadow-xs"
                onClick={() => {
                  if (onAcknowledgeIncident) {
                    onAcknowledgeIncident(selectedIncident);
                  } else if (onSelectIncident) {
                    onSelectIncident(selectedIncident);
                  }
                }}
              >
                Acknowledge Incident
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs font-semibold rounded-xl"
              onClick={() => {
                if (onSelectIncident) {
                  onSelectIncident(selectedIncident);
                }
              }}
            >
              View Full Details
            </Button>
          </div>
        </div>
      )}

      {/* Full Screen Image Viewer */}
      <ImageViewer
        url={fullScreenImage}
        onClose={() => setFullScreenImage(null)}
      />
    </div>
  );
}
