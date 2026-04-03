// ═══════════════════════════════════════════════════════════════
// SOSphere — Incident Photo Report
// Post-emergency flow: Employee adds photos + comment → Admin
// Admin broadcasts as QA Safety Warning to team
// Tiers: Free = 1 photo | Pro/Business = 5 photos | Enterprise = 10 photos
// ═══════════════════════════════════════════════════════════════
import React, { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Camera, Send, CheckCircle2, AlertTriangle, X,
  ImagePlus, FileText, Users, Shield, ChevronRight,
  Megaphone, Lock, Sparkles, Trash2, Eye, Radio,
  Clock, MapPin, Star, Mic, MicOff, Play, Square, Pause,
  Volume2, ArrowRight, Search, Download, Layers,
} from "lucide-react";
import { AUDIO_LIMITS, type EvidenceAudioMemo } from "./evidence-store";

// ── Types ─────────────────────────────────────────────────────
export type AccountTier = "free" | "paid" | "enterprise";

export interface IncidentReportData {
  emergencyId: string;
  employeeName: string;
  zone: string;
  photos: IncidentPhoto[];
  audioMemo?: { id: string; dataUrl: string; durationSec: number; format: string };
  comment: string;
  severity: "low" | "medium" | "high" | "critical";
  incidentType: string;
  timestamp: number;
}

export interface IncidentPhoto {
  id: string;
  dataUrl: string;
  caption?: string;
  size: string;
}

export interface AdminBroadcastPayload {
  report: IncidentReportData;
  broadcastTo: "all" | "zone" | "department";
  broadcastMessage: string;
  priority: "normal" | "urgent" | "emergency";
}

interface IncidentPhotoReportProps {
  emergencyId: string;
  employeeName: string;
  zone: string;
  tier?: AccountTier;
  // Employee side
  onSubmitReport: (data: IncidentReportData) => void;
  onClose: () => void;
}

// ── Constants ─────────────────────────────────────────────────
const PHOTO_LIMITS: Record<AccountTier, number> = {
  free: 1,       // Individual Free — 1 photo (basic documentation)
  paid: 5,       // Individual Pro / Company Employee — 5 photos (thorough evidence)
  enterprise: 10, // Enterprise — 10 photos (full forensic documentation)
};

const TIER_LABELS: Record<AccountTier, string> = {
  free: "Free Plan — 1 Photo",
  paid: "Pro / Business Plan",
  enterprise: "Enterprise Plan",
};

// ── Contact Notification Config — who sees photos based on tier ──
export const PHOTO_SHARING_RULES = {
  free: {
    contactsCanSeePhotos: false,     // Free: contacts only get text notification
    photosInReport: false,           // No PDF photo embed
    photoRetentionDays: 7,           // Auto-delete after 7 days
    desc: "Emergency contacts receive text alert only",
  },
  paid: {
    contactsCanSeePhotos: true,      // Pro: Full Contacts see thumbnail (blurred until tap)
    photosInReport: true,            // Photos embedded in PDF report
    photoRetentionDays: 90,          // 90-day retention
    desc: "Full Contacts see photo thumbnails · Lite Contacts get text only",
  },
  enterprise: {
    contactsCanSeePhotos: true,      // Enterprise: Full access + archival
    photosInReport: true,            // Full forensic PDF with all photos
    photoRetentionDays: 365,         // 1-year retention for compliance
    desc: "All photos archived for compliance · ISO 45001 evidence chain",
  },
} as const;

const INCIDENT_TYPES = [
  "Slip & Fall",
  "Chemical Exposure",
  "Equipment Failure",
  "Medical Emergency",
  "Fire / Smoke",
  "Electrical Hazard",
  "Personal Threat",
  "Natural Disaster",
  "Other",
];

// ═══════════════════════════════════════════════════════════════
// Employee: Incident Photo Report
// ═══════════════════════════════════════════════════════════════
export function IncidentPhotoReport({
  emergencyId,
  employeeName,
  zone,
  tier = "paid",
  onSubmitReport,
  onClose,
}: IncidentPhotoReportProps) {
  const [step, setStep] = useState<"photos" | "details" | "confirm" | "done">("photos");
  const [photos, setPhotos] = useState<IncidentPhoto[]>([]);
  const [comment, setComment] = useState("");
  const [incidentType, setIncidentType] = useState("");
  const [severity, setSeverity] = useState<IncidentReportData["severity"]>("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showUpgradeHint, setShowUpgradeHint] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Audio Recording State ─────────────────────────────────────
  const [audioMemo, setAudioMemo] = useState<IncidentReportData["audioMemo"] | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  const audioLimit = AUDIO_LIMITS[tier];
  const photoLimit = PHOTO_LIMITS[tier];
  const canAddMore = photos.length < photoLimit;

  // ── Audio Recording Functions ─────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          setAudioMemo({
            id: `AUDIO-${Date.now()}`,
            dataUrl: reader.result as string,
            durationSec: recordingTime,
            format: "webm",
          });
        };
        reader.readAsDataURL(blob);
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev + 1 >= audioLimit.maxDurationSec) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch {
      // Microphone not available — silent fail
    }
  }, [audioLimit.maxDurationSec, recordingTime]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const removeAudio = () => {
    setAudioMemo(null);
    setRecordingTime(0);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }
    setIsPlayingAudio(false);
  };

  const togglePlayAudio = () => {
    if (!audioMemo) return;
    if (!audioPlayerRef.current) {
      audioPlayerRef.current = new Audio(audioMemo.dataUrl);
      audioPlayerRef.current.onended = () => setIsPlayingAudio(false);
    }
    if (isPlayingAudio) {
      audioPlayerRef.current.pause();
    } else {
      audioPlayerRef.current.play().catch(() => {});
    }
    setIsPlayingAudio(!isPlayingAudio);
  };

  const formatRecTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Compress & Add Photo ─────────────────────────────────────
  const handlePhotoSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    for (const file of files.slice(0, photoLimit - photos.length)) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const sizeKB = Math.round(file.size / 1024);
        setPhotos(prev => [...prev, {
          id: `PHOTO-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          dataUrl,
          size: sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)}MB` : `${sizeKB}KB`,
        }]);
      };
      reader.readAsDataURL(file);
    }
    if (e.target) e.target.value = "";
  }, [photos.length, photoLimit]);

  const removePhoto = (id: string) => setPhotos(p => p.filter(ph => ph.id !== id));

  const handleSubmit = async () => {
    setIsSubmitting(true);
    await new Promise(r => setTimeout(r, 1800));
    const report: IncidentReportData = {
      emergencyId,
      employeeName,
      zone,
      photos,
      audioMemo: audioMemo || undefined,
      comment,
      severity,
      incidentType: incidentType || "Other",
      timestamp: Date.now(),
    };
    onSubmitReport(report);
    setIsSubmitting(false);
    setStep("done");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="w-full max-w-lg rounded-t-3xl overflow-hidden"
        style={{
          background: "#05070E",
          border: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "none",
          maxHeight: "92vh",
          overflowY: "auto",
          fontFamily: "'Outfit', sans-serif",
        }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} />
        </div>

        <AnimatePresence mode="wait">
          {/* ── Step: Photos ── */}
          {step === "photos" && (
            <motion.div key="photos"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="px-5 pb-8"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="size-7 rounded-lg flex items-center justify-center"
                      style={{ background: "rgba(255,45,85,0.15)", border: "1px solid rgba(255,45,85,0.2)" }}>
                      <Camera className="size-4" style={{ color: "#FF2D55" }} />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#FF2D55", letterSpacing: "0.5px" }}>
                      INCIDENT REPORT
                    </span>
                  </div>
                  <h2 style={{ fontSize: 22, fontWeight: 900, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.4px" }}>
                    Document the Incident
                  </h2>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                    {zone} · Emergency #{emergencyId.slice(-4)}
                  </p>
                </div>
                <button onClick={onClose}
                  className="size-8 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.05)" }}>
                  <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
                </button>
              </div>

              {/* Tier Badge */}
              <div className="flex items-center justify-between mb-4 px-3 py-2.5 rounded-2xl"
                style={{
                  background: tier === "free" ? "rgba(255,150,0,0.06)" : "rgba(0,200,224,0.06)",
                  border: `1px solid ${tier === "free" ? "rgba(255,150,0,0.15)" : "rgba(0,200,224,0.12)"}`,
                }}>
                <div className="flex items-center gap-2">
                  {tier === "free" ? <Lock className="size-3.5" style={{ color: "#FF9500" }} />
                    : <Star className="size-3.5" style={{ color: "#00C8E0" }} />}
                  <span style={{ fontSize: 12, fontWeight: 700, color: tier === "free" ? "#FF9500" : "#00C8E0" }}>
                    {TIER_LABELS[tier]}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
                  <strong style={{ color: "rgba(255,255,255,0.7)" }}>{photoLimit}</strong>
                  {" photo"}{photoLimit !== 1 ? "s" : ""} allowed
                </span>
              </div>

              {/* Photo Grid */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {/* Existing photos */}
                {photos.map((photo, i) => (
                  <motion.div
                    key={photo.id}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="relative aspect-square rounded-2xl overflow-hidden"
                    style={{ border: "1px solid rgba(0,200,224,0.2)" }}
                  >
                    <img src={photo.dataUrl} alt={`Incident ${i + 1}`}
                      className="w-full h-full object-cover" />
                    {/* Overlay */}
                    <div className="absolute inset-0 flex flex-col justify-between p-2"
                      style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)" }}>
                      <button
                        onClick={() => removePhoto(photo.id)}
                        className="self-end size-6 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(255,45,85,0.8)" }}>
                        <Trash2 className="size-3" style={{ color: "#fff" }} />
                      </button>
                      <div className="flex items-center gap-1">
                        <Eye className="size-3" style={{ color: "rgba(255,255,255,0.6)" }} />
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.6)" }}>{photo.size}</span>
                      </div>
                    </div>
                    {/* Index badge */}
                    <div className="absolute top-2 left-2 size-5 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(0,200,224,0.8)" }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: "#000" }}>{i + 1}</span>
                    </div>
                  </motion.div>
                ))}

                {/* Add photo slot(s) */}
                {photos.length < photoLimit && (
                  <motion.label
                    whileTap={{ scale: 0.97 }}
                    className="aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer"
                    style={{
                      borderColor: canAddMore ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.08)",
                      background: canAddMore ? "rgba(0,200,224,0.03)" : "rgba(255,255,255,0.01)",
                    }}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple={photoLimit > 1}
                      ref={fileInputRef as any}
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                    <ImagePlus className="size-8 mb-2" style={{ color: "rgba(0,200,224,0.6)" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(0,200,224,0.6)" }}>
                      {photos.length === 0 ? "Add Photo" : "Add More"}
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                      Tap or Camera
                    </span>
                  </motion.label>
                )}

                {/* Locked slots for free tier */}
                {tier === "free" && photos.length >= 1 && (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setShowUpgradeHint(true)}
                    className="aspect-square rounded-2xl flex flex-col items-center justify-center"
                    style={{ background: "rgba(255,150,0,0.04)", border: "1px dashed rgba(255,150,0,0.2)" }}
                  >
                    <Lock className="size-6 mb-2" style={{ color: "rgba(255,150,0,0.4)" }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,150,0,0.5)" }}>Upgrade</span>
                    <span style={{ fontSize: 8, color: "rgba(255,150,0,0.3)", marginTop: 1 }}>for 5 photos</span>
                  </motion.button>
                )}
              </div>

              {/* Upgrade Hint */}
              <AnimatePresence>
                {showUpgradeHint && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="mb-4 p-4 rounded-2xl flex items-start gap-3"
                    style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.15)" }}
                  >
                    <Sparkles className="size-4 flex-shrink-0 mt-0.5" style={{ color: "#FF9500" }} />
                    <div className="flex-1">
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#FF9500", marginBottom: 2 }}>
                        Upgrade to Business Plan
                      </p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
                        Add up to 5 photos per incident report, plus priority emergency routing, Family Circle sharing, and audit logs.
                      </p>
                    </div>
                    <button onClick={() => setShowUpgradeHint(false)}>
                      <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Photo required note */}
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 16, textAlign: "center" }}>
                {photos.length === 0
                  ? "Adding a photo is optional but helps document the incident"
                  : `${photos.length} of ${photoLimit} photos added`}
              </p>

              {/* Continue */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep("details")}
                className="w-full py-4 rounded-2xl flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #00C8E0, #00E676)",
                  boxShadow: "0 4px 24px rgba(0,200,224,0.25)",
                  color: "#000",
                  fontSize: 14,
                  fontWeight: 800,
                }}>
                Continue
                <ChevronRight className="size-5" />
              </motion.button>

              <button onClick={onClose}
                className="w-full mt-3 py-3 text-center"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", background: "none", border: "none" }}>
                Skip — report later
              </button>
            </motion.div>
          )}

          {/* ── Step: Details ── */}
          {step === "details" && (
            <motion.div key="details"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="px-5 pb-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <button onClick={() => setStep("photos")}
                  className="size-8 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.05)" }}>
                  <ChevronRight className="size-4 rotate-180" style={{ color: "rgba(255,255,255,0.5)" }} />
                </button>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 900, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.3px" }}>
                    Incident Details
                  </h2>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                    Describe what happened
                  </p>
                </div>
              </div>

              {/* Severity */}
              <div className="mb-5">
                <label style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 10 }}>
                  INCIDENT SEVERITY
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(["low", "medium", "high", "critical"] as const).map(s => {
                    const colors: Record<typeof s, string> = {
                      low: "#00C853",
                      medium: "#FF9500",
                      high: "#FF6B00",
                      critical: "#FF2D55",
                    };
                    const isSelected = severity === s;
                    return (
                      <button key={s}
                        onClick={() => setSeverity(s)}
                        className="py-2.5 rounded-xl"
                        style={{
                          background: isSelected ? `${colors[s]}20` : "rgba(255,255,255,0.03)",
                          border: isSelected ? `1.5px solid ${colors[s]}50` : "1px solid rgba(255,255,255,0.06)",
                          color: isSelected ? colors[s] : "rgba(255,255,255,0.3)",
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "capitalize",
                        }}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Incident Type */}
              <div className="mb-5">
                <label style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 10 }}>
                  INCIDENT TYPE
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {INCIDENT_TYPES.map(type => (
                    <button key={type}
                      onClick={() => setIncidentType(type)}
                      className="py-2 px-2 rounded-xl text-left"
                      style={{
                        background: incidentType === type ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)",
                        border: incidentType === type ? "1.5px solid rgba(0,200,224,0.3)" : "1px solid rgba(255,255,255,0.05)",
                        color: incidentType === type ? "#00C8E0" : "rgba(255,255,255,0.45)",
                        fontSize: 10,
                        fontWeight: 600,
                      }}>
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Comment */}
              <div className="mb-6">
                <label style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 8 }}>
                  WHAT HAPPENED? <span style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>(optional)</span>
                </label>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Briefly describe the incident — what you saw, heard, or felt. This helps the safety team respond faster and prevent recurrence."
                  rows={4}
                  className="w-full rounded-2xl px-4 py-3 outline-none resize-none"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    color: "rgba(255,255,255,0.85)",
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                />
                <div className="flex justify-between mt-1.5">
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                    {comment.length} characters
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>
                    {photos.length} photo{photos.length !== 1 ? "s" : ""} attached
                  </span>
                </div>
              </div>

              {/* Voice Memo Recording */}
              <div className="mb-6">
                <label style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 8 }}>
                  VOICE MEMO <span style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400 }}>(optional · max {audioLimit.label})</span>
                </label>
                {!audioMemo ? (
                  <div className="flex items-center gap-3 p-3 rounded-2xl"
                    style={{
                      background: isRecording ? "rgba(255,45,85,0.06)" : "rgba(123,94,255,0.04)",
                      border: `1px solid ${isRecording ? "rgba(255,45,85,0.15)" : "rgba(123,94,255,0.1)"}`,
                    }}>
                    <motion.button
                      whileTap={{ scale: 0.9 }}
                      onClick={isRecording ? stopRecording : startRecording}
                      className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        background: isRecording ? "rgba(255,45,85,0.15)" : "rgba(123,94,255,0.15)",
                        border: `1.5px solid ${isRecording ? "rgba(255,45,85,0.3)" : "rgba(123,94,255,0.25)"}`,
                      }}>
                      {isRecording ? (
                        <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                          <Square className="size-4" style={{ color: "#FF2D55" }} />
                        </motion.div>
                      ) : (
                        <Mic className="size-4" style={{ color: "#7B5EFF" }} />
                      )}
                    </motion.button>
                    <div className="flex-1">
                      <p style={{ fontSize: 12, fontWeight: 700, color: isRecording ? "#FF2D55" : "rgba(255,255,255,0.6)" }}>
                        {isRecording ? "Recording..." : "Tap to record voice memo"}
                      </p>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                        {isRecording ? `${formatRecTime(recordingTime)} / ${audioLimit.label}` : "Describe what happened in your own words"}
                      </p>
                    </div>
                    {isRecording && (
                      <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }}
                        className="size-3 rounded-full flex-shrink-0" style={{ background: "#FF2D55" }} />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-2xl"
                    style={{ background: "rgba(123,94,255,0.06)", border: "1px solid rgba(123,94,255,0.15)" }}>
                    <motion.button whileTap={{ scale: 0.9 }} onClick={togglePlayAudio}
                      className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{
                        background: isPlayingAudio ? "rgba(255,45,85,0.15)" : "rgba(123,94,255,0.2)",
                        border: `1.5px solid ${isPlayingAudio ? "rgba(255,45,85,0.3)" : "rgba(123,94,255,0.3)"}`,
                      }}>
                      {isPlayingAudio ? <Pause className="size-4" style={{ color: "#FF2D55" }} />
                        : <Play className="size-4" style={{ color: "#7B5EFF" }} />}
                    </motion.button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Mic className="size-3" style={{ color: "#7B5EFF" }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>Voice Memo</span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{formatRecTime(audioMemo.durationSec)} · {audioMemo.format.toUpperCase()}</span>
                      </div>
                      <div className="w-full h-1.5 mt-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <motion.div
                          animate={isPlayingAudio ? { width: ["0%", "100%"] } : {}}
                          transition={{ duration: audioMemo.durationSec, ease: "linear" }}
                          className="h-full rounded-full"
                          style={{ width: isPlayingAudio ? undefined : "0%", background: "linear-gradient(90deg, #7B5EFF, #AF52DE)" }}
                        />
                      </div>
                    </div>
                    <button onClick={removeAudio} className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(255,45,85,0.1)" }}>
                      <Trash2 className="size-3" style={{ color: "#FF2D55" }} />
                    </button>
                  </div>
                )}
              </div>

              {/* Preview summary */}
              <div className="mb-6 p-4 rounded-2xl space-y-2"
                style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.1)" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(0,200,224,0.7)", letterSpacing: "0.5px", marginBottom: 8 }}>
                  REPORT SUMMARY
                </p>
                <SummaryRow icon={<Shield className="size-3.5" />} label="Employee" value={employeeName} />
                <SummaryRow icon={<MapPin className="size-3.5" />} label="Zone" value={zone} />
                <SummaryRow icon={<AlertTriangle className="size-3.5" />} label="Severity" value={severity.toUpperCase()} />
                <SummaryRow icon={<FileText className="size-3.5" />} label="Type" value={incidentType || "Not specified"} />
                <SummaryRow icon={<Camera className="size-3.5" />} label="Photos" value={`${photos.length} attached`} />
                {audioMemo && (
                  <SummaryRow icon={<Mic className="size-3.5" />} label="Audio" value={`${audioMemo.durationSec}s`} />
                )}
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep("confirm")}
                className="w-full py-4 rounded-2xl flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg, #00C8E0, #00E676)",
                  color: "#000",
                  fontSize: 14,
                  fontWeight: 800,
                  boxShadow: "0 4px 24px rgba(0,200,224,0.25)",
                }}>
                Review & Send
                <ChevronRight className="size-5" />
              </motion.button>
            </motion.div>
          )}

          {/* ── Step: Confirm ── */}
          {step === "confirm" && (
            <motion.div key="confirm"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              className="px-5 pb-8"
            >
              <div className="flex items-center gap-3 mb-6">
                <button onClick={() => setStep("details")}
                  className="size-8 rounded-xl flex items-center justify-center"
                  style={{ background: "rgba(255,255,255,0.05)" }}>
                  <ChevronRight className="size-4 rotate-180" style={{ color: "rgba(255,255,255,0.5)" }} />
                </button>
                <h2 style={{ fontSize: 20, fontWeight: 900, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.3px" }}>
                  Send to Admin
                </h2>
              </div>

              {/* What happens next */}
              <div className="space-y-3 mb-6">
                <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.6)", marginBottom: 12 }}>
                  WHAT HAPPENS AFTER YOU SEND:
                </p>

                {[
                  {
                    icon: <Shield className="size-4" style={{ color: "#00C8E0" }} />,
                    color: "#00C8E0",
                    title: "Admin receives your report",
                    desc: "Photos + comment delivered instantly to your company admin",
                  },
                  {
                    icon: <Megaphone className="size-4" style={{ color: "#FF9500" }} />,
                    color: "#FF9500",
                    title: "Admin reviews & can broadcast",
                    desc: "They can send a safety warning to your team or relevant zones",
                  },
                  {
                    icon: <Users className="size-4" style={{ color: "#00C853" }} />,
                    color: "#00C853",
                    title: "Team gets notified (QA Alert)",
                    desc: "Other workers are warned to avoid similar risks in real-time",
                  },
                  {
                    icon: <Users className="size-4" style={{ color: "#AF52DE" }} />,
                    color: "#AF52DE",
                    title: tier !== "free" ? "Emergency contacts notified with photos" : "Contacts notified (text only)",
                    desc: tier !== "free"
                      ? "Full Contacts see blurred photo thumbnails · Lite Contacts get text alert"
                      : "Upgrade to Pro so your contacts can see incident photos",
                  },
                  {
                    icon: <FileText className="size-4" style={{ color: "#4A90D9" }} />,
                    color: "#4A90D9",
                    title: "Added to audit log",
                    desc: tier !== "free"
                      ? "Permanent record with photos embedded in PDF report"
                      : "Basic text record — upgrade for photo-embedded reports",
                  },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 p-3.5 rounded-2xl"
                    style={{ background: `${item.color}08`, border: `1px solid ${item.color}18` }}>
                    <div className="size-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: `${item.color}15` }}>
                      {item.icon}
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{item.title}</p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2, lineHeight: 1.5 }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Photos preview strip */}
              {photos.length > 0 && (
                <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
                  {photos.map((photo, i) => (
                    <div key={photo.id} className="relative flex-shrink-0 size-16 rounded-xl overflow-hidden"
                      style={{ border: "1px solid rgba(0,200,224,0.2)" }}>
                      <img src={photo.dataUrl} alt="" className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center py-0.5"
                        style={{ background: "rgba(0,0,0,0.6)" }}>
                        <span style={{ fontSize: 8, color: "rgba(255,255,255,0.6)" }}>Photo {i + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Send Button */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="w-full py-4 rounded-2xl flex items-center justify-center gap-2"
                style={{
                  background: isSubmitting ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, #FF2D55, #D91A46)",
                  color: isSubmitting ? "rgba(255,255,255,0.3)" : "#fff",
                  fontSize: 14,
                  fontWeight: 800,
                  boxShadow: isSubmitting ? "none" : "0 4px 24px rgba(255,45,85,0.3)",
                }}>
                {isSubmitting ? (
                  <>
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="size-5 border-2 border-current border-t-transparent rounded-full"
                    />
                    Sending to Admin...
                  </>
                ) : (
                  <>
                    <Send className="size-5" />
                    Send Report to Admin
                  </>
                )}
              </motion.button>

              <button onClick={onClose}
                className="w-full mt-3 py-3 text-center"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", background: "none", border: "none" }}>
                Cancel
              </button>
            </motion.div>
          )}

          {/* ── Step: Done ── */}
          {step === "done" && (
            <motion.div key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="px-5 pb-10 pt-2 text-center"
            >
              {/* Confetti Particles */}
              <div className="relative h-2 mb-8">
                {Array.from({ length: 16 }, (_, i) => (
                  <motion.div key={i}
                    className="absolute rounded-sm"
                    style={{
                      left: `${10 + Math.random() * 80}%`,
                      width: 6, height: 6,
                      background: ["#00C8E0", "#00E676", "#FF9500"][i % 3],
                    }}
                    initial={{ top: 0, opacity: 1, rotate: 0 }}
                    animate={{ top: 80, opacity: 0, rotate: 360 }}
                    transition={{ duration: 1.5, delay: i * 0.06 }}
                  />
                ))}
              </div>

              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="size-20 rounded-full mx-auto mb-4 flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, rgba(0,200,83,0.2), rgba(0,200,83,0.05))",
                  border: "2px solid rgba(0,200,83,0.3)",
                  boxShadow: "0 0 40px rgba(0,200,83,0.15)",
                }}>
                <CheckCircle2 className="size-10" style={{ color: "#00C853" }} />
              </motion.div>

              <h2 style={{ fontSize: 24, fontWeight: 900, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.4px", marginBottom: 8 }}>
                Report Sent! ✓
              </h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 6 }}>
                Your incident report has been delivered to Admin
              </p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 28 }}>
                They will review it and may broadcast a safety warning to your team
              </p>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-8">
                {[
                  { value: photos.length, label: "Photos", color: "#00C8E0" },
                  { value: severity, label: "Severity", color: severity === "critical" ? "#FF2D55" : "#FF9500" },
                  { value: "Delivered", label: "Status", color: "#00C853" },
                ].map(s => (
                  <div key={s.label} className="p-3 rounded-2xl"
                    style={{ background: `${s.color}0D`, border: `1px solid ${s.color}20` }}>
                    <p style={{ fontSize: 16, fontWeight: 800, color: "rgba(255,255,255,0.9)", textTransform: "capitalize" }}>{s.value}</p>
                    <p style={{ fontSize: 9, color: `${s.color}80`, marginTop: 2 }}>{s.label}</p>
                  </div>
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="w-full py-4 rounded-2xl"
                style={{
                  background: "linear-gradient(135deg, #00C8E0, #00E676)",
                  color: "#000",
                  fontSize: 14,
                  fontWeight: 800,
                }}>
                Done — Back to App
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ── Summary Row ───────────────────────────────────────────────
function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2" style={{ color: "rgba(255,255,255,0.35)" }}>
        {icon}
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{label}</span>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{value}</span>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════
// Admin: Broadcast Safety Warning Panel
// Admin receives the report → can broadcast to team
// ═══════════════════════════════════════════════════════════════
interface AdminBroadcastPanelProps {
  report: IncidentReportData;
  onBroadcast: (payload: AdminBroadcastPayload) => void;
  onForwardToOwner: (report: IncidentReportData) => void;
  onClose: () => void;
  companyName?: string;
}

export function AdminBroadcastPanel({
  report,
  onBroadcast,
  onForwardToOwner,
  onClose,
  companyName = "Company",
}: AdminBroadcastPanelProps) {
  const [broadcastTo, setBroadcastTo] = useState<"all" | "zone" | "department">("zone");
  const [priority, setPriority] = useState<"normal" | "urgent" | "emergency">("urgent");
  const [message, setMessage] = useState(
    `⚠️ Safety Alert: A ${report.severity} incident occurred in ${report.zone}. ` +
    `Type: ${report.incidentType}. ` +
    `Please exercise caution in this area. Report filed by ${report.employeeName}.`
  );
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleBroadcast = async () => {
    setIsSending(true);
    await new Promise(r => setTimeout(r, 1500));
    onBroadcast({ report, broadcastTo, broadcastMessage: message, priority });
    setIsSending(false);
    setSent(true);
  };

  const severityColor = {
    low: "#00C853",
    medium: "#FF9500",
    high: "#FF6B00",
    critical: "#FF2D55",
  }[report.severity];

  return (
    <div className="p-6 rounded-2xl"
      style={{
        background: "rgba(10,18,32,0.95)",
        border: "1px solid rgba(255,255,255,0.08)",
        fontFamily: "'Outfit', sans-serif",
      }}>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Radio className="size-4" style={{ color: "#FF9500" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#FF9500", letterSpacing: "0.5px" }}>
              INCIDENT REPORT RECEIVED
            </span>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.3px" }}>
            Broadcast Safety Warning
          </h3>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
            From {report.employeeName} · {report.zone}
          </p>
        </div>
        <button onClick={onClose}
          className="size-8 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.05)" }}>
          <X className="size-4" style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
      </div>

      {/* Report Summary */}
      <div className="p-4 rounded-2xl mb-5"
        style={{ background: `${severityColor}08`, border: `1px solid ${severityColor}20` }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="px-2.5 py-1 rounded-full"
            style={{ fontSize: 10, fontWeight: 800, background: `${severityColor}20`, color: severityColor, letterSpacing: "0.5px" }}>
            {report.severity.toUpperCase()}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
            {report.incidentType}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
            <Clock className="size-3 inline mr-1" />
            {new Date(report.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {report.comment && (
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.6, marginBottom: 12 }}>
            "{report.comment}"
          </p>
        )}

        {/* Photo thumbnails */}
        {report.photos.length > 0 && (
          <div className="flex gap-2">
            {report.photos.map((photo, i) => (
              <div key={photo.id} className="size-12 rounded-xl overflow-hidden flex-shrink-0"
                style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                <img src={photo.dataUrl} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
            <div className="size-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                {report.photos.length} photo{report.photos.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Audio Memo (if present) */}
      {report.audioMemo && (
        <div className="mb-5 flex items-center gap-3 p-3 rounded-2xl"
          style={{ background: "rgba(123,94,255,0.06)", border: "1px solid rgba(123,94,255,0.15)" }}>
          <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(123,94,255,0.2)", border: "1px solid rgba(123,94,255,0.3)" }}>
            <Mic className="size-4" style={{ color: "#7B5EFF" }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>Voice Memo</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                {report.audioMemo.durationSec}s · {report.audioMemo.format?.toUpperCase() || "WEBM"}
              </span>
            </div>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
              Worker recorded a voice description of the incident
            </p>
          </div>
        </div>
      )}

      {!sent ? (
        <>
          {/* Broadcast Target */}
          <div className="mb-4">
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 8, letterSpacing: "0.5px" }}>
              BROADCAST TO
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "zone", label: "Zone Only", icon: <MapPin className="size-3.5" />, desc: report.zone.split(" - ")[0] },
                { id: "all", label: "All Company", icon: <Users className="size-3.5" />, desc: companyName },
                { id: "department", label: "Department", icon: <Shield className="size-3.5" />, desc: "Safety Dept" },
              ] as const).map(opt => (
                <button key={opt.id}
                  onClick={() => setBroadcastTo(opt.id)}
                  className="p-3 rounded-xl text-left"
                  style={{
                    background: broadcastTo === opt.id ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.02)",
                    border: broadcastTo === opt.id ? "1.5px solid rgba(0,200,224,0.3)" : "1px solid rgba(255,255,255,0.06)",
                  }}>
                  <div style={{ color: broadcastTo === opt.id ? "#00C8E0" : "rgba(255,255,255,0.3)", marginBottom: 4 }}>
                    {opt.icon}
                  </div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: broadcastTo === opt.id ? "#00C8E0" : "rgba(255,255,255,0.6)" }}>
                    {opt.label}
                  </p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Priority */}
          <div className="mb-4">
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 8, letterSpacing: "0.5px" }}>
              ALERT PRIORITY
            </label>
            <div className="flex gap-2">
              {([
                { id: "normal", label: "Normal", color: "#00C8E0" },
                { id: "urgent", label: "Urgent", color: "#FF9500" },
                { id: "emergency", label: "Emergency", color: "#FF2D55" },
              ] as const).map(p => (
                <button key={p.id}
                  onClick={() => setPriority(p.id)}
                  className="flex-1 py-2 rounded-xl"
                  style={{
                    background: priority === p.id ? `${p.color}15` : "rgba(255,255,255,0.02)",
                    border: priority === p.id ? `1.5px solid ${p.color}40` : "1px solid rgba(255,255,255,0.06)",
                    color: priority === p.id ? p.color : "rgba(255,255,255,0.35)",
                    fontSize: 11,
                    fontWeight: 700,
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message Edit */}
          <div className="mb-5">
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 8, letterSpacing: "0.5px" }}>
              BROADCAST MESSAGE
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
              className="w-full rounded-xl px-4 py-3 outline-none resize-none"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                color: "rgba(255,255,255,0.8)",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => onForwardToOwner(report)}
              className="flex items-center gap-2 px-4 py-3 rounded-xl"
              style={{
                background: "rgba(74,144,217,0.1)",
                border: "1px solid rgba(74,144,217,0.2)",
                color: "#4A90D9",
                fontSize: 12,
                fontWeight: 700,
              }}>
              <ChevronRight className="size-4" />
              Forward to Owner
            </button>
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleBroadcast}
              disabled={isSending}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl"
              style={{
                background: isSending ? "rgba(255,255,255,0.05)" : "linear-gradient(135deg, #FF9500, #FF6B00)",
                color: isSending ? "rgba(255,255,255,0.3)" : "#fff",
                fontSize: 13,
                fontWeight: 800,
                boxShadow: isSending ? "none" : "0 4px 20px rgba(255,150,0,0.3)",
              }}>
              {isSending ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="size-4 border-2 border-current border-t-transparent rounded-full" />
              ) : <Megaphone className="size-4" />}
              {isSending ? "Broadcasting..." : "Broadcast Warning"}
            </motion.button>
          </div>
        </>
      ) : (
        /* Sent State */
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-6"
        >
          <div className="size-16 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{ background: "rgba(255,150,0,0.1)", border: "2px solid rgba(255,150,0,0.3)" }}>
            <CheckCircle2 className="size-8" style={{ color: "#FF9500" }} />
          </div>
          <p style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,0.9)", marginBottom: 6 }}>
            Safety Warning Broadcast!
          </p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
            Alert sent to {broadcastTo === "all" ? "all company employees" : broadcastTo === "zone" ? report.zone : "department"}
          </p>
          <button onClick={onClose}
            className="mt-6 px-8 py-3 rounded-xl"
            style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600 }}>
            Close
          </button>
        </motion.div>
      )}
    </div>
  );
}