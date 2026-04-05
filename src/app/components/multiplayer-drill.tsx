// ═══════════════════════════════════════════════════════════════
// SOSphere — Multiplayer Drill Mode
// ─────────────────────────────────────────────────────────────
// Simulated competitive drill: Admin vs AI Opponent on the same
// scenario simultaneously. Split-screen view, real-time scoring,
// and head-to-head comparison.
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Shield, Play, CheckCircle2, X, Users, Siren, Brain, Zap, Trophy, Target, Activity, Bot, User } from "lucide-react";
import { hapticSuccess, playUISound } from "./haptic-feedback";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface DrillStep {
  id: string;
  phase: string;
  instruction: string;
  icon: any;
  color: string;
}

interface MPScenario {
  id: string;
  title: string;
  icon: any;
  color: string;
  expectedTimeSec: number;
  steps: DrillStep[];
}

interface PlayerState {
  name: string;
  isAI: boolean;
  currentStep: number;
  completedSteps: Set<number>;
  score: number;
  elapsed: number;
  finished: boolean;
  finishedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// AI Opponent Logic
// ═══════════════════════════════════════════════════════════════

const AI_PROFILES = [
  { name: "Captain Rania", level: "EXPERT", avatar: "CR", avgDelay: 4, variance: 2, accuracy: 0.95, color: "#AF52DE" },
  { name: "Sgt. Ahmed", level: "ADVANCED", avatar: "SA", avgDelay: 6, variance: 3, accuracy: 0.88, color: "#00C8E0" },
  { name: "Lt. Khalid", level: "INTERMEDIATE", avatar: "LK", avgDelay: 9, variance: 4, accuracy: 0.78, color: "#FF9500" },
  { name: "Recruit Noura", level: "BEGINNER", avatar: "RN", avgDelay: 14, variance: 5, accuracy: 0.65, color: "#00C853" },
];

// ═══════════════════════════════════════════════════════════════
// Quick Scenarios for MP (subset of training scenarios)
// ═══════════════════════════════════════════════════════════════

const MP_SCENARIOS: MPScenario[] = [
  {
    id: "mp_sos", title: "SOS Button Press", icon: Siren, color: "#FF2D55", expectedTimeSec: 120,
    steps: [
      { id: "s1", phase: "ASSESS", instruction: "Review SOS alert details", icon: Brain, color: "#8B5CF6" },
      { id: "s2", phase: "CONTACT", instruction: "Call worker immediately", icon: Users, color: "#00C853" },
      { id: "s3", phase: "LOCATE", instruction: "Track GPS position", icon: Target, color: "#00C8E0" },
      { id: "s4", phase: "DISPATCH", instruction: "Send nearest help", icon: Shield, color: "#FF9500" },
      { id: "s5", phase: "DOCUMENT", instruction: "Record incident", icon: Activity, color: "#7B5EFF" },
    ],
  },
  {
    id: "mp_fall", title: "Fall Detection", icon: Zap, color: "#FF9500", expectedTimeSec: 100,
    steps: [
      { id: "f1", phase: "ASSESS", instruction: "Review fall data", icon: Brain, color: "#8B5CF6" },
      { id: "f2", phase: "CONTACT", instruction: "Attempt contact", icon: Users, color: "#00C853" },
      { id: "f3", phase: "GPS LOCK", instruction: "Lock GPS position", icon: Target, color: "#00C8E0" },
      { id: "f4", phase: "BUDDY", instruction: "Alert nearest buddy", icon: Users, color: "#FF9500" },
      { id: "f5", phase: "MEDICAL", instruction: "Prepare medical info", icon: Shield, color: "#FF2D55" },
    ],
  },
  {
    id: "mp_evac", title: "Zone Evacuation", icon: Shield, color: "#FF6B00", expectedTimeSec: 150,
    steps: [
      { id: "e1", phase: "TRIGGER", instruction: "Initiate evacuation", icon: Siren, color: "#FF2D55" },
      { id: "e2", phase: "BROADCAST", instruction: "Send evac order", icon: Users, color: "#AF52DE" },
      { id: "e3", phase: "GUIDE", instruction: "Provide routes", icon: Target, color: "#00C8E0" },
      { id: "e4", phase: "HEADCOUNT", instruction: "Track check-ins", icon: Users, color: "#00C853" },
      { id: "e5", phase: "VERIFY", instruction: "100% accountability", icon: CheckCircle2, color: "#00C853" },
    ],
  },
  {
    id: "mp_medical", title: "Medical Emergency", icon: Activity, color: "#00C853", expectedTimeSec: 110,
    steps: [
      { id: "m1", phase: "VITALS", instruction: "Get vital info", icon: Activity, color: "#FF2D55" },
      { id: "m2", phase: "MEDICAL ID", instruction: "Check medical record", icon: Shield, color: "#00C853" },
      { id: "m3", phase: "FIRST AID", instruction: "Guide first aid", icon: Brain, color: "#00C8E0" },
      { id: "m4", phase: "AMBULANCE", instruction: "Dispatch ambulance", icon: Siren, color: "#FF2D55" },
      { id: "m5", phase: "HANDOFF", instruction: "Prepare for medics", icon: Users, color: "#7B5EFF" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// Player Panel
// ═══════════════════════════════════════════════════════════════

function PlayerPanel({
  player,
  scenario,
  isLeft,
}: {
  player: PlayerState;
  scenario: MPScenario;
  isLeft: boolean;
}) {
  const progress = (player.completedSteps.size / scenario.steps.length) * 100;
  const scoreColor = player.score >= 85 ? "#00C853" : player.score >= 60 ? "#00C8E0" : player.score >= 40 ? "#FF9500" : "#FF2D55";
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="flex-1 p-3 rounded-2xl" style={{
      background: player.finished ? "rgba(0,200,83,0.03)" : "rgba(10,18,32,0.6)",
      border: `1px solid ${player.finished ? "rgba(0,200,83,0.12)" : "rgba(255,255,255,0.04)"}`,
    }}>
      {/* Player header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="size-8 rounded-lg flex items-center justify-center"
          style={{ background: player.isAI ? "rgba(139,92,246,0.1)" : "rgba(0,200,224,0.1)" }}>
          {player.isAI ? <Bot className="size-4" style={{ color: "#8B5CF6" }} /> : <User className="size-4" style={{ color: "#00C8E0" }} />}
        </div>
        <div className="flex-1 min-w-0">
          <p style={{ fontSize: 11, fontWeight: 800, color: player.isAI ? "#8B5CF6" : "#00C8E0" }}>
            {player.name}
          </p>
          <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>
            {player.isAI ? "AI Opponent" : "You"}
          </p>
        </div>
        <div className="text-right">
          <p style={{ fontSize: 14, fontWeight: 900, color: scoreColor, fontVariantNumeric: "tabular-nums" }}>
            {Math.round(player.score)}
          </p>
          <p style={{ fontSize: 7, color: "rgba(255,255,255,0.15)" }}>SCORE</p>
        </div>
      </div>

      {/* Progress */}
      <div className="h-1 rounded-full mb-3" style={{ background: "rgba(255,255,255,0.04)" }}>
        <motion.div className="h-full rounded-full" animate={{ width: `${progress}%` }}
          style={{ background: player.isAI ? "#8B5CF6" : "#00C8E0" }} />
      </div>

      {/* Steps */}
      <div className="space-y-1">
        {scenario.steps.map((step, i) => {
          const isCompleted = player.completedSteps.has(i);
          const isCurrent = i === player.currentStep && !player.finished;
          return (
            <div key={step.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
              style={{ background: isCurrent ? `${step.color}06` : "transparent", border: `1px solid ${isCurrent ? `${step.color}10` : "transparent"}` }}>
              {isCompleted ? (
                <CheckCircle2 className="size-3 flex-shrink-0" style={{ color: "#00C853" }} />
              ) : isCurrent ? (
                <motion.div animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 1, repeat: Infinity }}>
                  <step.icon className="size-3 flex-shrink-0" style={{ color: step.color }} />
                </motion.div>
              ) : (
                <div className="size-3 rounded-full flex-shrink-0" style={{ border: "1.5px solid rgba(255,255,255,0.08)" }} />
              )}
              <span style={{
                fontSize: 9, fontWeight: isCurrent ? 700 : 500,
                color: isCompleted ? "rgba(255,255,255,0.2)" : isCurrent ? "#fff" : "rgba(255,255,255,0.25)",
              }}>
                {step.phase}
              </span>
            </div>
          );
        })}
      </div>

      {/* Time */}
      <div className="mt-2 text-center">
        <span style={{
          fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums",
          color: player.finished ? "#00C853" : "rgba(255,255,255,0.4)",
        }}>
          {player.finished ? `FINISHED: ${fmtTime(player.finishedAt)}` : fmtTime(player.elapsed)}
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Multiplayer Drill Component
// ═══════════════════════════════════════════════════════════════

export function MultiplayerDrill({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<"select" | "countdown" | "playing" | "results">("select");
  const [selectedScenario, setSelectedScenario] = useState<MPScenario | null>(null);
  const [selectedOpponent, setSelectedOpponent] = useState(AI_PROFILES[1]); // default: Sgt. Ahmed
  const [countdown, setCountdown] = useState(3);

  // Player states
  const [you, setYou] = useState<PlayerState>({
    name: "You", isAI: false, currentStep: 0, completedSteps: new Set(),
    score: 100, elapsed: 0, finished: false, finishedAt: 0,
  });
  const [ai, setAi] = useState<PlayerState>({
    name: selectedOpponent.name, isAI: true, currentStep: 0, completedSteps: new Set(),
    score: 100, elapsed: 0, finished: false, finishedAt: 0,
  });

  const timerRef = useRef<NodeJS.Timeout>();
  const aiTimerRef = useRef<NodeJS.Timeout>();
  const startTimeRef = useRef(0);

  // Start game
  const startGame = (scenario: MPScenario) => {
    setSelectedScenario(scenario);
    setPhase("countdown");
    setCountdown(3);

    // Reset states
    setYou({ name: "You", isAI: false, currentStep: 0, completedSteps: new Set(), score: 100, elapsed: 0, finished: false, finishedAt: 0 });
    setAi({
      name: selectedOpponent.name, isAI: true, currentStep: 0, completedSteps: new Set(),
      score: 100, elapsed: 0, finished: false, finishedAt: 0,
    });
  };

  // Countdown
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      setPhase("playing");
      startTimeRef.current = Date.now();
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // Game timer
  useEffect(() => {
    if (phase !== "playing") return;
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setYou(prev => prev.finished ? prev : { ...prev, elapsed, score: Math.max(10, prev.score - 0.1) });
      setAi(prev => prev.finished ? prev : { ...prev, elapsed, score: Math.max(10, prev.score - 0.08) });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  // AI auto-play
  useEffect(() => {
    if (phase !== "playing" || !selectedScenario) return;

    const scheduleAiStep = (stepIndex: number) => {
      if (stepIndex >= selectedScenario.steps.length) return;
      const delay = (selectedOpponent.avgDelay + (Math.random() * selectedOpponent.variance * 2 - selectedOpponent.variance)) * 1000;
      aiTimerRef.current = setTimeout(() => {
        setAi(prev => {
          if (prev.finished) return prev;
          const newCompleted = new Set(prev.completedSteps);
          newCompleted.add(stepIndex);

          if (stepIndex >= selectedScenario.steps.length - 1) {
            const finishedAt = Math.floor((Date.now() - startTimeRef.current) / 1000);
            return { ...prev, currentStep: stepIndex, completedSteps: newCompleted, finished: true, finishedAt };
          }
          return { ...prev, currentStep: stepIndex + 1, completedSteps: newCompleted };
        });
        scheduleAiStep(stepIndex + 1);
      }, delay);
    };

    scheduleAiStep(0);
    return () => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current); };
  }, [phase, selectedScenario, selectedOpponent]);

  // Check if game is over
  useEffect(() => {
    if (phase === "playing" && you.finished && ai.finished) {
      setTimeout(() => {
        hapticSuccess();
        setPhase("results");
      }, 1000);
    }
  }, [you.finished, ai.finished, phase]);

  // Player action
  const handlePlayerStep = () => {
    if (!selectedScenario || you.finished) return;
    playUISound("actionDone");

    setYou(prev => {
      const newCompleted = new Set(prev.completedSteps);
      newCompleted.add(prev.currentStep);

      if (prev.currentStep >= selectedScenario.steps.length - 1) {
        const finishedAt = Math.floor((Date.now() - startTimeRef.current) / 1000);
        return { ...prev, completedSteps: newCompleted, finished: true, finishedAt, score: Math.max(10, prev.score + 3) };
      }
      return { ...prev, currentStep: prev.currentStep + 1, completedSteps: newCompleted, score: Math.max(10, prev.score + 1) };
    });
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ── SCENARIO SELECT ──
  if (phase === "select") {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="p-5 rounded-2xl" style={{ background: "rgba(10,18,32,0.6)", border: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-3 mb-4">
            <div className="size-12 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, rgba(255,45,85,0.15), rgba(139,92,246,0.1))", border: "1px solid rgba(255,45,85,0.2)" }}>
              <Users className="size-6" style={{ color: "#FF2D55" }} />
            </div>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>Multiplayer Drill</h3>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                Race against an AI opponent on the same scenario
              </p>
            </div>
          </div>

          {/* Opponent selector */}
          <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px", marginBottom: 8 }}>
            CHOOSE OPPONENT
          </p>
          <div className="grid grid-cols-2 gap-2">
            {AI_PROFILES.map(p => (
              <motion.button
                key={p.name}
                whileTap={{ scale: 0.97 }}
                onClick={() => setSelectedOpponent(p)}
                className="p-3 rounded-xl flex items-center gap-2"
                style={{
                  background: selectedOpponent.name === p.name ? `${p.color}10` : "rgba(255,255,255,0.02)",
                  border: `1px solid ${selectedOpponent.name === p.name ? `${p.color}25` : "rgba(255,255,255,0.04)"}`,
                }}
              >
                <div className="size-8 rounded-lg flex items-center justify-center"
                  style={{ background: `${p.color}15` }}>
                  <span style={{ fontSize: 10, fontWeight: 900, color: p.color }}>{p.avatar}</span>
                </div>
                <div className="text-left">
                  <p style={{ fontSize: 11, fontWeight: 700, color: selectedOpponent.name === p.name ? p.color : "#fff" }}>
                    {p.name}
                  </p>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>{p.level}</p>
                </div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Scenarios */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MP_SCENARIOS.map(sc => (
            <motion.button
              key={sc.id}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => startGame(sc)}
              className="p-4 rounded-2xl text-left"
              style={{ background: "rgba(10,18,32,0.8)", border: `1px solid rgba(255,255,255,0.05)` }}
            >
              <div className="h-1 w-full rounded-full mb-3" style={{ background: `linear-gradient(90deg, ${sc.color}, ${sc.color}40)` }} />
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl flex items-center justify-center"
                  style={{ background: `${sc.color}12`, border: `1px solid ${sc.color}20` }}>
                  <sc.icon className="size-5" style={{ color: sc.color }} />
                </div>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>{sc.title}</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                    {sc.steps.length} steps | Target: {fmtTime(sc.expectedTimeSec)}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-center gap-2 py-2 rounded-xl"
                style={{ background: `${sc.color}06`, border: `1px solid ${sc.color}10` }}>
                <Play className="size-3.5" style={{ color: sc.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: sc.color }}>Start Challenge</span>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    );
  }

  // ── COUNTDOWN ──
  if (phase === "countdown") {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <motion.div
            key={countdown}
            initial={{ scale: 2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            style={{ fontSize: 80, fontWeight: 900, color: countdown <= 1 ? "#FF2D55" : "#00C8E0" }}
          >
            {countdown > 0 ? countdown : "GO!"}
          </motion.div>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.3)", marginTop: 8 }}>
            {selectedScenario?.title} vs {selectedOpponent.name}
          </p>
        </div>
      </div>
    );
  }

  // ── PLAYING ──
  if (phase === "playing" && selectedScenario) {
    const currentStep = selectedScenario.steps[you.currentStep];
    return (
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="flex items-center gap-2">
            <selectedScenario.icon className="size-4" style={{ color: selectedScenario.color }} />
            <span style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{selectedScenario.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 16, fontWeight: 900, fontVariantNumeric: "tabular-nums", color: "#00C8E0" }}>
              {fmtTime(you.elapsed)}
            </span>
            <button onClick={onExit} className="size-7 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)" }}>
              <X className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
            </button>
          </div>
        </div>

        {/* Split view */}
        <div className="flex gap-3 mb-4">
          <PlayerPanel player={you} scenario={selectedScenario} isLeft />
          <div className="flex items-center">
            <div className="px-2 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
              <span style={{ fontSize: 10, fontWeight: 900, color: "rgba(255,255,255,0.15)" }}>VS</span>
            </div>
          </div>
          <PlayerPanel player={ai} scenario={selectedScenario} isLeft={false} />
        </div>

        {/* Your action area */}
        {!you.finished && currentStep && (
          <motion.div
            key={you.currentStep}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 rounded-2xl"
            style={{ background: `${currentStep.color}06`, border: `1px solid ${currentStep.color}15` }}
          >
            <div className="flex items-center gap-2 mb-2">
              <currentStep.icon className="size-4" style={{ color: currentStep.color }} />
              <span style={{ fontSize: 9, fontWeight: 800, color: currentStep.color, letterSpacing: "0.5px" }}>
                STEP {you.currentStep + 1}: {currentStep.phase}
              </span>
            </div>
            <p style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginBottom: 12 }}>{currentStep.instruction}</p>
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handlePlayerStep}
              className="w-full py-3.5 rounded-xl flex items-center justify-center gap-2"
              style={{
                background: `linear-gradient(135deg, ${currentStep.color}25, ${currentStep.color}10)`,
                border: `1.5px solid ${currentStep.color}35`,
                boxShadow: `0 0 20px ${currentStep.color}10`,
              }}
            >
              <CheckCircle2 className="size-5" style={{ color: currentStep.color }} />
              <span style={{ fontSize: 15, fontWeight: 900, color: currentStep.color }}>COMPLETE</span>
            </motion.button>
          </motion.div>
        )}

        {you.finished && !ai.finished && (
          <div className="p-4 rounded-2xl text-center" style={{ background: "rgba(0,200,83,0.04)", border: "1px solid rgba(0,200,83,0.1)" }}>
            <CheckCircle2 className="size-8 mx-auto mb-2" style={{ color: "#00C853" }} />
            <p style={{ fontSize: 14, fontWeight: 800, color: "#00C853" }}>You finished! Waiting for {ai.name}...</p>
          </div>
        )}
      </div>
    );
  }

  // ── RESULTS ──
  if (phase === "results" && selectedScenario) {
    const youWon = you.score > ai.score || (you.score === ai.score && you.finishedAt <= ai.finishedAt);
    const winnerColor = youWon ? "#00C8E0" : "#8B5CF6";

    return (
      <div className="space-y-5">
        {/* Result header */}
        <div className="text-center py-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="size-20 mx-auto mb-4 rounded-full flex items-center justify-center"
            style={{
              background: youWon ? "rgba(0,200,224,0.15)" : "rgba(139,92,246,0.15)",
              border: `2px solid ${winnerColor}30`,
            }}
          >
            {youWon ? <Trophy className="size-10" style={{ color: "#00C8E0" }} /> : <Bot className="size-10" style={{ color: "#8B5CF6" }} />}
          </motion.div>
          <h2 style={{ fontSize: 24, fontWeight: 900, color: "#fff" }}>
            {youWon ? "You Win!" : `${ai.name} Wins!`}
          </h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
            {selectedScenario.title}
          </p>
        </div>

        {/* Comparison */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { player: you, label: "YOU", color: "#00C8E0" },
            { player: ai, label: ai.name.toUpperCase(), color: "#8B5CF6" },
          ].map(({ player, label, color }) => (
            <div key={label} className="p-4 rounded-2xl" style={{ background: `${color}04`, border: `1px solid ${color}10` }}>
              <p style={{ fontSize: 9, fontWeight: 800, color, letterSpacing: "0.5px", marginBottom: 8 }}>{label}</p>
              <div className="space-y-3">
                {[
                  { l: "Score", v: Math.round(player.score), c: player.score >= 80 ? "#00C853" : "#FF9500" },
                  { l: "Time", v: fmtTime(player.finishedAt), c: color },
                  { l: "Steps", v: `${player.completedSteps.size}/${selectedScenario.steps.length}`, c: "#00C8E0" },
                ].map(s => (
                  <div key={s.l}>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>{s.l}</p>
                    <p style={{ fontSize: 18, fontWeight: 900, color: s.c }}>{s.v}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => startGame(selectedScenario)}
            className="w-full py-3 rounded-xl flex items-center justify-center gap-2"
            style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}
          >
            <Play className="size-4" style={{ color: "#00C8E0" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>Rematch</span>
          </motion.button>
          <button onClick={() => setPhase("select")}
            className="w-full py-2.5 rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", fontSize: 12, fontWeight: 600 }}>
            Choose Different Scenario
          </button>
        </div>
      </div>
    );
  }

  return null;
}
