import type { Employee, EmergencyItem, ZoneData } from "../dashboard-types";
import { EMPLOYEES, EMERGENCIES, ZONES } from "../dashboard-types";
import { supabase } from "./supabase-client";

// =================================================================
// KPI Data
// =================================================================
export interface KPIData {
  activeEmergencies: number;
  onDutyCount: number;
  totalEmployees: number;
  resolvedToday: number;
  avgResponseTimeSec: number;
  complianceRate: number;
}

export async function fetchKPIs(): Promise<KPIData> {
  const defaults: KPIData = { activeEmergencies: 0, onDutyCount: 0, totalEmployees: 0, resolvedToday: 0, avgResponseTimeSec: 0, complianceRate: 0 };
  if (currentMode === "supabase") {
    try {
      const companyId = await getCompanyId();
      if (!companyId) return defaults;
      const [empRes, activeRes, resolvedRes] = await Promise.all([
        supabase.from("employees").select("id, status").eq("company_id", companyId),
        supabase.from("sos_queue").select("id").eq("company_id", companyId).eq("status", "active"),
        supabase.from("sos_queue").select("id").eq("company_id", companyId).eq("status", "resolved").gte("resolved_at", new Date(new Date().setHours(0,0,0,0)).toISOString()),
      ]);
      const employees = empRes.data ?? [];
      return {
        activeEmergencies: activeRes.data?.length ?? 0,
        onDutyCount: employees.filter((e: any) => e.status === "on_duty").length,
        totalEmployees: employees.length,
        resolvedToday: resolvedRes.data?.length ?? 0,
        avgResponseTimeSec: 0,
        complianceRate: employees.length > 0 ? Math.round((employees.filter((e: any) => e.status !== "unknown").length / employees.length) * 100) : 0,
      };
    } catch (e) {
      console.warn("[data-layer] fetchKPIs fallback:", e);
      return defaults;
    }
  }
  return defaults;
}

// =================================================================
// Configuration
// =================================================================
export type DataMode = "mock" | "supabase";
let currentMode: DataMode = "supabase";
export function setDataMode(mode: DataMode) { currentMode = mode; }
export function getDataMode(): DataMode { return currentMode; }

// Helper: get current company ID � reads from JWT claims (fast, no DB round-trip)
async function getCompanyId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  try {
    // Primary: read company_id injected by custom_access_token_hook
    const payload = JSON.parse(atob(session.access_token.split(".")[1]));
    if (payload.company_id) return payload.company_id as string;
  } catch {
    // JWT decode failed � fall back to DB
  }
  // Fallback: DB lookup (first login before hook fires, or hook not configured)
  const { data } = await supabase
    .from("companies")
    .select("id")
    .eq("owner_id", session.user.id)
    .maybeSingle();
  if (data) return data.id;
  const { data: emp } = await supabase
    .from("employees")
    .select("company_id")
    .eq("user_id", session.user.id)
    .maybeSingle();
  return emp?.company_id ?? null;
}

// =================================================================
// Employees � from invitations table
// =================================================================
export async function fetchEmployees(): Promise<Employee[]> {
  if (currentMode === "supabase") {
    try {
      const companyId = await getCompanyId();
      if (!companyId) return [];
      // JOIN employees (relationship/status) with profiles (personal data)
      const { data, error } = await supabase
        .from("employees")
        .select("*, profiles!user_id(full_name, email, user_type)")
        .eq("company_id", companyId);
      if (error || !data || data.length === 0) return [];
      return data.map((emp: any): Employee => {
        const profile = emp.profiles ?? {};
        return {
          id: emp.id,
          name: profile.full_name || "Unknown",
          nameAr: profile.full_name || "??? ?????",
          role: emp.role || profile.user_type || "employee",
          department: "General",
          status: emp.status === "on_duty" ? "on-shift" : "off-shift",
          location: emp.last_lat && emp.last_lon
            ? `${Number(emp.last_lat).toFixed(4)}, ${Number(emp.last_lon).toFixed(4)}`
            : "Unassigned",
          lastCheckin: emp.last_seen_at || emp.created_at || new Date().toISOString(),
          phone: profile.email || "",
          safetyScore: emp.verified ? 90 : 70,
        };
      });
    } catch (e) {
      console.warn("[data-layer] fetchEmployees fallback to mock:", e);
      return [];
    }
  }
  await simulateDelay(100);
  return [];
}

export async function fetchEmployeeById(id: string): Promise<Employee | null> {
  const employees = await fetchEmployees();
  return employees.find(e => e.id === id) || null;
}

export async function updateEmployee(id: string, updates: Partial<Employee>): Promise<Employee> {
  if (currentMode === "supabase") {
    // Update employees table (status, role)
    const empUpdates: Record<string, unknown> = {};
    if (updates.status) empUpdates.status = updates.status === "on-shift" ? "on_duty" : "off_duty";
    if (updates.role)   empUpdates.role   = updates.role;
    if (Object.keys(empUpdates).length > 0) {
      await supabase.from("employees").update(empUpdates).eq("id", id);
    }
    // Update profiles table (name) � need user_id from employees row first
    if (updates.name) {
      const { data: empRow } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", id)
        .single();
      if (empRow?.user_id) {
        await supabase
          .from("profiles")
          .update({ full_name: updates.name })
          .eq("id", empRow.user_id);
      }
    }
    return { ...updates, id } as Employee;
  }
  await simulateDelay(100);
  const emp = EMPLOYEES.find(e => e.id === id);
  if (!emp) throw new Error("Employee not found");
  return { ...emp, ...updates };
}

// =================================================================
// Emergencies � from sos_queue table (fallback to mock)
// =================================================================
export async function fetchEmergencies(): Promise<EmergencyItem[]> {
  if (currentMode === "supabase") {
    try {
      const companyId = await getCompanyId();
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("sos_queue")
        .select("*")
        .order("recorded_at", { ascending: false })
        .limit(50);
      if (error || !data || data.length === 0) return [];

      // Map sos_queue severity field ? EmergencyItem severity
      const mapSeverity = (s?: string): EmergencyItem["severity"] => {
        if (s === "high")   return "high";
        if (s === "medium") return "medium";
        if (s === "low")    return "low";
        return "critical"; // SOS events default to critical
      };

      // Map sos_queue type field ? human-readable label
      const mapType = (t?: string): string => {
        const MAP: Record<string, string> = {
          sos:        "SOS Emergency",
          fall:       "Fall Detected",
          shake:      "Shake SOS",
          hazard:     "Hazard Report",
          medical:    "Medical Emergency",
          evacuation: "Evacuation Alert",
        };
        return MAP[t ?? ""] || "SOS Emergency";
      };

      return data.map((sos: any): EmergencyItem => ({
        id: sos.id,
        severity: mapSeverity(sos.severity),
        employeeName: sos.employee_name || "Unknown",
        zone: sos.zone || "Unknown",
        type: mapType(sos.type),
        timestamp: new Date(sos.recorded_at),
        status: sos.status === "resolved" ? "resolved" : "active",
        elapsed: Math.floor((Date.now() - new Date(sos.recorded_at).getTime()) / 1000),
        sourceEmergencyId: sos.emergency_id,
      }));
    } catch (e) {
      console.warn("[data-layer] fetchEmergencies fallback to mock:", e);
      return [];
    }
  }
  await simulateDelay(150);
  return [];
}

// =================================================================
// Zones � from zones table
// =================================================================
export async function fetchZones(): Promise<ZoneData[]> {
  if (currentMode === "supabase") {
    try {
      const companyId = await getCompanyId();
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("zones")
        .select("*")
        .eq("company_id", companyId);
      if (error || !data || data.length === 0) return [];

      // After fetching zones, count employees per zone
      const zoneIds = data.map((z: any) => z.id);
      const { data: empZones } = await supabase
        .from("employees")
        .select("zone_id, status")
        .in("zone_id", zoneIds);

      return data.map((z: any): ZoneData => {
        const zoneEmps = (empZones ?? []).filter((e: any) => e.zone_id === z.id);
        return {
          id: z.id,
          name: z.name,
          risk: z.risk_level || "low",
          employees: zoneEmps.length,
          activeAlerts: 0,
          status: z.is_active ? "active" : "restricted",
        };
      });
    } catch (e) {
      console.warn("[data-layer] fetchZones fallback to mock:", e);
      return [];
    }
  }
  await simulateDelay(80);
  return [];
}

// =================================================================
// Audit Logs
// =================================================================
export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  target?: string;
  timestamp: Date;
  details?: string;
}

export async function fetchAuditLog(limit = 50): Promise<AuditLogEntry[]> {
  if (currentMode === "supabase") {
    try {
      const companyId = await getCompanyId();
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("audit_log")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return data.map((row: any): AuditLogEntry => ({
        id: row.id,
        action: row.action || "unknown",
        actor: row.actor_name || row.actor_id || "System",
        target: row.target_name,
        timestamp: new Date(row.created_at),
        details: row.details,
      }));
    } catch (e) {
      console.warn("[data-layer] fetchAuditLog fallback:", e);
      return [];
    }
  }
  return [];
}

// =================================================================
// Incident Reports
// =================================================================
export interface IncidentReport {
  id: string;
  employeeName: string;
  zone: string;
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "open" | "investigating" | "resolved";
  timestamp: Date;
  description?: string;
}

export async function fetchIncidentReports(limit = 50): Promise<IncidentReport[]> {
  if (currentMode === "supabase") {
    try {
      const companyId = await getCompanyId();
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("sos_queue")
        .select("*")
        .eq("company_id", companyId)
        .order("recorded_at", { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      const sevMap: Record<string, IncidentReport["severity"]> = { critical: "critical", high: "high", medium: "medium", low: "low" };
      return data.map((row: any): IncidentReport => ({
        id: row.id,
        employeeName: row.employee_name || "Unknown",
        zone: row.zone || "Unknown",
        type: row.type || "SOS",
        severity: sevMap[row.severity] ?? "critical",
        status: row.status === "resolved" ? "resolved" : row.status === "investigating" ? "investigating" : "open",
        timestamp: new Date(row.recorded_at),
        description: row.notes,
      }));
    } catch (e) {
      console.warn("[data-layer] fetchIncidentReports fallback:", e);
      return [];
    }
  }
  return [];
}

// =================================================================
// Emergency Operations
// =================================================================
export async function resolveEmergency(emergencyId: string, resolvedBy?: string): Promise<boolean> {
  if (currentMode === "supabase") {
    try {
      const { error } = await supabase
        .from("sos_queue")
        .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: resolvedBy })
        .eq("id", emergencyId);
      return !error;
    } catch { return false; }
  }
  return true;
}

export async function dispatchTeam(emergencyId: string, responders: string[], note?: string): Promise<boolean> {
  if (currentMode === "supabase") {
    try {
      const { error } = await supabase
        .from("sos_queue")
        .update({
          status: "investigating",
          assigned_to: responders,
          dispatch_note: note,
          dispatched_at: new Date().toISOString(),
        })
        .eq("id", emergencyId);
      return !error;
    } catch { return false; }
  }
  return true;
}

// =================================================================
// Helpers
// =================================================================
function simulateDelay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class DataLayerError extends Error {
  constructor(public entity: string, public operation: string, public detail: string) {
    super(`[DataLayer] ${entity}.${operation} failed: ${detail}`);
  }
}





