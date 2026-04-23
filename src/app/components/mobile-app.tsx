import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { WelcomeOnboarding } from "./welcome-onboarding";
import { LoginPhone } from "./login-phone";
import { OnboardingSelect } from "./onboarding-select";
import { RoleSelect } from "./role-select";
import { IndividualRegister } from "./individual-register";
import { CompanyJoin } from "./company-join";
import type { CompanyMatchData } from "./company-join";
import { PendingApproval } from "./pending-approval";
import { EmployeeWelcome } from "./employee-welcome";
import { EmployeeQuickSetup } from "./employee-quick-setup";
import { IndividualLayout, type IndividualLayoutHandle } from "./individual-layout";
import { EmployeeDashboard } from "./dashboard";
import { SosEmergency } from "./sos-emergency";
import { PostEmergencyDebrief } from "./post-emergency-debrief";
import { syncIncidentToSupabase, resyncPendingIncidents } from "./incident-sync";
import { EmergencyResponseRecord } from "./emergency-response-record";
import { CheckinTimer } from "./checkin-timer";
import { MedicalID } from "./medical-id";
import { SubscriptionPlans } from "./subscription-plans";
import { hasFeature } from "./subscription-service";
import { IncidentHistory } from "./incident-history";
import { EmergencyPacket } from "./emergency-packet";
import { EmergencyServices } from "./emergency-services";
import { EmergencyContacts } from "./emergency-contacts";
import { NotificationsCenter } from "./notifications-center";
import { LoginWelcome } from "./login-welcome";
import { EvacuationScreen, EvacuationAlertOverlay } from "./evacuation-screen";
import { NeighborAlertOverlay } from "./neighbor-alert-overlay";
import { BiometricGateModal } from "./biometric-gate-modal-v2";
import { getBiometricLockEnabled } from "./biometric-lock-settings";
import { clearBiometricSession } from "./biometric-gate";
import {
  LanguageScreen,
  PrivacyScreen,
  ConnectedDevicesScreen,
  HelpScreen,
  EliteFeaturesScreen,
} from "./settings-screens";
import type { IncidentRecord } from "./sos-emergency";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { BroadcastIsland } from "./broadcast-island";
import { IncidentPhotoReport, type IncidentReportData } from "./incident-photo-report";
import { onAdminSignal, initRealtimeChannels } from "./shared-store";
import { emitSyncEvent, onStorageBanner } from "./shared-store";
import { OfflineIndicator } from "./offline-sync";
import { startGPSTracking, activateEmergencyTracking, deactivateEmergencyTracking, ZONE_PRESETS } from "./offline-gps-tracker";
import { enableAutoSync } from "./offline-sync-engine";
import { useFallDetection, FallDetectionOverlay } from "./fall-detection";
import { useNotifications } from "./push-notifications";
import { useShakeDetection } from "./shake-to-sos";
import { VoiceSOSWidget } from "./voice-sos-widget";
import { useT, type Lang } from "./dashboard-i18n";
import { MobileEmergencyChat } from "./emergency-chat";
import { MissionTrackerScreen } from "./mission-tracker-mobile";
import { SafeWalkMode } from "./safe-walk-mode";
import { Toaster, toast } from "sonner";
import { loadJSONSync } from "./api/storage-adapter";
// FIX AUDIT-7.1 + 7.3: Consent screens
import { TermsConsentScreen, GpsConsentScreen, hasCompletedConsent, hasCompletedGpsConsent } from "./consent-screens";
// Android back button support via Capacitor
let CapacitorApp: any = null;
try { import("@capacitor/app").then((m: any) => { CapacitorApp = m.App; }); } catch {}

/** Safe wrapper for loadJSONSync � returns fallback on any error */
function safeLoadJSON<T>(key: string, fallback: T): T {
  try {
    return loadJSONSync<T>(key, fallback);
  } catch {
    console.warn("[SOS] safeLoadJSON failed for key:", key);
    return fallback;
  }
}

// -- Emergency Record Fallback � auto-redirects when incidentRecord is null --
const FALLBACK_SECONDS = 60; // C2 FIX: was 5 — increased to give admin time to call

function EmergencyRecordFallback({ onBack }: { onBack: () => void }) {
  const [remaining, setRemaining] = useState(FALLBACK_SECONDS);
  const [cancelled, setCancelled] = useState(false); // C2 FIX: allow user to cancel auto-redirect

  useEffect(() => {
    if (cancelled) return; // C2 FIX: stop countdown if user cancelled
    if (remaining <= 0) {
      onBack();
      return;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onBack, cancelled]);

  const progress = ((FALLBACK_SECONDS - remaining) / FALLBACK_SECONDS) * 100;

  return (
    <div
      className="flex flex-col items-center justify-center h-full px-6"
      style={{ background: "#05070E" }}
    >
      <div className="flex flex-col items-center gap-6 text-center">
        {/* Animated ring with countdown */}
        <div className="relative w-20 h-20 flex items-center justify-center">
          <svg className="absolute inset-0" width="80" height="80" viewBox="0 0 80 80">
            <circle
              cx="40" cy="40" r="34"
              fill="none"
              stroke="rgba(255,45,85,0.12)"
              strokeWidth="4"
            />
            <motion.circle
              cx="40" cy="40" r="34"
              fill="none"
              stroke="#FF2D55"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={Math.PI * 2 * 34}
              strokeDashoffset={Math.PI * 2 * 34 * (1 - progress / 100)}
              style={{ transformOrigin: "center", rotate: "-90deg" }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </svg>
          <motion.div
            key={remaining}
            initial={{ scale: 1.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25 }}
            style={{ color: "#FF2D55", fontSize: 24, fontWeight: 700, fontFamily: "'Outfit', sans-serif" }}
          >
            {remaining}
          </motion.div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center gap-2">
            <AlertTriangle size={18} color="#FF2D55" />
            <h2 className="text-white" style={{ fontSize: 17, fontFamily: "'Outfit', sans-serif", fontWeight: 600 }}>
              No incident data found
            </h2>
          </div>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, fontFamily: "'Outfit', sans-serif", lineHeight: 1.5 }}>
            Returning automatically in {remaining}s...
          </p>
          <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, fontFamily: "'Outfit', sans-serif" }}>
            If this persists, contact your supervisor
          </p>
        </div>

        <div className="flex flex-col gap-2 w-full">
          <button
            onClick={onBack}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl transition-all"
            style={{ background: "rgba(255,45,85,0.1)", border: "1px solid rgba(255,45,85,0.2)" }}
          >
            <ArrowLeft size={16} color="#FF2D55" />
            <span style={{ color: "#FF2D55", fontFamily: "'Outfit', sans-serif", fontSize: 13, fontWeight: 600 }}>
              Go Back Now
            </span>
          </button>
          {/* C2 FIX: Cancel auto-redirect — keep user on screen while admin is calling */}
          {!cancelled && (
            <button
              onClick={() => setCancelled(true)}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl transition-all"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <span style={{ color: "rgba(255,255,255,0.5)", fontFamily: "'Outfit', sans-serif", fontSize: 13, fontWeight: 600 }}>
                Stay on this screen
              </span>
            </button>
          )}
          {cancelled && (
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "'Outfit', sans-serif", textAlign: "center" }}>
              Auto-redirect cancelled — tap Go Back when ready
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

type Screen =
  | "welcome"
  | "role-select"
  | "login"
  | "login-welcome"
  | "terms-consent"
  | "gps-consent"
  | "onboarding"
  | "individual-register"
  | "company-join"
  | "pending-approval"
  | "employee-welcome"
  | "employee-quick-setup"
  | "individual-home"
  | "employee-dashboard"
  | "sos-emergency"
  | "post-emergency-debrief"
  | "emergency-record"
  | "checkin-timer"
  | "medical-id"
  | "subscription"
  | "incident-history"
  | "emergency-packet"
  | "emergency-services"
  | "emergency-contacts"
  | "notifications"
  | "evacuation"
  | "language"
  | "privacy"
  | "connected-devices"
  | "help"
  | "elite-features"
  | "mission-tracker"
  | "safe-walk";

export function MobileApp() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const screenRef = useRef<Screen>("welcome"); // Ref for back button handler (avoids stale closure)
  const [companyName, setCompanyName] = useState("");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [incidentRecord, setIncidentRecord] = useState<IncidentRecord | null>(null);
  const [recordingEnabled, setRecordingEnabled] = useState(false);
  const [timerActive, setTimerActive] = useState(false);
  const [userPlan, setUserPlan] = useState<"free" | "pro" | "employee">("free");
  const [loginName, setLoginName] = useState("");
  const [loginPhone, setLoginPhone] = useState("");
  const [loginMode, setLoginMode] = useState<"employee" | "individual" | "demo">("individual");
  const [loginRole, setLoginRole] = useState("worker");
  // AUDIT-FIX (2026-04-18): live test showed sos-alert rejected the
  // trigger with 403 "userId mismatch" because we were passing
  // `EMP-${name}` instead of the Supabase auth UUID that the server
  // compares against `auth.uid()`. This state holds the authoritative
  // user id — populated from getSession() on mount + OAuth callback.
  const [authUserId, setAuthUserId] = useState("");
  const [selectedPath, setSelectedPath] = useState<"civilian" | "employee" | null>(null);

  // -- Profile restore loading state ---------------------------
  // Only show spinner if user completed ALL steps (session + consent + profile)
  const [isRestoring, setIsRestoring] = useState(() => {
    try {
      const hasOAuth = window.location.hash?.includes("access_token");
      const hasProfile = !!localStorage.getItem("sosphere_individual_profile");
      // AUDIT-FIX: accept BOTH the canonical key and the legacy
      // key from a previous version of consent-screens.tsx. Without
      // this, every code update silently invalidated existing users'
      // consent and forced them through the consent flow again.
      const hasConsent =
        !!localStorage.getItem("sosphere_tos_consent") ||
        !!localStorage.getItem("sosphere_terms_consent");
      return hasOAuth || (hasProfile && hasConsent);
    } catch { return false; }
  });

  // -- Biometric app-unlock gate -------------------------------
  // Cold-start behaviour: if the user has opted into "Biometric Lock"
  // via Privacy settings, we start LOCKED and the overlay blocks any
  // logged-in screen until they verify. Sessions where the flag is
  // off initialise as unlocked (no-op). Enabling the toggle mid-session
  // inherits the current unlocked state — the user just authenticated
  // to enroll, so re-locking them immediately would be hostile.
  const [biometricUnlocked, setBiometricUnlocked] = useState<boolean>(() => {
    try { return !getBiometricLockEnabled(); } catch { return true; }
  });

  // Timestamp of the last time the app went to the background. Used by the
  // background-timeout effect to decide whether to re-lock on resume.
  // Ref rather than state because writes happen outside React's lifecycle
  // (native event callbacks) and we never want a re-render on background.
  const backgroundedAtRef = useRef<number | null>(null);

  /**
   * Shared "session teardown" primitive for biometric state.
   *
   * Called from:
   *   1. onLogout — multi-user device hand-off. Without this, user B
   *      could inherit user A's verified flag on the same hardware.
   *   2. Background-resume timeout — long idle = "new session" semantics.
   *
   * Two effects, intentionally coupled:
   *   • clearBiometricSession() nukes the localStorage verified flag so
   *     any feature that grows to read isBiometricVerified() later sees
   *     a clean state (future-proof).
   *   • biometricUnlocked is reset from the current flag value — if the
   *     user still has Biometric Lock enabled, the next entry into a
   *     logged-in screen will re-trigger the gate.
   */
  const resetBiometricSession = useCallback(() => {
    try { clearBiometricSession(); } catch {}
    try { setBiometricUnlocked(!getBiometricLockEnabled()); }
    catch { setBiometricUnlocked(true); }
  }, []);

  // -- Company match data from CompanyJoin verification ---------
  const [companyMatchData, setCompanyMatchData] = useState<CompanyMatchData | null>(null);

  // -- Language state for i18n --------------------------------
  const [lang, setLang] = useState<Lang>(() => {
    try { const stored = localStorage.getItem("sosphere_app_lang"); if (stored) return stored as Lang; } catch {}
    return "en";
  });
  const t = useT(lang);
  const handleLangChange = useCallback((code: string) => {
    setLang(code as Lang);
    try { localStorage.setItem("sosphere_app_lang", code); } catch {}
  }, []);

  // Track source screen for back navigation (employee vs individual)
  const [sourceScreen, setSourceScreen] = useState<"individual-home" | "employee-dashboard">("individual-home");

  // Derived user zone based on context
  const userZone = companyMatchData?.zoneName || (companyName ? "Field Zone" : "Personal");

  // -- Admin Unreachable ? Show Incident Report ------------------
  const [showIncidentReport, setShowIncidentReport] = useState(false);
  const [pendingEmergencyId, setPendingEmergencyId] = useState<string>("");

  // -- Navigation history stack (back button support) ---------------
  const screenHistoryRef = useRef<Screen[]>([]);
  // Ref to IndividualLayout for handling back button within tabs
  const individualLayoutRef = useRef<IndividualLayoutHandle>(null);
  // AUDIT-FIX (2026-04-21): track which civilian tab is active so
  // floating overlays (VoiceSOSWidget) only appear on the Home tab.
  const [civilianActiveTab, setCivilianActiveTab] = useState<string>("home");

  // -- FIX 3: SOS Dedup � prevents triple-trigger from hold + shake + fall --
  const sosInProgressRef = useRef(false);
  const sosLastTriggerRef = useRef(0);
  const sosSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_SOS_DURATION_MS = 30 * 60 * 1000; // 30 min safety reset

  /** Guarded SOS trigger — only allows one SOS per 30s window. First trigger wins. */
  const guardedSOSTrigger = useCallback((source: "hold" | "shake" | "fall" | "voice", customSource?: "individual-home" | "employee-dashboard") => {
    const now = Date.now();
    if (sosInProgressRef.current) return false;
    if (now - sosLastTriggerRef.current < 30000) return false;
    sosInProgressRef.current = true;
    sosLastTriggerRef.current = now;
    // Safety: auto-reset after 30min to prevent permanent lockout if SOS component crashes
    if (sosSafetyTimerRef.current) clearTimeout(sosSafetyTimerRef.current);
    sosSafetyTimerRef.current = setTimeout(() => { sosInProgressRef.current = false; try { localStorage.removeItem("sosphere_active_sos"); } catch {} }, MAX_SOS_DURATION_MS);
    const src = customSource || (screen === "employee-dashboard" || screen === "mission-tracker" ? "employee-dashboard" : "individual-home");
    setSourceScreen(src as "individual-home" | "employee-dashboard");
    // Persist SOS state — app will resume here if killed/restarted
    try { localStorage.setItem("sosphere_active_sos", JSON.stringify({ active: true, source: src, timestamp: now })); } catch {}
    navigate("sos-emergency");
    return true;
  }, [screen]);

  // -- Fall Detection -------------------------------------------
  const [fallDetectionEnabled] = useState(true);
  // Safety-critical screens where fall detection + shake SOS must remain active
  const isInApp = screen === "employee-dashboard" || screen === "individual-home" || screen === "checkin-timer" || screen === "mission-tracker" || screen === "safe-walk";
  const fallDetection = useFallDetection({
    enabled: fallDetectionEnabled && isInApp,
    onSOSTrigger: () => {
      // FIX 3: Guarded � fall detection goes through dedup
      guardedSOSTrigger("fall");
    },
    countdownSeconds: 15,
  });

  // -- Push Notifications ---------------------------------------
  useNotifications();

  // -- Shake-to-SOS with 3-second confirmation window ----------
  const [shakeEnabled] = useState(true);
  const [shakeCountdown, setShakeCountdown] = useState<number | null>(null);
  const shakeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cancelShakeSOS = useCallback(() => {
    if (shakeTimerRef.current) {
      clearInterval(shakeTimerRef.current);
      shakeTimerRef.current = null;
    }
    setShakeCountdown(null);
    console.log("[SUPABASE_READY] shake_sos_cancelled");
  }, []);

  const confirmShakeSOS = useCallback(() => {
    if (shakeTimerRef.current) {
      clearInterval(shakeTimerRef.current);
      shakeTimerRef.current = null;
    }
    setShakeCountdown(null);
    console.log("[SUPABASE_READY] shake_sos_confirmed");
    // FIX 3: Guarded � shake SOS goes through dedup
    if (!guardedSOSTrigger("shake")) return;
    // [SUPABASE_READY] shake_sos: insert into sos_events with trigger_method='shake'
    emitSyncEvent({
      type: "SHAKE_SOS",
      employeeId: `EMP-${loginName.replace(/\s+/g, "")}`,
      employeeName: loginName,
      zone: userZone,
      timestamp: Date.now(),
      data: { triggerMethod: "shake" },
    });
  }, [guardedSOSTrigger, loginName, userZone]);

  const startShakeCountdown = useCallback(() => {
    // Don't start if already counting down
    if (shakeTimerRef.current) return;
    setShakeCountdown(3);
    let remaining = 3;
    shakeTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (shakeTimerRef.current) clearInterval(shakeTimerRef.current);
        shakeTimerRef.current = null;
        setShakeCountdown(null);
        // Auto-confirm
        confirmShakeSOS();
      } else {
        setShakeCountdown(remaining);
      }
    }, 1000);
  }, [confirmShakeSOS]);

  useShakeDetection({
    enabled: shakeEnabled && isInApp,
    onShakeSOS: startShakeCountdown,
  });

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) clearInterval(shakeTimerRef.current);
    };
  }, []);

  // Phase 6 — on login, attempt to backfill any incidents that never
  // reached the server (offline at the time). Entirely non-blocking;
  // no-op when Supabase isn't configured. Delayed slightly so it
  // doesn't compete with the initial login/navigation burst.
  useEffect(() => {
    if (!loginName) return;
    const t = setTimeout(() => {
      resyncPendingIncidents().catch(() => {});
    }, 4000);
    return () => clearTimeout(t);
  }, [loginName]);

  // -- Voice SOS Trigger Handler --------------------------------
  const handleVoiceSOSTriggered = useCallback(
    (keyword: string, confidence: number) => {
      if (import.meta.env.DEV) {
        console.log(`[Voice SOS] Keyword detected: "${keyword}" (confidence: ${(confidence * 100).toFixed(1)}%)`);
      }
      // Use guardedSOSTrigger to prevent spam and concurrent SOS
      if (!guardedSOSTrigger("voice")) return;
      // Emit SOS event
      emitSyncEvent({
        type: "VOICE_SOS",
        employeeId: `EMP-${loginName.replace(/\s+/g, "")}`,
        employeeName: loginName,
        zone: userZone,
        timestamp: Date.now(),
        data: { triggerMethod: "voice", keyword, confidence },
      });
    },
    [guardedSOSTrigger, loginName, userZone]
  );

  // -- SAR Alert (Search & Rescue notification from admin) ------
  const [sarAlert, setSarAlert] = useState<{ active: boolean; employeeName?: string; zone?: string } | null>(null);

  // -- Emergency Chat (during SOS) ------------------------------
  const [, setShowMobileChat] = useState(false);
  const [mobileChatCollapsed, setMobileChatCollapsed] = useState(true);
  const [currentEmergencyId] = useState(`EMG-${Date.now().toString(36).toUpperCase().slice(-4)}`);

  // -- FIX AUDIT-3.4: Storage failure banner --------------------
  const [storageBanner, setStorageBanner] = useState<{ visible: boolean; message: string }>({ visible: false, message: "" });
  useEffect(() => {
    const unsub = onStorageBanner((visible, message) => {
      setStorageBanner({ visible, message });
    });
    return unsub;
  }, []);

  // -- Restore session on mount: only skip to home if ALL steps were completed --------
  useEffect(() => {
    const restoreSession = async () => {
      try {
        // CRITICAL: Check if SOS was active when app was killed — resume immediately
        try {
          const activeSos = localStorage.getItem("sosphere_active_sos");
          if (activeSos) {
            const sos = JSON.parse(activeSos);
            // Only resume if SOS was triggered within the last 30 minutes
            if (sos.active && Date.now() - sos.timestamp < 30 * 60 * 1000) {
              const savedProfile = loadJSONSync<{ name: string } | null>("sosphere_individual_profile", null);
              if (savedProfile?.name) setLoginName(savedProfile.name);
              setLoginMode("individual");
              setSourceScreen(sos.source || "individual-home");
              sosInProgressRef.current = true;
              setIsRestoring(false);
              navigate("sos-emergency");
              console.log("[SOS] RESUMED active emergency after app restart");
              return;
            } else {
              // Stale SOS state — clean up
              localStorage.removeItem("sosphere_active_sos");
            }
          }
        } catch {}

        const { supabase, getSession, getGoogleUserInfo } = await import("./api/supabase-client");

        // Check if this is an OAuth callback (URL contains access_token hash)
        const isOAuthCallback = window.location.hash?.includes("access_token");
        if (isOAuthCallback) {
          await new Promise(r => setTimeout(r, 500));
          if (window.history?.replaceState) {
            window.history.replaceState(null, "", window.location.pathname);
          }
        }

        // ALL THREE conditions must be true to skip to home:
        // 1. Active Supabase session (user is authenticated)
        // 2. Consent screens completed (terms + GPS)
        // 3. Profile registration completed (local profile saved)
        const session = await getSession();
        const consentDone = hasCompletedConsent() && hasCompletedGpsConsent();
        const savedProfile = loadJSONSync<{ name: string; phone: string; registeredAt: number } | null>("sosphere_individual_profile", null);

        if (session?.user && consentDone && savedProfile?.registeredAt) {
          // Fully completed user — go straight to home
          setLoginName(savedProfile.name || session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "");
          setLoginPhone(savedProfile.phone || "");
          setLoginMode("individual");
          // AUDIT-FIX: authoritative user id for SOS server calls.
          setAuthUserId(session.user.id);
          screenHistoryRef.current = [];
          setIsRestoring(false);
          navigate("individual-home");
          console.log("[Auth] Fully restored user:", savedProfile.name);
          return;
        }

        // Not fully completed — go to welcome screen (user must go through full flow)
        // But if there's a session, we can pre-fill some data
        if (session?.user) {
          const meta = session.user.user_metadata || {};
          setLoginName(meta.full_name || meta.name || session.user.email?.split("@")[0] || "");
          // AUDIT-FIX: capture auth UUID even on partial restore so SOS
          // works the moment the user finishes the welcome flow.
          setAuthUserId(session.user.id);
          console.log("[Auth] Partial session found, sending to welcome for full flow");
        }

      } catch (e) {
        console.warn("[SOS] Session restore failed:", e);
      }
      setIsRestoring(false);
    };

    restoreSession();
  }, []);

  // -- Google OAuth: Navigation is handled directly by handleGmailLogin() --
  // The onAuthStateChange listener was removed to prevent race conditions
  // where both the listener AND handleGmailLogin tried to navigate simultaneously.
  // The native GoogleAuth.signIn() → handleGmailLogin flow is the single source of truth.

  // -- Voice-engine token sync (narrow, non-navigating listener) --
  // The only job of this effect is to keep voiceCallEngine's server-auth
  // header in sync with the Supabase session. It deliberately:
  //   • Does NOT call navigate()/setScreen() — that's the OAuth race that
  //     forced us to drop the old onAuthStateChange listener.
  //   • Does NOT branch on event type beyond "do we have a token?" — both
  //     SIGNED_IN and TOKEN_REFRESHED deliver a fresh access_token; on
  //     SIGNED_OUT the session is null and refreshAuthToken's null-guard
  //     handles it (no-op). Less code, fewer corners.
  //   • Does an initial getSession() pull so a restored session hydrates
  //     the engine on cold start (the listener alone wouldn't fire for
  //     an already-persisted session).
  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    (async () => {
      try {
        const [{ supabase, getSession }, { voiceCallEngine }] = await Promise.all([
          import("./api/supabase-client"),
          import("./voice-call-engine"),
        ]);
        if (cancelled) return;

        // Hydrate on mount — matters for app-restarts with a persisted session.
        try {
          const session = await getSession();
          if (!cancelled && session?.access_token) {
            await voiceCallEngine.refreshAuthToken(session.access_token);
          }
        } catch (err) {
          console.warn("[SOS] voice-engine initial token sync failed:", err);
        }

        // Subscribe — fires on SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT, USER_UPDATED, etc.
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          const token = session?.access_token;
          if (!token) return; // SIGNED_OUT / null — leave engine as-is
          voiceCallEngine.refreshAuthToken(token).catch((err) => {
            console.warn("[SOS] voice-engine token refresh failed:", err);
          });
        });
        subscription = data?.subscription ?? null;
      } catch (err) {
        console.warn("[SOS] Voice token sync setup failed (non-fatal):", err);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  // -- SOS offline queue replay watcher ----------------------------
  // Re-fires any SOS events that were queued to IndexedDB but never
  // reached the server (dead zone, captive portal, Supabase outage).
  // Idempotent: safe to mount once for the lifetime of the app. The
  // watcher itself handles network-state tracking + debouncing.
  //
  // TTL inside the service prevents re-ringing contacts about stale
  // emergencies (default 15 min). Exhausted records remain in the DB
  // unsynced as a forensic trail.
  //
  // Dynamic import to keep SOS startup cost minimal — the queue layer
  // is only loaded when it's actually wired.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ startSOSReplayWatcher }, { startAudioReplayWatcher }] = await Promise.all([
          import("./sos-server-trigger"),
          import("./sos-audio-upload"),
        ]);
        if (cancelled) return;
        // Watcher 1: re-fires SOS events to the Edge Function.
        startSOSReplayWatcher();
        // Watcher 2: re-uploads any voice recordings whose live
        // Supabase Storage upload failed at capture time (offline,
        // captive portal, outage). Evidence is recovered even if the
        // user abandoned the debrief flow.
        startAudioReplayWatcher();
      } catch (err) {
        console.warn("[mobile-app] SOS replay watchers setup failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // -- Background-resume biometric re-lock --------------------------
  // Standard banking/security-app pattern: if the app has been in the
  // background long enough to look like "the user walked away and came
  // back" (default 5 min), require re-auth on resume. This is the
  // semantically-correct "session ended" signal — NOT the end of the
  // post-emergency debrief (which would be hostile UX to someone who
  // just survived an incident).
  //
  // Implementation notes:
  //   • Uses Capacitor App.addListener('appStateChange') which fires with
  //     { isActive: boolean } on both native and web (where it degrades
  //     to visibility events).
  //   • We only ARM the timer on isActive=false. No work on foreground
  //     entry unless a backgrounded-at timestamp exists — this avoids a
  //     spurious "just launched" trip on app cold-start.
  //   • Short background hops (notification → reply → return) under the
  //     threshold are no-ops so we don't punish normal multitasking.
  //   • Ref-based timestamp (not state) because we never want a re-render
  //     when the app leaves/enters the foreground.
  //   • No-ops entirely when biometric lock is off — cheap guard, no
  //     listener churn.
  useEffect(() => {
    const BACKGROUND_LOCK_MS = 5 * 60 * 1000; // 5 minutes
    let removeListener: (() => Promise<void>) | null = null;

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appStateChange", (state: { isActive: boolean }) => {
          if (!state.isActive) {
            // Going to background — record the timestamp. Always record,
            // even if the flag is off today, so that toggling the flag
            // ON mid-session doesn't require a re-arm cycle.
            backgroundedAtRef.current = Date.now();
            return;
          }
          // Coming back to foreground.
          const backgroundedAt = backgroundedAtRef.current;
          backgroundedAtRef.current = null;
          if (backgroundedAt == null) return;
          const idleMs = Date.now() - backgroundedAt;
          if (idleMs < BACKGROUND_LOCK_MS) return;
          // Only re-lock if the user actually has the feature enabled.
          if (!getBiometricLockEnabled()) return;
          resetBiometricSession();
        });
        removeListener = () => handle.remove();
      } catch (err) {
        // Capacitor not available (pure web dev) — non-fatal.
        console.info("[SOS] Background lock listener not installed:", err);
      }
    })();

    return () => {
      removeListener?.().catch(() => {});
    };
  }, [resetBiometricSession]);

  // -- Auto-start GPS tracking + offline sync when logged in --
  useEffect(() => {
    const loggedInScreens: Screen[] = ["individual-home", "employee-dashboard", "sos-emergency", "checkin-timer", "medical-id", "emergency-contacts", "notifications", "incident-history", "emergency-packet", "emergency-services", "evacuation", "mission-tracker", "safe-walk"];
    if (loggedInScreens.includes(screen)) {
      // Start GPS tracking with high-risk preset
      const _realGpsId = loginName.replace(/\s+/g, "") ? `EMP-${loginName.replace(/\s+/g, "")}` : "EMP-UNKNOWN";
      startGPSTracking({ employeeId: _realGpsId, ...ZONE_PRESETS.high });
      // Enable auto-sync on reconnect
      enableAutoSync();
    }
    return () => {
      // Don't stop GPS on screen change � only stop when logging out
    };
  }, [screen]);

  useEffect(() => {
    if (screen === "sos-emergency") {
      activateEmergencyTracking();
    } else {
      deactivateEmergencyTracking();
    }
  }, [screen]);

  // Listen for admin signals (ADMIN_UNREACHABLE ? show photo report)
  useEffect(() => {
    const unsub = onAdminSignal((type, employeeId, extra) => {
      if (type === "ADMIN_UNREACHABLE" && screen === "sos-emergency") {
        setPendingEmergencyId(employeeId);
        setTimeout(() => {
          setShowIncidentReport(true);
        }, 2000);
      }
      if (type === "SAR_ACTIVATED") {
        setSarAlert({ active: true, employeeName: extra?.employeeName, zone: extra?.zone });
        // Auto-dismiss after 30 seconds
        setTimeout(() => setSarAlert(null), 30000);
      }
      if (type === "SAR_WORKER_FOUND") {
        setSarAlert(null);
      }
    });
    return unsub;
  }, [screen]);

  // Screens where back should EXIT the app (root screens)
  const ROOT_SCREENS: Screen[] = ["welcome", "login-phone", "login-welcome", "individual-home", "employee-dashboard"];

  // FIX: goBack MUST be declared before the useEffect that uses it in [deps]
  const goBack = useCallback(() => {
    // First: if on individual-home with a sub-tab (map, family, profile), go back to home tab
    if (screenRef.current === "individual-home" && individualLayoutRef.current?.handleBack()) {
      return; // Handled by IndividualLayout — went back to home tab
    }
    // AUDIT-FIX (2026-04-21) — CRITICAL: on root screens (Home / Dashboard
    // / Welcome / Login) the back button MUST exit the app, NEVER pop the
    // history stack. Previous bug: pressing back on Home popped the
    // history and sent the user back into the login/onboarding chain,
    // making it appear they were "logged out" without tapping Log Out.
    if (ROOT_SCREENS.includes(screenRef.current)) {
      try {
        if (CapacitorApp) CapacitorApp.exitApp();
      } catch {}
      return;
    }
    const history = screenHistoryRef.current;
    if (history.length > 0) {
      const prev = history[history.length - 1];
      screenHistoryRef.current = history.slice(0, -1);
      setDirection(-1);
      setScreen(prev);
    } else {
      // No history, non-root screen — fallback: exit (shouldn't normally happen)
      try {
        if (CapacitorApp) CapacitorApp.exitApp();
      } catch {}
    }
  }, []);

  const navigate = (to: Screen, dir: 1 | -1 = 1) => {
    setDirection(dir);
    screenRef.current = to; // Keep ref in sync for back button handler
    if (dir === 1) {
      // Forward navigation — push current screen to history
      setScreen(prev => {
        screenHistoryRef.current = [...screenHistoryRef.current, prev];
        return to;
      });
    } else {
      // Backward navigation — pop history
      screenHistoryRef.current = screenHistoryRef.current.slice(0, -1);
      setScreen(to);
    }
  };

  // Android hardware back button handler — goBack must be declared above this
  useEffect(() => {
    let listenerHandle: any = null;

    const setupBackButton = async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        listenerHandle = await CapApp.addListener("backButton", () => {
          // CRITICAL: Block back button during active SOS — safety first
          if (screenRef.current === "sos-emergency") {
            console.log("[SOS] Back button blocked during emergency");
            return; // Do nothing — user must end SOS through the secure flow
          }
          // Also block on the debrief screen so back doesn't pop to the
          // just-ended sos-emergency (which would re-mount and re-arm SOS).
          if (screenRef.current === "post-emergency-debrief") {
            console.log("[SOS] Back blocked on debrief — use in-screen buttons");
            return;
          }
          goBack();
        });
      } catch {
        // Fallback for browser — handle popstate
        const handlePopState = () => goBack();
        window.addEventListener("popstate", handlePopState);
        window.history.pushState(null, "", window.location.href);
        return () => window.removeEventListener("popstate", handlePopState);
      }
    };

    setupBackButton();

    return () => {
      if (listenerHandle) {
        try { listenerHandle.remove(); } catch {}
      }
    };
  }, [goBack]);

  const handleSendOTP = async (phoneNumber: string) => {
    // Triggers OTP send only — LoginPhone manages its own verify step internally.
    // onLoginComplete (passed as prop below) fires once the full auth flow succeeds.
    const { signInWithPhone } = await import("./api/supabase-client");
    const { error } = await signInWithPhone(phoneNumber);
    if (error) { console.error("[Auth] OTP failed:", error); return; }
    console.log("[Auth] OTP sent to:", phoneNumber);
    // No navigate here — LoginPhone shows its OTP input after this callback returns.
  };

  const handleGmailLogin = async () => {
    try {
      const { signInWithGoogle, getGoogleUserInfo } = await import("./api/supabase-client");

      // Step 1: Show native account picker + authenticate with Supabase
      const { session, error } = await signInWithGoogle();

      if (error) {
        console.error("[MobileApp] Google sign-in error:", error);
        return;
      }
      if (!session) return; // User cancelled the picker

      // Step 2: Token validated — extract user info
      const info = await getGoogleUserInfo();
      if (!info) {
        console.error("[MobileApp] Could not get user info after Google auth");
        return;
      }

      console.log("[MobileApp] Google auth success:", info.email, "isNew:", info.isNewUser);
      setLoginName(info.name || info.email.split("@")[0]);
      setLoginMode("individual");
      // AUDIT-FIX: capture the authoritative Supabase auth UUID so that
      // subsequent SOS triggers pass the userId the server expects.
      // info.id comes from getGoogleUserInfo which returns the
      // Supabase session user.id (auth.uid()).
      if ((info as any).id) setAuthUserId((info as any).id);

      // Step 3: Route through the FULL validation chain
      // Even returning users must have completed consent + registration locally.
      // restoreSession handles the "everything already done" case on app launch.
      // Here we always go through the consent → registration flow.
      const consentDone = hasCompletedConsent();
      const gpsConsentDone = hasCompletedGpsConsent();
      const savedProfile = loadJSONSync<{ registeredAt: number } | null>("sosphere_individual_profile", null);

      if (!consentDone) {
        // Must accept terms first
        navigate("terms-consent");
      } else if (!gpsConsentDone) {
        // Must accept GPS consent
        navigate("gps-consent");
      } else if (!savedProfile?.registeredAt) {
        // Must complete profile registration
        navigate("individual-register");
      } else {
        // ALL steps verified complete — safe to go home
        screenHistoryRef.current = [];
        navigate("individual-home");
      }
    } catch (err: any) {
      console.error("[MobileApp] Google login error:", err?.message || err);
    }
  };

  const handleEmailLogin = (_email: string, name: string) => {
    setLoginMode("individual");
    setLoginName(name);
    navigate("login-welcome");
  };

  const handleDemoAccess = (role?: string, name?: string) => {
    setLoginMode("demo");
    setLoginName(name || "Demo User");
    setLoginRole(role || "worker");
    navigate("login-welcome");
  };

  const handleBack = () => navigate("login", -1);
  const handleWelcomeComplete = () => navigate("role-select");
  // FIX AUDIT-7.1 + 7.3: Route through consent screens if not yet accepted
  const handleLoginWelcomeComplete = () => {
    if (!hasCompletedConsent()) {
      navigate("terms-consent");
    } else if (!hasCompletedGpsConsent()) {
      navigate("gps-consent");
    } else {
      navigate(selectedPath === "employee" ? "company-join" : "individual-register");
    }
  };

  // -- Safe Walk: Load emergency contacts from localStorage ----
  /* SUPABASE_MIGRATION_POINT: emergency_contacts
     Replace loadJSONSync with:
     const { data } = await supabase
       .from('emergency_contacts')
       .select('*')
       .eq('employee_id', userId) */
  const safeWalkContacts = useMemo(() => {
    try {
      const stored = loadJSONSync<Array<{
        name: string;
        phone: string;
        relation: string;
        avatar?: string;
      }>>("sosphere_emergency_contacts", []);
      console.log("[SUPABASE_READY] safe_walk_contacts_loaded: " + (stored?.length ?? 0) + " contacts");
      return stored ?? [];
    } catch {
      return [];
    }
  }, [screen]); // re-read when screen changes to safe-walk

  return (
    <div
      className="relative w-full min-h-screen overflow-hidden"
      style={{ background: "#05070E", fontFamily: "'Outfit', sans-serif" }}
    >
                {/* Broadcast Island � floating broadcast alert */}
        <BroadcastIsland />

        {/* Voice SOS Widget — AUDIT-FIX (2026-04-21): user reported the
            floating microphone looks like a broken indicator (always
            crossed out when mic permission not granted) and is visually
            intrusive on every civilian screen. Now gated behind an
            explicit opt-in flag (`sosphere_voice_sos_enabled`). Default
            OFF — user enables it from Settings > Security if they want
            voice-triggered SOS. Admin/employee dashboard keeps it since
            it's a pro-grade feature users actively opted into.
            TODO: add the opt-in toggle to profile-settings when user
            approves the feature. For now: always hidden on civilian. */}
        {screen === "employee-dashboard" && (
          <VoiceSOSWidget
            onVoiceSOSTriggered={handleVoiceSOSTriggered}
            primaryKeyword="help me"
            secondaryKeywords={["emergency", "mayday"]}
            confidenceThreshold={0.7}
            cooldownMs={30000}
            position="bottom-left"
          />
        )}

        {/* -- SAR Alert Banner � slides down when SAR activated --- */}
        <AnimatePresence>
          {sarAlert?.active && (
            <motion.div
              initial={{ opacity: 0, y: -80 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -80 }}
              transition={{ type: "spring", damping: 20, stiffness: 200 }}
              className="absolute left-3 right-3 z-40"
              style={{ top: "calc(env(safe-area-inset-top) + 56px)" }}
            >
              <div
                style={{
                  background: "rgba(255,45,85,0.12)",
                  border: "1px solid rgba(255,45,85,0.3)",
                  borderRadius: 16,
                  padding: "12px 14px",
                  /* backdropFilter removed — Android WebView edge artifact */
                }}
              >
                <div className="flex items-start gap-3">
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: "rgba(255,45,85,0.2)", border: "1px solid rgba(255,45,85,0.4)",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF2D55" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="12" r="6" strokeDasharray="3 3" />
                      <circle cx="12" cy="12" r="2" fill="#FF2D55" />
                    </svg>
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#FF2D55", letterSpacing: "0.3px" }}>
                      SEARCH & RESCUE ACTIVATED
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", marginTop: 3, lineHeight: 1.4 }}>
                      {sarAlert.employeeName
                        ? `${sarAlert.employeeName} is missing in ${sarAlert.zone || "field area"}. Stay alert and check your surroundings.`
                        : "A colleague is missing. Stay alert and respond if contacted by admin."}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => setSarAlert(null)}
                        aria-label="Acknowledge search and rescue alert"
                        style={{
                          fontSize: 9, fontWeight: 700, color: "#FF2D55", padding: "4px 10px",
                          borderRadius: 6, background: "rgba(255,45,85,0.15)", cursor: "pointer",
                          border: "1px solid rgba(255,45,85,0.2)",
                        }}
                      >
                        ACKNOWLEDGED
                      </button>
                      <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>
                        Tap to dismiss
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* -- Auto Evacuation Overlay ----------------------- */}
        {/* Shows automatically when admin declares evacuation */}
        <EvacuationAlertOverlay
          employeeId={`EMP-${loginName.replace(/\s+/g, "")}`}
          employeeName={loginName}
          currentZoneId="Z-A"
        />

        {/* -- Neighbour SOS Alert Overlay ------------------- */}
        {/* Shows when an opted-in neighbour nearby triggers SOS.        */}
        {/* Suppressed while user is handling their own SOS so we        */}
        {/* don't stack crises on them.                                  */}
        <NeighborAlertOverlay
          lang={lang === "ar" ? "ar" : "en"}
          suppress={screen === "sos-emergency"}
        />

        {/* -- Biometric App-Unlock Gate --------------------- */}
        {/* Blocks access to logged-in screens on cold-start when the    */}
        {/* user has opted into Biometric Lock in Privacy settings.      */}
        {/* Key choices:                                                 */}
        {/*   • Only rendered for logged-in screens — pre-login flows    */}
        {/*     (welcome/login/onboarding) are intentionally unblocked   */}
        {/*     so users can never get locked out of the front door.     */}
        {/*   • Suppressed during sos-emergency — never stand between    */}
        {/*     a user and their panic button. This is a lock, not a     */}
        {/*     hostage situation.                                       */}
        {/*   • allowPinFallback=true so a broken sensor isn't terminal. */}
        {(() => {
          const lockedScreens: Screen[] = [
            "individual-home", "employee-dashboard",
            "medical-id", "emergency-contacts", "emergency-packet",
            "emergency-services", "notifications", "incident-history",
            "evacuation", "mission-tracker", "safe-walk",
            "language", "privacy", "connected-devices", "help",
            "elite-features", "subscription",
          ];
          const shouldLock =
            !biometricUnlocked &&
            !isRestoring &&
            lockedScreens.includes(screen);
          return (
            <BiometricGateModal
              isOpen={shouldLock}
              onVerified={() => setBiometricUnlocked(true)}
              // No cancel handler — the user MUST unlock to proceed.
              // Leaving onCancel undefined disables the backdrop click / X
              // dismissal paths that would otherwise break the gate.
              title="Unlock SOSphere"
              description="Verify your identity to continue"
              userId="sosphere-local"
              userName="SOSphere User"
              allowPinFallback={true}
            />
          );
        })()}

        {/* -- Incident Photo Report � triggered by Admin Unreachable -- */}
        <AnimatePresence>
          {showIncidentReport && (
            <IncidentPhotoReport
              emergencyId={pendingEmergencyId || "EMG-AUTO"}
              employeeName={loginName}
              zone={userZone}
              tier={userPlan === "employee" ? "paid" : userPlan === "pro" ? "paid" : "free"}
              onSubmitReport={(data: IncidentReportData) => {
                // -- CRITICAL: Emit sync event so dashboard receives the report --
                // [SUPABASE_READY] incident_report: insert into incident_reports + storage.upload(photos)
                emitSyncEvent({
                  type: "INCIDENT_REPORT_RECEIVED",
                  employeeId: `EMP-${loginName.replace(/\s+/g, "")}`,
                  employeeName: loginName,
                  zone: data.zone || userZone,
                  timestamp: Date.now(),
                  data: {
                    emergencyId: data.emergencyId,
                    photos: data.photos.map(p => ({
                      id: p.id,
                      dataUrl: p.dataUrl,
                      caption: p.caption,
                      size: p.size,
                    })),
                    photoCount: data.photos.length,
                    audioMemo: data.audioMemo || undefined,
                    comment: data.comment,
                    severity: data.severity,
                    incidentType: data.incidentType,
                  },
                });
                setShowIncidentReport(false);
                setTimeout(() => {
                  navigate(sourceScreen, -1);
                }, 3000);
              }}
              onClose={() => {
                setShowIncidentReport(false);
                navigate(sourceScreen, -1);
              }}
            />
          )}
        </AnimatePresence>

        {/* -- Fall Detection Overlay -- */}
        <FallDetectionOverlay
          state={fallDetection.state}
          countdown={fallDetection.countdown}
          onCancel={fallDetection.cancelFall}
        />

        {/* -- Shake-to-SOS Overlay � 3-second confirmation countdown -- */}
        <AnimatePresence>
          {shakeCountdown !== null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 z-[70] flex flex-col items-center justify-center"
              style={{
                background: "rgba(5,7,14,0.92)",
                backdropFilter: "blur(20px)",
              }}
            >
              {/* Pulsing ring + countdown number */}
              <motion.div
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="relative flex items-center justify-center"
                style={{ width: 140, height: 140 }}
              >
                {/* Outer glow ring */}
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "radial-gradient(circle, rgba(255,45,85,0.15) 0%, transparent 70%)",
                  }}
                />
                {/* SVG countdown ring */}
                <svg width="140" height="140" viewBox="0 0 140 140" className="absolute inset-0">
                  <circle cx="70" cy="70" r="58" fill="none" stroke="rgba(255,45,85,0.15)" strokeWidth="4" />
                  <motion.circle
                    cx="70" cy="70" r="58"
                    fill="none"
                    stroke="#FF2D55"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={Math.PI * 2 * 58}
                    strokeDashoffset={Math.PI * 2 * 58 * (shakeCountdown / 3)}
                    style={{ transformOrigin: "center", rotate: "-90deg" }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                </svg>
                {/* Countdown number */}
                <motion.div
                  key={shakeCountdown}
                  initial={{ scale: 1.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  style={{
                    fontSize: 48,
                    fontWeight: 800,
                    color: "#FF2D55",
                    fontFamily: "'Outfit', sans-serif",
                    textShadow: "0 0 30px rgba(255,45,85,0.5)",
                  }}
                >
                  {shakeCountdown}
                </motion.div>
              </motion.div>

              {/* Label */}
              <div className="mt-6 flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  <motion.div
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                    className="size-2 rounded-full"
                    style={{ background: "#FF2D55", boxShadow: "0 0 8px #FF2D55" }}
                  />
                  <span style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#FF2D55",
                    fontFamily: "'Outfit', sans-serif",
                    letterSpacing: "-0.3px",
                  }}>
                    SOS في {shakeCountdown} ثوانٍ...
                  </span>
                </div>
                <span style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.45)",
                  fontFamily: "'Outfit', sans-serif",
                }}>
                  تم رصد اهتزاز — جاري تفعيل SOS تلقائياً
                </span>
              </div>

              {/* Cancel button */}
              <motion.button
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.3 }}
                onClick={cancelShakeSOS}
                className="mt-8 px-10 py-3.5 rounded-2xl transition-all active:scale-95"
                style={{
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  backdropFilter: "blur(10px)",
                }}
              >
                <span style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#fff",
                  fontFamily: "'Outfit', sans-serif",
                }}>
                  إلغاء التنبيه
                </span>
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* -- Emergency Chat (during SOS) -- */}
        {screen === "sos-emergency" && (
          <MobileEmergencyChat
            emergencyId={currentEmergencyId}
            employeeName={loginName}
            isVisible={screen === "sos-emergency"}
            onClose={() => setShowMobileChat(false)}
            onToggle={() => setMobileChatCollapsed(!mobileChatCollapsed)}
            collapsed={mobileChatCollapsed}
          />
        )}

        {/* -- Offline Status Indicator -- */}
        {isInApp && (
          <div className="absolute right-4 z-[55]" style={{ top: "calc(env(safe-area-inset-top) + 12px)" }}>
            <OfflineIndicator compact />
          </div>
        )}

        {/* FIX AUDIT-3.4: Storage failure emergency banner */}
        <AnimatePresence>
          {storageBanner.visible && (
            <motion.div
              initial={{ opacity: 0, y: -40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              className="absolute left-3 right-3 z-[60]"
              style={{ top: 56 }}
            >
              <div
                style={{
                  background: "rgba(255,45,85,0.95)",
                  borderRadius: 14,
                  padding: "10px 14px",
                  /* backdropFilter removed — Android WebView edge artifact */
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} color="#fff" className="mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#fff" }}>STORAGE FULL</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.85)", marginTop: 2, lineHeight: 1.4 }}>
                      Alert could not be saved. Call emergency services directly:
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <a href="tel:911" style={{ fontSize: 11, fontWeight: 800, color: "#fff", padding: "4px 12px", borderRadius: 8, background: "rgba(255,255,255,0.2)", textDecoration: "none" }}>911</a>
                      <a href="tel:999" style={{ fontSize: 11, fontWeight: 800, color: "#fff", padding: "4px 12px", borderRadius: 8, background: "rgba(255,255,255,0.2)", textDecoration: "none" }}>999</a>
                      <a href="tel:112" style={{ fontSize: 11, fontWeight: 800, color: "#fff", padding: "4px 12px", borderRadius: 8, background: "rgba(255,255,255,0.2)", textDecoration: "none" }}>112</a>
                      <button onClick={() => setStorageBanner({ visible: false, message: "" })} style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,0.7)" }}>Dismiss</button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Screen transitions — plain divs for Capacitor WebView compat */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 1 }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
            {/* -- Restoring spinner � shown while profile loads from localStorage -- */}
            {isRestoring && (
              <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center" style={{ background: "#05070E" }}>
                <div
                  className="size-8 rounded-full"
                  style={{ border: "2px solid rgba(0,200,224,0.15)", borderTopColor: "#00C8E0", animation: "spin 1s linear infinite" }}
                />
                <p className="mt-3" style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontFamily: "'Outfit', system-ui, sans-serif" }}>
                  {loginMode === "individual" ? "جاري استعادة ملفك الشخصي..." : "Restoring profile..."}
                </p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}

            {screen === "welcome" && (
              <WelcomeOnboarding onComplete={handleWelcomeComplete} />
            )}

            {screen === "role-select" && (
              <RoleSelect
                onSelectCivilian={() => { setSelectedPath("civilian"); navigate("login"); }}
                onSelectEmployee={() => { setSelectedPath("employee"); navigate("login"); }}
              />
            )}

            {screen === "login" && (
              <LoginPhone
                onSendOTP={handleSendOTP}
                onLoginComplete={(phone)=>{ setLoginPhone(phone || ""); if(!hasCompletedConsent()){navigate("terms-consent");}else if(!hasCompletedGpsConsent()){navigate("gps-consent");}else{ navigate(selectedPath === "employee" ? "company-join" : "individual-register"); }}}
                onGmailLogin={handleGmailLogin}
                onDemoAccess={handleDemoAccess}
                onEmailLogin={handleEmailLogin}
              />
            )}

            {screen === "login-welcome" && (
              <LoginWelcome
                name={loginName}
                mode={loginMode}
                onComplete={handleLoginWelcomeComplete}
              />
            )}

            {screen === "terms-consent" && (
              <TermsConsentScreen
                onAccept={() => navigate("gps-consent")}
              />
            )}

            {screen === "gps-consent" && (
              <GpsConsentScreen
                onComplete={() => navigate(selectedPath === "employee" ? "company-join" : "individual-register")}
              />
            )}

            {screen === "onboarding" && (
              <OnboardingSelect
                onSelectIndividual={() => navigate("individual-register")}
                onSelectCompany={() => navigate("company-join")}
              />
            )}

            {screen === "individual-register" && (
              <IndividualRegister
                initialPhone={loginPhone}
                onComplete={async (data) => {
                  setLoginName(data.name);
                  setLoginMode("individual");
                  // Save profile + emergency contacts locally
                  try {
                    localStorage.setItem("sosphere_individual_profile", JSON.stringify({
                      name: data.name,
                      phone: data.phone,
                      registeredAt: Date.now(),
                    }));
                    if (data.contacts?.length) {
                      localStorage.setItem("sosphere_emergency_contacts", JSON.stringify(data.contacts));
                    }
                  } catch (_) { /* storage full — non-critical */ }
                  // Mark profile as completed in Supabase metadata
                  try {
                    const { markProfileCompleted } = await import("./api/supabase-client");
                    await markProfileCompleted(data.name, data.phone);
                    console.log("[Auth] Profile marked as completed");
                  } catch (e) {
                    console.warn("[Auth] Could not mark profile completed:", e);
                  }
                  // Clear history stack so back button won't return to registration
                  screenHistoryRef.current = [];
                  navigate("individual-home");
                }}
                onBack={() => navigate("login", -1)}
              />
            )}

            {screen === "company-join" && (
              <CompanyJoin
                onSubmit={(name, matched, matchData) => {
                  setCompanyName(name);
                  setUserPlan("employee");
                  if (matchData) setCompanyMatchData(matchData);
                  if (matched) {
                    navigate("employee-quick-setup");
                  } else {
                    navigate("pending-approval");
                  }
                }}
                onBack={() => navigate("login", -1)}
              />
            )}

            {screen === "pending-approval" && (
              <PendingApproval
                companyName={companyName}
                userPhone="+966551234567"
                adminName={companyMatchData?.managerName || "Company Admin"}
                adminPhone={companyMatchData?.adminPhone}
                adminEmail={companyMatchData?.adminEmail}
                onApproved={() => navigate("employee-welcome")}
                onApprovedAsEmployee={() => navigate("employee-welcome")}
              />
            )}

            {screen === "employee-welcome" && (
              <EmployeeWelcome
                employeeName={loginName}
                companyName={companyName || "Aramco Industries"}
                zoneName={companyMatchData?.zoneName || ""}
                evacuationPoint={companyMatchData?.evacuationPoint || "Assembly Point A"}
                managerName={companyMatchData?.managerName || "Khalid Al-Rashid"}
                managerPhone={companyMatchData?.adminPhone || "+966 55 123 4567"}
                role={companyMatchData?.role || "Field Engineer"}
                department={companyMatchData?.department || "Operations"}
                hasZones={companyMatchData?.hasZones ?? true}
                onComplete={async () => {
                  // C3 FIX: Initialize Realtime channels with company ID from JWT
                  try {
                    const { getSession } = await import("./api/supabase-client");
                    const session = await getSession();
                    if (session?.access_token) {
                      const payload = JSON.parse(atob(session.access_token.split(".")[1]));
                      const cid = payload.company_id || session.user?.user_metadata?.company_id;
                      if (cid) initRealtimeChannels(cid);
                    }
                  } catch {}
                  navigate("employee-dashboard");
                }}
              />
            )}

            {screen === "employee-quick-setup" && (
              <EmployeeQuickSetup
                prefilledData={{
                  name: loginName,
                  phone: "",
                  email: "",
                  role: companyMatchData?.role || "Field Engineer",
                  department: companyMatchData?.department || "Operations",
                  zone: companyMatchData?.zoneName || "Zone A - North Gate",
                  companyName: companyName || "Aramco Industries",
                  managerName: companyMatchData?.managerName,
                  adminPhone: companyMatchData?.adminPhone,
                }}
                onComplete={() => navigate("employee-welcome")}
              />
            )}

            {screen === "individual-home" && (
              <IndividualLayout
                ref={individualLayoutRef}
                onActiveTabChange={setCivilianActiveTab}
                userName={loginName}
                onSOSTrigger={() => { guardedSOSTrigger("hold", "individual-home"); }}
                onRecordingChange={setRecordingEnabled}
                onCheckinTimer={() => { setSourceScreen("individual-home"); navigate("checkin-timer"); }}
                timerActive={timerActive}
                userPlan={userPlan}
                companyName={companyName}
                onNavigateToMedicalID={() => { setSourceScreen("individual-home"); navigate("medical-id"); }}
                onNavigateToSubscription={() => { setSourceScreen("individual-home"); navigate("subscription"); }}
                onNavigateToIncidentHistory={() => { setSourceScreen("individual-home"); navigate("incident-history"); }}
                onNavigateToEmergencyPacket={() => { setSourceScreen("individual-home"); navigate("emergency-packet"); }}
                onNavigateToEmergencyServices={() => { setSourceScreen("individual-home"); navigate("emergency-services"); }}
                onNavigateToEmergencyContacts={() => { setSourceScreen("individual-home"); navigate("emergency-contacts"); }}
                onNavigateToNotifications={(() => { setSourceScreen("individual-home"); navigate("notifications"); })}
                onNavigateToLanguage={(() => navigate("language"))}
                onNavigateToPrivacy={(() => navigate("privacy"))}
                onNavigateToDevices={(() => navigate("connected-devices"))}
                onNavigateToHelp={(() => navigate("help"))}
                onNavigateToEliteFeatures={(() => navigate("elite-features"))}
                onNavigateToSafeWalk={(() => {
                  if (!hasFeature("walkMe")) {
                    toast(lang === "ar"
                      ? "ميزة 'رافقني' تتطلب الخطة الأساسية — جرّب النخبة مجاناً لمدة 7 أيام"
                      : "Walk Me requires Basic plan — try Elite free for 7 days");
                    setSourceScreen("individual-home");
                    navigate("subscription");
                    return;
                  }
                  setSourceScreen("individual-home"); navigate("safe-walk");
                })}
                onLogout={async () => {
                  const { signOut, clearDeviceFingerprint } = await import("./api/supabase-client");
                  await signOut();
                  clearDeviceFingerprint();
                  localStorage.removeItem("sosphere_individual_profile");
                  localStorage.removeItem("sosphere_tos_consent");
                  localStorage.removeItem("sosphere_gps_consent");
                  resetBiometricSession(); // re-arm gate for next user on this device
                  setUserPlan("free");
                  setLoginName("");
                  setLoginPhone("");
                  setLoginMode("individual");
                  setAuthUserId("");
                  screenHistoryRef.current = [];
                  navigate("welcome", -1);
                }}
                t={t}
              />
            )}

            {screen === "employee-dashboard" && (
              <EmployeeDashboard
                companyName={companyName || "Your Company"}
                userName={loginName}
                userZone={userZone}
                onSOSTrigger={() => { guardedSOSTrigger("hold", "employee-dashboard"); }}
                onCheckinTimer={() => { setSourceScreen("employee-dashboard"); navigate("checkin-timer"); }}
                onMedicalID={() => { setSourceScreen("employee-dashboard"); navigate("medical-id"); }}
                onEmergencyPacket={() => { setSourceScreen("employee-dashboard"); navigate("emergency-packet"); }}
                onEmergencyServices={() => { setSourceScreen("employee-dashboard"); navigate("emergency-services"); }}
                onEmergencyContacts={() => { setSourceScreen("employee-dashboard"); navigate("emergency-contacts"); }}
                onNotifications={() => { setSourceScreen("employee-dashboard"); navigate("notifications"); }}
                onIncidentHistory={() => { setSourceScreen("employee-dashboard"); navigate("incident-history"); }}
                timerActive={timerActive}
                onMissionTracker={() => { setSourceScreen("employee-dashboard"); navigate("mission-tracker"); }}
                onSafeWalk={() => {
                  if (!hasFeature("walkMe")) {
                    toast(lang === "ar"
                      ? "ميزة 'رافقني' تتطلب الخطة الأساسية — جرّب النخبة مجاناً لمدة 7 أيام"
                      : "Walk Me requires Basic plan — try Elite free for 7 days");
                    setSourceScreen("employee-dashboard");
                    navigate("subscription");
                    return;
                  }
                  setSourceScreen("employee-dashboard"); navigate("safe-walk");
                }}
                onLogout={async () => {
                  const { signOut } = await import("./api/supabase-client");
                  await signOut();
                  localStorage.removeItem("sosphere_individual_profile");
                  localStorage.removeItem("sosphere_tos_consent");
                  localStorage.removeItem("sosphere_gps_consent");
                  resetBiometricSession(); // re-arm gate for next user on this device
                  setUserPlan("free");
                  setLoginName("");
                  setLoginPhone("");
                  setLoginMode("individual");
                  setAuthUserId("");
                  screenHistoryRef.current = [];
                  navigate("welcome", -1);
                }}
              />
            )}

            {screen === "sos-emergency" && (
              <SosEmergency
                recordingEnabled={recordingEnabled}
                mode={sourceScreen === "employee-dashboard" ? "employee" : "individual"}
                isPremium={userPlan === "pro" || userPlan === "employee"}
                onNavigateToSubscription={() => { navigate("subscription"); }}
                userName={loginName}
                userId={authUserId || `EMP-${loginName.replace(/\s+/g, "")}`}
                // FIX FATAL-1: Read phone from stored profile, blood type from stored medical
                // Never send fake phone in emergency context
                userPhone={safeLoadJSON<{phone?:string}>("sosphere_individual_profile", {}).phone || ""}
                userBloodType={safeLoadJSON<{bloodType?:string}>("sosphere_medical_id", {}).bloodType || "Unknown"}
                userAvatar={(() => { try { return localStorage.getItem("sosphere_employee_avatar") || undefined; } catch { return undefined; } })()}
                userZone={companyMatchData?.zoneName || (companyName ? "Field Zone" : "Personal")}
                onEnd={(record) => {
                  // FIX 3: Reset SOS dedup lock AND rate limiter when SOS ends
                  sosInProgressRef.current = false;
                  sosLastTriggerRef.current = 0; // Reset rate limiter so user can re-trigger immediately
                  try { localStorage.removeItem("sosphere_active_sos"); } catch {}
                  if (sosSafetyTimerRef.current) { clearTimeout(sosSafetyTimerRef.current); sosSafetyTimerRef.current = null; }
                  setIncidentRecord(record);
                  // REAL DATA: Persist incident record to localStorage for history
                  try {
                    const existing = JSON.parse(localStorage.getItem("sosphere_incident_history") || "[]");
                    existing.unshift({
                      ...record,
                      startTime: record.startTime.toISOString(),
                      endTime: record.endTime ? record.endTime.toISOString() : new Date().toISOString(),
                    });
                    localStorage.setItem("sosphere_incident_history", JSON.stringify(existing.slice(0, 200)));
                  } catch (_) {}
                  // Phase 6: shadow-sync this completed incident to Supabase.
                  // Fire-and-forget — local storage remains the UI source of
                  // truth. No-op when Supabase isn't configured.
                  syncIncidentToSupabase(record).catch(() => {});
                  // Phase 3: Route to the post-emergency debrief first. The
                  // debrief screen has explicit exits to both the full report
                  // (emergency-record) and back to home, so the existing
                  // downstream screens remain accessible.
                  navigate("post-emergency-debrief");
                }}
                onCancel={() => { sosInProgressRef.current = false; sosLastTriggerRef.current = 0; try { localStorage.removeItem("sosphere_active_sos"); } catch {} if (sosSafetyTimerRef.current) { clearTimeout(sosSafetyTimerRef.current); sosSafetyTimerRef.current = null; } navigate(sourceScreen, -1); }}
              />
            )}

            {screen === "post-emergency-debrief" && incidentRecord && (
              <PostEmergencyDebrief
                record={incidentRecord}
                isAr={lang === "ar"}
                onViewFullReport={() => navigate("emergency-record")}
                onGoHome={() => { screenHistoryRef.current = []; navigate(sourceScreen, -1); }}
                onNeedMoreHelp={() => {
                  // User reports they still need help — re-trigger SOS.
                  // Reset the rate limiter (it was meant to prevent accidental
                  // double-fires, not to block an explicit user request).
                  sosLastTriggerRef.current = 0;
                  sosInProgressRef.current = false;
                  guardedSOSTrigger("hold", sourceScreen as "individual-home" | "employee-dashboard");
                }}
              />
            )}

            {screen === "post-emergency-debrief" && !incidentRecord && (
              <EmergencyRecordFallback onBack={goBack} />
            )}

            {screen === "emergency-record" && incidentRecord && (
              <EmergencyResponseRecord
                record={incidentRecord}
                onBack={goBack}
              />
            )}

            {screen === "emergency-record" && !incidentRecord && (
              <EmergencyRecordFallback onBack={goBack} />
            )}

            {screen === "checkin-timer" && (
              <CheckinTimer
                userName={loginName}
                userZone={companyName ? "Zone B-7 � Sector 4" : "Personal"}
                onSOSTrigger={() => guardedSOSTrigger("hold")}
                onBack={goBack}
                onTimerStateChange={setTimerActive}
                lang={lang === "ar" ? "ar" : "en"}
              />
            )}

            {screen === "medical-id" && (
              <MedicalID
                onBack={goBack}
                userPlan={userPlan}
              />
            )}

            {screen === "subscription" && (
              <SubscriptionPlans
                onBack={goBack}
                currentPlan={userPlan}
                onUpgrade={(plan) => {
                  setUserPlan(plan);
                  setTimeout(() => navigate(sourceScreen, -1), 100);
                }}
              />
            )}

            {screen === "incident-history" && (
              <IncidentHistory
                onBack={goBack}
                userPlan={userPlan}
                onUpgrade={() => navigate("subscription")}
              />
            )}

            {screen === "emergency-packet" && (
              <EmergencyPacket
                onBack={goBack}
                userPlan={userPlan}
                userName={loginName}
                onUpgrade={() => navigate("subscription")}
              />
            )}

            {screen === "emergency-services" && (
              <EmergencyServices onBack={goBack} />
            )}

            {screen === "emergency-contacts" && (
              <EmergencyContacts
                onBack={goBack}
                userPlan={userPlan}
                onUpgrade={() => navigate("subscription")}
              />
            )}

            {screen === "notifications" && (
              <NotificationsCenter onBack={goBack} />
            )}

            {screen === "evacuation" && (
              <EvacuationScreen onBack={goBack} />
            )}

            {screen === "language" && (
              <LanguageScreen onBack={goBack} lang={lang} onChangeLang={handleLangChange} />
            )}

            {screen === "privacy" && (
              <PrivacyScreen onBack={goBack} />
            )}

            {screen === "connected-devices" && (
              <ConnectedDevicesScreen onBack={goBack} />
            )}

            {screen === "help" && (
              <HelpScreen onBack={goBack} />
            )}

            {screen === "elite-features" && (
              <EliteFeaturesScreen onBack={goBack} />
            )}

            {screen === "mission-tracker" && (
              <MissionTrackerScreen employeeId={`EMP-${loginName.replace(/\s+/g, "")}`} onBack={goBack} />
            )}

            {screen === "safe-walk" && (
              <SafeWalkMode
                emergencyContacts={safeWalkContacts}
                userName={loginName}
                userId={authUserId || `EMP-${loginName.replace(/\s+/g, "")}`}
                userZone={companyMatchData?.zoneName || (companyName ? "Field Zone" : "Personal")}
                onBack={goBack}
                onSOSTrigger={() => guardedSOSTrigger("hold")}
                isPro={userPlan === "pro" || userPlan === "employee"}
                onUpgrade={() => navigate("subscription")}
              />
            )}
          </div>
        </div>

      {/* Toast notifications for mobile screens */}
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: "rgba(10,18,32,0.95)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.9)",
            fontSize: 12,
            fontFamily: "'Outfit', sans-serif",
            backdropFilter: "blur(20px)",
          },
        }}
      />
    </div>
  );
}

