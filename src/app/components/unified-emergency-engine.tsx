// ═══════════════════════════════════════════════════════════════
// SOSphere — Unified Emergency Response Engine v2.0
// ─────────────────────────────────────────────────────────────
// DESIGN PRINCIPLE: The admin sees ONE interface, ZERO choices.
// The system auto-selects the best engine based on:
//   - Company plan (Premium → AI Co-Admin)
//   - Severity (Critical/High → IRE, Medium/Low → Guided)
//
// The admin never knows there are 3 engines underneath.
// They just see "the system helping them rescue someone."
//
// Why? Because in a real emergency:
//   - The admin is panicking
//   - Every second counts
//   - Choices = confusion = delays = danger
//   - ONE clear path = fast action = lives saved
// ═══════════════════════════════════════════════════════════════

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

// Import all three engines
import { AICoAdmin, type AICoAdminContext } from "./ai-co-admin";
import { IntelligentGuide, type IREContext } from "./intelligent-guide";
import { EmergencyResponseWizard, GuideMeButton } from "./guided-response";

// ── Types ────────────────────────────────────────────────────────

export type EngineType = "ai_co_admin" | "ire" | "guided";

export interface UnifiedEmergencyContext {
  emergencyId: string;
  employeeName: string;
  employeePhone?: string;
  employeeRole?: string;
  employeeBloodType?: string;
  employeeMedications?: string[];
  employeeAvatar?: string;
  zone: string;
  sosType: string;
  severity: "critical" | "high" | "medium" | "low";
  elapsed?: number;
  batteryLevel?: number;
  signalStrength?: "excellent" | "good" | "fair" | "poor" | "none";
  lastGPS?: { lat: number; lng: number; address?: string };
  timestamp: number;
  zoneEmployeeCount?: number;
  nearbyTeams?: { id: string; name: string; distance: string }[];
  phone?: string;
  isJourney?: boolean;
  journeyRoute?: string;
}

interface UnifiedEngineProps {
  context: UnifiedEmergencyContext;
  isPremium: boolean;
  onClose: () => void;
  onResolve?: (emergencyId: string) => void;
  onNavigate?: (page: string) => void;
  onOpenChat?: (emergencyId: string, employeeName: string) => void;
  adminName?: string;
  /** Force a specific engine (bypasses auto-routing) — used only by dashboard internals */
  forceEngine?: EngineType;
}

// ── Engine Selection Logic (invisible to admin) ──────────────────
// This is the BRAIN that decides which engine opens.
// The admin never sees this decision — it just happens.

function selectEngine(
  severity: "critical" | "high" | "medium" | "low",
  isPremium: boolean,
  forceEngine?: EngineType,
): EngineType {
  if (forceEngine) return forceEngine;

  // Premium users → AI Co-Admin (most capable, full automation)
  if (isPremium) return "ai_co_admin";

  // Critical/High severity → IRE (AI-powered protocols)
  if (severity === "critical" || severity === "high") return "ire";

  // Medium/Low → Guided step-by-step (simple, fast)
  return "guided";
}

// ── Context Adapters (convert unified → engine-specific) ─────────

function toAICoAdminContext(ctx: UnifiedEmergencyContext): AICoAdminContext {
  return {
    emergencyId: ctx.emergencyId,
    employeeName: ctx.employeeName,
    employeeAvatar: ctx.employeeAvatar,
    employeePhone: ctx.employeePhone || "",
    employeeRole: ctx.employeeRole,
    employeeBloodType: ctx.employeeBloodType,
    employeeMedications: ctx.employeeMedications,
    zone: ctx.zone,
    sosType: ctx.sosType,
    severity: ctx.severity,
    batteryLevel: ctx.batteryLevel,
    signalStrength: ctx.signalStrength,
    lastGPS: ctx.lastGPS,
    timestamp: ctx.timestamp,
    zoneEmployeeCount: ctx.zoneEmployeeCount,
    nearbyTeams: ctx.nearbyTeams,
  };
}

function toIREContext(ctx: UnifiedEmergencyContext): IREContext {
  return {
    emergencyId: ctx.emergencyId,
    employeeName: ctx.employeeName,
    employeeRole: ctx.employeeRole,
    zone: ctx.zone,
    sosType: ctx.sosType,
    severity: ctx.severity,
    elapsed: ctx.elapsed || 0,
    batteryLevel: ctx.batteryLevel,
    signalStrength: ctx.signalStrength,
    lastGPS: ctx.lastGPS ? { lat: ctx.lastGPS.lat, lng: ctx.lastGPS.lng } : undefined,
    phone: ctx.phone || ctx.employeePhone,
    isJourney: ctx.isJourney,
    journeyRoute: ctx.journeyRoute,
  };
}

function toGuidedContext(ctx: UnifiedEmergencyContext) {
  return {
    emergencyId: ctx.emergencyId,
    employeeName: ctx.employeeName,
    employeeRole: ctx.employeeRole,
    zone: ctx.zone,
    sosType: ctx.sosType,
    severity: ctx.severity,
    elapsed: ctx.elapsed || 0,
    batteryLevel: ctx.batteryLevel,
    signalStrength: ctx.signalStrength,
    lastGPS: ctx.lastGPS ? { lat: ctx.lastGPS.lat, lng: ctx.lastGPS.lng } : undefined,
    phone: ctx.phone || ctx.employeePhone,
  };
}

// ═══════════════════════════════════════════════════════════════
// Main Component — Unified Emergency Engine
// ═══════════════════════════════════════════════════════════════
// NO switcher, NO choices, NO confusion.
// Auto-selects → auto-opens → admin just follows the steps.

export function UnifiedEmergencyEngine({
  context,
  isPremium,
  onClose,
  onResolve,
  onNavigate,
  onOpenChat,
  adminName,
  forceEngine,
}: UnifiedEngineProps) {
  // Engine is selected ONCE on mount — no switching mid-emergency
  const [activeEngine] = useState<EngineType>(
    selectEngine(context.severity, isPremium, forceEngine)
  );

  return (
    <AnimatePresence mode="wait">
      {activeEngine === "ai_co_admin" && (
        <motion.div key="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <AICoAdmin
            context={toAICoAdminContext(context)}
            onClose={onClose}
            onEmergencyResolved={() => onResolve?.(context.emergencyId)}
          />
        </motion.div>
      )}

      {activeEngine === "ire" && (
        <motion.div key="ire" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <IntelligentGuide
            context={toIREContext(context)}
            onClose={onClose}
            onNavigate={onNavigate}
            onResolve={onResolve}
            onOpenChat={onOpenChat}
            adminName={adminName}
          />
        </motion.div>
      )}

      {activeEngine === "guided" && (
        <motion.div key="guided" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <EmergencyResponseWizard
            context={toGuidedContext(context)}
            onAction={() => {}}
            onNavigate={onNavigate || (() => {})}
            onClose={onClose}
            onResolve={onResolve || (() => {})}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Re-export for backward compatibility ─────────────────────────
export { GuideMeButton } from "./guided-response";
export type { AICoAdminContext } from "./ai-co-admin";
export type { IREContext } from "./intelligent-guide";
