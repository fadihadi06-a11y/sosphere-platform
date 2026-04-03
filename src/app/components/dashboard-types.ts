// ═══════════════════════════════════════════════════════════════
// SOSphere Dashboard — Shared Types & Mock Data
// Extracted to keep component files under Babel's 500KB threshold
// ═══════════════════════════════════════════════════════════════

// ── Page IDs ──────────────────────────────────────────────────
export type DashPage =
  // ── HUB PAGES (Sidebar visible — ordered by danger priority) ──
  | "emergencyHub" | "riskMap"           // 🔴 LIVE THREAT
  | "safetyIntel" | "overview"           // 🧠 INTELLIGENCE
  | "operations" | "people"              // 🔵 OPERATIONS
  | "incidentRisk" | "reportsAnalytics"  // 🟢 COMPLIANCE
  | "governance" | "settings"            // ⚙️ SYSTEM
  // ── SUB-PAGES (accessible via hub tabs or deep links) ──
  | "employees" | "journeyMgmt" | "workforce" | "comms"
  | "incidentInvestigation" | "riskRegister" | "complianceReports" | "analytics"
  | "roles" | "auditLog" | "sarProtocol"
  | "billing" | "csvGuide" | "leaderboard" | "emailScheduler" | "rrpAnalytics"
  | "buddySystem" | "checklist" | "playbook" | "weatherAlerts" | "safetyScore"
  | "offlineMonitor" | "location"
  // ── Legacy aliases (redirect via PAGE_ALIASES / PAGE_TO_HUB) ──
  | "emergencies" | "incidents" | "commandCenter"
  | "zones" | "geofencing" | "gpsCompliance"
  | "attendance" | "shiftScheduling"
  | "broadcast" | "evacuation" | "employeeStatus";

// ── Entity Types ───────────────────────────────────────────────
export interface Employee {
  id: string;
  name: string;
  nameAr: string;
  role: string;
  department: string;
  status: "on-shift" | "off-shift" | "sos" | "late-checkin" | "checked-in";
  location: string;
  lastCheckin: string;
  phone: string;
  safetyScore: number;
}

export interface EmergencyItem {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  employeeName: string;
  zone: string;
  type: string;
  timestamp: Date;
  status: "active" | "responding" | "resolved";
  elapsed: number;
  isOwned?: boolean;
  ownedBy?: string;
  ownedAt?: Date;
  manualPriority?: number;
  manualPriorityReason?: string;
  manualPriorityBy?: string;
  manualPriorityAt?: Date;
  /** FIX AUDIT-2.2: Links dashboard emergency to mobile SOS session ID */
  sourceEmergencyId?: string;
}

export interface ZoneData {
  id: string;
  name: string;
  risk: "high" | "medium" | "low";
  employees: number;
  activeAlerts: number;
  status: "active" | "restricted" | "evacuated";
}

// ── Mock Employees ─────────────────────────────────────────────
/*
  SUPABASE_MIGRATION_POINT: employees
  Replace this mock data with:
  const { data } = await supabase
    .from('employees')
    .select('*')
    .eq('company_id', companyId)
  useStore.setState({ employees: data ?? [] })
*/
export const EMPLOYEES: Employee[] = [
  { id: "EMP-001", name: "Ahmed Khalil", nameAr: "أحمد خليل", role: "Field Engineer", department: "Engineering", status: "on-shift", location: "Zone A - North Gate", lastCheckin: "2m ago", phone: "+966 55 XXX", safetyScore: 94 },
  { id: "EMP-002", name: "Fatima Hassan", nameAr: "فاطمة حسن", role: "Safety Inspector", department: "Safety", status: "checked-in", location: "Zone B - Control Room", lastCheckin: "5m ago", phone: "+966 50 XXX", safetyScore: 98 },
  { id: "EMP-003", name: "Khalid Omar", nameAr: "خالد عمر", role: "Operator", department: "Operations", status: "late-checkin", location: "Zone A - East", lastCheckin: "32m ago", phone: "+966 55 XXX", safetyScore: 72 },
  { id: "EMP-004", name: "Nasser Al-Said", nameAr: "ناصر السعيد", role: "Security Guard", department: "Security", status: "off-shift", location: "—", lastCheckin: "2h ago", phone: "+966 54 XXX", safetyScore: 88 },
  { id: "EMP-005", name: "Sara Al-Mutairi", nameAr: "سارة المطيري", role: "HSE Coordinator", department: "Safety", status: "on-shift", location: "Zone C - Main Hall", lastCheckin: "1m ago", phone: "+966 50 XXX", safetyScore: 96 },
  { id: "EMP-006", name: "Mohammed Ali", nameAr: "محمد علي", role: "Technician", department: "Maintenance", status: "sos", location: "Zone D - Warehouse", lastCheckin: "0s", phone: "+966 55 XXX", safetyScore: 65 },
  { id: "EMP-007", name: "Lina Chen", nameAr: "لينا تشين", role: "Lab Technician", department: "R&D", status: "on-shift", location: "Zone C - Main Hall", lastCheckin: "4m ago", phone: "+966 50 XXX", safetyScore: 91 },
  { id: "EMP-008", name: "Omar Al-Farsi", nameAr: "عمر الفارسي", role: "Site Manager", department: "Operations", status: "on-shift", location: "Zone A - North Gate", lastCheckin: "1m ago", phone: "+966 55 XXX", safetyScore: 97 },
  { id: "EMP-009", name: "Yusuf Bakr", nameAr: "يوسف بكر", role: "Electrician", department: "Maintenance", status: "checked-in", location: "Zone B - Control Room", lastCheckin: "8m ago", phone: "+966 54 XXX", safetyScore: 85 },
  { id: "EMP-010", name: "Aisha Rahman", nameAr: "عائشة رحمن", role: "Fire Marshal", department: "Safety", status: "on-shift", location: "Zone D - Warehouse", lastCheckin: "3m ago", phone: "+966 50 XXX", safetyScore: 99 },
  { id: "EMP-011", name: "Hassan Jaber", nameAr: "حسن جابر", role: "Crane Operator", department: "Operations", status: "on-shift", location: "Zone E - Parking", lastCheckin: "6m ago", phone: "+966 55 XXX", safetyScore: 78 },
  { id: "EMP-012", name: "Maryam Noor", nameAr: "مريم نور", role: "Quality Inspector", department: "Engineering", status: "off-shift", location: "—", lastCheckin: "4h ago", phone: "+966 50 XXX", safetyScore: 92 },
  { id: "EMP-013", name: "Ali Mansour", nameAr: "علي منصور", role: "Welder", department: "Maintenance", status: "on-shift", location: "Zone A - North Gate", lastCheckin: "12m ago", phone: "+966 54 XXX", safetyScore: 70 },
  { id: "EMP-014", name: "Noura Khalid", nameAr: "نورة خالد", role: "Admin Officer", department: "Admin", status: "checked-in", location: "Zone B - Control Room", lastCheckin: "15m ago", phone: "+966 50 XXX", safetyScore: 95 },
  { id: "EMP-015", name: "Tariq Zayed", nameAr: "طارق زايد", role: "Plumber", department: "Maintenance", status: "late-checkin", location: "Zone D - Warehouse", lastCheckin: "45m ago", phone: "+966 55 XXX", safetyScore: 68 },
  { id: "EMP-016", name: "Rania Abbas", nameAr: "رانيا عباس", role: "HSE Manager", department: "Safety", status: "on-shift", location: "Zone C - Main Hall", lastCheckin: "2m ago", phone: "+966 50 XXX", safetyScore: 100 },
  { id: "EMP-017", name: "Faisal Qasim", nameAr: "فيصل قاسم", role: "Driver", department: "Logistics", status: "off-shift", location: "—", lastCheckin: "6h ago", phone: "+966 54 XXX", safetyScore: 82 },
  { id: "EMP-018", name: "Salma Idris", nameAr: "سلمى إدريس", role: "Nurse", department: "Medical", status: "on-shift", location: "Zone B - Control Room", lastCheckin: "1m ago", phone: "+966 50 XXX", safetyScore: 96 },
];

// ── Mock Emergencies ───────────────────────────────────────────
/*
  SUPABASE_MIGRATION_POINT: emergencies
  Replace with:
  const { data } = await supabase
    .from('emergencies')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
*/
export const EMERGENCIES: EmergencyItem[] = [
  { id: "EMG-7A3F", severity: "critical", employeeName: "Mohammed Ali", zone: "Zone D - Warehouse", type: "SOS Button", timestamp: new Date(), status: "active", elapsed: 0 },
  { id: "EMG-5B2E", severity: "high", employeeName: "Khalid Omar", zone: "Zone A - East", type: "Missed Check-in", timestamp: new Date(Date.now() - 120000), status: "responding", elapsed: 120 },
  { id: "EMG-9C1D", severity: "medium", employeeName: "Unknown", zone: "Zone B - South", type: "Geofence Breach", timestamp: new Date(Date.now() - 300000), status: "active", elapsed: 300 },
];

// ── Mock Zones ─────────────────────────────────────────────────
/*
  SUPABASE_MIGRATION_POINT: zones
  Replace with:
  const { data } = await supabase
    .from('zones')
    .select('*')
    .eq('company_id', companyId)
*/
export const ZONES: ZoneData[] = [
  { id: "Z-A", name: "Zone A - North Gate", risk: "medium", employees: 12, activeAlerts: 1, status: "active" },
  { id: "Z-B", name: "Zone B - Control Room", risk: "low", employees: 8, activeAlerts: 0, status: "active" },
  { id: "Z-C", name: "Zone C - Main Hall", risk: "low", employees: 15, activeAlerts: 0, status: "active" },
  { id: "Z-D", name: "Zone D - Warehouse", risk: "high", employees: 5, activeAlerts: 2, status: "restricted" },
  { id: "Z-E", name: "Zone E - Parking", risk: "low", employees: 3, activeAlerts: 0, status: "active" },
];