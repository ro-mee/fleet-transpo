"use client";

import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export default function LiveLocationsMap({ locations = [] }) {
  if (typeof window === "undefined") return null;
  const valid = locations.filter((l) => l && l.latitude != null && l.longitude != null);
  if (valid.length === 0) return null;
  const center = [valid[0].latitude, valid[0].longitude];

  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom={false}
      className="h-full w-full z-0"
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {valid.map((l, i) => (
        <CircleMarker
          key={i}
          center={[l.latitude, l.longitude]}
          radius={8}
          pathOptions={{ color: "#161616", weight: 2, fillColor: "#3b82f6", fillOpacity: 0.8 }}
        >
          <Tooltip>{l.plate_number || l.vehicle_name || `Vehicle ${i + 1}`}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
