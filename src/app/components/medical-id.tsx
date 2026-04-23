import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, Heart, Droplets, Pill, AlertTriangle,
  Phone, Edit3, Check, Shield, QrCode, Share2,
  Plus, X, Stethoscope, Weight, Ruler, Activity,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
// FIX FATAL-1: Persist medical data so SOS can read blood type + conditions
import { storeJSONSync, loadJSONSync } from "./api/storage-adapter";

const MEDICAL_STORAGE_KEY = "sosphere_medical_id";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface MedicalData {
  bloodType: string;
  height: string;
  weight: string;
  dateOfBirth: string;
  conditions: string[];
  allergies: string[];
  medications: string[];
  emergencyMedicalContact: { name: string; phone: string; relation: string };
  notes: string;
  organDonor: boolean;
}

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// AUDIT-FIX (2026-04-18): default values must not carry another
// person's medical history (was pre-filled with Dr. Ahmad + Saudi
// phone + fake conditions). Responders reading a user's ID in an
// emergency would have seen someone else's data. Now defaults are
// empty so the user fills their real info.
const defaultData: MedicalData = {
  bloodType: "",
  height: "",
  weight: "",
  dateOfBirth: "",
  conditions: [],
  allergies: [],
  medications: [],
  emergencyMedicalContact: { name: "", phone: "", relation: "" },
  notes: "",
  organDonor: false,
};

// ─── Props ─────────────────────────────────────────────────────────────────────
interface MedicalIDProps {
  onBack: () => void;
  userPlan: "free" | "pro" | "employee";
}

export function MedicalID({ onBack, userPlan }: MedicalIDProps) {
  // FIX FATAL-1: Load persisted medical data on mount
  const [data, setData] = useState<MedicalData>(() =>
    loadJSONSync<MedicalData>(MEDICAL_STORAGE_KEY, defaultData)
  );
  const [editing, setEditing] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [addingTo, setAddingTo] = useState<"conditions" | "allergies" | "medications" | null>(null);

  const isPro = userPlan === "pro" || userPlan === "employee";

  // FIX FATAL-1: Persist medical data whenever it changes
  useEffect(() => {
    storeJSONSync(MEDICAL_STORAGE_KEY, data);
  }, [data]);

  const addItemToList = (field: "conditions" | "allergies" | "medications") => {
    if (!newItem.trim()) return;
    setData(prev => ({ ...prev, [field]: [...prev[field], newItem.trim()] }));
    setNewItem("");
    setAddingTo(null);
  };

  const removeItemFromList = (field: "conditions" | "allergies" | "medications", index: number) => {
    setData(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== index) }));
  };

  const qrData = JSON.stringify({
    app: "SOSphere",
    bloodType: data.bloodType,
    conditions: data.conditions,
    allergies: data.allergies,
    medications: data.medications,
    emergencyContact: data.emergencyMedicalContact.phone,
    organDonor: data.organDonor,
    notes: data.notes,
  });

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", background: "#05070E" }}>
      {/* AUDIT-FIX (2026-04-22 v5): REMOVED ambient radial-gradient
          overlay. On MIUI WebView the combination of
          (radial-gradient with alpha=0) + (motion.div children doing
          opacity/y animations on the Blood Type / Height / Weight
          grid) caused GPU compositor tearing — the "rainbow scan-line
          noise" users saw over those cards. The gradient was purely
          decorative and invisible on dark backgrounds anyway. */}

      {/* Header */}
      <div className="shrink-0 px-5 pb-3" style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}>
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-1 -ml-1 p-1">
            <ChevronLeft style={{ width: 20, height: 20, color: "#00C8E0" }} />
            <span style={{ fontSize: 15, color: "#00C8E0", fontWeight: 500 }}>Profile</span>
          </button>
          <div className="flex items-center gap-2">
            {isPro && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowQR(true)}
                className="p-2 rounded-xl"
                style={{ background: "rgba(255,255,255,0.06)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }}
              >
                <QrCode style={{ width: 16, height: 16, color: "rgba(255,255,255,0.5)" }} />
              </motion.button>
            )}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setEditing(!editing)}
              className="p-2 rounded-xl"
              style={{
                background: editing ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.06)",
                boxShadow: `inset 0 0 0 1px ${editing ? "rgba(0,200,224,0.35)" : "rgba(255,255,255,0.12)"}`,
              }}
            >
              {editing ? (
                <Check style={{ width: 16, height: 16, color: "#00C8E0" }} />
              ) : (
                <Edit3 style={{ width: 16, height: 16, color: "rgba(255,255,255,0.5)" }} />
              )}
            </motion.button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 pb-10" style={{ scrollbarWidth: "none" }}>
        {/* Title */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-5">
          <div className="flex items-center gap-2.5 mb-1">
            <Heart style={{ width: 18, height: 18, color: "#FF2D55" }} />
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.4px" }}>Medical ID</h1>
          </div>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>
            Critical health information for emergency responders
          </p>
        </motion.div>

        {/* Blood Type + Vitals */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="mb-4"
        >
          <div className="grid grid-cols-2 gap-2.5">
            {/* Blood Type — AUDIT-FIX (2026-04-21): bumped bg opacity +
                inset boxShadow; low-alpha bg + border combination was
                invisible on Android OLED (user reported stripes/noise). */}
            <div
              className="p-4 flex flex-col items-center"
              style={{
                borderRadius: 18,
                background: "rgba(255,45,85,0.08)",
                boxShadow: "inset 0 0 0 1px rgba(255,45,85,0.18)",
                gridRow: "1 / 3",
              }}
            >
              <Droplets style={{ width: 20, height: 20, color: "#FF2D55", marginBottom: 8 }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 500, marginBottom: 6 }}>Blood Type</span>
              {editing ? (
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {BLOOD_TYPES.map(bt => (
                    <button
                      key={bt}
                      onClick={() => setData(prev => ({ ...prev, bloodType: bt }))}
                      className="px-2 py-1"
                      style={{
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: data.bloodType === bt ? 700 : 500,
                        background: data.bloodType === bt ? "rgba(255,45,85,0.15)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${data.bloodType === bt ? "rgba(255,45,85,0.25)" : "rgba(255,255,255,0.05)"}`,
                        color: data.bloodType === bt ? "#FF2D55" : "rgba(255,255,255,0.2)",
                      }}
                    >
                      {bt}
                    </button>
                  ))}
                </div>
              ) : data.bloodType ? (
                <span style={{ fontSize: 36, fontWeight: 900, color: "#FF2D55", letterSpacing: "-1px" }}>{data.bloodType}</span>
              ) : (
                <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,45,85,0.55)", textAlign: "center", lineHeight: 1.4, padding: "0 4px" }}>
                  Tap edit pencil<br />to set type
                </span>
              )}
            </div>

            {/* Height */}
            <div className="p-3.5" style={{ borderRadius: 16, background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2 mb-1.5">
                <Ruler style={{ width: 12, height: 12, color: "rgba(0,200,224,0.7)" }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 600, letterSpacing: "0.3px" }}>HEIGHT</span>
              </div>
              {editing ? (
                <input
                  type="number"
                  inputMode="numeric"
                  value={data.height}
                  onChange={e => setData(prev => ({ ...prev, height: e.target.value }))}
                  placeholder="0"
                  className="w-full text-white outline-none"
                  style={{ fontSize: 20, fontWeight: 700, color: "#fff", caretColor: "#00C8E0", background: "transparent", border: "none" }}
                />
              ) : (
                <span className="text-white" style={{ fontSize: 20, fontWeight: 700 }}>
                  {data.height || <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>}
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: 4 }}>cm</span>
                </span>
              )}
            </div>

            {/* Weight */}
            <div className="p-3.5" style={{ borderRadius: 16, background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-2 mb-1.5">
                <Weight style={{ width: 12, height: 12, color: "rgba(0,200,224,0.7)" }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 600, letterSpacing: "0.3px" }}>WEIGHT</span>
              </div>
              {editing ? (
                <input
                  type="number"
                  inputMode="numeric"
                  value={data.weight}
                  onChange={e => setData(prev => ({ ...prev, weight: e.target.value }))}
                  placeholder="0"
                  className="w-full text-white outline-none"
                  style={{ fontSize: 20, fontWeight: 700, color: "#fff", caretColor: "#00C8E0", background: "transparent", border: "none" }}
                />
              ) : (
                <span className="text-white" style={{ fontSize: 20, fontWeight: 700 }}>
                  {data.weight || <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>}
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginLeft: 4 }}>kg</span>
                </span>
              )}
            </div>
          </div>
        </motion.div>

        {/* Organ Donor */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="flex items-center justify-between px-4 py-3 mb-4"
          style={{ borderRadius: 14, background: "rgba(0,200,83,0.08)", boxShadow: "inset 0 0 0 1px rgba(0,200,83,0.2)" }}
        >
          <div className="flex items-center gap-2.5">
            <Activity style={{ width: 14, height: 14, color: "#00C853" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.75)" }}>Organ Donor</span>
          </div>
          <button
            onClick={() => editing && setData(prev => ({ ...prev, organDonor: !prev.organDonor }))}
            className="relative shrink-0"
            style={{
              width: 48, height: 28, borderRadius: 14,
              background: data.organDonor ? "rgba(0,200,83,0.2)" : "rgba(255,255,255,0.06)",
              border: `1.5px solid ${data.organDonor ? "rgba(0,200,83,0.3)" : "rgba(255,255,255,0.08)"}`,
              cursor: editing ? "pointer" : "default",
              boxSizing: "border-box",
              padding: 0,
            }}
          >
            <motion.div
              animate={{ x: data.organDonor ? 22 : 2 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="absolute"
              style={{
                top: 2,
                width: 20, height: 20, borderRadius: 10,
                background: data.organDonor ? "#00C853" : "rgba(255,255,255,0.25)",
              }}
            />
          </button>
        </motion.div>

        {/* List Sections */}
        {([
          { key: "conditions" as const, label: "Medical Conditions", icon: Stethoscope, color: "#FF9500", items: data.conditions },
          { key: "allergies" as const, label: "Allergies", icon: AlertTriangle, color: "#FF2D55", items: data.allergies },
          { key: "medications" as const, label: "Medications", icon: Pill, color: "#00C8E0", items: data.medications },
        ]).map((section, si) => (
          <motion.div
            key={section.key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + si * 0.06 }}
            className="mb-4"
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <section.icon style={{ width: 13, height: 13, color: section.color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{section.label}</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.12)" }}>({section.items.length})</span>
              </div>
              {editing && (
                <button
                  onClick={() => { setAddingTo(section.key); setNewItem(""); }}
                  className="p-1"
                >
                  <Plus style={{ width: 14, height: 14, color: section.color }} />
                </button>
              )}
            </div>

            <div
              className="p-3"
              style={{ borderRadius: 16, background: "rgba(255,255,255,0.04)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
            >
              {section.items.length === 0 ? (
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px 0" }}>
                  No {section.label.toLowerCase()} added
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {section.items.map((item, i) => (
                    <motion.div
                      key={`${item}-${i}`}
                      layout
                      className="flex items-center gap-1.5 px-3 py-1.5"
                      style={{
                        borderRadius: 10,
                        background: `${section.color}1A`,
                        boxShadow: `inset 0 0 0 1px ${section.color}35`,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 600, color: `${section.color}F0` }}>{item}</span>
                      {editing && (
                        <button onClick={() => removeItemFromList(section.key, i)} className="ml-0.5">
                          <X style={{ width: 10, height: 10, color: `${section.color}60` }} />
                        </button>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Add new item inline */}
              <AnimatePresence>
                {addingTo === section.key && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-2.5 flex gap-2"
                  >
                    <input
                      autoFocus
                      value={newItem}
                      onChange={e => setNewItem(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addItemToList(section.key)}
                      placeholder={`Add ${section.label.toLowerCase().slice(0, -1)}...`}
                      className="flex-1 bg-transparent text-white outline-none px-3 py-2"
                      style={{
                        fontSize: 13, borderRadius: 10,
                        background: "rgba(255,255,255,0.03)",
                        border: `1px solid ${section.color}20`,
                        caretColor: section.color,
                      }}
                    />
                    <button
                      onClick={() => addItemToList(section.key)}
                      className="px-3 py-2"
                      style={{ borderRadius: 10, background: `${section.color}15`, border: `1px solid ${section.color}25` }}
                    >
                      <Check style={{ width: 14, height: 14, color: section.color }} />
                    </button>
                    <button
                      onClick={() => setAddingTo(null)}
                      className="px-2 py-2"
                      style={{ borderRadius: 10, background: "rgba(255,255,255,0.03)" }}
                    >
                      <X style={{ width: 14, height: 14, color: "rgba(255,255,255,0.2)" }} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        ))}

        {/* Emergency Medical Contact */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="mb-4"
        >
          <div className="flex items-center gap-2 mb-2.5">
            <Phone style={{ width: 13, height: 13, color: "#00C853" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>Emergency Medical Contact</span>
          </div>
          <div
            className="p-4 space-y-3"
            style={{ borderRadius: 16, background: "rgba(255,255,255,0.04)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
          >
            {editing ? (
              <>
                <input
                  value={data.emergencyMedicalContact.name}
                  onChange={e => setData(prev => ({ ...prev, emergencyMedicalContact: { ...prev.emergencyMedicalContact, name: e.target.value } }))}
                  placeholder="Name (e.g. Dr. Ahmed)"
                  className="w-full text-white outline-none px-3 py-2"
                  style={{ fontSize: 14, borderRadius: 10, color: "#fff", background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)", caretColor: "#00C8E0", border: "none" }}
                />
                <input
                  type="tel"
                  inputMode="tel"
                  value={data.emergencyMedicalContact.phone}
                  onChange={e => setData(prev => ({ ...prev, emergencyMedicalContact: { ...prev.emergencyMedicalContact, phone: e.target.value } }))}
                  placeholder="Phone (+964...)"
                  className="w-full text-white outline-none px-3 py-2"
                  style={{ fontSize: 14, borderRadius: 10, background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)", caretColor: "#00C8E0", border: "none", fontFamily: "'Outfit', monospace" }}
                />
                <input
                  value={data.emergencyMedicalContact.relation}
                  onChange={e => setData(prev => ({ ...prev, emergencyMedicalContact: { ...prev.emergencyMedicalContact, relation: e.target.value } }))}
                  placeholder="Relation (Doctor / Family / Friend)"
                  className="w-full text-white outline-none px-3 py-2"
                  style={{ fontSize: 14, borderRadius: 10, color: "#fff", background: "rgba(255,255,255,0.05)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)", caretColor: "#00C8E0", border: "none" }}
                />
              </>
            ) : data.emergencyMedicalContact.name || data.emergencyMedicalContact.phone ? (
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(0,200,83,0.12)", boxShadow: "inset 0 0 0 1px rgba(0,200,83,0.25)" }}>
                  <Stethoscope style={{ width: 16, height: 16, color: "#00C853" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white truncate" style={{ fontSize: 14, fontWeight: 600 }}>{data.emergencyMedicalContact.name || "—"}</p>
                  <p className="truncate" style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{data.emergencyMedicalContact.relation || "No relation set"}</p>
                </div>
                {data.emergencyMedicalContact.phone && (
                  <span className="shrink-0" style={{ fontSize: 12, color: "#00C8E0", fontWeight: 500, fontFamily: "'Outfit', monospace" }}>
                    {data.emergencyMedicalContact.phone}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 py-2">
                <div className="size-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}>
                  <Stethoscope style={{ width: 16, height: 16, color: "rgba(255,255,255,0.25)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", fontStyle: "italic" }}>
                    Not set — tap edit pencil to add a doctor or medical contact
                  </p>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Notes */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="mb-4"
        >
          <div className="flex items-center gap-2 mb-2.5">
            <Shield style={{ width: 13, height: 13, color: "rgba(255,255,255,0.3)" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>Additional Notes</span>
          </div>
          <div className="p-3.5" style={{ borderRadius: 16, background: "rgba(255,255,255,0.04)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}>
            {editing ? (
              <textarea
                value={data.notes}
                onChange={e => setData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Any extra info first responders should know (e.g. pacemaker, blind in left eye, Arabic speaker)..."
                className="w-full bg-transparent text-white outline-none resize-none"
                rows={3}
                style={{ fontSize: 13, caretColor: "#00C8E0", lineHeight: 1.6 }}
              />
            ) : (
              <p style={{ fontSize: 13, color: data.notes ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.35)", lineHeight: 1.6, fontStyle: data.notes ? "normal" : "italic" }}>
                {data.notes || "No additional notes"}
              </p>
            )}
          </div>
        </motion.div>

        {/* Share / QR buttons */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className="flex gap-2.5"
        >
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              // AUDIT-FIX (2026-04-18): free users tapping "QR Badge"
              // used to open a modal that only renders if isPro →
              // nothing visible. Now: free users get a clear upgrade
              // prompt via toast instead of silent failure.
              if (!isPro) {
                import("sonner").then(m => m.toast("QR Badge is an Elite feature", {
                  description: "Upgrade to generate a scannable medical ID for first responders.",
                }));
                return;
              }
              setShowQR(true);
            }}
            className="flex-1 flex items-center justify-center gap-2 py-3"
            style={{
              borderRadius: 14,
              background: isPro ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.05)",
              boxShadow: `inset 0 0 0 1px ${isPro ? "rgba(255,45,85,0.3)" : "rgba(255,255,255,0.1)"}`,
              color: isPro ? "#FF2D55" : "rgba(255,255,255,0.4)",
              fontSize: 13, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <QrCode style={{ width: 14, height: 14 }} />
            {isPro ? "QR Badge" : "QR Badge (Pro)"}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={async () => {
              // AUDIT-FIX: Share button was completely dead. Now uses
              // Web Share API (available on Android Capacitor WebView)
              // with a text-only summary of the medical ID. Non-PII
              // fields only for safety — the full Medical ID is
              // served via the SOS web viewer to actual responders.
              const summary = [
                `SOSphere Medical ID`,
                data.bloodType ? `Blood: ${data.bloodType}` : null,
                data.allergies?.length ? `Allergies: ${data.allergies.join(", ")}` : null,
                data.conditions?.length ? `Conditions: ${data.conditions.join(", ")}` : null,
                data.medications?.length ? `Meds: ${data.medications.join(", ")}` : null,
              ].filter(Boolean).join("\n");
              try {
                if ((navigator as any).share) {
                  await (navigator as any).share({ title: "Medical ID", text: summary });
                } else if (navigator.clipboard) {
                  await navigator.clipboard.writeText(summary);
                  const { toast } = await import("sonner");
                  toast.success("Copied", { description: "Medical ID summary copied to clipboard." });
                } else {
                  const { toast } = await import("sonner");
                  toast("Share unavailable", { description: "Your device does not support share or clipboard APIs." });
                }
              } catch { /* user cancelled — silent */ }
            }}
            className="flex-1 flex items-center justify-center gap-2 py-3"
            style={{
              borderRadius: 14,
              background: "rgba(0,200,224,0.14)",
              boxShadow: "inset 0 0 0 1px rgba(0,200,224,0.3)",
              color: "#00C8E0",
              fontSize: 13, fontWeight: 600,
            }}
          >
            <Share2 style={{ width: 14, height: 14 }} />
            Share
          </motion.button>
        </motion.div>
      </div>

      {/* QR Modal */}
      <AnimatePresence>
        {showQR && isPro && (
          <>
            <motion.div
              key="qr-bg"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.9)" }}
              onClick={() => setShowQR(false)}
            />
            <motion.div
              key="qr-modal"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="absolute inset-x-8 z-50 flex flex-col items-center p-6"
              style={{
                top: "50%", transform: "translateY(-50%)",
                borderRadius: 24, background: "rgba(10,16,32,0.99)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Heart style={{ width: 16, height: 16, color: "#FF2D55" }} />
                <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Medical QR Badge</span>
              </div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", marginBottom: 16, lineHeight: 1.6 }}>
                Scan this QR code to access emergency medical information
              </p>
              <div className="p-4 rounded-2xl mb-4" style={{ background: "#fff" }}>
                <QRCodeSVG value={qrData} size={160} level="M" />
              </div>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", textAlign: "center", lineHeight: 1.5 }}>
                Print this on a badge or phone case for quick access by emergency responders
              </p>
              <button
                onClick={() => setShowQR(false)}
                className="mt-4 w-full py-3"
                style={{
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.03)",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 14, fontWeight: 600,
                }}
              >
                Close
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

