import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MapPin, Navigation, Hospital, Shield, Flame, Phone, ChevronRight, X, Clock, Route, Locate, Layers, Users, ChevronUp, Star } from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";

// ─── Types ─────────────────────────────────────────────────────────────────────
type PlaceCategory = "all" | "hospital" | "police" | "fire";

interface NearbyPlace {
  id: string;
  name: string;
  type: "hospital" | "police" | "fire";
  distance: string;
  eta: string;
  address: string;
  phone: string;
  rating: number;
  open24h: boolean;
  lat: number;
  lng: number;
}

interface FamilyPin {
  id: number;
  name: string;
  avatar: string;
  online: boolean;
  x: number;
  y: number;
}

// ─── Mock Data ─────────────────────────────────────────────────────────────────
const nearbyPlaces: NearbyPlace[] = [
  {
    id: "h1", name: "King Faisal Specialist Hospital", type: "hospital",
    distance: "1.2 km", eta: "4 min", address: "Al Mathar Ash Shamali, Riyadh",
    phone: "+966 11 464 7272", rating: 4.8, open24h: true, lat: 24.72, lng: 46.68,
  },
  {
    id: "h2", name: "Al Habib Medical Center", type: "hospital",
    distance: "2.4 km", eta: "8 min", address: "Olaya St, Al Olaya, Riyadh",
    phone: "+966 11 462 2222", rating: 4.6, open24h: true, lat: 24.71, lng: 46.67,
  },
  {
    id: "p1", name: "Al Olaya Police Station", type: "police",
    distance: "0.8 km", eta: "2 min", address: "King Fahad Rd, Riyadh",
    phone: "999", rating: 4.2, open24h: true, lat: 24.715, lng: 46.672,
  },
  {
    id: "p2", name: "Riyadh Central Security", type: "police",
    distance: "3.1 km", eta: "10 min", address: "Al Batha, Riyadh",
    phone: "999", rating: 4.0, open24h: true, lat: 24.63, lng: 46.72,
  },
  {
    id: "f1", name: "Civil Defense Station #12", type: "fire",
    distance: "1.8 km", eta: "5 min", address: "Al Malaz, Riyadh",
    phone: "998", rating: 4.5, open24h: true, lat: 24.66, lng: 46.71,
  },
];

const familyPins: FamilyPin[] = [
  { id: 1, name: "Sarah", avatar: "https://images.unsplash.com/photo-1655249493799-9cee4fe983bb?w=80&h=80&fit=crop", online: true, x: 55, y: 38 },
  { id: 2, name: "Alex", avatar: "https://images.unsplash.com/photo-1631905131477-eefc1360588a?w=80&h=80&fit=crop", online: true, x: 35, y: 62 },
  { id: 3, name: "Mom", avatar: "https://images.unsplash.com/photo-1758686254563-5c5ab338c8b9?w=80&h=80&fit=crop", online: false, x: 72, y: 55 },
];

const typeConfig = {
  hospital: { icon: Hospital, color: "#FF2D55", label: "Hospital", bg: "rgba(255,45,85,0.08)" },
  police: { icon: Shield, color: "#007AFF", label: "Police", bg: "rgba(0,122,255,0.08)" },
  fire: { icon: Flame, color: "#FF9500", label: "Fire", bg: "rgba(255,150,0,0.08)" },
};

// ─── Component ─────────────────────────────────────────────────────────────────
export function MapScreen() {
  const [category, setCategory] = useState<PlaceCategory>("all");
  const [selectedPlace, setSelectedPlace] = useState<NearbyPlace | null>(null);
  const [showList, setShowList] = useState(false);
  const [showFamily, setShowFamily] = useState(true);
  const [userPulse, setUserPulse] = useState(true);

  const filteredPlaces = category === "all"
    ? nearbyPlaces
    : nearbyPlaces.filter(p => p.type === category);

  const categories: { id: PlaceCategory; label: string; icon: typeof MapPin; color: string }[] = [
    { id: "all", label: "All", icon: Layers, color: "#00C8E0" },
    { id: "hospital", label: "Hospitals", icon: Hospital, color: "#FF2D55" },
    { id: "police", label: "Police", icon: Shield, color: "#007AFF" },
    { id: "fire", label: "Fire Dept", icon: Flame, color: "#FF9500" },
  ];

  // Mock place positions on map
  const placePositions: Record<string, { x: number; y: number }> = {
    h1: { x: 60, y: 30 }, h2: { x: 25, y: 50 },
    p1: { x: 70, y: 45 }, p2: { x: 20, y: 70 },
    f1: { x: 75, y: 65 },
  };

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      
      {/* ── Map Area ── */}
      <div className="relative flex-1">
        {/* Dark Map Background */}
        <div className="absolute inset-0" style={{
          background: `
            radial-gradient(ellipse at 50% 50%, rgba(0,200,224,0.03) 0%, transparent 50%),
            linear-gradient(180deg, #080C18 0%, #05070E 100%)
          `,
        }}>
          {/* Grid Pattern */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.04]">
            <defs>
              <pattern id="mapGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#mapGrid)" />
          </svg>

          {/* Road Lines */}
          <svg className="absolute inset-0 w-full h-full">
            {/* Major roads */}
            <line x1="0" y1="50%" x2="100%" y2="50%" stroke="rgba(0,200,224,0.06)" strokeWidth="3" />
            <line x1="50%" y1="0" x2="50%" y2="100%" stroke="rgba(0,200,224,0.06)" strokeWidth="3" />
            {/* Secondary roads */}
            <line x1="0" y1="30%" x2="100%" y2="35%" stroke="rgba(255,255,255,0.02)" strokeWidth="1.5" />
            <line x1="25%" y1="0" x2="30%" y2="100%" stroke="rgba(255,255,255,0.02)" strokeWidth="1.5" />
            <line x1="0" y1="70%" x2="100%" y2="68%" stroke="rgba(255,255,255,0.02)" strokeWidth="1.5" />
            <line x1="75%" y1="0" x2="72%" y2="100%" stroke="rgba(255,255,255,0.02)" strokeWidth="1.5" />
            {/* Diagonal */}
            <line x1="10%" y1="20%" x2="80%" y2="75%" stroke="rgba(255,255,255,0.015)" strokeWidth="1" />
          </svg>

          {/* Area Labels */}
          <div className="absolute" style={{ top: "18%", left: "15%", fontSize: 8, color: "rgba(255,255,255,0.06)", fontWeight: 600, letterSpacing: "1.5px" }}>
            AL OLAYA
          </div>
          <div className="absolute" style={{ top: "60%", left: "55%", fontSize: 8, color: "rgba(255,255,255,0.06)", fontWeight: 600, letterSpacing: "1.5px" }}>
            AL MALAZ
          </div>
          <div className="absolute" style={{ top: "75%", left: "15%", fontSize: 7, color: "rgba(255,255,255,0.04)", fontWeight: 600, letterSpacing: "1px" }}>
            KING FAHAD RD
          </div>

          {/* Place Pins */}
          {filteredPlaces.map((place) => {
            const pos = placePositions[place.id];
            if (!pos) return null;
            const cfg = typeConfig[place.type];
            const isSelected = selectedPlace?.id === place.id;

            return (
              <motion.button
                key={place.id}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                onClick={() => { setSelectedPlace(place); setShowList(false); }}
                className="absolute z-10 flex flex-col items-center"
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -100%)" }}
              >
                {isSelected && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-1 px-2 py-1 whitespace-nowrap"
                    style={{
                      borderRadius: 8, background: "rgba(10,18,32,0.95)",
                      border: `1px solid ${cfg.color}30`,
                      backdropFilter: "blur(12px)",
                    }}
                  >
                    <p style={{ fontSize: 9, fontWeight: 600, color: cfg.color }}>{place.name}</p>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{place.distance} · {place.eta}</p>
                  </motion.div>
                )}
                <div
                  className="size-8 rounded-full flex items-center justify-center"
                  style={{
                    background: isSelected ? cfg.color : cfg.bg,
                    border: `2px solid ${cfg.color}${isSelected ? "" : "40"}`,
                    boxShadow: isSelected ? `0 0 16px ${cfg.color}40` : "none",
                    transition: "all 0.2s",
                  }}
                >
                  <cfg.icon style={{ width: 13, height: 13, color: isSelected ? "#fff" : cfg.color }} />
                </div>
                <div className="size-1.5 rounded-full mt-0.5" style={{ background: cfg.color, opacity: 0.5 }} />
              </motion.button>
            );
          })}

          {/* Family Pins */}
          <AnimatePresence>
            {showFamily && familyPins.map((fam) => (
              <motion.div
                key={fam.id}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute z-10 flex flex-col items-center"
                style={{ left: `${fam.x}%`, top: `${fam.y}%`, transform: "translate(-50%, -50%)" }}
              >
                <div className="relative">
                  <div
                    className="size-8 rounded-full overflow-hidden"
                    style={{
                      border: `2px solid ${fam.online ? "#00C853" : "rgba(255,255,255,0.15)"}`,
                      boxShadow: fam.online ? "0 0 10px rgba(0,200,83,0.3)" : "none",
                    }}
                  >
                    <ImageWithFallback src={fam.avatar} alt={fam.name} className="w-full h-full object-cover" />
                  </div>
                  {fam.online && (
                    <motion.div
                      animate={{ scale: [1, 1.8, 1], opacity: [0.4, 0, 0.4] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute -inset-1 rounded-full"
                      style={{ border: "1px solid rgba(0,200,83,0.2)" }}
                    />
                  )}
                </div>
                <div
                  className="mt-1 px-1.5 py-[1px]"
                  style={{ borderRadius: 5, background: "rgba(10,18,32,0.85)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span style={{ fontSize: 8, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{fam.name}</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* User Location (Center) */}
          <div className="absolute z-20" style={{ left: "48%", top: "48%", transform: "translate(-50%, -50%)" }}>
            {/* Accuracy circle */}
            <motion.div
              animate={{ scale: [1, 1.3, 1], opacity: [0.15, 0.05, 0.15] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="absolute rounded-full"
              style={{
                width: 80, height: 80, left: -28, top: -28,
                background: "rgba(0,200,224,0.06)",
                border: "1px solid rgba(0,200,224,0.08)",
              }}
            />
            {/* Outer ring */}
            <motion.div
              animate={{ scale: [1, 1.15, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute rounded-full"
              style={{
                width: 32, height: 32, left: -4, top: -4,
                background: "rgba(0,200,224,0.12)",
                border: "1.5px solid rgba(0,200,224,0.2)",
              }}
            />
            {/* Core dot */}
            <div
              className="relative size-6 rounded-full flex items-center justify-center"
              style={{
                background: "#00C8E0",
                boxShadow: "0 0 20px rgba(0,200,224,0.4), 0 0 40px rgba(0,200,224,0.15)",
                border: "3px solid rgba(255,255,255,0.9)",
              }}
            />
            {/* Label */}
            <div className="absolute top-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
              <div className="px-2 py-[2px]" style={{ borderRadius: 6, background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.15)" }}>
                <span style={{ fontSize: 8, fontWeight: 700, color: "#00C8E0", letterSpacing: "0.3px" }}>YOU</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Top Controls Overlay ── */}
        <div className="absolute top-0 left-0 right-0 z-30 pt-[58px] px-5"
          style={{ background: "linear-gradient(180deg, rgba(5,7,14,0.9) 0%, rgba(5,7,14,0.4) 70%, transparent 100%)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-white" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.4px" }}>Nearby</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                {filteredPlaces.length} {category === "all" ? "services" : category === "hospital" ? "hospitals" : category === "police" ? "stations" : "fire depts"} found
              </p>
            </div>
            <div className="flex gap-2">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowFamily(!showFamily)}
                className="size-9 rounded-xl flex items-center justify-center"
                style={{
                  background: showFamily ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${showFamily ? "rgba(0,200,83,0.15)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                <Users style={{ width: 15, height: 15, color: showFamily ? "#00C853" : "rgba(255,255,255,0.2)" }} />
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                className="size-9 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}
              >
                <Locate style={{ width: 15, height: 15, color: "#00C8E0" }} />
              </motion.button>
            </div>
          </div>

          {/* Category Filters */}
          <div className="flex gap-2">
            {categories.map((cat) => {
              const isActive = category === cat.id;
              const CatIcon = cat.icon;
              return (
                <motion.button
                  key={cat.id}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => { setCategory(cat.id); setSelectedPlace(null); }}
                  className="flex items-center gap-1.5 px-3 py-2"
                  style={{
                    borderRadius: 12,
                    background: isActive ? `${cat.color}12` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${isActive ? `${cat.color}25` : "rgba(255,255,255,0.05)"}`,
                    backdropFilter: "blur(12px)",
                  }}
                >
                  <CatIcon style={{ width: 12, height: 12, color: isActive ? cat.color : "rgba(255,255,255,0.2)" }} />
                  <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 500, color: isActive ? cat.color : "rgba(255,255,255,0.25)" }}>
                    {cat.label}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── Bottom List Toggle ── */}
        <div className="absolute bottom-0 left-0 right-0 z-30">
          {/* Selected Place Card */}
          <AnimatePresence>
            {selectedPlace && !showList && (
              <motion.div
                key="selected-card"
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="mx-5 mb-3"
              >
                <div
                  className="p-4 relative overflow-hidden"
                  style={{
                    borderRadius: 20,
                    background: "rgba(10,18,32,0.95)",
                    border: `1px solid ${typeConfig[selectedPlace.type].color}18`,
                    backdropFilter: "blur(30px)",
                  }}
                >
                  <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none"
                    style={{ background: `radial-gradient(circle, ${typeConfig[selectedPlace.type].color}08, transparent 70%)` }}
                  />
                  <div className="flex items-start gap-3 relative z-10">
                    <div
                      className="size-11 rounded-[13px] flex items-center justify-center shrink-0"
                      style={{
                        background: typeConfig[selectedPlace.type].bg,
                        border: `1px solid ${typeConfig[selectedPlace.type].color}20`,
                      }}
                    >
                      {(() => { const Ic = typeConfig[selectedPlace.type].icon; return <Ic style={{ width: 17, height: 17, color: typeConfig[selectedPlace.type].color }} />; })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate" style={{ fontSize: 14, fontWeight: 700 }}>{selectedPlace.name}</p>
                      <p className="truncate" style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{selectedPlace.address}</p>
                      <div className="flex items-center gap-3 mt-2.5">
                        <div className="flex items-center gap-1">
                          <Route style={{ width: 10, height: 10, color: "#00C8E0" }} />
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#00C8E0" }}>{selectedPlace.distance}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock style={{ width: 10, height: 10, color: "rgba(255,255,255,0.25)" }} />
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{selectedPlace.eta}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Star style={{ width: 10, height: 10, color: "#FF9500" }} />
                          <span style={{ fontSize: 11, color: "rgba(255,150,0,0.6)" }}>{selectedPlace.rating}</span>
                        </div>
                        {selectedPlace.open24h && (
                          <span className="px-1.5 py-[1px]" style={{ borderRadius: 4, background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.12)", fontSize: 8, fontWeight: 700, color: "#00C853" }}>
                            24H
                          </span>
                        )}
                      </div>
                    </div>
                    <button onClick={() => setSelectedPlace(null)}>
                      <X style={{ width: 16, height: 16, color: "rgba(255,255,255,0.2)" }} />
                    </button>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-3.5 relative z-10">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5"
                      style={{
                        borderRadius: 12,
                        background: `${typeConfig[selectedPlace.type].color}10`,
                        border: `1px solid ${typeConfig[selectedPlace.type].color}20`,
                        fontSize: 12, fontWeight: 600, color: typeConfig[selectedPlace.type].color,
                      }}
                    >
                      <Navigation style={{ width: 13, height: 13 }} />
                      Directions
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5"
                      style={{
                        borderRadius: 12,
                        background: "rgba(0,200,83,0.08)",
                        border: "1px solid rgba(0,200,83,0.15)",
                        fontSize: 12, fontWeight: 600, color: "#00C853",
                      }}
                    >
                      <Phone style={{ width: 13, height: 13 }} />
                      Call
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* List Button */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => { setShowList(!showList); setSelectedPlace(null); }}
            className="mx-5 mb-2 w-[calc(100%-40px)] flex items-center justify-center gap-2 py-2.5"
            style={{
              borderRadius: 14,
              background: "rgba(10,18,32,0.9)",
              border: "1px solid rgba(0,200,224,0.1)",
              backdropFilter: "blur(20px)",
            }}
          >
            <motion.div animate={{ rotate: showList ? 180 : 0 }}>
              <ChevronUp style={{ width: 14, height: 14, color: "#00C8E0" }} />
            </motion.div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(0,200,224,0.6)" }}>
              {showList ? "Hide List" : "View All Nearby"}
            </span>
          </motion.button>
        </div>

        {/* ── List Panel ── */}
        <AnimatePresence>
          {showList && (
            <motion.div
              key="list-panel"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              className="absolute bottom-0 left-0 right-0 z-40"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "rgba(10,18,32,0.98)",
                backdropFilter: "blur(40px)",
                borderTop: "1px solid rgba(0,200,224,0.12)",
                maxHeight: "60%",
              }}
            >
              <div className="flex justify-center pt-3 pb-2">
                <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
              </div>

              <div className="px-5 pb-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>
                    Nearby Services
                  </p>
                  <button onClick={() => setShowList(false)}>
                    <X style={{ width: 16, height: 16, color: "rgba(255,255,255,0.2)" }} />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto px-5 pb-8" style={{ maxHeight: 340, scrollbarWidth: "none" }}>
                <div className="space-y-2">
                  {filteredPlaces.map((place, i) => {
                    const cfg = typeConfig[place.type];
                    const PlaceIcon = cfg.icon;
                    return (
                      <motion.button
                        key={place.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => { setSelectedPlace(place); setShowList(false); }}
                        className="w-full flex items-center gap-3 p-3.5 text-left"
                        style={{
                          borderRadius: 16,
                          background: "rgba(255,255,255,0.015)",
                          border: "1px solid rgba(255,255,255,0.04)",
                        }}
                      >
                        <div
                          className="size-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: cfg.bg, border: `1px solid ${cfg.color}18` }}
                        >
                          <PlaceIcon style={{ width: 16, height: 16, color: cfg.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{place.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#00C8E0" }}>{place.distance}</span>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>·</span>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{place.eta}</span>
                            {place.open24h && (
                              <span className="px-1.5 py-[1px]" style={{ borderRadius: 4, background: "rgba(0,200,83,0.06)", fontSize: 8, fontWeight: 700, color: "rgba(0,200,83,0.5)" }}>24H</span>
                            )}
                          </div>
                        </div>
                        <ChevronRight style={{ width: 14, height: 14, color: "rgba(255,255,255,0.1)" }} />
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
