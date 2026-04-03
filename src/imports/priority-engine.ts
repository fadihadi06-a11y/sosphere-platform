// ════════════════════════════════════════════════════════════════
// PRIORITY ENGINE — Intelligent Emergency Queue System
// Automatic ranking by Severity + FIFO within same level
// Manual Override capability with full Audit Trail
// ════════════════════════════════════════════════════════════════

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface Emergency {
  id: string;
  severity: SeverityLevel;
  timestamp: Date;
  isOwned?: boolean;
  ownedBy?: string;
  ownedAt?: Date;
  manualPriority?: number; // Manual override priority (lower = higher priority)
  manualPriorityReason?: string;
  manualPriorityBy?: string;
  manualPriorityAt?: Date;
  [key: string]: any;
}

export interface PriorityOverrideLog {
  emergencyId: string;
  action: 'pin_as_active' | 'move_to_top' | 'manual_reorder';
  performedBy: string;
  performedAt: Date;
  reason: string;
  previousPosition: number;
  newPosition: number;
}

// Severity weight (lower = higher priority)
const SEVERITY_WEIGHT: Record<SeverityLevel, number> = {
  critical: 0,
  high: 1000,
  medium: 2000,
  low: 3000,
};

/**
 * Sort emergencies by priority:
 * 1. Manual priority override (if set)
 * 2. Severity (Critical > High > Medium > Low)
 * 3. Timestamp (oldest first within same severity)
 */
export function sortByPriority(emergencies: Emergency[]): Emergency[] {
  return [...emergencies].sort((a, b) => {
    // 1. Manual priority override takes precedence
    if (a.manualPriority !== undefined && b.manualPriority === undefined) return -1;
    if (a.manualPriority === undefined && b.manualPriority !== undefined) return 1;
    if (a.manualPriority !== undefined && b.manualPriority !== undefined) {
      return a.manualPriority - b.manualPriority;
    }

    // 2. Severity weight
    const severityDiff = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
    if (severityDiff !== 0) return severityDiff;

    // 3. Timestamp (oldest first)
    return a.timestamp.getTime() - b.timestamp.getTime();
  });
}

/**
 * Get the highest priority emergency (active focus)
 */
export function getActiveFocus(emergencies: Emergency[]): Emergency | null {
  const sorted = sortByPriority(emergencies.filter(e => !e.isOwned));
  return sorted[0] || null;
}

/**
 * Get queued emergencies (excluding active focus)
 */
export function getQueuedEmergencies(emergencies: Emergency[], activeFocusId: string | null): Emergency[] {
  return sortByPriority(emergencies.filter(e => !e.isOwned && e.id !== activeFocusId));
}

/**
 * Pin emergency as active focus (manual override)
 * Returns updated emergencies array + audit log entry
 */
export function pinAsActive(
  emergencies: Emergency[],
  emergencyId: string,
  reason: string,
  performedBy: string
): { emergencies: Emergency[]; auditLog: PriorityOverrideLog } {
  const sorted = sortByPriority(emergencies);
  const targetIndex = sorted.findIndex(e => e.id === emergencyId);
  
  if (targetIndex === -1) {
    throw new Error(`Emergency ${emergencyId} not found`);
  }

  if (!reason || reason.trim().length < 10) {
    throw new Error('Reason must be at least 10 characters');
  }

  const updated = emergencies.map(e => {
    if (e.id === emergencyId) {
      return {
        ...e,
        manualPriority: -1, // Top priority
        manualPriorityReason: reason,
        manualPriorityBy: performedBy,
        manualPriorityAt: new Date(),
      };
    }
    return e;
  });

  const auditLog: PriorityOverrideLog = {
    emergencyId,
    action: 'pin_as_active',
    performedBy,
    performedAt: new Date(),
    reason,
    previousPosition: targetIndex,
    newPosition: 0,
  };

  return { emergencies: updated, auditLog };
}

/**
 * Clear manual priority override
 */
export function clearManualPriority(emergencies: Emergency[], emergencyId: string): Emergency[] {
  return emergencies.map(e => {
    if (e.id === emergencyId) {
      const { manualPriority, manualPriorityReason, manualPriorityBy, manualPriorityAt, ...rest } = e;
      return rest;
    }
    return e;
  });
}

/**
 * Mark emergency as owned (locked to a specific admin)
 */
export function markAsOwned(emergencies: Emergency[], emergencyId: string, ownedBy: string): Emergency[] {
  return emergencies.map(e => {
    if (e.id === emergencyId) {
      return {
        ...e,
        isOwned: true,
        ownedBy,
        ownedAt: new Date(),
      };
    }
    return e;
  });
}

/**
 * Remove emergency from queue (resolved/completed)
 */
export function removeEmergency(emergencies: Emergency[], emergencyId: string): Emergency[] {
  return emergencies.filter(e => e.id !== emergencyId);
}

/**
 * Get emergency stats
 */
export function getEmergencyStats(emergencies: Emergency[]) {
  const unowned = emergencies.filter(e => !e.isOwned);
  
  return {
    total: emergencies.length,
    unowned: unowned.length,
    owned: emergencies.length - unowned.length,
    critical: unowned.filter(e => e.severity === 'critical').length,
    high: unowned.filter(e => e.severity === 'high').length,
    medium: unowned.filter(e => e.severity === 'medium').length,
    low: unowned.filter(e => e.severity === 'low').length,
    withManualOverride: unowned.filter(e => e.manualPriority !== undefined).length,
  };
}