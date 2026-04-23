import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Phone, Shield, Hospital, Flame, AlertTriangle,
  Globe, ChevronDown, Search, Star, Clock,
  ChevronRight, X, MapPin, Zap, Heart,
  Anchor, Mountain, Bug, Car, Baby,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface EmergencyNumber {
  id: string;
  service: string;
  number: string;
  icon: typeof Phone;
  color: string;
  description: string;
  available: string;
}

interface Country {
  code: string;
  name: string;
  flag: string;
  numbers: EmergencyNumber[];
}

// ─── Mock Data ─────────────────────────────────────────────────────────────────
const countries: Country[] = [
  {
    code: "SA", name: "Saudi Arabia", flag: "🇸🇦",
    numbers: [
      { id: "sa-1", service: "Ambulance / EMS", number: "997", icon: Hospital, color: "#FF2D55", description: "Emergency Medical Services", available: "24/7" },
      { id: "sa-2", service: "Police / Security", number: "999", icon: Shield, color: "#007AFF", description: "Royal Saudi Police", available: "24/7" },
      { id: "sa-3", service: "Civil Defense (Fire)", number: "998", icon: Flame, color: "#FF9500", description: "Fire & Rescue", available: "24/7" },
      { id: "sa-4", service: "Traffic Accidents", number: "993", icon: Car, color: "#AF52DE", description: "Traffic Police / Najm", available: "24/7" },
      { id: "sa-5", service: "Domestic Violence", number: "1919", icon: Heart, color: "#FF2D55", description: "Family Protection Hotline", available: "24/7" },
      { id: "sa-6", service: "Drug Control", number: "995", icon: AlertTriangle, color: "#FF9500", description: "Anti-Drug Directorate", available: "24/7" },
    ],
  },
  {
    code: "US", name: "United States", flag: "🇺🇸",
    numbers: [
      { id: "us-1", service: "Emergency (All)", number: "911", icon: AlertTriangle, color: "#FF2D55", description: "Police, Fire & Ambulance", available: "24/7" },
      { id: "us-2", service: "Poison Control", number: "1-800-222-1222", icon: Bug, color: "#FF9500", description: "American Association of Poison Control", available: "24/7" },
      { id: "us-3", service: "Suicide Prevention", number: "988", icon: Heart, color: "#AF52DE", description: "Suicide & Crisis Lifeline", available: "24/7" },
      { id: "us-4", service: "Coast Guard", number: "1-800-424-8802", icon: Anchor, color: "#007AFF", description: "US Coast Guard", available: "24/7" },
    ],
  },
  {
    code: "AE", name: "UAE", flag: "🇦🇪",
    numbers: [
      { id: "ae-1", service: "Ambulance", number: "998", icon: Hospital, color: "#FF2D55", description: "Emergency Medical Services", available: "24/7" },
      { id: "ae-2", service: "Police", number: "999", icon: Shield, color: "#007AFF", description: "UAE Police Force", available: "24/7" },
      { id: "ae-3", service: "Fire", number: "997", icon: Flame, color: "#FF9500", description: "Civil Defense", available: "24/7" },
      { id: "ae-4", service: "Coast Guard", number: "996", icon: Anchor, color: "#00C8E0", description: "Coast Guard Emergency", available: "24/7" },
    ],
  },
  {
    code: "GB", name: "United Kingdom", flag: "🇬🇧",
    numbers: [
      { id: "gb-1", service: "Emergency (All)", number: "999", icon: AlertTriangle, color: "#FF2D55", description: "Police, Fire & Ambulance", available: "24/7" },
      { id: "gb-2", service: "Non-Emergency", number: "111", icon: Phone, color: "#00C8E0", description: "NHS Medical Advice", available: "24/7" },
      { id: "gb-3", service: "Childline", number: "0800 1111", icon: Baby, color: "#FF9500", description: "Children's Helpline", available: "24/7" },
    ],
  },
  {
    code: "EG", name: "Egypt", flag: "🇪🇬",
    numbers: [
      { id: "eg-1", service: "Ambulance", number: "123", icon: Hospital, color: "#FF2D55", description: "Emergency Medical Services", available: "24/7" },
      { id: "eg-2", service: "Police", number: "122", icon: Shield, color: "#007AFF", description: "Egyptian Police", available: "24/7" },
      { id: "eg-3", service: "Fire", number: "180", icon: Flame, color: "#FF9500", description: "Fire Department", available: "24/7" },
      { id: "eg-4", service: "Tourist Police", number: "126", icon: Globe, color: "#00C8E0", description: "Tourist Police Force", available: "24/7" },
    ],
  },
];

interface EmergencyServicesProps {
  onBack: () => void;
}

// ─── Component ─────────────────────────────────────────────────────────────────
export function EmergencyServices({ onBack }: EmergencyServicesProps) {
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>(["sa-1", "sa-2"]);
  const [dialingNumber, setDialingNumber] = useState<string | null>(null);

  const filteredNumbers = selectedCountry.numbers.filter(n =>
    n.service.toLowerCase().includes(searchQuery.toLowerCase()) ||
    n.number.includes(searchQuery)
  );

  const favoriteNumbers = selectedCountry.numbers.filter(n => favorites.includes(n.id));
  const otherNumbers = filteredNumbers.filter(n => !favorites.includes(n.id));

  const toggleFavorite = (id: string) => {
    setFavorites(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);
  };

  // AUDIT-FIX (2026-04-21 v5): `tel:` URL surfaced app choosers on
  // MIUI (WhatsApp / Messages / Zoom / Contacts), which the user
  // explicitly rejected. Emergency Services now COPIES the number to
  // the clipboard + toasts. The user opens their own dialer app and
  // pastes. No chooser, no uncertainty.
  const handleDial = async (number: string) => {
    setDialingNumber(number);
    const cleaned = number.replace(/[^0-9+]/g, "");
    if (cleaned) {
      try {
        await navigator.clipboard?.writeText(cleaned);
        // Lazy import toast to avoid adding weight to initial bundle
        import("sonner").then(m => m.toast(`${cleaned} copied`, {
          description: "Open your dialer and paste to call",
        }));
      } catch {
        import("sonner").then(m => m.toast("Couldn't copy — dial manually", {
          description: cleaned,
        }));
      }
    }
    setTimeout(() => setDialingNumber(null), 800);
  };

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      {/* Ambient */}
      <div
        data-ambient-glow
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 pointer-events-none"
        style={{ width: 500, height: 350, background: "radial-gradient(ellipse, rgba(255,45,85,0.03) 0%, transparent 60%)" }}
      />

      {/* ── Header ── */}
      <div className="shrink-0 px-5 pb-2" style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}>
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="flex items-center gap-1 -ml-1 p-1">
            <ChevronRight style={{ width: 20, height: 20, color: "#00C8E0", transform: "rotate(180deg)" }} />
            <span style={{ fontSize: 15, color: "#00C8E0", fontWeight: 500 }}>Back</span>
          </button>
        </div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
          <div className="flex items-center gap-2.5 mb-1">
            <Phone style={{ width: 18, height: 18, color: "#FF2D55" }} />
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.4px" }}>Emergency Services</h1>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
            Quick dial emergency numbers worldwide
          </p>
        </motion.div>

        {/* Country Selector */}
        <motion.button
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setShowCountryPicker(true)}
          className="w-full flex items-center gap-3 p-3 mb-3"
          style={{
            borderRadius: 14,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <span style={{ fontSize: 24 }}>{selectedCountry.flag}</span>
          <div className="flex-1 text-left">
            <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{selectedCountry.name}</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{selectedCountry.numbers.length} emergency numbers</p>
          </div>
          <ChevronDown style={{ width: 16, height: 16, color: "rgba(255,255,255,0.15)" }} />
        </motion.button>

        {/* Search */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="relative"
        >
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ width: 14, height: 14, color: "rgba(255,255,255,0.12)" }} />
          <input
            type="text"
            placeholder="Search service or number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 outline-none"
            style={{
              borderRadius: 12,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.04)",
              fontSize: 12, color: "#fff",
              fontFamily: "'Outfit', sans-serif",
            }}
          />
        </motion.div>
      </div>

      {/* ── Numbers List ── */}
      <div className="flex-1 overflow-y-auto px-5 pb-10" style={{ scrollbarWidth: "none" }}>
        {/* Favorites */}
        {favoriteNumbers.length > 0 && !searchQuery && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,150,0,0.4)", letterSpacing: "0.5px", marginBottom: 8, marginTop: 12, textTransform: "uppercase" }}>
              ★ Quick Dial
            </p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {favoriteNumbers.map((num) => {
                const NumIcon = num.icon;
                return (
                  <motion.button
                    key={num.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleDial(num.number)}
                    className="p-3.5 text-left relative overflow-hidden"
                    style={{
                      borderRadius: 18,
                      background: `${num.color}06`,
                      border: `1px solid ${num.color}15`,
                    }}
                  >
                    <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none"
                      style={{ background: `radial-gradient(circle, ${num.color}08, transparent 70%)` }}
                    />
                    <div className="relative z-10">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="size-8 rounded-[9px] flex items-center justify-center"
                          style={{ background: `${num.color}10`, border: `1px solid ${num.color}18` }}
                        >
                          <NumIcon style={{ width: 14, height: 14, color: num.color }} />
                        </div>
                      </div>
                      <p className="text-white" style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.5px" }}>{num.number}</p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2, fontWeight: 500 }}>{num.service}</p>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* All Numbers */}
        <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.12)", letterSpacing: "0.5px", marginBottom: 8, marginTop: searchQuery ? 12 : 0, textTransform: "uppercase" }}>
          {searchQuery ? "Search Results" : "All Services"}
        </p>

        <div className="space-y-2">
          {(searchQuery ? filteredNumbers : otherNumbers).map((num, i) => {
            const NumIcon = num.icon;
            const isFav = favorites.includes(num.id);
            return (
              <motion.div
                key={num.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.04 }}
              >
                <div
                  className="flex items-center gap-3 p-3.5"
                  style={{
                    borderRadius: 16,
                    background: "rgba(255,255,255,0.015)",
                    border: "1px solid rgba(255,255,255,0.035)",
                  }}
                >
                  <div
                    className="size-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${num.color}08`, border: `1px solid ${num.color}15` }}
                  >
                    <NumIcon style={{ width: 16, height: 16, color: num.color }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{num.service}</p>
                      <span className="px-1.5 py-[1px] shrink-0" style={{ borderRadius: 4, background: "rgba(0,200,83,0.06)", fontSize: 7, fontWeight: 700, color: "rgba(0,200,83,0.5)", letterSpacing: "0.3px" }}>
                        {num.available}
                      </span>
                    </div>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{num.description}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleFavorite(num.id)} className="p-1.5">
                      <Star
                        style={{
                          width: 13, height: 13,
                          color: isFav ? "#FF9500" : "rgba(255,255,255,0.08)",
                          fill: isFav ? "#FF9500" : "none",
                        }}
                      />
                    </button>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={() => handleDial(num.number)}
                      className="size-9 rounded-xl flex items-center justify-center"
                      style={{
                        background: `${num.color}10`,
                        border: `1px solid ${num.color}20`,
                      }}
                    >
                      <Phone style={{ width: 14, height: 14, color: num.color }} />
                    </motion.button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {filteredNumbers.length === 0 && searchQuery && (
          <div className="flex flex-col items-center py-10">
            <Search style={{ width: 24, height: 24, color: "rgba(255,255,255,0.06)", marginBottom: 8 }} />
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.15)" }}>No services found</p>
          </div>
        )}

        {/* Notice */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-5 px-3 py-3"
          style={{ borderRadius: 14, background: "rgba(255,45,85,0.02)", border: "1px solid rgba(255,45,85,0.06)" }}
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle style={{ width: 12, height: 12, color: "rgba(255,45,85,0.3)", flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.6 }}>
              In a real emergency, always dial the local emergency number directly. SOSphere's SOS button automatically contacts your emergency contacts.
            </p>
          </div>
        </motion.div>
      </div>

      {/* ── Country Picker Modal ── */}
      <AnimatePresence>
        {showCountryPicker && (
          <>
            <motion.div
              key="cp-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.88)" }}
              onClick={() => setShowCountryPicker(false)}
            />
            <motion.div
              key="cp-modal"
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-5"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "rgba(10,18,32,0.98)",
                backdropFilter: "blur(40px)",
                borderTop: "1px solid rgba(0,200,224,0.12)",
              }}
            >
              <div className="flex justify-center mb-4">
                <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
              </div>

              <div className="flex items-center justify-between mb-5">
                <p className="text-white" style={{ fontSize: 17, fontWeight: 700 }}>Select Country</p>
                <button onClick={() => setShowCountryPicker(false)}>
                  <X style={{ width: 18, height: 18, color: "rgba(255,255,255,0.3)" }} />
                </button>
              </div>

              <div className="space-y-2">
                {countries.map((country) => {
                  const isSelected = selectedCountry.code === country.code;
                  return (
                    <motion.button
                      key={country.code}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => { setSelectedCountry(country); setShowCountryPicker(false); setSearchQuery(""); }}
                      className="w-full flex items-center gap-3 p-3.5 text-left"
                      style={{
                        borderRadius: 14,
                        background: isSelected ? "rgba(0,200,224,0.04)" : "rgba(255,255,255,0.015)",
                        border: `1px solid ${isSelected ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.035)"}`,
                      }}
                    >
                      <span style={{ fontSize: 28 }}>{country.flag}</span>
                      <div className="flex-1">
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{country.name}</p>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>{country.numbers.length} services</p>
                      </div>
                      {isSelected && (
                        <div className="size-5 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)" }}>
                          <div className="size-2.5 rounded-full" style={{ background: "#00C8E0" }} />
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Dialing Overlay ── */}
      <AnimatePresence>
        {dialingNumber && (
          <motion.div
            key="dialing"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute inset-0 z-60 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.9)" }}
          >
            <div className="flex flex-col items-center">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="size-20 rounded-full flex items-center justify-center mb-5"
                style={{
                  background: "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.05))",
                  border: "2px solid rgba(0,200,83,0.2)",
                }}
              >
                <Phone style={{ width: 28, height: 28, color: "#00C853" }} />
              </motion.div>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.3)", marginBottom: 4 }}>Calling</p>
              <p className="text-white" style={{ fontSize: 32, fontWeight: 800, letterSpacing: "2px" }}>{dialingNumber}</p>
              <motion.p
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                style={{ fontSize: 12, color: "rgba(0,200,83,0.5)", marginTop: 12 }}
              >
                Connecting...
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
