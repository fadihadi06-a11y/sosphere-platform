import { useState } from "react";
import { motion } from "motion/react";
import { Home, Users, Map, User } from "lucide-react";
import { IndividualHome } from "./individual-home";
import { ProfileSettings } from "./profile-settings";
import { FamilyCircle } from "./family-circle";
import { MapScreen } from "./map-screen";

function getTabs(t: (k: string) => string) {
  return [
    { id: "home", icon: Home, label: t("app.home") },
    { id: "family", icon: Users, label: t("app.family") },
    { id: "map", icon: Map, label: t("app.map") },
    { id: "profile", icon: User, label: t("app.profile") },
  ];
}

interface IndividualLayoutProps {
  onSOSTrigger: () => void;
  onRecordingChange?: (enabled: boolean) => void;
  onCheckinTimer?: () => void;
  timerActive?: boolean;
  userName: string;
  userPlan: "free" | "pro" | "employee";
  companyName?: string;
  t?: (key: string) => string;
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
  onNavigateToSafeWalk?: () => void;
  onLogout?: () => void;
}

export function IndividualLayout({
  onSOSTrigger, onRecordingChange, onCheckinTimer, timerActive,
  userName, userPlan, companyName, onNavigateToMedicalID, onNavigateToSubscription,
  onNavigateToIncidentHistory, onNavigateToEmergencyPacket, onNavigateToEmergencyServices,
  onNavigateToEmergencyContacts, onNavigateToNotifications,
  onNavigateToLanguage, onNavigateToPrivacy, onNavigateToDevices, onNavigateToHelp,
  onNavigateToSafeWalk,
  onLogout,
  t: tProp,
}: IndividualLayoutProps) {
  const t = tProp || ((k: string) => k);
  const tabs = getTabs(t);
  const [activeTab, setActiveTab] = useState("home");

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
          onLiveLocation={() => setActiveTab("map")}
          onNotifications={onNavigateToNotifications}
          onSafeWalk={onNavigateToSafeWalk}
          t={t}
        />
      )}
      {activeTab === "family" && <FamilyCircle />}
      {activeTab === "map" && <MapScreen />}
      {activeTab === "profile" && (
        <ProfileSettings
          userName={userName}
          userPlan={userPlan}
          companyName={companyName}
          onNavigate={handleProfileNavigate}
          onLogout={() => onLogout?.()}
          t={t}
        />
      )}

      {/* Bottom Nav */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20"
        style={{
          background: "linear-gradient(180deg, transparent 0%, rgba(5,7,14,0.97) 35%)",
        }}
      >
        <div className="flex items-center justify-around px-4 pb-8 pt-3">
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
}