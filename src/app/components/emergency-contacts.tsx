// ═══════════════════════════════════════════════════════════════
// SOSphere — Emergency Contacts (Tier System)
// 3 types: Full Contact | Lite Contact | Ghost Contact
// + Safety Link for non-app contacts
// + Emergency Ripple visualization
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ChevronLeft, Plus, Phone, Trash2, Edit3, Star,
  User, Heart, Users, Shield, X, Check, AlertTriangle,
  Link, Smartphone, SmartphoneNfc, Send, Copy, Share2,
  Radio, Eye, EyeOff, MapPin, Clock, Battery,
  Wifi, WifiOff, Zap, Crown, ChevronRight, ChevronDown,
  CheckCircle2, XCircle, MessageSquare, Globe, Lock,
  UserPlus, Signal, Timer, Locate, Navigation,
} from "lucide-react";
import { toast } from "sonner";
import {
  type SafetyContact, type ContactType, type ContactPlan,
  CONTACT_TYPE_CONFIG, PLAN_LIMITS, EMERGENCY_RIPPLE_WAVES,
  getSafetyContacts, saveSafetyContacts, seedDemoContacts,
  generateSafetyLink, determineContactType,
  type RippleWave,
} from "./contact-tier-system";

// ── Helpers ───────────────────────────────────────────────────

function fmtTime(ts: number): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ── Relations Config ──────────────────────────────────────────

const RELATIONS = ["Spouse", "Parent", "Sibling", "Child", "Friend", "Colleague", "Other"];

const relationIcons: Record<string, typeof User> = {
  Spouse: Heart,
  Parent: Users,
  Sibling: Users,
  Child: User,
  Friend: User,
  Colleague: Shield,
  Other: User,
};

const typeIcons: Record<ContactType, typeof User> = {
  full: Shield,
  lite: Smartphone,
  ghost: Link,
};

// ═══════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════

interface EmergencyContactsProps {
  onBack: () => void;
  userPlan: "free" | "pro" | "employee";
  onUpgrade?: () => void;
}

export function EmergencyContacts({ onBack, userPlan, onUpgrade }: EmergencyContactsProps) {
  const [contacts, setContacts] = useState<SafetyContact[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState<SafetyContact | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showRipple, setShowRipple] = useState(false);
  const [showSafetyLink, setShowSafetyLink] = useState<SafetyContact | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | ContactType>("all");
  const [linkCopied, setLinkCopied] = useState(false);

  const isPro = userPlan === "pro" || userPlan === "employee";
  const limits = PLAN_LIMITS[isPro ? "pro" : "free"];

  // Load contacts
  // FIX 2026-04-23: removed seedDemoContacts() call. It injected 3 fake
  // contacts (Sarah Johnson, Omar Johnson, Khalid) on first visit — the same
  // pattern as MOCK_INCIDENTS and medical-id defaults. New users now see a
  // clean empty state and add their real contacts via the + button.
  useEffect(() => {
    setContacts(getSafetyContacts());
  }, []);

  // Stats
  const stats = useMemo(() => ({
    total: contacts.length,
    full: contacts.filter(c => c.type === "full").length,
    lite: contacts.filter(c => c.type === "lite").length,
    ghost: contacts.filter(c => c.type === "ghost").length,
    online: contacts.filter(c => c.isOnline).length,
    tracking: contacts.filter(c => c.locationSharingEnabled).length,
  }), [contacts]);

  // Filtered contacts
  const filtered = activeFilter === "all" 
    ? contacts 
    : contacts.filter(c => c.type === activeFilter);

  // Free plan limits
  const canAddMore = isPro || contacts.length < (limits.maxWatchTargets === Infinity ? 999 : limits.maxWatchTargets + limits.maxGhostContacts + limits.maxBeaconAllowances);

  const deleteContact = (id: string) => {
    const updated = contacts.filter(c => c.id !== id);
    setContacts(updated);
    saveSafetyContacts(updated);
    setDeleteConfirm(null);
    toast.success("Contact removed");
  };

  const toggleFavorite = (id: string) => {
    const updated = contacts.map(c => c.id === id ? { ...c, isFavorite: !c.isFavorite } : c);
    setContacts(updated);
    saveSafetyContacts(updated);
  };

  const toggleTracking = (id: string) => {
    const updated = contacts.map(c => c.id === id ? { ...c, locationSharingEnabled: !c.locationSharingEnabled } : c);
    setContacts(updated);
    saveSafetyContacts(updated);
    const contact = updated.find(c => c.id === id);
    toast.success(contact?.locationSharingEnabled ? "Tracking enabled" : "Tracking paused");
  };

  const handleCopyLink = (contact: SafetyContact) => {
    const link = contact.safetyLinkId 
      ? `https://sosphere.app/safety/${contact.name.toLowerCase().replace(/\s+/g, "-")}/${contact.safetyLinkId}`
      : generateSafetyLink(contact.id, contact.name).url;
    navigator.clipboard?.writeText(link);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
    toast.success("Safety Link copied!");
  };

  const resendInvite = (contact: SafetyContact) => {
    toast.success(`Invite sent to ${contact.name}`, { description: `SMS sent to ${contact.phone}` });
  };

  return (
    <div className="relative flex flex-col h-full">
      {/* Ambient */}
      <div className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[500px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0.03) 0%, transparent 70%)" }}
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: "none" }}>
        <div className="pt-14 pb-8">
          {/* ── Header ───────────────────────────────────── */}
          <div className="flex items-center justify-between px-5 mb-4">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="size-9 rounded-[12px] flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <ChevronLeft className="size-[18px]" style={{ color: "rgba(255,255,255,0.5)" }} />
              </button>
              <div>
                <h1 className="text-white" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>Safety Contacts</h1>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                  {stats.total} contacts · {stats.online} online · {stats.tracking} tracking
                </p>
              </div>
            </div>
          </div>

          {/* ── Contact Type Stats ────────────────────────── */}
          <div className="px-5 mb-4">
            <div className="grid grid-cols-3 gap-2">
              {(["full", "lite", "ghost"] as const).map(type => {
                const cfg = CONTACT_TYPE_CONFIG[type];
                const TypeIcon = typeIcons[type];
                const count = stats[type];
                return (
                  <button
                    key={type}
                    onClick={() => setActiveFilter(activeFilter === type ? "all" : type)}
                    className="p-2.5 rounded-xl text-center relative overflow-hidden"
                    style={{
                      background: activeFilter === type ? `${cfg.color}0A` : "rgba(255,255,255,0.02)",
                      border: `1px solid ${activeFilter === type ? `${cfg.color}20` : "rgba(255,255,255,0.04)"}`,
                    }}
                  >
                    <TypeIcon className="size-4 mx-auto mb-1" style={{ color: cfg.color }} />
                    <p className="text-white" style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>{count}</p>
                    <p style={{ fontSize: 9, color: `${cfg.color}90`, fontWeight: 600, marginTop: 2 }}>{cfg.label}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Emergency Ripple Preview ──────────────────── */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="px-5 mb-4">
            <button
              onClick={() => setShowRipple(true)}
              className="w-full p-3.5 relative overflow-hidden text-left"
              style={{ borderRadius: 16, background: "rgba(255,45,85,0.03)", border: "1px solid rgba(255,45,85,0.08)" }}
            >
              {/* Animated ripple rings */}
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    animate={{ scale: [1, 2.5], opacity: [0.3, 0] }}
                    transition={{ duration: 2, repeat: Infinity, delay: i * 0.6 }}
                    className="absolute size-8 rounded-full right-0 top-1/2 -translate-y-1/2"
                    style={{ border: "1px solid rgba(255,45,85,0.2)" }}
                  />
                ))}
                <Radio className="size-5 relative z-10" style={{ color: "#FF2D55" }} />
              </div>
              <div className="flex items-center gap-2.5 pr-14">
                <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,45,85,0.08)" }}>
                  <Zap className="size-4" style={{ color: "#FF2D55" }} />
                </div>
                <div>
                  <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Emergency Ripple</p>
                  <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.25)" }}>
                    3-wave alert system · Tap to preview
                  </p>
                </div>
              </div>
            </button>
          </motion.div>

          {/* ── Contact List ──────────────────────────────── */}
          <div className="px-5 space-y-2.5">
            <AnimatePresence>
              {filtered.sort((a, b) => a.priority - b.priority).map((contact, i) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  index={i}
                  isExpanded={expandedId === contact.id}
                  isPro={isPro}
                  onToggleExpand={() => setExpandedId(expandedId === contact.id ? null : contact.id)}
                  onToggleFavorite={() => toggleFavorite(contact.id)}
                  onToggleTracking={() => toggleTracking(contact.id)}
                  onEdit={() => { setEditingContact(contact); setShowForm(true); }}
                  onDelete={() => setDeleteConfirm(contact.id)}
                  onCopyLink={() => handleCopyLink(contact)}
                  onResendInvite={() => resendInvite(contact)}
                  onShowSafetyLink={() => setShowSafetyLink(contact)}
                  deleteConfirm={deleteConfirm}
                  onCancelDelete={() => setDeleteConfirm(null)}
                  onConfirmDelete={() => deleteContact(contact.id)}
                />
              ))}
            </AnimatePresence>

            {/* ── Add Contact Button ──────────────────────── */}
            {canAddMore || isPro ? (
              <motion.button
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => { setEditingContact(null); setShowForm(true); }}
                className="w-full p-4 flex items-center justify-center gap-2"
                style={{
                  borderRadius: 18,
                  background: "rgba(0,200,224,0.03)",
                  border: "1px dashed rgba(0,200,224,0.15)",
                  fontSize: 14, fontWeight: 600,
                  color: "rgba(0,200,224,0.5)",
                }}
              >
                <Plus className="size-4" />
                Add Safety Contact
              </motion.button>
            ) : (
              <motion.button
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                whileTap={{ scale: 0.97 }}
                onClick={onUpgrade}
                className="w-full p-4 relative overflow-hidden"
                style={{
                  borderRadius: 18,
                  background: "linear-gradient(135deg, rgba(0,200,224,0.06), rgba(0,200,224,0.02))",
                  border: "1px solid rgba(0,200,224,0.1)",
                }}
              >
                <div className="flex items-center justify-center gap-2">
                  <Crown className="size-4" style={{ color: "#00C8E0" }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#00C8E0" }}>
                    Upgrade for unlimited contacts
                  </span>
                </div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 4 }}>
                  Free plan: 1 tracking + 1 ghost contact
                </p>
              </motion.button>
            )}
          </div>

          {/* ── Tracking Permissions Info ─────────────────── */}
          <div className="px-5 mt-5">
            <div className="rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.03)" }}>
              <p className="mb-3" style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.15)", letterSpacing: "0.5px" }}>
                HOW TRACKING WORKS
              </p>
              <div className="space-y-3">
                {[
                  { icon: Eye, label: "Watcher", desc: "You track them — requires your paid plan", color: "#00C8E0" },
                  { icon: Radio, label: "Beacon", desc: "They track you — free for them (with consent)", color: "#00C853" },
                  { icon: Link, label: "Ghost", desc: "No app needed — SMS + Safety Link in emergencies", color: "#FF9500" },
                ].map(item => (
                  <div key={item.label} className="flex items-start gap-2.5">
                    <div className="size-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${item.color}08` }}>
                      <item.icon className="size-3.5" style={{ color: item.color }} />
                    </div>
                    <div>
                      <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{item.label}</p>
                      <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.2)", lineHeight: 1.4 }}>{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ ADD/EDIT FORM MODAL ═══════════════════════════ */}
      <AnimatePresence>
        {showForm && (
          <AddEditContactForm
            contact={editingContact}
            isPro={isPro}
            onClose={() => { setShowForm(false); setEditingContact(null); }}
            onSave={(contact) => {
              let updated: SafetyContact[];
              if (editingContact) {
                updated = contacts.map(c => c.id === editingContact.id ? { ...c, ...contact } : c);
              } else {
                const newC: SafetyContact = {
                  ...contact as SafetyContact,
                  id: `SC-${Date.now().toString(36).toUpperCase()}`,
                  addedAt: Date.now(),
                  totalAlertsReceived: 0,
                  totalAlertsResponded: 0,
                  avgResponseTime: 0,
                };
                if (newC.type === "ghost") {
                  const link = generateSafetyLink(newC.id, newC.name);
                  newC.safetyLinkId = link.linkId;
                  newC.safetyLinkExpiry = link.expiry;
                  newC.safetyLinkActive = true;
                }
                updated = [...contacts, newC];
              }
              setContacts(updated);
              saveSafetyContacts(updated);
              setShowForm(false);
              setEditingContact(null);
              toast.success(editingContact ? "Contact updated" : "Contact added");
            }}
          />
        )}
      </AnimatePresence>

      {/* ═══ EMERGENCY RIPPLE MODAL ═══════════════════════ */}
      <AnimatePresence>
        {showRipple && (
          <EmergencyRippleModal
            contacts={contacts}
            isPro={isPro}
            onClose={() => setShowRipple(false)}
            onUpgrade={onUpgrade}
          />
        )}
      </AnimatePresence>

      {/* ═══ SAFETY LINK MODAL ════════════════════════════ */}
      <AnimatePresence>
        {showSafetyLink && (
          <SafetyLinkModal
            contact={showSafetyLink}
            onClose={() => setShowSafetyLink(null)}
            onCopy={() => handleCopyLink(showSafetyLink)}
            copied={linkCopied}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Contact Card
// ═══════════════════════════════════════════════════════════════

function ContactCard({ contact, index, isExpanded, isPro, onToggleExpand, onToggleFavorite, onToggleTracking, onEdit, onDelete, onCopyLink, onResendInvite, onShowSafetyLink, deleteConfirm, onCancelDelete, onConfirmDelete }: {
  contact: SafetyContact;
  index: number;
  isExpanded: boolean;
  isPro: boolean;
  onToggleExpand: () => void;
  onToggleFavorite: () => void;
  onToggleTracking: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyLink: () => void;
  onResendInvite: () => void;
  onShowSafetyLink: () => void;
  deleteConfirm: string | null;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const cfg = CONTACT_TYPE_CONFIG[contact.type];
  const RelIcon = relationIcons[contact.relation] || User;
  const TypeIcon = typeIcons[contact.type];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ delay: index * 0.03 }}
    >
      <div
        className="relative overflow-hidden"
        style={{
          borderRadius: 18,
          background: isExpanded ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.02)",
          border: `1px solid ${contact.isFavorite ? "rgba(0,200,224,0.12)" : contact.type === "ghost" ? "rgba(255,150,0,0.08)" : "rgba(255,255,255,0.04)"}`,
        }}
      >
        {/* Main Row */}
        <button onClick={onToggleExpand} className="w-full p-4 text-left">
          <div className="flex items-center gap-3.5">
            {/* Avatar + Priority */}
            <div className="relative">
              <div
                className="size-12 rounded-[14px] flex items-center justify-center"
                style={{
                  background: contact.isFavorite ? "rgba(0,200,224,0.08)" : `${cfg.color}08`,
                  border: `1px solid ${contact.isFavorite ? "rgba(0,200,224,0.15)" : `${cfg.color}15`}`,
                }}
              >
                <RelIcon className="size-5" style={{ color: contact.isFavorite ? "#00C8E0" : cfg.color }} />
              </div>
              {/* Priority */}
              <div
                className="absolute -top-1 -left-1 size-5 rounded-full flex items-center justify-center"
                style={{
                  background: "#FF2D55",
                  boxShadow: "0 2px 6px rgba(255,45,85,0.3)",
                  fontSize: 9, fontWeight: 800, color: "#fff",
                }}
              >
                {contact.priority}
              </div>
              {/* Online indicator */}
              {contact.hasApp && (
                <div
                  className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full flex items-center justify-center"
                  style={{ background: "#0A1220", border: `2px solid ${contact.isOnline ? "#00C853" : "rgba(255,255,255,0.1)"}` }}
                >
                  <div className="size-1.5 rounded-full" style={{ background: contact.isOnline ? "#00C853" : "rgba(255,255,255,0.2)" }} />
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-white truncate" style={{ fontSize: 15, fontWeight: 600 }}>{contact.name}</p>
                {contact.isFavorite && (
                  <div className="px-1.5 py-0.5" style={{ borderRadius: 5, background: "rgba(0,200,224,0.1)" }}>
                    <span style={{ fontSize: 8, fontWeight: 700, color: "#00C8E0" }}>PRIMARY</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex items-center gap-1">
                  <TypeIcon className="size-3" style={{ color: cfg.color }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
                </div>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.1)" }}>·</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.15)" }}>{contact.relation}</span>
                {contact.hasApp && contact.batteryLevel !== null && (
                  <>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.1)" }}>·</span>
                    <div className="flex items-center gap-0.5">
                      <Battery className="size-2.5" style={{ color: contact.batteryLevel < 20 ? "#FF2D55" : "rgba(255,255,255,0.15)" }} />
                      <span style={{ fontSize: 9, color: contact.batteryLevel < 20 ? "#FF2D55" : "rgba(255,255,255,0.15)" }}>{contact.batteryLevel}%</span>
                    </div>
                  </>
                )}
              </div>
              {/* Location or SMS status */}
              <p className="mt-1 truncate" style={{ fontSize: 10, color: "rgba(255,255,255,0.12)" }}>
                {contact.type === "ghost"
                  ? `SMS · ${contact.phone}`
                  : contact.lastKnownLocation
                    ? `${contact.lastKnownLocation.lat.toFixed(3)}, ${contact.lastKnownLocation.lng.toFixed(3)} · ${fmtTime(contact.lastKnownLocation.timestamp)}`
                    : contact.phone
                }
              </p>
            </div>

            {/* Tracking indicator + Expand */}
            <div className="flex items-center gap-2">
              {contact.locationSharingEnabled && contact.type !== "ghost" && (
                <motion.div animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 2, repeat: Infinity }}>
                  <Locate className="size-3.5" style={{ color: "#00C853" }} />
                </motion.div>
              )}
              {contact.type === "ghost" && (
                <Link className="size-3.5" style={{ color: "#FF9500" }} />
              )}
              <ChevronDown
                className="size-4 transition-transform"
                style={{ color: "rgba(255,255,255,0.15)", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </div>
          </div>
        </button>

        {/* ── Expanded Detail ──────────────────────────── */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                {/* Contact Type Info */}
                <div className="rounded-xl p-3 mt-3" style={{ background: `${cfg.color}06`, border: `1px solid ${cfg.color}10` }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <TypeIcon className="size-3.5" style={{ color: cfg.color }} />
                    <p style={{ fontSize: 11, fontWeight: 700, color: cfg.color }}>{cfg.label}</p>
                  </div>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", lineHeight: 1.5 }}>
                    {cfg.description}
                  </p>
                  {/* Features */}
                  <div className="mt-2 space-y-1">
                    {cfg.features.slice(0, 3).map(f => (
                      <div key={f} className="flex items-center gap-1.5">
                        <CheckCircle2 className="size-2.5 shrink-0" style={{ color: cfg.color }} />
                        <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.3)" }}>{f}</span>
                      </div>
                    ))}
                    {cfg.limitations.length > 0 && cfg.limitations.slice(0, 2).map(l => (
                      <div key={l} className="flex items-center gap-1.5">
                        <XCircle className="size-2.5 shrink-0" style={{ color: "rgba(255,255,255,0.1)" }} />
                        <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.15)" }}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tracking Status (for app contacts) */}
                {contact.hasApp && (
                  <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div className="flex items-center gap-2">
                      {contact.locationSharingEnabled
                        ? <Eye className="size-3.5" style={{ color: "#00C853" }} />
                        : <EyeOff className="size-3.5" style={{ color: "rgba(255,255,255,0.15)" }} />
                      }
                      <span style={{ fontSize: 11, fontWeight: 600, color: contact.locationSharingEnabled ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)" }}>
                        Location {contact.locationSharingEnabled ? "sharing" : "paused"}
                      </span>
                      {contact.locationSharingEnabled && (
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
                          · every {contact.locationUpdateFrequency}s
                        </span>
                      )}
                    </div>
                    <button
                      onClick={onToggleTracking}
                      className="px-2.5 py-1 rounded-lg"
                      style={{
                        background: contact.locationSharingEnabled ? "rgba(255,45,85,0.06)" : "rgba(0,200,83,0.06)",
                        border: `1px solid ${contact.locationSharingEnabled ? "rgba(255,45,85,0.1)" : "rgba(0,200,83,0.1)"}`,
                        fontSize: 10, fontWeight: 600,
                        color: contact.locationSharingEnabled ? "#FF2D55" : "#00C853",
                      }}
                    >
                      {contact.locationSharingEnabled ? "Pause" : "Enable"}
                    </button>
                  </div>
                )}

                {/* Safety Link (for ghost contacts) */}
                {contact.type === "ghost" && (
                  <div className="rounded-xl p-3" style={{ background: "rgba(255,150,0,0.04)", border: "1px solid rgba(255,150,0,0.08)" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="size-3.5" style={{ color: "#FF9500" }} />
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#FF9500" }}>Safety Link</p>
                    </div>
                    <p className="mb-2.5" style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", lineHeight: 1.4 }}>
                      During emergencies, {contact.name} receives an SMS with this link to see your live location.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={onCopyLink}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                        style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)", fontSize: 11, fontWeight: 600, color: "#FF9500" }}
                      >
                        <Copy className="size-3" /> Copy Link
                      </button>
                      <button
                        onClick={onShowSafetyLink}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}
                      >
                        <Eye className="size-3" /> Preview
                      </button>
                    </div>
                  </div>
                )}

                {/* Invite to download (for ghost contacts) */}
                {contact.type === "ghost" && (
                  <button
                    onClick={onResendInvite}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl"
                    style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.08)", fontSize: 11, fontWeight: 600, color: "#00C8E0" }}
                  >
                    <SmartphoneNfc className="size-3.5" />
                    Invite to Download SOSphere
                  </button>
                )}

                {/* Response Stats */}
                {contact.totalAlertsReceived > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Alerts", value: contact.totalAlertsReceived, color: "#FF2D55" },
                      { label: "Responded", value: contact.totalAlertsResponded, color: "#00C853" },
                      { label: "Avg Time", value: `${contact.avgResponseTime}s`, color: "#00C8E0" },
                    ].map(s => (
                      <div key={s.label} className="text-center rounded-lg py-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                        <p className="text-white" style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</p>
                        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions Row */}
                <div className="flex gap-2">
                  <button onClick={onToggleFavorite} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontSize: 10, fontWeight: 600, color: contact.isFavorite ? "#FFD700" : "rgba(255,255,255,0.25)" }}>
                    <Star className="size-3" style={{ fill: contact.isFavorite ? "#FFD700" : "none" }} /> {contact.isFavorite ? "Primary" : "Set Primary"}
                  </button>
                  <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.25)" }}>
                    <Edit3 className="size-3" /> Edit
                  </button>
                  <button onClick={onDelete} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl"
                    style={{ background: "rgba(255,45,85,0.04)", border: "1px solid rgba(255,45,85,0.08)", fontSize: 10, fontWeight: 600, color: "rgba(255,45,85,0.5)" }}>
                    <Trash2 className="size-3" />
                  </button>
                </div>

                {/* Delete Confirm */}
                <AnimatePresence>
                  {deleteConfirm === contact.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center gap-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                        <p style={{ fontSize: 12, color: "rgba(255,45,85,0.6)", flex: 1 }}>Remove from safety contacts?</p>
                        <button onClick={onCancelDelete} className="px-3 py-1.5 rounded-lg"
                          style={{ background: "rgba(255,255,255,0.04)", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>
                          Cancel
                        </button>
                        <button onClick={onConfirmDelete} className="px-3 py-1.5 rounded-lg"
                          style={{ background: "rgba(255,45,85,0.1)", fontSize: 11, fontWeight: 600, color: "#FF2D55" }}>
                          Remove
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Add/Edit Contact Form
// ═══════════════════════════════════════════════════════════════

function AddEditContactForm({ contact, isPro, onClose, onSave }: {
  contact: SafetyContact | null;
  isPro: boolean;
  onClose: () => void;
  onSave: (data: Partial<SafetyContact>) => void;
}) {
  const [name, setName] = useState(contact?.name || "");
  const [phone, setPhone] = useState(contact?.phone || "");
  const [relation, setRelation] = useState(contact?.relation || "Friend");
  const [hasApp, setHasApp] = useState(contact?.hasApp ?? true);
  const [theirPlan, setTheirPlan] = useState<ContactPlan>(contact?.theirPlan || "free");

  const contactType = determineContactType(hasApp, theirPlan);
  const cfg = CONTACT_TYPE_CONFIG[contactType];
  const TypeIcon = typeIcons[contactType];

  const handleSave = () => {
    if (!name.trim() || !phone.trim()) return;
    onSave({
      name: name.trim(),
      phone: phone.trim(),
      relation,
      hasApp,
      theirPlan,
      type: contactType,
      trackingRole: contactType === "ghost" ? "watcher" : contactType === "full" ? "mutual" : "beacon",
      locationSharingEnabled: hasApp,
      locationUpdateFrequency: theirPlan === "pro" ? 30 : 300,
      lastKnownLocation: null,
      safetyLinkId: contact?.safetyLinkId || null,
      safetyLinkExpiry: contact?.safetyLinkExpiry || null,
      safetyLinkActive: !hasApp,
      isOnline: false,
      lastSeen: 0,
      batteryLevel: null,
      appStatus: hasApp ? "closed" : "uninstalled",
      consentGiven: false,
      consentTimestamp: null,
      priority: contact?.priority || 99,
      isFavorite: contact?.isFavorite || false,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex items-end"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 500 }}
        animate={{ y: 0 }}
        exit={{ y: 500 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full"
        onClick={e => e.stopPropagation()}
        style={{ borderRadius: "24px 24px 0 0", background: "#0A1220", border: "1px solid rgba(255,255,255,0.06)", borderBottom: "none" }}
      >
        <div className="p-6 max-h-[80vh] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <div className="w-8 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(255,255,255,0.1)" }} />

          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white" style={{ fontSize: 18, fontWeight: 700 }}>
              {contact ? "Edit Contact" : "Add Safety Contact"}
            </h2>
            <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)" }}>
              <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
            </button>
          </div>

          {/* Has App? */}
          <div className="mb-4">
            <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>
              DO THEY HAVE SOSPHERE?
            </label>
            <div className="flex gap-2 mt-2">
              {[
                { val: true, label: "Yes, has the app", icon: Smartphone, color: "#00C853" },
                { val: false, label: "No app (Ghost)", icon: Link, color: "#FF9500" },
              ].map(opt => (
                <button
                  key={String(opt.val)}
                  onClick={() => setHasApp(opt.val)}
                  className="flex-1 flex items-center gap-2 px-3.5 py-3 rounded-xl"
                  style={{
                    background: hasApp === opt.val ? `${opt.color}08` : "rgba(255,255,255,0.02)",
                    border: `1px solid ${hasApp === opt.val ? `${opt.color}20` : "rgba(255,255,255,0.05)"}`,
                  }}
                >
                  <opt.icon className="size-4" style={{ color: hasApp === opt.val ? opt.color : "rgba(255,255,255,0.15)" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: hasApp === opt.val ? opt.color : "rgba(255,255,255,0.25)" }}>
                    {opt.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Their Plan (only if has app) */}
          {hasApp && (
            <div className="mb-4">
              <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>
                THEIR PLAN
              </label>
              <div className="flex gap-2 mt-2">
                {[
                  { val: "free" as const, label: "Free (Lite)", color: "#00C8E0" },
                  { val: "pro" as const, label: "Pro (Full)", color: "#00C853" },
                ].map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => setTheirPlan(opt.val)}
                    className="flex-1 px-3.5 py-2.5 rounded-xl"
                    style={{
                      background: theirPlan === opt.val ? `${opt.color}08` : "rgba(255,255,255,0.02)",
                      border: `1px solid ${theirPlan === opt.val ? `${opt.color}20` : "rgba(255,255,255,0.05)"}`,
                      fontSize: 12, fontWeight: 600,
                      color: theirPlan === opt.val ? opt.color : "rgba(255,255,255,0.25)",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Type Preview */}
          <div className="mb-4 rounded-xl p-3" style={{ background: `${cfg.color}06`, border: `1px solid ${cfg.color}10` }}>
            <div className="flex items-center gap-2">
              <TypeIcon className="size-4" style={{ color: cfg.color }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
            </div>
            <p className="mt-1" style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>{cfg.description}</p>
          </div>

          {/* Name */}
          <div className="mb-4">
            <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>FULL NAME</label>
            <input
              type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Enter full name"
              className="w-full mt-2 px-4 py-3.5 text-white outline-none"
              style={{ borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 15 }}
            />
          </div>

          {/* Phone */}
          <div className="mb-4">
            <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>PHONE NUMBER</label>
            <input
              type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="+966 5XX XXX XXXX"
              className="w-full mt-2 px-4 py-3.5 text-white outline-none"
              style={{ borderRadius: 14, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 15 }}
            />
          </div>

          {/* Relation */}
          <div className="mb-6">
            <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>RELATIONSHIP</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {RELATIONS.map(rel => (
                <button key={rel} onClick={() => setRelation(rel)}
                  className="px-3.5 py-2"
                  style={{
                    borderRadius: 10,
                    background: relation === rel ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.03)",
                    border: `1px solid ${relation === rel ? "rgba(0,200,224,0.2)" : "rgba(255,255,255,0.06)"}`,
                    fontSize: 12, fontWeight: 500,
                    color: relation === rel ? "#00C8E0" : "rgba(255,255,255,0.3)",
                  }}
                >{rel}</button>
              ))}
            </div>
          </div>

          {/* Save */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSave}
            disabled={!name.trim() || !phone.trim()}
            className="w-full flex items-center justify-center gap-2 py-4"
            style={{
              borderRadius: 16,
              background: name.trim() && phone.trim()
                ? `linear-gradient(135deg, ${cfg.color}, ${cfg.color}BB)`
                : "rgba(255,255,255,0.04)",
              fontSize: 15, fontWeight: 700,
              color: name.trim() && phone.trim() ? "#fff" : "rgba(255,255,255,0.2)",
              boxShadow: name.trim() && phone.trim() ? `0 8px 30px ${cfg.color}30` : "none",
            }}
          >
            <Check className="size-4" />
            {contact ? "Save Changes" : `Add ${cfg.label}`}
          </motion.button>

          <div className="h-6" />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Emergency Ripple Modal
// ═══════════════════════════════════════════════════════════════

function EmergencyRippleModal({ contacts, isPro, onClose, onUpgrade }: {
  contacts: SafetyContact[];
  isPro: boolean;
  onClose: () => void;
  onUpgrade?: () => void;
}) {
  const [activeWave, setActiveWave] = useState(0);
  const [simRunning, setSimRunning] = useState(false);

  const startSimulation = () => {
    setSimRunning(true);
    setActiveWave(1);
    setTimeout(() => setActiveWave(2), 2000);
    setTimeout(() => setActiveWave(3), 4000);
    setTimeout(() => setSimRunning(false), 6000);
  };

  const waveIcons: Record<string, typeof Zap> = { Zap, Radio, Phone };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex items-end"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 600 }}
        animate={{ y: 0 }}
        exit={{ y: 600 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full"
        onClick={e => e.stopPropagation()}
        style={{ borderRadius: "24px 24px 0 0", background: "#0A1220", border: "1px solid rgba(255,255,255,0.06)", borderBottom: "none" }}
      >
        <div className="p-6 max-h-[85vh] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <div className="w-8 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(255,255,255,0.1)" }} />

          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)" }}>
                <Radio className="size-5" style={{ color: "#FF2D55" }} />
              </div>
              <div>
                <h2 className="text-white" style={{ fontSize: 18, fontWeight: 700 }}>Emergency Ripple</h2>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>3-wave escalating alert system</p>
              </div>
            </div>
            <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)" }}>
              <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
            </button>
          </div>

          {/* Wave Visualization */}
          <div className="relative mb-5">
            {/* Center SOS button */}
            <div className="flex justify-center mb-6">
              <div className="relative">
                {simRunning && [0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    animate={{ scale: [1, 3], opacity: [0.4, 0] }}
                    transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }}
                    className="absolute inset-0 rounded-full"
                    style={{ border: "2px solid rgba(255,45,85,0.3)" }}
                  />
                ))}
                <motion.div
                  animate={simRunning ? { scale: [1, 0.9, 1] } : {}}
                  transition={{ duration: 0.5, repeat: simRunning ? Infinity : 0 }}
                  className="size-16 rounded-full flex items-center justify-center relative z-10"
                  style={{ background: "linear-gradient(135deg, #FF2D55, #D1234A)", boxShadow: "0 8px 30px rgba(255,45,85,0.3)" }}
                >
                  <AlertTriangle className="size-7" style={{ color: "#fff" }} />
                </motion.div>
              </div>
            </div>

            {/* Waves */}
            <div className="space-y-3">
              {EMERGENCY_RIPPLE_WAVES.map((wave) => {
                const WaveIcon = waveIcons[wave.icon] || Radio;
                const isActive = simRunning && activeWave >= wave.id;
                const isLocked = wave.requiresPro && !isPro;
                const affectedContacts = contacts.filter(c => wave.targetTypes.includes(c.type));

                return (
                  <motion.div
                    key={wave.id}
                    animate={isActive ? { scale: [0.98, 1], opacity: 1 } : { opacity: isLocked ? 0.5 : 1 }}
                    className="rounded-2xl p-4 relative overflow-hidden"
                    style={{
                      background: isActive ? `${wave.color}08` : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isActive ? `${wave.color}25` : "rgba(255,255,255,0.04)"}`,
                    }}
                  >
                    {isActive && (
                      <motion.div
                        initial={{ x: "-100%" }}
                        animate={{ x: "100%" }}
                        transition={{ duration: 1.5, ease: "easeInOut" }}
                        className="absolute inset-y-0 w-1/3"
                        style={{ background: `linear-gradient(90deg, transparent, ${wave.color}10, transparent)` }}
                      />
                    )}

                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: `${wave.color}10` }}>
                          <WaveIcon className="size-4" style={{ color: wave.color }} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{wave.label}</p>
                            {isLocked && (
                              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)" }}>
                                <Lock className="size-2.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                                <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.2)" }}>PRO</span>
                              </div>
                            )}
                          </div>
                          <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.25)" }}>{wave.description}</p>
                        </div>
                        <div className="text-right">
                          <p style={{ fontSize: 10, color: wave.color, fontWeight: 700 }}>
                            {wave.delay === 0 ? "Instant" : `+${wave.delay}s`}
                          </p>
                        </div>
                      </div>

                      {/* Affected contacts */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {affectedContacts.slice(0, 4).map(c => {
                          const tcfg = CONTACT_TYPE_CONFIG[c.type];
                          return (
                            <div key={c.id} className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: `${tcfg.color}08`, border: `1px solid ${tcfg.color}10` }}>
                              <div className="size-1.5 rounded-full" style={{ background: tcfg.color }} />
                              <span style={{ fontSize: 9, fontWeight: 600, color: tcfg.color }}>{c.name.split(" ")[0]}</span>
                            </div>
                          );
                        })}
                        {affectedContacts.length === 0 && (
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>No contacts of this type</span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Simulate Button */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={startSimulation}
            disabled={simRunning}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl mb-3"
            style={{
              background: simRunning ? "rgba(255,255,255,0.03)" : "rgba(255,45,85,0.08)",
              border: `1px solid ${simRunning ? "rgba(255,255,255,0.06)" : "rgba(255,45,85,0.15)"}`,
              fontSize: 14, fontWeight: 700,
              color: simRunning ? "rgba(255,255,255,0.2)" : "#FF2D55",
            }}
          >
            {simRunning ? (
              <>
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                  <Timer className="size-4" />
                </motion.div>
                Simulating...
              </>
            ) : (
              <>
                <Zap className="size-4" />
                Simulate Emergency Ripple
              </>
            )}
          </motion.button>

          {/* Pro Upgrade for Wave 3 */}
          {!isPro && (
            <button
              onClick={onUpgrade}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
              style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.08)", fontSize: 12, fontWeight: 600, color: "#00C8E0" }}
            >
              <Crown className="size-3.5" />
              Upgrade to Pro for Wave 3 (Auto-Call + Emergency Services)
            </button>
          )}

          <div className="h-6" />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Safety Link Preview Modal
// ═══════════════════════════════════════════════════════════════

function SafetyLinkModal({ contact, onClose, onCopy, copied }: {
  contact: SafetyContact;
  onClose: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex items-end"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 500 }}
        animate={{ y: 0 }}
        exit={{ y: 500 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full"
        onClick={e => e.stopPropagation()}
        style={{ borderRadius: "24px 24px 0 0", background: "#0A1220", border: "1px solid rgba(255,255,255,0.06)", borderBottom: "none" }}
      >
        <div className="p-6">
          <div className="w-8 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(255,255,255,0.1)" }} />

          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,150,0,0.08)", border: "1px solid rgba(255,150,0,0.15)" }}>
                <Globe className="size-5" style={{ color: "#FF9500" }} />
              </div>
              <div>
                <h2 className="text-white" style={{ fontSize: 18, fontWeight: 700 }}>Safety Link Preview</h2>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>What {contact.name} sees</p>
              </div>
            </div>
            <button onClick={onClose} className="size-8 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)" }}>
              <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
            </button>
          </div>

          {/* Mock Safety Link Page */}
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            {/* Browser bar mock */}
            <div className="flex items-center gap-2 px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <Lock className="size-3" style={{ color: "#00C853" }} />
              <p className="flex-1 truncate" style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>
                sosphere.app/safety/{contact.name.toLowerCase().replace(/\s+/g, "-")}/{contact.safetyLinkId || "xxx"}
              </p>
            </div>

            {/* Page content */}
            <div className="p-5 text-center" style={{ background: "linear-gradient(180deg, rgba(255,45,85,0.04), rgba(0,0,0,0))" }}>
              {/* Emergency header */}
              <motion.div
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="size-14 rounded-full flex items-center justify-center mx-auto mb-3"
                style={{ background: "rgba(255,45,85,0.1)", border: "2px solid rgba(255,45,85,0.2)" }}
              >
                <AlertTriangle className="size-7" style={{ color: "#FF2D55" }} />
              </motion.div>

              <p className="text-white mb-1" style={{ fontSize: 16, fontWeight: 800 }}>Emergency Alert</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                Ahmed needs help. Live location below.
              </p>

              {/* Mock map */}
              <div className="rounded-xl mt-4 mb-4 overflow-hidden" style={{ height: 120, background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.1)" }}>
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <MapPin className="size-8 mx-auto mb-1" style={{ color: "#FF2D55" }} />
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Live Location Map</p>
                    <p style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>24.7136, 46.6753</p>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 py-3 rounded-xl"
                  style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.15)" }}>
                  <Navigation className="size-4" style={{ color: "#00C853" }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#00C853" }}>I'm Coming</span>
                </div>
                <div className="flex items-center justify-center gap-2 py-3 rounded-xl"
                  style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                  <Phone className="size-4" style={{ color: "#00C8E0" }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#00C8E0" }}>Call Ahmed</span>
                </div>
                <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl"
                  style={{ background: "rgba(255,45,85,0.06)", border: "1px solid rgba(255,45,85,0.1)" }}>
                  <Phone className="size-3.5" style={{ color: "#FF2D55" }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#FF2D55" }}>Call 911</span>
                </div>
              </div>

              {/* Timer */}
              <div className="mt-3 flex items-center justify-center gap-1.5">
                <Timer className="size-3" style={{ color: "rgba(255,255,255,0.15)" }} />
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.15)" }}>
                  Link expires in 23h 58m
                </p>
              </div>
            </div>
          </div>

          {/* Copy Link */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={onCopy}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl mt-4"
            style={{
              background: copied ? "rgba(0,200,83,0.08)" : "rgba(255,150,0,0.08)",
              border: `1px solid ${copied ? "rgba(0,200,83,0.15)" : "rgba(255,150,0,0.15)"}`,
              fontSize: 14, fontWeight: 700,
              color: copied ? "#00C853" : "#FF9500",
            }}
          >
            {copied ? <><CheckCircle2 className="size-4" /> Copied!</> : <><Copy className="size-4" /> Copy Safety Link</>}
          </motion.button>

          <div className="h-6" />
        </div>
      </motion.div>
    </motion.div>
  );
}
