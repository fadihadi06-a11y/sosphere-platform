import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MapPin, Navigation, Hospital, Shield,
  Flame, Phone, ChevronRight, X, Clock, Route,
  Locate, Layers, Users, ArrowLeft,
  Star, Compass,
} from "lucide-react";
import L from "leaflet";

// Inject Leaflet CSS
if (typeof document !== "undefined" && !document.getElementById("leaflet-css-map")) {
  const link = document.createElement("link");
  link.id = "leaflet-css-map";
  link.rel = "stylesheet";
  link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(link);
}

// Fix default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── Types ─────────────────────────────────────────────────────
type PlaceCategory = "all" | "hospital" | "police" | "fire";

interface NearbyPlace {
  id: string;
  name: string;
  type: "hospital" | "police" | "fire";
  distance: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
}

const typeConfig = {
  hospital: { icon: Hospital, color: "#FF2D55", label: "Hospital", emoji: "🏥" },
  police: { icon: Shield, color: "#007AFF", label: "Police", emoji: "🛡️" },
  fire: { icon: Flame, color: "#FF9500", label: "Fire", emoji: "🚒" },
};

// ─── Component ─────────────────────────────────────────────────
interface MapScreenProps {
  onBack?: () => void;
}

export function MapScreen({ onBack }: MapScreenProps) {
  const [category, setCategory] = useState<PlaceCategory>("all");
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState(false);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const placeMarkersRef = useRef<L.Marker[]>([]);

  // ── GPS ──
  const retryGPS = useCallback(() => {
    setGpsError(false);
    const tryGPS = async () => {
      // 1. Cached position from SOS tracker
      try {
        const { getLastKnownPosition } = await import("./offline-gps-tracker");
        const lk = getLastKnownPosition();
        if (lk) { setGpsCoords({ lat: lk.lat, lng: lk.lng }); return; }
      } catch {}
      // 2. Browser Geolocation
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => setGpsCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => setGpsError(true),
          { enableHighAccuracy: true, timeout: 20000 }
        );
      } else {
        setGpsError(true);
      }
    };
    tryGPS();
  }, []);

  useEffect(() => { retryGPS(); }, [retryGPS]);

  // ── Generate nearby places around user position ──
  useEffect(() => {
    if (!gpsCoords) return;
    const { lat, lng } = gpsCoords;
    // Place mock emergency services around the user's real location
    const places: NearbyPlace[] = [
      { id: "h1", name: "Nearest Hospital", type: "hospital", distance: "1.2 km", address: "Emergency services", phone: "911", lat: lat + 0.008, lng: lng + 0.005 },
      { id: "h2", name: "Medical Center", type: "hospital", distance: "2.5 km", address: "24H Emergency", phone: "911", lat: lat - 0.006, lng: lng + 0.012 },
      { id: "p1", name: "Police Station", type: "police", distance: "0.8 km", address: "Local police", phone: "999", lat: lat + 0.004, lng: lng - 0.007 },
      { id: "p2", name: "Security Office", type: "police", distance: "1.9 km", address: "Security patrol", phone: "999", lat: lat - 0.009, lng: lng - 0.004 },
      { id: "f1", name: "Fire Station", type: "fire", distance: "1.5 km", address: "Fire & rescue", phone: "998", lat: lat + 0.01, lng: lng - 0.003 },
    ];
    setNearbyPlaces(places);
  }, [gpsCoords]);

  // ── Initialize Leaflet Map ──
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const defaultCenter: [number, number] = gpsCoords ? [gpsCoords.lat, gpsCoords.lng] : [24.7136, 46.6753];
    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 14,
      zoomControl: false,
      attributionControl: false,
    });

    // Dark tile layer (CartoDB Dark Matter)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(map);

    // Add zoom control to bottom-right
    L.control.zoom({ position: "bottomright" }).addTo(map);

    mapRef.current = map;

    // Cleanup
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // Only init once

  // ── Update map center when GPS acquired ──
  useEffect(() => {
    if (!gpsCoords || !mapRef.current) return;
    mapRef.current.setView([gpsCoords.lat, gpsCoords.lng], 15, { animate: true });

    // User location marker (pulsing blue dot)
    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng([gpsCoords.lat, gpsCoords.lng]);
    } else {
      // Accuracy circle
      L.circle([gpsCoords.lat, gpsCoords.lng], {
        radius: 50,
        color: "#00C8E0",
        fillColor: "#00C8E0",
        fillOpacity: 0.06,
        weight: 1,
        opacity: 0.2,
      }).addTo(mapRef.current);

      // User dot
      userMarkerRef.current = L.circleMarker([gpsCoords.lat, gpsCoords.lng], {
        radius: 8,
        color: "#fff",
        fillColor: "#00C8E0",
        fillOpacity: 1,
        weight: 3,
      }).addTo(mapRef.current);

      userMarkerRef.current.bindTooltip("You", {
        permanent: true,
        direction: "bottom",
        offset: [0, 10],
        className: "sosphere-tooltip",
      });
    }
  }, [gpsCoords]);

  // ── Place markers on map ──
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear old markers
    placeMarkersRef.current.forEach(m => m.remove());
    placeMarkersRef.current = [];

    const filtered = category === "all" ? nearbyPlaces : nearbyPlaces.filter(p => p.type === category);

    filtered.forEach(place => {
      const cfg = typeConfig[place.type];
      const icon = L.divIcon({
        className: "",
        html: `<div style="
          width:32px;height:32px;border-radius:50%;
          background:${cfg.color};
          border:3px solid rgba(255,255,255,0.9);
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 8px ${cfg.color}60;
          font-size:14px;
        ">${cfg.emoji}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([place.lat, place.lng], { icon })
        .addTo(mapRef.current!)
        .on("click", () => setSelectedPlace(place));

      marker.bindTooltip(place.name, {
        direction: "top",
        offset: [0, -18],
      });

      placeMarkersRef.current.push(marker);
    });
  }, [nearbyPlaces, category]);

  // ── Inject custom tooltip style ──
  useEffect(() => {
    if (document.getElementById("sosphere-map-style")) return;
    const style = document.createElement("style");
    style.id = "sosphere-map-style";
    style.textContent = `
      .sosphere-tooltip {
        background: rgba(0,200,224,0.15) !important;
        border: 1px solid rgba(0,200,224,0.3) !important;
        color: #00C8E0 !important;
        font-weight: 700 !important;
        font-size: 10px !important;
        padding: 2px 6px !important;
        border-radius: 6px !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
      }
      .sosphere-tooltip::before { border-bottom-color: rgba(0,200,224,0.3) !important; }
      .leaflet-container { background: #0a0e1a !important; }
    `;
    document.head.appendChild(style);
  }, []);

  const filteredPlaces = category === "all" ? nearbyPlaces : nearbyPlaces.filter(p => p.type === category);

  const categories: { id: PlaceCategory; label: string; icon: typeof MapPin; color: string }[] = [
    { id: "all", label: "All", icon: Layers, color: "#00C8E0" },
    { id: "hospital", label: "Hospitals", icon: Hospital, color: "#FF2D55" },
    { id: "police", label: "Police", icon: Shield, color: "#007AFF" },
    { id: "fire", label: "Fire Dept", icon: Flame, color: "#FF9500" },
  ];

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>

      {/* ── Real Leaflet Map ── */}
      <div className="relative flex-1">
        <div ref={mapContainerRef} className="absolute inset-0 z-0" />

        {/* GPS Loading Overlay */}
        {!gpsCoords && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center" style={{ background: "rgba(5,7,14,0.85)", backdropFilter: "blur(6px)" }}>
            <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }}>
              <Compass style={{ width: 40, height: 40, color: "#00C8E0" }} />
            </motion.div>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#00C8E0", marginTop: 14 }}>
              {gpsError ? "GPS Unavailable" : "Acquiring GPS..."}
            </p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>
              {gpsError ? "Enable location services in Settings" : "Finding your location"}
            </p>
            {gpsError && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={retryGPS}
                className="mt-4 px-5 py-2.5"
                style={{ borderRadius: 12, background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)", color: "#00C8E0", fontSize: 13, fontWeight: 600 }}
              >
                Retry
              </motion.button>
            )}
          </div>
        )}

        {/* ── Top Controls ── */}
        <div className="absolute top-0 left-0 right-0 z-30 pt-12 px-4 pb-2"
          style={{ background: "linear-gradient(180deg, rgba(5,7,14,0.92) 0%, rgba(5,7,14,0.6) 60%, transparent 100%)" }}
        >
          <div className="flex items-center gap-3 mb-3">
            {onBack && (
              <motion.button whileTap={{ scale: 0.9 }} onClick={onBack}
                className="size-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
                <ArrowLeft style={{ width: 16, height: 16, color: "rgba(255,255,255,0.7)" }} />
              </motion.button>
            )}
            <div className="flex-1">
              <p className="text-white" style={{ fontSize: 17, fontWeight: 700 }}>Nearby Safety</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
                {gpsCoords ? `${gpsCoords.lat.toFixed(4)}°N, ${gpsCoords.lng.toFixed(4)}°E` : gpsError ? "Tap locate to retry" : "Acquiring GPS..."}
              </p>
            </div>
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => {
              if (gpsCoords && mapRef.current) {
                mapRef.current.setView([gpsCoords.lat, gpsCoords.lng], 15, { animate: true });
              } else {
                retryGPS();
              }
            }}
              className="size-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
              <Locate style={{ width: 15, height: 15, color: "#00C8E0" }} />
            </motion.button>
          </div>

          {/* Category Filters */}
          <div className="flex gap-2">
            {categories.map((cat) => {
              const isActive = category === cat.id;
              const CatIcon = cat.icon;
              return (
                <motion.button key={cat.id} whileTap={{ scale: 0.95 }}
                  onClick={() => { setCategory(cat.id); setSelectedPlace(null); }}
                  className="flex items-center gap-1.5 px-3 py-2"
                  style={{
                    borderRadius: 12,
                    background: isActive ? `${cat.color}15` : "rgba(10,14,28,0.7)",
                    border: `1px solid ${isActive ? `${cat.color}30` : "rgba(255,255,255,0.06)"}`,
                    backdropFilter: "blur(12px)",
                  }}>
                  <CatIcon style={{ width: 12, height: 12, color: isActive ? cat.color : "rgba(255,255,255,0.25)" }} />
                  <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 500, color: isActive ? cat.color : "rgba(255,255,255,0.3)" }}>
                    {cat.label}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── Bottom: Selected Place Card ── */}
        <div className="absolute bottom-0 left-0 right-0 z-30 pb-24">
          <AnimatePresence>
            {selectedPlace && (
              <motion.div
                key="place-card"
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="mx-4"
              >
                <div className="p-4" style={{
                  borderRadius: 20,
                  background: "rgba(10,18,32,0.95)",
                  border: `1px solid ${typeConfig[selectedPlace.type].color}20`,
                  backdropFilter: "blur(30px)",
                }}>
                  <div className="flex items-start gap-3">
                    <div className="size-11 rounded-[13px] flex items-center justify-center shrink-0"
                      style={{ background: `${typeConfig[selectedPlace.type].color}12`, border: `1px solid ${typeConfig[selectedPlace.type].color}25` }}>
                      {(() => { const Ic = typeConfig[selectedPlace.type].icon; return <Ic style={{ width: 17, height: 17, color: typeConfig[selectedPlace.type].color }} />; })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate" style={{ fontSize: 14, fontWeight: 700 }}>{selectedPlace.name}</p>
                      <p className="truncate" style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>{selectedPlace.address}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex items-center gap-1">
                          <Route style={{ width: 10, height: 10, color: "#00C8E0" }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#00C8E0" }}>{selectedPlace.distance}</span>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => setSelectedPlace(null)}>
                      <X style={{ width: 16, height: 16, color: "rgba(255,255,255,0.25)" }} />
                    </button>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <motion.button whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        if (gpsCoords) {
                          window.open(`https://www.google.com/maps/dir/?api=1&origin=${gpsCoords.lat},${gpsCoords.lng}&destination=${selectedPlace.lat},${selectedPlace.lng}&travelmode=driving`, "_blank");
                        }
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5"
                      style={{ borderRadius: 12, background: `${typeConfig[selectedPlace.type].color}12`, border: `1px solid ${typeConfig[selectedPlace.type].color}25`, fontSize: 12, fontWeight: 600, color: typeConfig[selectedPlace.type].color }}>
                      <Navigation style={{ width: 13, height: 13 }} />
                      Directions
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.97 }}
                      onClick={() => { window.location.href = `tel:${selectedPlace.phone}`; }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5"
                      style={{ borderRadius: 12, background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)", fontSize: 12, fontWeight: 600, color: "#00C853" }}>
                      <Phone style={{ width: 13, height: 13 }} />
                      Call {selectedPlace.phone}
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
