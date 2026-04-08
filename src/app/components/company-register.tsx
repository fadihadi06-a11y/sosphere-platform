// ═══════════════════════════════════════════════════════════════
// SOSphere — Company Registration Wizard (Owner Flow)
// Complete hybrid flow: Profile → Zone Toggle → Setup → Plan → Launch
// ═══════════════════════════════════════════════════════════════
import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Building2, Users, MapPin, Shield, ArrowRight, ArrowLeft,
  Globe, ChevronDown, Check, Sparkles, Layers,
  AlertTriangle, Upload, Download, FileText,
  Crown, ShieldCheck, Zap, Phone, Mail, User,
  Navigation, Plus, X, CheckCircle2, Copy,
  QrCode, Send, Clock, Star, Lock, CreditCard,
  Factory, Heart, Truck, Cpu, Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess } from "./haptic-feedback";
import { UNIFIED_PLANS } from "../constants/pricing";
import { supabase } from "./api/supabase-client";

// ── Types ─────────────────────────────────────────────────────
type RegStep = 1 | 2 | 3 | 4 | 5 | 6;

interface ZoneEntry {
  id: string;
  name: string;
  type: "office" | "warehouse" | "production" | "outdoor" | "restricted";
  evacuationPoint: string;
  riskLevel: "low" | "medium" | "high";
  // GPS coordinates
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  evacLat?: number;
  evacLng?: number;
  mapsUrl?: string;
  evacMapsUrl?: string;
}

interface EmployeeEntry {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: string;
  department: string;
  zone: string;
}

export interface RegistrationResult {
  companyName: string;
  plan: string;
  billing: "monthly" | "annual";
  employeeCount: number;
}

interface CompanyRegisterProps {
  onComplete: (companyName: string, result?: RegistrationResult) => void;
  onBack: () => void;
}

// ── Constants ─────────────────────────────────────────────────
// SUPABASE_MIGRATION_POINT: industries table
// SELECT * FROM industries ORDER BY label
const INDUSTRIES = [
  { id: "construction", icon: Building2, label: "Construction", labelAr: "البناء والتشييد" },
  { id: "oil_gas", icon: Cpu, label: "Oil & Gas", labelAr: "النفط والغاز" },
  { id: "manufacturing", icon: Factory, label: "Manufacturing", labelAr: "التصنيع" },
  { id: "healthcare", icon: Heart, label: "Healthcare", labelAr: "الرعاية الصحية" },
  { id: "logistics", icon: Truck, label: "Logistics", labelAr: "النقل واللوجستيات" },
  { id: "other", icon: Briefcase, label: "Other", labelAr: "أخرى" },
];

const ZONE_TYPES: { id: ZoneEntry["type"]; label: string; color: string; icon: string }[] = [
  { id: "office", label: "Office", color: "#00C8E0", icon: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
  { id: "warehouse", label: "Warehouse", color: "#FF9500", icon: "M2 20h20M4 20V10l8-6 8 6v10" },
  { id: "production", label: "Production", color: "#FF2D55", icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" },
  { id: "outdoor", label: "Outdoor", color: "#00C853", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
  { id: "restricted", label: "Restricted", color: "#7B5EFF", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9.5 9l5 5M14.5 9l-5 5" },
];

// Plans now imported from shared constants (UNIFIED_PLANS)
const PLANS = UNIFIED_PLANS.map(p => ({
  id: p.id,
  name: p.name,
  range: p.description.replace("For ", "").replace(" employees", ""),
  price: p.monthlyPrice,
  annualMonthly: p.annualMonthly,
  color: p.color,
  min: p.maxEmployees === -1 ? 501 : (p.id === "starter" ? 5 : p.id === "growth" ? 26 : p.id === "business" ? 101 : 501),
  max: p.maxEmployees === -1 ? Infinity : p.maxEmployees,
  popular: p.popular,
}));

// SUPABASE_MIGRATION_POINT: csv_field_templates table
// SELECT * FROM csv_field_templates WHERE active = true
const CSV_FIELDS = [
  { field: "employee_id", label: "Employee ID", required: true, example: "EMP-001" },
  { field: "full_name", label: "Full Name", required: true, example: "Ahmed Khalil" },
  { field: "phone", label: "Phone (WhatsApp)", required: true, example: "+966551234567" },
  { field: "email", label: "Email", required: true, example: "ahmed@company.com" },
  { field: "department", label: "Department", required: true, example: "Engineering" },
  { field: "role", label: "Role", required: true, example: "Field Engineer" },
  { field: "zone", label: "Zone Name", required: false, example: "Zone A - North Gate" },
  { field: "emergency_contact", label: "Emergency Contact", required: false, example: "+966559876543" },
  { field: "blood_type", label: "Blood Type", required: false, example: "O+" },
];

// ═══════════════════════════════════════════════════════════════
export function CompanyRegister({ onComplete, onBack }: CompanyRegisterProps) {
  const [step, setStep] = useState<RegStep>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 1: Company Info + Owner
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerEmailError, setOwnerEmailError] = useState("");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("SA");
  const [employeeEstimate, setEmployeeEstimate] = useState(25);

  // Business email validation
  const FREE_PROVIDERS = ["gmail.com","yahoo.com","hotmail.com","outlook.com","aol.com","icloud.com","mail.com","protonmail.com","yandex.com","zoho.com","live.com","msn.com","me.com","qq.com","163.com","126.com","gmx.com","web.de","mailinator.com","guerrillamail.com","tempmail.com"];
  const validateBusinessEmail = (email: string) => {
    if (!email) return "";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return "Please enter a valid email address";
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return "Invalid email format";
    if (FREE_PROVIDERS.includes(domain)) return `"${domain}" is a free email provider. Business email required for sending bulk invitations (up to 35,000 employees). Use your company domain like name@${companyName.toLowerCase().replace(/\s+/g, "")}.com`;
    return "";
  };
  const ownerDomain = ownerEmail && !ownerEmailError ? ownerEmail.split("@")[1] : "";
  const dailySendLimit = 5000;
  const totalBatches = employeeEstimate > dailySendLimit ? Math.ceil(employeeEstimate / dailySendLimit) : 1;

  // Step 2: Zone Toggle
  const [hasZones, setHasZones] = useState<boolean | null>(null);

  // Step 3: Zone Builder
  const [zones, setZones] = useState<ZoneEntry[]>([]);
  const [newZoneName, setNewZoneName] = useState("");
  const [newZoneType, setNewZoneType] = useState<ZoneEntry["type"]>("office");
  const [newEvacPoint, setNewEvacPoint] = useState("");
  // Zone GPS
  const [newZoneLat, setNewZoneLat] = useState("");
  const [newZoneLng, setNewZoneLng] = useState("");
  const [newZoneRadius, setNewZoneRadius] = useState("100");
  const [newZoneMapsUrl, setNewZoneMapsUrl] = useState("");
  const [newEvacLat, setNewEvacLat] = useState("");
  const [newEvacLng, setNewEvacLng] = useState("");
  const [newEvacMapsUrl, setNewEvacMapsUrl] = useState("");
  const [zoneGpsMode, setZoneGpsMode] = useState<"coords" | "link">("link");
  const [evacGpsMode, setEvacGpsMode] = useState<"coords" | "link">("link");
  const [zoneParsed, setZoneParsed] = useState(false);
  const [evacParsed, setEvacParsed] = useState(false);

  // Parse Google Maps link → lat/lng
  const parseMapsLink = (link: string, setLat: (v:string)=>void, setLng: (v:string)=>void, setParsed: (v:boolean)=>void) => {
    const patterns = [
      /@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /place\/[^/]*\/(-?\d+\.\d+),(-?\d+\.\d+)/,
      /(-?\d{1,3}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/,
    ];
    for (const p of patterns) {
      const m = link.match(p);
      if (m) { setLat(m[1]); setLng(m[2]); setParsed(true); return; }
    }
    setParsed(false);
  };

  // Step 4: Employees
  const [empMethod, setEmpMethod] = useState<"manual" | "csv" | "later">("manual");
  const [manualEmployees, setManualEmployees] = useState<EmployeeEntry[]>([]);
  const [newEmp, setNewEmp] = useState({ name: "", phone: "", email: "", role: "", department: "", zone: "" });
  const [csvUploaded, setCsvUploaded] = useState(false);
  const [csvCount, setCsvCount] = useState(0);
  const [showFieldGuide, setShowFieldGuide] = useState(false);

  // Step 5: Plan
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [billing, setBilling] = useState<"monthly" | "annual">("monthly");

  // Step 6: Success
  const [inviteCode] = useState(() => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  });
  const [copied, setCopied] = useState(false);

  // ── Navigation ──────────────────────────────────────────────
  const totalSteps = hasZones === false ? 5 : 6;

  const canNext = (): boolean => {
    switch (step) {
      case 1: return companyName.length >= 2 && industry !== "" && ownerName.length >= 2 && (!ownerEmail || !ownerEmailError);
      case 2: return hasZones !== null;
      case 3: return hasZones ? zones.length >= 1 : true;
      case 4: return empMethod === "later" || (empMethod === "manual" && manualEmployees.length >= 1) || (empMethod === "csv" && csvUploaded);
      case 5: return selectedPlan !== null;
      default: return true;
    }
  };

  const handleNext = () => {
    if (step === 2 && hasZones === false) {
      setStep(4); // Skip zone builder
      return;
    }
    if (step < 6) setStep((step + 1) as RegStep);
  };

  const handleBack = () => {
    if (step === 1) { onBack(); return; }
    if (step === 4 && hasZones === false) { setStep(2); return; }
    setStep((step - 1) as RegStep);
  };

  // ── Zone Management ─────────────────────────────────────────
  const addZone = () => {
    if (!newZoneName.trim()) return;
    const lat = parseFloat(newZoneLat) || undefined;
    const lng = parseFloat(newZoneLng) || undefined;
    const evacLat = parseFloat(newEvacLat) || undefined;
    const evacLng = parseFloat(newEvacLng) || undefined;
    setZones([...zones, {
      id: `Z-${zones.length + 1}`,
      name: newZoneName.trim(),
      type: newZoneType,
      evacuationPoint: newEvacPoint.trim() || "Main Gate",
      riskLevel: newZoneType === "restricted" ? "high" : newZoneType === "production" ? "medium" : "low",
      lat, lng,
      radiusMeters: parseInt(newZoneRadius) || 100,
      evacLat, evacLng,
      mapsUrl: lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : undefined,
      evacMapsUrl: evacLat && evacLng ? `https://maps.google.com/?q=${evacLat},${evacLng}&navigate=yes` : undefined,
    }]);
    setNewZoneName(""); setNewEvacPoint("");
    setNewZoneLat(""); setNewZoneLng(""); setNewZoneMapsUrl("");
    setNewEvacLat(""); setNewEvacLng(""); setNewEvacMapsUrl("");
    setZoneParsed(false); setEvacParsed(false);
  };

  const removeZone = (id: string) => setZones(zones.filter(z => z.id !== id));

  // ── Employee Management ─────────────────────────────────────
  const addEmployee = () => {
    if (!newEmp.name || !newEmp.phone) return;
    setManualEmployees([...manualEmployees, {
      id: `EMP-${String(manualEmployees.length + 1).padStart(3, "0")}`,
      ...newEmp,
      zone: newEmp.zone || (zones.length > 0 ? zones[0].name : "—"),
    }]);
    setNewEmp({ name: "", phone: "", email: "", role: "", department: "", zone: "" });
  };

  const handleCsvUpload = useCallback(() => {
    // Mock CSV import
    setCsvUploaded(true);
    setCsvCount(employeeEstimate);
  }, [employeeEstimate]);

  // ── Plan Detection ──────────────────────────────────────────
  const totalEmp = empMethod === "csv" ? csvCount : (empMethod === "manual" ? manualEmployees.length : employeeEstimate);
  const recommendedPlan = PLANS.find(p => totalEmp >= p.min && totalEmp <= p.max) ?? PLANS[3];

  const copyInvite = () => {
    navigator.clipboard?.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="relative flex flex-col h-full" style={{ background: "#05070E" }}>
      {/* Ambient */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[400px]"
          style={{ background: "radial-gradient(circle, rgba(0,200,224,0.06) 0%, transparent 60%)" }} />
      </div>

      {/* Header */}
      <div className="relative z-10 px-5 pt-14 pb-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={handleBack} className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all"
            style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}>
            <ArrowLeft className="size-4" />
            {step === 1 ? "Back" : `Step ${step > 3 && !hasZones ? step - 1 : step}`}
          </button>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full"
            style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
            <Shield className="size-3" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 10, color: "#00C8E0", fontWeight: 600 }}>Free Trial Setup</span>
          </div>
        </div>

        {/* Progress */}
        <div className="flex gap-1.5">
          {Array.from({ length: hasZones === false ? 5 : 6 }).map((_, i) => (
            <div key={i} className="flex-1 h-[3px] rounded-full" style={{
              background: i < (hasZones === false && step > 3 ? step - 1 : step)
                ? "linear-gradient(90deg, #00C8E0, #00E676)"
                : "rgba(255,255,255,0.06)",
            }} />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative z-10 overflow-y-auto px-5 pb-24" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait">
          {/* ════════════════ STEP 1: Company Info ════════════════ */}
          {step === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
              <h2 className="text-white mb-1" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>
                Company <span style={{ color: "#00C8E0" }}>Profile</span>
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 24, lineHeight: 1.6 }}>
                Tell us about your organization & owner account
              </p>

              {/* Owner Name */}
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "1px", display: "block", marginBottom: 6 }}>
                <div className="flex items-center gap-1.5"><Crown className="size-3" style={{ color: "#FF9500" }} /><span>OWNER FULL NAME</span></div>
              </label>
              <input
                value={ownerName}
                onChange={e => setOwnerName(e.target.value)}
                placeholder="e.g. Abdullah Al-Rashid"
                maxLength={100}
                className="w-full bg-transparent text-white outline-none px-4 py-[14px] mb-4"
                style={{
                  borderRadius: 14, fontSize: 14, fontFamily: "inherit",
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                  caretColor: "#00C8E0",
                }}
              />

              {/* Owner Business Email */}
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "1px", display: "block", marginBottom: 6 }}>
                <div className="flex items-center gap-1.5"><Mail className="size-3" style={{ color: "#00C8E0" }} /><span>BUSINESS EMAIL</span>
                  <span className="px-1.5 py-0.5 rounded-md ml-auto" style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.04)" }}>OPTIONAL</span></div>
              </label>
              <input
                value={ownerEmail}
                onChange={e => { setOwnerEmail(e.target.value); setOwnerEmailError(validateBusinessEmail(e.target.value)); }}
                placeholder="you@yourcompany.com"
                maxLength={150}
                className="w-full bg-transparent text-white outline-none px-4 py-[14px]"
                style={{
                  borderRadius: 14, fontSize: 14, fontFamily: "inherit",
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${ownerEmailError ? "rgba(255,45,85,0.3)" : ownerEmail && !ownerEmailError ? "rgba(0,200,83,0.25)" : "rgba(255,255,255,0.07)"}`,
                  caretColor: "#00C8E0",
                }}
              />
              {ownerEmailError && (
                <div className="flex items-start gap-2 mt-2 px-1">
                  <AlertTriangle className="size-3 shrink-0 mt-0.5" style={{ color: "#FF2D55" }} />
                  <p style={{ fontSize: 10, color: "#FF2D55", lineHeight: 1.5 }}>{ownerEmailError}</p>
                </div>
              )}
              {ownerEmail && !ownerEmailError && ownerDomain && (
                <div className="mt-2 p-3 rounded-xl" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.12)" }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <CheckCircle2 className="size-3.5" style={{ color: "#00C853" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853" }}>Business email verified</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <Globe className="size-3" style={{ color: "rgba(0,200,224,0.5)" }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Domain: <span style={{ color: "#00C8E0", fontWeight: 600 }}>@{ownerDomain}</span></span>
                  </div>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5, marginTop: 4 }}>
                    Invitations will be sent from <span style={{ color: "rgba(0,200,224,0.5)" }}>noreply@{ownerDomain}</span> via SOSphere relay.
                    {employeeEstimate > dailySendLimit && (
                      <span style={{ color: "#FF9500" }}> Large team ({employeeEstimate.toLocaleString()} employees) — invitations will be batched: {dailySendLimit.toLocaleString()}/day × {totalBatches} days.</span>
                    )}
                  </p>
                </div>
              )}
              <div className="mb-5" />

              {/* Company Name */}
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "1px", display: "block", marginBottom: 6 }}>
                <div className="flex items-center gap-1.5"><Building2 className="size-3" style={{ color: "rgba(255,255,255,0.25)" }} /><span>COMPANY NAME</span></div>
              </label>
              <input
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="e.g. ARAMCO Safety Division"
                maxLength={150}
                className="w-full bg-transparent text-white outline-none px-4 py-[14px] mb-5"
                style={{
                  borderRadius: 14, fontSize: 14, fontFamily: "inherit",
                  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                  caretColor: "#00C8E0",
                }}
              />

              {/* Industry */}
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "1px", display: "block", marginBottom: 6 }}>
                INDUSTRY
              </label>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {INDUSTRIES.map(ind => {
                  const Icon = ind.icon;
                  const sel = industry === ind.id;
                  return (
                    <button key={ind.id} onClick={() => setIndustry(ind.id)}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl transition-all"
                      style={{
                        background: sel ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                        border: sel ? "1px solid rgba(0,200,224,0.25)" : "1px solid rgba(255,255,255,0.05)",
                      }}>
                      <Icon className="size-5" style={{ color: sel ? "#00C8E0" : "rgba(255,255,255,0.25)" }} />
                      <span style={{ fontSize: 10, fontWeight: 600, color: sel ? "#00C8E0" : "rgba(255,255,255,0.35)" }}>{ind.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Employee Estimate */}
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "1px", display: "block", marginBottom: 6 }}>
                ESTIMATED TEAM SIZE
              </label>
              <div className="p-4 rounded-xl mb-2" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between mb-3">
                  <span style={{ fontSize: 28, fontWeight: 900, color: "#00C8E0" }}>{employeeEstimate}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>employees</span>
                </div>
                <input type="range" min={1} max={35000} step={employeeEstimate < 100 ? 1 : employeeEstimate < 1000 ? 10 : 100}
                  value={employeeEstimate} onChange={e => setEmployeeEstimate(+e.target.value)}
                  className="w-full" style={{ accentColor: "#00C8E0", height: 4 }} />
                <div className="flex justify-between mt-1" style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
                  <span>1</span><span>100</span><span>1K</span><span>5K</span><span>10K</span><span>35K</span>
                </div>
                {employeeEstimate > dailySendLimit && (
                  <div className="flex items-center gap-1.5 mt-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(255,149,0,0.04)", border: "1px solid rgba(255,149,0,0.1)" }}>
                    <Clock className="size-3 shrink-0" style={{ color: "#FF9500" }} />
                    <p style={{ fontSize: 8, color: "#FF9500" }}>
                      {employeeEstimate.toLocaleString()} employees → Invitations sent in {totalBatches} batches ({dailySendLimit.toLocaleString()}/day). Business email required.
                    </p>
                  </div>
                )}
              </div>

              {/* Country */}
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.25)", letterSpacing: "1px", display: "block", marginBottom: 6, marginTop: 16 }}>
                COUNTRY
              </label>
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <Globe className="size-4" style={{ color: "rgba(255,255,255,0.25)" }} />
                <select value={country} onChange={e => setCountry(e.target.value)}
                  className="flex-1 bg-transparent text-white outline-none" style={{ fontSize: 13, fontFamily: "inherit" }}>
                  <option value="SA" style={{ background: "#0A1220" }}>SA - Saudi Arabia</option>
                  <option value="AE" style={{ background: "#0A1220" }}>AE - UAE</option>
                  <option value="QA" style={{ background: "#0A1220" }}>QA - Qatar</option>
                  <option value="KW" style={{ background: "#0A1220" }}>KW - Kuwait</option>
                  <option value="BH" style={{ background: "#0A1220" }}>BH - Bahrain</option>
                  <option value="OM" style={{ background: "#0A1220" }}>OM - Oman</option>
                  <option value="EG" style={{ background: "#0A1220" }}>EG - Egypt</option>
                  <option value="US" style={{ background: "#0A1220" }}>US - United States</option>
                  <option value="GB" style={{ background: "#0A1220" }}>GB - United Kingdom</option>
                  <option value="OTHER" style={{ background: "#0A1220" }}>🌍 Other</option>
                </select>
              </div>
            </motion.div>
          )}

          {/* ════════════════ STEP 2: Hybrid Zone Toggle ════════════════ */}
          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
              <h2 className="text-white mb-1" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>
                Field <span style={{ color: "#00C8E0" }}>Zones</span>
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 24, lineHeight: 1.6 }}>
                Does your company operate in designated field zones?
              </p>

              {/* YES Card */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setHasZones(true)}
                className="w-full text-left p-5 rounded-2xl mb-3 relative overflow-hidden"
                style={{
                  background: hasZones === true ? "rgba(0,200,224,0.06)" : "rgba(255,255,255,0.02)",
                  border: hasZones === true ? "1.5px solid rgba(0,200,224,0.3)" : "1.5px solid rgba(255,255,255,0.06)",
                  boxShadow: hasZones === true ? "0 4px 20px rgba(0,200,224,0.08)" : "none",
                }}
              >
                {hasZones === true && (
                  <div className="absolute top-0 right-0 w-24 h-24 pointer-events-none"
                    style={{ background: "radial-gradient(circle at top right, rgba(0,200,224,0.12), transparent 70%)" }} />
                )}
                <div className="flex items-start gap-3 relative z-10">
                  <div className="size-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: hasZones === true ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${hasZones === true ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.06)"}`,
                    }}>
                    <Layers className="size-5" style={{ color: hasZones === true ? "#00C8E0" : "rgba(255,255,255,0.25)" }} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>Yes, We Have Zones</p>
                      <div className="size-5 rounded-full flex items-center justify-center"
                        style={{ border: `2px solid ${hasZones === true ? "#00C8E0" : "rgba(255,255,255,0.1)"}` }}>
                        {hasZones === true && <div className="size-2.5 rounded-full" style={{ background: "#00C8E0" }} />}
                      </div>
                    </div>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.6, marginTop: 4 }}>
                      Multiple work areas with different safety requirements
                    </p>
                    {/* Zone Features */}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {[
                        { label: "Geofencing", icon: MapPin, color: "#00C8E0" },
                        { label: "Evacuation Points", icon: Navigation, color: "#FF9500" },
                        { label: "Zone Admins", icon: Users, color: "#7B5EFF" },
                        { label: "Risk Levels", icon: AlertTriangle, color: "#FF2D55" },
                      ].map(f => (
                        <span key={f.label} className="inline-flex items-center gap-1 px-2 py-1 rounded-md"
                          style={{ background: `${f.color}08`, border: `1px solid ${f.color}15`, fontSize: 9, fontWeight: 600, color: `${f.color}AA` }}>
                          <f.icon className="size-[9px]" />
                          {f.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.button>

              {/* NO Card */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setHasZones(false)}
                className="w-full text-left p-5 rounded-2xl relative overflow-hidden"
                style={{
                  background: hasZones === false ? "rgba(255,149,0,0.05)" : "rgba(255,255,255,0.02)",
                  border: hasZones === false ? "1.5px solid rgba(255,149,0,0.25)" : "1.5px solid rgba(255,255,255,0.06)",
                  boxShadow: hasZones === false ? "0 4px 20px rgba(255,149,0,0.06)" : "none",
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="size-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: hasZones === false ? "rgba(255,149,0,0.1)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${hasZones === false ? "rgba(255,149,0,0.2)" : "rgba(255,255,255,0.06)"}`,
                    }}>
                    <Building2 className="size-5" style={{ color: hasZones === false ? "#FF9500" : "rgba(255,255,255,0.25)" }} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>No, Single Location</p>
                      <div className="size-5 rounded-full flex items-center justify-center"
                        style={{ border: `2px solid ${hasZones === false ? "#FF9500" : "rgba(255,255,255,0.1)"}` }}>
                        {hasZones === false && <div className="size-2.5 rounded-full" style={{ background: "#FF9500" }} />}
                      </div>
                    </div>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.6, marginTop: 4 }}>
                      All employees work from one location or without designated areas
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {[
                        { label: "Team SOS", icon: Shield, color: "#00C8E0" },
                        { label: "GPS Tracking", icon: MapPin, color: "#00C853" },
                        { label: "Check-in Timer", icon: Clock, color: "#FF9500" },
                      ].map(f => (
                        <span key={f.label} className="inline-flex items-center gap-1 px-2 py-1 rounded-md"
                          style={{ background: `${f.color}08`, border: `1px solid ${f.color}15`, fontSize: 9, fontWeight: 600, color: `${f.color}AA` }}>
                          <f.icon className="size-[9px]" />
                          {f.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.button>

              {/* Info card */}
              <div className="mt-5 p-3.5 rounded-xl" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)" }}>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", lineHeight: 1.7, textAlign: "center" }}>
                  💡 You can always add zones later from the Company Dashboard
                </p>
              </div>
            </motion.div>
          )}

          {/* ════════════════ STEP 3: Zone Builder ════════════════ */}
          {step === 3 && hasZones && (
            <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>
                  Build <span style={{ color: "#00C8E0" }}>Zones</span>
                </h2>
                {zones.length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.1)", padding: "3px 10px", borderRadius: 999, border: "1px solid rgba(0,200,224,0.2)" }}>
                    {zones.length} zone{zones.length > 1 ? "s" : ""} added
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 16, lineHeight: 1.6 }}>
                Define your work zones, GPS boundaries and evacuation points
              </p>

              {/* Zone List — shown at top */}
              {zones.length > 0 && (
                <div className="space-y-2 mb-4">
                  {zones.map((z, i) => {
                    const typeColor = ZONE_TYPES.find(t => t.id === z.type)?.color || "#00C8E0";
                    return (
                      <motion.div key={z.id}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                        className="flex items-center gap-3 p-3 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="size-9 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: `${typeColor}12`, border: `1px solid ${typeColor}20` }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke={typeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{z.name}</p>
                            {z.lat && z.lng && (
                              <span style={{ fontSize: 8, fontWeight: 700, color: "#00C853", background: "rgba(0,200,83,0.1)", padding: "1px 6px", borderRadius: 999, flexShrink: 0, border: "1px solid rgba(0,200,83,0.2)" }}>GPS ✓</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span style={{ fontSize: 10, color: typeColor, fontWeight: 600 }}>{z.type.toUpperCase()}</span>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>·</span>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                              {z.evacuationPoint}
                              {z.evacLat && <span style={{ color: "#00C853", fontWeight: 600 }}> · GPS ✓</span>}
                            </span>
                            {z.radiusMeters && (
                              <>
                                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>·</span>
                                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{z.radiusMeters}m radius</span>
                              </>
                            )}
                          </div>
                        </div>
                        <button onClick={() => removeZone(z.id)}
                          style={{ color: "rgba(255,255,255,0.2)", background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                          <X className="size-4" />
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Add Zone Form */}
              <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(0,200,224,0.15)", background: "rgba(0,200,224,0.02)" }}>
                {/* Form header */}
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,200,224,0.04)" }}>
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#00C8E0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:14,height:14}}>
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>
                      {zones.length === 0 ? "Add First Zone" : "Add Another Zone"}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                    You can add more zones from the dashboard after setup
                  </span>
                </div>

                <div className="p-4 space-y-3">
                  {/* Zone name */}
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px", display: "block", marginBottom: 4 }}>ZONE NAME</label>
                    <input key={`zone-input-${zones.length}`} value={newZoneName} onChange={e => setNewZoneName(e.target.value)}
                      placeholder="e.g. Zone A - North Gate" maxLength={100}
                      className="w-full bg-transparent text-white outline-none px-3 py-2.5 rounded-xl"
                      style={{ fontSize: 13, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", caretColor: "#00C8E0" }} />
                  </div>

                  {/* Zone type */}
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px", display: "block", marginBottom: 6 }}>ZONE TYPE</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {ZONE_TYPES.map(zt => (
                        <button key={zt.id} onClick={() => setNewZoneType(zt.id)}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 8,
                            background: newZoneType === zt.id ? `${zt.color}15` : "rgba(255,255,255,0.02)",
                            border: `1px solid ${newZoneType === zt.id ? `${zt.color}35` : "rgba(255,255,255,0.06)"}`,
                            color: newZoneType === zt.id ? zt.color : "rgba(255,255,255,0.3)",
                            cursor: "pointer",
                          }}>
                          {zt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Zone GPS */}
                  <div style={{ padding: "12px", borderRadius: 12, background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.1)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#00C8E0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:12,height:12}}>
                          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                        </svg>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>ZONE GPS</span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.04)", padding: "1px 6px", borderRadius: 999 }}>OPTIONAL</span>
                      </div>
                      <div className="flex gap-1">
                        {(["link", "coords"] as const).map(m => (
                          <button key={m} onClick={() => setZoneGpsMode(m)}
                            style={{ fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 6, cursor: "pointer",
                              background: zoneGpsMode === m ? "rgba(0,200,224,0.15)" : "transparent",
                              border: `1px solid ${zoneGpsMode === m ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.06)"}`,
                              color: zoneGpsMode === m ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>
                            {m === "link" ? "Maps Link" : "Lat/Lng"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {zoneGpsMode === "link" ? (
                      <div>
                        <input value={newZoneMapsUrl} onChange={e => { setNewZoneMapsUrl(e.target.value); parseMapsLink(e.target.value, setNewZoneLat, setNewZoneLng, setZoneParsed); }}
                          placeholder="Paste Google Maps link..."
                          className="w-full bg-transparent text-white outline-none px-3 py-2 rounded-lg"
                          style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: `1px solid ${zoneParsed ? "rgba(0,200,83,0.3)" : "rgba(255,255,255,0.06)"}` }} />
                        {zoneParsed && <p style={{ fontSize: 10, color: "#00C853", marginTop: 4 }}>✓ {newZoneLat}, {newZoneLng}</p>}
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input value={newZoneLat} onChange={e => setNewZoneLat(e.target.value)} placeholder="Latitude"
                          className="flex-1 bg-transparent text-white outline-none px-3 py-2 rounded-lg"
                          style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} />
                        <input value={newZoneLng} onChange={e => setNewZoneLng(e.target.value)} placeholder="Longitude"
                          className="flex-1 bg-transparent text-white outline-none px-3 py-2 rounded-lg"
                          style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>Radius:</span>
                      <input value={newZoneRadius} onChange={e => setNewZoneRadius(e.target.value)} type="number" min="10" max="10000"
                        style={{ width: 70, fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "2px 8px", color: "#fff", outline: "none", textAlign: "center" }} />
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>meters</span>
                    </div>
                  </div>

                  {/* Evac point name */}
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,149,0,0.7)", letterSpacing: "0.5px", display: "block", marginBottom: 4 }}>EVACUATION POINT NAME</label>
                    <input value={newEvacPoint} onChange={e => setNewEvacPoint(e.target.value)}
                      placeholder="e.g. Assembly Point A" maxLength={100}
                      className="w-full bg-transparent text-white outline-none px-3 py-2.5 rounded-xl"
                      style={{ fontSize: 13, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,149,0,0.15)", caretColor: "#FF9500" }} />
                  </div>

                  {/* Evac GPS */}
                  <div style={{ padding: "12px", borderRadius: 12, background: "rgba(255,149,0,0.03)", border: "1px solid rgba(255,149,0,0.1)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#FF9500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:12,height:12}}>
                          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                        </svg>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#FF9500" }}>EVACUATION GPS</span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.04)", padding: "1px 6px", borderRadius: 999 }}>OPTIONAL</span>
                      </div>
                      <div className="flex gap-1">
                        {(["link", "coords"] as const).map(m => (
                          <button key={m} onClick={() => setEvacGpsMode(m)}
                            style={{ fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 6, cursor: "pointer",
                              background: evacGpsMode === m ? "rgba(255,149,0,0.15)" : "transparent",
                              border: `1px solid ${evacGpsMode === m ? "rgba(255,149,0,0.3)" : "rgba(255,255,255,0.06)"}`,
                              color: evacGpsMode === m ? "#FF9500" : "rgba(255,255,255,0.3)" }}>
                            {m === "link" ? "Maps Link" : "Lat/Lng"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {evacGpsMode === "link" ? (
                      <div>
                        <input value={newEvacMapsUrl} onChange={e => { setNewEvacMapsUrl(e.target.value); parseMapsLink(e.target.value, setNewEvacLat, setNewEvacLng, setEvacParsed); }}
                          placeholder="Paste Google Maps link for assembly point..."
                          className="w-full bg-transparent text-white outline-none px-3 py-2 rounded-lg"
                          style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: `1px solid ${evacParsed ? "rgba(0,200,83,0.3)" : "rgba(255,255,255,0.06)"}` }} />
                        {evacParsed && <p style={{ fontSize: 10, color: "#00C853", marginTop: 4 }}>✓ {newEvacLat}, {newEvacLng}</p>}
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input value={newEvacLat} onChange={e => setNewEvacLat(e.target.value)} placeholder="Latitude"
                          className="flex-1 bg-transparent text-white outline-none px-3 py-2 rounded-lg"
                          style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} />
                        <input value={newEvacLng} onChange={e => setNewEvacLng(e.target.value)} placeholder="Longitude"
                          className="flex-1 bg-transparent text-white outline-none px-3 py-2 rounded-lg"
                          style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }} />
                      </div>
                    )}
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 6, lineHeight: 1.5 }}>
                      Employees will navigate here via Google Maps when evacuation is triggered
                    </p>
                  </div>

                  {/* Add button */}
                  <button onClick={addZone} disabled={!newZoneName.trim()}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl transition-all"
                    style={{
                      background: newZoneName.trim() ? "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.08))" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${newZoneName.trim() ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.05)"}`,
                      color: newZoneName.trim() ? "#00C8E0" : "rgba(255,255,255,0.15)",
                      fontSize: 13, fontWeight: 700, cursor: newZoneName.trim() ? "pointer" : "default",
                    }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                    {zones.length === 0 ? "Add Zone" : "Add Another Zone"}
                  </button>
                </div>
              </div>

              {zones.length === 0 && (
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: 12 }}>
                  Add at least one zone to continue
                </p>
              )}
            </motion.div>
          )}

          {/* ════════════════ STEP 4: Employee Setup ════════════════ */}
          {step === 4 && (
            <motion.div key="s4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
              <h2 className="text-white mb-1" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>
                Add <span style={{ color: "#00C8E0" }}>Employees</span>
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 20, lineHeight: 1.6 }}>
                {employeeEstimate <= 15
                  ? "Add your team members manually or import later"
                  : "Import your team via CSV for faster setup"}
              </p>

              {/* Method Tabs */}
              <div className="flex gap-1.5 p-1 rounded-xl mb-5"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                {([
                  { id: "manual" as const, label: "Manual", icon: User },
                  { id: "csv" as const, label: "CSV Import", icon: Upload },
                  { id: "later" as const, label: "Later", icon: Clock },
                ]).map(tab => (
                  <button key={tab.id} onClick={() => setEmpMethod(tab.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg transition-all"
                    style={{
                      background: empMethod === tab.id ? "rgba(0,200,224,0.1)" : "transparent",
                      border: empMethod === tab.id ? "1px solid rgba(0,200,224,0.2)" : "1px solid transparent",
                      fontSize: 11, fontWeight: empMethod === tab.id ? 700 : 500,
                      color: empMethod === tab.id ? "#00C8E0" : "rgba(255,255,255,0.3)",
                    }}>
                    <tab.icon className="size-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Manual Entry */}
              {empMethod === "manual" && (
                <div>
                  {/* Quick Add Form */}
                  <div className="p-3.5 rounded-xl mb-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input value={newEmp.name} onChange={e => setNewEmp({ ...newEmp, name: e.target.value })}
                        placeholder="Full Name *" maxLength={100} className="bg-transparent text-white outline-none px-3 py-2.5 rounded-lg"
                        style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", caretColor: "#00C8E0" }} />
                      <input value={newEmp.phone} onChange={e => setNewEmp({ ...newEmp, phone: e.target.value })}
                        placeholder="Phone *" maxLength={16} className="bg-transparent text-white outline-none px-3 py-2.5 rounded-lg"
                        style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", caretColor: "#00C8E0", direction: "ltr" }} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input value={newEmp.role} onChange={e => setNewEmp({ ...newEmp, role: e.target.value })}
                        placeholder="Role" maxLength={100} className="bg-transparent text-white outline-none px-3 py-2.5 rounded-lg"
                        style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", caretColor: "#00C8E0" }} />
                      <input value={newEmp.department} onChange={e => setNewEmp({ ...newEmp, department: e.target.value })}
                        placeholder="Department" maxLength={100} className="bg-transparent text-white outline-none px-3 py-2.5 rounded-lg"
                        style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", caretColor: "#00C8E0" }} />
                    </div>

                    {/* Zone selector (if zones enabled) */}
                    {hasZones && zones.length > 0 && (
                      <select value={newEmp.zone} onChange={e => setNewEmp({ ...newEmp, zone: e.target.value })}
                        className="w-full bg-transparent text-white outline-none px-3 py-2.5 rounded-lg mb-2"
                        style={{ fontSize: 12, fontFamily: "inherit", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <option value="" style={{ background: "#0A1220" }}>Assign to zone...</option>
                        {zones.map(z => (
                          <option key={z.id} value={z.name} style={{ background: "#0A1220" }}>{z.name}</option>
                        ))}
                      </select>
                    )}

                    <button onClick={addEmployee} disabled={!newEmp.name || !newEmp.phone}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl"
                      style={{
                        background: newEmp.name && newEmp.phone ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${newEmp.name && newEmp.phone ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.05)"}`,
                        color: newEmp.name && newEmp.phone ? "#00C8E0" : "rgba(255,255,255,0.2)",
                        fontSize: 12, fontWeight: 600,
                      }}>
                      <Plus className="size-3.5" /> Add Employee
                    </button>
                  </div>

                  {/* Employee List */}
                  <div className="space-y-1.5">
                    {manualEmployees.map((emp, i) => (
                      <motion.div key={emp.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                        <div className="size-7 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>{emp.name.charAt(0)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{emp.name}</p>
                          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                            {emp.role || "Employee"} {emp.zone ? `· ${emp.zone}` : ""}
                          </p>
                        </div>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>{emp.id}</span>
                      </motion.div>
                    ))}
                  </div>

                  {manualEmployees.length === 0 && (
                    <p className="text-center py-4" style={{ fontSize: 12, color: "rgba(255,255,255,0.15)" }}>
                      Add at least one employee to continue
                    </p>
                  )}
                </div>
              )}

              {/* CSV Import */}
              {empMethod === "csv" && (
                <div>
                  {/* CSV Field Guide Toggle */}
                  <button onClick={() => setShowFieldGuide(!showFieldGuide)}
                    className="w-full flex items-center gap-3 p-3.5 rounded-xl mb-4"
                    style={{ background: "rgba(255,149,0,0.05)", border: "1px solid rgba(255,149,0,0.15)" }}>
                    <FileText className="size-5 shrink-0" style={{ color: "#FF9500" }} />
                    <div className="flex-1 text-left">
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#FF9500" }}>CSV Field Guide</p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>How to structure your employee file</p>
                    </div>
                    <ChevronDown className="size-4" style={{ color: "#FF9500", transform: showFieldGuide ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                  </button>

                  {/* Field Guide Content */}
                  <AnimatePresence>
                    {showFieldGuide && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden mb-4">
                        <div className="p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 10, letterSpacing: "1px" }}>
                            REQUIRED & OPTIONAL COLUMNS
                          </p>
                          <div className="space-y-1.5">
                            {CSV_FIELDS.map(f => (
                              <div key={f.field} className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg"
                                style={{ background: "rgba(255,255,255,0.02)" }}>
                                <div className="size-1.5 rounded-full shrink-0"
                                  style={{ background: f.required ? "#FF2D55" : "rgba(255,255,255,0.15)" }} />
                                <span style={{ fontSize: 11, fontWeight: 600, color: f.required ? "#00C8E0" : "rgba(255,255,255,0.4)", flex: 1 }}>{f.label}</span>
                                <code style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)", padding: "2px 6px", borderRadius: 4 }}>{f.example}</code>
                              </div>
                            ))}
                          </div>
                          {hasZones && (
                            <div className="mt-3 p-2.5 rounded-lg" style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.1)" }}>
                              <p style={{ fontSize: 10, color: "#00C8E0", fontWeight: 600 }}>
                                📍 Zone column must match the zone names you created in Step 3
                              </p>
                            </div>
                          )}
                          <div className="mt-3 p-2.5 rounded-lg" style={{ background: "rgba(255,149,0,0.04)", border: "1px solid rgba(255,149,0,0.1)" }}>
                            <p style={{ fontSize: 10, color: "#FF9500", fontWeight: 600 }}>
                              ⚠ Red dots = required fields. Rows missing required fields will be rejected.
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Download Template */}
                  <button className="w-full flex items-center gap-3 p-3.5 rounded-xl mb-3"
                    onClick={() => { hapticSuccess(); toast.success("CSV Template Downloaded", { description: "Template with columns: Name, Email, Phone, Role, Zone — ready to fill" }); }}
                    style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.12)", cursor: "pointer" }}>
                    <Download className="size-4" style={{ color: "#00C8E0" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#00C8E0" }}>Download CSV Template</span>
                  </button>

                  {/* Upload Area */}
                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx" className="hidden"
                    onChange={handleCsvUpload} />

                  {!csvUploaded ? (
                    <button onClick={() => fileInputRef.current?.click()}
                      className="w-full flex flex-col items-center gap-3 py-8 rounded-2xl"
                      style={{ background: "rgba(255,255,255,0.02)", border: "2px dashed rgba(255,255,255,0.08)" }}>
                      <div className="size-12 rounded-2xl flex items-center justify-center"
                        style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                        <Upload className="size-6" style={{ color: "#00C8E0" }} />
                      </div>
                      <div className="text-center">
                        <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Upload CSV File</p>
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>Drag & drop or tap to browse</p>
                      </div>
                    </button>
                  ) : (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                      className="p-4 rounded-2xl"
                      style={{ background: "rgba(0,200,83,0.05)", border: "1px solid rgba(0,200,83,0.2)" }}>
                      <div className="flex items-center gap-3 mb-3">
                        <CheckCircle2 className="size-5" style={{ color: "#00C853" }} />
                        <div>
                          <p style={{ fontSize: 14, fontWeight: 700, color: "#00C853" }}>File Uploaded Successfully</p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>employees_data.csv</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 rounded-lg text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                          <p style={{ fontSize: 18, fontWeight: 800, color: "#00C8E0" }}>{csvCount}</p>
                          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Employees</p>
                        </div>
                        <div className="p-2 rounded-lg text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                          <p style={{ fontSize: 18, fontWeight: 800, color: "#00C853" }}>{csvCount}</p>
                          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Valid</p>
                        </div>
                        <div className="p-2 rounded-lg text-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                          <p style={{ fontSize: 18, fontWeight: 800, color: "#FF9500" }}>0</p>
                          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Warnings</p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {/* Later Option */}
              {empMethod === "later" && (
                <div className="p-5 rounded-2xl text-center"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <Clock className="size-10 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                  <p className="text-white mb-1" style={{ fontSize: 15, fontWeight: 700 }}>Add Employees Later</p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.7 }}>
                    You can invite employees from the Company Dashboard after setup. Share the invite code or import via CSV anytime.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* ════════════════ STEP 5: Plan Selection ════════════════ */}
          {step === 5 && (
            <motion.div key="s5" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
              <h2 className="text-white mb-1" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>
                Choose <span style={{ color: "#00C8E0" }}>Plan</span>
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginBottom: 20, lineHeight: 1.6 }}>
                Recommended based on {totalEmp} employees
              </p>

              {/* Billing Toggle */}
              <div className="flex p-1 rounded-xl mb-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                {(["monthly", "annual"] as const).map(b => (
                  <button key={b} onClick={() => setBilling(b)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg transition-all"
                    style={{
                      background: billing === b ? "rgba(0,200,224,0.1)" : "transparent",
                      border: billing === b ? "1px solid rgba(0,200,224,0.2)" : "1px solid transparent",
                      fontSize: 12, fontWeight: billing === b ? 700 : 500,
                      color: billing === b ? "#00C8E0" : "rgba(255,255,255,0.3)",
                    }}>
                    {b === "monthly" ? "Monthly" : "Annual"}
                    {b === "annual" && <span style={{ fontSize: 8, fontWeight: 800, color: "#00C853", background: "rgba(0,200,83,0.15)", borderRadius: 4, padding: "1px 4px" }}>SAVE</span>}
                  </button>
                ))}
              </div>

              {/* Plan Cards */}
              <div className="space-y-2.5">
                {PLANS.map((plan, i) => {
                  const isRec = recommendedPlan.id === plan.id;
                  const isSel = selectedPlan === plan.id || (!selectedPlan && isRec);
                  const price = billing === "monthly" ? plan.price : (plan.annualMonthly > 0 ? plan.annualMonthly : plan.price);
                  return (
                    <motion.button key={plan.id}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedPlan(plan.id)}
                      className="w-full flex items-center gap-3 p-4 rounded-xl text-left transition-all"
                      style={{
                        background: isSel ? `${plan.color}0A` : "rgba(255,255,255,0.02)",
                        border: `1.5px solid ${isSel ? `${plan.color}35` : "rgba(255,255,255,0.05)"}`,
                        boxShadow: isSel ? `0 4px 16px ${plan.color}12` : "none",
                      }}>
                      <div className="size-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: `${plan.color}12`, border: `1px solid ${plan.color}20` }}>
                        {plan.id === "starter" && <Shield className="size-5" style={{ color: plan.color }} />}
                        {plan.id === "growth" && <ShieldCheck className="size-5" style={{ color: plan.color }} />}
                        {plan.id === "business" && <Zap className="size-5" style={{ color: plan.color }} />}
                        {plan.id === "enterprise" && <Crown className="size-5" style={{ color: plan.color }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{plan.name}</span>
                          {isRec && <span style={{ fontSize: 8, fontWeight: 800, color: plan.color, background: `${plan.color}15`, border: `1px solid ${plan.color}25`, borderRadius: 5, padding: "1px 5px" }}>RECOMMENDED</span>}
                          {plan.popular && !isRec && <span style={{ fontSize: 8, fontWeight: 800, color: "#7B5EFF", background: "rgba(123,94,255,0.12)", borderRadius: 5, padding: "1px 5px" }}>POPULAR</span>}
                        </div>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{plan.range} employees</span>
                      </div>
                      <div className="text-right shrink-0">
                        {price > 0 ? (
                          <>
                            <span style={{ fontSize: 20, fontWeight: 900, color: plan.color }}>${price}</span>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>/mo</span>
                          </>
                        ) : (
                          <span style={{ fontSize: 14, fontWeight: 800, color: plan.color }}>Custom</span>
                        )}
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              {/* Trial Notice */}
              <div className="mt-5 flex items-center gap-2.5 p-3 rounded-xl"
                style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.12)" }}>
                <Lock className="size-4 shrink-0" style={{ color: "#00C853" }} />
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                  <span style={{ color: "#00C853", fontWeight: 700 }}>14-day free trial.</span> Card saved but not charged until trial ends. Cancel anytime.
                </p>
              </div>
            </motion.div>
          )}

          {/* ════════════════ STEP 6: Success ════════════════ */}
          {step === 6 && (
            <motion.div key="s6" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
              <div className="text-center pt-4 pb-6">
                {/* Success animation */}
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
                  className="relative mx-auto mb-5"
                  style={{ width: 80, height: 80 }}
                >
                  <motion.div
                    animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute inset-0 rounded-[24px]"
                    style={{ background: "rgba(0,200,83,0.15)", filter: "blur(12px)" }}
                  />
                  <div className="relative size-full rounded-[24px] flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, rgba(0,200,83,0.15), rgba(0,200,83,0.05))", border: "1px solid rgba(0,200,83,0.3)" }}>
                    <CheckCircle2 className="size-10" style={{ color: "#00C853" }} />
                  </div>
                </motion.div>

                <h2 className="text-white" style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-0.5px" }}>
                  {companyName}
                </h2>
                <p style={{ fontSize: 13, color: "#00C853", fontWeight: 600, marginTop: 4 }}>Company Created Successfully!</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 6, lineHeight: 1.6 }}>
                  14-day trial activated. Owner: <span style={{ color: "#00C8E0" }}>{ownerName}</span>
                </p>

                {/* Invitation sending status */}
                {ownerDomain && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                    className="mt-4 p-3 rounded-xl text-left" style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.12)" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <motion.div animate={{ rotate: [0, 360] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                        <Send className="size-3.5" style={{ color: "#00C8E0" }} /></motion.div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>Bulk Invitation Engine</span>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Sending from</span>
                        <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(0,200,224,0.6)" }}>noreply@{ownerDomain}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Total invitations</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: "#00C853" }}>{totalEmp.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Daily limit</span>
                        <span style={{ fontSize: 9, fontWeight: 600, color: "#FF9500" }}>{dailySendLimit.toLocaleString()}/day</span>
                      </div>
                      {totalBatches > 1 && (
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Batch schedule</span>
                          <span style={{ fontSize: 9, fontWeight: 600, color: "#FF9500" }}>{totalBatches} batches over {totalBatches} days</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Channels</span>
                        <span style={{ fontSize: 9, fontWeight: 600, color: "#7B5EFF" }}>Email + WhatsApp + SMS</span>
                      </div>
                    </div>
                    <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <motion.div initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 3, delay: 1 }}
                        className="h-full rounded-full" style={{ background: "linear-gradient(90deg, #00C8E0, #00C853)" }} />
                    </div>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>
                      Business email required: ensures deliverability for {totalEmp > 1000 ? "enterprise-scale" : "bulk"} sending ({totalEmp.toLocaleString()} recipients)
                    </p>
                  </motion.div>
                )}
              </div>

              {/* Invite Code Card */}
              <div className="p-5 rounded-2xl mb-4"
                style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.15)" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "1px", marginBottom: 10, textAlign: "center" }}>
                  EMPLOYEE INVITE CODE
                </p>
                <div className="flex items-center justify-center gap-1.5 mb-4">
                  {inviteCode.split("").map((char, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.08 }}
                      className="size-11 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.2)" }}>
                      <span style={{ fontSize: 20, fontWeight: 900, color: "#00C8E0" }}>{char}</span>
                    </motion.div>
                  ))}
                </div>
                <button onClick={copyInvite}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all"
                  style={{
                    background: copied ? "rgba(0,200,83,0.1)" : "rgba(0,200,224,0.08)",
                    border: `1px solid ${copied ? "rgba(0,200,83,0.25)" : "rgba(0,200,224,0.2)"}`,
                    color: copied ? "#00C853" : "#00C8E0",
                    fontSize: 13, fontWeight: 600,
                  }}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "Copied!" : "Copy Invite Code"}
                </button>
              </div>

              {/* How employees join */}
              <div className="p-4 rounded-2xl mb-4"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>
                  Employee Journey (Auto-Sent):
                </p>
                <div className="space-y-3">
                  {[
                    { step: "1", text: "Receives Email + WhatsApp with download links", icon: Mail, color: "#7B5EFF" },
                    { step: "2", text: "Downloads app → Opens Quick Join link", icon: Phone, color: "#00C8E0" },
                    { step: "3", text: "Phone auto-matches CSV �� Instant access", icon: CheckCircle2, color: "#FF9500" },
                    { step: "4", text: "Quick Setup: PIN + emergency contact (2 min)", icon: Lock, color: "#00C853" },
                    { step: "5", text: "Welcome → Full access to assigned zone", icon: Shield, color: "#00C8E0" },
                  ].map((s, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="size-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `${s.color}10`, border: `1px solid ${s.color}20` }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: s.color }}>{s.step}</span>
                      </div>
                      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>{s.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="p-3 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <p style={{ fontSize: 18, fontWeight: 900, color: "#00C8E0" }}>{totalEmp}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Employees</p>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <p style={{ fontSize: 18, fontWeight: 900, color: hasZones ? "#FF9500" : "rgba(255,255,255,0.3)" }}>{hasZones ? zones.length : "—"}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Zones</p>
                </div>
                <div className="p-3 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <p style={{ fontSize: 18, fontWeight: 900, color: "#00C853" }}>14</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>Trial Days</p>
                </div>
              </div>

              {/* Launch Button */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={async () => {
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session?.user) { toast.error("Session expired. Please sign in again."); return; }

                    const userId = session.user.id;
                    const inviteCode = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
                    const planId = selectedPlan ?? recommendedPlan.id;

                    // 1. Save company
                    const { data: company, error: companyError } = await supabase
                      .from("companies")
                      .upsert({
                        owner_id: userId,
                        name: companyName,
                        plan: planId,
                        billing_cycle: billing,
                        invite_code: inviteCode,
                        industry,
                        country,
                        employee_estimate: employeeEstimate,
                        has_zones: hasZones ?? false,
                        is_active: true,
                        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                      }, { onConflict: "owner_id" })
                      .select("id").single();

                    if (companyError || !company) {
                      console.error("[Register] Company save failed:", companyError);
                      toast.error("Failed to save company. Please try again.");
                      return;
                    }

                    const companyId = company.id;

                    // 2. Save zones
                    if (zones.length > 0) {
                      const zoneRows = zones.map(z => ({
                        company_id: companyId,
                        name: z.name,
                        type: z.type,
                        risk_level: z.riskLevel,
                        evacuation_point: z.evacuationPoint,
                        lat: z.lat ?? null,
                        lon: z.lng ?? null,
                        lng: z.lng ?? null,
                        radius: z.radiusMeters ?? null,
                        radius_meters: z.radiusMeters ?? null,
                        evac_lat: z.evacLat ?? null,
                        evac_lng: z.evacLng ?? null,
                      }));
                      const { error: zonesError } = await supabase.from("zones").insert(zoneRows);
                      if (zonesError) console.error("[Register] Zones save failed:", zonesError);
                    }

                    // 3. Save invitations (employees + admins)
                    const allMembers = [
                      ...manualEmployees.map(e => ({
                        company_id: companyId,
                        name: e.name,
                        email: e.email || null,
                        phone: e.phone,
                        role: e.role || "employee",
                        department: e.department || null,
                        zone_name: e.zone || null,
                        status: "pending",
                        invited_by: userId,
                        role_type: "employee",
                      })),
                    ];

                    if (allMembers.length > 0) {
                      const { error: invError } = await supabase.from("invitations").insert(allMembers);
                      if (invError) console.error("[Register] Invitations save failed:", invError);
                    }

                    if (import.meta.env.DEV) console.log("[SUPABASE] company_registered", { companyId, companyName, plan: planId, zones: zones.length, members: allMembers.length });
                    toast.success("Company registered successfully!");

                    onComplete(companyName, { companyName, plan: planId, billing, employeeCount: totalEmp });
                  } catch (err) {
                    console.error("[Register] Unexpected error:", err);
                    toast.error("Something went wrong. Please try again.");
                  }
                }}
                className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl"
                style={{
                  background: "linear-gradient(135deg, #00C8E0, #00A5C0)",
                  color: "#fff", fontSize: 16, fontWeight: 700,
                  boxShadow: "0 8px 30px rgba(0,200,224,0.3)",
                }}>
                <Sparkles className="size-5" />
                Launch Company Dashboard
                <ArrowRight className="size-5" />
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Bottom Action Bar (steps 1-5) ──────────────────────── */}
      {step < 6 && (
        <div className="absolute bottom-0 left-0 right-0 z-20 px-5 pb-8 pt-4"
          style={{ background: "linear-gradient(transparent, #05070E 40%)" }}>
          <motion.button
            whileTap={canNext() ? { scale: 0.97 } : {}}
            onClick={handleNext}
            disabled={!canNext()}
            className="w-full flex items-center justify-center gap-2.5 py-[15px] rounded-2xl transition-all"
            style={{
              background: canNext() ? "linear-gradient(135deg, #00C8E0, #00A5C0)" : "rgba(255,255,255,0.03)",
              color: canNext() ? "#fff" : "rgba(255,255,255,0.15)",
              fontSize: 15, fontWeight: 600,
              boxShadow: canNext() ? "0 8px 30px rgba(0,200,224,0.25)" : "none",
              border: canNext() ? "none" : "1px solid rgba(255,255,255,0.04)",
              cursor: canNext() ? "pointer" : "default",
            }}>
            {step === 5 ? "Start 14-Day Free Trial" : "Continue"}
            <ArrowRight className="size-4" />
          </motion.button>
        </div>
      )}
    </div>
  );
}
