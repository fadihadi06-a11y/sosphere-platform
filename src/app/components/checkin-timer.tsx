import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, Clock, MapPin, AlertTriangle,
  X, Heart, Plus, Timer, Shield, ArrowRight,
} from "lucide-react";
import { emitSyncEvent } from "./shared-store";

// ─── Timer scaling ────────────────────────────────────────────────────────────
// DEMO_FACTOR is always 1 in production. Real durations come from user input.
// TODO: Migrate to supabase.from('checkin_sessions') for persistence.
const DEMO_FACTOR = 1;
const WARNING_MINUTES = 5;
const EXTEND_MINUTES = 30;

// FIX AUDIT-3.2: localStorage key for persisting deadline across backgrounding/refresh
// [SUPABASE_READY] checkin_timer: migrate to supabase.from('checkin_sessions').upsert({ employee_id, deadline, total_sec, warn_cycle })
const CHECKIN_DEADLINE_KEY = "sosphere_checkin_deadline";
const CHECKIN_TOTAL_KEY = "sosphere_checkin_total";
const CHECKIN_WARN_CYCLE_KEY = "sosphere_checkin_warn_cycle";

// ─── Types ─────────────────────────────────────────────────────────────────────
type Phase = "setup" | "active" | "warning" | "triggered";
type Mode = "duration" | "schedule";

// ─── Scroll Wheel Picker ───────────────────────────────────────────────────────
interface WheelPickerProps {
  items: string[];
  selected: number;
  onChange: (index: number) => void;
  itemHeight?: number;
  visibleItems?: number;
  label?: string;
}

function WheelPicker({ items, selected, onChange, itemHeight = 44, visibleItems = 5, label }: WheelPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUserScrolling = useRef(false);
  const lastSnappedIndex = useRef(selected);
  const halfVisible = Math.floor(visibleItems / 2);
  const containerHeight = itemHeight * visibleItems;

  const haptic = useCallback(() => {
    try { navigator?.vibrate?.(1); } catch {}
  }, []);

  useEffect(() => {
    if (containerRef.current && !isUserScrolling.current) {
      containerRef.current.scrollTop = selected * itemHeight;
    }
  }, [selected, itemHeight]);

  const handleScroll = useCallback(() => {
    isUserScrolling.current = true;

    // Live haptic on each index change during scroll
    if (containerRef.current) {
      const liveIndex = Math.round(containerRef.current.scrollTop / itemHeight);
      if (liveIndex !== lastSnappedIndex.current && liveIndex >= 0 && liveIndex < items.length) {
        lastSnappedIndex.current = liveIndex;
        haptic();
      }
    }

    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      if (containerRef.current) {
        const scrollPos = containerRef.current.scrollTop;
        const newIndex = Math.round(scrollPos / itemHeight);
        const clamped = Math.max(0, Math.min(items.length - 1, newIndex));
        containerRef.current.scrollTo({ top: clamped * itemHeight, behavior: "smooth" });
        onChange(clamped);
        setTimeout(() => { isUserScrolling.current = false; }, 200);
      }
    }, 80);
  }, [items.length, itemHeight, onChange, haptic]);

  return (
    <div className="relative flex flex-col items-center">
      {label && (
        <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.15)", letterSpacing: "1px", marginBottom: 6, textTransform: "uppercase" }}>
          {label}
        </span>
      )}
      <div className="relative" style={{ height: containerHeight, width: 72, overflow: "hidden" }}>
        {/* Selection highlight */}
        <div
          className="absolute left-0 right-0 z-10 pointer-events-none"
          style={{
            top: halfVisible * itemHeight,
            height: itemHeight,
            borderRadius: 12,
            background: "rgba(255,150,0,0.06)",
            border: "1px solid rgba(255,150,0,0.12)",
          }}
        />
        {/* Fade masks */}
        <div className="absolute inset-x-0 top-0 z-20 pointer-events-none" style={{ height: itemHeight * 1.5, background: "linear-gradient(180deg, #05070E, transparent)" }} />
        <div className="absolute inset-x-0 bottom-0 z-20 pointer-events-none" style={{ height: itemHeight * 1.5, background: "linear-gradient(0deg, #05070E, transparent)" }} />

        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto"
          style={{ scrollbarWidth: "none", scrollSnapType: "y mandatory", paddingTop: halfVisible * itemHeight, paddingBottom: halfVisible * itemHeight }}
        >
          {items.map((item, i) => {
            const isSelected = i === selected;
            return (
              <div
                key={i}
                className="flex items-center justify-center shrink-0 cursor-pointer"
                style={{
                  height: itemHeight,
                  scrollSnapAlign: "start",
                  fontSize: isSelected ? 28 : 20,
                  fontWeight: isSelected ? 800 : 400,
                  color: isSelected ? "#FF9500" : "rgba(255,255,255,0.12)",
                  transition: "all 0.2s",
                  fontFamily: "'Outfit', sans-serif",
                }}
                onClick={() => {
                  onChange(i);
                  haptic();
                  containerRef.current?.scrollTo({ top: i * itemHeight, behavior: "smooth" });
                }}
              >
                {item}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtClock(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function addMinutes(date: Date, min: number): Date {
  return new Date(date.getTime() + min * 60000);
}

// ─── Props ─────────────────────────────────────────────────────────────────────
interface CheckinTimerProps {
  onSOSTrigger: () => void;
  onBack: () => void;
  onTimerStateChange?: (active: boolean) => void;
  userName?: string;
  userZone?: string;
}

export function CheckinTimer({ onSOSTrigger, onBack, onTimerStateChange, userName = "User", userZone = "Zone A" }: CheckinTimerProps) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<Mode>("duration");

  // Duration picker
  const [durationHours, setDurationHours] = useState(3);
  const [durationMinutes, setDurationMinutes] = useState(0);

  // Schedule picker
  const now = useMemo(() => new Date(), []);
  const [schedStartHour, setSchedStartHour] = useState(now.getHours());
  const [schedStartMin, setSchedStartMin] = useState(Math.ceil(now.getMinutes() / 5) * 5 % 60);
  const [schedEndHour, setSchedEndHour] = useState((now.getHours() + 3) % 24);
  const [schedEndMin, setSchedEndMin] = useState(0);

  // Timer state
  const [totalSeconds, setTotalSeconds] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [extensions, setExtensions] = useState(0);

  // Modals
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [warningCountdown, setWarningCountdown] = useState(0);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Refs
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef(0);
  const phaseRef = useRef<Phase>("setup");
  const warningShownRef = useRef(false);
  const warningCountdownRef = useRef(0);
  const warningTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningCycleRef = useRef(0); // Track how many warning cycles without response (max 2 → SOS)

  const hours = useMemo(() => Array.from({ length: 13 }, (_, i) => i.toString().padStart(2, "0")), []);
  const minutes5 = useMemo(() => Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, "0")), []);
  const hours24 = useMemo(() => Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0")), []);

  const minutesToDemoSeconds = useCallback((min: number) => Math.round((min * 60) / DEMO_FACTOR), []);
  const warningThresholdSec = minutesToDemoSeconds(WARNING_MINUTES);
  const extendSec = minutesToDemoSeconds(EXTEND_MINUTES);

  // Computed total minutes
  const totalMinutes = useMemo(() => {
    if (mode === "duration") {
      return durationHours * 60 + durationMinutes * 5;
    } else {
      let startMins = schedStartHour * 60 + schedStartMin * 5;
      let endMins = schedEndHour * 60 + schedEndMin * 5;
      if (endMins <= startMins) endMins += 24 * 60;
      return endMins - startMins;
    }
  }, [mode, durationHours, durationMinutes, schedStartHour, schedStartMin, schedEndHour, schedEndMin]);

  // FIX AUDIT-3.2: Deadline-based timer — survives browser backgrounding/throttling
  // Instead of counting ticks (which freeze in background tabs), we store an
  // absolute deadline in localStorage and compare against Date.now() every tick.
  const deadlineRef = useRef<number>(0);

  // ── Restore timer from localStorage on mount (survives refresh) ──
  useEffect(() => {
    const savedDeadline = localStorage.getItem(CHECKIN_DEADLINE_KEY);
    const savedTotal = localStorage.getItem(CHECKIN_TOTAL_KEY);
    const savedCycle = localStorage.getItem(CHECKIN_WARN_CYCLE_KEY);
    if (savedDeadline && savedTotal) {
      const dl = parseInt(savedDeadline, 10);
      const tot = parseInt(savedTotal, 10);
      const now = Date.now();
      if (dl > now) {
        // Timer is still running — restore
        const remainMs = dl - now;
        const remainSec = Math.ceil(remainMs / 1000);
        deadlineRef.current = dl;
        remainingRef.current = remainSec;
        warningCycleRef.current = savedCycle ? parseInt(savedCycle, 10) : 0;
        setTotalSeconds(tot);
        setRemaining(remainSec);
        phaseRef.current = "active";
        setPhase("active");
        if (onTimerStateChange) onTimerStateChange(true);
        // Start the check loop
        startCheckLoop();
      } else {
        // Deadline passed while we were away — trigger SOS immediately
        clearTimerStorage();
        phaseRef.current = "triggered";
        setPhase("triggered");
        if (onTimerStateChange) onTimerStateChange(false);
        setTimeout(() => onSOSTrigger(), 500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearTimerStorage() {
    localStorage.removeItem(CHECKIN_DEADLINE_KEY);
    localStorage.removeItem(CHECKIN_TOTAL_KEY);
    localStorage.removeItem(CHECKIN_WARN_CYCLE_KEY);
  }

  /** Start the deadline-check loop (1s interval, but reads Date.now()) */
  function startCheckLoop() {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      const now = Date.now();
      const dl = deadlineRef.current;
      if (dl <= 0) return;

      const remainSec = Math.max(0, Math.ceil((dl - now) / 1000));
      remainingRef.current = remainSec;
      setRemaining(remainSec);

      // Warning phase
      if (
        remainSec <= warningThresholdSec &&
        remainSec > 0 &&
        !warningShownRef.current &&
        phaseRef.current === "active"
      ) {
        warningShownRef.current = true;
        phaseRef.current = "warning";
        setPhase("warning");
        setShowWarningModal(true);
        warningCountdownRef.current = remainSec;
        setWarningCountdown(remainSec);
        // FIX FATAL-3: Emit CHECKIN_WARNING so admin dashboard sees overdue check-ins
        // Without this, admin had a 30+ minute blind spot before SOS triggered
        // [SUPABASE_READY] checkin_warning: insert into checkin_events { type: 'warning', cycle }
        emitSyncEvent({
          type: "CHECKIN_WARNING",
          employeeId: `EMP-${userName.replace(/\s+/g, "")}`,
          employeeName: userName,
          zone: userZone,
          timestamp: Date.now(),
          data: {
            warningCycle: warningCycleRef.current + 1,
            minutesOverdue: Math.ceil(warningThresholdSec / 60),
            deadlineAt: deadlineRef.current,
          },
        });
        if (warningTickRef.current) clearInterval(warningTickRef.current);
        warningTickRef.current = setInterval(() => {
          const warnRemain = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
          warningCountdownRef.current = warnRemain;
          setWarningCountdown(warnRemain);
          if (warnRemain <= 0 && warningTickRef.current) clearInterval(warningTickRef.current);
        }, 1000);
      }

      // Deadline reached
      if (now >= dl) {
        if (warningTickRef.current) clearInterval(warningTickRef.current);

        // Auto-extend: max 2 warning cycles before SOS
        if (warningCycleRef.current < 2 && warningShownRef.current) {
          const autoExtendSec = minutesToDemoSeconds(25);
          const newDeadline = Date.now() + autoExtendSec * 1000;
          deadlineRef.current = newDeadline;
          remainingRef.current = autoExtendSec;
          setRemaining(autoExtendSec);
          setTotalSeconds((prev: number) => prev + autoExtendSec);
          warningShownRef.current = false;
          warningCycleRef.current += 1;
          phaseRef.current = "active";
          setPhase("active");
          setShowWarningModal(false);
          // Persist new deadline + cycle count
          localStorage.setItem(CHECKIN_DEADLINE_KEY, String(newDeadline));
          localStorage.setItem(CHECKIN_WARN_CYCLE_KEY, String(warningCycleRef.current));
          return;
        }

        // Max cycles reached — trigger SOS
        if (tickRef.current) clearInterval(tickRef.current);
        clearTimerStorage();
        phaseRef.current = "triggered";
        setPhase("triggered");
        setShowWarningModal(false);
        if (onTimerStateChange) onTimerStateChange(false);
        setTimeout(() => onSOSTrigger(), 1500);
      }
    }, 1000);
  }

  // ── Start ──
  const startTimer = useCallback(() => {
    if (totalMinutes <= 0) return;
    const demoSec = minutesToDemoSeconds(totalMinutes);
    const deadline = Date.now() + demoSec * 1000;

    // FIX AUDIT-3.2: Persist deadline to localStorage so it survives backgrounding
    deadlineRef.current = deadline;
    localStorage.setItem(CHECKIN_DEADLINE_KEY, String(deadline));
    localStorage.setItem(CHECKIN_TOTAL_KEY, String(demoSec));
    localStorage.setItem(CHECKIN_WARN_CYCLE_KEY, "0");

    setTotalSeconds(demoSec);
    setRemaining(demoSec);
    remainingRef.current = demoSec;
    phaseRef.current = "active";
    warningShownRef.current = false;
    warningCycleRef.current = 0;
    setPhase("active");
    setExtensions(0);

    startCheckLoop();

    if (onTimerStateChange) onTimerStateChange(true);
    // Emit check-in event to dashboard
    // [SUPABASE_READY] checkin_start: insert into checkin_events { employee_id, type: 'start', duration, zone }
    emitSyncEvent({ type: "CHECKIN", employeeId: "EMP-APP", employeeName: userName, zone: userZone, timestamp: Date.now(), data: { duration: totalMinutes } });
  }, [totalMinutes, minutesToDemoSeconds, warningThresholdSec, onSOSTrigger, onTimerStateChange, userName, userZone]);

  const cancelTimer = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (warningTickRef.current) clearInterval(warningTickRef.current);
    // FIX AUDIT-3.2: Clear persisted deadline on cancel
    deadlineRef.current = 0;
    clearTimerStorage();
    phaseRef.current = "setup";
    setPhase("setup");
    setShowWarningModal(false);
    setShowCancelConfirm(false);
    setRemaining(0);
    warningShownRef.current = false;
    if (onTimerStateChange) onTimerStateChange(false);
  }, [onTimerStateChange]);

  const handleImSafe = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (warningTickRef.current) clearInterval(warningTickRef.current);
    // FIX AUDIT-3.2: Clear persisted deadline on safe check-in
    deadlineRef.current = 0;
    clearTimerStorage();
    setShowWarningModal(false);
    phaseRef.current = "setup";
    setPhase("setup");
    setRemaining(0);
    warningShownRef.current = false;
    if (onTimerStateChange) onTimerStateChange(false);
  }, [onTimerStateChange]);

  const handleExtend = useCallback(() => {
    if (warningTickRef.current) clearInterval(warningTickRef.current);
    setShowWarningModal(false);
    // FIX AUDIT-3.2: Extend the persisted deadline, not just the counter
    const newDeadline = Date.now() + extendSec * 1000;
    deadlineRef.current = newDeadline;
    remainingRef.current = extendSec;
    setRemaining(extendSec);
    setTotalSeconds((prev) => prev + extendSec);
    setExtensions((prev) => prev + 1);
    warningShownRef.current = false;
    phaseRef.current = "active";
    setPhase("active");
    localStorage.setItem(CHECKIN_DEADLINE_KEY, String(newDeadline));
  }, [extendSec]);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (warningTickRef.current) clearInterval(warningTickRef.current);
    };
  }, []);

  // Derived
  const progress = totalSeconds > 0 ? 1 - remaining / totalSeconds : 0;
  const isWarningZone = remaining > 0 && remaining <= warningThresholdSec;
  const displayRemaining = remaining * DEMO_FACTOR;
  const ringRadius = 115;
  const ringCircumference = 2 * Math.PI * ringRadius;

  const accentColor = phase === "triggered" ? "#FF2D55" : isWarningZone ? "#FF9500" : "#FF9500";

  return (
    <div className="relative flex flex-col h-full overflow-hidden" style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}>

      {/* Ambient */}
      <div
        className="absolute top-[-100px] left-1/2 -translate-x-1/2 pointer-events-none"
        style={{
          width: 500, height: 500,
          background: phase === "triggered"
            ? "radial-gradient(ellipse, rgba(255,45,85,0.06) 0%, transparent 65%)"
            : isWarningZone
            ? "radial-gradient(ellipse, rgba(255,150,0,0.04) 0%, transparent 65%)"
            : phase !== "setup"
            ? "radial-gradient(ellipse, rgba(255,150,0,0.03) 0%, transparent 65%)"
            : "radial-gradient(ellipse, rgba(0,200,224,0.03) 0%, transparent 65%)",
          transition: "background 2s",
        }}
      />

      {/* Header */}
      <div className="shrink-0 pt-[58px] px-5 pb-2">
        <div className="flex items-center">
          <button
            onClick={phase === "setup" ? onBack : () => setShowCancelConfirm(true)}
            className="flex items-center gap-1 -ml-1 p-1"
          >
            <ChevronLeft style={{ width: 20, height: 20, color: "#00C8E0" }} />
            <span style={{ fontSize: 15, color: "#00C8E0", fontWeight: 500 }}>
              {phase === "setup" ? "الرئيسية" : ""}
            </span>
          </button>
          <div className="flex-1 text-center">
            <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>
              Check-in Timer
            </span>
          </div>
          <div style={{ width: 44 }} />
        </div>
      </div>

      {/* ═══════════ SETUP ═══════════ */}
      <AnimatePresence mode="wait">
        {phase === "setup" && (
          <motion.div
            key="setup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35 }}
            className="flex-1 flex flex-col overflow-y-auto"
            style={{ scrollbarWidth: "none" }}
          >
            {/* Mode Segmented Control */}
            <div className="px-5 mt-3 mb-5">
              <div
                className="relative flex p-[3px]"
                style={{
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <motion.div
                  className="absolute top-[3px] bottom-[3px]"
                  style={{
                    width: "calc(50% - 3px)",
                    borderRadius: 12,
                    background: "rgba(255,150,0,0.1)",
                    border: "1px solid rgba(255,150,0,0.18)",
                  }}
                  animate={{ left: mode === "duration" ? 3 : "calc(50%)" }}
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
                {(["duration", "schedule"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2.5"
                  >
                    {m === "duration" ? (
                      <Timer style={{ width: 13, height: 13, color: mode === m ? "#FF9500" : "rgba(255,255,255,0.2)" }} />
                    ) : (
                      <Clock style={{ width: 13, height: 13, color: mode === m ? "#FF9500" : "rgba(255,255,255,0.2)" }} />
                    )}
                    <span style={{
                      fontSize: 13, fontWeight: mode === m ? 700 : 500,
                      color: mode === m ? "#FF9500" : "rgba(255,255,255,0.25)",
                      transition: "color 0.3s",
                    }}>
                      {m === "duration" ? "المدة" : "جدول زمني"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Duration Picker ── */}
            <AnimatePresence mode="wait">
              {mode === "duration" && (
                <motion.div
                  key="dur"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25 }}
                  className="px-5"
                >
                  {/* Wheels */}
                  <div
                    className="flex items-center justify-center gap-2 py-3 mb-5"
                    style={{
                      borderRadius: 20,
                      background: "rgba(255,255,255,0.015)",
                      border: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <WheelPicker
                      items={hours}
                      selected={durationHours}
                      onChange={setDurationHours}
                      label="ساعات"
                    />
                    <div style={{ fontSize: 32, fontWeight: 800, color: "rgba(255,150,0,0.3)", marginTop: 16 }}>:</div>
                    <WheelPicker
                      items={minutes5}
                      selected={durationMinutes}
                      onChange={setDurationMinutes}
                      label="دقائق"
                    />
                  </div>

                  {/* Quick presets */}
                  <div className="flex gap-2 mb-5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                    {[
                      { l: "30 د", h: 0, m: 6 },
                      { l: "1 س", h: 1, m: 0 },
                      { l: "2 س", h: 2, m: 0 },
                      { l: "3 س", h: 3, m: 0 },
                      { l: "4 س", h: 4, m: 0 },
                      { l: "6 س", h: 6, m: 0 },
                      { l: "8 س", h: 8, m: 0 },
                    ].map((p) => {
                      const active = durationHours === p.h && durationMinutes === p.m;
                      return (
                        <button
                          key={p.l}
                          onClick={() => { setDurationHours(p.h); setDurationMinutes(p.m); }}
                          className="shrink-0 px-4 py-2"
                          style={{
                            borderRadius: 10,
                            background: active ? "rgba(255,150,0,0.1)" : "rgba(255,255,255,0.02)",
                            border: `1px solid ${active ? "rgba(255,150,0,0.2)" : "rgba(255,255,255,0.04)"}`,
                            fontSize: 12,
                            fontWeight: active ? 700 : 500,
                            color: active ? "#FF9500" : "rgba(255,255,255,0.25)",
                            transition: "all 0.25s",
                          }}
                        >
                          {p.l}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* ── Schedule Picker ── */}
              {mode === "schedule" && (
                <motion.div
                  key="sched"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.25 }}
                  className="px-5"
                >
                  {/* From */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="size-2 rounded-full" style={{ background: "#00C8E0" }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.3)", letterSpacing: "0.3px" }}>يبدأ من</span>
                      <button
                        onClick={() => {
                          setSchedStartHour(now.getHours());
                          setSchedStartMin(Math.ceil(now.getMinutes() / 5) * 5 % 60 / 5);
                        }}
                        className="ml-auto px-2.5 py-1"
                        style={{ borderRadius: 8, background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)", fontSize: 10, fontWeight: 600, color: "#00C8E0" }}
                      >
                        الآن
                      </button>
                    </div>
                    <div
                      className="flex items-center justify-center gap-2 py-3"
                      style={{ borderRadius: 18, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      <WheelPicker items={hours24} selected={schedStartHour} onChange={setSchedStartHour} label="ساعة" />
                      <div style={{ fontSize: 28, fontWeight: 800, color: "rgba(0,200,224,0.2)", marginTop: 16 }}>:</div>
                      <WheelPicker items={minutes5} selected={schedStartMin} onChange={setSchedStartMin} label="دقيقة" />
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex justify-center mb-4">
                    <div className="size-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <ArrowRight style={{ width: 14, height: 14, color: "rgba(255,255,255,0.15)", transform: "rotate(90deg)" }} />
                    </div>
                  </div>

                  {/* To */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="size-2 rounded-full" style={{ background: "#FF9500" }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.3)", letterSpacing: "0.3px" }}>ينتهي في</span>
                    </div>
                    <div
                      className="flex items-center justify-center gap-2 py-3"
                      style={{ borderRadius: 18, background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      <WheelPicker items={hours24} selected={schedEndHour} onChange={setSchedEndHour} label="ساعة" />
                      <div style={{ fontSize: 28, fontWeight: 800, color: "rgba(255,150,0,0.2)", marginTop: 16 }}>:</div>
                      <WheelPicker items={minutes5} selected={schedEndMin} onChange={setSchedEndMin} label="دقيقة" />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Summary card */}
            <div className="px-5 mt-auto">
              <div
                className="px-4 py-3.5 mb-4"
                style={{
                  borderRadius: 16,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.04)",
                  backdropFilter: "blur(20px)",
                }}
              >
                <div className="flex items-center justify-between mb-2.5">
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>المدة الكاملة</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#FF9500" }}>
                    {Math.floor(totalMinutes / 60) > 0 ? `${Math.floor(totalMinutes / 60)} ساعة` : ""}
                    {totalMinutes % 60 > 0 ? ` ${totalMinutes % 60} دقيقة` : ""}
                    {totalMinutes === 0 ? "—" : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-2.5">
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>ينتهي في</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
                    {totalMinutes > 0 ? fmtClock(addMinutes(new Date(), totalMinutes)) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <MapPin style={{ width: 11, height: 11, color: "rgba(0,200,224,0.5)" }} />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>الموقع</span>
                  </div>
                  {/* SUPABASE_MIGRATION_POINT: replace with real GPS */}
                  {/* from employee_locations table */}
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(0,200,224,0.5)" }}>{userZone || "Locating..."}</span>
                </div>
              </div>

              {/* Info line */}
              <div className="flex items-center gap-2 px-3 py-2 mb-3" style={{ borderRadius: 10, background: "rgba(255,150,0,0.03)", border: "1px solid rgba(255,150,0,0.06)" }}>
                <Shield style={{ width: 12, height: 12, color: "rgba(255,150,0,0.4)", flexShrink: 0 }} />
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>
                  قبل {WARNING_MINUTES} دقائق يظهر تنبيه · عدم الاستجابة = SOS تلقائي
                </span>
              </div>

              {/* Demo badge */}
              <div className="flex items-center justify-center gap-1.5 mb-3">
                <div className="size-1 rounded-full" style={{ background: "rgba(0,200,224,0.3)" }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.12)" }}>
                  وضع عرض · 1 دقيقة = 1 ثانية
                </span>
              </div>

              {/* Start button */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={startTimer}
                disabled={totalMinutes <= 0}
                className="w-full flex items-center justify-center gap-2.5 mb-8"
                style={{
                  height: 54,
                  borderRadius: 16,
                  background: totalMinutes > 0
                    ? "linear-gradient(135deg, #FF9500 0%, #E68500 100%)"
                    : "rgba(255,255,255,0.04)",
                  color: totalMinutes > 0 ? "#fff" : "rgba(255,255,255,0.15)",
                  fontSize: 15,
                  fontWeight: 700,
                  boxShadow: totalMinutes > 0 ? "0 6px 24px rgba(255,150,0,0.2), 0 0 0 1px rgba(255,150,0,0.1)" : "none",
                  transition: "all 0.4s",
                  cursor: totalMinutes > 0 ? "pointer" : "not-allowed",
                }}
              >
                <Shield style={{ width: 16, height: 16 }} />
                تفعيل وضع الأمان
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* ═══════════ ACTIVE TIMER ═══════════ */}
        {phase !== "setup" && (
          <motion.div
            key="active"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.4 }}
            className="flex-1 flex flex-col items-center px-5"
          >
            {/* Status */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 px-4 py-2 mb-4"
              style={{
                borderRadius: 100,
                background: phase === "triggered" ? "rgba(255,45,85,0.08)" : isWarningZone ? "rgba(255,150,0,0.06)" : "rgba(255,150,0,0.05)",
                border: `1px solid ${phase === "triggered" ? "rgba(255,45,85,0.18)" : isWarningZone ? "rgba(255,150,0,0.15)" : "rgba(255,150,0,0.1)"}`,
              }}
            >
              <motion.div
                animate={{ opacity: [1, 0.15, 1] }}
                transition={{ duration: phase === "triggered" ? 0.4 : 1.5, repeat: Infinity }}
                className="size-[6px] rounded-full"
                style={{ background: phase === "triggered" ? "#FF2D55" : "#FF9500" }}
              />
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "1px",
                color: phase === "triggered" ? "#FF2D55" : "#FF9500",
              }}>
                {phase === "triggered" ? "SOS ACTIVATING" : isWarningZone ? "CHECK IN REQUIRED" : "PROTECTION ACTIVE"}
              </span>
            </motion.div>

            {/* Ring */}
            <div className="relative flex items-center justify-center mb-3" style={{ width: 260, height: 260 }}>
              {/* Glow */}
              <motion.div
                animate={{ opacity: [0.25, 0.5, 0.25] }}
                transition={{ duration: 4, repeat: Infinity }}
                className="absolute rounded-full pointer-events-none"
                style={{
                  width: 280, height: 280,
                  background: `radial-gradient(circle, ${accentColor}0C 0%, transparent 70%)`,
                }}
              />

              <svg className="absolute" width="260" height="260" viewBox="0 0 260 260" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="130" cy="130" r={ringRadius} fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth="4" />
                <circle
                  cx="130" cy="130" r={ringRadius} fill="none"
                  stroke={phase === "triggered" ? "#FF2D55" : isWarningZone ? "#FF9500" : "#FF9500"}
                  strokeWidth="4.5" strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringCircumference * progress}
                  style={{
                    transition: "stroke-dashoffset 1s linear, stroke 1s",
                    filter: `drop-shadow(0 0 6px ${accentColor}50)`,
                  }}
                />
                {/* Warning zone marker */}
                {!isWarningZone && totalSeconds > 0 && (
                  <circle
                    cx="130" cy="130" r={ringRadius} fill="none"
                    stroke="rgba(255,150,0,0.15)"
                    strokeWidth="4.5" strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringCircumference * (1 - warningThresholdSec / totalSeconds)}
                    style={{ transition: "stroke-dashoffset 1s linear" }}
                  />
                )}
              </svg>

              {/* Center */}
              <div className="relative z-10 flex flex-col items-center">
                {phase === "triggered" ? (
                  <motion.div
                    animate={{ scale: [1, 1.08, 1] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                    className="flex flex-col items-center"
                  >
                    <AlertTriangle style={{ width: 32, height: 32, color: "#FF2D55", filter: "drop-shadow(0 0 10px #FF2D55)", marginBottom: 6 }} />
                    <span style={{ fontSize: 18, fontWeight: 900, color: "#FF2D55", letterSpacing: "3px" }}>SOS</span>
                    <span style={{ fontSize: 10, color: "rgba(255,45,85,0.4)", marginTop: 4 }}>جارٍ التفعيل</span>
                  </motion.div>
                ) : (
                  <>
                    <p style={{
                      fontSize: 42, fontWeight: 900, letterSpacing: "-1.5px",
                      color: isWarningZone ? "#FF9500" : "#fff",
                      textShadow: isWarningZone ? "0 0 24px rgba(255,150,0,0.3)" : "none",
                      transition: "all 1s", fontVariantNumeric: "tabular-nums",
                    }}>
                      {fmtTime(displayRemaining)}
                    </p>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.15)", marginTop: 2 }}>
                      متبقي
                    </p>
                    {extensions > 0 && (
                      <div className="flex items-center gap-1 mt-2 px-2.5 py-1" style={{ borderRadius: 8, background: "rgba(0,200,224,0.05)", border: "1px solid rgba(0,200,224,0.1)" }}>
                        <Plus style={{ width: 9, height: 9, color: "#00C8E0" }} />
                        <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(0,200,224,0.6)" }}>
                          {extensions * EXTEND_MINUTES} دقيقة تمديد
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Info cards */}
            <div className="w-full space-y-2 mb-4">
              <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <MapPin style={{ width: 13, height: 13, color: "rgba(0,200,224,0.5)", flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", flex: 1 }}>King Fahd Rd, Riyadh</span>
                <div className="flex items-center gap-1">
                  <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(0,200,83,0.6)", letterSpacing: "0.5px" }}>GPS</span>
                </div>
              </div>

              {isWarningZone && phase !== "triggered" && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2.5 px-4 py-3"
                  style={{ borderRadius: 14, background: "rgba(255,150,0,0.04)", border: "1px solid rgba(255,150,0,0.12)" }}
                >
                  <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                    <AlertTriangle style={{ width: 13, height: 13, color: "#FF9500", flexShrink: 0 }} />
                  </motion.div>
                  <span style={{ fontSize: 12, color: "rgba(255,150,0,0.7)", fontWeight: 600 }}>
                    الوقت ينفد — أكّد سلامتك
                  </span>
                </motion.div>
              )}
            </div>

            {/* Actions */}
            <div className="w-full mt-auto pb-8 space-y-2.5">
              {isWarningZone && phase !== "triggered" ? (
                <>
                  <motion.button
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleImSafe}
                    className="w-full flex items-center justify-center gap-2"
                    style={{
                      height: 52, borderRadius: 15,
                      background: "linear-gradient(135deg, #00C853, #009A3E)",
                      color: "#fff", fontSize: 15, fontWeight: 700,
                      boxShadow: "0 6px 20px rgba(0,200,83,0.2)",
                    }}
                  >
                    <Heart style={{ width: 15, height: 15 }} />
                    أنا بخير
                  </motion.button>
                  <div className="flex gap-2">
                    <motion.button
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={handleExtend}
                      className="flex-1 flex items-center justify-center gap-1.5"
                      style={{
                        height: 46, borderRadius: 13,
                        background: "rgba(0,200,224,0.06)",
                        border: "1px solid rgba(0,200,224,0.15)",
                        color: "#00C8E0", fontSize: 13, fontWeight: 600,
                      }}
                    >
                      <Plus style={{ width: 13, height: 13 }} />
                      +{EXTEND_MINUTES} دقيقة
                    </motion.button>
                    <motion.button
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={cancelTimer}
                      className="flex-1 flex items-center justify-center gap-1.5"
                      style={{
                        height: 46, borderRadius: 13,
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        color: "rgba(255,255,255,0.3)", fontSize: 13, fontWeight: 600,
                      }}
                    >
                      <X style={{ width: 13, height: 13 }} />
                      إلغاء
                    </motion.button>
                  </div>
                </>
              ) : phase === "active" ? (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowCancelConfirm(true)}
                  className="w-full flex items-center justify-center gap-2"
                  style={{
                    height: 48, borderRadius: 14,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.3)", fontSize: 14, fontWeight: 600,
                  }}
                >
                  <X style={{ width: 14, height: 14 }} />
                  إلغاء المؤقت
                </motion.button>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ══════ WARNING MODAL ══════ */}
      <AnimatePresence>
        {showWarningModal && (
          <>
            <motion.div key="wm-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(20px)" }}
            />
            <motion.div key="wm-sheet"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 34 }}
              className="absolute bottom-0 left-0 right-0 z-50 px-5 pb-10 pt-6"
              style={{ borderRadius: "28px 28px 0 0", background: "rgba(8,12,24,0.98)", borderTop: "1px solid rgba(255,150,0,0.15)" }}
            >
              <div className="flex justify-center mb-5">
                <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.08)" }} />
              </div>
              <div className="flex flex-col items-center text-center">
                <motion.div
                  animate={{ scale: [1, 1.06, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="size-[68px] rounded-full flex items-center justify-center mb-4"
                  style={{ background: "rgba(255,150,0,0.06)", border: "1.5px solid rgba(255,150,0,0.15)", boxShadow: "0 0 30px rgba(255,150,0,0.08)" }}
                >
                  <AlertTriangle style={{ width: 28, height: 28, color: "#FF9500" }} />
                </motion.div>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.3px" }}>هل أنت بخير؟</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)", marginTop: 6, lineHeight: 1.8 }}>
                  الوقت المحدد على وشك الانتهاء<br />عدم الاستجابة يعني تفعيل SOS تلقائياً
                </p>

                {/* Countdown */}
                <div className="relative flex items-center justify-center my-5" style={{ width: 64, height: 64 }}>
                  <svg className="absolute" width="64" height="64" viewBox="0 0 64 64" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3.5" />
                    <circle cx="32" cy="32" r="27" fill="none" stroke="#FF9500"
                      strokeWidth="3.5" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 27}
                      strokeDashoffset={warningThresholdSec > 0 ? 2 * Math.PI * 27 * (1 - warningCountdown / warningThresholdSec) : 0}
                      style={{ transition: "stroke-dashoffset 1s linear", filter: "drop-shadow(0 0 4px rgba(255,150,0,0.4))" }}
                    />
                  </svg>
                  <span style={{ fontSize: 18, fontWeight: 800, color: "#FF9500", fontVariantNumeric: "tabular-nums" }}>{warningCountdown}</span>
                </div>

                <motion.button whileTap={{ scale: 0.97 }} onClick={handleImSafe}
                  className="w-full flex items-center justify-center gap-2 mb-2.5"
                  style={{
                    height: 52, borderRadius: 15,
                    background: "linear-gradient(135deg, #00C853, #009A3E)",
                    color: "#fff", fontSize: 15, fontWeight: 700,
                    boxShadow: "0 6px 22px rgba(0,200,83,0.25)",
                  }}
                >
                  <Heart style={{ width: 15, height: 15 }} />
                  أنا بخير
                </motion.button>

                <div className="flex gap-2 w-full">
                  <motion.button whileTap={{ scale: 0.97 }} onClick={handleExtend}
                    className="flex-1 flex items-center justify-center gap-1.5"
                    style={{
                      height: 46, borderRadius: 13,
                      background: "rgba(0,200,224,0.06)",
                      border: "1px solid rgba(0,200,224,0.15)",
                      color: "#00C8E0", fontSize: 13, fontWeight: 600,
                    }}
                  >
                    <Plus style={{ width: 13, height: 13 }} />
                    +{EXTEND_MINUTES} دقيقة
                  </motion.button>

                  <button onClick={() => { setShowWarningModal(false); cancelTimer(); }}
                    className="flex-1 flex items-center justify-center gap-1.5"
                    style={{
                      height: 46, borderRadius: 13,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      color: "rgba(255,255,255,0.25)", fontSize: 13, fontWeight: 600,
                    }}
                  >
                    <X style={{ width: 12, height: 12 }} />
                    إلغاء
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ══════ CANCEL CONFIRM ══════ */}
      <AnimatePresence>
        {showCancelConfirm && (
          <>
            <motion.div key="cc-bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)" }}
            />
            <motion.div key="cc"
              initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="absolute inset-x-6 z-50"
              style={{ top: "50%", transform: "translateY(-50%)", borderRadius: 22, background: "rgba(10,16,32,0.98)", border: "1px solid rgba(255,255,255,0.06)", padding: 22 }}
            >
              <div className="flex flex-col items-center text-center">
                <div className="size-12 rounded-full flex items-center justify-center mb-3" style={{ background: "rgba(255,150,0,0.06)", border: "1.5px solid rgba(255,150,0,0.12)" }}>
                  <Timer style={{ width: 20, height: 20, color: "#FF9500" }} />
                </div>
                <p style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>إلغاء المؤقت؟</p>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.22)", marginTop: 6, lineHeight: 1.7 }}>
                  سيتوقف Check-in Timer ولن يُفعَّل SOS
                </p>
                <div className="flex gap-2.5 w-full mt-5">
                  <button onClick={() => setShowCancelConfirm(false)}
                    style={{ flex: 1, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", fontSize: 14, fontWeight: 600 }}
                  >
                    تراجع
                  </button>
                  <motion.button whileTap={{ scale: 0.97 }} onClick={cancelTimer}
                    style={{ flex: 1, height: 44, borderRadius: 12, background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.18)", color: "#FF9500", fontSize: 14, fontWeight: 700 }}
                  >
                    إلغاء
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}