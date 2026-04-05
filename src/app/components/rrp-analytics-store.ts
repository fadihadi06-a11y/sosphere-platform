// ═══════════════════════════════════════════════════════════════
// SOSphere — RRP Analytics Store
// ─────────────────────────────────────────────────────────────
// Tracks every Rapid Response Protocol session: response times,
// action completion rates, threat types, escalation events.
// Persistent via localStorage.
// ═══════════════════════════════════════════════════════════════

import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";

const STORAGE_KEY = "sosphere_rrp_analytics";

// ── Types ─────────────────────────────────────────────────────

export interface RRPSession {
  id: string;
  emergencyId: string;
  employeeName: string;
  zone: string;
  sosType: string;
  severity: string;
  threatLevel: string;
  totalTimeSec: number;
  actionsTotal: number;
  actionsCompleted: number;
  perActionTimes: number[];     // seconds per action
  autoEscalated: boolean;
  openedIRE: boolean;           // did admin upgrade to full IRE?
  timestamp: string;            // ISO
}

export interface RRPAnalytics {
  totalSessions: number;
  avgResponseTime: number;       // seconds
  fastestResponse: number;
  slowestResponse: number;
  avgActionsCompleted: number;
  completionRate: number;        // 0-100%
  autoEscalationRate: number;    // 0-100%
  ireUpgradeRate: number;        // 0-100%
  sessionsByType: Record<string, number>;
  sessionsBySeverity: Record<string, number>;
  timelineData: { date: string; avgTime: number; count: number }[];
  recentSessions: RRPSession[];  // last 20
  speedTrend: "improving" | "stable" | "declining";
  speedRating: "ELITE" | "FAST" | "GOOD" | "AVERAGE" | "SLOW";
  speedRatingColor: string;
  avgPerAction: number;          // avg seconds per individual action
  bestStreak: number;            // consecutive sessions under 60s
  currentStreak: number;
}

// ── Load / Save ───────────────────────────────────────────────

function loadSessions(): RRPSession[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}

function saveSessions(sessions: RRPSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

// ── Record Session ────────────────────────────────────────────

export function recordRRPSession(session: Omit<RRPSession, "id" | "timestamp">): RRPSession {
  const sessions = loadSessions();
  const record: RRPSession = {
    ...session,
    id: `RRP-${Date.now().toString(36).toUpperCase()}`,
    timestamp: new Date().toISOString(),
  };
  sessions.push(record);
  // Keep max 200 sessions
  if (sessions.length > 200) sessions.splice(0, sessions.length - 200);
  saveSessions(sessions);

  // Background: save to Supabase
  if (SUPABASE_CONFIG.isConfigured) {
    supabase.from("rrp_sessions").insert({
      id: record.id,
      emergency_id: record.emergencyId,
      employee_name: record.employeeName,
      zone: record.zone,
      sos_type: record.sosType,
      severity: record.severity,
      threat_level: record.threatLevel,
      total_time_sec: record.totalTimeSec,
      actions_total: record.actionsTotal,
      actions_completed: record.actionsCompleted,
      per_action_times: record.perActionTimes,
      auto_escalated: record.autoEscalated,
      opened_ire: record.openedIRE,
      created_at: record.timestamp,
    }).then(() => {}).catch((e: any) => console.warn("[RRP] Supabase save failed:", e));
  }

  return record;
}

// ── Get Analytics ─────────────────────────────────────────────

export function getRRPAnalytics(): RRPAnalytics {
  const sessions = loadSessions();

  if (sessions.length === 0) {
    return {
      totalSessions: 0,
      avgResponseTime: 0,
      fastestResponse: 0,
      slowestResponse: 0,
      avgActionsCompleted: 0,
      completionRate: 0,
      autoEscalationRate: 0,
      ireUpgradeRate: 0,
      sessionsByType: {},
      sessionsBySeverity: {},
      timelineData: [],
      recentSessions: [],
      speedTrend: "stable",
      speedRating: "AVERAGE",
      speedRatingColor: "#FF9500",
      avgPerAction: 0,
      bestStreak: 0,
      currentStreak: 0,
    };
  }

  const times = sessions.map(s => s.totalTimeSec);
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const fastest = Math.min(...times);
  const slowest = Math.max(...times);

  const allActionTimes = sessions.flatMap(s => s.perActionTimes);
  const avgPerAction = allActionTimes.length > 0
    ? allActionTimes.reduce((a, b) => a + b, 0) / allActionTimes.length
    : 0;

  const avgActions = sessions.reduce((s, r) => s + r.actionsCompleted, 0) / sessions.length;
  const completionRate = sessions.reduce((s, r) => s + (r.actionsCompleted / r.actionsTotal) * 100, 0) / sessions.length;
  const autoEscRate = (sessions.filter(s => s.autoEscalated).length / sessions.length) * 100;
  const ireRate = (sessions.filter(s => s.openedIRE).length / sessions.length) * 100;

  // By type
  const byType: Record<string, number> = {};
  sessions.forEach(s => { byType[s.sosType] = (byType[s.sosType] || 0) + 1; });

  // By severity
  const bySev: Record<string, number> = {};
  sessions.forEach(s => { bySev[s.severity] = (bySev[s.severity] || 0) + 1; });

  // Timeline (group by date)
  const dateMap: Record<string, { total: number; count: number }> = {};
  sessions.forEach(s => {
    const d = s.timestamp.slice(0, 10);
    if (!dateMap[d]) dateMap[d] = { total: 0, count: 0 };
    dateMap[d].total += s.totalTimeSec;
    dateMap[d].count += 1;
  });
  const timeline = Object.entries(dateMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { total, count }]) => ({ date, avgTime: Math.round(total / count), count }));

  // Speed trend
  const recent5 = sessions.slice(-5).map(s => s.totalTimeSec);
  const older5 = sessions.slice(-10, -5).map(s => s.totalTimeSec);
  let trend: "improving" | "stable" | "declining" = "stable";
  if (recent5.length >= 3 && older5.length >= 3) {
    const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
    const olderAvg = older5.reduce((a, b) => a + b, 0) / older5.length;
    if (recentAvg < olderAvg * 0.85) trend = "improving";
    else if (recentAvg > olderAvg * 1.15) trend = "declining";
  }

  // Speed rating
  let speedRating: RRPAnalytics["speedRating"] = "AVERAGE";
  let speedRatingColor = "#FF9500";
  if (avgTime <= 30) { speedRating = "ELITE"; speedRatingColor = "#FFD700"; }
  else if (avgTime <= 45) { speedRating = "FAST"; speedRatingColor = "#00C853"; }
  else if (avgTime <= 60) { speedRating = "GOOD"; speedRatingColor = "#00C8E0"; }
  else if (avgTime <= 90) { speedRating = "AVERAGE"; speedRatingColor = "#FF9500"; }
  else { speedRating = "SLOW"; speedRatingColor = "#FF2D55"; }

  // Streaks (sessions under 60s)
  let currentStreak = 0;
  let bestStreak = 0;
  let streak = 0;
  for (const s of sessions) {
    if (s.totalTimeSec < 60 && s.actionsCompleted === s.actionsTotal) {
      streak++;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
  }
  currentStreak = streak;

  return {
    totalSessions: sessions.length,
    avgResponseTime: Math.round(avgTime),
    fastestResponse: fastest,
    slowestResponse: slowest,
    avgActionsCompleted: Math.round(avgActions * 10) / 10,
    completionRate: Math.round(completionRate),
    autoEscalationRate: Math.round(autoEscRate),
    ireUpgradeRate: Math.round(ireRate),
    sessionsByType: byType,
    sessionsBySeverity: bySev,
    timelineData: timeline,
    recentSessions: sessions.slice(-20).reverse(),
    speedTrend: trend,
    speedRating,
    speedRatingColor,
    avgPerAction: Math.round(avgPerAction),
    bestStreak,
    currentStreak,
  };
}

// ── Generate Mock Data ────────────────────────────────────────
// Used to populate analytics for demo purposes

export function seedMockRRPData() {
  const existing = loadSessions();
  if (existing.length >= 5) return; // already has data

  const types = ["sos_button", "fall_detected", "shake_sos", "missed_checkin", "journey_sos", "medical"];
  const sevs = ["critical", "high", "medium"];
  const zones = ["Zone A - Construction", "Zone B - Office", "Zone C - Warehouse", "Zone D - Field"];
  const names = ["Ahmed Al-Rashid", "Fatima Al-Sayed", "Khalid Omar", "Noura Hassan", "Omar Fahad", "Sara Al-Dubai"];
  const threats = ["CRITICAL", "HIGH", "ELEVATED"];

  const mockSessions: RRPSession[] = [];
  const now = Date.now();

  for (let i = 0; i < 25; i++) {
    const actionsTotal = 3 + Math.floor(Math.random() * 2);
    const actionsCompleted = Math.random() > 0.1 ? actionsTotal : actionsTotal - 1;
    const perActionTimes = Array.from({ length: actionsCompleted }, () => 5 + Math.floor(Math.random() * 20));
    const totalTime = perActionTimes.reduce((a, b) => a + b, 0) + Math.floor(Math.random() * 10);

    mockSessions.push({
      id: `RRP-MOCK-${i}`,
      emergencyId: `EMG-MOCK-${i}`,
      employeeName: names[Math.floor(Math.random() * names.length)],
      zone: zones[Math.floor(Math.random() * zones.length)],
      sosType: types[Math.floor(Math.random() * types.length)],
      severity: sevs[Math.floor(Math.random() * sevs.length)],
      threatLevel: threats[Math.floor(Math.random() * threats.length)],
      totalTimeSec: totalTime,
      actionsTotal,
      actionsCompleted,
      perActionTimes,
      autoEscalated: Math.random() > 0.85,
      openedIRE: Math.random() > 0.7,
      timestamp: new Date(now - (25 - i) * 86400000 * (0.5 + Math.random())).toISOString(),
    });
  }

  saveSessions([...existing, ...mockSessions]);
}
