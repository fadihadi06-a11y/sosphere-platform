// ═══════════════════════════════════════════════════════════════
// SOSphere — CSV Field Guide & Template Reference
// Comprehensive field documentation for employee bulk import
// ═══════════════════════════════════════════════════════════════
import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FileText, Download, CheckCircle2, AlertTriangle, X, Info, Users, Shield, MapPin, Phone, Mail, Clock, Hash, Globe, Key, ChevronDown, ChevronUp, Copy, Check, Layers, Lock } from "lucide-react";

// ── Field Definitions ─────────────────────────────────────────
interface CSVField {
  column: string;
  label: string;
  required: boolean;
  type: "text" | "phone" | "email" | "enum" | "list";
  maxLength?: number;
  format?: string;
  validValues?: string[];
  example: string;
  notes: string;
  icon: React.ElementType;
  color: string;
}

const CSV_FIELDS: CSVField[] = [
  {
    column: "name",
    label: "Full Name",
    required: true,
    type: "text",
    maxLength: 100,
    format: "First Last",
    example: "Ahmed Khalil",
    notes: "Employee's full legal name in English. Used for all system notifications and reports.",
    icon: Users,
    color: "#00C8E0",
  },
  {
    column: "name_ar",
    label: "Arabic Name",
    required: false,
    type: "text",
    maxLength: 100,
    format: "الاسم الكامل",
    example: "أحمد خليل",
    notes: "Optional Arabic transliteration. Displayed on Arabic-language dashboards and SMS.",
    icon: Globe,
    color: "#4A90D9",
  },
  {
    column: "employee_id",
    label: "Employee ID",
    required: true,
    type: "text",
    maxLength: 20,
    format: "Alphanumeric (no spaces)",
    example: "EMP-001",
    notes: "Must be unique per employee. Used as the primary identifier. Duplicate IDs will cause an import error.",
    icon: Hash,
    color: "#00C8E0",
  },
  {
    column: "phone",
    label: "Phone Number",
    required: true,
    type: "phone",
    format: "+[CountryCode][Number]",
    example: "+966501234567",
    notes: "International format required. Used for SOS alerts, check-in SMS, and emergency calls. No spaces or dashes.",
    icon: Phone,
    color: "#00C8E0",
  },
  {
    column: "email",
    label: "Email Address",
    required: false,
    type: "email",
    format: "user@domain.com",
    example: "ahmed@company.com",
    notes: "Used for dashboard invite link and weekly safety reports. Leave blank if employee has no email.",
    icon: Mail,
    color: "#FF9500",
  },
  {
    column: "department",
    label: "Department",
    required: true,
    type: "text",
    maxLength: 50,
    example: "Engineering",
    notes: "Free-text department name. Used for grouping in analytics and reports. Consistent naming recommended.",
    icon: Layers,
    color: "#00C8E0",
  },
  {
    column: "role",
    label: "Job Role / Title",
    required: true,
    type: "text",
    maxLength: 60,
    example: "Field Engineer",
    notes: "Employee's job title. Determines default system role mapping. See Role Mapping table below.",
    icon: Shield,
    color: "#00C8E0",
  },
  {
    column: "system_level",
    label: "System Level",
    required: false,
    type: "enum",
    validValues: ["worker", "zone_admin"],
    example: "worker",
    notes: "Defaults to 'worker' if blank. Use 'zone_admin' to bulk-import Zone Admins. Owner and Main Admin must be set manually in the dashboard.",
    icon: Key,
    color: "#FF9500",
  },
  {
    column: "zone",
    label: "Zone Assignment",
    required: false,
    type: "text",
    maxLength: 30,
    example: "Zone A",
    notes: "Primary zone the employee operates in. Must match an existing zone name exactly (case-insensitive). Leave blank for unassigned.",
    icon: MapPin,
    color: "#FF9500",
  },
  {
    column: "allowed_zones",
    label: "Allowed Zones",
    required: false,
    type: "list",
    format: "Comma-separated (quoted if multiple)",
    example: "\"Zone A,Zone B\"",
    notes: "Additional zones the employee can access beyond their primary zone. Wrap in quotes if multiple zones. E.g. \"Zone A,Zone B,Zone C\".",
    icon: MapPin,
    color: "#FF9500",
  },
  {
    column: "shift",
    label: "Shift Schedule",
    required: false,
    type: "enum",
    validValues: ["Morning", "Evening", "Night", "Rotating"],
    example: "Morning",
    notes: "Employee's default shift. Used by the Workforce module for scheduling. Defaults to 'Morning' if blank.",
    icon: Clock,
    color: "#FF9500",
  },
  {
    column: "checkin_frequency",
    label: "Check-in Frequency (hrs)",
    required: false,
    type: "text",
    format: "Number (1–12)",
    example: "4",
    notes: "How often the employee must check in (in hours). Default is company-wide setting. Override per-employee here.",
    icon: Clock,
    color: "#FF9500",
  },
  {
    column: "emergency_contact",
    label: "Emergency Contact",
    required: false,
    type: "phone",
    format: "+[CountryCode][Number]",
    example: "+966509876543",
    notes: "Next-of-kin or emergency contact phone number. Notified automatically during active SOS events.",
    icon: Phone,
    color: "#FF9500",
  },
];

// ── Role Mapping Table ────────────────────────────────────────
const ROLE_MAPPINGS = [
  { jobTitle: "Field Engineer / Technician / Operator",  systemRole: "employee",          level: "worker",     permissions: "Emergency create/view, attendance" },
  { jobTitle: "Safety Inspector / HSE Officer / Marshal", systemRole: "field_medic",      level: "worker",     permissions: "Emergency view/resolve, attendance, reports view" },
  { jobTitle: "Security Guard / Security Officer",        systemRole: "security_guard",   level: "worker",     permissions: "Emergency create/view, zones view, attendance" },
  { jobTitle: "Shift Supervisor / Team Lead",             systemRole: "shift_supervisor", level: "zone_admin", permissions: "Emergency create/view/resolve/escalate, team management, zones" },
  { jobTitle: "Safety Manager / HSE Manager",             systemRole: "safety_manager",   level: "zone_admin", permissions: "Full emergency, team edit, zone manage, reports export" },
  { jobTitle: "Dispatcher / Coordinator",                 systemRole: "dispatcher",       level: "zone_admin", permissions: "Emergency view/assign/broadcast, members view" },
];

// ── Permission Level Summary ──────────────────────────────────
const PERMISSION_LEVELS = [
  {
    level: "owner",
    label: "Owner",
    color: "#FF2D55",
    canDo: [
      "Full system access — no restrictions",
      "Manage Main Admin (assign/remove)",
      "Change company billing & subscription",
      "View all zones and all employees",
      "Change any permission (with 2FA)",
      "Delete company account",
    ],
    cannotDo: ["Cannot be managed or demoted by anyone"],
    limit: "1 per company (set during registration)",
    howToCreate: "Created during company registration. Cannot be imported via CSV.",
  },
  {
    level: "main_admin",
    label: "Main Admin",
    color: "#FF9500",
    canDo: [
      "Manage all Zone Admins and workers",
      "Assign/unassign Zone Admins",
      "View and manage all zones",
      "Approve/reject pending members",
      "Run bulk CSV imports",
      "Change permissions for Zone Admins & Workers (with 2FA)",
      "View billing (read-only by default)",
    ],
    cannotDo: [
      "Cannot change Owner's permissions",
      "Cannot manage billing (unless Owner grants)",
      "Cannot create/delete zones without Owner confirmation",
    ],
    limit: "1 per company",
    howToCreate: "Assigned manually in Roles & Permissions → Members tab. Cannot be set via CSV.",
  },
  {
    level: "zone_admin",
    label: "Zone Admin (Lead + Secondary)",
    color: "#00C8E0",
    canDo: [
      "Manage workers in their assigned zone(s)",
      "View and respond to emergencies in their zone",
      "View zone analytics and attendance",
      "Broadcast alerts within their zone",
      "Escalate to Main Admin",
      "Edit worker profiles in their zone",
    ],
    cannotDo: [
      "Cannot access other zones' data",
      "Cannot change roles or permissions",
      "Cannot approve new members",
      "Cannot access billing or settings",
    ],
    limit: "Up to 2 per zone (Lead + Secondary)",
    howToCreate: "Set system_level=zone_admin in CSV, then assign to zone in Roles → Zone Admins tab.",
  },
  {
    level: "worker",
    label: "Field Worker",
    color: "#34C759",
    canDo: [
      "Trigger SOS emergency",
      "View their own profile & attendance",
      "Submit check-ins",
      "View zone safety alerts",
      "Access the SOSphere mobile app",
    ],
    cannotDo: [
      "Cannot access the web dashboard",
      "Cannot view other employees' data",
      "Cannot manage any settings",
      "Cannot resolve or assign emergencies",
    ],
    limit: "Unlimited",
    howToCreate: "Default level. Leave system_level blank or set to 'worker' in CSV.",
  },
];

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
interface CSVFieldGuideProps {
  onClose?: () => void;
  onDownloadTemplate?: () => void;
  standalone?: boolean;
}

export function CSVFieldGuide({ onClose, onDownloadTemplate, standalone = false }: CSVFieldGuideProps) {
  const [activeTab, setActiveTab] = useState<"fields" | "roles" | "permissions" | "example">("fields");
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const TEMPLATE_CSV = `name,name_ar,employee_id,phone,email,department,role,system_level,zone,allowed_zones,shift,checkin_frequency,emergency_contact
Ahmed Khalil,أحمد خليل,EMP-001,+966501234567,ahmed@company.com,Engineering,Field Engineer,worker,Zone A,"Zone A,Zone B",Morning,4,+966509876543
Fatima Hassan,فاطمة حسن,EMP-002,+966507654321,fatima@company.com,Safety,Safety Inspector,worker,Zone B,"Zone B,Zone C",Morning,4,+966508765432
Khalid Omar,خالد عمر,EMP-003,+966509876543,khalid@company.com,Operations,Shift Supervisor,zone_admin,Zone A,,Evening,4,+966507654321
Sara Al-Mutairi,سارة المطيري,EMP-004,+966502345678,sara@company.com,Safety,HSE Manager,zone_admin,Zone C,,Morning,4,+966506543210
Mohammed Ali,محمد علي,EMP-005,+966503456789,,Maintenance,Technician,worker,Zone D,,Night,6,+966505432109`;

  const handleCopy = () => {
    navigator.clipboard.writeText(TEMPLATE_CSV);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (onDownloadTemplate) { onDownloadTemplate(); return; }
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sosphere_employee_template_v2.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const TABS = [
    { id: "fields" as const,      label: "Field Reference",     count: CSV_FIELDS.length },
    { id: "roles" as const,       label: "Role Mapping",        count: ROLE_MAPPINGS.length },
    { id: "permissions" as const, label: "Permission Levels",   count: PERMISSION_LEVELS.length },
    { id: "example" as const,     label: "Example CSV",         count: null },
  ];

  return (
    <div
      className={`flex flex-col ${standalone ? "h-full" : ""}`}
      style={{ background: "#05070E", minHeight: standalone ? "100%" : undefined }}
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
              <FileText className="size-5" style={{ color: "#00C8E0" }} />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: "-0.4px" }}>CSV Field Guide</h1>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                Complete reference for employee bulk import
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl"
              style={{ background: "linear-gradient(135deg, #00C8E0, #00A0B4)", color: "#000", fontSize: 12, fontWeight: 700 }}
            >
              <Download className="size-3.5" /> Template
            </button>
            {onClose && (
              <button
                onClick={onClose}
                className="size-8 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
              </button>
            )}
          </div>
        </div>

        {/* Important note */}
        <div className="mt-4 p-3 rounded-xl flex items-start gap-3"
          style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.15)" }}>
          <AlertTriangle className="size-4 flex-shrink-0 mt-0.5" style={{ color: "#FF9500" }} />
          <p style={{ fontSize: 11, color: "rgba(255,150,0,0.8)", lineHeight: 1.6 }}>
            <strong>Important:</strong> Owner and Main Admin roles <em>cannot</em> be set via CSV import.
            They must be configured manually in the Roles & Permissions dashboard after import.
            All Zone Admin assignments must be confirmed in the Zone Admins tab.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 flex items-center gap-1 pt-4 pb-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex items-center gap-2 px-4 py-3 transition-all relative"
            style={{
              fontSize: 12, fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.4)",
              borderBottom: activeTab === tab.id ? "2px solid #00C8E0" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab.label}
            {tab.count !== null && (
              <span className="px-1.5 py-0.5 rounded-md"
                style={{ fontSize: 9, fontWeight: 700, background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait">

          {/* ══ FIELDS TAB ══ */}
          {activeTab === "fields" && (
            <motion.div key="fields" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 rounded-xl text-center"
                  style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.15)" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#00C8E0" }}>
                    {CSV_FIELDS.filter(f => f.required).length}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(0,200,224,0.6)", marginTop: 2 }}>Required Fields</div>
                </div>
                <div className="p-3 rounded-xl text-center"
                  style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.15)" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: "#FF9500" }}>
                    {CSV_FIELDS.filter(f => !f.required).length}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,150,0,0.6)", marginTop: 2 }}>Optional Fields</div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {CSV_FIELDS.map(field => {
                  const FIcon = field.icon;
                  const isExpanded = expandedField === field.column;
                  return (
                    <motion.div
                      key={field.column}
                      className="rounded-2xl overflow-hidden cursor-pointer"
                      style={{ background: "rgba(10,18,32,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}
                      onClick={() => setExpandedField(isExpanded ? null : field.column)}
                    >
                      <div className="flex items-center gap-3 p-3">
                        <div className="size-8 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: `${field.color}12`, border: `1px solid ${field.color}25` }}>
                          <FIcon className="size-4" style={{ color: field.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code style={{ fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>
                              {field.column}
                            </code>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>— {field.label}</span>
                            <span className="flex-shrink-0 px-1.5 py-0.5 rounded-md"
                              style={{
                                fontSize: 8, fontWeight: 700,
                                background: field.required ? "rgba(0,200,224,0.1)" : "rgba(255,150,0,0.08)",
                                color: field.required ? "#00C8E0" : "#FF9500",
                              }}>
                              {field.required ? "REQUIRED" : "OPTIONAL"}
                            </span>
                          </div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2, fontFamily: "monospace" }}>
                            e.g. {field.example}
                          </div>
                        </div>
                        {isExpanded
                          ? <ChevronUp className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.3)" }} />
                          : <ChevronDown className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
                        }
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                            style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                          >
                            <div className="px-4 py-4 space-y-3">
                              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>{field.notes}</p>
                              <div className="grid grid-cols-2 gap-2">
                                {field.format && (
                                  <div className="p-2 rounded-xl"
                                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Format</div>
                                    <code style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{field.format}</code>
                                  </div>
                                )}
                                {field.maxLength && (
                                  <div className="p-2 rounded-xl"
                                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                                    <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>Max Length</div>
                                    <code style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>{field.maxLength} chars</code>
                                  </div>
                                )}
                              </div>
                              {field.validValues && (
                                <div>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>Valid Values</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {field.validValues.map(v => (
                                      <code key={v} className="px-2 py-1 rounded-lg"
                                        style={{ fontSize: 10, background: "rgba(0,200,224,0.08)", color: "#00C8E0", border: "1px solid rgba(0,200,224,0.15)" }}>
                                        {v}
                                      </code>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ══ ROLE MAPPING TAB ══ */}
          {activeTab === "roles" && (
            <motion.div key="roles" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="p-3 rounded-xl mb-4 flex items-start gap-3"
                style={{ background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.12)" }}>
                <Info className="size-4 flex-shrink-0 mt-0.5" style={{ color: "#00C8E0" }} />
                <p style={{ fontSize: 11, color: "rgba(0,200,224,0.7)", lineHeight: 1.6 }}>
                  The <code style={{ fontFamily: "monospace" }}>role</code> column is free text (job title). 
                  SOSphere maps common job titles to system roles automatically. 
                  You can adjust mappings after import in Roles & Permissions.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {ROLE_MAPPINGS.map((row, i) => (
                  <div key={i} className="p-4 rounded-2xl"
                    style={{ background: "rgba(10,18,32,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 4 }}>
                          {row.jobTitle}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-md"
                            style={{ fontSize: 9, fontWeight: 700, background: "rgba(0,200,224,0.1)", color: "#00C8E0" }}>
                            {row.systemRole}
                          </span>
                          <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>→</span>
                          <span className="px-2 py-0.5 rounded-md"
                            style={{ fontSize: 9, fontWeight: 700,
                              background: row.level === "zone_admin" ? "rgba(0,200,224,0.08)" : "rgba(52,199,89,0.08)",
                              color: row.level === "zone_admin" ? "#00C8E0" : "#34C759",
                            }}>
                            {row.level}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>
                          Default permissions: {row.permissions}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ══ PERMISSIONS TAB ══ */}
          {activeTab === "permissions" && (
            <motion.div key="perms" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="flex flex-col gap-4">
                {PERMISSION_LEVELS.map(level => (
                  <div key={level.level} className="rounded-2xl overflow-hidden"
                    style={{ background: "rgba(10,18,32,0.8)", border: `1px solid ${level.color}20` }}>
                    {/* Level header */}
                    <div className="flex items-center gap-3 p-4"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: `${level.color}06` }}>
                      <div className="size-10 rounded-xl flex items-center justify-center"
                        style={{ background: `${level.color}15`, border: `1px solid ${level.color}30` }}>
                        <Lock className="size-5" style={{ color: level.color }} />
                      </div>
                      <div className="flex-1">
                        <div style={{ fontSize: 14, fontWeight: 800, color: level.color }}>{level.label}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{level.limit}</div>
                      </div>
                      <div className="px-3 py-1.5 rounded-xl"
                        style={{ background: `${level.color}10`, border: `1px solid ${level.color}25` }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: level.color, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                          CSV: {level.level === "owner" || level.level === "main_admin" ? "Manual Only" : level.level}
                        </div>
                      </div>
                    </div>

                    <div className="p-4 grid grid-cols-2 gap-4">
                      {/* Can do */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-3">
                          <CheckCircle2 className="size-3.5" style={{ color: "#34C759" }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#34C759", textTransform: "uppercase", letterSpacing: "0.5px" }}>Can Do</span>
                        </div>
                        <ul className="space-y-1.5">
                          {level.canDo.map((item, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <div className="size-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: "#34C759" }} />
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Cannot do */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-3">
                          <X className="size-3.5" style={{ color: "#FF2D55" }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#FF2D55", textTransform: "uppercase", letterSpacing: "0.5px" }}>Cannot Do</span>
                        </div>
                        <ul className="space-y-1.5">
                          {level.cannotDo.map((item, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <div className="size-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: "#FF2D55" }} />
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* How to create */}
                    <div className="px-4 pb-4">
                      <div className="p-3 rounded-xl flex items-start gap-2"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <Info className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                          <strong style={{ color: "rgba(255,255,255,0.6)" }}>Setup: </strong>{level.howToCreate}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ══ EXAMPLE CSV TAB ══ */}
          {activeTab === "example" && (
            <motion.div key="example" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="mb-4 p-4 rounded-2xl"
                style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.12)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4" style={{ color: "#00C8E0" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>sosphere_employee_template_v2.csv</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                      style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)", fontSize: 11, fontWeight: 600, color: "#00C8E0" }}
                    >
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
                      style={{ background: "linear-gradient(135deg, #00C8E0, #00A0B4)", fontSize: 11, fontWeight: 700, color: "#000" }}
                    >
                      <Download className="size-3.5" /> Download
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <pre style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.6)",
                    background: "rgba(0,0,0,0.3)",
                    padding: 16,
                    borderRadius: 12,
                    overflow: "auto",
                    lineHeight: 1.8,
                    border: "1px solid rgba(255,255,255,0.06)",
                    whiteSpace: "pre",
                  }}>
                    {TEMPLATE_CSV}
                  </pre>
                </div>
              </div>

              {/* Validation rules */}
              <div className="space-y-3">
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12 }}>Validation Rules</h3>
                {[
                  { rule: "Duplicate employee_id", result: "ERROR — row is rejected", color: "#FF2D55" },
                  { rule: "Invalid phone format (not international)", result: "ERROR — row is rejected", color: "#FF2D55" },
                  { rule: "Unknown zone name", result: "WARNING — assigned to 'Unassigned' pool", color: "#FF9500" },
                  { rule: "Missing email", result: "WARNING — no dashboard invite sent", color: "#FF9500" },
                  { rule: "Missing emergency_contact", result: "WARNING — no next-of-kin notifications", color: "#FF9500" },
                  { rule: "system_level = owner or main_admin", result: "ERROR — not allowed via CSV", color: "#FF2D55" },
                  { rule: "More than 2 zone_admins per zone", result: "ERROR — exceeds zone admin limit", color: "#FF2D55" },
                  { rule: "Blank required field", result: "ERROR — row is rejected", color: "#FF2D55" },
                ].map((v, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl"
                    style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="size-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: v.color }} />
                    <div className="flex-1">
                      <code style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>{v.rule}</code>
                      <div style={{ fontSize: 10, color: v.color, marginTop: 2 }}>{v.result}</div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
