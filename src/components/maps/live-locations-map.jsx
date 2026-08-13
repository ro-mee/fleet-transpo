"use client";

import { useMemo, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, Marker, Popup, useMap, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { rasterTileUrl, trafficTileUrl } from "@/lib/tomtom";
import { Button } from "@/components/ui/button";
import { MapPin, Eye, Layers, ExternalLink, Navigation, Compass, ShieldCheck, Route, ArrowRight, CornerUpRight, Building2, Flag } from "lucide-react";
import { cn } from "@/lib/utils";

// Map tile style options
const MAP_STYLES = {
  street: {
    name: "Street View",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
  },
  satellite: {
    name: "Satellite Imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
  },
  tomtom: {
    name: "TomTom Vector",
    url: rasterTileUrl(),
    attribution: '&copy; <a href="https://developer.tomtom.com">TomTom</a>',
  },
};

const STATUS_COLOR = {
  "En Route": "#10b981",
  "Trip Started": "#f59e0b",
  "In Progress": "#3b82f6",
  Arrived: "#8b5cf6",
  Idle: "#ef4444",
  Available: "#10b981",
  Assigned: "#f59e0b",
};
const DEFAULT_MARKER = "#3b82f6";

function MapControls({ trafficOn, onTraffic, legendOn, onLegend, mapStyle, onMapStyle }) {
  const map = useMap();

  return (
    <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-2 select-none">
      {/* Map Layer Switcher */}
      <div className="flex items-center rounded-2xl border border-border/80 bg-surface/95 p-1 shadow-md backdrop-blur">
        <button
          type="button"
          onClick={() => onMapStyle("street")}
          className={cn(
            "px-2.5 py-1 text-[11px] font-semibold rounded-xl transition-all cursor-pointer",
            mapStyle === "street" ? "bg-primary text-white dark:text-slate-950 shadow-2xs" : "text-foreground-secondary hover:text-foreground"
          )}
        >
          Street
        </button>
        <button
          type="button"
          onClick={() => onMapStyle("satellite")}
          className={cn(
            "px-2.5 py-1 text-[11px] font-semibold rounded-xl transition-all cursor-pointer",
            mapStyle === "satellite" ? "bg-primary text-white dark:text-slate-950 shadow-2xs" : "text-foreground-secondary hover:text-foreground"
          )}
        >
          Satellite
        </button>
        <button
          type="button"
          onClick={() => onMapStyle("tomtom")}
          className={cn(
            "px-2.5 py-1 text-[11px] font-semibold rounded-xl transition-all cursor-pointer",
            mapStyle === "tomtom" ? "bg-primary text-white dark:text-slate-950 shadow-2xs" : "text-foreground-secondary hover:text-foreground"
          )}
        >
          TomTom
        </button>
      </div>

      {/* Traffic Toggle */}
      <button
        type="button"
        onClick={onTraffic}
        aria-pressed={trafficOn}
        className={cn(
          "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold shadow-md backdrop-blur transition-all cursor-pointer",
          trafficOn ? "border-success/40 bg-surface/95 text-foreground" : "border-border/80 bg-surface/95 text-foreground-muted"
        )}
      >
        <div className="flex items-center gap-2">
          <span className={`relative inline-flex h-2 w-2 rounded-full ${trafficOn ? "bg-success" : "bg-foreground-muted"}`}>
            {trafficOn && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />}
          </span>
          Live Traffic
        </div>
        <span className={cn("text-[11px] font-bold px-1.5 py-0.2 rounded-md", trafficOn ? "bg-success/15 text-success" : "bg-muted text-foreground-muted")}>
          {trafficOn ? "ON" : "OFF"}
        </span>
      </button>

      {/* Legend Toggle */}
      <button
        type="button"
        onClick={onLegend}
        aria-pressed={legendOn}
        className="flex items-center gap-2 rounded-xl border border-border/80 bg-surface/95 px-3 py-2 text-xs font-semibold text-foreground shadow-md backdrop-blur hover:bg-hover transition-colors cursor-pointer"
      >
        <Layers className="w-3.5 h-3.5 text-foreground-muted" />
        Legend
      </button>
    </div>
  );
}

function formatTitleCase(str) {
  if (!str) return "";
  return String(str)
    .split(" ")
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

export default function LiveLocationsMap({
  locations = [],
  route = null,
  routeDistanceKm = null,
  routeTravelMin = null,
  traffic = true,
  waypoints = null,
  originName = "",
  destinationName = "",
  instructions = [],
  showNavigationPanel = false,
  incidents = [],
}) {
  const [trafficOn, setTrafficOn] = useState(traffic);
  const [legendOn, setLegendOn] = useState(true);
  const [mapStyle, setMapStyle] = useState("tomtom");

  const valid = locations.filter((l) => l && l.latitude != null && l.longitude != null);
  const routePts = Array.isArray(route) && route.length >= 2 ? route : null;
  const hasContent = valid.length > 0 || routePts;

  const origin = waypoints?.origin;
  const destination = waypoints?.destination;

  const formattedOrigin = useMemo(() => {
    if (!originName) return "Driver GPS Location";
    // If it contains "Driver: name (plate)", format the name cleanly
    return originName.replace(/Driver:\s*([^(]+)/i, (_, name) => `Driver: ${formatTitleCase(name.trim())}`);
  }, [originName]);

  const formattedDestination = useMemo(() => {
    if (!destinationName) return "Coco Hotel & Resort";
    return destinationName;
  }, [destinationName]);

  const center = useMemo(() => {
    if (valid.length > 0) return [valid[0].latitude, valid[0].longitude];
    if (origin) return origin;
    if (routePts) return routePts[0];
    return [14.6, 121.0];
  }, [valid, origin, routePts]);

  const legendStatuses = useMemo(() => {
    const seen = new Set();
    for (const l of valid) {
      const s = l.trip_status || l.vehicle_status;
      if (s) seen.add(s);
    }
    return [...seen];
  }, [valid]);

  const originIcon = useMemo(
    () =>
      L.divIcon({
        className: "fleet-marker",
        html: `<div class="fleet-pin fleet-pin-driver" style="--pin:#10b981"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 9H14"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="16.5" cy="18.5" r="2.5"/></svg></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 30],
        tooltipAnchor: [0, -30],
      }),
    []
  );

  const destIcon = useMemo(
    () =>
      L.divIcon({
        className: "fleet-marker",
        html: `<div class="fleet-pin fleet-pin-hotel" style="--pin:#ef4444"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 22v-6.57a2 2 0 0 1 1.05-1.75l4.8-2.67A2 2 0 0 1 18 12.76V22"/><path d="M2 22h20"/><path d="M10 11V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v18"/><path d="M6 6h.01"/><path d="M6 10h.01"/><path d="M6 14h.01"/><path d="M14 18h.01"/></svg></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 30],
        tooltipAnchor: [0, -30],
      }),
    []
  );

  const displayLocations = useMemo(() => {
    if (routePts && valid.length > 1) {
      return [valid[valid.length - 1]];
    }
    return valid;
  }, [valid, routePts]);

  const validIncidents = useMemo(
    () =>
      (incidents || []).filter(
        (inc) => inc && inc.latitude != null && inc.longitude != null
      ),
    [incidents]
  );

  const incidentIcon = useMemo(
    () =>
      L.divIcon({
        className: "fleet-marker",
        html: `<div class="fleet-incident-pin"><span class="fleet-incident-pulse"></span><span class="fleet-incident-dot"></span></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        tooltipAnchor: [0, -14],
      }),
    []
  );

  const openGoogleStreetView = (lat, lng) => {
    const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (typeof window === "undefined") return null;
  if (!hasContent) return null;

  const activeTile = MAP_STYLES[mapStyle] || MAP_STYLES.tomtom;

  return (
    <div className="relative h-full w-full select-none">
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom={false}
        zoomControl={false}
        className="h-full w-full z-0"
        style={{ height: "100%", width: "100%" }}
      >
        <ZoomControl position="bottomright" />
        <TileLayer attribution={activeTile.attribution} url={activeTile.url} />
        
        {trafficOn && (
          <TileLayer attribution="Traffic © TomTom" url={trafficTileUrl()} opacity={0.75} />
        )}

        {origin && (
          <Marker key={`marker-origin-${formattedOrigin}`} position={origin} icon={originIcon}>
            <Tooltip key={`tooltip-origin-${formattedOrigin}`} permanent offset={[0, -24]} direction="top" className="fleet-tooltip font-semibold text-xs shadow-md">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
                {formattedOrigin}
              </span>
            </Tooltip>
          </Marker>
        )}
        {destination && (
          <Marker key={`marker-dest-${formattedDestination}`} position={destination} icon={destIcon}>
            <Tooltip key={`tooltip-dest-${formattedDestination}`} permanent offset={[0, -24]} direction="top" className="fleet-tooltip font-semibold text-xs shadow-md">
              <span className="flex items-center gap-1.5 font-medium">
                🏨 {formattedDestination}
              </span>
            </Tooltip>
          </Marker>
        )}

        {routePts && (
          <Polyline
            positions={routePts}
            pathOptions={{ color: "#2563eb", weight: 6, opacity: 0.9, lineCap: "round", lineJoin: "round" }}
          />
        )}

        {displayLocations.map((l, i) => {
          const status = l.trip_status || l.vehicle_status;
          const color = STATUS_COLOR[status] || DEFAULT_MARKER;
          const lat = Number(l.latitude);
          const lng = Number(l.longitude);
          const plate = l.plate_number || l.vehicle_name || `Vehicle #${i + 1}`;

          return (
            <CircleMarker
              key={i}
              center={[lat, lng]}
              radius={9}
              pathOptions={{
                color: "#ffffff",
                weight: 2.5,
                fillColor: color,
                fillOpacity: 1,
              }}
            >
              <Popup className="fleet-popup">
                <div className="p-1 space-y-2 text-foreground font-sans min-w-[210px]">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <span className="font-bold text-sm font-data">{plate}</span>
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary">
                      {status || "Active"}
                    </span>
                  </div>

                  <div className="space-y-1 text-xs text-foreground-secondary font-medium">
                    <p className="flex items-center gap-1.5 font-data">
                      <Compass className="w-3.5 h-3.5 text-primary" />
                      {lat.toFixed(4)}, {lng.toFixed(4)}
                    </p>
                    {l.speed != null && (
                      <p className="text-[11px] text-foreground-muted font-data">
                        Speed: {Number(l.speed).toFixed(0)} km/h
                      </p>
                    )}
                  </div>

                  {/* Street View Action Button */}
                  <Button
                    size="sm"
                    onClick={() => openGoogleStreetView(lat, lng)}
                    className="w-full h-8 text-xs font-semibold rounded-xl mt-2 cursor-pointer bg-primary text-white dark:text-slate-950 flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Open Street View 360°
                    <ExternalLink className="w-3 h-3 ml-0.5 opacity-80" />
                  </Button>
                </div>
              </Popup>

              <Tooltip className="fleet-tooltip">
                <div className="font-semibold text-xs">{plate}</div>
                {status && <div className="text-[11px] opacity-80">{status}</div>}
              </Tooltip>
            </CircleMarker>
          );
        })}

        {validIncidents.map((inc) => {
          const lat = Number(inc.latitude);
          const lng = Number(inc.longitude);
          const type = inc.incident_type || "Incident";
          const severity = inc.severity || "medium";
          const severityColor =
            severity === "high"
              ? "#ef4444"
              : severity === "low"
              ? "#f59e0b"
              : "#f97316";
          const ts = inc.created_at
            ? new Date(inc.created_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "";
          return (
            <Marker
              key={`incident-${inc.id || lat + "," + lng}`}
              position={[lat, lng]}
              icon={incidentIcon}
              zIndexOffset={1000}
            >
              <Popup className="fleet-popup">
                <div className="p-1 space-y-2 text-foreground font-sans min-w-[200px]">
                  <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <span className="font-bold text-sm capitalize">{type}</span>
                    <span
                      className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: severityColor }}
                    >
                      {severity.toUpperCase()}
                    </span>
                  </div>
                  <div className="space-y-1 text-xs text-foreground-secondary font-medium">
                    {inc.description && (
                      <p className="leading-relaxed">{inc.description}</p>
                    )}
                    <p className="flex items-center gap-1.5 font-data">
                      <Compass className="w-3.5 h-3.5 text-danger" />
                      {lat.toFixed(4)}, {lng.toFixed(4)}
                    </p>
                    {ts && (
                      <p className="text-[11px] text-foreground-muted font-data">
                        Reported {ts}
                      </p>
                    )}
                  </div>
                </div>
              </Popup>
              <Tooltip className="fleet-tooltip">
                <div className="font-semibold text-xs capitalize flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full animate-pulse shrink-0"
                    style={{ backgroundColor: severityColor }}
                  />
                  {type} {severity === "high" ? "· High" : ""}
                </div>
              </Tooltip>
            </Marker>
          );
        })}

        <MapControls
          trafficOn={trafficOn}
          onTraffic={() => setTrafficOn((v) => !v)}
          legendOn={legendOn}
          onLegend={() => setLegendOn((v) => !v)}
          mapStyle={mapStyle}
          onMapStyle={setMapStyle}
        />
      </MapContainer>

      {/* Floating Traffic Active Indicator */}
      {trafficOn && (
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] flex items-center gap-2 rounded-2xl border border-success/30 bg-surface/95 px-3.5 py-2 shadow-md backdrop-blur text-xs font-semibold text-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
          Live Traffic Layer Active <span className="text-[11px] text-foreground-muted font-medium font-data">(Real-Time Flow)</span>
        </div>
      )}

      {/* Floating Turn-by-Turn Directions & Designated Location Panel */}
      {showNavigationPanel && (originName || destinationName || (instructions && instructions.length > 0)) && (
        <div className="absolute right-3 bottom-3 z-[1000] w-80 rounded-3xl border border-border/80 bg-surface/95 p-4 shadow-lg backdrop-blur space-y-3">
          <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
            <span className="text-xs font-bold text-foreground flex items-center gap-2">
              <div className="p-1 rounded-lg bg-primary/10 text-primary">
                <Navigation className="w-3.5 h-3.5" />
              </div>
              Live Route Navigation
            </span>
            {(routeDistanceKm || routeTravelMin) && (
              <span className="text-[11px] font-bold font-data text-primary bg-primary/10 px-2.5 py-1 rounded-xl border border-primary/20">
                {routeDistanceKm ? `${routeDistanceKm} km` : ""} {routeTravelMin ? `· ~${routeTravelMin} min` : ""}
              </span>
            )}
          </div>

          <div className="space-y-2 text-xs font-medium bg-muted/20 p-2.5 rounded-2xl border border-border/40">
            {originName && (
              <div className="flex items-start gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success shrink-0 mt-1 shadow-2xs" />
                <div className="min-w-0">
                  <p className="text-[11px] uppercase font-bold text-foreground-muted">Driver Live Location</p>
                  <p className="text-xs text-foreground font-semibold truncate">{originName}</p>
                </div>
              </div>
            )}
            {destinationName && (
              <div className="flex items-start gap-2.5 pt-1 border-t border-border/40">
                <span className="h-2.5 w-2.5 rounded-full bg-danger shrink-0 mt-1 shadow-2xs" />
                <div className="min-w-0">
                  <p className="text-[11px] uppercase font-bold text-foreground-muted">Destination</p>
                  <p className="text-xs text-foreground font-semibold truncate">{destinationName}</p>
                </div>
              </div>
            )}
          </div>

          {instructions && instructions.length > 0 && (
            <div className="border-t border-border/60 pt-2 space-y-1.5 max-h-36 overflow-y-auto">
              <p className="text-[11px] font-bold uppercase text-foreground-muted tracking-wider">Step-by-Step Directions</p>
              {instructions.map((step, idx) => (
                <div key={idx} className="flex items-center gap-2 text-[11px] text-foreground-secondary">
                  <span className="font-bold text-primary font-data shrink-0">{idx + 1}.</span>
                  <span className="truncate">{step.message} {step.street ? `onto ${step.street}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Floating Legend */}
      {legendOn && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-3xl border border-border/80 bg-surface/95 p-3.5 shadow-md backdrop-blur space-y-3 max-w-[210px]">
          {legendStatuses.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
                Fleet Status
              </p>
              <ul className="space-y-1">
                {legendStatuses.map((s) => (
                  <li key={s} className="flex items-center gap-2 text-xs font-medium text-foreground-secondary">
                    <span className="h-2.5 w-2.5 rounded-full shadow-2xs shrink-0" style={{ backgroundColor: STATUS_COLOR[s] || DEFAULT_MARKER }} />
                    <span className="truncate">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validIncidents.length > 0 && (
            <div className="border-t border-border/60 pt-2">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
                Incidents ({validIncidents.length})
              </p>
              <ul className="space-y-1 text-xs font-medium text-foreground-secondary">
                <li className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-danger" />
                  </span>
                  <span>Reported Incident</span>
                </li>
              </ul>
            </div>
          )}

          {trafficOn && (
            <div className="border-t border-border/60 pt-2">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-foreground-muted">
                Live Traffic Flow
              </p>
              <ul className="space-y-1 text-xs font-medium text-foreground-secondary">
                <li className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-success shrink-0" />
                  <span>Free Flow</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-warning shrink-0" />
                  <span>Moderate Flow</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
                  <span>Slow Traffic</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-danger shrink-0" />
                  <span>Heavy Delay</span>
                </li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Embedded Styles */}
      <style jsx global>{`
        .fleet-pin {
          display: flex; align-items: center; justify-content: center;
          width: 30px; height: 30px; border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          background: var(--pin, #2563eb);
          border: 2.5px solid #ffffff;
          box-shadow: 0 4px 10px rgb(0 0 0 / 0.35);
        }
        .fleet-pin span { transform: rotate(45deg); color: #fff; font-size: 14px; }
        .fleet-incident-pin {
          position: relative;
          width: 26px; height: 26px;
          display: flex; align-items: center; justify-content: center;
        }
        .fleet-incident-dot {
          width: 15px; height: 15px;
          border-radius: 50%;
          background: #ef4444;
          border: 2.5px solid #ffffff;
          box-shadow: 0 2px 8px rgb(239 68 68 / 0.6);
          z-index: 2;
        }
        .fleet-incident-pulse {
          position: absolute;
          width: 15px; height: 15px;
          border-radius: 50%;
          background: rgb(239 68 68 / 0.5);
          animation: fleet-incident-blink 1.4s ease-out infinite;
          z-index: 1;
        }
        @keyframes fleet-incident-blink {
          0% { transform: scale(1); opacity: 0.9; }
          70% { transform: scale(2.6); opacity: 0; }
          100% { transform: scale(2.6); opacity: 0; }
        }
        .fleet-tooltip { border: 1px solid var(--br); border-radius: 12px; box-shadow: var(--shadow-sm); font-family: var(--font-sans); }
        .leaflet-popup-content-wrapper { border-radius: 20px; border: 1px solid var(--br); background: var(--sf); box-shadow: var(--shadow-lg); }
        .leaflet-popup-tip { background: var(--sf); }
      `}</style>
    </div>
  );
}
