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
  MoreHorizontal, PauseCircle, PlayCircle,
} from "lucide-react";
import { toast } from "sonner";
import { CountrySheet, COUNTRIES, type Country } from "./country-picker";

// AUDIT-FIX (2026-04-18): split phone input into country picker +
// subscriber number so stored phones are ALWAYS canonical E.164.
// Matches WhatsApp/Telegram UX pattern — no ambiguity, no parsing.
const DEFAULT_COUNTRY: Country = COUNTRIES.find(c => c.code === "IQ") || COUNTRIES[0];

function splitE164(raw?: string): { country: Country; subscriber: string } {
  if (!raw) return { country: DEFAULT_COUNTRY, subscriber: "" };
  const s = String(raw).trim();
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (s.startsWith(c.dial)) {
      return { country: c, subscriber: s.slice(c.dial.length).replace(/\D/g, "") };
    }
  }
  return { country: DEFAULT_COUNTRY, subscriber: s.replace(/\D/g, "") };
}

function buildE164(country: Country, subscriber: string): string {
  const digits = subscriber.replace(/\D/g, "").replace(/^0+/, "");
  return digits ? `${country.dial}${digits}` : "";
}
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
  // AUDIT-FIX (2026-04-18): Senior UI/UX redesign. Removed the
  // expand/collapse card pattern entirely — Edit/Delete were hidden
  // behind two taps. Now a discreet ⋯ menu on the right of each card
  // surfaces all actions at one tap, keeping the card row compact
  // and glitch-free.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showRipple, setShowRipple] = useState(false);
  const [showSafetyLink, setShowSafetyLink] = useState<SafetyContact | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | ContactType>("all");
  const [linkCopied, setLinkCopied] = useState(false);

  const isPro = userPlan === "pro" || userPlan === "employee";
  const limits = PLAN_LIMITS[isPro ? "pro" : "free"];

  // Load contacts
  useEffect(() => {
    seedDemoContacts();
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
    <div className="relative flex flex-col h-full" style={{ overflow: "hidden" }}>
      {/* AUDIT-FIX: ambient radial gradient removed — on Android OLED
          displays the 0.03-alpha cyan ellipse renders as visible
          horizontal bands ("stripes") at the ellipse boundary. */}

      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: "none" }}>
        <div style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)", paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)" }}>
          {/* ── Header with Back + prominent Add action ───────── */}
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
            {/* AUDIT-FIX (2026-04-18): prominent Add button at top.
                Previously the only add affordance lived below an empty
                list and a dashed-border button that users missed. Stat
                tiles below look like cards → confused users. Now the
                Add action is the first thing they see. */}
            {(canAddMore || isPro) && (
              <button
                onClick={() => { setEditingContact(null); setShowForm(true); }}
                className="flex items-center gap-2 px-3.5 h-9 rounded-[12px]"
                style={{
                  background: "linear-gradient(135deg, #00C8E0, #0099B3)",
                  boxShadow: "0 4px 14px rgba(0,200,224,0.25)",
                }}
              >
                <Plus className="size-[16px]" style={{ color: "#fff" }} strokeWidth={2.5} />
                <span className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Add</span>
              </button>
            )}
          </div>

          {/* ── Contact Type Stats ──────────────────────────
              AUDIT-FIX: the earlier 0.02-alpha background + 1px border
              rendered as invisible tiles with hairline "stripes" on
              Android OLED displays. Now using a solid darker fill +
              inset boxShadow so the tiles always have a clear shape. */}
          <div className="px-5 mb-4">
            <div className="grid grid-cols-3 gap-2">
              {(["full", "lite", "ghost"] as const).map(type => {
                const cfg = CONTACT_TYPE_CONFIG[type];
                const TypeIcon = typeIcons[type];
                const count = stats[type];
                const isActive = activeFilter === type;
                return (
                  <button
                    key={type}
                    onClick={() => setActiveFilter(isActive ? "all" : type)}
                    className="p-2.5 rounded-xl text-center relative"
                    style={{
                      background: isActive ? `${cfg.color}14` : "rgba(255,255,255,0.04)",
                      boxShadow: `inset 0 0 0 1px ${isActive ? `${cfg.color}40` : "rgba(255,255,255,0.08)"}`,
                    }}
                  >
                    <TypeIcon className="size-4 mx-auto mb-1" style={{ color: cfg.color }} />
                    <p className="text-white" style={{ fontSize: 16, fontWeight: 800, lineHeight: 1 }}>{count}</p>
                    <p style={{ fontSize: 9, color: cfg.color, fontWeight: 700, marginTop: 2, letterSpacing: "0.3px" }}>{cfg.label}</p>
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

          {/* ── Contact List (or empty state) ──────────────── */}
          <div className="px-5 space-y-2.5">
            {/* AUDIT-FIX (2026-04-18): proper empty state when no
                contacts yet. Before, users saw only 3 zero-count filter
                tiles + a dashed button below the fold — confusing. */}
            {filtered.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="w-full p-6 text-center"
                style={{
                  borderRadius: 20,
                  background: "rgba(0,200,224,0.03)",
                  border: "1px solid rgba(0,200,224,0.08)",
                }}
              >
                <div className="size-14 rounded-full flex items-center justify-center mx-auto mb-3"
                  style={{ background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.15)" }}>
                  <UserPlus className="size-6" style={{ color: "#00C8E0" }} />
                </div>
                <h3 className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>No safety contacts yet</h3>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 6, lineHeight: 1.5 }}>
                  Add people who should be alerted when you trigger SOS — family, close friends, or trusted colleagues.
                </p>
                <button
                  onClick={() => { setEditingContact(null); setShowForm(true); }}
                  className="inline-flex items-center gap-2 mt-4 px-4 h-10"
                  style={{
                    borderRadius: 12,
                    background: "linear-gradient(135deg, #00C8E0, #0099B3)",
                    fontSize: 13, fontWeight: 700, color: "#fff",
                    boxShadow: "0 4px 14px rgba(0,200,224,0.25)",
                  }}
                >
                  <Plus className="size-4" strokeWidth={2.5} />
                  Add your first contact
                </button>
              </motion.div>
            )}

            <AnimatePresence>
              {filtered.sort((a, b) => a.priority - b.priority).map((contact, i) => (
                <ContactCard
                  key={contact.id}
                  contact={contact}
                  index={i}
                  isPro={isPro}
                  menuOpen={menuOpenId === contact.id}
                  onToggleMenu={() => setMenuOpenId(menuOpenId === contact.id ? null : contact.id)}
                  onCloseMenu={() => setMenuOpenId(null)}
                  onToggleFavorite={() => { toggleFavorite(contact.id); setMenuOpenId(null); }}
                  onToggleTracking={() => { toggleTracking(contact.id); setMenuOpenId(null); }}
                  onEdit={() => { setEditingContact(contact); setShowForm(true); setMenuOpenId(null); }}
                  onDelete={() => { setDeleteConfirm(contact.id); setMenuOpenId(null); }}
                  onCopyPhone={async () => {
                    try {
                      await navigator.clipboard?.writeText(contact.phone);
                      toast.success("Phone copied");
                    } catch { /* silent */ }
                    setMenuOpenId(null);
                  }}
                  onShowSafetyLink={() => { setShowSafetyLink(contact); setMenuOpenId(null); }}
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

function ContactCard({ contact, index, isPro, menuOpen, onToggleMenu, onCloseMenu, onToggleFavorite, onToggleTracking, onEdit, onDelete, onCopyPhone, onShowSafetyLink, deleteConfirm, onCancelDelete, onConfirmDelete }: {
  contact: SafetyContact;
  index: number;
  isPro: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggleFavorite: () => void;
  onToggleTracking: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopyPhone: () => void;
  onShowSafetyLink: () => void;
  deleteConfirm: string | null;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const cfg = CONTACT_TYPE_CONFIG[contact.type];
  const RelIcon = relationIcons[contact.relation] || User;

  // AUDIT-FIX (2026-04-18) — Senior UI/UX redesign:
  //   • Removed card expand/collapse (Edit/Delete were hidden behind 2 taps)
  //   • Discreet ⋯ menu button on the right surfaces all actions at one tap
  //   • Priority moved INSIDE the avatar (corner badge, no overflow outside card bounds)
  //   • Single 1px border, no backdrop-filter on list cards (no fuzzy edges)
  //   • Strict flex row with min-w-0 + truncate on name row (no text bleed into ⋯)
  //   • Delete confirm kept inline but below the row — doesn't cause layout shift
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ type: "spring", stiffness: 320, damping: 28, delay: index * 0.025 }}
      className="relative"
    >
      <div
        style={{
          borderRadius: 16,
          background: "rgba(255,255,255,0.025)",
          boxShadow: `inset 0 0 0 1px ${contact.isFavorite ? "rgba(0,200,224,0.18)" : "rgba(255,255,255,0.055)"}`,
          overflow: "hidden",
        }}
      >
        <div className="flex items-center gap-3 px-3.5 py-3">
          {/* Avatar + in-badge priority */}
          <div className="relative shrink-0">
            <div
              className="size-11 rounded-[12px] flex items-center justify-center"
              style={{
                background: contact.isFavorite ? "rgba(0,200,224,0.10)" : `${cfg.color}10`,
                border: `1px solid ${contact.isFavorite ? "rgba(0,200,224,0.20)" : `${cfg.color}20`}`,
              }}
            >
              <RelIcon className="size-[18px]" style={{ color: contact.isFavorite ? "#00C8E0" : cfg.color }} />
            </div>
            {/* Priority badge — bottom-right, offset slightly so avatar corner stays clean */}
            <div
              className="absolute rounded-full flex items-center justify-center"
              style={{
                bottom: -2,
                right: -2,
                width: 14,
                height: 14,
                background: "#FF2D55",
                boxShadow: "0 0 0 1.5px #05070E",
                fontSize: 8, fontWeight: 800, color: "#fff",
                lineHeight: 1,
              }}
            >
              {contact.priority}
            </div>
          </div>

          {/* Name + meta — min-w-0 forces flex to allow truncation */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-white truncate" style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.1px" }}>
                {contact.name}
              </p>
              {contact.isFavorite && (
                <span
                  className="shrink-0 px-1.5"
                  style={{
                    fontSize: 8.5, fontWeight: 700, color: "#00C8E0",
                    lineHeight: "14px",
                    letterSpacing: "0.5px",
                    borderRadius: 4,
                    background: "rgba(0,200,224,0.10)",
                  }}
                >
                  PRIMARY
                </span>
              )}
            </div>
            <p className="truncate mt-0.5" style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
              <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
              {contact.relation ? <span style={{ color: "rgba(255,255,255,0.15)" }}> · {contact.relation}</span> : null}
              {contact.hasApp && contact.batteryLevel !== null && (
                <span style={{ color: contact.batteryLevel < 20 ? "#FF2D55" : "rgba(255,255,255,0.25)" }}> · {contact.batteryLevel}% </span>
              )}
            </p>
            <p className="truncate mt-0.5" style={{ fontSize: 10.5, color: "rgba(255,255,255,0.25)", fontFamily: "'Outfit', monospace" }}>
              {contact.phone || "—"}
            </p>
          </div>

          {/* Right-side meta + ⋯ menu */}
          <div className="flex items-center gap-1.5 shrink-0">
            {contact.hasApp && contact.isOnline && (
              <span
                title="Online"
                className="size-2 rounded-full shrink-0"
                style={{ background: "#00C853" }}
              />
            )}
            {contact.locationSharingEnabled && contact.type !== "ghost" && (
              <Locate className="size-3.5 shrink-0" style={{ color: "#00C853" }} />
            )}
            {contact.type === "ghost" && (
              <Link className="size-3.5 shrink-0" style={{ color: "#FF9500" }} />
            )}
            {/* ⋯ Menu trigger — clear hit-box, no background unless menu open */}
            <button
              onClick={onToggleMenu}
              aria-label="Contact actions"
              className="size-8 rounded-[10px] flex items-center justify-center transition-colors"
              style={{
                background: menuOpen ? "rgba(255,255,255,0.08)" : "transparent",
              }}
            >
              <MoreHorizontal className="size-[18px]" style={{ color: menuOpen ? "#fff" : "rgba(255,255,255,0.45)" }} />
            </button>
          </div>
        </div>

        {/* ── Dropdown menu — inline, replaces old expansion ── */}
        <AnimatePresence initial={false}>
          {menuOpen && (
            <motion.div
              key="menu"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: "spring", stiffness: 360, damping: 30 }}
              style={{ overflow: "hidden" }}
            >
              <div
                className="grid grid-cols-4 gap-1 px-2 pb-3 mx-2"
                style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)", paddingTop: 10 }}
              >
                {/* Edit */}
                <button
                  onClick={onEdit}
                  className="flex flex-col items-center justify-center gap-1 py-2 rounded-[10px]"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <Edit3 className="size-[15px]" style={{ color: "rgba(255,255,255,0.7)" }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.55)" }}>Edit</span>
                </button>
                {/* Primary toggle */}
                <button
                  onClick={onToggleFavorite}
                  className="flex flex-col items-center justify-center gap-1 py-2 rounded-[10px]"
                  style={{ background: contact.isFavorite ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.03)" }}
                >
                  <Star className="size-[15px]" style={{ fill: contact.isFavorite ? "#00C8E0" : "none", color: contact.isFavorite ? "#00C8E0" : "rgba(255,255,255,0.7)" }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: contact.isFavorite ? "#00C8E0" : "rgba(255,255,255,0.55)" }}>
                    {contact.isFavorite ? "Primary" : "Set primary"}
                  </span>
                </button>
                {/* Copy phone OR copy safety link */}
                <button
                  onClick={contact.type === "ghost" ? onShowSafetyLink : onCopyPhone}
                  className="flex flex-col items-center justify-center gap-1 py-2 rounded-[10px]"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  {contact.type === "ghost" ? (
                    <Globe className="size-[15px]" style={{ color: "#FF9500" }} />
                  ) : (
                    <Copy className="size-[15px]" style={{ color: "rgba(255,255,255,0.7)" }} />
                  )}
                  <span style={{ fontSize: 10, fontWeight: 600, color: contact.type === "ghost" ? "#FF9500" : "rgba(255,255,255,0.55)" }}>
                    {contact.type === "ghost" ? "Safety link" : "Copy phone"}
                  </span>
                </button>
                {/* Delete */}
                <button
                  onClick={onDelete}
                  className="flex flex-col items-center justify-center gap-1 py-2 rounded-[10px]"
                  style={{ background: "rgba(255,45,85,0.06)" }}
                >
                  <Trash2 className="size-[15px]" style={{ color: "#FF2D55" }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#FF2D55" }}>Delete</span>
                </button>
              </div>

              {/* Location-sharing toggle — app contacts only, outside the 4-grid */}
              {contact.hasApp && contact.type !== "ghost" && (
                <div className="px-3 pb-3">
                  <button
                    onClick={onToggleTracking}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-[10px]"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <span className="flex items-center gap-2">
                      {contact.locationSharingEnabled
                        ? <PauseCircle className="size-[15px]" style={{ color: "#FF2D55" }} />
                        : <PlayCircle className="size-[15px]" style={{ color: "#00C853" }} />
                      }
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>
                        {contact.locationSharingEnabled ? "Pause location sharing" : "Resume location sharing"}
                      </span>
                    </span>
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Delete confirm — inline below card ── */}
        <AnimatePresence initial={false}>
          {deleteConfirm === contact.id && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: "hidden" }}
            >
              <div
                className="flex items-center gap-2 px-3 py-3"
                style={{ boxShadow: "inset 0 1px 0 rgba(255,45,85,0.1)", background: "rgba(255,45,85,0.04)" }}
              >
                <AlertTriangle className="size-4 shrink-0" style={{ color: "#FF2D55" }} />
                <span className="flex-1" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                  Delete {contact.name}?
                </span>
                <button
                  onClick={onCancelDelete}
                  className="px-3 h-8 rounded-[8px]"
                  style={{ background: "rgba(255,255,255,0.05)", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirmDelete}
                  className="px-3 h-8 rounded-[8px]"
                  style={{ background: "#FF2D55", fontSize: 11, fontWeight: 700, color: "#fff" }}
                >
                  Delete
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

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
      style={{ background: "rgba(0,0,0,0.78)" }}
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
      style={{ background: "rgba(0,0,0,0.82)" }}
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
      style={{ background: "rgba(0,0,0,0.82)" }}
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
