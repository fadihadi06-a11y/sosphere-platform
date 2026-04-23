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
      // AUDIT-FIX (2026-04-22): spaced markers out so hover tooltips
      // don't visually collide with neighbouring icons. Previous layout
      // placed Hospital h1 (+0.008,+0.005) and Fire f1 (+0.01,-0.003)
      // vertically close enough that the hospital's tooltip (rendered
      // above the marker with offset [0,-18]) visually landed over the
      // fire truck icon, making it look like "Nearest Hospital" was
      // pointing to the fire station.
      { id: "h1", name: "Nearest Hospital", type: "hospital", distance: "1.2 km", address: "Emergency services", phone: "911", lat: lat + 0.007, lng: lng + 0.010 },
      { id: "h2", name: "Medical Center", type: "hospital", distance: "2.5 km", address: "24H Emergency", phone: "911", lat: lat - 0.008, lng: lng + 0.014 },
      { id: "p1", name: "Police Station", type: "police", distance: "0.8 km", address: "Local police", phone: "999", lat: lat + 0.003, lng: lng - 0.009 },
      { id: "p2", name: "Security Office", type: "police", distance: "1.9 km", address: "Security patrol", phone: "999", lat: lat - 0.011, lng: lng - 0.005 },
      { id: "f1", name: "Fire Station", type: "fire", distance: "1.5 km", address: "Fire & rescue", phone: "998", lat: lat + 0.014, lng: lng - 0.012 },
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

      // AUDIT-FIX (2026-04-22): type-specific tooltip class so each
      // tooltip inherits the colour of its marker (red=hospital,
      // blue=police, orange=fire). Previously all tooltips were cyan
      // which made "Nearest Hospital" look like it belonged to any
      // nearby marker. Also switched to `direction: auto` so Leaflet
      // flips the tooltip to the side that has room, preventing the
      // label from landing on top of an adjacent marker icon.
      marker.bindTooltip(place.name, {
        direction: "auto",
        offset: [0, -18],
        className: `sosphere-tooltip sosphere-tooltip-${place.type}`,
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
        background: rgba(10,16,32,0.95) !important;
        border: 1px solid rgba(255,255,255,0.15) !important;
        color: #fff !important;
        font-weight: 700 !important;
        font-size: 10px !important;
        padding: 3px 8px !important;
        border-radius: 6px !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.5) !important;
        white-space: nowrap !important;
      }
      .sosphere-tooltip-hospital { border-color: rgba(255,45,85,0.6) !important; color: #FF5A7A !important; }
      .sosphere-tooltip-police   { border-color: rgba(0,122,255,0.6) !important; color: #4A9BFF !important; }
      .sosphere-tooltip-fire     { border-color: rgba(255,149,0,0.6) !important; color: #FFB74D !important; }
      .sosphere-tooltip::before,
      .sosphere-tooltip-top::before { border-top-color: rgba(10,16,32,0.95) !important; }
      .sosphere-tooltip-bottom::before { border-bottom-color: rgba(10,16,32,0.95) !important; }
      .sosphere-tooltip-left::before { border-left-color: rgba(10,16,32,0.95) !important; }
      .sosphere-tooltip-right::before { border-right-color: rgba(10,16,32,0.95) !important; }
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

      {/* ── Top Controls — AUDIT-FIX (2026-04-21 v2): MOVED OUT of the
          map container. Now it's a flex sibling ABOVE the map, with
          natural height. This eliminates the `absolute` overlap where
          the map could render tiles behind / through the top bar
          (which was the source of the reported "stripes"). Map can
          ONLY paint below this bar now. */}
      <div
        className="shrink-0 px-4 pb-3 z-40"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 12px)",
          background: "#05070E",
          boxShadow: "0 1px 0 rgba(255,255,255,0.04)",
        }}
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
        <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {categories.map((cat) => {
            const isActive = category === cat.id;
            const CatIcon = cat.icon;
            return (
              <motion.button key={cat.id} whileTap={{ scale: 0.95 }}
                onClick={() => { setCategory(cat.id); setSelectedPlace(null); }}
                className="flex items-center gap-1.5 px-3 py-2 shrink-0"
                style={{
                  borderRadius: 12,
                  background: isActive ? `${cat.color}15` : "rgba(10,14,28,0.85)",
                  boxShadow: `inset 0 0 0 1px ${isActive ? `${cat.color}40` : "rgba(255,255,255,0.08)"}`,
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

      {/* ── Real Leaflet Map ── */}
      <div className="relative flex-1">
        <div ref={mapContainerRef} className="absolute inset-0 z-0" style={{ background: "#05070E" }} />

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

        {/* AUDIT-FIX (2026-04-21 v2): the absolute Top Controls was moved
            OUT to be a flex sibling above the map — see start of return. */}

        {/* ── Bottom: Selected Place Card ──
            AUDIT-FIX (2026-04-22 v4): user reported horizontal scan-
            line noise (tearing) on MIUI WebView covering the bottom
            area when tapping a place marker. Root cause identified
            from actual device screenshot: the previous structure had
            (a) an outer wrapper div with `transition: background 180ms`
            that animated from transparent → #05070E on selection, and
            (b) an INNER `motion.div` doing `translateY(100 → 0)` on
            top of the wrapper. On MIUI's GPU compositor, this stacks
            two animating layers directly above the Leaflet OpenGL map
            layer — during the transition window the background is
            partially transparent AND the inner layer is transform-
            animating. The compositor can't keep the map tiles and the
            two moving translucent layers in sync, producing the scan-
            line noise.

            Fix: one single AnimatePresence → one single motion.div
            that owns BOTH the opaque backdrop strip AND the card.
            No CSS `transition`, no nested animated layers. The
            wrapper is only in the DOM when `selectedPlace` is set,
            and it carries a fully opaque #05070E from the very first
            paint — so the map is never peeking through a semi-
            transparent layer. `transform: translateZ(0)`, `isolation:
            isolate` and `willChange: transform` force this node onto
            its own compositor layer, fully detached from the map
            below. Net result: no half-rendered frames, no tearing. */}
        <AnimatePresence>
          {selectedPlace && (
            <motion.div
              key="place-card-wrapper"
              initial={{ y: 140 }}
              animate={{ y: 0 }}
              exit={{ y: 140 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-30"
              style={{
                paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)",
                paddingTop: 16,
                background: "#05070E",        // ALWAYS solid from first paint
                isolation: "isolate",          // own stacking context
                transform: "translateZ(0)",    // force GPU layer
                willChange: "transform",       // hint compositor
                backfaceVisibility: "hidden",  // avoid sub-pixel flicker
              }}
            >
              <div className="mx-4">
                <div className="p-4" style={{
                  borderRadius: 20,
                  background: "#0A1220",
                  boxShadow: `inset 0 0 0 1px ${typeConfig[selectedPlace.type].color}40, 0 8px 24px rgba(0,0,0,0.6)`,
                }}>
                  <div className="flex items-start gap-3">
                    <div className="size-11 rounded-[13px] flex items-center justify-center shrink-0"
                      style={{ background: `${typeConfig[selectedPlace.type].color}20`, boxShadow: `inset 0 0 0 1px ${typeConfig[selectedPlace.type].color}40` }}>
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
                        // Capacitor WebView ignores target="_blank"; use geo: intent first,
                        // fall back to Google Maps URL if the device has no geo handler.
                        if (!gpsCoords) return;
                        const geoUri = `geo:${selectedPlace.lat},${selectedPlace.lng}?q=${selectedPlace.lat},${selectedPlace.lng}(${encodeURIComponent(selectedPlace.name)})`;
                        const webUrl = `https://www.google.com/maps/dir/?api=1&origin=${gpsCoords.lat},${gpsCoords.lng}&destination=${selectedPlace.lat},${selectedPlace.lng}&travelmode=driving`;
                        try {
                          // Try native geo intent first (best on Android)
                          window.location.href = geoUri;
                          // If still on page after 600ms, fall back to web URL
                          setTimeout(() => { window.location.href = webUrl; }, 600);
                        } catch {
                          window.location.href = webUrl;
                        }
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5"
                      style={{ borderRadius: 12, background: `${typeConfig[selectedPlace.type].color}1F`, boxShadow: `inset 0 0 0 1px ${typeConfig[selectedPlace.type].color}40`, fontSize: 12, fontWeight: 700, color: typeConfig[selectedPlace.type].color }}>
                      <Navigation style={{ width: 13, height: 13 }} />
                      Directions
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.97 }}
                      onClick={async () => {
                        // AUDIT-FIX (2026-04-21 v5): replace tel: URL (which
                        // showed app chooser with WhatsApp/Zoom on MIUI)
                        // with clipboard copy + toast. User opens dialer
                        // themselves and pastes — no chooser possible.
                        try {
                          await navigator.clipboard?.writeText(selectedPlace.phone);
                          import("sonner").then(m => m.toast(`${selectedPlace.phone} copied`, {
                            description: "Open your dialer and paste to call",
                          }));
                        } catch {
                          import("sonner").then(m => m.toast("Dial " + selectedPlace.phone, {
                            description: "Copy the number and dial manually",
                          }));
                        }
                      }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5"
                      style={{ borderRadius: 12, background: "rgba(0,200,83,0.12)", boxShadow: "inset 0 0 0 1px rgba(0,200,83,0.3)", fontSize: 12, fontWeight: 700, color: "#00C853" }}>
                      <Phone style={{ width: 13, height: 13 }} />
                      Call {selectedPlace.phone}
                    </motion.button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
