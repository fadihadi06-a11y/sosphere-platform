// ═══════════════════════════════════════════════════════════════
// SOSphere — Emergency Response Playbook (Enterprise Dashboard)
// ─────────────────────────────────────────────────────────────
// Pre-configured response protocols for different emergency types
// Admin can create, customize, and auto-trigger playbooks
// Each playbook is a step-by-step rescue guide
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BookOpen, ChevronRight, ChevronDown, Shield, AlertTriangle,
  Heart, Flame, Lock, MapPin, Phone, Users, Ambulance,
  Megaphone, Clock, CheckCircle, Plus, X, Zap,
  Activity, Eye, Pencil, Copy, Trash2, Play, Star,
  Navigation, MessageCircle, Radio, CheckCircle2,
  ShieldCheck, FileText, Sparkles, CircleCheck,
  Siren, ClipboardList, Timer,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticWarning, hapticMedium, hapticLight, hapticHeavy } from "./haptic-feedback";
import { TYPOGRAPHY, TOKENS, KPICard, Card, SectionHeader, Badge, StatPill } from "./design-system";

// ── Types ─────────────────────────────────────────────────────
interface PlaybookStep {
  id: string;
  action: string;
  responsible: string;
  timeLimit: string;
  icon: any;
  color: string;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  severity: "critical" | "high" | "medium" | "low";
  icon: any;
  iconColor: string;
  steps: PlaybookStep[];
  autoTrigger: boolean;
  lastUsed?: Date;
  useCount: number;
}

// ── GlowIcon ──────────────────────────────────────────────────
function GlowIcon({ icon: Icon, color, size = 40, iconSize = 20, pulse }: {
  icon: any; color: string; size?: number; iconSize?: number; pulse?: boolean;
}) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {pulse && (
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 rounded-xl"
          style={{ background: `${color}20`, filter: "blur(6px)" }}
        />
      )}
      <div className="relative flex items-center justify-center rounded-xl" style={{
        width: size, height: size,
        background: `linear-gradient(145deg, ${color}20, ${color}08)`,
        border: `1px solid ${color}25`,
        boxShadow: `0 4px 16px ${color}12, inset 0 1px 0 ${color}10`,
      }}>
        <Icon size={iconSize} color={color} strokeWidth={1.6} />
      </div>
    </div>
  );
}

// ── Mock Playbooks ────────────────────────────────────────────
const MOCK_PLAYBOOKS: Playbook[] = [
  {
    id: "PB-001",
    name: "SOS Button Response",
    description: "Standard response when an employee presses the SOS button",
    triggerType: "SOS Button",
    severity: "critical",
    icon: AlertTriangle,
    iconColor: "#FF2D55",
    autoTrigger: true,
    lastUsed: new Date(Date.now() - 86400000),
    useCount: 12,
    steps: [
      { id: "S1", action: "Attempt phone call to employee", responsible: "Zone Admin", timeLimit: "< 30 sec", icon: Phone, color: "#00C853" },
      { id: "S2", action: "Send emergency chat message", responsible: "Zone Admin", timeLimit: "< 30 sec", icon: MessageCircle, color: "#00C8E0" },
      { id: "S3", action: "Dispatch nearest buddy/team member", responsible: "Zone Admin", timeLimit: "< 1 min", icon: Navigation, color: "#FF9500" },
      { id: "S4", action: "Check GPS location on map", responsible: "Zone Admin", timeLimit: "< 1 min", icon: MapPin, color: "#00C8E0" },
      { id: "S5", action: "If no answer: Call 911", responsible: "Main Admin", timeLimit: "< 3 min", icon: Ambulance, color: "#FF2D55" },
      { id: "S6", action: "Share Medical ID with responders", responsible: "Zone Admin", timeLimit: "< 3 min", icon: Heart, color: "#FF9500" },
      { id: "S7", action: "Notify company owner", responsible: "Main Admin", timeLimit: "< 5 min", icon: Users, color: "#8B5CF6" },
      { id: "S8", action: "Document incident with photos/audio", responsible: "Employee / Buddy", timeLimit: "< 10 min", icon: Eye, color: "#00C8E0" },
    ],
  },
  {
    id: "PB-002",
    name: "Fall Detection Response",
    description: "Auto-triggered when accelerometer detects a fall",
    triggerType: "Fall Detected",
    severity: "critical",
    icon: Activity,
    iconColor: "#FF9500",
    autoTrigger: true,
    lastUsed: new Date(Date.now() - 172800000),
    useCount: 3,
    steps: [
      { id: "S1", action: "Wait for 15-sec countdown (auto-cancel if false alarm)", responsible: "System", timeLimit: "15 sec", icon: Clock, color: "#FF9500" },
      { id: "S2", action: "Call employee immediately", responsible: "Zone Admin", timeLimit: "< 30 sec", icon: Phone, color: "#00C853" },
      { id: "S3", action: "Alert buddy system partner", responsible: "System", timeLimit: "Auto", icon: Users, color: "#00C8E0" },
      { id: "S4", action: "If unconscious: Dispatch first-aid team", responsible: "Zone Admin", timeLimit: "< 1 min", icon: Heart, color: "#FF2D55" },
      { id: "S5", action: "Call ambulance if unresponsive", responsible: "Main Admin", timeLimit: "< 2 min", icon: Ambulance, color: "#FF2D55" },
      { id: "S6", action: "Secure area around fallen employee", responsible: "Security", timeLimit: "< 3 min", icon: Shield, color: "#FF9500" },
    ],
  },
  {
    id: "PB-003",
    name: "Fire / Gas Leak Protocol",
    description: "Environmental hazard requiring immediate evacuation",
    triggerType: "Environmental Hazard",
    severity: "critical",
    icon: Flame,
    iconColor: "#FF2D55",
    autoTrigger: false,
    useCount: 1,
    steps: [
      { id: "S1", action: "Trigger zone evacuation immediately", responsible: "Zone Admin", timeLimit: "IMMEDIATE", icon: Megaphone, color: "#FF2D55" },
      { id: "S2", action: "Call fire department / hazmat", responsible: "Main Admin", timeLimit: "< 30 sec", icon: Phone, color: "#FF2D55" },
      { id: "S3", action: "Shut down zone utilities (gas, power)", responsible: "Facilities", timeLimit: "< 1 min", icon: Zap, color: "#FF9500" },
      { id: "S4", action: "Monitor assembly point head count", responsible: "Zone Admin", timeLimit: "< 5 min", icon: Users, color: "#00C8E0" },
      { id: "S5", action: "Search for missing employees", responsible: "Security Team", timeLimit: "< 5 min", icon: Navigation, color: "#FF9500" },
      { id: "S6", action: "Block zone access perimeter", responsible: "Security", timeLimit: "< 3 min", icon: Lock, color: "#FF2D55" },
      { id: "S7", action: "Notify all zone admins company-wide", responsible: "Main Admin", timeLimit: "< 5 min", icon: Radio, color: "#8B5CF6" },
    ],
  },
  {
    id: "PB-004",
    name: "Security Threat Response",
    description: "Hostile person, assault, or security breach",
    triggerType: "Security Threat",
    severity: "high",
    icon: Shield,
    iconColor: "#FF9500",
    autoTrigger: false,
    useCount: 0,
    steps: [
      { id: "S1", action: "Verify threat via camera or witnesses", responsible: "Security", timeLimit: "< 1 min", icon: Eye, color: "#00C8E0" },
      { id: "S2", action: "Silent alert to nearby workers", responsible: "Zone Admin", timeLimit: "< 1 min", icon: MessageCircle, color: "#00C8E0" },
      { id: "S3", action: "Dispatch security team", responsible: "Main Admin", timeLimit: "< 2 min", icon: Shield, color: "#FF9500" },
      { id: "S4", action: "Contact police if needed", responsible: "Main Admin", timeLimit: "< 3 min", icon: Phone, color: "#FF2D55" },
      { id: "S5", action: "Lock down affected zone", responsible: "Zone Admin", timeLimit: "< 3 min", icon: Lock, color: "#FF2D55" },
      { id: "S6", action: "Account for all employees in zone", responsible: "Zone Admin", timeLimit: "< 10 min", icon: Users, color: "#00C853" },
    ],
  },
  {
    id: "PB-005",
    name: "Missed Check-in Escalation",
    description: "Employee hasn't checked in within the scheduled window",
    triggerType: "Missed Check-in",
    severity: "medium",
    icon: Clock,
    iconColor: "#FF9500",
    autoTrigger: true,
    lastUsed: new Date(Date.now() - 3600000),
    useCount: 28,
    steps: [
      { id: "S1", action: "Send push notification reminder", responsible: "System", timeLimit: "Auto", icon: MessageCircle, color: "#00C8E0" },
      { id: "S2", action: "Wait 5 minutes for response", responsible: "System", timeLimit: "5 min", icon: Clock, color: "#FF9500" },
      { id: "S3", action: "Call employee directly", responsible: "Zone Admin", timeLimit: "< 6 min", icon: Phone, color: "#00C853" },
      { id: "S4", action: "Contact buddy partner", responsible: "Zone Admin", timeLimit: "< 8 min", icon: Users, color: "#00C8E0" },
      { id: "S5", action: "If still unresponsive: Dispatch help", responsible: "Zone Admin", timeLimit: "< 10 min", icon: Navigation, color: "#FF9500" },
    ],
  },
];

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#FF2D55",
  high: "#FF9500",
  medium: "#FFD60A",
  low: "#00C8E0",
};

// ── Dashboard Emergency Playbook Page ─────────────────────────
export function EmergencyPlaybookPage({ t, webMode }: { t: (k: string) => string; webMode?: boolean }) {
  const [playbooks, setPlaybooks] = useState(MOCK_PLAYBOOKS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "auto" | "manual">("all");
  const [runningPlaybook, setRunningPlaybook] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<Record<string, Set<string>>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newSeverity, setNewSeverity] = useState<"critical" | "high" | "medium" | "low">("high");
  const [newTrigger, setNewTrigger] = useState("Manual Trigger");
  const [newAutoTrigger, setNewAutoTrigger] = useState(false);

  const filtered = playbooks.filter(p =>
    filter === "all" ? true : filter === "auto" ? p.autoTrigger : !p.autoTrigger
  );

  const totalPlaybooks = playbooks.length;
  const autoTrigger = playbooks.filter(p => p.autoTrigger).length;
  const totalSteps = playbooks.reduce((sum, p) => sum + p.steps.length, 0);
  const totalUsage = playbooks.reduce((sum, p) => sum + p.useCount, 0);

  const handleRunPlaybook = useCallback((pb: Playbook) => {
    hapticHeavy();
    setRunningPlaybook(pb.id);
    setCompletedSteps(prev => ({ ...prev, [pb.id]: new Set() }));
    toast.success(`Running: ${pb.name}`, {
      description: `${pb.steps.length} steps initiated — follow the protocol sequence`,
    });
  }, []);

  const handleCompleteStep = useCallback((playbookId: string, stepId: string, action: string) => {
    hapticSuccess();
    setCompletedSteps(prev => {
      const newSet = new Set(prev[playbookId] || []);
      newSet.add(stepId);
      return { ...prev, [playbookId]: newSet };
    });
    toast.success("Step Completed", { description: action });
  }, []);

  const handleDuplicate = useCallback((pb: Playbook) => {
    hapticMedium();
    const newPb: Playbook = {
      ...pb,
      id: `PB-${Date.now()}`,
      name: `${pb.name} (Copy)`,
      useCount: 0,
      lastUsed: undefined,
    };
    setPlaybooks(prev => [...prev, newPb]);
    toast.success("Playbook Duplicated", { description: `"${pb.name}" has been copied` });
  }, []);

  const handleEdit = useCallback((pb: Playbook) => {
    hapticLight();
    toast("Edit Mode", { description: `Editing "${pb.name}" — modify steps, timing, and assignments` });
  }, []);

  const handleCreate = useCallback(() => {
    hapticLight();
    setShowCreateModal(true);
  }, []);

  const handleConfirmCreate = useCallback(() => {
    if (!newName.trim()) {
      hapticWarning();
      toast.error("Name Required", { description: "Please enter a playbook name" });
      return;
    }
    const newPb: Playbook = {
      id: `PB-${Date.now()}`,
      name: newName.trim(),
      description: newDesc.trim() || "Custom emergency response protocol",
      triggerType: newTrigger,
      severity: newSeverity,
      icon: newSeverity === "critical" ? Siren : newSeverity === "high" ? AlertTriangle : newSeverity === "medium" ? Clock : Shield,
      iconColor: SEVERITY_COLORS[newSeverity],
      autoTrigger: newAutoTrigger,
      useCount: 0,
      steps: [
        { id: "S1", action: "Verify situation and assess severity", responsible: "Zone Admin", timeLimit: "< 1 min", icon: Eye, color: "#00C8E0" },
        { id: "S2", action: "Contact affected employee(s)", responsible: "Zone Admin", timeLimit: "< 2 min", icon: Phone, color: "#00C853" },
        { id: "S3", action: "Escalate to Main Admin if needed", responsible: "Zone Admin", timeLimit: "< 5 min", icon: Users, color: "#FF9500" },
      ],
    };
    setPlaybooks(prev => [...prev, newPb]);
    setShowCreateModal(false);
    setNewName("");
    setNewDesc("");
    setNewSeverity("high");
    setNewTrigger("Manual Trigger");
    setNewAutoTrigger(false);
    hapticSuccess();
    toast.success("Playbook Created", { description: `"${newPb.name}" added with ${newPb.steps.length} default steps` });
  }, [newName, newDesc, newSeverity, newTrigger, newAutoTrigger]);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 14px", borderRadius: 12,
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
    color: "#fff", fontSize: 13, fontFamily: "'Outfit', sans-serif", outline: "none",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer", appearance: "none" as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.3)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center",
  };

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: "'Outfit', sans-serif" }}>

      {/* ══════════════════════════════════════════════════════ */}
      {/* KPI Cards                                            */}
      {/* ══════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard label="Total Playbooks" value={totalPlaybooks} icon={BookOpen} color="#00C8E0"
          subtitle="Response protocols" />
        <KPICard label="Auto-Trigger" value={autoTrigger} icon={Zap} color="#FF9500"
          subtitle="AI-activated protocols" trend={{ value: "Instant response", positive: true }} />
        <KPICard label="Total Steps" value={totalSteps} icon={ClipboardList} color="#7B5EFF"
          subtitle="Across all playbooks" />
        <KPICard label="Times Used" value={totalUsage} icon={Activity} color="#00C853"
          trend={{ value: "28 this month", positive: true }} subtitle="Protocol activations" />
      </div>

      {/* ══════════════════════════════════════════════════════ */}
      {/* Filter + Create                                      */}
      {/* ══════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 p-1.5 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
          {(["all", "auto", "manual"] as const).map(f => (
            <motion.button key={f} whileTap={{ scale: 0.97 }}
              onClick={() => setFilter(f)}
              className="px-4 py-2 rounded-lg"
              style={{
                background: filter === f ? "rgba(0,200,224,0.08)" : "transparent",
                border: filter === f ? "1px solid rgba(0,200,224,0.18)" : "1px solid transparent",
                cursor: "pointer",
              }}>
              <span style={{
                ...TYPOGRAPHY.caption,
                fontWeight: filter === f ? 700 : 500,
                color: filter === f ? "#00C8E0" : "rgba(255,255,255,0.3)",
              }}>
                {f === "all" ? "All Playbooks" : f === "auto" ? "Auto-Trigger" : "Manual"}
              </span>
            </motion.button>
          ))}
        </div>

        <motion.button
          whileTap={{ scale: 0.95 }} whileHover={{ scale: 1.02 }}
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl"
          style={{
            background: "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.06))",
            border: "1px solid rgba(0,200,224,0.18)",
            cursor: "pointer",
          }}>
          <Plus size={15} color="#00C8E0" strokeWidth={1.8} />
          <span style={{ ...TYPOGRAPHY.caption, color: "#00C8E0", fontWeight: 600 }}>Create Playbook</span>
        </motion.button>
      </div>

      {/* ══════════════════════════════════════════════════════ */}
      {/* Playbook Cards                                       */}
      {/* ══════════════════════════════════════════════════════ */}
      <div className="space-y-3">
        {filtered.map(playbook => {
          const isExpanded = expandedId === playbook.id;
          const sevColor = SEVERITY_COLORS[playbook.severity];
          const isRunning = runningPlaybook === playbook.id;
          const pbCompleted = completedSteps[playbook.id] || new Set();

          return (
            <motion.div key={playbook.id} layout className="rounded-xl overflow-hidden" style={{
              background: isRunning
                ? `linear-gradient(135deg, ${playbook.iconColor}04, ${playbook.iconColor}02)`
                : "linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
              border: `1px solid ${isRunning ? `${playbook.iconColor}18` : `${playbook.iconColor}10`}`,
            }}>
              <button onClick={() => setExpandedId(isExpanded ? null : playbook.id)}
                className="w-full flex items-start gap-4 p-5 text-left cursor-pointer">
                <GlowIcon icon={playbook.icon} color={playbook.iconColor} size={44} iconSize={20}
                  pulse={isRunning} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary }}>{playbook.name}</span>
                    <Badge variant={playbook.severity === "critical" ? "danger" : playbook.severity === "high" ? "warning" : "info"} size="sm">
                      {playbook.severity.toUpperCase()}
                    </Badge>
                    {playbook.autoTrigger && (
                      <Badge color="#FF9500" size="sm">
                        <Zap size={8} style={{ marginRight: 3 }} /> AUTO
                      </Badge>
                    )}
                    {isRunning && (
                      <Badge variant="success" pulse size="sm">RUNNING</Badge>
                    )}
                  </div>
                  <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginTop: 4 }}>{playbook.description}</p>
                  <div className="flex items-center gap-3 mt-3">
                    <StatPill label="Steps" value={playbook.steps.length} color="#00C8E0" />
                    <StatPill label="Used" value={`${playbook.useCount}x`} color="#7B5EFF" />
                    {playbook.lastUsed && (
                      <span className="flex items-center gap-1" style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>
                        <Clock size={9} /> Last: {Math.round((Date.now() - playbook.lastUsed.getTime()) / 3600000)}h ago
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={16} color="rgba(255,255,255,0.15)"
                  style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", marginTop: 4 }} />
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-5 pb-5" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 16 }}>
                      {/* Timeline Steps */}
                      <div className="relative pl-8">
                        {/* Vertical line */}
                        <div className="absolute left-[14px] top-3 bottom-3 w-px"
                          style={{ background: `linear-gradient(180deg, ${playbook.iconColor}25, ${playbook.iconColor}05)` }} />

                        {playbook.steps.map((step, i) => {
                          const StepIcon = step.icon;
                          const isStepCompleted = pbCompleted.has(step.id);
                          return (
                            <motion.div
                              key={step.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.06 }}
                              className="relative flex items-start gap-4 mb-3"
                            >
                              {/* Step Node */}
                              <div className="absolute -left-8" style={{ top: 4 }}>
                                <div className="size-7 rounded-lg flex items-center justify-center" style={{
                                  background: isStepCompleted
                                    ? "linear-gradient(135deg, rgba(0,200,83,0.2), rgba(0,200,83,0.08))"
                                    : `linear-gradient(135deg, ${step.color}18, ${step.color}08)`,
                                  border: `1px solid ${isStepCompleted ? "rgba(0,200,83,0.25)" : `${step.color}20`}`,
                                  boxShadow: `0 2px 8px ${isStepCompleted ? "rgba(0,200,83,0.1)" : `${step.color}08`}`,
                                }}>
                                  {isStepCompleted
                                    ? <CheckCircle2 size={13} color="#00C853" strokeWidth={2} />
                                    : <StepIcon size={13} color={step.color} strokeWidth={1.8} />
                                  }
                                </div>
                              </div>

                              {/* Step Content */}
                              <div className="flex-1 p-3 rounded-xl" style={{
                                background: isStepCompleted ? "rgba(0,200,83,0.02)" : "rgba(255,255,255,0.02)",
                                border: `1px solid ${isStepCompleted ? "rgba(0,200,83,0.08)" : "rgba(255,255,255,0.04)"}`,
                              }}>
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>#{i + 1}</span>
                                      <p style={{
                                        ...TYPOGRAPHY.bodySm,
                                        color: isStepCompleted ? "rgba(255,255,255,0.3)" : TOKENS.text.primary,
                                        textDecoration: isStepCompleted ? "line-through" : "none",
                                        fontWeight: 600,
                                      }}>
                                        {step.action}
                                      </p>
                                    </div>
                                    <p style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted, marginTop: 3 }}>
                                      {step.responsible}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{
                                      background: "rgba(255,149,0,0.06)", border: "1px solid rgba(255,149,0,0.1)",
                                    }}>
                                      <Timer size={9} color="rgba(255,149,0,0.5)" />
                                      <span style={{ ...TYPOGRAPHY.micro, color: "rgba(255,149,0,0.5)" }}>{step.timeLimit}</span>
                                    </div>
                                    {isRunning && !isStepCompleted && (
                                      <motion.button
                                        whileTap={{ scale: 0.9 }}
                                        onClick={(e) => { e.stopPropagation(); handleCompleteStep(playbook.id, step.id, step.action); }}
                                        className="size-6 rounded-lg flex items-center justify-center"
                                        style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)", cursor: "pointer" }}>
                                        <CheckCircle size={12} color="#00C853" />
                                      </motion.button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>

                      {/* Progress (when running) */}
                      {isRunning && (
                        <div className="mt-4 p-3 rounded-xl" style={{ background: `${playbook.iconColor}04`, border: `1px solid ${playbook.iconColor}10` }}>
                          <div className="flex items-center justify-between mb-2">
                            <span style={{ ...TYPOGRAPHY.caption, color: playbook.iconColor, fontWeight: 700 }}>Protocol Progress</span>
                            <span style={{ ...TYPOGRAPHY.micro, color: playbook.iconColor }}>
                              {pbCompleted.size}/{playbook.steps.length} steps
                            </span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                            <motion.div
                              animate={{ width: `${(pbCompleted.size / playbook.steps.length) * 100}%` }}
                              transition={{ duration: 0.4 }}
                              className="h-full rounded-full"
                              style={{ background: `linear-gradient(90deg, ${playbook.iconColor}80, ${playbook.iconColor})` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-3 mt-4 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                        <ActionButton
                          icon={isRunning ? Activity : Play}
                          label={isRunning ? "Running..." : "Run Playbook"}
                          color={playbook.iconColor}
                          onClick={() => handleRunPlaybook(playbook)}
                          done={isRunning}
                        />
                        <ActionButton
                          icon={Copy}
                          label="Duplicate"
                          color="#7B5EFF"
                          onClick={() => handleDuplicate(playbook)}
                        />
                        <ActionButton
                          icon={Pencil}
                          label="Edit"
                          color="#00C8E0"
                          onClick={() => handleEdit(playbook)}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>

      {/* ═════════════════════════════════════════════════════════ */}
      {/* CREATE PLAYBOOK MODAL                                   */}
      {/* ═════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showCreateModal && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
              onClick={() => setShowCreateModal(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] rounded-2xl overflow-hidden"
              style={{
                background: "linear-gradient(135deg, #0A1220 0%, #050710 100%)",
                border: "1px solid rgba(0,200,224,0.15)",
                boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 60px rgba(0,200,224,0.05)",
              }}>
              {/* Header */}
              <div className="flex items-center justify-between p-6" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="flex items-center gap-3">
                  <GlowIcon icon={BookOpen} color="#00C8E0" size={40} iconSize={18} />
                  <div>
                    <h3 style={{ ...TYPOGRAPHY.h2, color: TOKENS.text.primary }}>Create Playbook</h3>
                    <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginTop: 2 }}>Define a new emergency response protocol</p>
                  </div>
                </div>
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowCreateModal(false)}
                  className="size-9 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>
                  <X size={16} color="rgba(255,255,255,0.4)" />
                </motion.button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-5">
                {/* Name */}
                <div>
                  <label style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, display: "block", marginBottom: 8 }}>PLAYBOOK NAME</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Chemical Spill Response"
                    style={{ ...inputStyle, caretColor: "#00C8E0" }} />
                </div>

                {/* Description */}
                <div>
                  <label style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, display: "block", marginBottom: 8 }}>DESCRIPTION</label>
                  <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Brief description of when this playbook is used"
                    style={{ ...inputStyle, caretColor: "#00C8E0" }} />
                </div>

                {/* Severity */}
                <div>
                  <label style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, display: "block", marginBottom: 8 }}>SEVERITY LEVEL</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(["critical", "high", "medium", "low"] as const).map(sev => {
                      const c = SEVERITY_COLORS[sev];
                      const active = newSeverity === sev;
                      return (
                        <motion.button key={sev} whileTap={{ scale: 0.95 }} onClick={() => setNewSeverity(sev)}
                          className="py-2.5 rounded-xl text-center" style={{
                            background: active ? `${c}15` : "rgba(255,255,255,0.02)",
                            border: `1px solid ${active ? `${c}35` : "rgba(255,255,255,0.06)"}`,
                            cursor: "pointer",
                          }}>
                          <span style={{ ...TYPOGRAPHY.caption, fontWeight: active ? 700 : 500, color: active ? c : TOKENS.text.muted, textTransform: "uppercase" }}>
                            {sev}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>

                {/* Trigger Type + Auto-trigger */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, display: "block", marginBottom: 8 }}>TRIGGER TYPE</label>
                    <select value={newTrigger} onChange={e => setNewTrigger(e.target.value)} style={selectStyle}>
                      {["Manual Trigger", "SOS Button", "Fall Detected", "Missed Check-in", "Environmental Hazard", "Security Threat", "Geofence Breach"].map(t => (
                        <option key={t} value={t} style={{ background: "#0A1220" }}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ ...TYPOGRAPHY.overline, color: TOKENS.text.muted, display: "block", marginBottom: 8 }}>AUTO-TRIGGER</label>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => setNewAutoTrigger(!newAutoTrigger)}
                      className="w-full flex items-center justify-between py-2.5 px-4 rounded-xl" style={{
                        background: newAutoTrigger ? "rgba(255,149,0,0.06)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${newAutoTrigger ? "rgba(255,149,0,0.18)" : "rgba(255,255,255,0.06)"}`,
                        cursor: "pointer",
                      }}>
                      <div className="flex items-center gap-2">
                        <Zap size={14} color={newAutoTrigger ? "#FF9500" : "rgba(255,255,255,0.2)"} />
                        <span style={{ ...TYPOGRAPHY.caption, color: newAutoTrigger ? "#FF9500" : TOKENS.text.muted }}>
                          {newAutoTrigger ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <div className="w-9 h-5 rounded-full relative" style={{
                        background: newAutoTrigger ? "rgba(255,149,0,0.3)" : "rgba(255,255,255,0.06)",
                        transition: "background 0.2s",
                      }}>
                        <motion.div animate={{ x: newAutoTrigger ? 16 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          className="absolute top-0.5 left-0.5 size-4 rounded-full" style={{
                            background: newAutoTrigger ? "#FF9500" : "rgba(255,255,255,0.2)",
                          }} />
                      </div>
                    </motion.button>
                  </div>
                </div>

                {/* Info */}
                <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.08)" }}>
                  <Sparkles size={16} color="#00C8E0" style={{ marginTop: 2, flexShrink: 0 }} />
                  <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, lineHeight: 1.6 }}>
                    3 default steps will be added. You can customize steps after creation using the Edit button.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex gap-3 p-6" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <motion.button whileTap={{ scale: 0.97 }} onClick={() => setShowCreateModal(false)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                  <span style={{ ...TYPOGRAPHY.caption, color: TOKENS.text.muted, fontWeight: 600 }}>Cancel</span>
                </motion.button>
                <motion.button whileTap={{ scale: 0.97 }} whileHover={{ scale: 1.01 }} onClick={handleConfirmCreate}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
                  style={{
                    background: newName.trim() ? "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.08))" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${newName.trim() ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.04)"}`,
                    cursor: newName.trim() ? "pointer" : "not-allowed",
                    opacity: newName.trim() ? 1 : 0.5,
                  }}>
                  <Plus size={15} color="#00C8E0" />
                  <span style={{ ...TYPOGRAPHY.caption, color: "#00C8E0", fontWeight: 600 }}>Create Playbook</span>
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Action Button ─────────────────────────────────────────────
function ActionButton({ icon: Icon, label, color, onClick, done }: {
  icon: any; label: string; color: string; onClick: () => void; done?: boolean;
}) {
  return (
    <motion.button
      whileHover={!done ? { scale: 1.03 } : {}}
      whileTap={!done ? { scale: 0.96 } : {}}
      onClick={!done ? onClick : undefined}
      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl transition-all"
      style={{
        background: done ? "rgba(0,200,83,0.06)" : `${color}06`,
        border: `1px solid ${done ? "rgba(0,200,83,0.15)" : `${color}12`}`,
        color: done ? "#00C853" : color,
        cursor: done ? "default" : "pointer",
        ...TYPOGRAPHY.caption,
        fontWeight: 600,
      }}>
      <Icon size={14} strokeWidth={1.8} />
      {label}
    </motion.button>
  );
}