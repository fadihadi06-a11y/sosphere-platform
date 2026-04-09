// ═══════════════════════════════════════════════════════════════
// SOSphere — Roles & Permissions Management Page
// Owner → Main Admin → Zone Admins (up to 2/zone) → Field Workers
// Full custom permissions override per user
// 2FA/PIN required for Owner & Main Admin sensitive operations
// ═══════════════════════════════════════════════════════════════
import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Crown, Shield, ShieldCheck, Users, UserCheck, UserPlus, UserX,
  ChevronRight, Lock, Unlock, Check, X, Search, Filter,
  MapPin, Mail, Phone, Clock, Settings, MoreVertical,
  AlertTriangle, CheckCircle2, Edit2, Trash2, Plus,
  Eye, EyeOff, ArrowRight, Siren, Key, Building2,
  Info, RefreshCw, ChevronDown, ChevronUp, Layers,
  BarChart3, Zap, Globe, Bell, FileText, Hash,
  Fingerprint, ClipboardList,
} from "lucide-react";
import { type Role, ROLE_CONFIG } from "./mobile-auth";
import { PINVerifyModal } from "./pin-verify-modal";
import { saveUserPermissions, getPendingInvitations, sendInvitation } from "./api/permissions-service";
// ── Types ─────────────────────────────────────────────────────
type Level = "owner" | "main_admin" | "zone_admin" | "worker";
type MemberStatus = "active" | "inactive" | "suspended";

interface TeamMember {
  id: string;
  name: string;
  nameAr: string;
  email: string;
  phone: string;
  role: Role;
  level: Level;
  assignedZones: string[];
  status: MemberStatus;
  joinedAt: string;
  hasCustomPermissions: boolean;
  customPermissions?: string[];
  avatarColor: string;
  isOwner?: boolean;
}

interface PendingUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  joinedVia: "invite_link" | "invite_code" | "csv";
  requestedAt: string;
  requestedAgo: string;
}

interface ZoneSlot {
  zoneId: string;
  zoneName: string;
  risk: "high" | "medium" | "low";
  employeeCount: number;
  leadAdminId: string | null;
  secondaryAdminId: string | null;
}

// ── Permission Groups ──────────────────────────────────────────
const PERMISSION_GROUPS = [
  {
    group: "Emergency", icon: Siren, color: "#FF2D55",
    perms: [
      { id: "emergency:create",    label: "Trigger Emergency",  desc: "Can manually create emergencies" },
      { id: "emergency:view",      label: "View Emergencies",   desc: "Can see all emergency alerts" },
      { id: "emergency:resolve",   label: "Resolve Emergency",  desc: "Can mark emergencies as resolved" },
      { id: "emergency:escalate",  label: "Escalate",           desc: "Can escalate to higher level" },
      { id: "emergency:assign",    label: "Assign Responder",   desc: "Can assign team members" },
      { id: "emergency:broadcast", label: "Broadcast Alert",    desc: "Can send mass alerts" },
    ],
  },
  {
    group: "Team Management", icon: Users, color: "#00C8E0",
    perms: [
      { id: "users:view",   label: "View Members",    desc: "Can see all team members" },
      { id: "users:create", label: "Add Members",     desc: "Can invite new members" },
      { id: "users:edit",   label: "Edit Members",    desc: "Can edit member profiles" },
      { id: "users:delete", label: "Remove Members",  desc: "Can remove team members" },
      { id: "users:manage", label: "Manage Roles",    desc: "Can change roles & permissions" },
    ],
  },
  {
    group: "Zones & Location", icon: MapPin, color: "#34C759",
    perms: [
      { id: "zones:view",   label: "View Zones",     desc: "Can see zone details" },
      { id: "zones:create", label: "Create Zones",   desc: "Can add new zones" },
      { id: "zones:edit",   label: "Edit Zones",     desc: "Can modify zone boundaries" },
      { id: "zones:delete", label: "Delete Zones",   desc: "Can remove zones" },
      { id: "zones:manage", label: "Manage Zones",   desc: "Full zone management" },
    ],
  },
  {
    group: "Reports & Analytics", icon: BarChart3, color: "#9B59B6",
    perms: [
      { id: "reports:view",       label: "View Reports",     desc: "Can view all reports" },
      { id: "reports:export",     label: "Export Reports",   desc: "Can download/export data" },
      { id: "attendance:view",    label: "View Attendance",  desc: "Can see attendance records" },
      { id: "attendance:export",  label: "Export Attendance",desc: "Can export attendance data" },
      { id: "audit:view",         label: "View Audit Log",   desc: "Can see activity audit trail" },
    ],
  },
  {
    group: "Settings & Billing", icon: Settings, color: "#FF9500",
    perms: [
      { id: "settings:view",   label: "View Settings",    desc: "Can view system settings" },
      { id: "settings:edit",   label: "Edit Settings",    desc: "Can change system settings" },
      { id: "billing:view",    label: "View Billing",     desc: "Can see billing information" },
      { id: "billing:manage",  label: "Manage Billing",   desc: "Can change billing & plans" },
    ],
  },
];

// Role default permissions
const ROLE_DEFAULTS: Record<Role, string[]> = {
  super_admin: ["emergency:create","emergency:view","emergency:resolve","emergency:escalate","emergency:assign","emergency:broadcast","users:view","users:create","users:edit","users:delete","users:manage","zones:view","zones:create","zones:edit","zones:delete","zones:manage","attendance:view","attendance:export","settings:view","settings:edit","audit:view","billing:view","billing:manage","reports:view","reports:export"],
  company_admin: ["emergency:create","emergency:view","emergency:resolve","emergency:escalate","emergency:assign","emergency:broadcast","users:view","users:create","users:edit","users:delete","users:manage","zones:view","zones:create","zones:edit","zones:delete","zones:manage","attendance:view","attendance:export","settings:view","settings:edit","audit:view","billing:view","billing:manage","reports:view","reports:export"],
  safety_manager: ["emergency:create","emergency:view","emergency:resolve","emergency:escalate","emergency:assign","emergency:broadcast","users:view","users:edit","zones:view","zones:edit","zones:manage","attendance:view","attendance:export","settings:view","audit:view","reports:view","reports:export"],
  shift_supervisor: ["emergency:create","emergency:view","emergency:resolve","emergency:escalate","emergency:assign","users:view","zones:view","attendance:view","reports:view"],
  dispatcher: ["emergency:view","emergency:assign","emergency:broadcast","users:view","zones:view"],
  field_medic: ["emergency:view","emergency:resolve","users:view","zones:view","attendance:view"],
  security_guard: ["emergency:create","emergency:view","zones:view","attendance:view"],
  employee: ["emergency:create","emergency:view","attendance:view"],
};

// ── Mock Data ─────────────────────────────────────────────────
const INITIAL_MEMBERS: TeamMember[] = [
  { id: "USR-001", name: "James Wilson", nameAr: "أحمد الراشد", email: "j.wilson@acmeindustries.com", phone: "+1 555 100 0001", role: "company_admin", level: "owner", assignedZones: [], status: "active", joinedAt: "Jan 15, 2025", hasCustomPermissions: false, avatarColor: "#FF2D55", isOwner: true },
  { id: "USR-002", name: "Carlos Silva", nameAr: "عمر الفارسي", email: "c.silva@buildco.com", phone: "+1 555 100 0002", role: "company_admin", level: "main_admin", assignedZones: [], status: "active", joinedAt: "Jan 20, 2025", hasCustomPermissions: false, avatarColor: "#FF9500" },
  { id: "USR-003", name: "Khalid Omar", nameAr: "خالد عمر", email: "k.omar@safetypro.com", phone: "+1 555 100 0003", role: "shift_supervisor", level: "zone_admin", assignedZones: ["Z-A"], status: "active", joinedAt: "Feb 1, 2025", hasCustomPermissions: false, avatarColor: "#00C8E0" },
  { id: "USR-004", name: "Fatima Hassan", nameAr: "فاطمة حسن", email: "e.wilson@safetypro.com", phone: "+1 555 100 0004", role: "shift_supervisor", level: "zone_admin", assignedZones: ["Z-A"], status: "active", joinedAt: "Feb 1, 2025", hasCustomPermissions: false, avatarColor: "#34C759" },
  { id: "USR-005", name: "Mohammed Ali", nameAr: "محمد علي", email: "m.ali@safetypro.com", phone: "+1 555 100 0005", role: "shift_supervisor", level: "zone_admin", assignedZones: ["Z-B"], status: "active", joinedAt: "Feb 5, 2025", hasCustomPermissions: false, avatarColor: "#9B59B6" },
  { id: "USR-006", name: "Sara Al-Mutairi", nameAr: "سارة المطيري", email: "sara@safetypro.com", phone: "+1 555 100 0006", role: "safety_manager", level: "zone_admin", assignedZones: ["Z-C"], status: "active", joinedAt: "Feb 10, 2025", hasCustomPermissions: true, customPermissions: ["emergency:create","emergency:view","emergency:resolve","emergency:escalate","emergency:assign","emergency:broadcast","users:view","zones:view","zones:edit","zones:manage","attendance:view","attendance:export","reports:view","reports:export","audit:view"], avatarColor: "#E67E22" },
  { id: "USR-007", name: "Nasser Al-Said", nameAr: "ناصر السعيد", email: "n.said@safetypro.com", phone: "+1 555 100 0007", role: "employee", level: "worker", assignedZones: ["Z-A"], status: "active", joinedAt: "Feb 15, 2025", hasCustomPermissions: false, avatarColor: "#3498DB" },
  { id: "USR-008", name: "Lina Chen", nameAr: "لينا تشين", email: "l.chen@safetypro.com", phone: "+1 555 100 0008", role: "field_medic", level: "worker", assignedZones: ["Z-C"], status: "active", joinedAt: "Feb 18, 2025", hasCustomPermissions: false, avatarColor: "#1ABC9C" },
  { id: "USR-009", name: "Yusuf Bakr", nameAr: "يوسف بكر", email: "y.bakr@safetypro.com", phone: "+1 555 100 0009", role: "security_guard", level: "worker", assignedZones: ["Z-D"], status: "inactive", joinedAt: "Mar 1, 2025", hasCustomPermissions: false, avatarColor: "#E74C3C" },
  { id: "USR-010", name: "Aisha Rahman", nameAr: "عائشة رحمن", email: "a.rahman@safetypro.com", phone: "+1 555 100 0010", role: "employee", level: "worker", assignedZones: ["Z-B"], status: "active", joinedAt: "Mar 5, 2025", hasCustomPermissions: false, avatarColor: "#F39C12" },
];

const INITIAL_PENDING: PendingUser[] = [
  { id: "PND-001", name: "Hassan Jaber", email: "h.jaber@safetypro.com", phone: "+1 555 200 0001", joinedVia: "invite_link", requestedAt: "Mar 9, 2025", requestedAgo: "18 hours ago" },
  { id: "PND-002", name: "Maryam Noor", email: "m.noor@safetypro.com", phone: "+1 555 200 0002", joinedVia: "invite_code", requestedAt: "Mar 10, 2025", requestedAgo: "2 hours ago" },
  { id: "PND-003", name: "Tariq Zayed", email: "tariq@safetypro.com", phone: "+1 555 200 0003", joinedVia: "csv", requestedAt: "Mar 10, 2025", requestedAgo: "45 minutes ago" },
];

const INITIAL_ZONES: ZoneSlot[] = [
  { zoneId: "Z-A", zoneName: "Zone A — North Gate", risk: "medium", employeeCount: 12, leadAdminId: "USR-003", secondaryAdminId: "USR-004" },
  { zoneId: "Z-B", zoneName: "Zone B — Control Room", risk: "low", employeeCount: 8, leadAdminId: "USR-005", secondaryAdminId: null },
  { zoneId: "Z-C", zoneName: "Zone C — Main Hall", risk: "low", employeeCount: 15, leadAdminId: "USR-006", secondaryAdminId: null },
  { zoneId: "Z-D", zoneName: "Zone D — Warehouse", risk: "high", employeeCount: 5, leadAdminId: null, secondaryAdminId: null },
  { zoneId: "Z-E", zoneName: "Zone E — Parking", risk: "low", employeeCount: 3, leadAdminId: null, secondaryAdminId: null },
];

// ── Helpers ───────────────────────────────────────────────────
const LEVEL_CONFIG: Record<Level, { label: string; icon: React.ElementType; color: string; bg: string; desc: string; limit: string }> = {
  owner:      { label: "Owner",       icon: Crown,       color: "#FF2D55", bg: "rgba(255,45,85,0.12)",  desc: "Full system access, cannot be removed", limit: "1 per company" },
  main_admin: { label: "Main Admin",  icon: Key,         color: "#FF9500", bg: "rgba(255,150,0,0.1)",   desc: "Company-wide admin, manages zone admins", limit: "1 per company" },
  zone_admin: { label: "Zone Admin",  icon: ShieldCheck, color: "#00C8E0", bg: "rgba(0,200,224,0.1)",   desc: "Manages assigned zones (Lead + Secondary)", limit: "Up to 2 per zone" },
  worker:     { label: "Field Worker",icon: UserCheck,   color: "#34C759", bg: "rgba(52,199,89,0.08)",  desc: "Field employees and operational staff", limit: "Unlimited" },
};

const ROLE_LEVEL: Record<Role, Level> = {
  super_admin: "owner", company_admin: "owner", safety_manager: "zone_admin",
  shift_supervisor: "zone_admin", dispatcher: "zone_admin",
  field_medic: "worker", security_guard: "worker", employee: "worker",
};

const RISK_COLOR: Record<string, string> = { high: "#FF2D55", medium: "#FF9500", low: "#34C759" };
const STATUS_COLOR: Record<MemberStatus, string> = { active: "#34C759", inactive: "rgba(255,255,255,0.2)", suspended: "#FF2D55" };

function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  const initials = name.split(" ").slice(0, 2).map(n => n[0]).join("").toUpperCase();
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.3, background: `linear-gradient(135deg, ${color}, ${color}88)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ fontSize: size * 0.33, fontWeight: 700, color: "#fff" }}>{initials}</span>
    </div>
  );
}

// ── Props ──────────────────────────────────────────────────────
interface RolesPermissionsPageProps {
  t: (k: string) => string;
  webMode?: boolean;
  onNavigate?: (page: string) => void;
}

// ═══════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════
export function RolesPermissionsPage({ t, webMode = false, onNavigate }: RolesPermissionsPageProps) {
  const [activeTab, setActiveTab] = useState<"members" | "pending" | "zones" | "permissions">("members");
  const [members, setMembers] = useState<TeamMember[]>(INITIAL_MEMBERS);
  const [pending, setPending] = useState<PendingUser[]>(INITIAL_PENDING);
  const [zones, setZones] = useState<ZoneSlot[]>(INITIAL_ZONES);
  const [search, setSearch] = useState("");
  const [filterLevel, setFilterLevel] = useState<Level | "all">("all");
  const [selectedMemberForPerms, setSelectedMemberForPerms] = useState<TeamMember | null>(null);
  const [editingPerms, setEditingPerms] = useState<string[]>([]);
  const [pendingRole, setPendingRole] = useState<Record<string, Role>>({});
  const [pendingZone, setPendingZone] = useState<Record<string, string>>({});
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRoleEditor, setShowRoleEditor] = useState<TeamMember | null>(null);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [assigningSlot, setAssigningSlot] = useState<{ zoneId: string; slot: "lead" | "secondary" } | null>(null);
  const [savedPerms, setSavedPerms] = useState(false);

  // ── 2FA/PIN State ──────────────────────────────────────────────
  const [pinModal, setPinModal] = useState<{
    open: boolean;
    operationType: "change_permissions" | "change_role" | "assign_zone_admin" | "revoke_access" | "suspend_user";
    targetName?: string;
    onSuccess: () => void;
  }>({ open: false, operationType: "change_permissions", onSuccess: () => {} });

  // ── Audit Toast ────────────────────────────────────────────────
  const [auditToast, setAuditToast] = useState<{ msg: string; visible: boolean }>({ msg: "", visible: false });

  function showAudit(msg: string) {
    setAuditToast({ msg, visible: true });
    setTimeout(() => setAuditToast(prev => ({ ...prev, visible: false })), 3500);
  }

  // Current actor (Owner in this prototype)
  const currentActor = members.find(m => m.isOwner) || members[0];
  const actorLevel: "owner" | "main_admin" | null =
    currentActor?.level === "owner" ? "owner"
    : currentActor?.level === "main_admin" ? "main_admin"
    : null;

  function requirePIN(
    operationType: "change_permissions" | "change_role" | "assign_zone_admin" | "revoke_access" | "suspend_user",
    targetName: string,
    onSuccess: () => void
  ) {
    if (actorLevel === "owner" || actorLevel === "main_admin") {
      setPinModal({ open: true, operationType, targetName, onSuccess });
    } else {
      onSuccess();
    }
  }

  // Derived
  const filteredMembers = useMemo(() => members.filter(m => {
    const matchSearch = search === "" || m.name.toLowerCase().includes(search.toLowerCase()) || m.email.toLowerCase().includes(search.toLowerCase());
    const matchLevel = filterLevel === "all" || m.level === filterLevel;
    return matchSearch && matchLevel;
  }), [members, search, filterLevel]);

  const levelCounts = useMemo(() => ({
    owner: members.filter(m => m.level === "owner").length,
    main_admin: members.filter(m => m.level === "main_admin").length,
    zone_admin: members.filter(m => m.level === "zone_admin").length,
    worker: members.filter(m => m.level === "worker").length,
  }), [members]);

  const zoneAdmins = members.filter(m => m.level === "zone_admin");
  const eligibleForZoneAdmin = members.filter(m => m.level === "zone_admin" || m.level === "worker");

  function handleOpenPermissions(member: TeamMember) {
    setSelectedMemberForPerms(member);
    setEditingPerms(member.hasCustomPermissions && member.customPermissions
      ? [...member.customPermissions]
      : [...ROLE_DEFAULTS[member.role]]);
    setActiveTab("permissions");
    setSavedPerms(false);
  }

  function handleTogglePerm(permId: string) {
    setEditingPerms(prev => prev.includes(permId) ? prev.filter(p => p !== permId) : [...prev, permId]);
    setSavedPerms(false);
  }

  function handleSavePerms() {
    if (!selectedMemberForPerms) return;
    requirePIN("change_permissions", selectedMemberForPerms.name, () => {
      setMembers(prev => prev.map(m =>
        m.id === selectedMemberForPerms.id
          ? { ...m, hasCustomPermissions: true, customPermissions: editingPerms }
          : m
      ));
      setSavedPerms(true);
      showAudit(`✓ Permissions saved for ${selectedMemberForPerms.name} — logged to Audit`);
    });
  }

  function handleResetPerms() {
    if (!selectedMemberForPerms) return;
    const defaults = [...ROLE_DEFAULTS[selectedMemberForPerms.role]];
    setEditingPerms(defaults);
    setMembers(prev => prev.map(m =>
      m.id === selectedMemberForPerms.id
        ? { ...m, hasCustomPermissions: false, customPermissions: undefined }
        : m
    ));
    setSavedPerms(false);
    showAudit(`↩ Permissions reset to defaults for ${selectedMemberForPerms.name}`);
  }

  function handleApprovePending(p: PendingUser) {
    const role = pendingRole[p.id] || "employee";
    const newMember: TeamMember = {
      id: `USR-${Date.now().toString().slice(-4)}`,
      name: p.name, nameAr: p.name, email: p.email, phone: p.phone,
      role, level: ROLE_LEVEL[role],
      assignedZones: pendingZone[p.id] ? [pendingZone[p.id]] : [],
      status: "active", joinedAt: "Mar 10, 2025",
      hasCustomPermissions: false,
      avatarColor: ["#00C8E0","#FF9500","#34C759","#9B59B6"][Math.floor(Math.random()*4)],
    };
    setMembers(prev => [...prev, newMember]);
    setPending(prev => prev.filter(x => x.id !== p.id));
    showAudit(`✓ ${p.name} approved — added as ${ROLE_LEVEL[role]}`);
  }

  function handleRejectPending(id: string) {
    const p = pending.find(x => x.id === id);
    setPending(prev => prev.filter(x => x.id !== id));
    if (p) showAudit(`✗ ${p.name} request rejected`);
  }

  function handleAssignZoneAdmin(zoneId: string, slot: "lead" | "secondary", memberId: string) {
    const member = members.find(m => m.id === memberId);
    const zone = zones.find(z => z.zoneId === zoneId);
    requirePIN("assign_zone_admin", member?.name || memberId, () => {
      setZones(prev => prev.map(z => {
        if (z.zoneId !== zoneId) return z;
        const updated = { ...z };
        if (slot === "lead") updated.leadAdminId = memberId;
        else updated.secondaryAdminId = memberId;
        return updated;
      }));
      setMembers(prev => prev.map(m => {
        if (m.id !== memberId) return m;
        const zs = m.assignedZones.includes(zoneId) ? m.assignedZones : [...m.assignedZones, zoneId];
        return { ...m, assignedZones: zs, level: "zone_admin" };
      }));
      setAssigningSlot(null);
      showAudit(`✓ ${member?.name} → ${slot} Admin for ${zone?.zoneName}`);
    });
  }

  function handleRemoveZoneAdmin(zoneId: string, slot: "lead" | "secondary") {
    setZones(prev => prev.map(z => {
      if (z.zoneId !== zoneId) return z;
      if (slot === "lead") return { ...z, leadAdminId: null };
      return { ...z, secondaryAdminId: null };
    }));
    showAudit(`Zone ${slot} admin removed from ${zoneId} — logged`);
  }

  function handleChangeRole(member: TeamMember, newRole: Role) {
    requirePIN("change_role", member.name, () => {
      setMembers(prev => prev.map(m => m.id === member.id
        ? { ...m, role: newRole, level: ROLE_LEVEL[newRole], hasCustomPermissions: false, customPermissions: undefined }
        : m
      ));
      setShowRoleEditor(null);
      showAudit(`✓ ${member.name} role → ${newRole} — logged to Audit`);
    });
  }

  const TABS = [
    { id: "members" as const, label: "Members", count: members.length },
    { id: "pending" as const, label: "Pending", count: pending.length, alert: pending.length > 0 },
    { id: "zones" as const, label: "Zone Admins", count: zones.length },
    { id: "permissions" as const, label: "Permissions", count: null },
  ];

  return (
    <div className="flex flex-col h-full" style={{ background: "#05070E", minHeight: "100%" }}>

      {/* ── PIN Verification Modal ──────────────────────────────── */}
      <PINVerifyModal
        isOpen={pinModal.open}
        actorName={currentActor?.name || "Admin"}
        actorLevel={actorLevel || "main_admin"}
        operationType={pinModal.operationType}
        targetName={pinModal.targetName}
        onVerified={() => {
          setPinModal(prev => ({ ...prev, open: false }));
          pinModal.onSuccess();
        }}
        onCancel={() => setPinModal(prev => ({ ...prev, open: false }))}
      />

      {/* ── Audit Toast ─────────────────────────────────────────── */}
      <AnimatePresence>
        {auditToast.visible && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl"
            style={{
              left: "50%", transform: "translateX(-50%)",
              background: "rgba(10,18,32,0.95)",
              border: "1px solid rgba(0,200,224,0.25)",
              backdropFilter: "blur(20px)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              minWidth: 260,
            }}
          >
            <ClipboardList className="size-4 flex-shrink-0" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: 500 }}>{auditToast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>Roles & Permissions</h1>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
              Manage team access, zone assignments, and custom permissions
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* 2FA indicator */}
            {actorLevel && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                style={{ background: "rgba(52,199,89,0.08)", border: "1px solid rgba(52,199,89,0.2)" }}>
                <Fingerprint className="size-3.5" style={{ color: "#34C759" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#34C759" }}>2FA ON</span>
              </div>
            )}
            {/* Audit Log shortcut */}
            {onNavigate && (
              <button
                onClick={() => onNavigate("auditLog")}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl"
                style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.2)", fontSize: 11, fontWeight: 600, color: "#FF9500" }}
              >
                <ClipboardList className="size-3.5" /> Audit Log
              </button>
            )}
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl transition-all"
              style={{ background: "linear-gradient(135deg, #00C8E0, #00A0B4)", fontSize: 13, fontWeight: 600, color: "#fff" }}
            >
              <UserPlus className="size-4" /> Invite Member
            </button>
          </div>
        </div>
      </div>

      {/* ── Hierarchy Visual ────────────────────────────────────── */}
      <div className="px-6 py-4">
        <div className="flex items-stretch gap-2">
          {(["owner","main_admin","zone_admin","worker"] as Level[]).map((level, i) => {
            const cfg = LEVEL_CONFIG[level];
            const LIcon = cfg.icon;
            const count = levelCounts[level];
            const isActive = filterLevel === level;
            return (
              <span className="contents" key={level}>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setFilterLevel(isActive ? "all" : level); setActiveTab("members"); }}
                  className="flex-1 rounded-2xl p-3 text-left transition-all"
                  style={{
                    background: isActive ? cfg.bg : "rgba(10,18,32,0.8)",
                    border: `1px solid ${isActive ? cfg.color + "40" : "rgba(255,255,255,0.06)"}`,
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: cfg.bg }}>
                      <LIcon className="size-4" style={{ color: cfg.color }} />
                    </div>
                    <span style={{ fontSize: 20, fontWeight: 800, color: cfg.color }}>{count}</span>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? cfg.color : "#fff" }}>{cfg.label}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{cfg.limit}</div>
                </motion.button>
                {i < 3 && (
                  <div className="flex items-center" style={{ color: "rgba(255,255,255,0.15)" }}>
                    <ArrowRight className="size-4" />
                  </div>
                )}
              </span>
            );
          })}
        </div>
        {filterLevel !== "all" && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-2">
            <div className="size-1.5 rounded-full" style={{ background: LEVEL_CONFIG[filterLevel].color }} />
            <span style={{ fontSize: 11, color: LEVEL_CONFIG[filterLevel].color }}>{LEVEL_CONFIG[filterLevel].desc}</span>
            <button onClick={() => setFilterLevel("all")} style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginLeft: "auto" }}>Clear filter ×</button>
          </motion.div>
        )}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="px-6 flex items-center gap-1 mb-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="relative flex items-center gap-2 px-4 py-3 transition-all"
            style={{
              fontSize: 13, fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.4)",
              borderBottom: activeTab === tab.id ? "2px solid #00C8E0" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab.label}
            {tab.count !== null && (
              <span className="px-1.5 py-0.5 rounded-md" style={{
                fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: "center",
                background: tab.alert ? "rgba(255,45,85,0.2)" : "rgba(255,255,255,0.08)",
                color: tab.alert ? "#FF2D55" : "rgba(255,255,255,0.5)",
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab Content ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: "none" }}>
        <AnimatePresence mode="wait">

          {/* ═══ MEMBERS TAB ═══════════════════════════════════════ */}
          {activeTab === "members" && (
            <motion.div key="members" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {/* Search + Filter */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <Search className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members…" className="bg-transparent flex-1 outline-none" style={{ fontSize: 13, color: "#fff" }} />
                  {search && <button onClick={() => setSearch("")}><X className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} /></button>}
                </div>
                <select
                  value={filterLevel}
                  onChange={e => setFilterLevel(e.target.value as Level | "all")}
                  className="px-3 py-2.5 rounded-xl outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.7)", fontSize: 12 }}
                >
                  <option value="all">All Levels</option>
                  <option value="owner">Owner</option>
                  <option value="main_admin">Main Admin</option>
                  <option value="zone_admin">Zone Admin</option>
                  <option value="worker">Field Worker</option>
                </select>
              </div>

              {/* Member Cards */}
              <div className="flex flex-col gap-2">
                {filteredMembers.map((member, i) => {
                  const levelCfg = LEVEL_CONFIG[member.level];
                  const roleCfg = ROLE_CONFIG[member.role];
                  const LIcon = levelCfg.icon;
                  return (
                    <motion.div
                      key={member.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
                      className="flex items-center gap-3 p-3 rounded-2xl"
                      style={{ background: "rgba(10,18,32,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}
                    >
                      {/* Avatar */}
                      <div className="relative">
                        <Avatar name={member.name} color={member.avatarColor} size={40} />
                        <div className="absolute -bottom-1 -right-1 size-4 rounded-full flex items-center justify-center" style={{ background: levelCfg.bg, border: `1px solid ${levelCfg.color}40` }}>
                          <LIcon style={{ width: 8, height: 8, color: levelCfg.color }} />
                        </div>
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{member.name}</span>
                          {member.isOwner && <Crown style={{ width: 12, height: 12, color: "#FF2D55" }} />}
                          {member.hasCustomPermissions && (
                            <span className="px-1.5 py-0.5 rounded-md" style={{ fontSize: 8, fontWeight: 700, color: "#FF9500", background: "rgba(255,150,0,0.12)", border: "1px solid rgba(255,150,0,0.2)" }}>CUSTOM PERMS</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{member.email}</span>
                          {member.assignedZones.length > 0 && (
                            <span className="contents">
                              <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>·</span>
                              <MapPin style={{ width: 9, height: 9, color: "#00C8E0" }} />
                              <span style={{ fontSize: 10, color: "#00C8E0" }}>{member.assignedZones.join(", ")}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Role badge */}
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 rounded-lg" style={{ fontSize: 10, fontWeight: 700, color: roleCfg.color, background: `${roleCfg.color}15`, border: `1px solid ${roleCfg.color}25`, whiteSpace: "nowrap" }}>
                          {roleCfg.label}
                        </span>
                        <div className="size-2 rounded-full" style={{ background: STATUS_COLOR[member.status] }} />
                      </div>

                      {/* Actions */}
                      {!member.isOwner && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleOpenPermissions(member)}
                            className="size-7 rounded-lg flex items-center justify-center transition-all hover:bg-white/5"
                            title="Custom Permissions"
                          >
                            <Key style={{ width: 13, height: 13, color: "#FF9500" }} />
                          </button>
                          <button
                            onClick={() => setShowRoleEditor(member)}
                            className="size-7 rounded-lg flex items-center justify-center transition-all hover:bg-white/5"
                            title="Change Role"
                          >
                            <Edit2 style={{ width: 13, height: 13, color: "#00C8E0" }} />
                          </button>
                          <button
                            onClick={() => setMembers(prev => prev.filter(m => m.id !== member.id))}
                            className="size-7 rounded-lg flex items-center justify-center transition-all hover:bg-red-500/10"
                            title="Remove Member"
                          >
                            <UserX style={{ width: 13, height: 13, color: "#FF2D55" }} />
                          </button>
                        </div>
                      )}
                      {member.isOwner && (
                        <Lock style={{ width: 14, height: 14, color: "rgba(255,255,255,0.2)" }} />
                      )}
                    </motion.div>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <div className="text-center py-12" style={{ color: "rgba(255,255,255,0.25)", fontSize: 13 }}>No members found</div>
                )}
              </div>
            </motion.div>
          )}

          {/* ═══ PENDING TAB ════════════════════════════════════════ */}
          {activeTab === "pending" && (
            <motion.div key="pending" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {pending.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="size-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(52,199,89,0.1)" }}>
                    <CheckCircle2 className="size-7" style={{ color: "#34C759" }} />
                  </div>
                  <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>All approvals are up to date</p>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-4 p-3 rounded-xl" style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)" }}>
                    <AlertTriangle className="size-4" style={{ color: "#FF9500" }} />
                    <span style={{ fontSize: 12, color: "#FF9500" }}><b>{pending.length} users</b> are waiting for role assignment before they can access the app.</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {pending.map((p, i) => (
                      <motion.div
                        key={p.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0, transition: { delay: i * 0.05 } }}
                        className="rounded-2xl p-4"
                        style={{ background: "rgba(10,18,32,0.9)", border: "1px solid rgba(255,255,255,0.07)" }}
                      >
                        <div className="flex items-start gap-3 mb-3">
                          <Avatar name={p.name} color="#00C8E0" size={40} />
                          <div className="flex-1">
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{p.email} · {p.phone}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.1)" }}>
                                via {p.joinedVia.replace("_", " ").toUpperCase()}
                              </span>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{p.requestedAgo}</span>
                            </div>
                          </div>
                        </div>

                        {/* Role + Zone assignment */}
                        <div className="flex gap-2 mb-3">
                          <div className="flex-1">
                            <label style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Assign Role *</label>
                            <select
                              value={pendingRole[p.id] || "employee"}
                              onChange={e => setPendingRole(prev => ({ ...prev, [p.id]: e.target.value as Role }))}
                              className="w-full px-3 py-2 rounded-xl outline-none"
                              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: 12 }}
                            >
                              <option value="employee">Field Worker</option>
                              <option value="security_guard">Security Guard</option>
                              <option value="field_medic">Field Medic</option>
                              <option value="dispatcher">Dispatcher</option>
                              <option value="shift_supervisor">Zone Admin</option>
                              <option value="safety_manager">Safety Manager</option>
                              <option value="company_admin">Main Admin</option>
                            </select>
                          </div>
                          <div className="flex-1">
                            <label style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 4 }}>Assign Zone</label>
                            <select
                              value={pendingZone[p.id] || ""}
                              onChange={e => setPendingZone(prev => ({ ...prev, [p.id]: e.target.value }))}
                              className="w-full px-3 py-2 rounded-xl outline-none"
                              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: 12 }}
                            >
                              <option value="">No Zone</option>
                              {INITIAL_ZONES.map(z => <option key={z.zoneId} value={z.zoneId}>{z.zoneName}</option>)}
                            </select>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprovePending(p)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
                            style={{ background: "rgba(52,199,89,0.15)", border: "1px solid rgba(52,199,89,0.25)", fontSize: 12, fontWeight: 700, color: "#34C759" }}
                          >
                            <Check className="size-3.5" /> Approve & Assign
                          </button>
                          <button
                            onClick={() => handleRejectPending(p.id)}
                            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl"
                            style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)", fontSize: 12, fontWeight: 700, color: "#FF2D55" }}
                          >
                            <X className="size-3.5" /> Reject
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* ═══ ZONE ADMINS TAB ════════════════════════════════════ */}
          {activeTab === "zones" && (
            <motion.div key="zones" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {/* Info banner */}
              <div className="flex items-start gap-2 p-3 rounded-xl mb-4" style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)" }}>
                <Info className="size-4 mt-0.5 shrink-0" style={{ color: "#00C8E0" }} />
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                  Each zone can have up to <b style={{ color: "#00C8E0" }}>2 admins</b>: a <b style={{ color: "#00C8E0" }}>Zone Lead</b> (primary responder) and a <b style={{ color: "#00C8E0" }}>Secondary Admin</b> (backup). At least 1 admin per zone is strongly recommended.
                </p>
              </div>

              {/* Coverage summary */}
              <div className="flex gap-2 mb-4">
                {[
                  { label: "Full Coverage", count: zones.filter(z => z.leadAdminId && z.secondaryAdminId).length, color: "#34C759" },
                  { label: "Partial", count: zones.filter(z => z.leadAdminId && !z.secondaryAdminId).length, color: "#FF9500" },
                  { label: "No Admin", count: zones.filter(z => !z.leadAdminId).length, color: "#FF2D55" },
                ].map(s => (
                  <div key={s.label} className="flex-1 p-2 rounded-xl text-center" style={{ background: `${s.color}0D`, border: `1px solid ${s.color}20` }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.count}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 1 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Zone Cards */}
              <div className="flex flex-col gap-3">
                {zones.map((zone, i) => {
                  const lead = members.find(m => m.id === zone.leadAdminId) || null;
                  const secondary = members.find(m => m.id === zone.secondaryAdminId) || null;
                  const coverage = lead && secondary ? "full" : lead ? "partial" : "none";
                  const coverageColor = { full: "#34C759", partial: "#FF9500", none: "#FF2D55" }[coverage];
                  const isExpanded = expandedZone === zone.zoneId;

                  return (
                    <motion.div
                      key={zone.zoneId}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }}
                      className="rounded-2xl overflow-hidden"
                      style={{ background: "rgba(10,18,32,0.9)", border: `1px solid ${coverageColor}20` }}
                    >
                      {/* Zone header */}
                      <button
                        className="w-full flex items-center gap-3 p-4"
                        onClick={() => setExpandedZone(isExpanded ? null : zone.zoneId)}
                      >
                        <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: `${RISK_COLOR[zone.risk]}15` }}>
                          <MapPin className="size-4" style={{ color: RISK_COLOR[zone.risk] }} />
                        </div>
                        <div className="flex-1 text-left">
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{zone.zoneName}</div>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{zone.employeeCount} employees · {zone.risk} risk</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md" style={{ fontSize: 9, fontWeight: 700, color: coverageColor, background: `${coverageColor}15` }}>
                            {coverage === "full" ? "2/2 Admins" : coverage === "partial" ? "1/2 Admin" : "No Admin"}
                          </span>
                          {isExpanded ? <ChevronUp className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} /> : <ChevronDown className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />}
                        </div>
                      </button>

                      {/* Expanded content */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="px-4 pb-4"
                            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                          >
                            <div className="flex gap-3 mt-3">
                              {/* Lead Slot */}
                              {[
                                { slot: "lead" as const, label: "Zone Lead", admin: lead },
                                { slot: "secondary" as const, label: "Secondary Admin", admin: secondary },
                              ].map(({ slot, label, admin }) => (
                                <div key={slot} className="flex-1 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                                  <div className="flex items-center justify-between mb-2">
                                    <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px" }}>{label.toUpperCase()}</span>
                                    {slot === "lead" && <Crown style={{ width: 10, height: 10, color: "#FF9500" }} />}
                                  </div>
                                  {admin ? (
                                    <div className="flex items-center gap-2">
                                      <Avatar name={admin.name} color={admin.avatarColor} size={28} />
                                      <div className="flex-1 min-w-0">
                                        <div style={{ fontSize: 11, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{admin.name}</div>
                                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{ROLE_CONFIG[admin.role].label}</div>
                                      </div>
                                      <button onClick={() => handleRemoveZoneAdmin(zone.zoneId, slot)} className="size-5 rounded-md flex items-center justify-center hover:bg-red-500/10">
                                        <X style={{ width: 10, height: 10, color: "#FF2D55" }} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => setAssigningSlot({ zoneId: zone.zoneId, slot })}
                                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg"
                                      style={{ border: "1px dashed rgba(0,200,224,0.3)", fontSize: 11, color: "#00C8E0" }}
                                    >
                                      <Plus className="size-3.5" /> Assign
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Assign modal inline */}
                            {assigningSlot?.zoneId === zone.zoneId && (
                              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 p-3 rounded-xl" style={{ background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.15)" }}>
                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
                                  Select {assigningSlot.slot === "lead" ? "Zone Lead" : "Secondary Admin"} for {zone.zoneName}:
                                </div>
                                <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
                                  {members.filter(m => m.level !== "owner" && m.id !== zone.leadAdminId && m.id !== zone.secondaryAdminId).map(m => (
                                    <button
                                      key={m.id}
                                      onClick={() => handleAssignZoneAdmin(zone.zoneId, assigningSlot.slot, m.id)}
                                      className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 text-left"
                                    >
                                      <Avatar name={m.name} color={m.avatarColor} size={28} />
                                      <div>
                                        <div style={{ fontSize: 11, fontWeight: 600, color: "#fff" }}>{m.name}</div>
                                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{ROLE_CONFIG[m.role].label}</div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                                <button onClick={() => setAssigningSlot(null)} style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>Cancel</button>
                              </motion.div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ═══ PERMISSIONS TAB ════════════════════════════════════ */}
          {activeTab === "permissions" && (
            <motion.div key="permissions" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {/* User Picker */}
              <div className="mb-4">
                <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6 }}>SELECT TEAM MEMBER</label>
                <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
                  {members.filter(m => !m.isOwner).map(m => (
                    <button
                      key={m.id}
                      onClick={() => handleOpenPermissions(m)}
                      className="flex items-center gap-3 p-2.5 rounded-xl text-left transition-all"
                      style={{
                        background: selectedMemberForPerms?.id === m.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${selectedMemberForPerms?.id === m.id ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.05)"}`,
                      }}
                    >
                      <Avatar name={m.name} color={m.avatarColor} size={32} />
                      <div className="flex-1">
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{m.name}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{ROLE_CONFIG[m.role].label}</div>
                      </div>
                      {m.hasCustomPermissions && (
                        <span style={{ fontSize: 8, fontWeight: 700, color: "#FF9500", background: "rgba(255,150,0,0.1)", padding: "2px 6px", borderRadius: 4 }}>CUSTOM</span>
                      )}
                      {selectedMemberForPerms?.id === m.id && <Check className="size-4" style={{ color: "#00C8E0" }} />}
                    </button>
                  ))}
                </div>
              </div>

              {selectedMemberForPerms ? (
                <div>
                  {/* Selected Member Header */}
                  <div className="flex items-center gap-3 p-3 rounded-xl mb-4" style={{ background: "rgba(10,18,32,0.9)", border: "1px solid rgba(0,200,224,0.15)" }}>
                    <Avatar name={selectedMemberForPerms.name} color={selectedMemberForPerms.avatarColor} size={44} />
                    <div className="flex-1">
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{selectedMemberForPerms.name}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                        Base role: <span style={{ color: ROLE_CONFIG[selectedMemberForPerms.role].color }}>{ROLE_CONFIG[selectedMemberForPerms.role].label}</span>
                        {selectedMemberForPerms.hasCustomPermissions && <span style={{ color: "#FF9500", marginLeft: 8 }}>· Custom permissions active</span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleResetPerms} className="flex items-center gap-1 px-3 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.05)", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                        <RefreshCw className="size-3" /> Reset
                      </button>
                      <button
                        onClick={handleSavePerms}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg"
                        style={{ background: savedPerms ? "rgba(52,199,89,0.15)" : "rgba(0,200,224,0.15)", border: `1px solid ${savedPerms ? "rgba(52,199,89,0.3)" : "rgba(0,200,224,0.25)"}`, fontSize: 11, fontWeight: 700, color: savedPerms ? "#34C759" : "#00C8E0" }}
                      >
                        {savedPerms ? <span className="contents"><Check className="size-3" /> Saved</span> : <span className="contents"><Check className="size-3" /> Save</span>}
                      </button>
                    </div>
                  </div>

                  {/* Permission Groups */}
                  <div className="flex flex-col gap-3">
                    {PERMISSION_GROUPS.map(group => {
                      const GIcon = group.icon;
                      const groupPermsEnabled = group.perms.filter(p => editingPerms.includes(p.id)).length;
                      return (
                        <div key={group.group} className="rounded-2xl overflow-hidden" style={{ background: "rgba(10,18,32,0.9)", border: "1px solid rgba(255,255,255,0.05)" }}>
                          {/* Group header */}
                          <div className="flex items-center gap-3 p-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <div className="size-7 rounded-lg flex items-center justify-center" style={{ background: `${group.color}15` }}>
                              <GIcon style={{ width: 14, height: 14, color: group.color }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{group.group}</span>
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginLeft: "auto" }}>{groupPermsEnabled}/{group.perms.length}</span>
                          </div>

                          {/* Permissions */}
                          <div className="p-2 flex flex-col gap-1">
                            {group.perms.map(perm => {
                              const isEnabled = editingPerms.includes(perm.id);
                              const isDefault = ROLE_DEFAULTS[selectedMemberForPerms.role].includes(perm.id);
                              const isDiff = isEnabled !== isDefault;
                              return (
                                <button
                                  key={perm.id}
                                  onClick={() => handleTogglePerm(perm.id)}
                                  className="flex items-center gap-3 p-2.5 rounded-xl text-left transition-all"
                                  style={{ background: isEnabled ? `${group.color}08` : "transparent" }}
                                >
                                  <div
                                    className="size-5 rounded-md flex items-center justify-center shrink-0 transition-all"
                                    style={{
                                      background: isEnabled ? group.color : "rgba(255,255,255,0.05)",
                                      border: `1px solid ${isEnabled ? group.color : "rgba(255,255,255,0.1)"}`,
                                    }}
                                  >
                                    {isEnabled && <Check style={{ width: 10, height: 10, color: "#fff" }} />}
                                  </div>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span style={{ fontSize: 12, fontWeight: 600, color: isEnabled ? "#fff" : "rgba(255,255,255,0.4)" }}>{perm.label}</span>
                                      {isDiff && (
                                        <span style={{ fontSize: 8, fontWeight: 700, color: isEnabled ? "#34C759" : "#FF9500", background: isEnabled ? "rgba(52,199,89,0.1)" : "rgba(255,150,0,0.1)", padding: "1px 5px", borderRadius: 3 }}>
                                          {isEnabled ? "+ADDED" : "-REMOVED"}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{perm.desc}</div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Floating Save */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="sticky bottom-0 pt-4 pb-2"
                    style={{ background: "linear-gradient(to top, #05070E 70%, transparent)" }}
                  >
                    <button
                      onClick={handleSavePerms}
                      className="w-full py-3 rounded-2xl flex items-center justify-center gap-2"
                      style={{
                        background: savedPerms
                          ? "linear-gradient(135deg, #34C759, #27AE60)"
                          : "linear-gradient(135deg, #00C8E0, #00A0B4)",
                        fontSize: 14, fontWeight: 700, color: "#fff",
                      }}
                    >
                      {savedPerms ? <span className="contents"><CheckCircle2 className="size-5" /> Permissions Saved!</span> : <span className="contents"><Key className="size-5" /> Save Custom Permissions</span>}
                    </button>
                  </motion.div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="size-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.08)" }}>
                    <Key className="size-7" style={{ color: "#00C8E0" }} />
                  </div>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", textAlign: "center" }}>
                    Select a team member above to<br />customize their permissions
                  </p>
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* ── Role Editor Modal ───────────────────────────────────── */}
      <AnimatePresence>
        {showRoleEditor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(5,7,14,0.85)", backdropFilter: "blur(8px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowRoleEditor(null); }}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="w-full max-w-lg rounded-t-3xl p-6"
              style={{ background: "#0A1220", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Change Role</h3>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{showRoleEditor.name}</p>
                </div>
                <button onClick={() => setShowRoleEditor(null)}><X className="size-5" style={{ color: "rgba(255,255,255,0.4)" }} /></button>
              </div>
              <div className="flex flex-col gap-2">
                {(["company_admin","safety_manager","shift_supervisor","dispatcher","field_medic","security_guard","employee"] as Role[]).map(role => {
                  const cfg = ROLE_CONFIG[role];
                  const level = ROLE_LEVEL[role];
                  const levelCfg = LEVEL_CONFIG[level];
                  const isCurrentRole = role === showRoleEditor.role;
                  return (
                    <button
                      key={role}
                      onClick={() => handleChangeRole(showRoleEditor, role)}
                      className="flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                      style={{ background: isCurrentRole ? `${cfg.color}12` : "rgba(255,255,255,0.03)", border: `1px solid ${isCurrentRole ? cfg.color + "30" : "rgba(255,255,255,0.06)"}` }}
                    >
                      <div className="size-8 rounded-xl flex items-center justify-center" style={{ background: `${cfg.color}15` }}>
                        <levelCfg.icon style={{ width: 16, height: 16, color: cfg.color }} />
                      </div>
                      <div className="flex-1">
                        <div style={{ fontSize: 13, fontWeight: 600, color: isCurrentRole ? cfg.color : "#fff" }}>{cfg.label}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{levelCfg.desc}</div>
                      </div>
                      {isCurrentRole && <Check className="size-4" style={{ color: cfg.color }} />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 text-center" style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                Changing role will reset any custom permissions to the new role defaults.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Invite Modal ────────────────────────────────────────── */}
      <AnimatePresence>
        {showInviteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center"
            style={{ background: "rgba(5,7,14,0.85)", backdropFilter: "blur(8px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowInviteModal(false); }}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className="w-full max-w-lg rounded-t-3xl p-6"
              style={{ background: "#0A1220", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Invite Team Member</h3>
                <button onClick={() => setShowInviteModal(false)}><X className="size-5" style={{ color: "rgba(255,255,255,0.4)" }} /></button>
              </div>

              <div className="flex flex-col gap-3 mb-6">
                {[
                  { label: "Invite Link", icon: Globe, color: "#00C8E0", desc: "Share a link — anyone with it can join (pending approval)", value: "https://app.sosphere.io/join/ACME-X7K9P2" },
                  { label: "Invite Code", icon: Hash, color: "#FF9500", desc: "6-character code for manual entry in the mobile app", value: "X7K9P2" },
                ].map(opt => {
                  const OIcon = opt.icon;
                  return (
                    <div key={opt.label} className="p-4 rounded-2xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <div className="flex items-center gap-2 mb-2">
                        <OIcon className="size-4" style={{ color: opt.color }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{opt.label}</span>
                      </div>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 8 }}>{opt.desc}</p>
                      <div className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: opt.color, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.value}</span>
                        <button
                          onClick={() => navigator.clipboard?.writeText(opt.value)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg"
                          style={{ background: `${opt.color}15`, fontSize: 10, fontWeight: 700, color: opt.color }}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center" }}>
                All new members will appear in Pending tab and require role assignment before accessing the app.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}




