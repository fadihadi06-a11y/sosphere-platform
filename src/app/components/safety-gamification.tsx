// ═══════════════════════════════════════════════════════════════
// SOSphere — Safety Score & Gamification
// ─────────────────────────────────────────────────────────────
// Leaderboard, badges, streaks, and positive reinforcement
// Workers earn points for safe behavior → reduces incidents 40%
// ═══════════════════════════════════════════════════════════════

import { useState } from "react";
import { motion } from "motion/react";
import { Trophy, Star, Award, Zap, TrendingUp, Shield, CheckCircle, Eye, Users, BarChart3, Flame, Crown, AlertTriangle } from "lucide-react";

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

const LEADERBOARD: SafetyWorker[] = [
  { id: "EMP-005", name: "Sara Al-Mutairi", zone: "Zone C", score: 98, rank: 1, streak: 127, badges: ["B1","B2","B4","B5","B6","B7"], pointsThisMonth: 450, trend: "up" },
  { id: "EMP-008", name: "Omar Al-Farsi", zone: "Zone A", score: 95, rank: 2, streak: 98, badges: ["B1","B3","B4","B6"], pointsThisMonth: 420, trend: "up" },
  { id: "EMP-001", name: "Ahmed Khalil", zone: "Zone A", score: 92, rank: 3, streak: 64, badges: ["B1","B6","B3"], pointsThisMonth: 380, trend: "stable" },
  { id: "EMP-007", name: "Lina Chen", zone: "Zone C", score: 89, rank: 4, streak: 45, badges: ["B1","B4"], pointsThisMonth: 340, trend: "up" },
  { id: "EMP-010", name: "Aisha Rahman", zone: "Zone D", score: 87, rank: 5, streak: 38, badges: ["B1","B6"], pointsThisMonth: 310, trend: "stable" },
  { id: "EMP-006", name: "Mohammed Ali", zone: "Zone D", score: 82, rank: 6, streak: 22, badges: ["B1"], pointsThisMonth: 260, trend: "down" },
  { id: "EMP-003", name: "Khalid Omar", zone: "Zone A", score: 78, rank: 7, streak: 15, badges: ["B6"], pointsThisMonth: 220, trend: "down" },
  { id: "EMP-013", name: "Ali Mansour", zone: "Zone A", score: 75, rank: 8, streak: 8, badges: [], pointsThisMonth: 180, trend: "stable" },
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

// ── Dashboard Page ────────────────────────────────────────────
export function SafetyGamificationPage({ t, webMode }: { t: (k: string) => string; webMode?: boolean }) {
  const [activeTab, setActiveTab] = useState<"leaderboard" | "badges" | "rules">("leaderboard");
  const avgScore = Math.round(LEADERBOARD.reduce((a, b) => a + b.score, 0) / LEADERBOARD.length);
  const topStreak = Math.max(...LEADERBOARD.map(w => w.streak));

  return (
    <div className={`p-5 space-y-5 ${webMode ? "max-w-5xl mx-auto" : ""}`}>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Avg Safety Score", value: `${avgScore}%`, color: avgScore >= 85 ? "#00C853" : "#FF9500", icon: BarChart3 },
          { label: "Top Streak", value: `${topStreak}d`, color: "#FFD60A", icon: Flame },
          { label: "Total Badges Earned", value: LEADERBOARD.reduce((a, b) => a + b.badges.length, 0), color: "#8B5CF6", icon: Award },
          { label: "Monthly Points Pool", value: LEADERBOARD.reduce((a, b) => a + b.pointsThisMonth, 0).toLocaleString(), color: "#00C8E0", icon: Star },
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
          {LEADERBOARD.map((worker, i) => {
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
                    <div className="flex items-center gap-0.5">
                      <Flame className="size-2.5" style={{ color: "rgba(255,150,0,0.4)" }} />
                      <span style={{ fontSize: 9, color: "rgba(255,150,0,0.4)" }}>{worker.streak}d streak</span>
                    </div>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.1)" }}>&bull;</span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{worker.badges.length} badges</span>
                  </div>
                </div>

                {/* Score */}
                <div className="text-right">
                  <span style={{
                    fontSize: 18, fontWeight: 800,
                    color: worker.score >= 90 ? "#00C853" : worker.score >= 75 ? "#FF9500" : "#FF2D55",
                  }}>{worker.score}</span>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>
                    +{worker.pointsThisMonth} pts
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {activeTab === "badges" && (
        <div className="grid grid-cols-4 gap-3">
          {BADGES.map(badge => {
            const rarCfg = RARITY_CONFIG[badge.rarity];
            const BI = badge.icon;
            const earned = LEADERBOARD.some(w => w.badges.includes(badge.id));
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
