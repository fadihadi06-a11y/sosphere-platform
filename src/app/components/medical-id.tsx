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

const defaultData: MedicalData = {
  bloodType: "O+",
  height: "175",
  weight: "78",
  dateOfBirth: "1992-03-15",
  conditions: ["Asthma", "Hypertension"],
  allergies: ["Penicillin", "Peanuts"],
  medications: ["Ventolin Inhaler", "Lisinopril 10mg"],
  emergencyMedicalContact: { name: "Dr. Ahmad", phone: "+966501234567", relation: "Primary Doctor" },
  notes: "Carry inhaler at all times",
  organDonor: true,
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
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>
      {/* Ambient */}
      <div
        className="absolute top-[-100px] left-1/2 -translate-x-1/2 pointer-events-none"
        style={{ width: 500, height: 400, background: "radial-gradient(ellipse, rgba(255,45,85,0.03) 0%, transparent 65%)" }}
      />

      {/* Header */}
      <div className="shrink-0 pt-[58px] px-5 pb-3">
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
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                <QrCode style={{ width: 16, height: 16, color: "rgba(255,255,255,0.35)" }} />
              </motion.button>
            )}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setEditing(!editing)}
              className="p-2 rounded-xl"
              style={{
                background: editing ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${editing ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.05)"}`,
              }}
            >
              {editing ? (
                <Check style={{ width: 16, height: 16, color: "#00C8E0" }} />
              ) : (
                <Edit3 style={{ width: 16, height: 16, color: "rgba(255,255,255,0.35)" }} />
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
            {/* Blood Type */}
            <div
              className="p-4 flex flex-col items-center"
              style={{
                borderRadius: 18,
                background: "rgba(255,45,85,0.03)",
                border: "1px solid rgba(255,45,85,0.08)",
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
              ) : (
                <span style={{ fontSize: 36, fontWeight: 900, color: "#FF2D55", letterSpacing: "-1px" }}>{data.bloodType}</span>
              )}
            </div>

            {/* Height */}
            <div className="p-3.5" style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-2 mb-1.5">
                <Ruler style={{ width: 12, height: 12, color: "rgba(0,200,224,0.5)" }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>Height</span>
              </div>
              {editing ? (
                <input
                  value={data.height}
                  onChange={e => setData(prev => ({ ...prev, height: e.target.value }))}
                  className="w-full bg-transparent text-white outline-none"
                  style={{ fontSize: 20, fontWeight: 700, caretColor: "#00C8E0" }}
                />
              ) : (
                <span className="text-white" style={{ fontSize: 20, fontWeight: 700 }}>{data.height} <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>cm</span></span>
              )}
            </div>

            {/* Weight */}
            <div className="p-3.5" style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-2 mb-1.5">
                <Weight style={{ width: 12, height: 12, color: "rgba(0,200,224,0.5)" }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>Weight</span>
              </div>
              {editing ? (
                <input
                  value={data.weight}
                  onChange={e => setData(prev => ({ ...prev, weight: e.target.value }))}
                  className="w-full bg-transparent text-white outline-none"
                  style={{ fontSize: 20, fontWeight: 700, caretColor: "#00C8E0" }}
                />
              ) : (
                <span className="text-white" style={{ fontSize: 20, fontWeight: 700 }}>{data.weight} <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>kg</span></span>
              )}
            </div>
          </div>
        </motion.div>

        {/* Organ Donor */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="flex items-center justify-between px-4 py-3 mb-4"
          style={{ borderRadius: 14, background: "rgba(0,200,83,0.03)", border: "1px solid rgba(0,200,83,0.08)" }}
        >
          <div className="flex items-center gap-2.5">
            <Activity style={{ width: 14, height: 14, color: "#00C853" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>Organ Donor</span>
          </div>
          <button
            onClick={() => editing && setData(prev => ({ ...prev, organDonor: !prev.organDonor }))}
            className="relative shrink-0"
            style={{
              width: 44, height: 26, borderRadius: 13,
              background: data.organDonor ? "rgba(0,200,83,0.2)" : "rgba(255,255,255,0.06)",
              border: `1.5px solid ${data.organDonor ? "rgba(0,200,83,0.3)" : "rgba(255,255,255,0.08)"}`,
              cursor: editing ? "pointer" : "default",
            }}
          >
            <motion.div
              animate={{ x: data.organDonor ? 19 : 3 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="absolute top-[2px]"
              style={{
                width: 18, height: 18, borderRadius: 9,
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
              style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
            >
              {section.items.length === 0 ? (
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.12)", textAlign: "center", padding: "8px 0" }}>
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
                        background: `${section.color}08`,
                        border: `1px solid ${section.color}15`,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 500, color: `${section.color}CC` }}>{item}</span>
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
            style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
          >
            {editing ? (
              <>
                <input
                  value={data.emergencyMedicalContact.name}
                  onChange={e => setData(prev => ({ ...prev, emergencyMedicalContact: { ...prev.emergencyMedicalContact, name: e.target.value } }))}
                  placeholder="Name"
                  className="w-full bg-transparent text-white outline-none px-3 py-2"
                  style={{ fontSize: 14, borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", caretColor: "#00C8E0" }}
                />
                <input
                  value={data.emergencyMedicalContact.phone}
                  onChange={e => setData(prev => ({ ...prev, emergencyMedicalContact: { ...prev.emergencyMedicalContact, phone: e.target.value } }))}
                  placeholder="Phone"
                  className="w-full bg-transparent text-white outline-none px-3 py-2"
                  style={{ fontSize: 14, borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", caretColor: "#00C8E0" }}
                />
                <input
                  value={data.emergencyMedicalContact.relation}
                  onChange={e => setData(prev => ({ ...prev, emergencyMedicalContact: { ...prev.emergencyMedicalContact, relation: e.target.value } }))}
                  placeholder="Relation"
                  className="w-full bg-transparent text-white outline-none px-3 py-2"
                  style={{ fontSize: 14, borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", caretColor: "#00C8E0" }}
                />
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.12)" }}>
                  <Stethoscope style={{ width: 16, height: 16, color: "#00C853" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{data.emergencyMedicalContact.name}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{data.emergencyMedicalContact.relation}</p>
                </div>
                <span style={{ fontSize: 12, color: "rgba(0,200,224,0.5)", fontWeight: 500 }}>{data.emergencyMedicalContact.phone}</span>
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
          <div className="p-3.5" style={{ borderRadius: 16, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}>
            {editing ? (
              <textarea
                value={data.notes}
                onChange={e => setData(prev => ({ ...prev, notes: e.target.value }))}
                className="w-full bg-transparent text-white outline-none resize-none"
                rows={2}
                style={{ fontSize: 13, caretColor: "#00C8E0", lineHeight: 1.6 }}
              />
            ) : (
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>{data.notes || "No additional notes"}</p>
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
            onClick={() => setShowQR(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3"
            style={{
              borderRadius: 14,
              background: isPro ? "rgba(255,45,85,0.06)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${isPro ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.04)"}`,
              color: isPro ? "#FF2D55" : "rgba(255,255,255,0.15)",
              fontSize: 13, fontWeight: 600,
              cursor: isPro ? "pointer" : "default",
            }}
          >
            <QrCode style={{ width: 14, height: 14 }} />
            {isPro ? "QR Badge" : "QR Badge (Pro)"}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            className="flex-1 flex items-center justify-center gap-2 py-3"
            style={{
              borderRadius: 14,
              background: "rgba(0,200,224,0.06)",
              border: "1px solid rgba(0,200,224,0.12)",
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
              style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(20px)" }}
              onClick={() => setShowQR(false)}
            />
            <motion.div
              key="qr-modal"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="absolute inset-x-8 z-50 flex flex-col items-center p-6"
              style={{
                top: "50%", transform: "translateY(-50%)",
                borderRadius: 24, background: "rgba(10,16,32,0.98)",
                border: "1px solid rgba(255,255,255,0.06)",
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
                  border: "1px solid rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.35)",
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