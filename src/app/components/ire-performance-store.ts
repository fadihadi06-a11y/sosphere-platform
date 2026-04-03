// ═══════════════════════════════════════════════════════════════
// SOSphere — IRE Admin Performance Rating System
// ─────────────────────────────────────────────────────────────
// Tracks historical response scores, builds admin rating tiers,
// streaks, and provides AI-powered performance insights.
// Persisted via localStorage for cross-session continuity.
//
// PRODUCTION MIGRATION:
//   Replace localStorage with Supabase table "ire_records":
//   STORAGE_KEY reads  → supabase.from("ire_records").select("*").eq("company_id", companyId).order("created_at", { ascending: false })
//   STORAGE_KEY writes → supabase.from("ire_records").insert(record)
//   Schema defined in api/rls-policies.ts
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = "sosphere_ire_performance";

// ── Types ─────────────────────────────────────────────────────

export interface IRERecord {
  id: string;
  emergencyId: string;
  employeeName: string;
  zone: string;
  sosType: string;
  severity: string;
  responseScore: number;
  responseTimeSec: number;
  phasesCompleted: number;
  actionsCount: number;
  autoActionsCount: number;
  timestamp: string; // ISO
  threatLevel: number;
}

export interface AdminRating {
  tier: "PLATINUM" | "GOLD" | "SILVER" | "BRONZE" | "ROOKIE";
  tierColor: string;
  tierGlow: string;
  tierIcon: string;   // emoji stand-in
  avgScore: number;
  totalIncidents: number;
  bestScore: number;
  worstScore: number;
  avgResponseTime: number;
  currentStreak: number; // consecutive scores >= 70
  bestStreak: number;
  trend: "improving" | "stable" | "declining";
  recentScores: number[];   // last 10
  percentile: number;       // simulated 0-100
  insights: string[];
}

// ── Tier Calculation ──────────────────────────────────────────

function getTier(avg: number, total: number): AdminRating["tier"] {
  if (total < 2) return "ROOKIE";
  if (avg >= 88 && total >= 8) return "PLATINUM";
  if (avg >= 75 && total >= 5) return "GOLD";
  if (avg >= 55 && total >= 3) return "SILVER";
  return "BRONZE";
}

const TIER_STYLES: Record<AdminRating["tier"], { color: string; glow: string; icon: string }> = {
  PLATINUM: { color: "#E5E4E2", glow: "rgba(229,228,226,0.25)", icon: "crown" },
  GOLD:     { color: "#FFD700", glow: "rgba(255,215,0,0.25)",   icon: "star" },
  SILVER:   { color: "#C0C0C0", glow: "rgba(192,192,192,0.2)",  icon: "medal" },
  BRONZE:   { color: "#CD7F32", glow: "rgba(205,127,50,0.2)",   icon: "shield" },
  ROOKIE:   { color: "#00C8E0", glow: "rgba(0,200,224,0.2)",    icon: "zap" },
};

// ── Storage Helpers ───────────────────────────────────────────

function loadRecords(): IRERecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecords(records: IRERecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // quota
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Record a completed IRE response
 */
export function recordIREResponse(data: Omit<IRERecord, "id" | "timestamp">): IRERecord {
  const record: IRERecord = {
    ...data,
    id: `ire_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  const records = loadRecords();
  records.push(record);
  // Keep last 100
  if (records.length > 100) records.splice(0, records.length - 100);
  saveRecords(records);
  return record;
}

/**
 * Get admin performance rating with insights
 */
export function getAdminRating(): AdminRating {
  const records = loadRecords();
  if (records.length === 0) {
    return {
      tier: "ROOKIE", tierColor: "#00C8E0", tierGlow: "rgba(0,200,224,0.2)", tierIcon: "zap",
      avgScore: 0, totalIncidents: 0, bestScore: 0, worstScore: 0,
      avgResponseTime: 0, currentStreak: 0, bestStreak: 0,
      trend: "stable", recentScores: [], percentile: 50,
      insights: ["Complete your first IRE response to start building your rating."],
    };
  }

  const scores = records.map(r => r.responseScore);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const bestScore = Math.round(Math.max(...scores));
  const worstScore = Math.round(Math.min(...scores));
  const avgResponseTime = Math.round(records.reduce((a, r) => a + r.responseTimeSec, 0) / records.length);

  // Streak calculation
  let currentStreak = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].responseScore >= 70) currentStreak++;
    else break;
  }
  let bestStreak = 0, streak = 0;
  for (const r of records) {
    if (r.responseScore >= 70) { streak++; bestStreak = Math.max(bestStreak, streak); }
    else streak = 0;
  }

  // Trend
  const recentScores = scores.slice(-10);
  let trend: AdminRating["trend"] = "stable";
  if (recentScores.length >= 3) {
    const firstHalf = recentScores.slice(0, Math.floor(recentScores.length / 2));
    const secondHalf = recentScores.slice(Math.floor(recentScores.length / 2));
    const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    if (avg2 - avg1 > 5) trend = "improving";
    else if (avg1 - avg2 > 5) trend = "declining";
  }

  const tier = getTier(avgScore, records.length);
  const style = TIER_STYLES[tier];

  // Simulated percentile (based on score vs population)
  const percentile = Math.min(99, Math.max(1, Math.round(avgScore * 1.05 - 5 + (currentStreak * 2))));

  // AI Insights
  const insights: string[] = [];
  if (avgScore >= 85) insights.push("Outstanding performance -- your response speed consistently saves lives.");
  else if (avgScore >= 70) insights.push("Solid response pattern -- small improvements in early-phase actions could boost your score.");
  else insights.push("Room for improvement -- focus on faster initial contact and utilizing auto-actions.");

  if (currentStreak >= 5) insights.push(`Incredible ${currentStreak}-incident streak! Consistency is key to safety.`);
  else if (currentStreak >= 3) insights.push(`Strong ${currentStreak}-incident streak -- keep it going!`);

  if (trend === "improving") insights.push("Your scores are trending upward -- great progress!");
  else if (trend === "declining") insights.push("Scores trending down -- consider reviewing the IRE phase guides.");

  if (avgResponseTime < 120) insights.push("Average response under 2 minutes -- elite-level speed.");
  else if (avgResponseTime > 300) insights.push("Response times averaging over 5 minutes -- try activating auto-actions earlier.");

  const criticalCount = records.filter(r => r.severity === "critical").length;
  if (criticalCount >= 3) insights.push(`Handled ${criticalCount} critical incidents -- proven under pressure.`);

  return {
    tier, tierColor: style.color, tierGlow: style.glow, tierIcon: style.icon,
    avgScore, totalIncidents: records.length, bestScore, worstScore,
    avgResponseTime, currentStreak, bestStreak,
    trend, recentScores, percentile, insights,
  };
}

/**
 * Get all historical records (for charts/export)
 */
export function getIREHistory(): IRERecord[] {
  return loadRecords();
}

/**
 * Generate a verification hash for PDF QR code
 */
export function generateVerificationHash(record: {
  emergencyId: string;
  responseScore: number;
  responseTimeSec: number;
  timestamp: string;
}): string {
  // Simple hash for demo — in production this would be a real cryptographic signature
  const payload = `${record.emergencyId}|${Math.round(record.responseScore)}|${record.responseTimeSec}|${record.timestamp}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const chr = payload.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `SOS-${Math.abs(hash).toString(36).toUpperCase().padStart(8, "0")}`;
}

/**
 * Build QR payload for verification
 */
export function buildQRPayload(data: {
  emergencyId: string;
  employeeName: string;
  responseScore: number;
  responseTimeSec: number;
  phasesCompleted: number;
  timestamp: string;
}): string {
  const hash = generateVerificationHash(data);
  return JSON.stringify({
    system: "SOSphere IRE",
    version: "1.0",
    emergencyId: data.emergencyId,
    respondent: data.employeeName,
    score: Math.round(data.responseScore),
    responseTime: data.responseTimeSec,
    phases: data.phasesCompleted,
    timestamp: data.timestamp,
    verificationCode: hash,
    verifyUrl: `https://sosphere.io/verify/${hash}`,
  });
}