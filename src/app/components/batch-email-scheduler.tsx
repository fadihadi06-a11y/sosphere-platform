// ═══════════════════════════════════════════════════════════════
// SOSphere — Batch Email Scheduling System
// ─────────────────────────────────────────────────────────────
// Schedule automated monthly/weekly performance reports via email.
// Supports bulk recipients, report type selection, and scheduling.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { storeJSONSync, loadJSONSync } from "./api/storage-adapter";
import {
  Mail, Clock, Calendar, Users, FileText, CheckCircle2,
  X, Plus, Trash2, Bell, Shield, Download, Send,
  ChevronRight, Zap, Settings, Target, Star,
  RotateCcw, Eye, Sparkles, Timer,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, playUISound } from "./haptic-feedback";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface ScheduledReport {
  id: string;
  name: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly";
  reportTypes: string[];
  recipients: string[];
  nextRun: string;
  lastRun?: string;
  enabled: boolean;
  createdAt: string;
  includeCharts: boolean;
  includeQR: boolean;
  format: "pdf" | "csv" | "both";
}

// SUPABASE_MIGRATION_POINT: email_schedules
// table: email_schedules(id, company_id, name, report_types,
// frequency, recipients, enabled, next_run, created_at)
// Replace storeJSONSync/loadJSONSync with Supabase table operations
const STORAGE_KEY = "sosphere_email_schedules";

function loadSchedules(): ScheduledReport[] {
  return loadJSONSync<ScheduledReport[]>(STORAGE_KEY, []);
}

function saveSchedules(schedules: ScheduledReport[]) {
  storeJSONSync(STORAGE_KEY, schedules);
}

const REPORT_TYPES = [
  { id: "performance", label: "Admin Performance", icon: Target, color: "#00C8E0" },
  { id: "safety", label: "Safety Compliance", icon: Shield, color: "#00C853" },
  { id: "incidents", label: "Incident Summary", icon: FileText, color: "#FF2D55" },
  { id: "attendance", label: "Attendance Report", icon: Users, color: "#FF9500" },
  { id: "training", label: "Training Progress", icon: Star, color: "#8B5CF6" },
  { id: "audit", label: "Audit Trail", icon: Eye, color: "#AF52DE" },
];

const FREQUENCY_OPTIONS = [
  { id: "daily" as const, label: "Daily", desc: "Every day at 8:00 AM", color: "#00C8E0" },
  { id: "weekly" as const, label: "Weekly", desc: "Every Monday at 8:00 AM", color: "#00C853" },
  { id: "monthly" as const, label: "Monthly", desc: "1st of every month", color: "#FF9500" },
  { id: "quarterly" as const, label: "Quarterly", desc: "Every 3 months", color: "#8B5CF6" },
];

// SUPABASE_MIGRATION_POINT: email_recipients
// SELECT id, name, email, role FROM employees
// WHERE company_id = :id AND role IN ('admin', 'zone_admin')
const MOCK_RECIPIENTS = [
  "admin@company.com", "safety@company.com", "hr@company.com",
  "operations@company.com", "ceo@company.com", "cto@company.com",
  "zone-a@company.com", "zone-b@company.com",
];

// ═══════════════════════════════════════════════════════════════
// Create Schedule Modal
// ═══════════════════════════════════════════════════════════════

function CreateScheduleModal({ onClose, onSave }: { onClose: () => void; onSave: (schedule: ScheduledReport) => void }) {
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<ScheduledReport["frequency"]>("monthly");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(["performance"]));
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set(["admin@company.com"]));
  const [customEmail, setCustomEmail] = useState("");
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeQR, setIncludeQR] = useState(true);
  const [format, setFormat] = useState<"pdf" | "csv" | "both">("pdf");
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const toggleType = (id: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleRecipient = (email: string) => {
    setSelectedRecipients(prev => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  };

  const addCustomEmail = () => {
    if (customEmail && customEmail.includes("@")) {
      setSelectedRecipients(prev => new Set([...prev, customEmail]));
      setCustomEmail("");
    }
  };

  const handleSave = () => {
    if (!name.trim() || selectedTypes.size === 0 || selectedRecipients.size === 0) {
      toast.error("Please fill all required fields");
      return;
    }

    const nextRun = new Date();
    if (frequency === "daily") nextRun.setDate(nextRun.getDate() + 1);
    else if (frequency === "weekly") nextRun.setDate(nextRun.getDate() + (8 - nextRun.getDay()) % 7);
    else if (frequency === "monthly") { nextRun.setMonth(nextRun.getMonth() + 1); nextRun.setDate(1); }
    else { nextRun.setMonth(nextRun.getMonth() + 3); nextRun.setDate(1); }
    nextRun.setHours(8, 0, 0, 0);

    const schedule: ScheduledReport = {
      id: `SCH-${Date.now().toString(36).toUpperCase()}`,
      name: name.trim(),
      frequency,
      reportTypes: Array.from(selectedTypes),
      recipients: Array.from(selectedRecipients),
      nextRun: nextRun.toISOString(),
      enabled: true,
      createdAt: new Date().toISOString(),
      includeCharts,
      includeQR,
      format,
    };

    onSave(schedule);
  };

  const canProgress = step === 1 ? name.trim() && selectedTypes.size > 0 : step === 2 ? selectedRecipients.size > 0 : true;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      style={{ background: "rgba(5,7,14,0.95)", backdropFilter: "blur(20px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 20 }}
        className="w-full max-w-lg rounded-3xl overflow-hidden"
        style={{ background: "rgba(10,18,32,0.95)", border: "1px solid rgba(255,255,255,0.06)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(0,200,224,0.1)" }}>
              <Calendar className="size-4" style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>Schedule Report</h3>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>Step {step}/3</p>
            </div>
          </div>
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)" }}>
            <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>
        </div>

        {/* Progress */}
        <div className="flex gap-1 px-5 pt-3">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex-1 h-1 rounded-full" style={{ background: s <= step ? "#00C8E0" : "rgba(255,255,255,0.04)" }} />
          ))}
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {/* Step 1: Name + Report Types */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>SCHEDULE NAME</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g., Monthly Safety Report"
                  className="w-full mt-1.5 px-4 py-3 rounded-xl outline-none"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "#fff", fontSize: 14 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>REPORT TYPES</label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  {REPORT_TYPES.map(rt => (
                    <motion.button
                      key={rt.id}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => toggleType(rt.id)}
                      className="flex items-center gap-2 p-3 rounded-xl"
                      style={{
                        background: selectedTypes.has(rt.id) ? `${rt.color}08` : "rgba(255,255,255,0.02)",
                        border: `1px solid ${selectedTypes.has(rt.id) ? `${rt.color}20` : "rgba(255,255,255,0.04)"}`,
                      }}
                    >
                      {selectedTypes.has(rt.id) ? (
                        <CheckCircle2 className="size-4 flex-shrink-0" style={{ color: rt.color }} />
                      ) : (
                        <rt.icon className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
                      )}
                      <span style={{ fontSize: 11, fontWeight: 600, color: selectedTypes.has(rt.id) ? rt.color : "rgba(255,255,255,0.35)" }}>
                        {rt.label}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>FREQUENCY</label>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  {FREQUENCY_OPTIONS.map(f => (
                    <motion.button
                      key={f.id}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setFrequency(f.id)}
                      className="p-3 rounded-xl text-left"
                      style={{
                        background: frequency === f.id ? `${f.color}08` : "rgba(255,255,255,0.02)",
                        border: `1px solid ${frequency === f.id ? `${f.color}20` : "rgba(255,255,255,0.04)"}`,
                      }}
                    >
                      <p style={{ fontSize: 12, fontWeight: 700, color: frequency === f.id ? f.color : "rgba(255,255,255,0.4)" }}>{f.label}</p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{f.desc}</p>
                    </motion.button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Recipients */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>
                  RECIPIENTS ({selectedRecipients.size} selected)
                </label>
                <div className="space-y-1.5 mt-2">
                  {MOCK_RECIPIENTS.map(email => (
                    <motion.button
                      key={email}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => toggleRecipient(email)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl"
                      style={{
                        background: selectedRecipients.has(email) ? "rgba(0,200,224,0.04)" : "rgba(255,255,255,0.01)",
                        border: `1px solid ${selectedRecipients.has(email) ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.04)"}`,
                      }}
                    >
                      <div className="size-5 rounded flex items-center justify-center"
                        style={{ background: selectedRecipients.has(email) ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)", border: `1px solid ${selectedRecipients.has(email) ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.08)"}` }}>
                        {selectedRecipients.has(email) && <CheckCircle2 className="size-3" style={{ color: "#00C8E0" }} />}
                      </div>
                      <Mail className="size-3.5" style={{ color: selectedRecipients.has(email) ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
                      <span style={{ fontSize: 12, color: selectedRecipients.has(email) ? "#00C8E0" : "rgba(255,255,255,0.4)" }}>{email}</span>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Custom email */}
              <div className="flex gap-2">
                <input
                  value={customEmail}
                  onChange={e => setCustomEmail(e.target.value)}
                  placeholder="Add custom email..."
                  className="flex-1 px-3 py-2.5 rounded-xl outline-none"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "#fff", fontSize: 12 }}
                  onKeyDown={e => e.key === "Enter" && addCustomEmail()}
                />
                <motion.button whileTap={{ scale: 0.95 }} onClick={addCustomEmail}
                  className="px-3 py-2.5 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                  <Plus className="size-4" style={{ color: "#00C8E0" }} />
                </motion.button>
              </div>
            </div>
          )}

          {/* Step 3: Options + Review */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.5px" }}>FORMAT</label>
                <div className="flex gap-2 mt-1.5">
                  {(["pdf", "csv", "both"] as const).map(f => (
                    <motion.button key={f} whileTap={{ scale: 0.97 }} onClick={() => setFormat(f)}
                      className="flex-1 py-2.5 rounded-xl text-center"
                      style={{
                        background: format === f ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${format === f ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}`,
                        fontSize: 12, fontWeight: 700, color: format === f ? "#00C8E0" : "rgba(255,255,255,0.3)",
                      }}>
                      {f.toUpperCase()}
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Options */}
              {[
                { label: "Include Charts & Graphs", value: includeCharts, toggle: () => setIncludeCharts(!includeCharts) },
                { label: "Include QR Verification", value: includeQR, toggle: () => setIncludeQR(!includeQR) },
              ].map(opt => (
                <button key={opt.label} onClick={opt.toggle} className="w-full flex items-center justify-between p-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{opt.label}</span>
                  <div className="w-10 h-5 rounded-full p-0.5 transition-colors"
                    style={{ background: opt.value ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.06)" }}>
                    <motion.div className="size-4 rounded-full" animate={{ x: opt.value ? 20 : 0 }}
                      style={{ background: opt.value ? "#00C8E0" : "rgba(255,255,255,0.2)" }} />
                  </div>
                </button>
              ))}

              {/* Summary */}
              <div className="p-4 rounded-xl" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)" }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(0,200,224,0.6)", letterSpacing: "0.5px", marginBottom: 8 }}>SUMMARY</p>
                <div className="space-y-2">
                  {[
                    { l: "Schedule", v: name },
                    { l: "Frequency", v: FREQUENCY_OPTIONS.find(f => f.id === frequency)?.label || frequency },
                    { l: "Reports", v: `${selectedTypes.size} type(s)` },
                    { l: "Recipients", v: `${selectedRecipients.size} email(s)` },
                    { l: "Format", v: format.toUpperCase() },
                  ].map(r => (
                    <div key={r.l} className="flex items-center justify-between">
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{r.l}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#00C8E0" }}>{r.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 flex gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {step > 1 && (
            <button onClick={() => setStep((step - 1) as any)} className="px-4 py-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: 600 }}>
              Back
            </button>
          )}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              if (step < 3) setStep((step + 1) as any);
              else handleSave();
            }}
            disabled={!canProgress}
            className="flex-1 py-3 rounded-xl flex items-center justify-center gap-2"
            style={{
              background: canProgress ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${canProgress ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.04)"}`,
              opacity: canProgress ? 1 : 0.5,
            }}
          >
            {step < 3 ? (
              <>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>Next</span>
                <ChevronRight className="size-4" style={{ color: "#00C8E0" }} />
              </>
            ) : (
              <>
                <Calendar className="size-4" style={{ color: "#00C8E0" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>Create Schedule</span>
              </>
            )}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Batch Email Scheduler
// ═══════════════════════════════════════════════════════════════

export function BatchEmailScheduler({ t, webMode, onGenerateReport }: { t: (k: string) => string; webMode?: boolean; onGenerateReport?: (reportTypes: string[]) => void }) {
  const [schedules, setSchedules] = useState<ScheduledReport[]>(loadSchedules());
  const [showCreate, setShowCreate] = useState(false);

  const handleSave = (schedule: ScheduledReport) => {
    const updated = [...schedules, schedule];
    setSchedules(updated);
    saveSchedules(updated);
    setShowCreate(false);
    playUISound("actionDone");
    toast.success("Schedule created successfully!");
    console.log("[SUPABASE_READY] schedule_created: " + JSON.stringify({ id: schedule.id, name: schedule.name, frequency: schedule.frequency, reportTypes: schedule.reportTypes, recipientCount: schedule.recipients.length }));
  };

  const toggleSchedule = (id: string) => {
    const updated = schedules.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s);
    setSchedules(updated);
    saveSchedules(updated);
    const toggled = updated.find(s => s.id === id);
    console.log("[SUPABASE_READY] schedule_toggled: " + JSON.stringify({ id, enabled: toggled?.enabled }));
  };

  const deleteSchedule = (id: string) => {
    const updated = schedules.filter(s => s.id !== id);
    setSchedules(updated);
    saveSchedules(updated);
    toast.success("Schedule deleted");
    console.log("[SUPABASE_READY] schedule_deleted: " + JSON.stringify({ id }));
  };

  const runNow = (schedule: ScheduledReport) => {
    console.log("[SUPABASE_READY] schedule_run_now: " + JSON.stringify({ id: schedule.id, reportTypes: schedule.reportTypes }));
    if (onGenerateReport) {
      onGenerateReport(schedule.reportTypes);
    }
    // SUPABASE_MIGRATION_POINT: run_now — when migrating, send via Supabase Edge Function to schedule.recipients
    toast.success(`Sending ${schedule.name} to ${schedule.recipients.length} recipients...`);
    const updated = schedules.map(s => s.id === schedule.id ? { ...s, lastRun: new Date().toISOString() } : s);
    setSchedules(updated);
    saveSchedules(updated);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.15)" }}>
            <Calendar className="size-5" style={{ color: "#00C8E0" }} />
          </div>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>Batch Email Scheduler</h3>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
              {schedules.length} schedule{schedules.length !== 1 ? "s" : ""} | {schedules.filter(s => s.enabled).length} active
            </p>
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
          style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}
        >
          <Plus className="size-4" style={{ color: "#00C8E0" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>New Schedule</span>
        </motion.button>
      </div>

      {/* Schedules list */}
      {schedules.length > 0 ? (
        <div className="space-y-3">
          {schedules.map(schedule => {
            const freqMeta = FREQUENCY_OPTIONS.find(f => f.id === schedule.frequency);
            return (
              <motion.div
                key={schedule.id}
                layout
                className="p-4 rounded-2xl"
                style={{
                  background: schedule.enabled ? "rgba(10,18,32,0.6)" : "rgba(10,18,32,0.3)",
                  border: `1px solid ${schedule.enabled ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.03)"}`,
                  opacity: schedule.enabled ? 1 : 0.6,
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="size-9 rounded-lg flex items-center justify-center"
                      style={{ background: `${freqMeta?.color || "#00C8E0"}10` }}>
                      <Mail className="size-4" style={{ color: freqMeta?.color || "#00C8E0" }} />
                    </div>
                    <div>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{schedule.name}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 8, fontWeight: 800, color: freqMeta?.color, background: `${freqMeta?.color}10`, letterSpacing: "0.5px" }}>
                          {schedule.frequency.toUpperCase()}
                        </span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                          {schedule.recipients.length} recipient{schedule.recipients.length !== 1 ? "s" : ""}
                        </span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>
                          {schedule.reportTypes.length} report{schedule.reportTypes.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Toggle */}
                  <button onClick={() => toggleSchedule(schedule.id)}
                    className="w-10 h-5 rounded-full p-0.5"
                    style={{ background: schedule.enabled ? "rgba(0,200,83,0.3)" : "rgba(255,255,255,0.06)" }}>
                    <motion.div className="size-4 rounded-full" animate={{ x: schedule.enabled ? 20 : 0 }}
                      style={{ background: schedule.enabled ? "#00C853" : "rgba(255,255,255,0.2)" }} />
                  </button>
                </div>

                {/* Meta */}
                <div className="flex items-center gap-4 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                      Next: {new Date(schedule.nextRun).toLocaleDateString()}
                    </span>
                  </div>
                  {schedule.lastRun && (
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-3" style={{ color: "rgba(0,200,83,0.4)" }} />
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                        Last: {new Date(schedule.lastRun).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => runNow(schedule)}
                    className="flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5"
                    style={{ background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.1)" }}>
                    <Send className="size-3" style={{ color: "#00C8E0" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#00C8E0" }}>Run Now</span>
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={() => deleteSchedule(schedule.id)}
                    className="px-3 py-2 rounded-xl flex items-center justify-center"
                    style={{ background: "rgba(255,45,85,0.04)", border: "1px solid rgba(255,45,85,0.08)" }}>
                    <Trash2 className="size-3" style={{ color: "#FF2D55" }} />
                  </motion.button>
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16">
          <Calendar className="size-14 mx-auto mb-4" style={{ color: "rgba(255,255,255,0.06)" }} />
          <p style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.25)" }}>No Scheduled Reports</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>
            Create a schedule to automate report delivery
          </p>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowCreate(true)}
            className="mt-6 px-6 py-3 rounded-xl flex items-center gap-2 mx-auto"
            style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}
          >
            <Plus className="size-4" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>Create First Schedule</span>
          </motion.button>
        </div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <CreateScheduleModal onClose={() => setShowCreate(false)} onSave={handleSave} />
        )}
      </AnimatePresence>
    </div>
  );
}