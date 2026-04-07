// =================================================================
// SOSphere — Evidence Pipeline Panel (Shared Visual Component)
// =================================================================
// Shows the full evidence lifecycle: photos, audio, pipeline stages,
// chain of custody, comments, and quick actions.
// Used in: Hub Incident Reports, Incident Investigation, Guide Me
// =================================================================

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Camera, Send, Eye, Megaphone, Search, Shield, FileText,
  Download, Play, Pause, Square, Mic, Clock, MapPin, User,
  MessageSquare, ChevronRight, CheckCircle2, AlertTriangle,
  ArrowRight, Layers, Volume2, Plus, X, Lock, Zap,
} from "lucide-react";
import {
  type EvidenceEntry, type EvidenceComment, type EvidenceAction,
  EVIDENCE_PIPELINE_STAGES, getEvidenceStage,
  addEvidenceComment, addEvidenceAction,
  linkToInvestigation, linkToRiskRegister,
  updateEvidenceStatus,
} from "./evidence-store";

// ── Pipeline Stage Icons ──────────────────────────────────────
const STAGE_ICONS: Record<string, any> = {
  Camera, Send, Eye, Megaphone, Search, Shield, FileText, Download,
};

// ── Evidence Pipeline Visual ──────────────────────────────────
export function EvidencePipelineVisual({ entry, compact = false }: { entry: EvidenceEntry; compact?: boolean }) {
  const currentStage = getEvidenceStage(entry);

  return (
    <div className="space-y-1">
      {!compact && (
        <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", marginBottom: 8 }}>
          EVIDENCE PIPELINE
        </p>
      )}
      <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
        {EVIDENCE_PIPELINE_STAGES.map((stage, i) => {
          const Icon = STAGE_ICONS[stage.icon] || Camera;
          const isActive = i <= currentStage;
          const isCurrent = i === currentStage;

          return (
            <div key={stage.id} className="flex items-center gap-0.5 flex-shrink-0">
              <div className="flex flex-col items-center" style={{ width: compact ? 32 : 44 }}>
                <motion.div
                  animate={isCurrent ? { scale: [1, 1.15, 1] } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="flex items-center justify-center rounded-lg"
                  style={{
                    width: compact ? 24 : 30,
                    height: compact ? 24 : 30,
                    background: isActive ? `${stage.color}20` : "rgba(255,255,255,0.03)",
                    border: `1.5px solid ${isActive ? `${stage.color}50` : "rgba(255,255,255,0.06)"}`,
                  }}
                >
                  <Icon className={compact ? "size-3" : "size-3.5"}
                    style={{ color: isActive ? stage.color : "rgba(255,255,255,0.15)" }} />
                </motion.div>
                {!compact && (
                  <span style={{
                    fontSize: 7, fontWeight: 600, marginTop: 3, textAlign: "center",
                    color: isActive ? stage.color : "rgba(255,255,255,0.2)",
                  }}>
                    {stage.label}
                  </span>
                )}
              </div>
              {i < EVIDENCE_PIPELINE_STAGES.length - 1 && (
                <div style={{
                  width: compact ? 6 : 10, height: 1.5, borderRadius: 1,
                  background: i < currentStage ? EVIDENCE_PIPELINE_STAGES[i + 1].color : "rgba(255,255,255,0.06)",
                  marginBottom: compact ? 0 : 14,
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Chain of Custody Timeline ─────────────────────────────────
export function ChainOfCustody({ actions, compact = false }: { actions: EvidenceAction[]; compact?: boolean }) {
  const sorted = [...actions].sort((a, b) => a.timestamp - b.timestamp);
  const display = compact ? sorted.slice(-4) : sorted;

  const ACTION_COLORS: Record<string, string> = {
    viewed: "#00C8E0",
    broadcast: "#FF9500",
    forwarded: "#9B59B6",
    attached_to_rca: "#AF52DE",
    attached_to_risk: "#FF2D55",
    added_to_audit: "#4A90D9",
    exported_pdf: "#00C853",
    guide_me_triggered: "#FFD60A",
    archived: "rgba(255,255,255,0.3)",
  };

  return (
    <div>
      {!compact && (
        <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", marginBottom: 10 }}>
          CHAIN OF CUSTODY ({actions.length} events)
        </p>
      )}
      <div className="space-y-1">
        {display.map((act, i) => {
          const color = ACTION_COLORS[act.actionType] || "#00C8E0";
          return (
            <div key={act.id} className="flex items-start gap-2.5 py-1.5">
              {/* Timeline dot + line */}
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 12 }}>
                <div className="rounded-full" style={{
                  width: 6, height: 6, background: color,
                  boxShadow: `0 0 6px ${color}40`,
                }} />
                {i < display.length - 1 && (
                  <div style={{ width: 1, flex: 1, minHeight: 16, background: "rgba(255,255,255,0.06)" }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>
                    {act.actor}
                  </span>
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)" }}>
                    {act.role}
                  </span>
                </div>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 1 }}>
                  {act.action}
                </p>
                <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>
                  {new Date(act.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Comments Section ──────────────────────────────────────────
export function EvidenceComments({
  evidenceId, comments, onCommentAdded,
}: {
  evidenceId: string;
  comments: EvidenceComment[];
  onCommentAdded?: () => void;
}) {
  const [newComment, setNewComment] = useState("");
  const [commentType, setCommentType] = useState<EvidenceComment["type"]>("comment");

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    addEvidenceComment(evidenceId, {
      author: "Admin",
      role: "HSE Manager",
      text: newComment.trim(),
      type: commentType,
    });
    setNewComment("");
    onCommentAdded?.();
  };

  const TYPE_COLORS: Record<EvidenceComment["type"], string> = {
    comment: "#00C8E0",
    annotation: "#FF9500",
    escalation: "#FF2D55",
    resolution: "#00C853",
  };

  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", marginBottom: 10 }}>
        COMMENTS & ANNOTATIONS ({comments.length})
      </p>

      {/* Existing comments */}
      {comments.length > 0 && (
        <div className="space-y-2 mb-4">
          {comments.map(c => (
            <div key={c.id} className="p-3 rounded-xl"
              style={{ background: `${TYPE_COLORS[c.type]}08`, border: `1px solid ${TYPE_COLORS[c.type]}15` }}>
              <div className="flex items-center gap-2 mb-1">
                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>{c.author}</span>
                <span className="px-1.5 py-0.5 rounded-full"
                  style={{ fontSize: 7, fontWeight: 700, background: `${TYPE_COLORS[c.type]}20`, color: TYPE_COLORS[c.type] }}>
                  {c.type.toUpperCase()}
                </span>
                <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>
                  {new Date(c.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{c.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add comment */}
      <div className="space-y-2">
        <div className="flex gap-1.5">
          {(["comment", "annotation", "escalation", "resolution"] as const).map(t => (
            <button key={t} onClick={() => setCommentType(t)}
              className="px-2 py-1 rounded-lg capitalize"
              style={{
                background: commentType === t ? `${TYPE_COLORS[t]}15` : "rgba(255,255,255,0.02)",
                border: commentType === t ? `1px solid ${TYPE_COLORS[t]}30` : "1px solid rgba(255,255,255,0.05)",
                color: commentType === t ? TYPE_COLORS[t] : "rgba(255,255,255,0.3)",
                fontSize: 9, fontWeight: 600,
              }}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            placeholder="Add comment or annotation..."
            className="flex-1 px-3 py-2 rounded-xl outline-none"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              color: "rgba(255,255,255,0.8)",
              fontSize: 11,
            }}
            onKeyDown={e => e.key === "Enter" && handleAddComment()}
          />
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleAddComment}
            disabled={!newComment.trim()}
            className="px-3 py-2 rounded-xl flex items-center gap-1.5"
            style={{
              background: newComment.trim() ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${newComment.trim() ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.05)"}`,
              color: newComment.trim() ? "#00C8E0" : "rgba(255,255,255,0.2)",
              fontSize: 10, fontWeight: 700,
            }}>
            <Send className="size-3" />
            Add
          </motion.button>
        </div>
      </div>
    </div>
  );
}

// ── Audio Player ──────────────────────────────────────────────
export function AudioMemoPlayer({ audioMemo }: { audioMemo: { dataUrl: string; durationSec: number; format: string } }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const togglePlay = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(audioMemo.dataUrl);
      audioRef.current.onended = () => {
        setIsPlaying(false);
        setProgress(0);
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }

    if (isPlaying) {
      audioRef.current.pause();
      if (intervalRef.current) clearInterval(intervalRef.current);
    } else {
      audioRef.current.play().catch(() => {});
      intervalRef.current = setInterval(() => {
        if (audioRef.current) {
          setProgress((audioRef.current.currentTime / audioMemo.durationSec) * 100);
        }
      }, 100);
    }
    setIsPlaying(!isPlaying);
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl"
      style={{ background: "rgba(123,94,255,0.06)", border: "1px solid rgba(123,94,255,0.15)" }}>
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={togglePlay}
        className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background: isPlaying ? "rgba(255,45,85,0.15)" : "rgba(123,94,255,0.2)",
          border: `1px solid ${isPlaying ? "rgba(255,45,85,0.3)" : "rgba(123,94,255,0.3)"}`,
        }}>
        {isPlaying
          ? <Pause className="size-4" style={{ color: "#FF2D55" }} />
          : <Play className="size-4" style={{ color: "#7B5EFF" }} />}
      </motion.button>

      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          <Mic className="size-3" style={{ color: "#7B5EFF" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>
            Voice Memo
          </span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
            {formatTime(audioMemo.durationSec)} · {audioMemo.format.toUpperCase()}
          </span>
        </div>
        {/* Progress bar */}
        <div className="w-full h-1.5 rounded-full overflow-hidden"
          style={{ background: "rgba(255,255,255,0.06)" }}>
          <motion.div
            className="h-full rounded-full"
            style={{ width: `${progress}%`, background: "linear-gradient(90deg, #7B5EFF, #AF52DE)" }}
          />
        </div>
      </div>

      <Volume2 className="size-3.5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
    </div>
  );
}

// ── Quick Actions Bar ─────────────────────────────────────────
export function EvidenceQuickActions({
  entry,
  onNavigate,
  onRefresh,
}: {
  entry: EvidenceEntry;
  onNavigate?: (page: string) => void;
  onRefresh?: () => void;
}) {
  const [linking, setLinking] = useState<string | null>(null);

  const actions = [
    {
      id: "rca",
      label: "Attach to RCA",
      icon: <Search className="size-3.5" />,
      color: "#AF52DE",
      disabled: !!entry.linkedInvestigationId,
      done: !!entry.linkedInvestigationId,
      onClick: () => {
        setLinking("rca");
        setTimeout(() => {
          const adminName = (() => { try { return JSON.parse(localStorage.getItem("sosphere_admin_profile") || "{}").name || "Admin"; } catch { return "Admin"; } })();
          linkToInvestigation(entry.id, "INV-001", adminName);
          setLinking(null);
          onRefresh?.();
        }, 800);
      },
    },
    {
      id: "risk",
      label: "Link to Risk",
      icon: <Shield className="size-3.5" />,
      color: "#FF2D55",
      disabled: !!entry.linkedRiskEntryId,
      done: !!entry.linkedRiskEntryId,
      onClick: () => {
        setLinking("risk");
        setTimeout(() => {
          linkToRiskRegister(entry.id, "RISK-001", "Admin");
          setLinking(null);
          onRefresh?.();
        }, 800);
      },
    },
    {
      id: "audit",
      label: "Audit Log",
      icon: <FileText className="size-3.5" />,
      color: "#4A90D9",
      disabled: !!entry.linkedAuditEntryId,
      done: !!entry.linkedAuditEntryId,
      onClick: () => {
        addEvidenceAction(entry.id, {
          actor: "Admin", role: "HSE Manager",
          action: "Evidence added to audit log",
          actionType: "added_to_audit",
        });
        onRefresh?.();
      },
    },
    {
      id: "investigate",
      label: "Investigation",
      icon: <ArrowRight className="size-3.5" />,
      color: "#FF9500",
      disabled: false,
      done: false,
      onClick: () => onNavigate?.("investigation"),
    },
  ];

  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", marginBottom: 8 }}>
        QUICK ACTIONS
      </p>
      <div className="grid grid-cols-4 gap-2">
        {actions.map(a => (
          <motion.button
            key={a.id}
            whileTap={{ scale: 0.95 }}
            disabled={a.disabled}
            onClick={a.onClick}
            className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl"
            style={{
              background: a.done ? `${a.color}10` : "rgba(255,255,255,0.02)",
              border: `1px solid ${a.done ? `${a.color}25` : "rgba(255,255,255,0.06)"}`,
              opacity: a.disabled && !a.done ? 0.4 : 1,
            }}
          >
            {linking === a.id ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="size-3.5 border-2 rounded-full"
                style={{ borderColor: a.color, borderTopColor: "transparent" }}
              />
            ) : a.done ? (
              <CheckCircle2 className="size-3.5" style={{ color: a.color }} />
            ) : (
              <span style={{ color: a.color }}>{a.icon}</span>
            )}
            <span style={{
              fontSize: 8, fontWeight: 600, textAlign: "center",
              color: a.done ? a.color : "rgba(255,255,255,0.45)",
            }}>
              {a.done ? "Linked" : a.label}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ── Full Evidence Detail Panel ────────────────────────────────
// Comprehensive panel showing everything about one evidence entry
export function EvidenceDetailPanel({
  entry,
  onClose,
  onNavigate,
  onRefresh,
}: {
  entry: EvidenceEntry;
  onClose: () => void;
  onNavigate?: (page: string) => void;
  onRefresh?: () => void;
}) {
  const sevColors: Record<string, string> = {
    low: "#00C853", medium: "#FF9500", high: "#FF6B00", critical: "#FF2D55",
  };
  const sevColor = sevColors[entry.severity] || "#FF9500";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[250] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.92, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.92, y: 20 }}
        transition={{ type: "spring", stiffness: 350, damping: 30 }}
        className="w-full max-w-2xl mx-4 rounded-2xl overflow-hidden"
        style={{
          background: "#070d1a",
          border: "1px solid rgba(255,255,255,0.08)",
          maxHeight: "90vh",
          overflowY: "auto",
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-start justify-between"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Camera className="size-4" style={{ color: sevColor }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: sevColor, letterSpacing: "0.5px" }}>
                FIELD EVIDENCE · {entry.id}
              </span>
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.3px" }}>
              {entry.incidentType}
            </h3>
            <div className="flex items-center gap-3 mt-1">
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                <User className="size-3 inline mr-1" />{entry.submittedBy}
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                <MapPin className="size-3 inline mr-1" />{entry.zone}
              </span>
              <span className="px-2 py-0.5 rounded-full"
                style={{ fontSize: 9, fontWeight: 700, background: `${sevColor}20`, color: sevColor }}>
                {entry.severity.toUpperCase()}
              </span>
            </div>
          </div>
          <button onClick={onClose}
            className="size-8 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.05)" }}>
            <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Pipeline Visual */}
          <EvidencePipelineVisual entry={entry} />

          {/* Photos */}
          {entry.photos.length > 0 && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", marginBottom: 8 }}>
                EVIDENCE PHOTOS ({entry.photos.length})
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {entry.photos.map((photo, i) => (
                  <div key={photo.id} className="flex-shrink-0 relative rounded-2xl overflow-hidden"
                    style={{ width: 120, height: 120, border: "1px solid rgba(0,200,224,0.2)" }}>
                    <img src={photo.dataUrl} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 px-2 py-1 flex items-center justify-between"
                      style={{ background: "rgba(0,0,0,0.7)" }}>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.6)" }}>Photo {i + 1}</span>
                      <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{photo.size}</span>
                    </div>
                    <div className="absolute top-2 left-2 size-5 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(0,200,224,0.8)" }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: "#000" }}>{i + 1}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audio */}
          {entry.audioMemo && <AudioMemoPlayer audioMemo={entry.audioMemo} />}

          {/* Worker Statement */}
          {entry.workerComment && (
            <div className="p-4 rounded-2xl"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)", marginBottom: 6 }}>
                WORKER STATEMENT
              </p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.7 }}>
                &ldquo;{entry.workerComment}&rdquo;
              </p>
            </div>
          )}

          {/* Quick Actions */}
          <EvidenceQuickActions entry={entry} onNavigate={onNavigate} onRefresh={onRefresh} />

          {/* Chain of Custody */}
          <ChainOfCustody actions={entry.actions} />

          {/* Comments */}
          <EvidenceComments
            evidenceId={entry.id}
            comments={entry.comments}
            onCommentAdded={onRefresh}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Guide Me Evidence Copilot Panel ───────────────────────────
// Compact panel that appears inside the Guide Me sidebar
export function GuideMeEvidenceSuggestions({
  suggestions,
  onNavigate,
}: {
  suggestions: { id: string; priority: string; icon: string; title: string; description: string; actionLabel: string; navigateTo: string }[];
  onNavigate: (page: string) => void;
}) {
  if (suggestions.length === 0) return null;

  const PRIORITY_COLORS: Record<string, string> = {
    high: "#FF2D55",
    medium: "#FF9500",
    low: "#00C8E0",
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <Layers className="size-3.5" style={{ color: "#FFD60A" }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: "#FFD60A", letterSpacing: "0.5px" }}>
          EVIDENCE INTELLIGENCE
        </span>
      </div>
      {suggestions.map(s => {
        const color = PRIORITY_COLORS[s.priority] || "#00C8E0";
        return (
          <motion.button
            key={s.id}
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate(s.navigateTo)}
            className="w-full text-left p-3 rounded-xl flex items-start gap-3"
            style={{ background: `${color}08`, border: `1px solid ${color}15` }}
          >
            <div className="size-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{ background: `${color}15` }}>
              <Zap className="size-3.5" style={{ color }} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{s.title}</p>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2, lineHeight: 1.4 }}>
                {s.description}
              </p>
              <div className="flex items-center gap-1 mt-2" style={{ color }}>
                <span style={{ fontSize: 9, fontWeight: 700 }}>{s.actionLabel}</span>
                <ChevronRight className="size-3" />
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
