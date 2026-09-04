"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, Marker, Popup, useMap, ZoomControl } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getPublicKey, rasterTileUrl, trafficTileUrl } from "@/lib/tomtom";
import { CHART_COLORS } from "@/lib/chart-tokens";
import { getGpsHealth, isValidCoordinate, speedKmhFromMps } from "@/lib/gps";
import { MapCtrlZoom, ZoomHintOverlay } from "@/components/maps/map-ctrl-zoom";
import { Button } from "@/components/ui/button";
import { MapPin, Eye, Layers, ExternalLink, Compass } from "lucide-react";
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
    name: "TomTom",
    url: rasterTileUrl(),
    attribution: '&copy; <a href="https://developer.tomtom.com">TomTom</a>',
  },
};

// Phase-coded trip colors: blue = pre-trip, amber = heading to pickup,
// green = passenger on board / arrived. Every LIVE_TRIP_STATUSES value maps to
// a visible color; the default is also non-gray so an unknown status never
// renders as a hard-to-spot gray dot.
const STATUS_COLOR = {
  Dispatched: CHART_COLORS.info,
  "Driver Accepted": CHART_COLORS.info,
  "Trip Started": CHART_COLORS.warning,
  "At Pickup": CHART_COLORS.warning,
  "Passenger Onboard": CHART_COLORS.success,
  "En Route": CHART_COLORS.success,
  "In Progress": CHART_COLORS.success,
  "Drop-off": CHART_COLORS.success,
  Arrived: CHART_COLORS.success,
  Idle: CHART_COLORS.danger,
  Available: CHART_COLORS.success,
  Assigned: CHART_COLORS.warning,
};
const DEFAULT_MARKER = CHART_COLORS.info;

function MapControls({ trafficOn, onTraffic, legendOn, onLegend, mapStyle, onMapStyle, hasTomTomKey }) {
  return (
    <div className="absolute right-3 top-3 z-[1000] flex flex-col gap-2 select-none">
      {/* Map Layer Switcher */}
      <div className="flex items-center rounded-2xl border border-border/80 bg-surface/95 p-1 shadow-md backdrop-blur">
        <button
          type="button"
          onClick={() => onMapStyle("street")}
          aria-pressed={mapStyle === "street"}
          aria-label="Use street map"
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
          aria-pressed={mapStyle === "satellite"}
          aria-label="Use satellite map"
          className={cn(
            "px-2.5 py-1 text-[11px] font-semibold rounded-xl transition-all cursor-pointer",
            mapStyle === "satellite" ? "bg-primary text-white dark:text-slate-950 shadow-2xs" : "text-foreground-secondary hover:text-foreground"
          )}
        >
          Satellite
        </button>
        {hasTomTomKey && (
          <button
            type="button"
            onClick={() => onMapStyle("tomtom")}
            aria-pressed={mapStyle === "tomtom"}
            aria-label="Use TomTom map"
            className={cn(
              "px-2.5 py-1 text-[11px] font-semibold rounded-xl transition-all cursor-pointer",
              mapStyle === "tomtom" ? "bg-primary text-white dark:text-slate-950 shadow-2xs" : "text-foreground-secondary hover:text-foreground"
            )}
          >
            TomTom
          </button>
        )}
      </div>

      {/* Traffic Toggle */}
      {hasTomTomKey && (
        <button
          type="button"
          onClick={onTraffic}
          aria-pressed={trafficOn}
          aria-label={`${trafficOn ? "Hide" : "Show"} live traffic layer`}
          className={cn(
            "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold shadow-md backdrop-blur transition-all cursor-pointer",
            trafficOn ? "border-success/40 bg-surface/95 text-foreground" : "border-border/80 bg-surface/95 text-foreground-muted"
          )}
        >
          <div className="flex items-center gap-2">
            <span className={`relative inline-flex h-2 w-2 rounded-full ${trafficOn ? "bg-success" : "bg-foreground-muted"}`}>
              {trafficOn && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />}
            </span>
            Live Traffic
          </div>
          <span className={cn("rounded-md px-1.5 py-0.2 text-[11px] font-bold", trafficOn ? "bg-success/15 text-success" : "bg-muted text-foreground-muted")}>
            {trafficOn ? "ON" : "OFF"}
          </span>
        </button>
      )}

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

function MapViewport({ points, focusPoints = null }) {
  const map = useMap();
  // Always auto-fit: re-runs on every points/focusPoints change (each GPS poll
  // produces a new array identity), keeping all pins centered in view.
  useEffect(() => {
    if (!points.length) return;
    const target = focusPoints?.length ? focusPoints : points;
    if (target.length === 1) {
      map.setView(target[0], Math.max(map.getZoom(), 14), { animate: false });
      return;
    }
    map.fitBounds(target, { padding: [48, 48], maxZoom: 15, animate: false });
  }, [map, points, focusPoints]);

  return null;
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
  selectedTripId = null,
  onSelectTrip = null,
  route = null,
  traffic = true,
  waypoints = null,
  originName = "",
  destinationName = "",
}) {
  const hasTomTomKey = Boolean(getPublicKey());
  const [trafficOn, setTrafficOn] = useState(traffic && hasTomTomKey);
  const [legendOn, setLegendOn] = useState(true);
  const [mapStyle, setMapStyle] = useState(hasTomTomKey ? "tomtom" : "street");
  const [showZoomHint, setShowZoomHint] = useState(false);

  const valid = useMemo(
    () => (locations || [])
      .map((location) => ({
        ...location,
        _lat: Number(location?.latitude),
        _lng: Number(location?.longitude),
      }))
      .filter((location) => isValidCoordinate(location._lat, location._lng)),
    [locations]
  );
  const routePts = useMemo(() => {
    if (!Array.isArray(route)) return null;
    const points = route
      .map((point) => Array.isArray(point)
        ? [Number(point[0]), Number(point[1])]
        : [Number(point?.latitude ?? point?.lat), Number(point?.longitude ?? point?.lng)])
      .filter((point) => isValidCoordinate(point[0], point[1]));
    return points.length >= 2 ? points : null;
  }, [route]);

  const originLat = waypoints?.origin?.[0];
  const originLng = waypoints?.origin?.[1];
  const destinationLat = waypoints?.destination?.[0];
  const destinationLng = waypoints?.destination?.[1];
  const origin = useMemo(
    () => (isValidCoordinate(originLat, originLng) ? [Number(originLat), Number(originLng)] : null),
    [originLat, originLng]
  );
  const destination = useMemo(
    () => (isValidCoordinate(destinationLat, destinationLng) ? [Number(destinationLat), Number(destinationLng)] : null),
    [destinationLat, destinationLng]
  );

  const formattedOrigin = useMemo(() => {
    if (!originName) return "Driver GPS Location";
    // If it contains "Driver: name (plate)", format the name cleanly
    return originName.replace(/Driver:\s*([^(]+)/i, (_, name) => `Driver: ${formatTitleCase(name.trim())}`);
  }, [originName]);

  const formattedDestination = useMemo(() => {
    if (!destinationName) return "Destination unavailable";
    return destinationName;
  }, [destinationName]);

  const center = useMemo(() => {
    if (valid.length > 0) return [valid[0]._lat, valid[0]._lng];
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

  const viewportPoints = useMemo(() => [
    ...valid.map((location) => [location._lat, location._lng]),
    ...(routePts || []),
    ...(origin ? [origin] : []),
    ...(destination ? [destination] : []),
  ], [valid, routePts, origin, destination]);

  const hasContent = viewportPoints.length > 0;
  const selectedPoint = useMemo(
    () => selectedTripId == null
      ? valid[0] || null
      : valid.find((location) => String(location.trip_id) === String(selectedTripId)) || null,
    [valid, selectedTripId]
  );
  const mapFocusPoints = useMemo(
    () => routePts || (selectedTripId != null && selectedPoint ? [[selectedPoint._lat, selectedPoint._lng]] : null),
    [routePts, selectedTripId, selectedPoint]
  );

  const openGoogleStreetView = (lat, lng) => {
    const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (typeof window === "undefined") return null;
  if (!hasContent) return null;

  const activeTile = MAP_STYLES[mapStyle] || MAP_STYLES.street;

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
        <MapCtrlZoom setShowHint={setShowZoomHint} />
        <MapViewport points={viewportPoints} focusPoints={mapFocusPoints} />
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
                <MapPin className="h-3 w-3 text-danger" />
                {formattedDestination}
              </span>
            </Tooltip>
          </Marker>
        )}

        {routePts && (
          <Polyline
            positions={routePts}
            pathOptions={{ color: CHART_COLORS.info, weight: 6, opacity: 0.9, lineCap: "round", lineJoin: "round" }}
          />
        )}

        {valid.map((l, i) => {
          const status = l.trip_status || l.vehicle_status;
          const color = STATUS_COLOR[status] || DEFAULT_MARKER;
          const lat = l._lat;
          const lng = l._lng;
          const plate = l.vehicles?.plate_number || l.vehicles?.vehicle_name || l.plate_number || l.vehicle_name || `Vehicle #${i + 1}`;
          const driver = l.driver_name || (l.drivers ? `${l.drivers.first_name || ""} ${l.drivers.last_name || ""}`.trim() : "");
          // Permanent identity labels only where the data carries one (latest-locations
          // rows); raw GPS-history rows (trips/[id]) keep the plain hover tooltip.
          const hasIdentity = Boolean(l.vehicles || l.drivers || l.driver_name);
          const health = getGpsHealth(l.recorded_at);
          const speedKmh = l.speed_kmh ?? speedKmhFromMps(l.speed);
          const selected = selectedTripId != null && String(l.trip_id) === String(selectedTripId);

          return (
            <CircleMarker
              // Per-row unique id first: GPS-history rows (trips/[id]) all share
              // the same trip_id/vehicle_id, so keying on those collides across
              // every breadcrumb of the trip. tracking_id is the gpstracking PK
              // (gps_tracking_id on latest-locations rows); the index suffix
              // keeps the coordinate fallback unique for stationary vehicles.
              key={l.tracking_id || l.gps_tracking_id || l.trip_id || l.vehicle_id || `${lat},${lng},${i}`}
              center={[lat, lng]}
              eventHandlers={onSelectTrip && l.trip_id != null ? { click: () => onSelectTrip(l.trip_id) } : undefined}
              radius={selected ? 11 : 8}
              pathOptions={{
                color: "#ffffff",
                weight: selected ? 3 : 2.5,
                fillColor: color,
                fillOpacity: selected ? 1 : 0.85,
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
                    {driver && <p className="truncate">Driver: {driver}</p>}
                    <p className="flex items-center gap-1.5 font-data">
                      <Compass className="w-3.5 h-3.5 text-primary" />
                      {lat.toFixed(4)}, {lng.toFixed(4)}
                    </p>
                    {speedKmh != null && (
                      <p className="text-[11px] text-foreground-muted font-data">
                        Speed: {speedKmh.toFixed(1)} km/h
                      </p>
                    )}
                    {l.accuracy != null && <p className="text-[11px] text-foreground-muted font-data">Accuracy: {Math.round(Number(l.accuracy))} m</p>}
                    <p className="text-[11px] font-semibold text-foreground-muted">GPS: {health.label}</p>
                    {l.recorded_at && <p className="text-[11px] text-foreground-muted font-data">Last update: {new Date(l.recorded_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>}
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

              {hasIdentity ? (
                <Tooltip permanent offset={[0, -12]} direction="top" className="fleet-tooltip">
                  <div className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 font-semibold text-xs font-data">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      {plate}
                    </span>
                    {driver && <span className="text-[11px] font-medium">{driver}</span>}
                  </div>
                </Tooltip>
              ) : (
                <Tooltip className="fleet-tooltip">
                  <div className="font-semibold text-xs">{plate}</div>
                  {status && <div className="text-[11px] opacity-80">{status}</div>}
                  <div className="text-[11px] opacity-80">GPS: {health.label}</div>
                </Tooltip>
              )}
            </CircleMarker>
          );
        })}

        <MapControls
          trafficOn={trafficOn}
          onTraffic={() => setTrafficOn((v) => !v)}
          legendOn={legendOn}
          onLegend={() => setLegendOn((v) => !v)}
          mapStyle={mapStyle}
          onMapStyle={setMapStyle}
          hasTomTomKey={hasTomTomKey}
        />
      </MapContainer>

      {/* Ctrl + scroll zoom hint (flashed on plain wheel scroll) */}
      <ZoomHintOverlay show={showZoomHint} />

      {/* Floating Traffic Active Indicator */}
      {trafficOn && (
        <div className="pointer-events-none absolute left-3 top-3 z-[1000] flex items-center gap-2 rounded-2xl border border-success/30 bg-surface/95 px-3.5 py-2 shadow-md backdrop-blur text-xs font-semibold text-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          Live Traffic Layer Active <span className="text-[11px] text-foreground-muted font-medium font-data">(Real-Time Flow)</span>
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
          background: var(--pin, #3b82f6);
          border: 2.5px solid #ffffff;
          box-shadow: 0 4px 10px rgb(17 24 39 / 0.35);
        }
        .fleet-pin span { transform: rotate(45deg); color: #fff; font-size: 14px; }
        .fleet-tooltip { border: 1px solid var(--br); border-radius: 12px; box-shadow: var(--shadow-sm); font-family: var(--font-sans); }
        .leaflet-popup-content-wrapper { border-radius: 16px; border: 1px solid var(--br); background: var(--sf); box-shadow: var(--shadow-lg); }
        .leaflet-popup-tip { background: var(--sf); }
      `}</style>
    </div>
  );
}
