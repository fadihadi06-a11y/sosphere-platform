// =================================================================
// SOSphere — Risk Register (ISO 45001 §6.1 — Risk Assessment)
// -----------------------------------------------------------------
// Zone-based risk assessment + Risk matrix + Preventive measures
// + Training records & certifications + Document control
// =================================================================

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, AlertTriangle, MapPin, CheckCircle2, Clock,
  ChevronRight, ChevronDown, Eye, Download, Filter,
  Users, Target, Layers, Activity, TriangleAlert,
  FileText, Award, Calendar, Bell, TrendingUp,
  Search, GraduationCap, ClipboardCheck, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import { TYPOGRAPHY } from "./design-system";
import { onSyncEvent } from "./shared-store";
import {
  fetchRiskRegister,
  upsertRisk,
  upsertRiskBatch,
  fetchTrainingRecords,
  upsertTrainingRecord, getCachedRisks, setCachedRisks} from "./risk-register-service";

// ── Types ────────────────────────────────────────────────────────

type RiskLevel = "extreme" | "high" | "medium" | "low" | "negligible";
type Likelihood = 1 | 2 | 3 | 4 | 5;
type Consequence = 1 | 2 | 3 | 4 | 5;
type ControlStatus = "effective" | "partially_effective" | "ineffective" | "not_implemented";

export interface RiskEntry {
  id: string;
  zone: string;
  hazard: string;
  description: string;
  category: "physical" | "chemical" | "biological" | "ergonomic" | "psychosocial" | "environmental";
  likelihood: Likelihood;
  consequence: Consequence;
  riskScore: number; // likelihood × consequence
  riskLevel: RiskLevel;
  existingControls: string[];
  controlStatus: ControlStatus;
  preventiveMeasures: string[];
  responsiblePerson: string;
  reviewDate: Date;
  lastReviewedBy: string;
  isoReference: string;
}

interface TrainingRecord {
  id: string;
  employeeName: string;
  certification: string;
  issueDate: Date;
  expiryDate: Date;
  status: "valid" | "expiring_soon" | "expired";
  provider: string;
  zone: string;
}

// ── Mock Data ────────────────────────────────────────────────────

/* SUPABASE_MIGRATION_POINT: risk_register
   SELECT * FROM risk_register WHERE company_id = :id */
export const MOCK_RISKS: RiskEntry[] = [
  {
    id: "RSK-001", zone: "Zone A - North Gate", hazard: "Working at Height",
    description: "Scaffolding and elevated platform work during construction and maintenance activities",
    category: "physical", likelihood: 3, consequence: 5, riskScore: 15, riskLevel: "extreme",
    existingControls: ["Fall arrest systems", "Scaffolding inspections", "Safety nets"],
    controlStatus: "partially_effective",
    preventiveMeasures: ["Mandatory harness training every 6 months", "Daily scaffold inspection checklist", "Install permanent guardrails", "Weather-dependent work restrictions"],
    responsiblePerson: "Omar Al-Farsi", reviewDate: new Date(2026, 3, 1), lastReviewedBy: "Rania Abbas",
    isoReference: "ISO 45001 §6.1.2",
  },
  {
    id: "RSK-002", zone: "Zone B - Control Room", hazard: "Chemical Exposure",
    description: "Handling and storage of hazardous chemicals including solvents, acids, and compressed gases",
    category: "chemical", likelihood: 2, consequence: 4, riskScore: 8, riskLevel: "high",
    existingControls: ["MSDS sheets available", "PPE provided", "Ventilation systems"],
    controlStatus: "effective",
    preventiveMeasures: ["Quarterly PPE fitness checks", "Annual chemical handling refresher", "Automated ventilation monitoring", "Spill containment kits at all stations"],
    responsiblePerson: "Sara Al-Mutairi", reviewDate: new Date(2026, 4, 15), lastReviewedBy: "Rania Abbas",
    isoReference: "ISO 45001 §6.1.2",
  },
  {
    id: "RSK-003", zone: "Zone D - Warehouse", hazard: "Forklift Operations",
    description: "Forklift and heavy machinery operations in confined warehouse areas with pedestrian traffic",
    category: "physical", likelihood: 3, consequence: 4, riskScore: 12, riskLevel: "high",
    existingControls: ["Operator licensing", "Designated walkways", "Warning lights"],
    controlStatus: "partially_effective",
    preventiveMeasures: ["Install proximity sensors on all forklifts", "Separate pedestrian and vehicle zones", "Speed limiters in warehouse", "Monthly operator assessments"],
    responsiblePerson: "Mohammed Ali", reviewDate: new Date(2026, 3, 15), lastReviewedBy: "Omar Al-Farsi",
    isoReference: "ISO 45001 §6.1.2",
  },
  {
    id: "RSK-004", zone: "Zone A - North Gate", hazard: "Heat Stress",
    description: "Prolonged outdoor work in extreme heat (>45°C) during summer months without adequate rest breaks",
    category: "environmental", likelihood: 4, consequence: 3, riskScore: 12, riskLevel: "high",
    existingControls: ["Cooling stations", "Hydration schedule", "Buddy system"],
    controlStatus: "partially_effective",
    preventiveMeasures: ["Automated work-rest cycle based on WBGT", "Mandatory cool-down breaks every 30min above 44°C", "Real-time weather alerts to supervisors", "Shaded rest areas at every 50m"],
    responsiblePerson: "Rania Abbas", reviewDate: new Date(2026, 5, 1), lastReviewedBy: "Rania Abbas",
    isoReference: "ISO 45001 §8.1.2",
  },
  {
    id: "RSK-005", zone: "Zone C - Main Hall", hazard: "Electrical Hazards",
    description: "Working with high-voltage equipment and electrical panels during installation and maintenance",
    category: "physical", likelihood: 2, consequence: 5, riskScore: 10, riskLevel: "high",
    existingControls: ["Lockout/Tagout procedures", "Insulated tools", "Arc flash PPE"],
    controlStatus: "effective",
    preventiveMeasures: ["Annual LOTO refresher training", "Bi-annual electrical safety audit", "Thermal imaging for early fault detection"],
    responsiblePerson: "Yusuf Bakr", reviewDate: new Date(2026, 4, 1), lastReviewedBy: "Sara Al-Mutairi",
    isoReference: "ISO 45001 §6.1.2",
  },
  {
    id: "RSK-006", zone: "Zone E - Parking", hazard: "Vehicle Collisions",
    description: "Risk of vehicle-pedestrian and vehicle-vehicle collisions in loading/unloading area",
    category: "physical", likelihood: 2, consequence: 3, riskScore: 6, riskLevel: "medium",
    existingControls: ["Speed bumps", "Convex mirrors", "Reversing alarms"],
    controlStatus: "effective",
    preventiveMeasures: ["Install CCTV with AI detection", "Paint pedestrian walkways", "Annual driver assessment"],
    responsiblePerson: "Hassan Jaber", reviewDate: new Date(2026, 5, 15), lastReviewedBy: "Omar Al-Farsi",
    isoReference: "ISO 45001 §6.1.2",
  },
  {
    id: "RSK-007", zone: "Zone B - Control Room", hazard: "Ergonomic Strain",
    description: "Repetitive strain injuries from extended computer work and awkward postures at control stations",
    category: "ergonomic", likelihood: 3, consequence: 2, riskScore: 6, riskLevel: "medium",
    existingControls: ["Adjustable workstations", "Ergonomic assessments"],
    controlStatus: "effective",
    preventiveMeasures: ["Mandatory stretch breaks every 2 hours", "Annual ergonomic reassessment", "Standing desk options"],
    responsiblePerson: "Noura Khalid", reviewDate: new Date(2026, 6, 1), lastReviewedBy: "Rania Abbas",
    isoReference: "ISO 45001 §6.1.2",
  },
  {
    id: "RSK-008", zone: "All Zones", hazard: "Fire & Explosion",
    description: "Fire risk from flammable materials storage, electrical faults, and hot work operations",
    category: "physical", likelihood: 2, consequence: 5, riskScore: 10, riskLevel: "high",
    existingControls: ["Fire suppression systems", "Extinguishers", "Fire drills", "Hot work permits"],
    controlStatus: "effective",
    preventiveMeasures: ["Quarterly fire drills", "Monthly extinguisher inspections", "Annual fire risk assessment update", "Hot work permit monitoring system"],
    responsiblePerson: "Aisha Rahman", reviewDate: new Date(2026, 3, 1), lastReviewedBy: "Rania Abbas",
    isoReference: "ISO 45001 §8.2",
  },
];

/* SUPABASE_MIGRATION_POINT: training_records
   SELECT * FROM training_records WHERE company_id = :id */
const MOCK_TRAINING: TrainingRecord[] = [
  { id: "TR-001", employeeName: "Ahmed Khalil", certification: "Working at Heights (WAH)", issueDate: new Date(2025, 8, 15), expiryDate: new Date(2026, 2, 15), status: "expired", provider: "SafetyFirst Academy", zone: "Zone A" },
  { id: "TR-002", employeeName: "Mohammed Ali", certification: "Scaffolding Competency", issueDate: new Date(2025, 6, 1), expiryDate: new Date(2026, 6, 1), status: "valid", provider: "NEBOSH", zone: "Zone D" },
  { id: "TR-003", employeeName: "Lina Chen", certification: "Chemical Handling (HAZMAT)", issueDate: new Date(2025, 9, 10), expiryDate: new Date(2026, 3, 10), status: "expiring_soon", provider: "IOSH", zone: "Zone B" },
  { id: "TR-004", employeeName: "Hassan Jaber", certification: "Forklift Operator License", issueDate: new Date(2025, 5, 20), expiryDate: new Date(2026, 5, 20), status: "valid", provider: "National Safety Council", zone: "Zone E" },
  { id: "TR-005", employeeName: "Ali Mansour", certification: "First Aid & CPR", issueDate: new Date(2025, 4, 1), expiryDate: new Date(2026, 4, 1), status: "expiring_soon", provider: "Red Crescent", zone: "Zone A" },
  { id: "TR-006", employeeName: "Yusuf Bakr", certification: "Electrical Safety (LOTO)", issueDate: new Date(2025, 7, 15), expiryDate: new Date(2026, 7, 15), status: "valid", provider: "OSHA Certified", zone: "Zone C" },
  { id: "TR-007", employeeName: "Sara Al-Mutairi", certification: "HSE Coordinator Level 3", issueDate: new Date(2025, 3, 1), expiryDate: new Date(2027, 3, 1), status: "valid", provider: "NEBOSH", zone: "All Zones" },
  { id: "TR-008", employeeName: "Aisha Rahman", certification: "Fire Marshal Certification", issueDate: new Date(2025, 1, 15), expiryDate: new Date(2026, 1, 15), status: "expired", provider: "NFPA", zone: "Zone D" },
  { id: "TR-009", employeeName: "Omar Al-Farsi", certification: "NEBOSH IGC", issueDate: new Date(2024, 11, 1), expiryDate: new Date(2027, 11, 1), status: "valid", provider: "NEBOSH", zone: "All Zones" },
  { id: "TR-010", employeeName: "Rania Abbas", certification: "ISO 45001 Lead Auditor", issueDate: new Date(2025, 5, 1), expiryDate: new Date(2028, 5, 1), status: "valid", provider: "BSI", zone: "All Zones" },
  { id: "TR-011", employeeName: "Tariq Zayed", certification: "Confined Space Entry", issueDate: new Date(2025, 2, 1), expiryDate: new Date(2026, 2, 1), status: "expired", provider: "SafetyFirst Academy", zone: "Zone D" },
  { id: "TR-012", employeeName: "Khalid Omar", certification: "Working at Heights (WAH)", issueDate: new Date(2025, 10, 1), expiryDate: new Date(2026, 4, 1), status: "expiring_soon", provider: "IOSH", zone: "Zone A" },
];

// ── Configs ──────────────────────────────────────────────────────

const RISK_LEVEL_CONFIG: Record<RiskLevel, { labelKey: string; color: string; bg: string }> = {
  extreme: { labelKey: "rr.levelExtreme", color: "#FF2D55", bg: "rgba(255,45,85,0.1)" },
  high: { labelKey: "rr.levelHigh", color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
  medium: { labelKey: "rr.levelMedium", color: "#FFD60A", bg: "rgba(255,214,10,0.08)" },
  low: { labelKey: "rr.levelLow", color: "#00C853", bg: "rgba(0,200,83,0.06)" },
  negligible: { labelKey: "rr.levelNegligible", color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.03)" },
};

const CONTROL_STATUS_CONFIG: Record<ControlStatus, { labelKey: string; color: string }> = {
  effective: { labelKey: "rr.ctrlEffective", color: "#00C853" },
  partially_effective: { labelKey: "rr.ctrlPartiallyEffective", color: "#FF9500" },
  ineffective: { labelKey: "rr.ctrlIneffective", color: "#FF2D55" },
  not_implemented: { labelKey: "rr.ctrlNotImplemented", color: "#FF2D55" },
};

const TRAINING_STATUS_CONFIG: Record<string, { labelKey: string; color: string }> = {
  valid: { labelKey: "rr.trValid", color: "#00C853" },
  expiring_soon: { labelKey: "rr.trExpiringSoon", color: "#FF9500" },
  expired: { labelKey: "rr.trExpired", color: "#FF2D55" },
};

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  physical: "rr.catPhysical", chemical: "rr.catChemical", biological: "rr.catBiological",
  ergonomic: "rr.catErgonomic", psychosocial: "rr.catPsychosocial", environmental: "rr.catEnvironmental",
};

// ── Risk Matrix Component ────────────────────────────────────────

function RiskMatrix({ risks, t }: { risks: RiskEntry[]; t: (k: string) => string }) {
  const getColor = (l: number, c: number): string => {
    const score = l * c;
    if (score >= 15) return "rgba(255,45,85,0.6)";
    if (score >= 10) return "rgba(255,150,0,0.5)";
    if (score >= 6) return "rgba(255,214,10,0.4)";
    if (score >= 3) return "rgba(0,200,83,0.3)";
    return "rgba(255,255,255,0.05)";
  };

  const getCount = (l: number, c: number) => risks.filter(r => r.likelihood === l && r.consequence === c).length;

  return (
    <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <h3 style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>{t("rr.matrixTitle")}</h3>
      <div className="flex gap-1">
        <div className="flex flex-col items-center justify-between py-1 mr-1" style={{ width: 20 }}>
          {[5, 4, 3, 2, 1].map(l => (
            <span key={l} style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", fontWeight: 700 }}>{l}</span>
          ))}
          <span style={{ fontSize: 7, color: "rgba(255,255,255,0.15)", writingMode: "vertical-rl", transform: "rotate(180deg)", marginTop: 4 }}>{t("rr.likelihood")}</span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-5 gap-1">
            {[5, 4, 3, 2, 1].map(l =>
              [1, 2, 3, 4, 5].map(c => {
                const count = getCount(l, c);
                return (
                  <div key={`${l}-${c}`}
                    className="aspect-square rounded-md flex items-center justify-center relative"
                    style={{ background: getColor(l, c), minHeight: 32 }}>
                    {count > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 800, color: "white" }}>{count}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="flex justify-between px-2 mt-2">
            {[1, 2, 3, 4, 5].map(c => (
              <span key={c} style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", fontWeight: 700 }}>{c}</span>
            ))}
          </div>
          <div className="text-center mt-1">
            <span style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>{t("rr.consequence")}</span>
          </div>
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center justify-center gap-3 mt-3">
        {[
          { label: t("rr.legendExtreme"), color: "rgba(255,45,85,0.6)" },
          { label: t("rr.legendHigh"), color: "rgba(255,150,0,0.5)" },
          { label: t("rr.legendMedium"), color: "rgba(255,214,10,0.4)" },
          { label: t("rr.legendLow"), color: "rgba(0,200,83,0.3)" },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="size-2.5 rounded-sm" style={{ background: l.color }} />
            <span style={{ fontSize: 7.5, color: "rgba(255,255,255,0.3)" }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PDF Export ────────────────────────────────────────────────────

function exportRiskRegisterPDF(risks: RiskEntry[], training: TrainingRecord[], t: (k: string) => string) {
  console.log("[SUPABASE_READY] pdf_export_risk_register");
  toast.loading(t("rr.pdfGenerating"), { id: "risk-pdf" });
  try {
    const doc = new jsPDF({ orientation: "l", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();

    // Header
    doc.setFillColor(10, 18, 32);
    doc.rect(0, 0, pw, 25, "F");
    doc.setTextColor(0, 200, 224);
    doc.setFontSize(16);
    doc.text(t("rr.pdfHeader"), 14, 12);
    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    doc.text(`${t("rr.pdfGenerated")}: ${new Date().toLocaleString()} | ${t("rr.pdfCompliance")}`, 14, 19);
    doc.text(`${t("rr.pdfTotalRisks")}: ${risks.length} | ${t("rr.levelExtreme")}: ${risks.filter(r => r.riskLevel === "extreme").length} | ${t("rr.levelHigh")}: ${risks.filter(r => r.riskLevel === "high").length}`, pw - 14, 12, { align: "right" });

    // Risk Register Table
    let y = 30;
    autoTable(doc, {
      startY: y,
      head: [[t("rr.colId"), t("rr.colZone"), t("rr.colHazard"), t("rr.colCategory"), t("rr.colL"), t("rr.colC"), t("rr.colScore"), t("rr.colLevel"), t("rr.colControlsStatus"), t("rr.colReviewDate"), t("rr.colOwner")]],
      body: risks.map(r => [
        r.id, r.zone, r.hazard,
        t(CATEGORY_LABEL_KEYS[r.category]) || r.category,
        `${r.likelihood}`, `${r.consequence}`, `${r.riskScore}`,
        t(RISK_LEVEL_CONFIG[r.riskLevel].labelKey),
        t(CONTROL_STATUS_CONFIG[r.controlStatus].labelKey),
        r.reviewDate.toLocaleDateString(),
        r.responsiblePerson,
      ]),
      theme: "striped",
      headStyles: { fillColor: [0, 200, 224], fontSize: 7, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      margin: { left: 10, right: 10 },
    });

    // Page 2: Training Records
    doc.addPage();
    doc.setFillColor(10, 18, 32);
    doc.rect(0, 0, pw, 25, "F");
    doc.setTextColor(191, 90, 242);
    doc.setFontSize(16);
    doc.text(t("rr.pdfTrainingHeader"), 14, 12);
    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    doc.text(`${t("rr.trExpired")}: ${training.filter(tr => tr.status === "expired").length} | ${t("rr.trExpiringSoon")}: ${training.filter(tr => tr.status === "expiring_soon").length}`, 14, 19);

    autoTable(doc, {
      startY: 30,
      head: [[t("rr.colEmployee"), t("rr.colCertification"), t("rr.colProvider"), t("rr.colIssueDate"), t("rr.colExpiryDate"), t("rr.colStatus"), t("rr.colZone")]],
      body: training.map(tr => [
        tr.employeeName, tr.certification, tr.provider,
        tr.issueDate.toLocaleDateString(), tr.expiryDate.toLocaleDateString(),
        TRAINING_STATUS_CONFIG[tr.status] ? t(TRAINING_STATUS_CONFIG[tr.status].labelKey) : tr.status,
        tr.zone,
      ]),
      theme: "striped",
      headStyles: { fillColor: [191, 90, 242], fontSize: 7, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      margin: { left: 10, right: 10 },
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(150, 150, 150);
      doc.text(t("rr.pdfFooter"), 10, ph - 6);
      doc.text(`${t("rr.pdfPage")} ${i}/${pageCount}`, pw - 10, ph - 6, { align: "right" });
    }

    doc.save(`Risk-Register-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success(t("rr.pdfExported"), { id: "risk-pdf" });
  } catch (err) {
    console.error(err);
    toast.error(t("rr.pdfFailed"), { id: "risk-pdf" });
  }
}

// ── Main Component ───────────────────────────────────────────────

type TabType = "risks" | "training" | "matrix";

export function RiskRegisterPage({ t, webMode, pendingRiskUpdates = [] }: { t: (k: string) => string; webMode?: boolean; pendingRiskUpdates?: { riskId: string; update: Record<string, any> }[] }) {
  // Boot: prefer localStorage cache (instant paint), then MOCK_RISKS as
  // a dev-only fallback. After mount we reconcile with Supabase. If the
  // server has rows they win; if it's empty and we only have MOCK data,
  // we seed the server with the mock so the first real edit persists
  // somewhere durable. (P3-#11b)
  const [risks, setRisks] = useState<RiskEntry[]>(() => {
    // 2026-06-03 14th pattern app: bootstrap from the service cache
    // (which keeps an in-memory copy + writes to a NON-legacy localStorage
    // key). The legacy `sosphere_risks` key is killed inside getCachedRisks
    // as a one-shot migration — eliminates the CRIT-#4 cross-tenant leak.
    const cached = getCachedRisks();
    return cached.length > 0 ? cached : (import.meta.env.DEV ? MOCK_RISKS : []);
  });
  const [training, setTraining] = useState<TrainingRecord[]>(import.meta.env.DEV ? MOCK_TRAINING : []);
  const [activeTab, setActiveTab] = useState<TabType>("risks");
  const [expandedRisk, setExpandedRisk] = useState<string | null>(null);
  const [zoneFilter, setZoneFilter] = useState("all");
  // Guard so the initial Supabase reconciliation doesn't loop back into
  // the "upsert on change" effect and overwrite the server's own data
  // with an outdated snapshot we just replaced.
  const [serverBootComplete, setServerBootComplete] = useState(false);

  // Reconcile with Supabase on mount. Non-blocking — if the server is
  // unreachable or the user isn't logged in yet, we simply keep the
  // local data we already painted.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [serverRisks, serverTraining] = await Promise.all([
        fetchRiskRegister(),
        fetchTrainingRecords(),
      ]);
      if (cancelled) return;
      if (serverRisks.length > 0) {
        setRisks(serverRisks);
      } else {
        // Server has no risks yet. If we're showing MOCK_RISKS this is
        // the user's first visit — seed the server so future edits stick.
        // We detect "is mock" by id prefix; real imports use other ids.
        const looksLikeMock = risks.length > 0 && risks.every(r => r.id.startsWith("RSK-00"));
        if (looksLikeMock) {
          void upsertRiskBatch(risks); // fire-and-forget
        }
      }
      if (serverTraining.length > 0) {
        setTraining(serverTraining);
      }
      setServerBootComplete(true);
    })();
    return () => { cancelled = true; };
    // intentional: useEffect dep array deliberately partial (CI fix #176)
  }, []);

  // Persist risk updates: localStorage (instant offline cache) + Supabase
  // (durable source of truth). We skip the Supabase write until the
  // server boot has finished so we don't trample freshly-loaded data.
  useEffect(() => {
    // 2026-06-03 14th pattern app: stop writing the legacy
    // `sosphere_risks` key. Server is authoritative; the service cache
    // is updated on the next fetchRiskRegister (which the page does
    // on mount + we explicitly call setCachedRisks here so the local
    // bootstrap matches the freshly-edited state without a re-fetch).
    setCachedRisks(risks);
    if (!serverBootComplete) return;
    void upsertRiskBatch(risks);
  }, [risks, serverBootComplete]);

  // Persist training record updates to Supabase. We upsert the full set
  // rather than diffing because the list is small (tens of rows per
  // company) and keeping it simple avoids drift bugs.
  useEffect(() => {
    if (!serverBootComplete) return;
    for (const t of training) {
      void upsertTrainingRecord(t);
    }
  }, [training, serverBootComplete]);

  // ── Mutation Handlers ──────────────────────────────────────────

  const updateRiskControls = (riskId: string, controls: { existingControls?: string[]; controlStatus?: ControlStatus }) => {
    setRisks(prev => prev.map(r =>
      r.id === riskId ? { ...r, ...controls, lastReviewedBy: "Admin", reviewDate: new Date() } : r
    ));
    console.log("[SUPABASE_READY] risk_register_mutation: " + JSON.stringify({ riskId, action: "update_controls" }));
    toast.success(`${t("rr.toastControlsPrefix")} ${riskId} ${t("rr.toastControlsUpdated")}`);
  };

  const updateRiskScore = (riskId: string, newScore: { likelihood: Likelihood; consequence: Consequence }) => {
    const score = newScore.likelihood * newScore.consequence;
    const level: RiskLevel = score >= 15 ? "extreme" : score >= 10 ? "high" : score >= 5 ? "medium" : score >= 2 ? "low" : "negligible";
    setRisks(prev => prev.map(r =>
      r.id === riskId ? { ...r, likelihood: newScore.likelihood, consequence: newScore.consequence, riskScore: score, riskLevel: level, lastReviewedBy: "Admin", reviewDate: new Date() } : r
    ));
    console.log("[SUPABASE_READY] risk_register_mutation: " + JSON.stringify({ riskId, action: "update_score", score, level }));
    toast.success(`${t("rr.toastControlsPrefix")} ${riskId} ${t("rr.toastScore")} → ${score} (${level})`);
  };

  const markTrainingComplete = (recordId: string, employeeId: string) => {
    setTraining(prev => prev.map(tr =>
      tr.id === recordId ? { ...tr, status: "valid" as const, issueDate: new Date(), expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) } : tr
    ));
    console.log("[SUPABASE_READY] risk_register_mutation: " + JSON.stringify({ riskId: recordId, action: "training_complete", employeeId }));
    toast.success(`${t("rr.toastTraining")} ${recordId} ${t("rr.toastMarkedComplete")}`);
  };

  // ── Apply external risk updates from Investigation close ────────
  useEffect(() => {
    if (pendingRiskUpdates.length > 0) {
      setRisks(prev => {
        let updated = prev;
        for (const { riskId, update } of pendingRiskUpdates) {
          updated = updated.map(r =>
            r.id === riskId ? { ...r, ...update, lastReviewedBy: "Investigation Close", reviewDate: new Date() } : r
          );
        }
        console.log("[SUPABASE_READY] risk_register_external_updates: " + JSON.stringify(pendingRiskUpdates.map(u => u.riskId)));
        return updated;
      });
    }
  }, [pendingRiskUpdates]);

  // ── Auto-update risk when real emergency occurs ────────────────
  useEffect(() => {
    const unsub = onSyncEvent((event) => {
      if (event.type === "SOS_TRIGGERED" || event.type === "FALL_DETECTED" || event.type === "HAZARD_REPORT") {
        const zone = event.zone || "";
        if (!zone) return;

        setRisks(prev => prev.map(risk => {
          // Find risks for the affected zone
          if (!risk.zone.toLowerCase().includes(zone.toLowerCase())) return risk;

          // Increase likelihood by 1 (max 5) — real incident means higher risk
          const newLikelihood = Math.min(5, risk.likelihood + 1) as 1|2|3|4|5;
          const newScore = newLikelihood * risk.consequence;
          const newLevel: "extreme"|"high"|"medium"|"low"|"negligible" =
            newScore >= 15 ? "extreme" : newScore >= 10 ? "high" :
            newScore >= 5 ? "medium" : newScore >= 2 ? "low" : "negligible";

          return {
            ...risk,
            likelihood: newLikelihood,
            riskScore: newScore,
            riskLevel: newLevel,
            lastReviewedBy: "System (Auto-updated from emergency)",
            reviewDate: new Date(),
          };
        }));

        // Save updated risks to localStorage for persistence
        console.log(`[SUPABASE_READY] risk_auto_updated: zone=${zone}, event=${event.type}`);
      }
    });
    return () => unsub();
  }, []);

  // ── Derived Data ───────────────────────────────────────────────

  const zones = ["all", ...new Set(risks.map(r => r.zone))];
  const filteredRisks = zoneFilter === "all" ? risks : risks.filter(r => r.zone === zoneFilter);
  const filteredTraining = zoneFilter === "all" ? training : training.filter(t => t.zone === zoneFilter || t.zone === "All Zones");

  const riskStats = {
    extreme: risks.filter(r => r.riskLevel === "extreme").length,
    high: risks.filter(r => r.riskLevel === "high").length,
    medium: risks.filter(r => r.riskLevel === "medium").length,
    overdue: risks.filter(r => r.reviewDate < new Date()).length,
  };

  const trainingStats = {
    total: training.length,
    expired: training.filter(t => t.status === "expired").length,
    expiringSoon: training.filter(t => t.status === "expiring_soon").length,
  };

  return (
    <div className={`p-5 space-y-5 ${webMode ? "max-w-6xl mx-auto" : ""}`}>
      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: t("rr.statExtremeRisks"), value: riskStats.extreme, color: "#FF2D55", icon: TriangleAlert },
          { label: t("rr.statHighRisks"), value: riskStats.high, color: "#FF9500", icon: AlertTriangle },
          { label: t("rr.statMediumRisks"), value: riskStats.medium, color: "#FFD60A", icon: Shield },
          { label: t("rr.statExpiredCerts"), value: trainingStats.expired, color: "#FF2D55", icon: Award },
          { label: t("rr.statExpiringSoon"), value: trainingStats.expiringSoon, color: "#FF9500", icon: Clock },
        ].map(s => {
          const I = s.icon;
          return (
            <div key={s.label} className="rounded-xl p-3.5" style={{ background: `${s.color}06`, border: `1px solid ${s.color}12` }}>
              <div className="flex items-center gap-2 mb-1.5">
                <I className="size-3.5" style={{ color: s.color }} />
                <span style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.3)" }}>{s.label}</span>
              </div>
              <span className="text-white" style={{ fontSize: 24, fontWeight: 800 }}>{s.value}</span>
            </div>
          );
        })}
      </div>

      {/* Tabs + Zone Filter + Export */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {([
            { id: "risks" as TabType, label: t("rr.tabRiskRegister"), icon: Shield },
            { id: "training" as TabType, label: t("rr.tabTrainingCerts"), icon: GraduationCap },
            { id: "matrix" as TabType, label: t("rr.tabRiskMatrix"), icon: Layers },
          ]).map(tab => {
            const TI = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
                style={{
                  background: activeTab === tab.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${activeTab === tab.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.05)"}`,
                }}>
                <TI className="size-3.5" style={{ color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.3)" }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.4)" }}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* Zone filter */}
          <select
            value={zoneFilter}
            onChange={e => setZoneFilter(e.target.value)}
            className="bg-transparent rounded-lg px-3 py-2 text-white"
            style={{ fontSize: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}>
            {zones.map(z => <option key={z} value={z} style={{ background: "#0A1220" }}>{z === "all" ? t("rr.allZones") : z}</option>)}
          </select>
          <button
            onClick={() => exportRiskRegisterPDF(risks, training, t)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
            style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)", cursor: "pointer" }}>
            <Download className="size-3.5" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>{t("rr.exportPdf")}</span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === "risks" && (
          <motion.div key="risks" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
            {filteredRisks.sort((a, b) => b.riskScore - a.riskScore).map(risk => {
              const rlCfg = RISK_LEVEL_CONFIG[risk.riskLevel];
              const csCfg = CONTROL_STATUS_CONFIG[risk.controlStatus];
              const isExpanded = expandedRisk === risk.id;

              return (
                <div key={risk.id} className="rounded-xl overflow-hidden" style={{ background: rlCfg.bg, border: `1px solid ${rlCfg.color}12` }}>
                  <button onClick={() => setExpandedRisk(isExpanded ? null : risk.id)}
                    className="w-full flex items-start gap-3 p-3.5 text-left">
                    {/* Risk Score Circle */}
                    <div className="size-12 rounded-xl flex flex-col items-center justify-center flex-shrink-0"
                      style={{ background: `${rlCfg.color}15`, border: `1px solid ${rlCfg.color}25` }}>
                      <span style={{ fontSize: 16, fontWeight: 900, color: rlCfg.color }}>{risk.riskScore}</span>
                      <span style={{ fontSize: 6, fontWeight: 700, color: `${rlCfg.color}80`, marginTop: -2 }}>SCORE</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)" }}>{risk.id}</span>
                        <div className="px-1.5 py-0.5 rounded" style={{ background: `${rlCfg.color}15` }}>
                          <span style={{ fontSize: 7.5, fontWeight: 800, color: rlCfg.color }}>{t(rlCfg.labelKey).toUpperCase()}</span>
                        </div>
                        <div className="px-1.5 py-0.5 rounded" style={{ background: `${csCfg.color}10` }}>
                          <span style={{ fontSize: 7.5, fontWeight: 800, color: csCfg.color }}>{t(csCfg.labelKey)}</span>
                        </div>
                      </div>
                      <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{risk.hazard}</p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                        {risk.zone} &bull; L={risk.likelihood} × C={risk.consequence} &bull; {t(CATEGORY_LABEL_KEYS[risk.category])}
                      </p>
                    </div>
                    <ChevronRight className="size-4 mt-1" style={{ color: "rgba(255,255,255,0.15)", transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
                  </button>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                        <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 12 }}>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>{risk.description}</p>

                          {/* Existing Controls */}
                          <div>
                            <span style={{ ...TYPOGRAPHY.overline, color: "#00C853" }}>{t("rr.existingControls")}</span>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {risk.existingControls.map((ctrl, i) => (
                                <span key={i} className="px-2.5 py-1 rounded-lg" style={{ fontSize: 9, color: "rgba(0,200,83,0.7)", background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.1)" }}>
                                  <CheckCircle2 className="size-2.5 inline mr-1" />{ctrl}
                                </span>
                              ))}
                            </div>
                          </div>

                          {/* Preventive Measures */}
                          <div>
                            <span style={{ ...TYPOGRAPHY.overline, color: "#BF5AF2" }}>{t("rr.preventiveMeasures")}</span>
                            <div className="space-y-1.5 mt-2">
                              {risk.preventiveMeasures.map((pm, i) => (
                                <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                                  <ClipboardCheck className="size-3 flex-shrink-0 mt-0.5" style={{ color: "#BF5AF2" }} />
                                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>{pm}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-4 pt-1" style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                            <span>{t("rr.owner")}: {risk.responsiblePerson}</span>
                            <span>{t("rr.nextReview")}: {risk.reviewDate.toLocaleDateString()}</span>
                            <span>{t("rr.lastReviewed")}: {risk.lastReviewedBy}</span>
                            <span style={{ color: "rgba(0,200,224,0.4)" }}>{risk.isoReference}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </motion.div>
        )}

        {activeTab === "training" && (
          <motion.div key="training" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
            {/* Alerts */}
            {trainingStats.expired > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.12)" }}>
                <Bell className="size-4" style={{ color: "#FF2D55" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#FF2D55" }}>
                  {trainingStats.expired} {t("rr.alertExpiredCerts")}
                </span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                  {t("rr.alertExpiredDetail")}
                </span>
              </div>
            )}

            {/* Training Table */}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="grid grid-cols-7 gap-0 px-4 py-2.5" style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                {[t("rr.thEmployee"), t("rr.thCertification"), t("rr.thProvider"), t("rr.thIssued"), t("rr.thExpires"), t("rr.thStatus"), t("rr.thZone")].map(h => (
                  <span key={h} style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.3)" }}>{h}</span>
                ))}
              </div>
              {filteredTraining.sort((a, b) => {
                const order = { expired: 0, expiring_soon: 1, valid: 2 };
                return order[a.status] - order[b.status];
              }).map(tr => {
                const stCfg = TRAINING_STATUS_CONFIG[tr.status];
                return (
                  <div key={tr.id} className="grid grid-cols-7 gap-0 px-4 py-2.5 items-center"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: tr.status === "expired" ? "rgba(255,45,85,0.03)" : "transparent" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{tr.employeeName}</span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{tr.certification}</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{tr.provider}</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{tr.issueDate.toLocaleDateString()}</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{tr.expiryDate.toLocaleDateString()}</span>
                    <div className="px-2 py-0.5 rounded w-fit" style={{ background: `${stCfg.color}10` }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: stCfg.color }}>{t(stCfg.labelKey).toUpperCase()}</span>
                    </div>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{tr.zone}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {activeTab === "matrix" && (
          <motion.div key="matrix" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="grid grid-cols-2 gap-4">
              <RiskMatrix risks={filteredRisks} t={t} />
              {/* Risk Distribution by Category */}
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <h3 style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>{t("rr.distByCategory")}</h3>
                <div className="space-y-3">
                  {Object.entries(CATEGORY_LABEL_KEYS).map(([key, labelKey]) => {
                    const count = filteredRisks.filter(r => r.category === key).length;
                    const pct = filteredRisks.length > 0 ? (count / filteredRisks.length) * 100 : 0;
                    if (count === 0) return null;
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{t(labelKey)}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>{count} ({Math.round(pct)}%)</span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            className="h-full rounded-full"
                            style={{ background: "linear-gradient(90deg, #00C8E0, #00E5FF)" }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Risk by Zone */}
                <h3 style={{ ...TYPOGRAPHY.overline, color: "rgba(255,255,255,0.4)", marginTop: 20, marginBottom: 12 }}>{t("rr.risksPerZone")}</h3>
                <div className="space-y-2">
                  {[...new Set(risks.map(r => r.zone))].map(zone => {
                    const zoneRisks = risks.filter(r => r.zone === zone);
                    const maxScore = Math.max(...zoneRisks.map(r => r.riskScore));
                    const levelCfg = RISK_LEVEL_CONFIG[
                      maxScore >= 15 ? "extreme" : maxScore >= 10 ? "high" : maxScore >= 6 ? "medium" : "low"
                    ];
                    return (
                      <div key={zone} className="flex items-center justify-between px-3 py-2 rounded-lg"
                        style={{ background: `${levelCfg.color}06`, border: `1px solid ${levelCfg.color}10` }}>
                        <div className="flex items-center gap-2">
                          <MapPin className="size-3" style={{ color: levelCfg.color }} />
                          <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{zone}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize: 10, fontWeight: 700, color: levelCfg.color }}>{zoneRisks.length} {t("rr.risksLabel")}</span>
                          <span style={{ fontSize: 8, fontWeight: 800, color: levelCfg.color }}>{t("rr.max")}: {maxScore}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}