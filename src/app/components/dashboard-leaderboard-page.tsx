// ═══════════════════════════════════════════════════════════════
// SOSphere — Admin Performance Leaderboard (Dashboard Page)
// ─────────────────────────────────────────────────────────────
// Enterprise dashboard page showing admin rankings, performance
// tiers, historical trends, and links to Training Center.
// ─────────────────────────────────────────────────────────────
// SUPABASE_MIGRATION_POINT — Data sources:
//   • getAdminRating() / getIREHistory() → replace with async
//     Supabase queries: supabase.from('admin_ratings').select()
//     and supabase.from('ire_history').select().order('timestamp')
//   • Rank formula (line ~76) is client-side approximation →
//     replace with server-side ranking via Supabase RPC or
//     window function query
// ═══════════════════════════════════════════════════════════════

import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Trophy, Crown, Star, Medal, Shield, Zap, TrendingUp, TrendingDown, Activity, Target, Clock, Flame, ExternalLink, GraduationCap } from "lucide-react";
import { getAdminRating, getIREHistory, type AdminRating, type IRERecord } from "./ire-performance-store";
import { AdminLeaderboardContent } from "./training-center";
import { TYPOGRAPHY, SectionHeader, Card as DSCard, Badge } from "./design-system";

export function LeaderboardPage({ t, webMode, onNavigateToTraining }: {
  t: (k: string) => string;
  webMode?: boolean;
  onNavigateToTraining?: () => void;
}) {
  const [adminRating, setAdminRating] = useState<AdminRating | null>(null);
  const [history, setHistory] = useState<IRERecord[]>([]);
  const [activeTab, setActiveTab] = useState<"ranking" | "performance" | "history">("ranking");

  useEffect(() => {
    console.log("[SUPABASE_READY] leaderboard_viewed");
    /* SUPABASE_MIGRATION_POINT: ire_performance
       Replace getAdminRating() with:
       const { data } = await supabase
         .from('admin_performance')
         .select('*')
         .eq('admin_id', currentAdminId)
         .single() */
    const rating = getAdminRating();
    const hist = getIREHistory();
    setAdminRating(rating);
    setHistory(hist);
    const avgScore = rating?.avgScore || 0;
    const rank = rating ? Math.max(1, 9 - Math.floor(avgScore / 12)) : 8;
    console.log("[SUPABASE_READY] performance_loaded: " + JSON.stringify({ avgScore, rank, historyCount: hist.length }));
  }, []);

  const TIER_COLORS: Record<string, { color: string; icon: typeof Crown }> = {
    PLATINUM: { color: "#E5E4E2", icon: Crown },
    GOLD: { color: "#FFD700", icon: Star },
    SILVER: { color: "#C0C0C0", icon: Medal },
    BRONZE: { color: "#CD7F32", icon: Shield },
    ROOKIE: { color: "#00C8E0", icon: Zap },
  };

  const tierMeta = adminRating ? TIER_COLORS[adminRating.tier] || TIER_COLORS.ROOKIE : TIER_COLORS.ROOKIE;

  return (
    <div className="space-y-6">
      {/* Your Performance Summary */}
      <div className="p-6 rounded-2xl" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-start gap-5 mb-5">
          {/* Tier badge */}
          <div className="relative">
            <div className="size-20 rounded-2xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${tierMeta.color}15, ${tierMeta.color}05)`,
                border: `2px solid ${tierMeta.color}30`,
                boxShadow: `0 0 30px ${tierMeta.color}10`,
              }}>
              <tierMeta.icon className="size-10" style={{ color: tierMeta.color }} />
            </div>
            {adminRating && adminRating.currentStreak >= 3 && (
              <div className="absolute -top-2 -right-2 size-7 rounded-full flex items-center justify-center"
                style={{ background: "rgba(255,150,0,0.2)", border: "2px solid #05070E" }}>
                <Flame className="size-3.5" style={{ color: "#FF9500" }} />
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span style={{ ...TYPOGRAPHY.h2, color: tierMeta.color }}>
                {adminRating?.tier || "ROOKIE"} RESPONDER
              </span>
              {/* SUPABASE_MIGRATION_POINT: admin_rankings — self-calculated rank, needs server-side RANK() OVER (ORDER BY avg_score DESC) */}
              <Badge color={tierMeta.color}>Rank #{adminRating ? Math.max(1, 9 - Math.floor(adminRating.avgScore / 12)) : 8}</Badge>
            </div>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>
              {adminRating?.insights[0] || "Complete your first IRE response to start building your rating."}
            </p>
            {/* Quick stats */}
            <div className="flex items-center gap-4">
              {[
                { label: "Avg Score", value: adminRating?.avgScore || 0, color: tierMeta.color },
                { label: "Incidents", value: adminRating?.totalIncidents || 0, color: "#00C8E0" },
                { label: "Streak", value: adminRating?.currentStreak || 0, color: "#FF9500" },
                { label: "Top %", value: `${adminRating?.percentile || 50}`, color: "#8B5CF6" },
              ].map(s => (
                <div key={s.label}>
                  <p style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</p>
                  <p style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>{s.label.toUpperCase()}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Training CTA */}
        {onNavigateToTraining && (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onNavigateToTraining}
            className="w-full flex items-center justify-between p-3.5 rounded-xl"
            style={{
              background: "linear-gradient(135deg, rgba(0,200,224,0.08), rgba(139,92,246,0.05))",
              border: "1px solid rgba(0,200,224,0.15)",
            }}>
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(0,200,224,0.1)" }}>
                <GraduationCap className="size-5" style={{ color: "#00C8E0" }} />
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>Training & Drill Center</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>18 scenarios -- Practice makes perfect response</p>
              </div>
            </div>
            <ExternalLink className="size-4" style={{ color: "rgba(0,200,224,0.5)" }} />
          </motion.button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.02)" }}>
        {[
          { id: "ranking" as const, label: "Rankings", icon: Trophy },
          { id: "performance" as const, label: "My Performance", icon: TrendingUp },
          { id: "history" as const, label: "Response History", icon: Clock },
        ].map(tab => (
          <button key={tab.id} onClick={() => {
              setActiveTab(tab.id);
              console.log("[SUPABASE_READY] leaderboard_tab_changed: " + tab.id);
            }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg"
            style={{
              background: activeTab === tab.id ? "rgba(0,200,224,0.08)" : "transparent",
              border: `1px solid ${activeTab === tab.id ? "rgba(0,200,224,0.12)" : "transparent"}`,
            }}>
            <tab.icon className="size-3.5" style={{ color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.2)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: activeTab === tab.id ? "#00C8E0" : "rgba(255,255,255,0.3)" }}>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "ranking" && (() => {
        console.log("[SUPABASE_READY] leaderboard_rankings_viewed");
        return <AdminLeaderboardContent adminRating={adminRating} />;
      })()}

      {activeTab === "performance" && (
        <div className="space-y-4">
          {/* Score trend */}
          {adminRating && adminRating.recentScores.length > 1 && (
            <DSCard>
              <SectionHeader title={`Score Trend (Last ${adminRating.recentScores.length} Responses)`} />
              <div className="flex items-end gap-2 h-32 mt-4 px-2">
                {adminRating.recentScores.map((score, i) => (
                  <motion.div
                    key={i}
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(15, score)}%` }}
                    transition={{ delay: i * 0.08 }}
                    className="flex-1 rounded-t-lg relative group"
                    style={{
                      background: score >= 85 ? "linear-gradient(180deg, #00C853, #00C85330)" :
                                 score >= 60 ? "linear-gradient(180deg, #00C8E0, #00C8E030)" :
                                 score >= 40 ? "linear-gradient(180deg, #FF9500, #FF950030)" :
                                              "linear-gradient(180deg, #FF2D55, #FF2D5530)",
                      minHeight: 8,
                    }}
                  >
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span style={{ fontSize: 9, fontWeight: 800, color: "#fff" }}>{score}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-3 px-2">
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Oldest</span>
                <div className="flex items-center gap-1">
                  {adminRating.trend === "improving" ? <TrendingUp className="size-3" style={{ color: "#00C853" }} /> :
                   adminRating.trend === "declining" ? <TrendingDown className="size-3" style={{ color: "#FF2D55" }} /> :
                   <Activity className="size-3" style={{ color: "rgba(255,255,255,0.3)" }} />}
                  <span style={{ fontSize: 9, fontWeight: 600, color: adminRating.trend === "improving" ? "#00C853" : adminRating.trend === "declining" ? "#FF2D55" : "rgba(255,255,255,0.3)" }}>
                    {adminRating.trend === "improving" ? "Improving" : adminRating.trend === "declining" ? "Declining" : "Stable"}
                  </span>
                </div>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Latest</span>
              </div>
            </DSCard>
          )}

          {/* AI Insights */}
          {adminRating && adminRating.insights.length > 0 && (
            <DSCard>
              <SectionHeader title="AI Performance Insights" />
              <div className="space-y-2 mt-3">
                {adminRating.insights.map((insight, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-xl"
                    style={{ background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.08)" }}>
                    <Target className="size-3.5 flex-shrink-0 mt-0.5" style={{ color: "#8B5CF6" }} />
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>{insight}</span>
                  </div>
                ))}
              </div>
            </DSCard>
          )}

          {/* Empty state */}
          {(!adminRating || adminRating.totalIncidents === 0) && (
            <div className="text-center py-16">
              <Trophy className="size-14 mx-auto mb-4" style={{ color: "rgba(255,255,255,0.06)" }} />
              <p style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.25)" }}>No Performance Data Yet</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>
                Complete IRE responses to build your performance profile
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-2">
          {history.length > 0 ? history.slice().reverse().map((record, i) => (
            <div key={record.id} className="flex items-center gap-4 px-4 py-3 rounded-xl"
              style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="w-8 text-center">
                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.15)" }}>#{history.length - i}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{record.employeeName}</span>
                  <Badge color={record.severity === "critical" ? "#FF2D55" : record.severity === "high" ? "#FF9500" : "#00C8E0"}>
                    {record.severity.toUpperCase()}
                  </Badge>
                </div>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
                  {record.zone} -- {record.sosType.replace(/_/g, " ")} -- {new Date(record.timestamp).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>TIME</p>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0" }}>
                    {Math.floor(record.responseTimeSec / 60)}:{(record.responseTimeSec % 60).toString().padStart(2, "0")}
                  </p>
                </div>
                <div className="w-12 text-right">
                  <span style={{
                    fontSize: 20, fontWeight: 900,
                    color: record.responseScore >= 85 ? "#00C853" : record.responseScore >= 60 ? "#00C8E0" : "#FF9500",
                  }}>{record.responseScore}</span>
                </div>
              </div>
            </div>
          )) : (
            <div className="text-center py-16">
              <Clock className="size-14 mx-auto mb-4" style={{ color: "rgba(255,255,255,0.06)" }} />
              <p style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.25)" }}>No Response History</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.15)", marginTop: 4 }}>
                IRE responses will appear here after completion
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}