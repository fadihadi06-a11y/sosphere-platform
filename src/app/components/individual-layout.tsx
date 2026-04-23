import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { motion } from "motion/react";
import { Home, Users, Map, User } from "lucide-react";
import { IndividualHome } from "./individual-home";
import { ProfileSettings } from "./profile-settings";
import { FamilyCircle } from "./family-circle";
import { MapScreen } from "./map-screen";

/**
 * Build the tab list with translated labels.
 *
 * Accepts a translator `t` from the parent. The identity-fallback translator
 * used by the component (`(k) => k`) returns the key unchanged when no real
 * translator is provided, so we detect that case explicitly and fall back to
 * the hard-coded English label. Calling this from inside the component (not
 * at module scope) also means tabs re-render correctly on language change.
 */
function getTabs(t: (k: string) => string) {
  const tr = (key: string, fallback: string) => {
    const v = t(key);
    // `t` might echo the key back (identity fallback) — detect and use English.
    return !v || v === key ? fallback : v;
  };
  return [
    { id: "home",    icon: Home,  label: tr("nav.home",    "Home")    },
    { id: "family",  icon: Users, label: tr("nav.family",  "Family")  },
    { id: "map",     icon: Map,   label: tr("nav.map",     "Map")     },
    { id: "profile", icon: User,  label: tr("nav.profile", "Profile") },
  ];
}

export interface IndividualLayoutHandle {
  /** Returns true if it handled the back (went to home tab). Returns false if already on home. */
  handleBack: () => boolean;
}

interface IndividualLayoutProps {
  onSOSTrigger: () => void;
  onRecordingChange?: (enabled: boolean) => void;
  onCheckinTimer?: () => void;
  timerActive?: boolean;
  userName: string;
  userPlan: "free" | "pro" | "employee";
  companyName?: string;
  onNavigateToMedicalID?: () => void;
  onNavigateToSubscription?: () => void;
  onNavigateToIncidentHistory?: () => void;
  onNavigateToEmergencyPacket?: () => void;
  onNavigateToEmergencyServices?: () => void;
  onNavigateToEmergencyContacts?: () => void;
  onNavigateToNotifications?: () => void;
  onNavigateToLanguage?: () => void;
  onNavigateToPrivacy?: () => void;
  onNavigateToDevices?: () => void;
  onNavigateToHelp?: () => void;
  onNavigateToEliteFeatures?: () => void;
  onNavigateToSafeWalk?: () => void;
  onLogout?: () => void;
  /** Optional translator function. Falls back to English keys if absent. */
  t?: (key: string) => string;
  /** Notified when active tab changes — lets parent hide overlays like the
      floating VoiceSOSWidget on non-Home tabs. */
  onActiveTabChange?: (tab: string) => void;
}

export const IndividualLayout = forwardRef<IndividualLayoutHandle, IndividualLayoutProps>(function IndividualLayout({
  onSOSTrigger, onRecordingChange, onCheckinTimer, timerActive,
  userName, userPlan, companyName, onNavigateToMedicalID, onNavigateToSubscription,
  onNavigateToIncidentHistory, onNavigateToEmergencyPacket, onNavigateToEmergencyServices,
  onNavigateToEmergencyContacts, onNavigateToNotifications,
  onNavigateToLanguage, onNavigateToPrivacy, onNavigateToDevices, onNavigateToHelp,
  onNavigateToEliteFeatures,
  onNavigateToSafeWalk,
  onLogout,
  t: tProp,
  onActiveTabChange,
}, ref) {
  const t = tProp || ((k: string) => k);
  const tabs = getTabs(t);
  const [activeTab, setActiveTabRaw] = useState("home");
  const setActiveTab = (tab: string) => {
    setActiveTabRaw(tab);
    onActiveTabChange?.(tab);
  };

  // Expose handleBack to parent (mobile-app) for Android back button support
  useImperativeHandle(ref, () => ({
    handleBack: () => {
      if (activeTab !== "home") {
        setActiveTab("home");
        return true; // handled — went back to home tab
      }
      return false; // already on home — let parent handle (exit app)
    },
  }), [activeTab]);

  const handleProfileNavigate = (screen: string) => {
    if (screen === "medical-id") onNavigateToMedicalID?.();
    if (screen === "subscription") onNavigateToSubscription?.();
    if (screen === "incident-history") onNavigateToIncidentHistory?.();
    if (screen === "emergency-packet") onNavigateToEmergencyPacket?.();
    if (screen === "emergency-services") onNavigateToEmergencyServices?.();
    if (screen === "emergency-contacts") onNavigateToEmergencyContacts?.();
    if (screen === "language") onNavigateToLanguage?.();
    if (screen === "privacy") onNavigateToPrivacy?.();
    if (screen === "connected-devices") onNavigateToDevices?.();
    if (screen === "help") onNavigateToHelp?.();
    if (screen === "elite-features") onNavigateToEliteFeatures?.();
  };

  return (
    <div className="relative flex flex-col h-full">
      {/* Tab content */}
      {activeTab === "home" && (
        <IndividualHome
          userName={userName}
          onSOSTrigger={onSOSTrigger}
          onRecordingChange={onRecordingChange}
          onCheckinTimer={onCheckinTimer}
          onMedicalID={onNavigateToMedicalID}
          onFamilyCircle={() => setActiveTab("family")}
          // AUDIT-FIX (2026-04-18): "Add Contact" + "View All" buttons
          // on home now open the real Emergency Contacts screen (with
          // country picker + add/edit/delete CRUD) instead of the
          // Family Circle invite flow.
          onEmergencyContacts={onNavigateToEmergencyContacts}
          onLiveLocation={() => setActiveTab("map")}
          onNotifications={onNavigateToNotifications}
          onSafeWalk={onNavigateToSafeWalk}
        />
      )}
      {activeTab === "family" && <FamilyCircle />}
      {activeTab === "map" && <MapScreen onBack={() => setActiveTab("home")} />}
      {activeTab === "profile" && (
        <ProfileSettings
          userName={userName}
          userPlan={userPlan}
          companyName={companyName}
          onNavigate={handleProfileNavigate}
          onLogout={() => onLogout?.()}
        />
      )}

      {/* Bottom Nav */}
      {/* AUDIT-FIX (2026-04-21): solid background + top hairline
          replaces 3-stop gradient fade that banded on Android OLED. */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20"
        style={{
          background: "#05070E",
          boxShadow: "0 -1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <div
          className="flex items-center justify-around px-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)", paddingTop: 12 }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative flex flex-col items-center gap-[5px] px-5 py-1.5"
              >
                <div className="relative">
                  <tab.icon
                    className="size-[20px] transition-colors duration-300"
                    style={{ color: isActive ? "#00C8E0" : "rgba(255,255,255,0.18)" }}
                  />
                  {isActive && (
                    <motion.div
                      layoutId="indNavGlow"
                      className="absolute -inset-3 rounded-full"
                      style={{
                        background: "rgba(0,200,224,0.1)",
                        filter: "blur(8px)",
                      }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  {/* Timer active indicator */}
                  {tab.id === "home" && timerActive && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute -top-1 -right-1.5"
                    >
                      <motion.div
                        animate={{ opacity: [1, 0.4, 1] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                        className="size-[7px] rounded-full"
                        style={{
                          background: "#FF9500",
                          boxShadow: "0 0 6px rgba(255,150,0,0.5)",
                          border: "1.5px solid #05070E",
                        }}
                      />
                    </motion.div>
                  )}
                </div>
                <span
                  className="transition-colors duration-300"
                  style={{
                    fontSize: "10px",
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "#00C8E0" : "rgba(255,255,255,0.18)",
                    letterSpacing: "0.3px",
                  }}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});