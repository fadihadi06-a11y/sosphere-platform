// ═══════════════════════════════════════════════════════════════
// SOSphere — Safety Score & Gamification
// ─────────────────────────────────────────────────────────────
// Leaderboard, badges, streaks, and positive reinforcement
// Workers earn points for safe behavior → reduces incidents 40%
// ═══════════════════════════════════════════════════════════════

import { useState, useMemo, useEffect } from "react";
import { motion } from "motion/react";
import { useDashboardStore } from "./stores/dashboard-store";
import { fetchSafetyScoreHistory, type SafetyScoreSummary } from "./safety-score-service";
import {
  Trophy, Star, Award, Zap, TrendingUp, Shield,
  CheckCircle, Clock, Eye, Users, BarChart3,
  ChevronRight, Flame, Target, Crown, Medal,
  Heart, AlertTriangle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────
interface SafetyWorker {
  id: string;
  name: string;
  zone: string;
  score: number;
  rank: number;
  streak: number; // days without incident
  badges: string[];
  pointsThisMonth: number;
  trend: "up" | "down" | "stable";
}

interface SafetyBadge {
  id: string;
  name: string;
  description: string;
  icon: any;
  color: string;
  rarity: "common" | "rare" | "epic" | "legendary";
}

// ── Mock Data ─────────────────────────────────────────────────
const BADGES: SafetyBadge[] = [
  { id: "B1", name: "Perfect Check-in", description: "100% check-in rate for 30 days", icon: CheckCircle, color: "#00C853", rarity: "common" },
  { id: "B2", name: "Safety Champion", description: "Top safety score for the month", icon: Trophy, color: "#FFD60A", rarity: "epic" },
  { id: "B3", name: "First Responder", description: "Responded to buddy SOS within 2 minutes", icon: Zap, color: "#FF9500", rarity: "rare" },
  { id: "B4", name: "Hazard Spotter", description: "Reported 5+ hazards that were verified", icon: Eye, color: "#00C8E0", rarity: "rare" },
  { id: "B5", name: "Iron Streak", description: "90 days without any safety incident", icon: Flame, color: "#FF2D55", rarity: "legendary" },
  { id: "B6", name: "Checklist Pro", description: "100% pre-shift checklist for 14 days", icon: Shield, color: "#8B5CF6", rarity: "common" },
  { id: "B7", name: "Team Guardian", description: "Buddy pair with 0 incidents for 60 days", icon: Users, color: "#00C8E0", rarity: "epic" },
  { id: "B8", name: "Safety Legend", description: "Top 3 in company leaderboard for 3 months", icon: Crown, color: "#FFD60A", rarity: "legendary" },
];


const SCORING_RULES = [
  { action: "On-time check-in", points: "+5", frequency: "per check-in" },
  { action: "Completed pre-shift checklist", points: "+10", frequency: "per shift" },
  { action: "Reported a hazard", points: "+20", frequency: "per report" },
  { action: "Responded to buddy SOS", points: "+50", frequency: "per response" },
  { action: "Perfect week (no incidents)", points: "+30", frequency: "weekly" },
  { action: "Emergency drill participation", points: "+15", frequency: "per drill" },
  { action: "Missed check-in", points: "-10", frequency: "per miss" },
  { action: "Safety violation", points: "-25", frequency: "per violation" },
];

const RARITY_CONFIG = {
  common:    { color: "#00C853", label: "Common",    glow: "none" },
  rare:      { color: "#00C8E0", label: "Rare",      glow: "0 0 8px rgba(0,200,224,0.2)" },
  epic:      { color: "#8B5CF6", label: "Epic",      glow: "0 0 12px rgba(139,92,246,0.2)" },
  legendary: { color: "#FFD60A", label: "Legendary", glow: "0 0 16px rgba(255,214,10,0.2)" },
};

// ── Real company safety score card ───────────────────────────
// Renders the server-computed company safety score (resolved/total emergency
// outcomes). Honest states: loading skeleton, unavailable, and a real value
// with a 6-month trend. No fabricated numbers.
function CompanySafetyScoreCard({ loading, data }: { loading: boolean; data: SafetyScoreSummary | null }) {
  const scoreColor = (v: number) => (v >= 90 ? "#00C853" : v >= 70 ? "#FF9500" : "#FF2D55");
  if (loading) {
    return (
      <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Loading company safety score…</span>
      </div>
    );
  }
  if (!data || data.months.length === 0) {
    return (
      <div className="rounded-2xl p-5 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <Shield className="size-5" style={{ color: "rgba(255,255,255,0.25)" }} />
        <div>
          <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Company Safety Score</p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Not available yet — it appears once emergency data is recorded.</p>
        </div>
      </div>
    );
  }
  const current = data.current;
  const col = scoreColor(current);
  const maxScore = 100;
  return (
    <div className="rounded-2xl p-5" style={{ background: `${col}08`, border: `1px solid ${col}1A` }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${col}18`, border: `1px solid ${col}30` }}>
            <Shield className="size-5" style={{ color: col }} />
          </div>
          <div className="min-w-0">
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>Company Safety Score</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              {data.totalResolved} of {data.totalIncidents} emergenc{data.totalIncidents === 1 ? "y" : "ies"} resolved · last {data.months.length} months
            </p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <span style={{ fontSize: 34, fontWeight: 800, color: col, lineHeight: 1 }}>{current}</span>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>this month</p>
        </div>
      </div>
      {/* Real 6-month trend */}
      <div className="flex items-end gap-1.5 mt-4" style={{ height: 44 }}>
        {data.months.map((m, i) => {
          const h = Math.max(4, Math.round((m.safetyScore / maxScore) * 40));
          const c = scoreColor(m.safetyScore);
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${m.monthLabel}: ${m.safetyScore} (${m.resolvedCount}/${m.sosCount} resolved)`}>
              <div style={{ width: "100%", maxWidth: 28, height: h, borderRadius: 3, background: `${c}55`, border: `1px solid ${c}` }} />
              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{m.monthLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Dashboard Page ────────────────────────────────────────────
export function SafetyGamificationPage({ t, webMode }: { t: (k: string) => string; webMode?: boolean }) {
  const [activeTab, setActiveTab] = useState<"leaderboard" | "badges" | "rules">("leaderboard");
  // ── REAL leaderboard from live employee data ──────────────────────────────
  // Source of truth: each employee's real `safetyScore` (the employees.safety_score
  // column in Supabase, surfaced through the dashboard store). We sort by real
  // score and assign rank. We deliberately do NOT fabricate streaks or monthly
  // points — those require per-worker event history (check-in streaks, verified
  // hazard reports) the platform does not yet record — so they are omitted from
  // the UI rather than invented.
  const storeEmployees = useDashboardStore(s => s.employees);
  const leaderboard = useMemo<SafetyWorker[]>(() => {
    const ranked = [...storeEmployees]
      .map(e => ({
        id: e.id,
        name: e.name,
        zone: e.zone || e.location || "—",
        score: Number.isFinite(e.safetyScore) ? Math.max(0, Math.min(100, Math.round(e.safetyScore))) : 0,
      }))
      .sort((a, b) => b.score - a.score);
    // "Safety Champion" is awarded ONLY to a strictly-unique top scorer (a real
    // distinction). If everyone is tied — e.g. all sitting at the baseline
    // default — nobody is champion, rather than crowning whoever sorts first.
    const uniqueTop = ranked.length > 1 ? ranked[0].score > ranked[1].score : ranked.length === 1;
    return ranked.map((e, i): SafetyWorker => ({
      ...e,
      rank: i + 1,
      // Only badges we can HONESTLY verify from existing data are awarded. Every
      // other badge depends on streak / check-in / hazard / buddy event history
      // that is not tracked yet, so it stays unearned (never faked).
      badges: i === 0 && uniqueTop && e.score > 0 ? ["B2"] : [],
      streak: 0,           // no real source — not displayed
      pointsThisMonth: 0,  // no real source — not displayed
      trend: "stable",
    }));
  }, [storeEmployees]);

  const avgScore = leaderboard.length ? Math.round(leaderboard.reduce((a, b) => a + b.score, 0) / leaderboard.length) : 0;
  const topScore = leaderboard.length ? Math.max(...leaderboard.map(w => w.score)) : 0;
  const atRisk = leaderboard.filter(w => w.score < 70).length;

  // ── REAL company safety score (computed server-side from emergency outcomes) ──
  // Loaded from get_safety_score_history RPC: for each month, resolved/total*100.
  const [scoreHistory, setScoreHistory] = useState<SafetyScoreSummary | null>(null);
  const [scoreLoading, setScoreLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setScoreLoading(true);
    fetchSafetyScoreHistory(6)
      .then(res => { if (alive) setScoreHistory(res); })
      .finally(() => { if (alive) setScoreLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className={`p-5 space-y-5 ${webMode ? "max-w-5xl mx-auto" : ""}`}>
      {/* REAL company safety score — computed server-side from emergency outcomes */}
      <CompanySafetyScoreCard loading={scoreLoading} data={scoreHistory} />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Avg Safety Score", value: `${avgScore}`, color: avgScore >= 85 ? "#00C853" : avgScore >= 70 ? "#FF9500" : "#FF2D55", icon: BarChart3 },
          { label: "Top Score", value: `${topScore}`, color: "#FFD60A", icon: Trophy },
          { label: "Workers Tracked", value: leaderboard.length, color: "#00C8E0", icon: Users },
          { label: "At-Risk (<70)", value: atRisk, color: atRisk > 0 ? "#FF2D55" : "#00C853", icon: AlertTriangle },
        ].map(stat => {
          const SI = stat.icon;
          return (
            <div key={stat.label} className="rounded-xl p-3"
              style={{ background: `${stat.color}06`, border: `1px solid ${stat.color}10` }}>
              <div className="flex items-center gap-2 mb-2">
                <SI className="size-3.5" style={{ color: stat.color }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>{stat.label}</span>
              </div>
              <span className="text-white" style={{ fontSize: 20, fontWeight: 800 }}>{stat.value}</span>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5">
        {(["leaderboard", "badges", "rules"] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className="px-4 py-2 rounded-lg"
            style={{
              background: activeTab === tab ? "rgba(255,214,10,0.1)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${activeTab === tab ? "rgba(255,214,10,0.2)" : "rgba(255,255,255,0.05)"}`,
            }}>
            <span style={{ fontSize: 12, color: activeTab === tab ? "#FFD60A" : "rgba(255,255,255,0.4)", fontWeight: 600 }}>
              {tab === "leaderboard" ? "🏆 Leaderboard" : tab === "badges" ? "🎖️ Badges" : "📋 Scoring Rules"}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "leaderboard" && (
        <div className="space-y-1.5">
          {leaderboard.length === 0 && (
            <div className="rounded-xl p-8 text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <Users className="size-6 mx-auto mb-2" style={{ color: "rgba(255,255,255,0.2)" }} />
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>No workers yet</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>Safety scores appear here as your team is added.</p>
            </div>
          )}
          {leaderboard.map((worker, i) => {
            const isTop3 = i < 3;
            const rankColors = ["#FFD60A", "#C0C0C0", "#CD7F32"];
            const rankColor = isTop3 ? rankColors[i] : "rgba(255,255,255,0.15)";

            return (
              <motion.div
                key={worker.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{
                  background: isTop3 ? `${rankColor}06` : "rgba(255,255,255,0.02)",
                  border: `1px solid ${isTop3 ? `${rankColor}12` : "rgba(255,255,255,0.04)"}`,
                }}
              >
                {/* Rank */}
                <div className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${rankColor}15`, border: `1px solid ${rankColor}25` }}>
                  {isTop3 ? (
                    <Crown className="size-4" style={{ color: rankColor }} />
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 800, color: rankColor }}>#{worker.rank}</span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white truncate" style={{ fontSize: 12, fontWeight: 700 }}>{worker.name}</p>
                    {worker.trend === "up" && <TrendingUp className="size-3" style={{ color: "#00C853" }} />}
                    {worker.trend === "down" && <AlertTriangle className="size-3" style={{ color: "#FF9500" }} />}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{worker.zone}</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.1)" }}>&bull;</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{worker.badges.length} badge{worker.badges.length === 1 ? "" : "s"}</span>
                  </div>
                </div>

                {/* Score */}
                <div className="text-right">
                  <span style={{
                    fontSize: 18, fontWeight: 800,
                    color: worker.score >= 90 ? "#00C853" : worker.score >= 75 ? "#FF9500" : "#FF2D55",
                  }}>{worker.score}</span>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>safety score</p>
                </div>
              </motion.div>
            );
          })}
          {leaderboard.length > 0 && (
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", paddingTop: 6, lineHeight: 1.5 }}>
              Per-worker scores show each employee's current safety rating. Per-worker
              point scoring (check-ins, hazards, streaks) is not yet tracked, so these
              are a baseline — the live company score above is the platform's real,
              incident-driven metric.
            </p>
          )}
        </div>
      )}

      {activeTab === "badges" && (
        <div className="grid grid-cols-4 gap-3">
          {BADGES.map(badge => {
            const rarCfg = RARITY_CONFIG[badge.rarity];
            const BI = badge.icon;
            const earned = leaderboard.some(w => w.badges.includes(badge.id));
            return (
              <motion.div key={badge.id} whileHover={{ scale: 1.02 }}
                className="rounded-xl p-3 flex flex-col items-center text-center"
                style={{
                  background: earned ? `${badge.color}06` : "rgba(255,255,255,0.02)",
                  border: `1px solid ${earned ? `${badge.color}15` : "rgba(255,255,255,0.04)"}`,
                  boxShadow: earned ? rarCfg.glow : "none",
                  opacity: earned ? 1 : 0.5,
                }}>
                <div className="size-10 rounded-xl flex items-center justify-center mb-2"
                  style={{ background: `${badge.color}12`, border: `1px solid ${badge.color}20` }}>
                  <BI className="size-5" style={{ color: badge.color }} />
                </div>
                <p className="text-white" style={{ fontSize: 10, fontWeight: 700 }}>{badge.name}</p>
                <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginTop: 2, lineHeight: 1.3 }}>{badge.description}</p>
                <div className="mt-2 px-1.5 py-0.5 rounded" style={{ background: `${rarCfg.color}10`, border: `1px solid ${rarCfg.color}20` }}>
                  <span style={{ fontSize: 7, fontWeight: 800, color: rarCfg.color }}>{rarCfg.label.toUpperCase()}</span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {activeTab === "rules" && (
        <div className="space-y-1.5">
          <p className="text-white mb-2" style={{ fontSize: 13, fontWeight: 700 }}>How Safety Scores Work</p>
          <div className="rounded-xl p-3 mb-2" style={{ background: "rgba(255,149,0,0.05)", border: "1px solid rgba(255,149,0,0.15)" }}>
            <p style={{ fontSize: 10, color: "#FF9500", fontWeight: 600, marginBottom: 2 }}>Planned per-worker model</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
              These point rules describe the per-worker scoring model we are building. They
              are not yet live. Today the platform computes a real <span style={{ color: "rgba(255,255,255,0.6)" }}>company</span> safety
              score from actual emergency outcomes (shown at the top of this page).
            </p>
          </div>
          {SCORING_RULES.map((rule, i) => {
            const isNegative = rule.points.startsWith("-");
            return (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl"
                style={{
                  background: isNegative ? "rgba(255,45,85,0.03)" : "rgba(0,200,83,0.03)",
                  border: `1px solid ${isNegative ? "rgba(255,45,85,0.06)" : "rgba(0,200,83,0.06)"}`,
                }}>
                <div className="size-8 rounded-lg flex items-center justify-center"
                  style={{ background: isNegative ? "rgba(255,45,85,0.08)" : "rgba(0,200,83,0.08)" }}>
                  {isNegative
                    ? <AlertTriangle className="size-3.5" style={{ color: "#FF2D55" }} />
                    : <Star className="size-3.5" style={{ color: "#00C853" }} />
                  }
                </div>
                <div className="flex-1">
                  <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{rule.action}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{rule.frequency}</p>
                </div>
                <span style={{ fontSize: 14, fontWeight: 800, color: isNegative ? "#FF2D55" : "#00C853" }}>
                  {rule.points}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
