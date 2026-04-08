// ═══════════════════════════════════════════════════════════════
// SOSphere — Emergency Chat System
// ─────────────────────────────────────────────────────────────
// Quick pre-built + free-text messages during SOS emergencies
// Mobile (employee) ↔ Dashboard (admin) real-time via shared-store
// For situations where voice communication is impossible
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MessageCircle, Send, ChevronDown, ChevronUp, X,
  MapPin, Heart, Shield, AlertTriangle, Clock,
  CheckCircle, Mic, Volume2,
} from "lucide-react";
import { sendChatMessage, getChatMessages, getChatMessagesAsync, onChatMessage, type EmergencyChatMessage } from "./shared-store";

// ── Preset Messages ───────────────────────────────────────────
const EMPLOYEE_PRESETS = [
  { icon: "🆘", text: "I need help immediately", category: "urgent" },
  { icon: "🤕", text: "I'm injured and can't move", category: "medical" },
  { icon: "✅", text: "I'm OK but need assistance", category: "status" },
  { icon: "👤", text: "Someone is threatening me", category: "security" },
  { icon: "🏥", text: "I need medical attention now", category: "medical" },
  { icon: "📍", text: "I'm at my last known location", category: "location" },
  { icon: "🔥", text: "There's fire/smoke nearby", category: "hazard" },
  { icon: "⏳", text: "I can wait, not critical", category: "status" },
];

const ADMIN_PRESETS = [
  { icon: "🚑", text: "Help is on the way — stay calm" },
  { icon: "📍", text: "We can see your location — ETA 5 min" },
  { icon: "📞", text: "Emergency services have been contacted" },
  { icon: "👥", text: "Sending nearest team member to you" },
  { icon: "🏥", text: "Medical team dispatched" },
  { icon: "✅", text: "Acknowledged — we're handling this" },
  { icon: "⏱️", text: "Stay where you are — rescue team approaching" },
  { icon: "🔒", text: "Security team alerted and responding" },
];

// ── Mobile Emergency Chat (Employee Side) ─────────────────────
export function MobileEmergencyChat({
  emergencyId,
  employeeName,
  isVisible,
  onClose,
  onToggle,
  collapsed = true,
}: {
  emergencyId: string;
  employeeName: string;
  isVisible: boolean;
  onClose: () => void;
  onToggle: () => void;
  collapsed?: boolean;
}) {
  const [messages, setMessages] = useState<EmergencyChatMessage[]>([]);
  const [customText, setCustomText] = useState("");
  const [showPresets, setShowPresets] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [newMsgFlash, setNewMsgFlash] = useState(false);

  // Load initial messages (Supabase first, then localStorage fallback)
  useEffect(() => {
    if (emergencyId) {
      setMessages(getChatMessages(emergencyId)); // instant local
      getChatMessagesAsync(emergencyId).then(setMessages); // async Supabase
    }
  }, [emergencyId]);

  // Listen for new messages (localStorage + Supabase Realtime)
  useEffect(() => {
    if (!emergencyId) return;
    const unsub = onChatMessage(emergencyId, (msgs) => {
      setMessages(msgs);
      setNewMsgFlash(true);
      setTimeout(() => setNewMsgFlash(false), 1500);
    });
    return unsub;
  }, [emergencyId]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSendPreset = (text: string) => {
    sendChatMessage({
      emergencyId,
      sender: "employee",
      senderName: employeeName,
      message: text,
      isPreset: true,
      type: "text",
    });
    // Immediately update local
    setMessages(getChatMessages(emergencyId));
  };

  const handleSendCustom = () => {
    if (!customText.trim()) return;
    sendChatMessage({
      emergencyId,
      sender: "employee",
      senderName: employeeName,
      message: customText.trim(),
      isPreset: false,
      type: "text",
    });
    setCustomText("");
    setMessages(getChatMessages(emergencyId));
  };

  const adminMsgCount = messages.filter(m => m.sender === "admin").length;

  if (!isVisible) return null;

  return (
    <motion.div
      initial={{ y: 200, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 200, opacity: 0 }}
      className="absolute bottom-0 left-0 right-0 z-50"
      style={{
        background: "linear-gradient(180deg, rgba(10,18,32,0.97), #0A1220)",
        borderTop: "1px solid rgba(0,200,224,0.15)",
        borderRadius: "20px 20px 0 0",
        maxHeight: collapsed ? 52 : "65%",
        transition: "max-height 0.3s ease",
      }}
    >
      {/* Header (always visible) */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3"
        style={{ borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <MessageCircle className="size-4" style={{ color: "#00C8E0" }} />
            {adminMsgCount > 0 && (
              <motion.div
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute -top-1 -right-1 size-2 rounded-full"
                style={{ background: "#00C853" }}
              />
            )}
          </div>
          <span className="text-white" style={{ fontSize: 12, fontWeight: 700 }}>
            Emergency Chat
          </span>
          {messages.length > 0 && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              {messages.length} messages
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {newMsgFlash && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{ fontSize: 9, color: "#00C853", fontWeight: 700 }}
            >
              NEW
            </motion.span>
          )}
          {collapsed ? (
            <ChevronUp className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
          ) : (
            <ChevronDown className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
          )}
        </div>
      </button>

      {!collapsed && (
        <>
          {/* Messages area */}
          <div
            ref={scrollRef}
            className="overflow-y-auto px-3 py-2"
            style={{ maxHeight: 180, scrollbarWidth: "none" }}
          >
            {messages.length === 0 ? (
              <div className="text-center py-4">
                <MessageCircle className="size-6 mx-auto mb-2" style={{ color: "rgba(255,255,255,0.1)" }} />
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                  Tap a quick message below to communicate
                </p>
              </div>
            ) : (
              messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`flex mb-2 ${msg.sender === "employee" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className="max-w-[80%] px-3 py-2 rounded-2xl"
                    style={{
                      background: msg.sender === "employee"
                        ? "linear-gradient(135deg, rgba(0,200,224,0.15), rgba(0,200,224,0.08))"
                        : "linear-gradient(135deg, rgba(0,200,100,0.15), rgba(0,200,100,0.08))",
                      border: `1px solid ${msg.sender === "employee" ? "rgba(0,200,224,0.2)" : "rgba(0,200,100,0.2)"}`,
                      borderBottomRightRadius: msg.sender === "employee" ? 6 : 16,
                      borderBottomLeftRadius: msg.sender === "admin" ? 6 : 16,
                    }}
                  >
                    <p style={{
                      fontSize: 8,
                      color: msg.sender === "employee" ? "rgba(0,200,224,0.5)" : "rgba(0,200,100,0.5)",
                      fontWeight: 600,
                      marginBottom: 2,
                    }}>
                      {msg.sender === "employee" ? "You" : msg.senderName}
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>
                      {msg.message}
                    </p>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", textAlign: "right", marginTop: 2 }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </motion.div>
              ))
            )}
          </div>

          {/* Quick presets */}
          <div className="px-3 pb-2">
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="flex items-center gap-1 mb-1.5"
            >
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>
                Quick Messages
              </span>
              {showPresets ? (
                <ChevronUp className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
              ) : (
                <ChevronDown className="size-3" style={{ color: "rgba(255,255,255,0.2)" }} />
              )}
            </button>

            {showPresets && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {EMPLOYEE_PRESETS.map((preset, i) => (
                  <motion.button
                    key={i}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleSendPreset(`${preset.icon} ${preset.text}`)}
                    className="px-2.5 py-1.5 rounded-lg"
                    style={{
                      background: preset.category === "urgent"
                        ? "rgba(255,45,85,0.08)"
                        : preset.category === "medical"
                        ? "rgba(255,150,0,0.08)"
                        : "rgba(255,255,255,0.04)",
                      border: `1px solid ${
                        preset.category === "urgent"
                          ? "rgba(255,45,85,0.15)"
                          : preset.category === "medical"
                          ? "rgba(255,150,0,0.15)"
                          : "rgba(255,255,255,0.06)"
                      }`,
                    }}
                  >
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
                      {preset.icon} {preset.text}
                    </span>
                  </motion.button>
                ))}
              </div>
            )}

            {/* Custom message input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendCustom()}
                placeholder="Type a message..."
                maxLength={500}
                className="flex-1 px-3 py-2 rounded-xl outline-none text-white"
                style={{
                  fontSize: 12,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              />
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleSendCustom}
                className="size-9 rounded-xl flex items-center justify-center"
                style={{
                  background: customText.trim()
                    ? "linear-gradient(135deg, #00C8E0, #0088A0)"
                    : "rgba(255,255,255,0.04)",
                  border: `1px solid ${customText.trim() ? "rgba(0,200,224,0.3)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                <Send className="size-4" style={{ color: customText.trim() ? "white" : "rgba(255,255,255,0.2)" }} />
              </motion.button>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ── Dashboard Emergency Chat (Admin Side) ─────────────────────
export function DashboardEmergencyChat({
  emergencyId,
  employeeName,
  isOpen,
  onClose,
}: {
  emergencyId: string;
  employeeName: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<EmergencyChatMessage[]>([]);
  const [customText, setCustomText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (emergencyId) {
      setMessages(getChatMessages(emergencyId)); // instant local
      getChatMessagesAsync(emergencyId).then(setMessages); // async Supabase
    }
  }, [emergencyId]);

  useEffect(() => {
    if (!emergencyId) return;
    const unsub = onChatMessage(emergencyId, (msgs) => {
      setMessages(msgs);
      setUnread(prev => prev + 1);
    });
    return unsub;
  }, [emergencyId]);

  useEffect(() => {
    if (isOpen) setUnread(0);
  }, [isOpen, messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSendPreset = (text: string) => {
    sendChatMessage({
      emergencyId,
      sender: "admin",
      senderName: "Admin",
      message: text,
      isPreset: true,
      type: "text",
    });
    setMessages(getChatMessages(emergencyId));
  };

  const handleSendCustom = () => {
    if (!customText.trim()) return;
    sendChatMessage({
      emergencyId,
      sender: "admin",
      senderName: "Admin",
      message: customText.trim(),
      isPreset: false,
      type: "text",
    });
    setCustomText("");
    setMessages(getChatMessages(emergencyId));
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed right-4 fixed-bottom-safe z-[200] flex flex-col"
      style={{
        width: 380,
        height: 520,
        background: "linear-gradient(180deg, #0A1220, #05070E)",
        border: "1px solid rgba(0,200,224,0.12)",
        borderRadius: 20,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(0,200,224,0.05)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          background: "linear-gradient(180deg, rgba(0,200,224,0.04), transparent)",
        }}
      >
        <div className="size-8 rounded-full flex items-center justify-center"
          style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
          <MessageCircle className="size-4" style={{ color: "#00C8E0" }} />
        </div>
        <div className="flex-1">
          <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>
            Emergency Chat
          </p>
          <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
            with {employeeName}
          </p>
        </div>
        <button onClick={onClose} className="size-7 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <X className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "none" }}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="size-12 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.08)" }}>
              <MessageCircle className="size-6" style={{ color: "rgba(0,200,224,0.3)" }} />
            </div>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", textAlign: "center" }}>
              No messages yet. Use quick responses<br />to communicate with the employee.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex mb-3 ${msg.sender === "admin" ? "justify-end" : "justify-start"}`}
            >
              <div
                className="max-w-[75%] px-3.5 py-2.5 rounded-2xl"
                style={{
                  background: msg.sender === "admin"
                    ? "linear-gradient(135deg, rgba(0,200,224,0.12), rgba(0,200,224,0.06))"
                    : "linear-gradient(135deg, rgba(255,45,85,0.08), rgba(255,45,85,0.04))",
                  border: `1px solid ${msg.sender === "admin" ? "rgba(0,200,224,0.15)" : "rgba(255,45,85,0.12)"}`,
                  borderBottomRightRadius: msg.sender === "admin" ? 6 : 16,
                  borderBottomLeftRadius: msg.sender === "employee" ? 6 : 16,
                }}
              >
                <p style={{
                  fontSize: 9,
                  color: msg.sender === "admin" ? "rgba(0,200,224,0.5)" : "rgba(255,45,85,0.5)",
                  fontWeight: 600,
                  marginBottom: 3,
                }}>
                  {msg.sender === "admin" ? "You (Admin)" : msg.senderName}
                </p>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
                  {msg.message}
                </p>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", textAlign: "right", marginTop: 3 }}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </p>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Admin Quick Responses */}
      <div className="px-3 pb-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <p className="py-2" style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontWeight: 600 }}>
          QUICK RESPONSES
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {ADMIN_PRESETS.map((preset, i) => (
            <motion.button
              key={i}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleSendPreset(`${preset.icon} ${preset.text}`)}
              className="px-2.5 py-1.5 rounded-lg"
              style={{
                background: "rgba(0,200,224,0.04)",
                border: "1px solid rgba(0,200,224,0.08)",
              }}
            >
              <span style={{ fontSize: 10, color: "rgba(0,200,224,0.7)" }}>
                {preset.icon} {preset.text}
              </span>
            </motion.button>
          ))}
        </div>

        {/* Custom input */}
        <div className="flex gap-2 pb-1">
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendCustom()}
            placeholder="Type a response..."
            maxLength={500}
            className="flex-1 px-3 py-2.5 rounded-xl outline-none text-white"
            style={{
              fontSize: 12,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={handleSendCustom}
            className="size-10 rounded-xl flex items-center justify-center"
            style={{
              background: customText.trim()
                ? "linear-gradient(135deg, #00C8E0, #0088A0)"
                : "rgba(255,255,255,0.04)",
            }}
          >
            <Send className="size-4" style={{ color: customText.trim() ? "white" : "rgba(255,255,255,0.2)" }} />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Chat Badge Button (for SOS Popup) ─────────────────────────
export function ChatBadgeButton({
  emergencyId,
  onClick,
}: {
  emergencyId: string;
  onClick: () => void;
}) {
  const [msgCount, setMsgCount] = useState(0);

  useEffect(() => {
    setMsgCount(getChatMessages(emergencyId).length);
    const unsub = onChatMessage(emergencyId, (msgs) => setMsgCount(msgs.length));
    return unsub;
  }, [emergencyId]);

  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
      style={{
        background: "rgba(0,200,224,0.06)",
        border: "1px solid rgba(0,200,224,0.12)",
      }}
    >
      <MessageCircle className="size-3.5" style={{ color: "#00C8E0" }} />
      <span style={{ fontSize: 10, color: "#00C8E0", fontWeight: 600 }}>Chat</span>
      {msgCount > 0 && (
        <motion.span
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute -top-1.5 -right-1.5 px-1 rounded-full"
          style={{
            fontSize: 8, fontWeight: 800, color: "white",
            background: "#00C853", minWidth: 14, textAlign: "center",
          }}
        >
          {msgCount}
        </motion.span>
      )}
    </motion.button>
  );
}