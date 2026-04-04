import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, X, ChevronDown, Check } from "lucide-react";

export interface Country {
  name: string;
  code: string;
  dial: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { name: "Afghanistan", code: "AF", dial: "+93", flag: "🇦🇫" },
  { name: "Albania", code: "AL", dial: "+355", flag: "🇦🇱" },
  { name: "Algeria", code: "DZ", dial: "+213", flag: "🇩🇿" },
  { name: "Andorra", code: "AD", dial: "+376", flag: "🇦🇩" },
  { name: "Angola", code: "AO", dial: "+244", flag: "🇦🇴" },
  { name: "Antigua & Barbuda", code: "AG", dial: "+1268", flag: "🇦🇬" },
  { name: "Argentina", code: "AR", dial: "+54", flag: "🇦🇷" },
  { name: "Armenia", code: "AM", dial: "+374", flag: "🇦🇲" },
  { name: "Australia", code: "AU", dial: "+61", flag: "🇦🇺" },
  { name: "Austria", code: "AT", dial: "+43", flag: "🇦🇹" },
  { name: "Azerbaijan", code: "AZ", dial: "+994", flag: "🇦🇿" },
  { name: "Bahamas", code: "BS", dial: "+1242", flag: "🇧🇸" },
  { name: "Bahrain", code: "BH", dial: "+973", flag: "🇧🇭" },
  { name: "Bangladesh", code: "BD", dial: "+880", flag: "🇧🇩" },
  { name: "Barbados", code: "BB", dial: "+1246", flag: "🇧🇧" },
  { name: "Belarus", code: "BY", dial: "+375", flag: "🇧🇾" },
  { name: "Belgium", code: "BE", dial: "+32", flag: "🇧🇪" },
  { name: "Belize", code: "BZ", dial: "+501", flag: "🇧🇿" },
  { name: "Benin", code: "BJ", dial: "+229", flag: "🇧🇯" },
  { name: "Bhutan", code: "BT", dial: "+975", flag: "🇧🇹" },
  { name: "Bolivia", code: "BO", dial: "+591", flag: "🇧🇴" },
  { name: "Bosnia & Herzegovina", code: "BA", dial: "+387", flag: "🇧🇦" },
  { name: "Botswana", code: "BW", dial: "+267", flag: "🇧🇼" },
  { name: "Brazil", code: "BR", dial: "+55", flag: "🇧🇷" },
  { name: "Brunei", code: "BN", dial: "+673", flag: "🇧🇳" },
  { name: "Bulgaria", code: "BG", dial: "+359", flag: "🇧🇬" },
  { name: "Burkina Faso", code: "BF", dial: "+226", flag: "🇧🇫" },
  { name: "Burundi", code: "BI", dial: "+257", flag: "🇧🇮" },
  { name: "Cambodia", code: "KH", dial: "+855", flag: "🇰🇭" },
  { name: "Cameroon", code: "CM", dial: "+237", flag: "🇨🇲" },
  { name: "Canada", code: "CA", dial: "+1", flag: "🇨🇦" },
  { name: "Cape Verde", code: "CV", dial: "+238", flag: "🇨🇻" },
  { name: "Central African Republic", code: "CF", dial: "+236", flag: "🇨🇫" },
  { name: "Chad", code: "TD", dial: "+235", flag: "🇹🇩" },
  { name: "Chile", code: "CL", dial: "+56", flag: "🇨🇱" },
  { name: "China", code: "CN", dial: "+86", flag: "🇨🇳" },
  { name: "Colombia", code: "CO", dial: "+57", flag: "🇨🇴" },
  { name: "Comoros", code: "KM", dial: "+269", flag: "🇰🇲" },
  { name: "Congo", code: "CG", dial: "+242", flag: "🇨🇬" },
  { name: "Costa Rica", code: "CR", dial: "+506", flag: "🇨🇷" },
  { name: "Croatia", code: "HR", dial: "+385", flag: "🇭🇷" },
  { name: "Cuba", code: "CU", dial: "+53", flag: "🇨🇺" },
  { name: "Cyprus", code: "CY", dial: "+357", flag: "🇨🇾" },
  { name: "Czech Republic", code: "CZ", dial: "+420", flag: "🇨🇿" },
  { name: "Denmark", code: "DK", dial: "+45", flag: "🇩🇰" },
  { name: "Djibouti", code: "DJ", dial: "+253", flag: "🇩🇯" },
  { name: "Dominican Republic", code: "DO", dial: "+1809", flag: "🇩🇴" },
  { name: "Ecuador", code: "EC", dial: "+593", flag: "🇪🇨" },
  { name: "Egypt", code: "EG", dial: "+20", flag: "🇪🇬" },
  { name: "El Salvador", code: "SV", dial: "+503", flag: "🇸🇻" },
  { name: "Equatorial Guinea", code: "GQ", dial: "+240", flag: "🇬🇶" },
  { name: "Eritrea", code: "ER", dial: "+291", flag: "🇪🇷" },
  { name: "Estonia", code: "EE", dial: "+372", flag: "🇪🇪" },
  { name: "Eswatini", code: "SZ", dial: "+268", flag: "🇸🇿" },
  { name: "Ethiopia", code: "ET", dial: "+251", flag: "🇪🇹" },
  { name: "Fiji", code: "FJ", dial: "+679", flag: "🇫🇯" },
  { name: "Finland", code: "FI", dial: "+358", flag: "🇫🇮" },
  { name: "France", code: "FR", dial: "+33", flag: "🇫🇷" },
  { name: "Gabon", code: "GA", dial: "+241", flag: "🇬🇦" },
  { name: "Gambia", code: "GM", dial: "+220", flag: "🇬🇲" },
  { name: "Georgia", code: "GE", dial: "+995", flag: "🇬🇪" },
  { name: "Germany", code: "DE", dial: "+49", flag: "🇩🇪" },
  { name: "Ghana", code: "GH", dial: "+233", flag: "🇬🇭" },
  { name: "Greece", code: "GR", dial: "+30", flag: "🇬🇷" },
  { name: "Grenada", code: "GD", dial: "+1473", flag: "🇬🇩" },
  { name: "Guatemala", code: "GT", dial: "+502", flag: "🇬🇹" },
  { name: "Guinea", code: "GN", dial: "+224", flag: "🇬🇳" },
  { name: "Guinea-Bissau", code: "GW", dial: "+245", flag: "🇬🇼" },
  { name: "Guyana", code: "GY", dial: "+592", flag: "🇬🇾" },
  { name: "Haiti", code: "HT", dial: "+509", flag: "🇭🇹" },
  { name: "Honduras", code: "HN", dial: "+504", flag: "🇭🇳" },
  { name: "Hungary", code: "HU", dial: "+36", flag: "🇭🇺" },
  { name: "Iceland", code: "IS", dial: "+354", flag: "🇮🇸" },
  { name: "India", code: "IN", dial: "+91", flag: "🇮🇳" },
  { name: "Indonesia", code: "ID", dial: "+62", flag: "🇮🇩" },
  { name: "Iran", code: "IR", dial: "+98", flag: "🇮🇷" },
  { name: "Iraq", code: "IQ", dial: "+964", flag: "🇮🇶" },
  { name: "Ireland", code: "IE", dial: "+353", flag: "🇮🇪" },
  { name: "Israel", code: "IL", dial: "+972", flag: "🇮🇱" },
  { name: "Italy", code: "IT", dial: "+39", flag: "🇮🇹" },
  { name: "Jamaica", code: "JM", dial: "+1876", flag: "🇯🇲" },
  { name: "Japan", code: "JP", dial: "+81", flag: "🇯🇵" },
  { name: "Jordan", code: "JO", dial: "+962", flag: "🇯🇴" },
  { name: "Kazakhstan", code: "KZ", dial: "+7", flag: "🇰🇿" },
  { name: "Kenya", code: "KE", dial: "+254", flag: "🇰🇪" },
  { name: "Kiribati", code: "KI", dial: "+686", flag: "🇰🇮" },
  { name: "Kuwait", code: "KW", dial: "+965", flag: "🇰🇼" },
  { name: "Kyrgyzstan", code: "KG", dial: "+996", flag: "🇰🇬" },
  { name: "Laos", code: "LA", dial: "+856", flag: "🇱🇦" },
  { name: "Latvia", code: "LV", dial: "+371", flag: "🇱🇻" },
  { name: "Lebanon", code: "LB", dial: "+961", flag: "🇱🇧" },
  { name: "Lesotho", code: "LS", dial: "+266", flag: "🇱🇸" },
  { name: "Liberia", code: "LR", dial: "+231", flag: "🇱🇷" },
  { name: "Libya", code: "LY", dial: "+218", flag: "🇱🇾" },
  { name: "Liechtenstein", code: "LI", dial: "+423", flag: "🇱🇮" },
  { name: "Lithuania", code: "LT", dial: "+370", flag: "🇱🇹" },
  { name: "Luxembourg", code: "LU", dial: "+352", flag: "🇱🇺" },
  { name: "Madagascar", code: "MG", dial: "+261", flag: "🇲🇬" },
  { name: "Malawi", code: "MW", dial: "+265", flag: "🇲🇼" },
  { name: "Malaysia", code: "MY", dial: "+60", flag: "🇲🇾" },
  { name: "Maldives", code: "MV", dial: "+960", flag: "🇲🇻" },
  { name: "Mali", code: "ML", dial: "+223", flag: "🇲🇱" },
  { name: "Malta", code: "MT", dial: "+356", flag: "🇲🇹" },
  { name: "Marshall Islands", code: "MH", dial: "+692", flag: "🇲🇭" },
  { name: "Mauritania", code: "MR", dial: "+222", flag: "🇲🇷" },
  { name: "Mauritius", code: "MU", dial: "+230", flag: "🇲🇺" },
  { name: "Mexico", code: "MX", dial: "+52", flag: "🇲🇽" },
  { name: "Micronesia", code: "FM", dial: "+691", flag: "🇫🇲" },
  { name: "Moldova", code: "MD", dial: "+373", flag: "🇲🇩" },
  { name: "Monaco", code: "MC", dial: "+377", flag: "🇲🇨" },
  { name: "Mongolia", code: "MN", dial: "+976", flag: "🇲🇳" },
  { name: "Montenegro", code: "ME", dial: "+382", flag: "🇲🇪" },
  { name: "Morocco", code: "MA", dial: "+212", flag: "🇲🇦" },
  { name: "Mozambique", code: "MZ", dial: "+258", flag: "🇲🇿" },
  { name: "Myanmar", code: "MM", dial: "+95", flag: "🇲🇲" },
  { name: "Namibia", code: "NA", dial: "+264", flag: "🇳🇦" },
  { name: "Nauru", code: "NR", dial: "+674", flag: "🇳🇷" },
  { name: "Nepal", code: "NP", dial: "+977", flag: "🇳🇵" },
  { name: "Netherlands", code: "NL", dial: "+31", flag: "🇳🇱" },
  { name: "New Zealand", code: "NZ", dial: "+64", flag: "🇳🇿" },
  { name: "Nicaragua", code: "NI", dial: "+505", flag: "🇳🇮" },
  { name: "Niger", code: "NE", dial: "+227", flag: "🇳🇪" },
  { name: "Nigeria", code: "NG", dial: "+234", flag: "🇳🇬" },
  { name: "North Korea", code: "KP", dial: "+850", flag: "🇰🇵" },
  { name: "North Macedonia", code: "MK", dial: "+389", flag: "🇲🇰" },
  { name: "Norway", code: "NO", dial: "+47", flag: "🇳🇴" },
  { name: "Oman", code: "OM", dial: "+968", flag: "🇴🇲" },
  { name: "Pakistan", code: "PK", dial: "+92", flag: "🇵🇰" },
  { name: "Palau", code: "PW", dial: "+680", flag: "🇵🇼" },
  { name: "Palestine", code: "PS", dial: "+970", flag: "🇵🇸" },
  { name: "Panama", code: "PA", dial: "+507", flag: "🇵🇦" },
  { name: "Papua New Guinea", code: "PG", dial: "+675", flag: "🇵🇬" },
  { name: "Paraguay", code: "PY", dial: "+595", flag: "🇵🇾" },
  { name: "Peru", code: "PE", dial: "+51", flag: "🇵🇪" },
  { name: "Philippines", code: "PH", dial: "+63", flag: "🇵🇭" },
  { name: "Poland", code: "PL", dial: "+48", flag: "🇵🇱" },
  { name: "Portugal", code: "PT", dial: "+351", flag: "🇵🇹" },
  { name: "Qatar", code: "QA", dial: "+974", flag: "🇶🇦" },
  { name: "Romania", code: "RO", dial: "+40", flag: "🇷🇴" },
  { name: "Russia", code: "RU", dial: "+7", flag: "🇷🇺" },
  { name: "Rwanda", code: "RW", dial: "+250", flag: "🇷🇼" },
  { name: "Saint Kitts & Nevis", code: "KN", dial: "+1869", flag: "🇰🇳" },
  { name: "Saint Lucia", code: "LC", dial: "+1758", flag: "🇱🇨" },
  { name: "Saint Vincent", code: "VC", dial: "+1784", flag: "🇻🇨" },
  { name: "Samoa", code: "WS", dial: "+685", flag: "🇼🇸" },
  { name: "San Marino", code: "SM", dial: "+378", flag: "🇸🇲" },
  { name: "Saudi Arabia", code: "SA", dial: "+966", flag: "🇸🇦" },
  { name: "Senegal", code: "SN", dial: "+221", flag: "🇸🇳" },
  { name: "Serbia", code: "RS", dial: "+381", flag: "🇷🇸" },
  { name: "Seychelles", code: "SC", dial: "+248", flag: "🇸🇨" },
  { name: "Sierra Leone", code: "SL", dial: "+232", flag: "🇸🇱" },
  { name: "Singapore", code: "SG", dial: "+65", flag: "🇸🇬" },
  { name: "Slovakia", code: "SK", dial: "+421", flag: "🇸🇰" },
  { name: "Slovenia", code: "SI", dial: "+386", flag: "🇸🇮" },
  { name: "Solomon Islands", code: "SB", dial: "+677", flag: "🇸🇧" },
  { name: "Somalia", code: "SO", dial: "+252", flag: "🇸🇴" },
  { name: "South Africa", code: "ZA", dial: "+27", flag: "🇿🇦" },
  { name: "South Korea", code: "KR", dial: "+82", flag: "🇰🇷" },
  { name: "South Sudan", code: "SS", dial: "+211", flag: "🇸🇸" },
  { name: "Spain", code: "ES", dial: "+34", flag: "🇪🇸" },
  { name: "Sri Lanka", code: "LK", dial: "+94", flag: "🇱🇰" },
  { name: "Sudan", code: "SD", dial: "+249", flag: "🇸🇩" },
  { name: "Suriname", code: "SR", dial: "+597", flag: "🇸🇷" },
  { name: "Sweden", code: "SE", dial: "+46", flag: "🇸🇪" },
  { name: "Switzerland", code: "CH", dial: "+41", flag: "🇨🇭" },
  { name: "Syria", code: "SY", dial: "+963", flag: "🇸🇾" },
  { name: "Taiwan", code: "TW", dial: "+886", flag: "🇹🇼" },
  { name: "Tajikistan", code: "TJ", dial: "+992", flag: "🇹🇯" },
  { name: "Tanzania", code: "TZ", dial: "+255", flag: "🇹🇿" },
  { name: "Thailand", code: "TH", dial: "+66", flag: "🇹🇭" },
  { name: "Timor-Leste", code: "TL", dial: "+670", flag: "🇹🇱" },
  { name: "Togo", code: "TG", dial: "+228", flag: "🇹🇬" },
  { name: "Tonga", code: "TO", dial: "+676", flag: "🇹🇴" },
  { name: "Trinidad & Tobago", code: "TT", dial: "+1868", flag: "🇹🇹" },
  { name: "Tunisia", code: "TN", dial: "+216", flag: "🇹🇳" },
  { name: "Turkey", code: "TR", dial: "+90", flag: "🇹🇷" },
  { name: "Turkmenistan", code: "TM", dial: "+993", flag: "🇹🇲" },
  { name: "Tuvalu", code: "TV", dial: "+688", flag: "🇹🇻" },
  { name: "Uganda", code: "UG", dial: "+256", flag: "🇺🇬" },
  { name: "Ukraine", code: "UA", dial: "+380", flag: "🇺🇦" },
  { name: "United Arab Emirates", code: "AE", dial: "+971", flag: "🇦🇪" },
  { name: "United Kingdom", code: "GB", dial: "+44", flag: "🇬🇧" },
  { name: "United States", code: "US", dial: "+1", flag: "🇺🇸" },
  { name: "Uruguay", code: "UY", dial: "+598", flag: "🇺🇾" },
  { name: "Uzbekistan", code: "UZ", dial: "+998", flag: "🇺🇿" },
  { name: "Vanuatu", code: "VU", dial: "+678", flag: "🇻🇺" },
  { name: "Vatican City", code: "VA", dial: "+379", flag: "🇻🇦" },
  { name: "Venezuela", code: "VE", dial: "+58", flag: "🇻🇪" },
  { name: "Vietnam", code: "VN", dial: "+84", flag: "🇻🇳" },
  { name: "Yemen", code: "YE", dial: "+967", flag: "🇾🇪" },
  { name: "Zambia", code: "ZM", dial: "+260", flag: "🇿🇲" },
  { name: "Zimbabwe", code: "ZW", dial: "+263", flag: "🇿🇼" },
];

// ─── Trigger Button (inline inside the phone input) ───────────────────────────
interface CountryTriggerProps {
  country: Country;
  onClick: () => void;
}
export function CountryTrigger({ country, onClick }: CountryTriggerProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-[18px] shrink-0 group"
      style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}
    >
      <span style={{ fontSize: "20px", lineHeight: 1 }}>{country.flag}</span>
      <span
        style={{
          fontSize: "15px",
          fontWeight: 500,
          color: "rgba(255,255,255,0.75)",
          fontFamily: "inherit",
          letterSpacing: "0.2px",
        }}
      >
        {country.dial}
      </span>
      <ChevronDown
        style={{
          width: 13,
          height: 13,
          color: "rgba(255,255,255,0.25)",
          transition: "transform 0.2s",
        }}
      />
    </button>
  );
}

// ─── Bottom Sheet Modal (rendered at screen root level) ───────────────────────
interface CountrySheetProps {
  open: boolean;
  selected: Country;
  onSelect: (c: Country) => void;
  onClose: () => void;
}
export function CountrySheet({ open, selected, onSelect, onClose }: CountrySheetProps) {
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [search]);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 350);
    } else {
      setSearch("");
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Full-screen backdrop — covers entire iPhone frame */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            className="absolute inset-0 z-40"
            style={{
              background: "rgba(2,4,12,0.75)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          />

          {/* Sheet — anchored to bottom of the iPhone frame */}
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36, mass: 0.85 }}
            className="absolute left-0 right-0 bottom-0 z-50 flex flex-col"
            style={{
              height: "75%",
              borderRadius: "28px 28px 0 0",
              background: "linear-gradient(180deg, rgba(12,20,38,0.98) 0%, rgba(8,14,28,0.99) 100%)",
              backdropFilter: "blur(60px)",
              WebkitBackdropFilter: "blur(60px)",
              borderTop: "1px solid rgba(255,255,255,0.08)",
              borderLeft: "1px solid rgba(255,255,255,0.05)",
              borderRight: "1px solid rgba(255,255,255,0.05)",
              boxShadow: "0 -32px 80px rgba(0,0,0,0.7), 0 -1px 0 rgba(255,255,255,0.05)",
            }}
          >
            {/* Drag Handle */}
            <div className="flex justify-center pt-3 shrink-0">
              <motion.div
                initial={{ scaleX: 0.6, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ delay: 0.1 }}
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 99,
                  background: "rgba(255,255,255,0.12)",
                }}
              />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-4 pb-3 shrink-0">
              <div>
                <p
                  style={{
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "#fff",
                    letterSpacing: "-0.4px",
                    fontFamily: "inherit",
                  }}
                >
                  Select Country
                </p>
                <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.25)", marginTop: 2, fontFamily: "inherit" }}>
                  {filtered.length} {filtered.length === 1 ? "country" : "countries"}
                </p>
              </div>

              {/* Close button */}
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={onClose}
                className="flex items-center justify-center"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.09)",
                }}
              >
                <X style={{ width: 15, height: 15, color: "rgba(255,255,255,0.5)" }} />
              </motion.button>
            </div>

            {/* Search bar */}
            <div className="px-5 pb-3 shrink-0">
              <div
                className="flex items-center gap-2.5"
                style={{
                  height: 44,
                  borderRadius: "13px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1.5px solid rgba(255,255,255,0.08)",
                  paddingLeft: 14,
                  paddingRight: 12,
                }}
              >
                <Search style={{ width: 15, height: 15, color: "rgba(255,255,255,0.28)", flexShrink: 0 }} />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Country name or dial code…"
                  className="flex-1 bg-transparent text-white outline-none"
                  style={{
                    fontSize: "14px",
                    fontFamily: "inherit",
                    caretColor: "#00C8E0",
                    color: "rgba(255,255,255,0.85)",
                  }}
                />
                <AnimatePresence>
                  {search && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      onClick={() => setSearch("")}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.1)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <X style={{ width: 10, height: 10, color: "rgba(255,255,255,0.45)" }} />
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Separator */}
            <div style={{ height: 1, background: "rgba(255,255,255,0.05)", flexShrink: 0, marginBottom: 2 }} />

            {/* Country list */}
            <div
              className="flex-1 overflow-y-auto"
              style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
            >
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12">
                  <span style={{ fontSize: "32px" }}>🌍</span>
                  <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.2)", fontFamily: "inherit" }}>
                    No results for "{search}"
                  </p>
                </div>
              ) : (
                <div style={{ paddingBottom: 28 }}>
                  {filtered.map((country) => {
                    const isActive = country.code === selected.code;
                    return (
                      <motion.button
                        key={country.code}
                        type="button"
                        onClick={() => { onSelect(country); onClose(); }}
                        whileTap={{ scale: 0.97 }}
                        className="w-full flex items-center gap-4 px-5 transition-colors duration-100"
                        style={{
                          height: 54,
                          background: isActive
                            ? "linear-gradient(90deg, rgba(0,200,224,0.08) 0%, rgba(0,200,224,0.03) 100%)"
                            : "transparent",
                          borderBottom: "1px solid rgba(255,255,255,0.03)",
                          borderLeft: isActive ? "2px solid rgba(0,200,224,0.5)" : "2px solid transparent",
                        }}
                      >
                        {/* Flag */}
                        <span style={{ fontSize: "22px", lineHeight: 1, width: 28, flexShrink: 0, textAlign: "center" }}>
                          {country.flag}
                        </span>

                        {/* Name */}
                        <span
                          className="flex-1 text-left truncate"
                          style={{
                            fontSize: "14.5px",
                            fontWeight: isActive ? 600 : 400,
                            color: isActive ? "#fff" : "rgba(255,255,255,0.6)",
                            letterSpacing: "-0.15px",
                            fontFamily: "inherit",
                          }}
                        >
                          {country.name}
                        </span>

                        {/* Dial code */}
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 500,
                            color: isActive ? "#00C8E0" : "rgba(255,255,255,0.22)",
                            letterSpacing: "0.3px",
                            flexShrink: 0,
                            fontFamily: "inherit",
                          }}
                        >
                          {country.dial}
                        </span>

                        {/* Check indicator */}
                        <div style={{ width: 18, flexShrink: 0 }}>
                          <AnimatePresence>
                            {isActive && (
                              <motion.div
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                                transition={{ type: "spring", stiffness: 600, damping: 28 }}
                              >
                                <Check style={{ width: 16, height: 16, color: "#00C8E0" }} />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
