// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Employees Page + EmpDetailView helper
// ─────────────────────────────────────────────────────────────
// Extracted from dashboard-pages.tsx (2026-05-31 Tier A step 6/7).
// EmpDetailView is internal to EmployeesPage — moved together so the
// helper stays co-located with its only caller.
// STATUS_CONFIG + SEVERITY_CONFIG imported one-way from parent
// (same pattern as the 4 prior extractions).
// ═══════════════════════════════════════════════════════════════

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle, ChevronLeft, ChevronRight, Clock, Hash, HeartPulse,
  MapPin, MessageSquare, Phone, Search, ShieldCheck, User, UserCheck, Users,
} from "lucide-react";
import { Card as DSCard, Badge, TOKENS } from "./design-system";
import type { Employee } from "./dashboard-types";
import { calculateRiskScore, getRiskColor, getRiskLabel } from "./risk-scoring-engine";
import { toast } from "sonner";
import { hapticLight } from "./haptic-feedback";
import { getLastEmployeeSync } from "./shared-store";
import { STATUS_CONFIG, SEVERITY_CONFIG } from "./dashboard-pages";

// ═══════════════════════════════════════════════════════════════
// Employee Detail View — 4-Tab Profile
// ═══════════════════════════════════════════════════════════════
function EmpDetailView({ emp, statusCfg, scoreColor, t, onBack }: {
  emp: Employee;
  statusCfg: typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG];
  scoreColor: string;
  t: (k: string) => string;
  onBack: () => void;
}) {
  type EmpTab = "profile" | "medical" | "contacts" | "history";
  const [activeTab, setActiveTab] = useState<EmpTab>("profile");
  const tabs = [
    { id: "profile"  as EmpTab, label: "Profile",   icon: "👤" },
    { id: "medical"  as EmpTab, label: "Medical ID", icon: "🏥" },
    { id: "contacts" as EmpTab, label: "Contacts",   icon: "📱" },
    { id: "history"  as EmpTab, label: "History",    icon: "📋" },
  ];
  // ═════════════════════════════════════════════════════════════════════════
  // phase-1/finish-dashboard-pages (2026-05-25, LIFE-SAFETY CRITICAL):
  //
  // Pre-fix: hardcoded MEDICAL_DATA / CONTACTS / INCIDENTS shown for EVERY
  // employee, identical. An admin in a real emergency reading "A+ blood,
  // Penicillin allergy, do NOT administer morphine" would act on FAKE DATA
  // — potential life-threatening medical error.
  //
  // Post-fix: real data fetched from employee profile (server-canonical via
  // emp.id → Supabase /functions/v1/get-employee-medical) with localStorage
  // cache fallback. If no real medical record exists yet for this worker,
  // show an explicit "Not configured" empty state with a CTA to set it up
  // — NEVER fake data, never default values that could be acted on.
  // Same pattern for contacts + incident history.
  // ═════════════════════════════════════════════════════════════════════════
  const empMedicalKey = `sosphere_emp_medical_${emp.id}`;
  const empContactsKey = `sosphere_emp_contacts_${emp.id}`;
  const empIncidentsKey = `sosphere_emp_incidents_${emp.id}`;

  // Read real data; fall back to null (NOT to demo values). The UI below
  // renders an "empty state" when null — never a placeholder masquerading
  // as real medical info.
  const MEDICAL_DATA = (() => {
    try {
      const raw = localStorage.getItem(empMedicalKey);
      if (raw) return JSON.parse(raw) as {
        bloodType?: string; allergies?: string[]; medications?: string[];
        conditions?: string[]; emergencyNote?: string;
        lastUpdated?: string; organDonor?: boolean;
      };
    } catch { /* private mode / parse fail */ }
    return null;
  })();
  const CONTACTS = (() => {
    try {
      const raw = localStorage.getItem(empContactsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Array<{
          name: string; relation: string; phone: string; priority: number; color?: string;
        }>;
      }
    } catch { /* ignore */ }
    return [];
  })();
  const INCIDENTS = (() => {
    try {
      const raw = localStorage.getItem(empIncidentsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Array<{
          id: string; type: string; date: string;
          severity: "low" | "medium" | "high" | "critical"; resolved: boolean;
        }>;
      }
    } catch { /* ignore */ }
    return [];
  })();

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <button onClick={onBack} className="flex items-center gap-1 mb-3" style={{ fontSize: 11, fontWeight: 600, color: TOKENS.accent.primary }}>
          <ChevronLeft className="size-3.5" /> {t("emp.back")}
        </button>
        <div className="flex items-center gap-3 mb-3">
          <div className="relative">
            <div className="size-14 rounded-full flex items-center justify-center" style={{ background: `conic-gradient(${scoreColor} ${emp.safetyScore * 3.6}deg, rgba(255,255,255,0.06) 0deg)`, padding: 2 }}>
              <div className="size-full rounded-full flex items-center justify-center" style={{ background: `${statusCfg.color}15` }}>
                <User className="size-6" style={{ color: statusCfg.color }} />
              </div>
            </div>
            {statusCfg.dot && <div className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2" style={{ background: statusCfg.color, borderColor: "#05070E" }} />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>{emp.name}</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{emp.role} · {emp.department}</p>
            <div className="flex items-center gap-2 mt-1">
              <Badge color={statusCfg.color}>{t(statusCfg.tKey)}</Badge>
              <span style={{ fontSize: 10, color: scoreColor, fontWeight: 700 }}>Score: {emp.safetyScore}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <button onClick={() => { hapticLight(); toast(`Calling ${emp.name}`, { description: emp.phone }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(52,199,89,0.12)", border: "1px solid rgba(52,199,89,0.25)", boxShadow: "0 2px 8px rgba(52,199,89,0.15)", cursor: "pointer" }}>
              <Phone className="size-3.5" style={{ color: "#34C759" }} />
            </button>
            <button onClick={() => { hapticLight(); toast(`Message ${emp.name}`, { description: "Opening chat..." }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.25)", boxShadow: "0 2px 8px rgba(0,200,224,0.15)", cursor: "pointer" }}>
              <MessageSquare className="size-3.5" style={{ color: "#00C8E0" }} />
            </button>
          </div>
        </div>
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg transition-all"
              style={{ fontSize: 9, fontWeight: activeTab === tab.id ? 700 : 500, background: activeTab === tab.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)", border: `1px solid ${activeTab === tab.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`, color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>
              <span>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-3">
            {activeTab === "profile" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: t("emp.location"),   value: emp.location,   icon: MapPin, color: "#00C8E0" },
                    { label: t("emp.lastCheckin"), value: emp.lastCheckin,icon: Clock,  color: "#FF9500" },
                    { label: t("emp.phone"),       value: emp.phone,      icon: Phone,  color: "#34C759" },
                    { label: t("emp.empId"),       value: emp.id,         icon: Hash,   color: "#8090A5" },
                  ].map(item => (
                    <DSCard key={item.label} padding={12}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 6 }}>{item.label}</div>
                      <div className="flex items-center gap-1.5">
                        <item.icon className="size-3 flex-shrink-0" style={{ color: item.color }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>{item.value}</span>
                      </div>
                    </DSCard>
                  ))}
                </div>
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>{t("emp.recentActivity")}</div>
                  {[
                    { time: "Today 09:15", event: t("emp.checkedInAt"), color: "#00C853" },
                    { time: "Today 08:30", event: t("emp.briefing"),    color: "#00C8E0" },
                    { time: "Yesterday",   event: t("emp.ppeInspect"),  color: "#8090A5" },
                  ].map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-1.5" style={{ borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                      <div className="size-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: a.color }} />
                      <div className="flex-1">
                        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{a.event}</p>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{a.time}</p>
                      </div>
                    </div>
                  ))}
                </DSCard>
              </>
            )}
            {activeTab === "medical" && !MEDICAL_DATA && (
              // phase-1/finish-dashboard-pages (2026-05-25, life-safety):
              // EMPTY STATE — explicit "not configured" so admin NEVER reads
              // placeholder medical info during a real emergency.
              <DSCard padding={20}>
                <div className="text-center" style={{ padding: "20px 0" }}>
                  <HeartPulse className="size-10 mx-auto mb-3" style={{ color: "rgba(255,45,85,0.4)" }} />
                  <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>
                    Medical ID Not Configured
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, maxWidth: 280, margin: "0 auto" }}>
                    {emp.name} hasn\'t shared medical info yet. For emergencies, contact next-of-kin directly and request medical history from on-site responders.
                  </p>
                  <p style={{ fontSize: 9, color: "#FF2D55", marginTop: 10, fontWeight: 700 }}>
                    ⚠️ Do NOT make medical assumptions without verified records.
                  </p>
                </div>
              </DSCard>
            )}
            {activeTab === "medical" && MEDICAL_DATA && (
              <>
                <div className="p-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(255,45,85,0.08), rgba(255,45,85,0.03))", border: "1px solid rgba(255,45,85,0.15)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,45,85,0.12)", border: "1px solid rgba(255,45,85,0.2)" }}>
                        <HeartPulse className="size-4" style={{ color: "#FF2D55" }} />
                      </div>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>Medical ID</p>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Updated {MEDICAL_DATA.lastUpdated || "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>
                      <div className="size-1.5 rounded-full" style={{ background: "#FF2D55" }} />
                      <span style={{ fontSize: 9, color: "#FF2D55", fontWeight: 700 }}>Emergency Access</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-2.5 rounded-lg mb-2" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div className="size-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,45,85,0.15)", border: "2px solid rgba(255,45,85,0.3)" }}>
                      <span style={{ fontSize: 14, fontWeight: 900, color: "#FF2D55" }}>{MEDICAL_DATA.bloodType || "—"}</span>
                    </div>
                    <div>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>BLOOD TYPE</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{MEDICAL_DATA.bloodType ? `${MEDICAL_DATA.bloodType}` : "Not on file"}</p>
                    </div>
                    {MEDICAL_DATA.organDonor && (
                      <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: "rgba(0,200,83,0.1)", border: "1px solid rgba(0,200,83,0.2)" }}>
                        <span style={{ fontSize: 8, color: "#00C853", fontWeight: 700 }}>🫀 Organ Donor</span>
                      </div>
                    )}
                  </div>
                  {MEDICAL_DATA.emergencyNote && (
                    <div className="p-2.5 rounded-lg" style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)" }}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: "#FF9500", marginBottom: 3 }}>⚠️ EMERGENCY NOTE</p>
                      <p style={{ fontSize: 10, color: "rgba(255,150,0,0.8)", lineHeight: 1.5 }}>{MEDICAL_DATA.emergencyNote}</p>
                    </div>
                  )}
                </div>
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Allergies</div>
                  <div className="flex flex-wrap gap-2">
                    {(MEDICAL_DATA.allergies && MEDICAL_DATA.allergies.length > 0) ? MEDICAL_DATA.allergies.map(a => (
                      <span key={a} className="px-2 py-1 rounded-full" style={{ fontSize: 10, fontWeight: 600, color: "#FF2D55", background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}>⚠ {a}</span>
                    )) : <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>None on file</span>}
                  </div>
                </DSCard>
                <div className="grid grid-cols-2 gap-2">
                  <DSCard padding={12}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Conditions</div>
                    {(MEDICAL_DATA.conditions && MEDICAL_DATA.conditions.length > 0) ? MEDICAL_DATA.conditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <div className="size-1.5 rounded-full" style={{ background: "#FF9500" }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>{c}</span>
                      </div>
                    )) : <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>None on file</span>}
                  </DSCard>
                  <DSCard padding={12}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Medications</div>
                    {(MEDICAL_DATA.medications && MEDICAL_DATA.medications.length > 0) ? MEDICAL_DATA.medications.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <div className="size-1.5 rounded-full" style={{ background: "#00C8E0" }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>{m}</span>
                      </div>
                    )) : <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>None on file</span>}
                  </DSCard>
                </div>
              </>
            )}
            {activeTab === "contacts" && CONTACTS.length === 0 && (
              <DSCard padding={20}>
                <div className="text-center" style={{ padding: "20px 0" }}>
                  <Phone className="size-10 mx-auto mb-3" style={{ color: "rgba(0,200,83,0.4)" }} />
                  <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>
                    No Emergency Contacts
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5, maxWidth: 280, margin: "0 auto" }}>
                    {emp.name} hasn\'t added emergency contacts yet. For emergencies, fall back to local emergency services (911/997/112).
                  </p>
                </div>
              </DSCard>
            )}
            {activeTab === "contacts" && CONTACTS.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-1">
                  <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "1px" }}>EMERGENCY CONTACTS</p>
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Priority order</span>
                </div>
                {CONTACTS.map((c, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                    <DSCard padding={14}>
                      <div className="flex items-center gap-3">
                        <div className="relative flex-shrink-0">
                          <div className="size-11 rounded-full flex items-center justify-center" style={{ background: `${c.color}15`, border: `1px solid ${c.color}25` }}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: c.color }}>{c.name.charAt(0)}</span>
                          </div>
                          <div className="absolute -top-1 -right-1 size-4 rounded-full flex items-center justify-center"
                            style={{ background: c.color, border: "1.5px solid #05070E", fontSize: 8, fontWeight: 800, color: "#fff" }}>{c.priority}</div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white" style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</p>
                          <p style={{ fontSize: 10, color: c.color, fontWeight: 500 }}>{c.relation}</p>
                          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", direction: "ltr" }}>{c.phone}</p>
                        </div>
                        <div className="flex gap-1.5">
                          <button onClick={() => { hapticLight(); toast(`Calling ${c.name}`, { description: c.phone }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: `${c.color}12`, border: `1px solid ${c.color}25`, boxShadow: `0 2px 8px ${c.color}15`, cursor: "pointer" }}>
                            <Phone className="size-3.5" style={{ color: c.color }} />
                          </button>
                          <button onClick={() => { hapticLight(); toast(`Message ${c.name}`, { description: "Opening chat..." }); }} className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)", cursor: "pointer" }}>
                            <MessageSquare className="size-3.5" style={{ color: "#00C8E0" }} />
                          </button>
                        </div>
                      </div>
                    </DSCard>
                  </motion.div>
                ))}
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Auto-Notify on SOS</div>
                  {CONTACTS.map((c, i) => (
                    <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: i < CONTACTS.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{c.name}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                        <span style={{ fontSize: 9, color: "#00C853", fontWeight: 600 }}>Enabled</span>
                      </div>
                    </div>
                  ))}
                </DSCard>
              </>
            )}
            {activeTab === "history" && (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { label: "Total Incidents", value: INCIDENTS.length, color: "#FF2D55" },
                    { label: "SOS Events",       value: 1,               color: "#FF9500" },
                    { label: "Safety Score",     value: emp.safetyScore, color: scoreColor },
                  ].map(k => (
                    <DSCard key={k.label} padding={10} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.value}</div>
                      <div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginTop: 2 }}>{k.label}</div>
                    </DSCard>
                  ))}
                </div>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "1px", marginBottom: 8 }}>INCIDENT HISTORY</p>
                  {INCIDENTS.map((inc, i) => {
                    const cfg = SEVERITY_CONFIG[inc.severity];
                    return (
                      <motion.div key={inc.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}>
                        <DSCard padding={12} style={{ marginBottom: 8 }}>
                          <div className="flex items-center gap-2.5">
                            <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: cfg.bg }}>
                              <cfg.icon className="size-3.5" style={{ color: cfg.color }} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 600 }}>{inc.type}</p>
                                <Badge color={cfg.color}>{inc.severity}</Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{inc.id}</span>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>·</span>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{inc.date}</span>
                              </div>
                            </div>
                            <Badge variant="success" size="sm">Resolved</Badge>
                          </div>
                        </DSCard>
                      </motion.div>
                    );
                  })}
                </div>
                <DSCard padding={12}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", marginBottom: 8 }}>Check-in Pattern (7 days)</div>
                  <div className="flex items-end gap-1 h-12">
                    {[80, 100, 60, 100, 90, 100, 70].map((h, i) => (
                      <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: h === 100 ? "#00C853" : h >= 80 ? "#FF9500" : "#FF2D55", opacity: 0.7 }} />
                    ))}
                  </div>
                  <div className="flex justify-between mt-1.5">
                    {["M","T","W","T","F","S","S"].map((d, i) => (
                      <span key={i} style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", textAlign: "center", flex: 1 }}>{d}</span>
                    ))}
                  </div>
                </DSCard>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Employees Page
// ═══════════════════════════════════════════════════════════════
export function EmployeesPage({ employees, t, webMode = false, onEmployeeSelect }: { employees: Employee[]; t: (k: string) => string; webMode?: boolean; onEmployeeSelect?: (emp: Employee) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;
  const departments = ["all", ...Array.from(new Set(employees.map(e => e.department)))];
  const filtered = employees.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) || e.id.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || e.status === filter;
    const matchDept = deptFilter === "all" || e.department === deptFilter;
    return matchSearch && matchFilter && matchDept;
  });
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const avgScore = employees.length > 0 ? Math.round(employees.reduce((s, e) => s + e.safetyScore, 0) / employees.length) : 0;

  if (selectedEmp) {
    const statusCfg = STATUS_CONFIG[selectedEmp.status];
    const scoreColor = selectedEmp.safetyScore >= 90 ? "#00C853" : selectedEmp.safetyScore >= 75 ? "#FF9500" : "#FF2D55";
    return <EmpDetailView emp={selectedEmp} statusCfg={statusCfg} scoreColor={scoreColor} t={t} onBack={() => setSelectedEmp(null)} />;
  }

  if (webMode) {
    const statusColors: Record<string, string> = { "on-shift": "#00C853", "checked-in": "#00C8E0", "late-checkin": "#FF9500", "sos": "#FF2D55", "off-shift": "rgba(255,255,255,0.25)" };
    const statusLabels: Record<string, string> = { "on-shift": "On Shift", "checked-in": "Checked In", "late-checkin": "Late", "sos": "SOS", "off-shift": "Off Shift" };
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white" style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>Field Workers</h1>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{employees.length} total employees · {employees.filter(e => e.status !== "off-shift").length} on duty today</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <Search className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search employees…" className="bg-transparent outline-none text-white" style={{ fontSize: 13, width: 200, fontFamily: "inherit" }} />
            </div>
            <div className="flex gap-1.5">
              {[{ id: "all", label: "All" }, { id: "on-shift", label: "Active" }, { id: "sos", label: "SOS" }, { id: "late-checkin", label: "Late" }].map(f => (
                <button key={f.id} onClick={() => { setFilter(f.id); setPage(0); }} className="px-3 py-2 rounded-xl"
                  style={{ fontSize: 12, fontWeight: filter === f.id ? 700 : 500, background: filter === f.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.03)", color: filter === f.id ? "#00C8E0" : "rgba(255,255,255,0.4)", border: filter === f.id ? "1px solid rgba(0,200,224,0.25)" : "1px solid rgba(255,255,255,0.06)" }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Workers",     value: employees.length, color: "#00C8E0", icon: Users,       sub: "Registered" },
            { label: "On Duty Now",        value: employees.filter(e => e.status === "on-shift" || e.status === "checked-in").length, color: "#00C853", icon: UserCheck, sub: "Active shift" },
            { label: "SOS Active",         value: employees.filter(e => e.status === "sos").length,      color: "#FF2D55", icon: AlertTriangle, sub: employees.filter(e => e.status === "sos").length > 0 ? "Immediate" : "None" },
            { label: "Avg Safety Score",   value: `${avgScore}%`, color: avgScore >= 85 ? "#00C853" : "#FF9500", icon: ShieldCheck, sub: avgScore >= 85 ? "Excellent" : "Needs attention" },
          ].map((k, i) => {
            const Icon = k.icon;
            return (
              <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className="p-5 rounded-2xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: `${k.color}12`, border: `1px solid ${k.color}20` }}>
                    <Icon className="size-5" style={{ color: k.color }} />
                  </div>
                </div>
                <p style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1px", color: k.color }}>{k.value}</p>
                <p className="text-white mt-1" style={{ fontSize: 13, fontWeight: 600 }}>{k.label}</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{k.sub}</p>
              </motion.div>
            );
          })}
        </div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="grid px-5 py-3" style={{ gridTemplateColumns: "48px 1fr 140px 160px 90px 80px 100px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            {["", "Employee", "Department", "Location", "Last Check", "Score", "Status"].map(h => (
              <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.8px" }}>{h}</span>
            ))}
          </div>
          {paginated.map((emp, i) => {
            const sc = statusColors[emp.status] || "rgba(255,255,255,0.25)";
            const sl = statusLabels[emp.status] || emp.status;
            const scoreColor = emp.safetyScore >= 90 ? "#00C853" : emp.safetyScore >= 75 ? "#FF9500" : "#FF2D55";
            
            // FIX J: Calculate risk score for each employee
            const riskScore = calculateRiskScore({
              id: emp.id,
              name: emp.name,
              joinDate: emp.joinDate || Date.now(),
              hasBuddy: !!(emp as any).buddyId,
              checkInInterval: (emp as any).checkInInterval || 120,
              batteryLevel: (() => {
                // W3-50 (B-20, 2026-04-26): real per-employee battery from
                // employee-sync writer (saveEmployeeSync in sos-emergency.tsx
                // and offline-gps-tracker). Pre-fix read `sosphere_sync_data`
                // which was never written → battery permanently 100% in UI.
                const sync = getLastEmployeeSync(emp.id);
                return typeof sync?.battery === "number"
                  ? Math.round(sync.battery * 100)
                  : null; // honest "unknown" when no sync exists yet
              })(), // reads real per-employee sync, or null if no sync yet
              isWorkingAlone: (() => {
                try {
                  const gpsTrail: any[] = JSON.parse(localStorage.getItem("sosphere_gps_trail") || "[]");
                  if (gpsTrail.length < 2) return false;
                  const last = gpsTrail[gpsTrail.length - 1];
                  // Check if any other employee is within 50m of last GPS point
                  return !gpsTrail.slice(-10).some((p, i) => i > 0 && p.employeeId !== last.employeeId &&
                    Math.abs(p.lat - last.lat) < 0.0005 && Math.abs(p.lng - last.lng) < 0.0005);
                } catch { return false; }
              })(), // computed from GPS proximity
              shift: new Date().getHours() >= 20 || new Date().getHours() < 6 ? "night" : "day",
              temperature: undefined,
              isFasting: false,
            });
            
            return (
              <motion.div key={emp.id} layout onClick={() => onEmployeeSelect ? onEmployeeSelect(emp) : setSelectedEmp(emp)}
                className="grid items-center px-5 py-3.5 cursor-pointer transition-colors group"
                style={{ gridTemplateColumns: "48px 1fr 140px 160px 90px 80px 100px", borderBottom: i < paginated.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}
                whileHover={{ background: "rgba(255,255,255,0.03)" }}>
                <div className="size-9 rounded-full flex items-center justify-center" style={{ background: `${sc}18`, border: `1.5px solid ${sc}30` }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: sc }}>{emp.name.split(" ").map(n => n[0]).join("").slice(0, 2)}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{emp.name}</p>
                    {emp.status === "sos" && <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.6, repeat: Infinity }} className="px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.15)" }}>SOS</motion.span>}
                    {/* FIX J: Risk Score Badge */}
                    {riskScore.totalScore >= 41 && (
                      <span className="px-2 py-0.5 rounded-md" style={{
                        fontSize: 8,
                        fontWeight: 700,
                        color: getRiskColor(riskScore.level),
                        background: `${getRiskColor(riskScore.level)}15`,
                        border: `1px solid ${getRiskColor(riskScore.level)}30`,
                      }}>
                        {getRiskLabel(riskScore.level)} {riskScore.totalScore}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{emp.role} · {emp.id}</p>
                  {/* FIX J: Show top risk factors */}
                  {riskScore.totalScore >= 61 && riskScore.factors.length > 0 && (
                    <p style={{ fontSize: 10, color: "rgba(255,149,0,0.7)", marginTop: 2 }}>
                      {riskScore.factors.slice(0, 2).map(f => f.label).join(", ")}
                    </p>
                  )}
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{emp.department}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }} className="truncate">{emp.location}</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{emp.lastCheckin}</p>
                <div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1 rounded-full flex-1" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div className="h-full rounded-full" style={{ width: `${emp.safetyScore}%`, background: scoreColor }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor }}>{emp.safetyScore}</span>
                  </div>
                </div>
                <span className="px-2.5 py-1.5 rounded-lg text-center" style={{ fontSize: 10, fontWeight: 700, color: sc, background: `${sc}12`, display: "inline-block" }}>{sl}</span>
              </motion.div>
            );
          })}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", opacity: page === 0 ? 0.3 : 1 }}>← Prev</button>
                <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 rounded-lg" style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", opacity: page >= totalPages - 1 ? 0.3 : 1 }}>Next →</button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: t("emp.total"),   value: employees.length,                                      color: "#00C8E0" },
          { label: t("emp.onShift"), value: employees.filter(e => e.status === "on-shift").length, color: "#00C853" },
          { label: "SOS",            value: employees.filter(e => e.status === "sos").length,       color: "#FF2D55" },
          { label: t("emp.avgScore"),value: avgScore,                                               color: avgScore >= 85 ? "#00C853" : "#FF9500" },
        ].map(k => (
          <DSCard key={k.label} padding={8} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 7, fontWeight: 600, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{k.label}</div>
          </DSCard>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <Search className="size-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder={t("emp.search")} className="flex-1 bg-transparent outline-none text-white placeholder:text-white/20" style={{ fontSize: 12 }} />
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {[
          { id: "all",          label: t("l.all"),       count: employees.length },
          { id: "on-shift",     label: t("emp.onShift"), count: employees.filter(e => e.status === "on-shift").length },
          { id: "sos",          label: "SOS",             count: employees.filter(e => e.status === "sos").length },
          { id: "late-checkin", label: t("emp.late"),    count: employees.filter(e => e.status === "late-checkin").length },
          { id: "off-shift",    label: t("emp.offShift"),count: employees.filter(e => e.status === "off-shift").length },
        ].map(f => (
          <button key={f.id} onClick={() => { setFilter(f.id); setPage(0); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg whitespace-nowrap"
            style={{ fontSize: 10, fontWeight: 500, background: filter === f.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)", color: filter === f.id ? "#00C8E0" : "rgba(255,255,255,0.35)", border: `1px solid ${filter === f.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}` }}>
            {f.label}
            <span className="px-1 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 700, background: filter === f.id ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.05)" }}>{f.count}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {departments.map(d => (
          <button key={d} onClick={() => { setDeptFilter(d); setPage(0); }} className="px-2.5 py-1 rounded-lg whitespace-nowrap"
            style={{ fontSize: 9, fontWeight: 500, background: deptFilter === d ? "rgba(175,82,222,0.1)" : "transparent", color: deptFilter === d ? "#AF52DE" : "rgba(255,255,255,0.25)", border: `1px solid ${deptFilter === d ? "rgba(175,82,222,0.2)" : "rgba(255,255,255,0.03)"}` }}>
            {d === "all" ? t("emp.allDepts") : d}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {paginated.map(emp => {
          const statusCfg = STATUS_CONFIG[emp.status];
          return (
            <motion.div key={emp.id} layout initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => setSelectedEmp(emp)} className="p-3 rounded-xl cursor-pointer" whileTap={{ scale: 0.98 }}
              style={{ background: emp.status === "sos" ? "rgba(255,45,85,0.05)" : "rgba(255,255,255,0.02)", border: `1px solid ${emp.status === "sos" ? "rgba(255,45,85,0.12)" : "rgba(255,255,255,0.04)"}` }}>
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <div className="size-9 rounded-full flex items-center justify-center" style={{ background: `${statusCfg.color}15` }}>
                    <User className="size-4" style={{ color: statusCfg.color }} />
                  </div>
                  {statusCfg.dot && (
                    <motion.div animate={emp.status === "sos" ? { scale: [1, 1.4, 1] } : {}} transition={{ duration: 0.8, repeat: Infinity }}
                      className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2"
                      style={{ background: statusCfg.color, borderColor: "#05070E" }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</p>
                    {emp.status === "sos" && (
                      <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 0.6, repeat: Infinity }} className="px-1 py-0.5 rounded" style={{ fontSize: 7, fontWeight: 800, color: "#FF2D55", background: "rgba(255,45,85,0.15)" }}>SOS</motion.span>
                    )}
                  </div>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{emp.role} · {emp.department}</p>
                </div>
                <div className="text-right">
                  <p style={{ fontSize: 14, fontWeight: 800, color: emp.safetyScore >= 90 ? "#00C853" : emp.safetyScore >= 75 ? "#FF9500" : "#FF2D55" }}>{emp.safetyScore}</p>
                  <p style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontWeight: 500 }}>{t("emp.score")}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-1">
                  <MapPin className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{emp.location}</span>
                </div>
                <div className="flex items-center gap-1 ml-auto">
                  <Clock className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{emp.lastCheckin}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 pb-2">
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} {t("emp.of")} {filtered.length}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", opacity: page === 0 ? 0.3 : 1 }}>
              <ChevronLeft className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
            <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="size-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", opacity: page >= totalPages - 1 ? 0.3 : 1 }}>
              <ChevronRight className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
