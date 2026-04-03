// ═══════════════════════════════════════════════════════════════
// MOBILE AUTH — Lightweight RBAC System for SOSphere Mobile
// Mirrors AuthContext.tsx from web (8 roles, 30+ permissions)
// ═══════════════════════════════════════════════════════════════

export type Role =
  | "super_admin"
  | "company_admin"
  | "safety_manager"
  | "shift_supervisor"
  | "dispatcher"
  | "field_medic"
  | "security_guard"
  | "employee";

export type Permission =
  | "emergency:create"
  | "emergency:view"
  | "emergency:resolve"
  | "emergency:escalate"
  | "emergency:assign"
  | "emergency:broadcast"
  | "emergency:delete"
  | "users:view"
  | "users:create"
  | "users:edit"
  | "users:delete"
  | "users:manage"
  | "zones:view"
  | "zones:create"
  | "zones:edit"
  | "zones:delete"
  | "zones:manage"
  | "attendance:view"
  | "attendance:export"
  | "settings:view"
  | "settings:edit"
  | "audit:view"
  | "billing:view"
  | "billing:manage"
  | "command:create"
  | "command:view"
  | "reports:view"
  | "reports:export";

// ── Role → Permission Matrix ──
const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    "emergency:create", "emergency:view", "emergency:resolve", "emergency:escalate",
    "emergency:assign", "emergency:broadcast", "emergency:delete",
    "users:view", "users:create", "users:edit", "users:delete", "users:manage",
    "zones:view", "zones:create", "zones:edit", "zones:delete", "zones:manage",
    "attendance:view", "attendance:export",
    "settings:view", "settings:edit",
    "audit:view", "billing:view", "billing:manage",
    "command:create", "command:view",
    "reports:view", "reports:export",
  ],
  company_admin: [
    "emergency:create", "emergency:view", "emergency:resolve", "emergency:escalate",
    "emergency:assign", "emergency:broadcast",
    "users:view", "users:create", "users:edit", "users:delete", "users:manage",
    "zones:view", "zones:create", "zones:edit", "zones:delete", "zones:manage",
    "attendance:view", "attendance:export",
    "settings:view", "settings:edit",
    "audit:view", "billing:view", "billing:manage",
    "command:create", "command:view",
    "reports:view", "reports:export",
  ],
  safety_manager: [
    "emergency:create", "emergency:view", "emergency:resolve", "emergency:escalate",
    "emergency:assign", "emergency:broadcast",
    "users:view", "users:edit",
    "zones:view", "zones:edit", "zones:manage",
    "attendance:view", "attendance:export",
    "settings:view",
    "audit:view",
    "command:create", "command:view",
    "reports:view", "reports:export",
  ],
  shift_supervisor: [
    "emergency:create", "emergency:view", "emergency:resolve", "emergency:escalate",
    "emergency:assign",
    "users:view",
    "zones:view",
    "attendance:view",
    "command:view",
    "reports:view",
  ],
  dispatcher: [
    "emergency:view", "emergency:assign", "emergency:broadcast",
    "users:view",
    "zones:view",
    "command:view",
  ],
  field_medic: [
    "emergency:view", "emergency:resolve",
    "users:view",
    "zones:view",
    "attendance:view",
  ],
  security_guard: [
    "emergency:create", "emergency:view",
    "zones:view",
    "attendance:view",
  ],
  employee: [
    "emergency:create", "emergency:view",
    "attendance:view",
  ],
};

// ── Role Display Config ──
export const ROLE_CONFIG: Record<Role, { label: string; labelAr: string; color: string; tier: number }> = {
  super_admin:     { label: "Super Admin",       labelAr: "مدير عام",           color: "#FF2D55", tier: 1 },
  company_admin:   { label: "Company Admin",     labelAr: "مدير الشركة",        color: "#FF9500", tier: 2 },
  safety_manager:  { label: "Safety Manager",    labelAr: "مدير السلامة",       color: "#00C8E0", tier: 3 },
  shift_supervisor:{ label: "Shift Supervisor",  labelAr: "مشرف الوردية",       color: "#34C759", tier: 4 },
  dispatcher:      { label: "Dispatcher",        labelAr: "منسق الإرسال",       color: "#5856D6", tier: 5 },
  field_medic:     { label: "Field Medic",       labelAr: "مسعف ميداني",        color: "#FF3B30", tier: 6 },
  security_guard:  { label: "Security Guard",    labelAr: "حارس أمن",           color: "#8E8E93", tier: 7 },
  employee:        { label: "Employee",          labelAr: "موظف",               color: "#636366", tier: 8 },
};

// ── User Profile ──
export interface MobileUser {
  id: string;
  name: string;
  nameAr: string;
  email: string;
  role: Role;
  avatar?: string;
}

// ── Auth State & Helpers ──
export interface AuthState {
  user: MobileUser;
  permissions: Permission[];
}

export function createAuthState(role: Role): AuthState {
  const users: Record<Role, MobileUser> = {
    super_admin:     { id: "USR-001", name: "James Wilson",  nameAr: "James Wilson",   email: "ahmed@sosphere.com",    role: "super_admin" },
    company_admin:   { id: "USR-002", name: "Admin",    nameAr: "Admin",    email: "",      role: "company_admin" },
    safety_manager:  { id: "USR-003", name: "Laura Chen",  nameAr: "Laura Chen",   email: "sara@company.com",      role: "safety_manager" },
    shift_supervisor:{ id: "USR-004", name: "Khalid Omar",      nameAr: "خالد عمر",       email: "khalid@company.com",    role: "shift_supervisor" },
    dispatcher:      { id: "USR-005", name: "Nasser Al-Said",   nameAr: "ناصر السعيد",    email: "nasser@company.com",    role: "dispatcher" },
    field_medic:     { id: "USR-006", name: "Emma Wilson",    nameAr: "فاطمة حسن",      email: "fatima@company.com",    role: "field_medic" },
    security_guard:  { id: "USR-007", name: "Mohammed Ali",     nameAr: "محمد علي",        email: "mohammed@company.com",  role: "security_guard" },
    employee:        { id: "USR-008", name: "Layla Khoury",     nameAr: "ليلى خوري",       email: "layla@company.com",     role: "employee" },
  };
  return {
    user: users[role],
    permissions: ROLE_PERMISSIONS[role],
  };
}

export function hasPermission(state: AuthState, perm: Permission): boolean {
  return state.permissions.includes(perm);
}

// ── Shortcut helpers matching web API ──
export function canBroadcast(s: AuthState)       { return hasPermission(s, "emergency:broadcast"); }
export function canManageUsers(s: AuthState)     { return hasPermission(s, "users:manage"); }
export function canViewAudit(s: AuthState)       { return hasPermission(s, "audit:view"); }
export function canManageSettings(s: AuthState)  { return hasPermission(s, "settings:edit"); }
export function canAccessBilling(s: AuthState)   { return hasPermission(s, "billing:view"); }
export function canViewEmergencies(s: AuthState) { return hasPermission(s, "emergency:view"); }
export function canManageZones(s: AuthState)     { return hasPermission(s, "zones:manage"); }
export function canCreateCommands(s: AuthState)  { return hasPermission(s, "command:create"); }
export function canExportAttendance(s: AuthState){ return hasPermission(s, "attendance:export"); }
export function canEscalate(s: AuthState)        { return hasPermission(s, "emergency:escalate"); }
export function canAssignResponder(s: AuthState) { return hasPermission(s, "emergency:assign"); }
