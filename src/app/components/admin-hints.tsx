// ═══════════════════════════════════════════════════════════════
// SOSphere — Smart Admin Hints System
// ─────────────────────────────────────────────────────────────
// Contextual "ghost text" hints that guide the admin at every
// step without being intrusive. Changes based on:
//   - Current page
//   - Active emergencies
//   - Time of day
//   - Missing setup items
//   - Recent actions
// ─────────────────────────────────────────────────────────────
// "Like having a safety expert whispering in your ear"
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lightbulb, X, Sparkles, ArrowRight, Info } from "lucide-react";

// ── Hint Definition ───────────────────────────────────────────
interface AdminHint {
  id: string;
  text: string;
  action?: string;        // "Try this:" / "Next step:" / "Pro tip:"
  actionLabel?: string;    // Button text like "Go to Zones →"
  navigateTo?: string;     // Dashboard page to navigate to
  priority: "info" | "suggest" | "action" | "urgent";
  condition?: string;      // When to show this hint
}

// ── Page-specific hints ───────────────────────────────────────
const PAGE_HINTS: Record<string, AdminHint[]> = {
  overview: [
    { id: "ov-1", text: "This is your command center. Green means safe. If anything turns red or orange, click it immediately.", action: "💡 Pro tip", priority: "info" },
    { id: "ov-2", text: "Set up your zones first to unlock zone-specific monitoring. Each zone can have its own risk level and evacuation point.", action: "🎯 Next step", actionLabel: "Set Up Zones →", navigateTo: "location", priority: "suggest" },
    { id: "ov-3", text: "Your Safety Score updates in real-time based on check-ins, response times, and incident resolution. Keep it above 85 for optimal safety.", action: "📊 Did you know?", priority: "info" },
  ],
  emergencyHub: [
    { id: "eh-1", text: "When an SOS comes in, click it to open the response popup. The 'Guide Me' button will walk you through every step.", action: "🆘 Quick guide", priority: "action" },
    { id: "eh-2", text: "You can create a test emergency to train your team. It won't send real alerts — perfect for drills.", action: "🧪 Try this", actionLabel: "Create Test Emergency →", priority: "suggest" },
    { id: "eh-3", text: "Active emergencies pulse red. The timer shows how long since the alert was triggered. Response under 3 minutes is considered excellent.", action: "⏱️ Benchmark", priority: "info" },
  ],
  employees: [
    { id: "emp-1", text: "Click any employee row to see their full profile, Medical ID, incident history, and real-time GPS location.", action: "👆 Tip", priority: "info" },
    { id: "emp-2", text: "Import employees via CSV for bulk onboarding. Each employee gets a unique invite code to join the app.", action: "📋 Bulk import", actionLabel: "Import CSV →", priority: "suggest" },
    { id: "emp-3", text: "Employees with red status badges need immediate attention — they might have an active SOS or missed check-in.", action: "⚠️ Watch for", priority: "action" },
  ],
  location: [
    { id: "loc-1", text: "Each zone should have at least one evacuation point and one Zone Admin assigned. This is required for the evacuation feature to work.", action: "🗺️ Important", priority: "action" },
    { id: "loc-2", text: "Risk levels affect how the system prioritizes alerts. High-risk zones trigger faster escalation and louder notifications.", action: "⚡ How it works", priority: "info" },
  ],
  comms: [
    { id: "com-1", text: "Broadcasts reach all employees instantly. Use 'Zone-specific' to target only workers in a specific area.", action: "📢 Tip", priority: "info" },
    { id: "com-2", text: "The evacuation system auto-sends push notifications + in-app alerts to every worker in the affected zone.", action: "🏃 Did you know?", priority: "info" },
  ],
  riskMap: [
    { id: "rm-1", text: "The live map shows real-time GPS positions. Red dots are SOS alerts. Orange dots are late check-ins. Tap any dot for details.", action: "🗺️ Guide", priority: "info" },
    { id: "rm-2", text: "Geofencing alerts trigger automatically when a worker leaves their assigned zone. You'll get a notification within seconds.", action: "📍 Auto-alert", priority: "info" },
  ],
  analytics: [
    { id: "an-1", text: "These analytics help you identify patterns. If one zone has more incidents, consider increasing its risk level or adding safety equipment.", action: "📊 Insight", priority: "suggest" },
    { id: "an-2", text: "Export reports as PDF for compliance documentation. Required for OSHA, ISO 45001, and insurance audits.", action: "📄 Compliance", actionLabel: "Go to Reports →", navigateTo: "playbook", priority: "suggest" },
  ],
  roles: [
    { id: "ro-1", text: "Each zone can have up to 2 Zone Admins (Lead + Secondary). They receive emergency alerts for their specific zone only.", action: "👥 Structure", priority: "info" },
    { id: "ro-2", text: "The permission hierarchy is: Owner → Main Admin → Zone Admin → Field Worker. Higher roles can do everything lower roles can.", action: "🔑 Permissions", priority: "info" },
  ],
  billing: [
    { id: "bi-1", text: "Your plan determines how many employees can join. Upgrade anytime — the change takes effect immediately.", action: "💳 Plan info", priority: "info" },
    { id: "bi-2", text: "The 14-day free trial includes all features. No credit card required until you choose to subscribe.", action: "🆓 Free trial", priority: "info" },
  ],
  settings: [
    { id: "se-1", text: "Configure check-in intervals, escalation timers, and notification preferences here. These apply to all employees.", action: "⚙️ Settings", priority: "info" },
  ],
  buddySystem: [
    { id: "bs-1", text: "Pair workers who are in the same zone. When one triggers SOS, their buddy gets an instant alert with GPS location — they're usually the fastest to respond.", action: "👥 How it works", priority: "info" },
    { id: "bs-2", text: "Unpaired workers appear at the bottom. Pair them now so every worker has a safety partner.", action: "🎯 Action needed", actionLabel: "Create Pair →", priority: "action" },
  ],
  checklist: [
    { id: "cl-1", text: "Workers complete this checklist before every shift. Items marked 'Required' must be checked — otherwise the worker gets flagged.", action: "📋 Compliance", priority: "info" },
    { id: "cl-2", text: "You can create custom checklists per zone or role. High-risk zones should have more items (gas detectors, respiratory gear, etc.).", action: "🔧 Customize", priority: "suggest" },
  ],
  playbook: [
    { id: "pb-1", text: "Playbooks are your pre-planned response protocols. When an emergency hits, click 'Run Playbook' to follow the steps — no thinking needed under pressure.", action: "📖 Purpose", priority: "info" },
    { id: "pb-2", text: "Auto-trigger playbooks activate automatically when a matching emergency type is detected. Manual playbooks need to be started by an admin.", action: "⚡ Auto vs Manual", priority: "info" },
  ],
  safetyIntel: [
    { id: "si-1", text: "The Safety Intelligence Engine predicts risks before they happen. It analyzes patterns from past incidents, weather, and worker behavior.", action: "🧠 AI-Powered", priority: "info" },
  ],
  auditLog: [
    { id: "al-1", text: "Every action in the system is logged here — logins, emergency responses, setting changes. Use this for accountability and compliance audits.", action: "📝 Audit trail", priority: "info" },
  ],
  workforce: [
    { id: "wf-1", text: "Track shift schedules, attendance, and overtime. Workers who haven't checked in during their shift are highlighted in orange.", action: "📅 Overview", priority: "info" },
  ],
  weatherAlerts: [
    { id: "wa-1", text: "Weather alerts are auto-fetched based on your zone locations. Severe weather automatically suggests evacuation or work pause.", action: "🌦️ Auto-alert", priority: "info" },
    { id: "wa-2", text: "When a storm warning comes in, click 'Activate Protocol' to trigger the guided response for weather emergencies.", action: "⛈️ Action", priority: "action" },
  ],
  journeyMgmt: [
    { id: "jm-1", text: "Track field workers on route assignments. The system auto-detects deviation from planned route and alerts you if a worker goes off-path.", action: "🗺️ Route monitoring", priority: "info" },
    { id: "jm-2", text: "Set automatic check-in points along each journey. Workers are prompted to check in when they reach each waypoint.", action: "📍 Waypoints", priority: "suggest" },
  ],
  safetyScore: [
    { id: "ss-1", text: "Safety scores motivate workers through positive reinforcement. Top scorers get badges and recognition — proven to reduce incidents by 40%.", action: "🏆 Gamification", priority: "info" },
    { id: "ss-2", text: "The leaderboard resets monthly. Workers earn points for completing checklists, timely check-ins, reporting hazards, and zero-incident shifts.", action: "📈 How scoring works", priority: "info" },
  ],
  complianceReports: [
    { id: "cr-1", text: "Generate PDF reports for OSHA, ISO 45001, and insurance compliance. Reports include incident summaries, response times, and safety metrics.", action: "📄 Export", priority: "info" },
    { id: "cr-2", text: "Schedule automatic weekly or monthly reports to be generated. Keep your compliance documentation always up-to-date.", action: "📅 Auto-schedule", priority: "suggest" },
  ],
};

// ── Emergency-context hints ───────────────────────────────────
const EMERGENCY_HINTS: AdminHint[] = [
  { id: "emg-1", text: "Active emergency detected! Click on the red alert to open the response popup, then use 'Guide Me' for step-by-step instructions.", action: "🚨 URGENT", priority: "urgent" },
  { id: "emg-2", text: "Remember: Call the employee first (< 30 sec), then dispatch help if no answer (< 2 min). Speed saves lives.", action: "⏱️ Response target", priority: "urgent" },
];

// ═══════════════════════════════════════════════════════════════
// AdminHintBar — The floating contextual hint
// ═══════════════════════════════════════════════════════════════

export function AdminHintBar({
  currentPage,
  hasActiveEmergency,
  onNavigate,
}: {
  currentPage: string;
  hasActiveEmergency: boolean;
  onNavigate: (page: string) => void;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [currentHintIndex, setCurrentHintIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  // Get hints for current context
  const getHints = useCallback((): AdminHint[] => {
    // Only show hints during active emergencies — Guide Me covers non-emergency guidance
    if (hasActiveEmergency) {
      const emergencyHints = EMERGENCY_HINTS.filter(h => !dismissed.includes(h.id));
      if (emergencyHints.length > 0) return emergencyHints;
    }
    return [];
  }, [currentPage, hasActiveEmergency, dismissed]);

  const hints = getHints();

  // Rotate hints every 12 seconds
  useEffect(() => {
    if (hints.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentHintIndex(prev => (prev + 1) % hints.length);
    }, 12000);
    return () => clearInterval(timer);
  }, [hints.length]);

  // Reset index when page changes
  useEffect(() => {
    setCurrentHintIndex(0);
    setIsVisible(true);
  }, [currentPage]);

  if (hints.length === 0 || !isVisible) return null;

  const hint = hints[currentHintIndex % hints.length];
  if (!hint) return null;

  const priorityConfig = {
    info:    { color: "rgba(0,200,224,0.5)", bg: "rgba(0,200,224,0.03)", border: "rgba(0,200,224,0.06)", icon: Info },
    suggest: { color: "rgba(255,150,0,0.6)", bg: "rgba(255,150,0,0.03)", border: "rgba(255,150,0,0.06)", icon: Lightbulb },
    action:  { color: "rgba(0,200,83,0.6)",  bg: "rgba(0,200,83,0.03)",  border: "rgba(0,200,83,0.06)", icon: ArrowRight },
    urgent:  { color: "rgba(255,45,85,0.7)", bg: "rgba(255,45,85,0.04)", border: "rgba(255,45,85,0.08)", icon: Sparkles },
  };

  const cfg = priorityConfig[hint.priority];
  const HintIcon = cfg.icon;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={hint.id + currentHintIndex}
        initial={{ opacity: 0, y: -5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl mx-5 mb-3"
        style={{
          background: cfg.bg,
          border: `1px solid ${cfg.border}`,
        }}
      >
        <HintIcon className="size-3.5 flex-shrink-0" style={{ color: cfg.color }} />
        <div className="flex-1 min-w-0">
          {hint.action && (
            <span style={{ fontSize: 9, fontWeight: 700, color: cfg.color, marginRight: 6 }}>
              {hint.action}
            </span>
          )}
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.4 }}>
            {hint.text}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hint.actionLabel && hint.navigateTo && (
            <button
              onClick={() => onNavigate(hint.navigateTo!)}
              className="flex items-center gap-1 px-2 py-1 rounded-md"
              style={{ background: `${cfg.color}15`, border: `1px solid ${cfg.color}25` }}
            >
              <span style={{ fontSize: 9, color: cfg.color, fontWeight: 600, whiteSpace: "nowrap" }}>
                {hint.actionLabel}
              </span>
            </button>
          )}
          {hints.length > 1 && (
            <div className="flex items-center gap-0.5 ml-1">
              {hints.map((_, i) => (
                <div key={i} className="size-1 rounded-full"
                  style={{ background: i === currentHintIndex % hints.length ? cfg.color : "rgba(255,255,255,0.08)" }} />
              ))}
            </div>
          )}
          <button
            onClick={() => {
              setDismissed(prev => [...prev, hint.id]);
              if (hints.length <= 1) setIsVisible(false);
            }}
            className="size-5 rounded flex items-center justify-center ml-0.5"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            <X className="size-2.5" style={{ color: "rgba(255,255,255,0.15)" }} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════════════════════════
// PageHintOverlay — Inline hints within page content
// Shows once then fades out after a few seconds
// ═══════════════════════════════════════════════════════════════
export function InlineHint({
  text,
  type = "info",
  delay = 0,
  autoHide = true,
}: {
  text: string;
  type?: "info" | "action" | "success";
  delay?: number;
  autoHide?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(true), delay);
    let hideTimer: NodeJS.Timeout;
    if (autoHide) {
      hideTimer = setTimeout(() => {
        setHiding(true);
        setTimeout(() => setVisible(false), 500);
      }, delay + 8000);
    }
    return () => {
      clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [delay, autoHide]);

  if (!visible) return null;

  const colors = {
    info: "rgba(0,200,224,0.35)",
    action: "rgba(255,150,0,0.4)",
    success: "rgba(0,200,83,0.4)",
  };

  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: hiding ? 0 : 0.7 }}
      transition={{ duration: 0.5 }}
      style={{
        fontSize: 10,
        color: colors[type],
        fontStyle: "italic",
        marginTop: 4,
        fontWeight: 500,
      }}
    >
      {text}
    </motion.p>
  );
}