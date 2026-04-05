// ═══════════════════════════════════════════════════════════════
// SOSphere — Command Center Page
// ═══════════════════════════════════════════════════════════════
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Radio, Send, Users, Shield, HeartPulse, Megaphone, CheckCircle2, Clock, AlertTriangle, Eye } from "lucide-react";

interface CommandCenterProps {
  t: (key: string) => string;
}

export function CommandCenterPage({ t }: CommandCenterProps) {
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [sentMessages, setSentMessages] = useState<string[]>([]);
  const [activeChannel, setActiveChannel] = useState("field");

  const channels = [
    { id: "field", icon: Radio, label: t("cmd.ch.field"), members: 12, online: 8, color: "#00C8E0" },
    { id: "safety", icon: Shield, label: t("cmd.ch.safety"), members: 5, online: 4, color: "#00C853" },
    { id: "security", icon: Eye, label: t("cmd.ch.security"), members: 8, online: 6, color: "#FF9500" },
    { id: "medical", icon: HeartPulse, label: t("cmd.ch.medical"), members: 3, online: 2, color: "#FF2D55" },
  ];

  const recentCommands = [
    { text: t("cmd.c1"), time: "2m", severity: "low" as const, icon: CheckCircle2 },
    { text: t("cmd.c2"), time: "18m", severity: "critical" as const, icon: AlertTriangle },
    { text: t("cmd.c3"), time: "45m", severity: "medium" as const, icon: Clock },
  ];

  const responseTeams = [
    { name: "Alpha Team", status: t("cmd.dispatched"), color: "#FF2D55", members: 4 },
    { name: "Bravo Team", status: t("cmd.standby"), color: "#FF9500", members: 3 },
    { name: "Charlie Team", status: t("cmd.ready"), color: "#00C853", members: 5 },
  ];

  const handleSendBroadcast = () => {
    if (!broadcastMsg.trim()) return;
    setSentMessages(prev => [broadcastMsg, ...prev]);
    setBroadcastMsg("");
  };

  return (
    <div className="px-4 pt-4 space-y-4 pb-4">
      {/* Live Operations Status */}
      <div className="p-3 rounded-2xl" style={{
        background: "linear-gradient(135deg, rgba(0,200,224,0.06) 0%, rgba(0,200,224,0.02) 100%)",
        border: "1px solid rgba(0,200,224,0.1)",
      }}>
        <div className="flex items-center gap-2 mb-3">
          <motion.div
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="size-2 rounded-full" style={{ background: "#00C853" }}
          />
          <span style={{ fontSize: 10, fontWeight: 700, color: "#00C853", letterSpacing: "1px" }}>
            {t("cmd.liveOps")}
          </span>
          <span className="ml-auto px-2 py-0.5 rounded-md" style={{
            fontSize: 9, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.1)",
          }}>{t("cmd.status")}: {t("cmd.online")}</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 rounded-lg" style={{ background: "rgba(0,200,224,0.06)" }}>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#00C8E0" }}>28</p>
            <p style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>{t("cmd.online").toUpperCase()}</p>
          </div>
          <div className="text-center p-2 rounded-lg" style={{ background: "rgba(255,45,85,0.06)" }}>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#FF2D55" }}>2</p>
            <p style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>{t("s.alerts").toUpperCase()}</p>
          </div>
          <div className="text-center p-2 rounded-lg" style={{ background: "rgba(0,200,96,0.06)" }}>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#00C853" }}>3</p>
            <p style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontWeight: 500 }}>{t("cmd.teams").toUpperCase()}</p>
          </div>
        </div>
      </div>

      {/* Broadcast Message */}
      <div>
        <p className="mb-2" style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
          {t("cmd.broadcast")}
        </p>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: "rgba(255,255,255,0.02)" }}>
            <Megaphone className="size-4 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
            <input
              value={broadcastMsg}
              onChange={e => setBroadcastMsg(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSendBroadcast()}
              placeholder={t("cmd.msgPlaceholder")}
              className="flex-1 bg-transparent outline-none text-white placeholder:text-white/15"
              style={{ fontSize: 12 }}
            />
            <button onClick={handleSendBroadcast}
              className="size-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{
                background: broadcastMsg.trim() ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${broadcastMsg.trim() ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.05)"}`,
              }}>
              <Send className="size-3.5" style={{ color: broadcastMsg.trim() ? "#00C8E0" : "rgba(255,255,255,0.15)" }} />
            </button>
          </div>

          {/* Sent messages */}
          <AnimatePresence>
            {sentMessages.slice(0, 2).map((msg, i) => (
              <motion.div
                key={`${msg}-${i}`}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                className="flex items-center gap-2 px-3 py-2"
                style={{ borderTop: "1px solid rgba(255,255,255,0.03)", background: "rgba(0,200,224,0.03)" }}
              >
                <CheckCircle2 className="size-3 flex-shrink-0" style={{ color: "#00C853" }} />
                <span className="flex-1 truncate" style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{msg}</span>
                <span style={{ fontSize: 8, color: "rgba(255,255,255,0.15)" }}>Just now</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Team Channels */}
      <div>
        <p className="mb-2" style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
          {t("cmd.channels")}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {channels.map(ch => (
            <button key={ch.id} onClick={() => setActiveChannel(ch.id)}
              className="p-2.5 rounded-xl text-left"
              style={{
                background: activeChannel === ch.id ? `${ch.color}0A` : "rgba(255,255,255,0.02)",
                border: `1px solid ${activeChannel === ch.id ? `${ch.color}20` : "rgba(255,255,255,0.04)"}`,
              }}>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="size-6 rounded-md flex items-center justify-center" style={{ background: `${ch.color}15` }}>
                  <ch.icon className="size-3" style={{ color: ch.color }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: activeChannel === ch.id ? ch.color : "rgba(255,255,255,0.6)" }}>
                  {ch.label}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <div className="size-1.5 rounded-full" style={{ background: "#00C853" }} />
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                  {ch.online}/{ch.members}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Response Teams */}
      <div>
        <p className="mb-2" style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
          {t("cmd.teams")}
        </p>
        <div className="space-y-1.5">
          {responseTeams.map(team => (
            <div key={team.name} className="flex items-center gap-2.5 p-2.5 rounded-xl"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="size-8 rounded-lg flex items-center justify-center" style={{ background: `${team.color}12` }}>
                <Users className="size-4" style={{ color: team.color }} />
              </div>
              <div className="flex-1">
                <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{team.name}</p>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{team.members} members</p>
              </div>
              <span className="px-2 py-0.5 rounded-md" style={{
                fontSize: 9, fontWeight: 600, color: team.color, background: `${team.color}12`,
              }}>{team.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Commands */}
      <div>
        <p className="mb-2" style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>
          {t("cmd.recent")}
        </p>
        <div className="space-y-1.5">
          {recentCommands.map((cmd, i) => {
            const colors = { critical: "#FF2D55", medium: "#FF9500", low: "#00C853" };
            const c = colors[cmd.severity];
            return (
              <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-xl"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <div className="size-6 rounded-md flex items-center justify-center mt-0.5" style={{ background: `${c}12` }}>
                  <cmd.icon className="size-3" style={{ color: c }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.4 }}>{cmd.text}</p>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>{cmd.time} ago</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
