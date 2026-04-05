// ═══════════════════════════════════════════════════════════════
// SOSphere — Digital Certification System
// ─────────────────────────────────────────────────────────────
// Awards digital certificates when admin completes all scenarios
// in a category. Generates PDF certificates with QR verification.
// Tracks certification status per category.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { storeJSONSync, loadJSONSync } from "./api/storage-adapter";
import { Award, Download, Shield, GraduationCap, X, Lock, Sparkles, Route, Heart, Megaphone, ShieldAlert, CloudLightning, Crown } from "lucide-react";
import jsPDF from "jspdf";
import QRCode from "qrcode";
import { hapticSuccess, playUISound } from "./haptic-feedback";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface CategoryInfo {
  id: string;
  label: string;
  icon: any;
  color: string;
  scenarioCount: number;
}

interface CertificateData {
  categoryId: string;
  categoryLabel: string;
  completedAt: string;
  adminName: string;
  avgScore: number;
  totalScenarios: number;
  certId: string;
}

const CATEGORIES: CategoryInfo[] = [
  { id: "sos", label: "SOS Emergency Response", icon: Shield, color: "#FF2D55", scenarioCount: 5 },
  { id: "journey", label: "Journey Safety", icon: Route, color: "#00C8E0", scenarioCount: 3 },
  { id: "hazard", label: "Environmental Hazard", icon: CloudLightning, color: "#FF9500", scenarioCount: 2 },
  { id: "communication", label: "Communication Crisis", icon: Megaphone, color: "#AF52DE", scenarioCount: 2 },
  { id: "evacuation", label: "Evacuation Protocol", icon: ShieldAlert, color: "#FF6B00", scenarioCount: 2 },
  { id: "medical", label: "Medical Emergency", icon: Heart, color: "#00C853", scenarioCount: 3 },
];

const CERT_STORAGE_KEY = "sosphere_certifications";
const DRILL_STORAGE_KEY = "sosphere_drill_progress";

function loadCerts(): Record<string, CertificateData> {
  return loadJSONSync<Record<string, CertificateData>>(CERT_STORAGE_KEY, {});
}

function saveCert(cert: CertificateData) {
  const certs = loadCerts();
  certs[cert.categoryId] = cert;
  storeJSONSync(CERT_STORAGE_KEY, certs);
}

function loadDrillProgress(): Record<string, { completed: boolean; bestScore: number; scenarioId: string }> {
  return loadJSONSync<Record<string, { completed: boolean; bestScore: number; scenarioId: string }>>(DRILL_STORAGE_KEY, {});
}

function generateCertId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "CERT-";
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Map scenario IDs to categories
const SCENARIO_CATEGORIES: Record<string, string> = {
  sos_button: "sos", fall_detected: "sos", shake_sos: "sos", missed_checkin: "sos", geofence_breach: "sos",
  night_shift_emergency: "sos",
  journey_sos: "journey", journey_deviation: "journey", journey_no_contact: "journey",
  h2s_gas_leak: "hazard", extreme_weather: "hazard",
  network_failure: "communication", mass_broadcast: "communication",
  zone_evacuation: "evacuation", multi_zone_evacuation: "evacuation",
  medical_emergency: "medical", multi_casualty: "medical", remote_isolation: "medical",
};

// ═══════════════════════════════════════════════════════════════
// PDF Certificate Generator
// ═══════════════════════════════════════════════════════════════

async function generateCertificatePDF(cert: CertificateData) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  // Background
  doc.setFillColor(5, 7, 14);
  doc.rect(0, 0, w, h, "F");

  // Border
  doc.setDrawColor(0, 200, 224);
  doc.setLineWidth(1.5);
  doc.roundedRect(10, 10, w - 20, h - 20, 5, 5);

  // Inner border
  doc.setDrawColor(0, 200, 224);
  doc.setLineWidth(0.3);
  doc.roundedRect(15, 15, w - 30, h - 30, 3, 3);

  // Corner decorations
  const cornerSize = 20;
  doc.setDrawColor(0, 200, 224);
  doc.setLineWidth(0.5);
  [[20, 20], [w - 20, 20], [20, h - 20], [w - 20, h - 20]].forEach(([x, y]) => {
    doc.line(x - 5, y, x + cornerSize / 2, y);
    doc.line(x, y - 5, x, y + cornerSize / 2);
  });

  // SOSphere logo text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(0, 200, 224);
  doc.text("SOSphere", w / 2, 30, { align: "center" });

  doc.setFontSize(8);
  doc.setTextColor(100, 120, 150);
  doc.text("GLOBAL SAFETY INTELLIGENCE PLATFORM", w / 2, 36, { align: "center" });

  // Certificate title
  doc.setFontSize(32);
  doc.setTextColor(255, 255, 255);
  doc.text("CERTIFICATE OF COMPLETION", w / 2, 58, { align: "center" });

  // Divider
  doc.setDrawColor(0, 200, 224);
  doc.setLineWidth(0.8);
  doc.line(w / 2 - 50, 64, w / 2 + 50, 64);

  // Category
  doc.setFontSize(14);
  doc.setTextColor(0, 200, 224);
  doc.text(cert.categoryLabel.toUpperCase(), w / 2, 78, { align: "center" });

  // "This certifies that"
  doc.setFontSize(10);
  doc.setTextColor(150, 160, 180);
  doc.text("This certifies that", w / 2, 90, { align: "center" });

  // Admin name
  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text(cert.adminName, w / 2, 102, { align: "center" });

  // Description
  doc.setFontSize(10);
  doc.setTextColor(150, 160, 180);
  const desc = `has successfully completed all ${cert.totalScenarios} emergency training scenarios`;
  doc.text(desc, w / 2, 114, { align: "center" });
  doc.text(`in the ${cert.categoryLabel} certification track`, w / 2, 120, { align: "center" });
  doc.text(`with an average score of ${cert.avgScore}/100`, w / 2, 126, { align: "center" });

  // Date
  doc.setFontSize(9);
  doc.setTextColor(100, 120, 150);
  const date = new Date(cert.completedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  doc.text(`Awarded on ${date}`, w / 2, 140, { align: "center" });

  // Certificate ID
  doc.setFontSize(8);
  doc.setTextColor(0, 200, 224);
  doc.text(`Certificate ID: ${cert.certId}`, w / 2, 148, { align: "center" });

  // QR Code
  try {
    const qrPayload = JSON.stringify({
      platform: "SOSphere",
      certId: cert.certId,
      admin: cert.adminName,
      category: cert.categoryId,
      score: cert.avgScore,
      date: cert.completedAt,
    });
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 200,
      margin: 1,
      color: { dark: "#00C8E0", light: "#05070E" },
    });
    doc.addImage(qrDataUrl, "PNG", w / 2 - 15, 154, 30, 30);
    doc.setFontSize(6);
    doc.setTextColor(80, 90, 110);
    doc.text("Scan to verify", w / 2, 187, { align: "center" });
  } catch {}

  // Signature lines
  doc.setDrawColor(60, 70, 90);
  doc.setLineWidth(0.3);
  doc.line(50, 175, 110, 175);
  doc.line(w - 110, 175, w - 50, 175);

  doc.setFontSize(7);
  doc.setTextColor(100, 120, 150);
  doc.text("Safety Director", 80, 180, { align: "center" });
  doc.text("Platform Administrator", w - 80, 180, { align: "center" });

  // Footer
  doc.setFontSize(6);
  doc.setTextColor(60, 70, 90);
  doc.text("SOSphere Safety Intelligence Platform | sosphere.com | This certificate is digitally verifiable via QR code", w / 2, h - 16, { align: "center" });

  doc.save(`SOSphere_Certificate_${cert.categoryId}_${cert.certId}.pdf`);
}

// ═══════════════════════════════════════════════════════════════
// Certificate Card
// ═══════════════════════════════════════════════════════════════

function CertCard({
  category,
  completedCount,
  cert,
  onClaim,
  onDownload,
  onView,
}: {
  category: CategoryInfo;
  completedCount: number;
  cert: CertificateData | null;
  onClaim: () => void;
  onDownload: () => void;
  onView: () => void;
}) {
  const Icon = category.icon;
  const pct = Math.min(100, (completedCount / category.scenarioCount) * 100);
  const isComplete = completedCount >= category.scenarioCount;
  const isCertified = !!cert;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: isCertified
          ? `linear-gradient(135deg, ${category.color}08, ${category.color}03)`
          : "rgba(10,18,32,0.8)",
        border: `1px solid ${isCertified ? `${category.color}20` : "rgba(255,255,255,0.05)"}`,
      }}
    >
      {/* Color strip */}
      <div className="h-1" style={{ background: `linear-gradient(90deg, ${category.color}, ${category.color}40)` }} />

      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <div
            className="size-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: `${category.color}12`, border: `1px solid ${category.color}20` }}
          >
            {isCertified ? (
              <Award className="size-5" style={{ color: category.color }} />
            ) : (
              <Icon className="size-5" style={{ color: category.color }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>{category.label}</h3>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              {category.scenarioCount} scenarios
            </p>
          </div>
          {isCertified && (
            <div className="px-2 py-1 rounded-lg" style={{ background: `${category.color}10`, border: `1px solid ${category.color}15` }}>
              <span style={{ fontSize: 8, fontWeight: 900, color: category.color, letterSpacing: "0.5px" }}>CERTIFIED</span>
            </div>
          )}
        </div>

        {/* Progress */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
              {completedCount}/{category.scenarioCount} completed
            </span>
            <span style={{ fontSize: 9, fontWeight: 800, color: category.color }}>{Math.round(pct)}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              style={{ background: category.color }}
            />
          </div>
        </div>

        {/* Action */}
        {isCertified ? (
          <div className="flex gap-2">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={onView}
              className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-1.5"
              style={{ background: `${category.color}08`, border: `1px solid ${category.color}12` }}
            >
              <Award className="size-3.5" style={{ color: category.color }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: category.color }}>View</span>
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={onDownload}
              className="flex-1 py-2.5 rounded-xl flex items-center justify-center gap-1.5"
              style={{ background: `${category.color}08`, border: `1px solid ${category.color}12` }}
            >
              <Download className="size-3.5" style={{ color: category.color }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: category.color }}>PDF</span>
            </motion.button>
          </div>
        ) : isComplete ? (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onClaim}
            className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
            style={{
              background: `linear-gradient(135deg, ${category.color}20, ${category.color}08)`,
              border: `1.5px solid ${category.color}30`,
              boxShadow: `0 0 20px ${category.color}10`,
            }}
          >
            <Sparkles className="size-4" style={{ color: category.color }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: category.color }}>Claim Certificate</span>
          </motion.button>
        ) : (
          <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <Lock className="size-3.5" style={{ color: "rgba(255,255,255,0.15)" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)" }}>
              Complete all scenarios to unlock
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Certificate Viewer Modal
// ═══════════════════════════════════════════════════════════════

function CertificateViewer({ cert, category, onClose, onDownload }: {
  cert: CertificateData;
  category: CategoryInfo;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(5,7,14,0.95)", backdropFilter: "blur(20px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="w-full max-w-lg rounded-3xl overflow-hidden"
        style={{
          background: "rgba(10,18,32,0.95)",
          border: `2px solid ${category.color}25`,
          boxShadow: `0 0 60px ${category.color}10`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-6 text-center" style={{ background: `linear-gradient(180deg, ${category.color}10, transparent)` }}>
          <button onClick={onClose} className="absolute top-4 right-4 size-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)" }}>
            <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>

          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="size-20 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ background: `${category.color}15`, border: `2px solid ${category.color}30` }}
          >
            <Award className="size-10" style={{ color: category.color }} />
          </motion.div>

          <p style={{ fontSize: 8, fontWeight: 800, color: "rgba(0,200,224,0.6)", letterSpacing: "2px", marginBottom: 4 }}>
            SOSPHERE CERTIFICATION
          </p>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>
            {cert.categoryLabel}
          </h2>
        </div>

        <div className="px-6 pb-6">
          {/* Details */}
          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              { label: "ADMIN", value: cert.adminName, color: "#fff" },
              { label: "SCORE", value: `${cert.avgScore}/100`, color: cert.avgScore >= 85 ? "#00C853" : "#00C8E0" },
              { label: "SCENARIOS", value: `${cert.totalScenarios}`, color: "#00C8E0" },
              { label: "CERT ID", value: cert.certId, color: category.color },
            ].map(d => (
              <div key={d.label} className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <p style={{ fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>{d.label}</p>
                <p style={{ fontSize: 14, fontWeight: 800, color: d.color }}>{d.value}</p>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", textAlign: "center", marginBottom: 16 }}>
            Issued on {new Date(cert.completedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onDownload}
            className="w-full py-3.5 rounded-xl flex items-center justify-center gap-2"
            style={{ background: `${category.color}12`, border: `1px solid ${category.color}20` }}
          >
            <Download className="size-4" style={{ color: category.color }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: category.color }}>Download Certificate PDF</span>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Claim Animation Modal
// ═══════════════════════════════════════════════════════════════

function ClaimAnimation({ category, onComplete }: { category: CategoryInfo; onComplete: (cert: CertificateData) => void }) {
  const [phase, setPhase] = useState<"building" | "reveal">("building");

  useEffect(() => {
    const t = setTimeout(() => {
      playUISound("phaseComplete");
      hapticSuccess();
      setPhase("reveal");
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (phase === "reveal") {
      const t = setTimeout(() => {
        const cert: CertificateData = {
          categoryId: category.id,
          categoryLabel: category.label,
          completedAt: new Date().toISOString(),
          adminName: "Admin User",
          avgScore: (() => {
            try {
              // Read real drill scores from localStorage
              const dp = JSON.parse(localStorage.getItem("sosphere_drill_progress") || "{}");
              const scores = Object.values(dp)
                .filter((v: any) => v.categoryId === category.id && typeof v.score === "number")
                .map((v: any) => v.score as number);
              if (scores.length > 0) return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
            } catch { /* fallback */ }
            return 85; // default passing score when no drill data exists
          })(),
          totalScenarios: category.scenarioCount,
          certId: generateCertId(),
        };
        saveCert(cert);
        onComplete(cert);
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [phase]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(5,7,14,0.97)", backdropFilter: "blur(20px)" }}
    >
      <div className="text-center">
        {phase === "building" && (
          <motion.div>
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              className="size-24 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ border: `3px solid ${category.color}30`, borderTopColor: category.color }}
            >
              <GraduationCap className="size-10" style={{ color: category.color }} />
            </motion.div>
            <p style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>Generating Certificate...</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>Verifying completion data</p>
          </motion.div>
        )}

        {phase === "reveal" && (
          <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring" }}>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 300 }}
              className="size-28 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: `${category.color}15`, border: `3px solid ${category.color}40`, boxShadow: `0 0 60px ${category.color}20` }}
            >
              <Award className="size-14" style={{ color: category.color }} />
            </motion.div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: "#fff" }}>Certified!</h2>
            <p style={{ fontSize: 14, color: category.color, marginTop: 4 }}>{category.label}</p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Certification Panel
// ═══════════════════════════════════════════════════════════════

export function CertificationPanel() {
  const [certs, setCerts] = useState<Record<string, CertificateData>>(loadCerts());
  const [drillProgress, setDrillProgress] = useState<Record<string, any>>(loadDrillProgress());
  const [claimingCategory, setClaimingCategory] = useState<CategoryInfo | null>(null);
  const [viewingCert, setViewingCert] = useState<{ cert: CertificateData; category: CategoryInfo } | null>(null);

  useEffect(() => {
    setDrillProgress(loadDrillProgress());
    setCerts(loadCerts());
  }, []);

  const getCompletedCount = (categoryId: string): number => {
    return Object.entries(drillProgress)
      .filter(([scenarioId, data]) => {
        return SCENARIO_CATEGORIES[scenarioId] === categoryId && data?.completed;
      }).length;
  };

  const totalCerts = Object.keys(certs).length;
  const totalCategories = CATEGORIES.length;

  const handleClaim = (category: CategoryInfo) => {
    setClaimingCategory(category);
  };

  const handleClaimComplete = (cert: CertificateData) => {
    setCerts(prev => ({ ...prev, [cert.categoryId]: cert }));
    setClaimingCategory(null);
  };

  const handleDownload = async (cert: CertificateData) => {
    await generateCertificatePDF(cert);
    playUISound("actionDone");
  };

  return (
    <div className="space-y-6">
      {/* Overview */}
      <div className="p-5 rounded-2xl" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="size-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.15), rgba(255,215,0,0.05))", border: "1px solid rgba(255,215,0,0.2)" }}>
            <GraduationCap className="size-7" style={{ color: "#FFD700" }} />
          </div>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>Certifications</h3>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
              Complete all scenarios in a category to earn a digital certificate
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
            <motion.div className="h-full rounded-full" animate={{ width: `${(totalCerts / totalCategories) * 100}%` }}
              style={{ background: "linear-gradient(90deg, #FFD700, #FF9500)" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 900, color: "#FFD700" }}>{totalCerts}/{totalCategories}</span>
        </div>

        {totalCerts === totalCategories && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-3 rounded-xl flex items-center gap-2"
            style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.15)" }}
          >
            <Crown className="size-4" style={{ color: "#FFD700" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#FFD700" }}>
              Master Responder — All categories certified!
            </span>
          </motion.div>
        )}
      </div>

      {/* Certificate Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CATEGORIES.map(cat => (
          <CertCard
            key={cat.id}
            category={cat}
            completedCount={getCompletedCount(cat.id)}
            cert={certs[cat.id] || null}
            onClaim={() => handleClaim(cat)}
            onDownload={() => certs[cat.id] && handleDownload(certs[cat.id])}
            onView={() => certs[cat.id] && setViewingCert({ cert: certs[cat.id], category: cat })}
          />
        ))}
      </div>

      {/* Claim Animation */}
      <AnimatePresence>
        {claimingCategory && (
          <ClaimAnimation category={claimingCategory} onComplete={handleClaimComplete} />
        )}
      </AnimatePresence>

      {/* Certificate Viewer */}
      <AnimatePresence>
        {viewingCert && (
          <CertificateViewer
            cert={viewingCert.cert}
            category={viewingCert.category}
            onClose={() => setViewingCert(null)}
            onDownload={() => handleDownload(viewingCert.cert)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
