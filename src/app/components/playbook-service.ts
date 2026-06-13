// ═══════════════════════════════════════════════════════════════
// SOSphere — Company Playbook Service
// ─────────────────────────────────────────────────────────────
// Durable per-company emergency-response playbook DEFINITIONS, backed by
// the public.company_playbooks table (RLS: company members read; owner /
// admin write). Usage counts stay in playbook_usage (see
// playbook-usage-service.ts) — this module only handles definitions so
// that Create / Edit / Duplicate persist across reloads and devices.
//
// Icons are stored as STRING NAMES (icon_name / steps[].iconName). The UI
// maps names back to Lucide components at render time. This keeps React
// component references out of the database.
// ═══════════════════════════════════════════════════════════════

import { supabase } from "./api/supabase-client";
import { getCompanyId } from "./shared-store";

export interface PlaybookStepDTO {
  id: string;
  action: string;
  responsible: string;
  timeLimit: string;
  iconName: string;
  color: string;
}

export interface CompanyPlaybook {
  id: string;
  companyId: string;
  templateKey: string | null;
  name: string;
  description: string;
  triggerType: string;
  severity: "critical" | "high" | "medium" | "low";
  autoTrigger: boolean;
  iconName: string;
  iconColor: string;
  steps: PlaybookStepDTO[];
  isDefault: boolean;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// ── Default protocol library (seeded once per company) ────────────────
// Single source of truth for the built-in playbooks. Serialized form
// (icon NAMES) so it can be written straight to the DB. Mirrors the
// professionally-authored protocols the product ships with.
export const DEFAULT_PLAYBOOK_TEMPLATES: Array<Omit<CompanyPlaybook, "id" | "companyId">> = [
  {
    templateKey: "sos_button", name: "SOS Button Response",
    description: "Standard response when an employee presses the SOS button",
    triggerType: "SOS Button", severity: "critical", autoTrigger: true,
    iconName: "AlertTriangle", iconColor: "#FF2D55", isDefault: true, sortOrder: 1,
    steps: [
      { id: "S1", action: "Attempt phone call to employee", responsible: "Zone Admin", timeLimit: "< 30 sec", iconName: "Phone", color: "#00C853" },
      { id: "S2", action: "Send emergency chat message", responsible: "Zone Admin", timeLimit: "< 30 sec", iconName: "MessageCircle", color: "#00C8E0" },
      { id: "S3", action: "Dispatch nearest buddy/team member", responsible: "Zone Admin", timeLimit: "< 1 min", iconName: "Navigation", color: "#FF9500" },
      { id: "S4", action: "Check GPS location on map", responsible: "Zone Admin", timeLimit: "< 1 min", iconName: "MapPin", color: "#00C8E0" },
      { id: "S5", action: "If no answer: Call 911", responsible: "Main Admin", timeLimit: "< 3 min", iconName: "Ambulance", color: "#FF2D55" },
      { id: "S6", action: "Share Medical ID with responders", responsible: "Zone Admin", timeLimit: "< 3 min", iconName: "Heart", color: "#FF9500" },
      { id: "S7", action: "Notify company owner", responsible: "Main Admin", timeLimit: "< 5 min", iconName: "Users", color: "#8B5CF6" },
      { id: "S8", action: "Document incident with photos/audio", responsible: "Employee / Buddy", timeLimit: "< 10 min", iconName: "Eye", color: "#00C8E0" },
    ],
  },
  {
    templateKey: "fall_detection", name: "Fall Detection Response",
    description: "Auto-triggered when accelerometer detects a fall",
    triggerType: "Fall Detected", severity: "critical", autoTrigger: true,
    iconName: "Activity", iconColor: "#FF9500", isDefault: true, sortOrder: 2,
    steps: [
      { id: "S1", action: "Wait for 15-sec countdown (auto-cancel if false alarm)", responsible: "System", timeLimit: "15 sec", iconName: "Clock", color: "#FF9500" },
      { id: "S2", action: "Call employee immediately", responsible: "Zone Admin", timeLimit: "< 30 sec", iconName: "Phone", color: "#00C853" },
      { id: "S3", action: "Alert buddy system partner", responsible: "System", timeLimit: "Auto", iconName: "Users", color: "#00C8E0" },
      { id: "S4", action: "If unconscious: Dispatch first-aid team", responsible: "Zone Admin", timeLimit: "< 1 min", iconName: "Heart", color: "#FF2D55" },
      { id: "S5", action: "Call ambulance if unresponsive", responsible: "Main Admin", timeLimit: "< 2 min", iconName: "Ambulance", color: "#FF2D55" },
      { id: "S6", action: "Secure area around fallen employee", responsible: "Security", timeLimit: "< 3 min", iconName: "Shield", color: "#FF9500" },
    ],
  },
  {
    templateKey: "fire_gas", name: "Fire / Gas Leak Protocol",
    description: "Environmental hazard requiring immediate evacuation",
    triggerType: "Environmental Hazard", severity: "critical", autoTrigger: false,
    iconName: "Flame", iconColor: "#FF2D55", isDefault: true, sortOrder: 3,
    steps: [
      { id: "S1", action: "Trigger zone evacuation immediately", responsible: "Zone Admin", timeLimit: "IMMEDIATE", iconName: "Megaphone", color: "#FF2D55" },
      { id: "S2", action: "Call fire department / hazmat", responsible: "Main Admin", timeLimit: "< 30 sec", iconName: "Phone", color: "#FF2D55" },
      { id: "S3", action: "Shut down zone utilities (gas, power)", responsible: "Facilities", timeLimit: "< 1 min", iconName: "Zap", color: "#FF9500" },
      { id: "S4", action: "Monitor assembly point head count", responsible: "Zone Admin", timeLimit: "< 5 min", iconName: "Users", color: "#00C8E0" },
      { id: "S5", action: "Search for missing employees", responsible: "Security Team", timeLimit: "< 5 min", iconName: "Navigation", color: "#FF9500" },
      { id: "S6", action: "Block zone access perimeter", responsible: "Security", timeLimit: "< 3 min", iconName: "Lock", color: "#FF2D55" },
      { id: "S7", action: "Notify all zone admins company-wide", responsible: "Main Admin", timeLimit: "< 5 min", iconName: "Radio", color: "#8B5CF6" },
    ],
  },
  {
    templateKey: "security_threat", name: "Security Threat Response",
    description: "Hostile person, assault, or security breach",
    triggerType: "Security Threat", severity: "high", autoTrigger: false,
    iconName: "Shield", iconColor: "#FF9500", isDefault: true, sortOrder: 4,
    steps: [
      { id: "S1", action: "Verify threat via camera or witnesses", responsible: "Security", timeLimit: "< 1 min", iconName: "Eye", color: "#00C8E0" },
      { id: "S2", action: "Silent alert to nearby workers", responsible: "Zone Admin", timeLimit: "< 1 min", iconName: "MessageCircle", color: "#00C8E0" },
      { id: "S3", action: "Dispatch security team", responsible: "Main Admin", timeLimit: "< 2 min", iconName: "Shield", color: "#FF9500" },
      { id: "S4", action: "Contact police if needed", responsible: "Main Admin", timeLimit: "< 3 min", iconName: "Phone", color: "#FF2D55" },
      { id: "S5", action: "Lock down affected zone", responsible: "Zone Admin", timeLimit: "< 3 min", iconName: "Lock", color: "#FF2D55" },
      { id: "S6", action: "Account for all employees in zone", responsible: "Zone Admin", timeLimit: "< 10 min", iconName: "Users", color: "#00C853" },
    ],
  },
  {
    templateKey: "missed_checkin", name: "Missed Check-in Escalation",
    description: "Employee hasn't checked in within the scheduled window",
    triggerType: "Missed Check-in", severity: "medium", autoTrigger: true,
    iconName: "Clock", iconColor: "#FF9500", isDefault: true, sortOrder: 5,
    steps: [
      { id: "S1", action: "Send push notification reminder", responsible: "System", timeLimit: "Auto", iconName: "MessageCircle", color: "#00C8E0" },
      { id: "S2", action: "Wait 5 minutes for response", responsible: "System", timeLimit: "5 min", iconName: "Clock", color: "#FF9500" },
      { id: "S3", action: "Call employee directly", responsible: "Zone Admin", timeLimit: "< 6 min", iconName: "Phone", color: "#00C853" },
      { id: "S4", action: "Contact buddy partner", responsible: "Zone Admin", timeLimit: "< 8 min", iconName: "Users", color: "#00C8E0" },
      { id: "S5", action: "If still unresponsive: Dispatch help", responsible: "Zone Admin", timeLimit: "< 10 min", iconName: "Navigation", color: "#FF9500" },
    ],
  },
];

function rowToPlaybook(r: any): CompanyPlaybook {
  return {
    id: r.id,
    companyId: r.company_id,
    templateKey: r.template_key ?? null,
    name: r.name,
    description: r.description ?? "",
    triggerType: r.trigger_type ?? "Manual Trigger",
    severity: (r.severity ?? "high") as CompanyPlaybook["severity"],
    autoTrigger: !!r.auto_trigger,
    iconName: r.icon_name ?? "Shield",
    iconColor: r.icon_color ?? "#FF9500",
    steps: Array.isArray(r.steps) ? (r.steps as PlaybookStepDTO[]) : [],
    isDefault: !!r.is_default,
    sortOrder: typeof r.sort_order === "number" ? r.sort_order : 0,
    createdAt: r.created_at ? new Date(r.created_at) : undefined,
    updatedAt: r.updated_at ? new Date(r.updated_at) : undefined,
  };
}

/** Fetch this company's playbook definitions, ordered. */
export async function fetchCompanyPlaybooks(): Promise<CompanyPlaybook[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { data, error } = await supabase
      .from("company_playbooks")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as any[]).map(rowToPlaybook);
  } catch (err) {
    console.warn("[playbook-service] fetch:", err);
    return [];
  }
}

/**
 * Seed the built-in default library for a company that has none. Idempotent:
 * the (company_id, template_key) unique index + ignoreDuplicates means
 * repeated calls never create duplicates. Returns the full, post-seed list.
 */
export async function seedDefaultPlaybooks(): Promise<CompanyPlaybook[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    let createdBy: string | null = null;
    try { createdBy = (await supabase.auth.getUser()).data.user?.id ?? null; } catch { /* anon */ }
    const rows = DEFAULT_PLAYBOOK_TEMPLATES.map(t => ({
      company_id: companyId,
      template_key: t.templateKey,
      name: t.name,
      description: t.description,
      trigger_type: t.triggerType,
      severity: t.severity,
      auto_trigger: t.autoTrigger,
      icon_name: t.iconName,
      icon_color: t.iconColor,
      steps: t.steps,
      is_default: true,
      sort_order: t.sortOrder,
      created_by: createdBy,
    }));
    const { error } = await supabase
      .from("company_playbooks")
      .upsert(rows, { onConflict: "company_id,template_key", ignoreDuplicates: true });
    if (error) console.warn("[playbook-service] seed:", error.message);
  } catch (err) {
    console.warn("[playbook-service] seed threw:", err);
  }
  return fetchCompanyPlaybooks();
}

/**
 * Insert or update a playbook definition. Pass an existing id to update,
 * omit it to insert. Returns the persisted row id (DB-generated on insert).
 */
export async function saveCompanyPlaybook(
  pb: Partial<CompanyPlaybook> & {
    name: string;
    description: string;
    triggerType: string;
    severity: CompanyPlaybook["severity"];
    autoTrigger: boolean;
    iconName: string;
    iconColor: string;
    steps: PlaybookStepDTO[];
  },
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const companyId = getCompanyId();
  if (!companyId) return { ok: false, error: "no_company" };
  try {
    let createdBy: string | null = null;
    try { createdBy = (await supabase.auth.getUser()).data.user?.id ?? null; } catch { /* anon */ }
    const base: any = {
      company_id: companyId,
      name: pb.name,
      description: pb.description,
      trigger_type: pb.triggerType,
      severity: pb.severity,
      auto_trigger: pb.autoTrigger,
      icon_name: pb.iconName,
      icon_color: pb.iconColor,
      steps: pb.steps,
      is_default: pb.isDefault ?? false,
      sort_order: pb.sortOrder ?? 100,
    };
    if (pb.id) {
      const { error } = await supabase.from("company_playbooks").update(base).eq("id", pb.id).eq("company_id", companyId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, id: pb.id };
    }
    const { data, error } = await supabase
      .from("company_playbooks")
      .insert({ ...base, created_by: createdBy })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: (data as any)?.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Permanently delete a playbook definition (owner/admin only via RLS). */
export async function deleteCompanyPlaybook(id: string): Promise<{ ok: boolean; error?: string }> {
  const companyId = getCompanyId();
  if (!companyId) return { ok: false, error: "no_company" };
  try {
    const { error } = await supabase.from("company_playbooks").delete().eq("id", id).eq("company_id", companyId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ═══════════════════════════════════════════════════════════════
// Playbook Runs — durable compliance log of each protocol execution
// (who ran it, when, which steps were completed). Table: playbook_runs.
// ═══════════════════════════════════════════════════════════════

export interface RunStepLog { stepId: string; action: string; at: string; }

export async function startPlaybookRun(args: {
  playbookId: string; playbookName: string; triggerType: string; severity: string; totalSteps: number;
  runByName?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const companyId = getCompanyId();
  if (!companyId) return { ok: false, error: "no_company" };
  try {
    let uid: string | null = null; let uname = args.runByName || "Admin";
    try { const u = (await supabase.auth.getUser()).data.user; uid = u?.id ?? null; if (!args.runByName) uname = u?.email?.split("@")[0] || "Admin"; } catch { /* anon */ }
    const { data, error } = await supabase.from("playbook_runs").insert({
      company_id: companyId, playbook_id: args.playbookId, playbook_name: args.playbookName,
      trigger_type: args.triggerType, severity: args.severity, run_by: uid, run_by_name: uname,
      status: "running", total_steps: args.totalSteps, completed_steps: [],
    }).select("id").single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: (data as any)?.id };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function updateRunSteps(runId: string, steps: RunStepLog[]): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { error } = await supabase.from("playbook_runs").update({ completed_steps: steps }).eq("id", runId).eq("company_id", companyId);
    return !error;
  } catch { return false; }
}

export async function finishPlaybookRun(runId: string, status: "completed" | "abandoned", steps: RunStepLog[]): Promise<boolean> {
  const companyId = getCompanyId();
  if (!companyId) return false;
  try {
    const { error } = await supabase.from("playbook_runs")
      .update({ status, completed_at: new Date().toISOString(), completed_steps: steps })
      .eq("id", runId).eq("company_id", companyId);
    return !error;
  } catch { return false; }
}

export async function fetchRecentRuns(limit = 20): Promise<any[]> {
  const companyId = getCompanyId();
  if (!companyId) return [];
  try {
    const { data, error } = await supabase.from("playbook_runs").select("*")
      .eq("company_id", companyId).order("started_at", { ascending: false }).limit(limit);
    return error || !data ? [] : (data as any[]);
  } catch { return []; }
}


// ═══════════════════════════════════════════════════════════════
// Layer 3 — Phase 1: auto-activate the matching response playbook when a
// real emergency event fires. SAFE: this ONLY logs a durable activation run
// (compliance) and returns the playbook so the UI can notify the admin.
// It performs NO broadcasts and contacts NO workers — live actions are a
// separate, explicitly-gated Phase 2.
// ═══════════════════════════════════════════════════════════════

// Real emergency sync-event types → playbook triggerType. Only events that
// have a verified source in the codebase are mapped (Security/Geofence have
// no real trigger source yet, so they are intentionally absent).
const EVENT_TO_TRIGGER: Record<string, string> = {
  SOS_TRIGGERED:    "SOS Button",
  FALL_DETECTED:    "Fall Detected",
  HAZARD_REPORT:    "Environmental Hazard",
  MONITORING_MISSED:"Missed Check-in",
};

export function triggerTypeForEvent(eventType: string): string | null {
  return EVENT_TO_TRIGGER[eventType] ?? null;
}

// Guard against double-activation for the same emergency within a session
// (e.g. an event re-delivered on Realtime reconnect).
const _autoActivated = new Set<string>();

export async function autoActivatePlaybook(args: {
  eventType: string;
  emergencyId?: string;
}): Promise<{ activated: boolean; playbookName?: string; runId?: string }> {
  const triggerType = triggerTypeForEvent(args.eventType);
  if (!triggerType) return { activated: false };
  const key = `${args.eventType}:${args.emergencyId ?? "noid"}`;
  if (args.emergencyId && _autoActivated.has(key)) return { activated: false };
  try {
    const list = await fetchCompanyPlaybooks();
    const pb = list.find(p => p.autoTrigger && p.triggerType === triggerType);
    if (!pb) return { activated: false };
    if (args.emergencyId) _autoActivated.add(key);
    const res = await startPlaybookRun({
      playbookId: pb.id, playbookName: pb.name, triggerType: pb.triggerType,
      severity: pb.severity, totalSteps: pb.steps.length, runByName: "System (auto-trigger)",
    });
    return { activated: res.ok, playbookName: pb.name, runId: res.id };
  } catch {
    return { activated: false };
  }
}
