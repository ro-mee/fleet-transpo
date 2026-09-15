"use client";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { rasterTileUrl } from '@/lib/tomtom';
import { CHART_COLORS } from '@/lib/chart-tokens';

export default function DispatchRadar({ pins = [] }) {
  if (!pins.length) return <p className="text-sm text-foreground-secondary py-4">No verified standby positions for this request.</p>;
  return <div className="h-64 overflow-hidden rounded-xl border border-border" aria-label="Verified standby candidates">
    <MapContainer key={pins.map(p => p.driverId).join(',')} center={[pins[0].latitude,pins[0].longitude]} zoom={12} style={{ height:'100%',width:'100%' }}>
      <TileLayer url={rasterTileUrl()} attribution="&copy; TomTom" />
      {pins.map(pin => <CircleMarker key={pin.driverId} center={[pin.latitude,pin.longitude]} radius={8} pathOptions={{ color:CHART_COLORS.success,fillOpacity:0.65 }}>
        <Tooltip>{pin.label} · {Math.round(pin.etaMinutes)} min to pickup</Tooltip>
      </CircleMarker>)}
    </MapContainer>
  </div>;
}
