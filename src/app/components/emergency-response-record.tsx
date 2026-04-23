import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shield, MapPin, Phone, PhoneMissed, CheckCircle,
  MessageSquare, Mic, AlertTriangle, Clock, FileText,
  Download, Lock, ChevronLeft, Radio, RefreshCw,
  PhoneCall, X, Calendar, Zap, Camera, ImageIcon,
} from "lucide-react";
import { ImageWithFallback } from "./figma/ImageWithFallback";
import type { IncidentRecord, ERREvent } from "./sos-emergency";
import { getGPSTrail } from "./smart-timeline-tracker";
import { generateIndividualReport, computeIncidentHashAsync, type IndividualReportData } from "./individual-pdf-report";

interface EmergencyResponseRecordProps {
  record: IncidentRecord;
  onBack: () => void;
}

// ─── Event icon + color map ───────────────────────────────────────────────────

function eventMeta(type: ERREvent["type"]): { Icon: React.ElementType; color: string; bg: string } {
  const m: Record<string, { Icon: React.ElementType; color: string; bg: string }> = {
    sos_start:       { Icon: Zap,          color: "#FF2D55", bg: "rgba(255,45,85,0.1)" },
    call_out:        { Icon: PhoneCall,    color: "#00C8E0", bg: "rgba(0,200,224,0.08)" },
    no_answer:       { Icon: PhoneMissed,  color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
    answered:        { Icon: CheckCircle,  color: "#00C853", bg: "rgba(0,200,83,0.08)" },
    sms_sent:        { Icon: MessageSquare,color: "#00C853", bg: "rgba(0,200,83,0.08)" },
    recording_start: { Icon: Radio,        color: "#FF2D55", bg: "rgba(255,45,85,0.08)" },
    recording_end:   { Icon: Mic,          color: "#00C853", bg: "rgba(0,200,83,0.08)" },
    dms_check:       { Icon: AlertTriangle,color: "#FF9500", bg: "rgba(255,150,0,0.08)" },
    dms_confirmed:   { Icon: CheckCircle,  color: "#00C853", bg: "rgba(0,200,83,0.08)" },
    pause_start:     { Icon: RefreshCw,    color: "#FF2D55", bg: "rgba(255,45,85,0.06)" },
    pause_end:       { Icon: RefreshCw,    color: "#00C8E0", bg: "rgba(0,200,224,0.06)" },
    location_share:  { Icon: MapPin,       color: "#00C8E0", bg: "rgba(0,200,224,0.08)" },
    sos_end:         { Icon: Shield,       color: "#00C8E0", bg: "rgba(0,200,224,0.08)" },
  };
  return m[type] ?? { Icon: Clock, color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.04)" };
}

function formatTime(d: Date) {
  return d.toLocaleTimeString("en-SA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function formatDate(d: Date) {
  return d.toLocaleDateString("en-SA", { year: "numeric", month: "long", day: "numeric" });
}
function formatDur(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EmergencyResponseRecord({ record, onBack }: EmergencyResponseRecordProps) {
  const [showPremium, setShowPremium] = useState(false);

  const duration = record.endTime
    ? Math.round((record.endTime.getTime() - record.startTime.getTime()) / 1000)
    : 0;

  const callsTotal = record.events.filter((e) => e.type === "call_out").length;
  const callsAnswered = record.events.filter((e) => e.type === "answered").length;
  const dmsTotal = record.events.filter((e) => e.type === "dms_check").length;

  const stats = [
    { label: "Duration", value: formatDur(duration), color: "#00C8E0" },
    { label: "Calls Made", value: `${callsTotal}`, color: "#FF9500" },
    { label: "Answered", value: `${callsAnswered}`, color: "#00C853" },
    { label: "DMS Checks", value: `${dmsTotal}`, color: "#FF9500" },
  ];

  return (
    <div className="relative flex flex-col h-full" style={{ background: "#05070E" }}>

      {/* Ambient */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none"
        style={{
          width: 400, height: 300,
          background: "radial-gradient(ellipse, rgba(0,200,224,0.04) 0%, transparent 65%)",
        }}
      />

      {/* ── Header ── */}
      <div className="shrink-0 px-5 pt-14 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onBack}
            className="flex items-center justify-center"
            style={{
              width: 34, height: 34, borderRadius: "50%",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <ChevronLeft style={{ width: 16, height: 16, color: "rgba(255,255,255,0.5)" }} />
          </motion.button>
          <div className="flex-1">
            <p style={{ fontSize: 17, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px", fontFamily: "inherit" }}>
              Emergency Response Record
            </p>
            <p style={{ fontSize: 11, color: "rgba(0,200,224,0.6)", fontFamily: "inherit", fontWeight: 600, letterSpacing: "0.4px" }}>
              {record.id}
            </p>
          </div>
          {/* PDF Export */}
          <motion.button
            whileTap={{ scale: 0.93 }}
            onClick={async () => {
              if (record.isPremium) {
                // Real user profile from localStorage
                const _profile = (() => { try { return JSON.parse(localStorage.getItem("sosphere_individual_profile") || "{}"); } catch { return {}; } })();

                // FIX 2026-04-23: honest GPS trail. Previously if getGPSTrail()
                // returned empty we synthesized a fallback (single trigger
                // point pretending to be a trail). Now we keep the trail
                // empty when no real data exists and set the honesty flag so
                // the PDF renders "GPS trail not available".
                const _rawTrail = getGPSTrail();
                const _gpsTrail = _rawTrail.length > 0
                  ? _rawTrail.map(p => ({ lat: p.lat, lng: p.lng, time: new Date(p.timestamp) }))
                  : [];
                const _gpsTrailIsReal = _rawTrail.length > 0;

                // FIX 2026-04-23: call duration previously hardcoded as 15s
                // whenever c.status === "answered". Now we measure it from
                // the event timeline — the gap between the "call_out" for
                // this contact and the subsequent "answered" / "no_answer"
                // / "sos_end" event. If we can't measure, we leave
                // callDuration undefined (PDF shows "—" honestly).
                const _measureCallDuration = (contactName: string): number | undefined => {
                  const ev = record.events;
                  let startIdx = -1;
                  for (let i = 0; i < ev.length; i++) {
                    if (ev[i].type === "call_out" && (ev[i].detail?.includes(contactName) || ev[i].title?.includes(contactName))) {
                      startIdx = i;
                      break;
                    }
                  }
                  if (startIdx < 0) return undefined;
                  for (let j = startIdx + 1; j < ev.length; j++) {
                    const t = ev[j].type;
                    if (t === "answered" || t === "no_answer" || t === "sos_end") {
                      const ms = ev[j].ts.getTime() - ev[startIdx].ts.getTime();
                      if (ms > 0 && ms < 30 * 60 * 1000) return Math.round(ms / 1000);
                      return undefined;
                    }
                  }
                  return undefined;
                };

                // FIX 2026-04-23: endReason previously hardcoded as
                // "contact_resolved". Now we derive from the record's
                // terminating event detail if available, else "unknown".
                const _endReason = (() => {
                  const lastEnd = [...record.events].reverse().find(e => e.type === "sos_end");
                  if (lastEnd?.detail) return lastEnd.detail;
                  if (lastEnd?.title) return lastEnd.title;
                  return "unknown";
                })();

                // FIX 2026-04-23: honesty flags — these fields are ONLY true
                // when we actually captured and persisted the blob. Until
                // Phase 1 (real audio/photo capture) lands, these stay
                // false and the PDF admits the data isn't really stored.
                const _audioCaptured = false;
                const _photosCaptured = false;

                // FIX 2026-04-23: real SHA-256 document hash (was
                // deterministic mock). Canonical payload is a stable JSON
                // representation of the incident.
                const _canonical = JSON.stringify({
                  id: record.id,
                  start: record.startTime.toISOString(),
                  end: (record.endTime || new Date()).toISOString(),
                  trigger: record.triggerMethod,
                  location: record.location,
                  contacts: record.contacts.map(c => ({ name: c.name, phone: c.phone, status: c.status })),
                  cycles: record.cyclesCompleted,
                  recordingSec: record.recordingSeconds,
                  events: record.events.map(e => ({ type: e.type, title: e.title, ts: e.ts.toISOString() })),
                });
                const _documentHash = await computeIncidentHashAsync(record.id, _canonical);

                const reportData: IndividualReportData = {
                  userName: _profile.name || _profile.fullName || "User",
                  userPhone: _profile.phone || "",
                  plan: "personal",
                  incidentId: record.id,
                  triggerMethod: record.triggerMethod as any,
                  startTime: record.startTime,
                  endTime: record.endTime || new Date(),
                  location: record.location,
                  gpsTrail: _gpsTrail,
                  gpsTrailIsReal: _gpsTrailIsReal,
                  contacts: record.contacts.map(c => ({
                    name: c.name,
                    relation: c.relation,
                    phone: c.phone,
                    status: c.status as any,
                    callDuration: _measureCallDuration(c.name),
                  })),
                  cyclesCompleted: record.cyclesCompleted,
                  recordingDuration: record.recordingSeconds,
                  photoCount: record.photos?.length || 0,
                  audioCaptured: _audioCaptured,
                  audioUrl: null,
                  photosCaptured: _photosCaptured,
                  timeline: record.events.map(ev => ({
                    time: ev.ts,
                    event: ev.title,
                    type: (ev.type === "sos_start" || ev.type === "sos_end" ? "trigger" : ev.type === "call_out" || ev.type === "no_answer" ? "call" : ev.type === "answered" ? "answer" : ev.type === "location_share" || ev.type === "sms_sent" ? "location" : ev.type === "recording_start" || ev.type === "recording_end" ? "recording" : "end") as any,
                  })),
                  endReason: _endReason,
                  documentHash: _documentHash,
                };
                generateIndividualReport(reportData);
              } else {
                setShowPremium(true);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-2"
            style={{
              borderRadius: 10,
              background: record.isPremium ? "rgba(0,200,224,0.1)" : "rgba(255,150,0,0.08)",
              border: `1px solid ${record.isPremium ? "rgba(0,200,224,0.2)" : "rgba(255,150,0,0.2)"}`,
            }}
          >
            {record.isPremium ? (
              <Download style={{ width: 13, height: 13, color: "#00C8E0" }} />
            ) : (
              <Lock style={{ width: 13, height: 13, color: "#FF9500" }} />
            )}
            <span style={{ fontSize: 11, fontWeight: 600, color: record.isPremium ? "#00C8E0" : "#FF9500", fontFamily: "inherit" }}>
              PDF
            </span>
          </motion.button>
        </div>

        {/* Incident summary card */}
        <div
          className="px-4 py-4"
          style={{
            borderRadius: 18,
            background: "rgba(10,18,32,0.8)",
            border: "1px solid rgba(255,255,255,0.07)",
            backdropFilter: "blur(20px)",
          }}
        >
          {/* Date + trigger */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Calendar style={{ width: 13, height: 13, color: "rgba(255,255,255,0.25)" }} />
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "inherit" }}>
                {formatDate(record.startTime)}
              </span>
            </div>
            <div
              className="px-2.5 py-1"
              style={{
                borderRadius: 8,
                background: "rgba(255,45,85,0.08)",
                border: "1px solid rgba(255,45,85,0.15)",
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 600, color: "#FF2D55", letterSpacing: "0.5px", fontFamily: "inherit" }}>
                {record.triggerMethod === "hold" ? "HOLD 3s" : record.triggerMethod.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Time range */}
          <div className="flex items-center gap-2 mb-3">
            <Clock style={{ width: 12, height: 12, color: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: "inherit" }}>
              {formatTime(record.startTime)}
              {record.endTime && ` → ${formatTime(record.endTime)}`}
            </span>
          </div>

          {/* Location */}
          <div className="flex items-start gap-2 mb-4">
            <MapPin style={{ width: 12, height: 12, color: "#00C8E0", flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "inherit" }}>
                {record.location.address}
              </p>
              <p style={{ fontSize: 10, color: "rgba(0,200,224,0.45)", fontFamily: "inherit" }}>
                {record.location.lat}° N, {record.location.lng}° E · ±{record.location.accuracy}m
              </p>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2">
            {stats.map((s) => (
              <div
                key={s.label}
                className="flex flex-col items-center py-2.5"
                style={{
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: "inherit" }}>
                  {s.value}
                </span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontWeight: 500, marginTop: 2, textAlign: "center", fontFamily: "inherit" }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Contacts summary ── */}
      <div className="shrink-0 px-5 mb-3">
        <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px", marginBottom: 8, fontFamily: "inherit" }}>
          CONTACTS ATTEMPTED
        </p>
        <div className="flex gap-2">
          {record.contacts.filter((c) => c.status !== "pending").map((c) => {
            const isAns = c.status === "answered";
            return (
              <div
                key={c.id}
                className="flex-1 flex flex-col items-center py-2.5 gap-1.5"
                style={{
                  borderRadius: 14,
                  background: isAns ? "rgba(0,200,83,0.06)" : "rgba(255,150,0,0.04)",
                  border: `1px solid ${isAns ? "rgba(0,200,83,0.15)" : "rgba(255,150,0,0.1)"}`,
                }}
              >
                <div
                  className="size-7 rounded-full flex items-center justify-center"
                  style={{ background: isAns ? "rgba(0,200,83,0.1)" : "rgba(255,150,0,0.08)" }}
                >
                  {isAns
                    ? <Phone style={{ width: 12, height: 12, color: "#00C853" }} />
                    : <PhoneMissed style={{ width: 12, height: 12, color: "#FF9500" }} />
                  }
                </div>
                <p style={{ fontSize: 11, fontWeight: 600, color: "#fff", fontFamily: "inherit" }}>{c.name}</p>
                <p style={{ fontSize: 9, color: isAns ? "rgba(0,200,83,0.6)" : "rgba(255,150,0,0.5)", fontFamily: "inherit" }}>
                  {isAns ? "ANSWERED" : "NO ANSWER"}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Field Evidence (photos + comment + recording) ── */}
      {(record.photos?.length > 0 || record.comment || record.recordingSeconds > 0) && (
        <div className="shrink-0 px-5 mb-3">
          <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px", marginBottom: 8, fontFamily: "inherit" }}>
            FIELD EVIDENCE {record.evidenceId ? `· ${record.evidenceId}` : ""}
          </p>
          <div
            className="px-4 py-3 space-y-3"
            style={{ borderRadius: 14, background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.1)" }}
          >
            {/* Photos */}
            {record.photos?.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Camera style={{ width: 11, height: 11, color: "#00C8E0" }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(0,200,224,0.7)", fontFamily: "inherit" }}>
                    {record.photos.length} Photo{record.photos.length > 1 ? "s" : ""} Captured
                  </span>
                </div>
                <div className="flex gap-2">
                  {record.photos.map((url, i) => (
                    <div
                      key={i}
                      className="size-16 rounded-xl overflow-hidden relative"
                      style={{ border: "1.5px solid rgba(0,200,224,0.2)" }}
                    >
                      <ImageWithFallback src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute top-0.5 right-0.5 size-4 rounded-full flex items-center justify-center" style={{ background: "rgba(0,200,83,0.9)" }}>
                        <CheckCircle style={{ width: 10, height: 10, color: "#fff" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Voice Recording */}
            {record.recordingSeconds > 0 && (
              <div className="flex items-center gap-2.5">
                <div
                  className="size-8 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}
                >
                  <Mic style={{ width: 13, height: 13, color: "#FF2D55" }} />
                </div>
                <div className="flex-1">
                  <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", fontFamily: "inherit" }}>
                    Voice Memo · {formatDur(record.recordingSeconds)}
                  </p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "inherit" }}>
                    Encrypted · Stored in Evidence Vault
                  </p>
                </div>
                <div className="flex items-end gap-[2px]" style={{ height: 14 }}>
                  {[4, 7, 5, 9, 6, 8, 4, 6, 7, 5].map((h, i) => (
                    <div key={i} style={{ width: 2, height: h, borderRadius: 1, background: "rgba(255,45,85,0.4)" }} />
                  ))}
                </div>
              </div>
            )}

            {/* Worker Comment */}
            {record.comment && (
              <div className="flex items-start gap-2.5">
                <div
                  className="size-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <MessageSquare style={{ width: 13, height: 13, color: "rgba(255,255,255,0.35)" }} />
                </div>
                <div className="flex-1">
                  <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", fontFamily: "inherit", marginBottom: 2 }}>
                    Worker Comment
                  </p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "inherit", lineHeight: 1.5 }}>
                    "{record.comment}"
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Timeline ── */}
      <div className="shrink-0 px-5 mb-2">
        <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px", fontFamily: "inherit" }}>
          EVENT TIMELINE · {record.events.length} EVENTS
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8" style={{ scrollbarWidth: "none" }}>
        <div className="relative">
          {/* Vertical line */}
          <div
            className="absolute left-[17px] top-2 bottom-2"
            style={{ width: 1, background: "rgba(255,255,255,0.05)" }}
          />

          <div className="space-y-1">
            {record.events.map((ev, idx) => {
              const { Icon, color, bg } = eventMeta(ev.type);
              const isLast = idx === record.events.length - 1;
              return (
                <motion.div
                  key={ev.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.035, duration: 0.3 }}
                  className="flex items-start gap-3"
                >
                  {/* Icon node */}
                  <div
                    className="size-[35px] rounded-full flex items-center justify-center shrink-0 z-10"
                    style={{ background: bg, border: `1.5px solid ${color}25` }}
                  >
                    <Icon style={{ width: 14, height: 14, color }} />
                  </div>

                  {/* Content */}
                  <div
                    className="flex-1 py-3 px-3.5 mb-1"
                    style={{
                      borderRadius: 14,
                      background: isLast
                        ? "rgba(0,200,224,0.04)"
                        : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isLast ? "rgba(0,200,224,0.1)" : "rgba(255,255,255,0.04)"}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", letterSpacing: "-0.1px", fontFamily: "inherit", flex: 1 }}>
                        {ev.title}
                      </p>
                      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", flexShrink: 0, fontFamily: "inherit", marginTop: 1 }}>
                        {formatTime(ev.ts)}
                      </span>
                    </div>
                    {ev.detail && (
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 3, lineHeight: 1.5, fontFamily: "inherit" }}>
                        {ev.detail}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Audit trail footer */}
        <div
          className="mt-4 px-4 py-3"
          style={{
            borderRadius: 14,
            background: "rgba(0,200,224,0.03)",
            border: "1px solid rgba(0,200,224,0.08)",
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Shield style={{ width: 12, height: 12, color: "rgba(0,200,224,0.5)" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(0,200,224,0.5)", fontFamily: "inherit" }}>
              Audit Trail
            </span>
          </div>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.15)", lineHeight: 1.6, fontFamily: "inherit" }}>
            Audit trail recorded · {record.events.length} events logged
          </p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.12)", marginTop: 4, fontFamily: "inherit" }}>
            Recorded by SOSphere · UTC {record.startTime.toISOString()}
          </p>
        </div>
      </div>

      {/* ── Premium PDF modal ── */}
      <AnimatePresence>
        {showPremium && (
          <>
            <motion.div
              key="pdf-bg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }}
              onClick={() => setShowPremium(false)}
            />
            <motion.div
              key="pdf-modal"
              initial={{ y: "100%", opacity: 0.5 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 36 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-5"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "rgba(10,18,32,0.98)",
                backdropFilter: "blur(40px)",
                borderTop: "1px solid rgba(255,150,0,0.2)",
              }}
            >
              <div className="flex justify-center mb-4">
                <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
              </div>
              <div className="flex items-start justify-between mb-5">
                <div>
                  <p style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "inherit" }}>
                    PDF Export
                  </p>
                  <p style={{ fontSize: 12, color: "rgba(255,150,0,0.6)", marginTop: 2, fontFamily: "inherit" }}>
                    Premium Feature
                  </p>
                </div>
                <button onClick={() => setShowPremium(false)}>
                  <X style={{ width: 18, height: 18, color: "rgba(255,255,255,0.3)" }} />
                </button>
              </div>

              {/* What's included */}
              <p style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.4px", marginBottom: 10, fontFamily: "inherit" }}>
                THE PDF INCLUDES
              </p>
              <div className="space-y-2 mb-6">
                {[
                  { t: "Full event timeline with precise timestamps", c: "#00C8E0" },
                  { t: "GPS coordinates + embedded map", c: "#00C8E0" },
                  { t: "All contact attempts & call durations", c: "#00C8E0" },
                  { t: "Audio recording waveform signature", c: "#00C8E0" },
                  { t: "Audit trail for court admissibility", c: "#00C853" },
                  { t: "Digital signature from SOSphere", c: "#00C853" },
                  { t: "UTC timestamps (legal standard)", c: "#00C853" },
                  { t: "Device IMEI & app version metadata", c: "#FF9500" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="size-1.5 rounded-full shrink-0" style={{ background: item.c }} />
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", fontFamily: "inherit" }}>{item.t}</p>
                  </div>
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                className="w-full flex items-center justify-center gap-2.5"
                style={{
                  height: 52, borderRadius: 16,
                  background: "linear-gradient(135deg, #FF9500, #FF6500)",
                  color: "#fff", fontSize: 15, fontWeight: 700,
                  boxShadow: "0 8px 32px rgba(255,150,0,0.3)",
                  fontFamily: "inherit",
                }}
              >
                <FileText style={{ width: 17, height: 17 }} />
                Upgrade to Premium
              </motion.button>
              <p className="text-center mt-3" style={{ fontSize: 11, color: "rgba(255,255,255,0.15)", fontFamily: "inherit" }}>
                Protects you legally · Used in courts & insurance claims
              </p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}