// ═══════════════════════════════════════════════════════════════
// SOSphere — Emergency Location Map
// ─────────────────────────────────────────────────────────────
// Real Leaflet map for the emergency detail view. Plots the worker's
// ACTUAL GPS coordinates (lat/lng) with a marker + radius circle, on the
// same CartoDB dark tiles used by the geofence/SAR maps.
//
// Honest fallback: many emergencies have no GPS fix (e.g. an admin-created
// "Manual SOS" has no coordinates). In that case we render a clearly-labelled
// "No GPS fix" placeholder instead of pretending a position exists.
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Navigation } from "lucide-react";

export function EmergencyLocationMap({ lat, lng, radius = 100, address }: {
  lat?: number;
  lng?: number;
  radius?: number;
  address?: string;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const hasCoords =
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  useEffect(() => {
    if (!hasCoords || !elRef.current) return;
    // Tear down any prior map instance (re-select / coord change).
    if (mapRef.current) { try { mapRef.current.remove(); } catch { /* */ } mapRef.current = null; }

    const map = L.map(elRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      dragging: true,
    }).setView([lat as number, lng as number], 15);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      subdomains: "abcd",
    }).addTo(map);

    L.circle([lat as number, lng as number], {
      radius: radius || 100,
      color: "#FF2D55",
      weight: 1,
      fillColor: "#FF2D55",
      fillOpacity: 0.08,
    }).addTo(map);

    const icon = L.divIcon({
      className: "",
      html: '<div style="width:16px;height:16px;border-radius:50%;background:rgba(255,45,85,0.35);border:2px solid #FF2D55;box-shadow:0 0 0 6px rgba(255,45,85,0.12)"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker([lat as number, lng as number], { icon }).addTo(map);

    mapRef.current = map;
    // The card is hidden/animated on mount — recompute size once it's laid out.
    const t = setTimeout(() => { try { map.invalidateSize(); } catch { /* */ } }, 150);

    return () => {
      clearTimeout(t);
      try { map.remove(); } catch { /* */ }
      mapRef.current = null;
    };
  }, [lat, lng, radius, hasCoords]);

  if (!hasCoords) {
    // Honest placeholder — no fabricated position.
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-2"
        style={{ background: "linear-gradient(135deg, #0A1220 0%, #0F1B2E 100%)", position: "relative" }}
      >
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "linear-gradient(rgba(0,200,224,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,200,224,0.03) 1px, transparent 1px)",
          backgroundSize: "30px 30px", opacity: 0.4,
        }} />
        <Navigation className="size-5" style={{ color: "rgba(255,255,255,0.3)", zIndex: 1 }} />
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", zIndex: 1, textAlign: "center", padding: "0 8px" }}>
          No GPS fix{address ? ` · ${address}` : ""}
        </span>
      </div>
    );
  }

  return <div ref={elRef} style={{ width: "100%", height: "100%" }} />;
}
