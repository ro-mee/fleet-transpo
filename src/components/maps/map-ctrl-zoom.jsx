"use client";

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

// Ctrl/⌘ + scroll to zoom. The map ignores plain wheel scrolling (so the page
// can scroll through it) and flashes a hint overlay instead. Shared by every
// map view — incident map, live tracking map, trip detail map, dashboards.
export function MapCtrlZoom({ setShowHint }) {
  const map = useMap();
  const timeoutRef = useRef(null);

  useEffect(() => {
    map.scrollWheelZoom.disable();

    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (!map.scrollWheelZoom.enabled()) {
          map.scrollWheelZoom.enable();
        }
        setShowHint(false);
      } else {
        if (map.scrollWheelZoom.enabled()) {
          map.scrollWheelZoom.disable();
        }
        setShowHint(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setShowHint(false), 1200);
      }
    };

    const container = map.getContainer();
    container.addEventListener("wheel", onWheel, { capture: true });

    return () => {
      container.removeEventListener("wheel", onWheel, { capture: true });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [map, setShowHint]);

  return null;
}

// Transient "ctrl + scroll" hint flashed over the map on plain wheel scroll.
// Render outside <MapContainer>, inside the map's relative wrapper.
export function ZoomHintOverlay({ show }) {
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/20 pointer-events-none transition-opacity duration-300">
      <p className="px-5 py-2.5 bg-surface/90 backdrop-blur-md rounded-xl text-foreground font-semibold shadow-lg text-sm text-center">
        Use <kbd className="font-mono bg-muted/80 border border-border/50 px-1.5 py-0.5 rounded text-[11px] mx-1">ctrl</kbd> + scroll to zoom the map
      </p>
    </div>
  );
}
