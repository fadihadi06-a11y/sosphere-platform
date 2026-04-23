// ═══════════════════════════════════════════════════════════════
// SOSphere — Contextual Contact Edit Sheet
// ───────────────────────────────────────────────────────────────
// A single bottom-sheet modal that opens from ANYWHERE a contact
// is displayed (Safety Contacts list, Family Circle, Home quick
// contacts, Emergency Packet). Writes through civilian-store so
// every screen sees the update instantly.
//
// Props:
//   contact: SafetyContact | null   — null = add new
//   open:    boolean
//   onClose: () => void
//   onSaved?: (contact: SafetyContact) => void
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X, User, Heart, Users, Shield, Phone, Trash2,
  Check, AlertTriangle, Star, Smartphone, Link as LinkIcon,
} from "lucide-react";
import { toast } from "sonner";
import { CountrySheet, COUNTRIES, type Country } from "../country-picker";
import { useContacts, isValidE164 } from "./civilian-store";
import type { SafetyContact, ContactType } from "../contact-tier-system";

const DEFAULT_COUNTRY: Country = COUNTRIES.find(c => c.code === "IQ") || COUNTRIES[0];

const RELATIONS = ["Spouse", "Parent", "Sibling", "Child", "Friend", "Colleague", "Other"];

// ── Helpers ───────────────────────────────────────────────────

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

// ── Types ─────────────────────────────────────────────────────

interface ContactEditSheetProps {
  /** null = add new contact, otherwise edit existing. */
  contact: SafetyContact | null;
  /** Controls sheet visibility. */
  open: boolean;
  /** Called when user dismisses (cancel button or backdrop). */
  onClose: () => void;
  /** Called after a successful save/delete, with the updated contact (or null on delete). */
  onSaved?: (contact: SafetyContact | null) => void;
  /** Optional: hide delete button (e.g. when opened from a read-only context). */
  canDelete?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════

export function ContactEditSheet({
  contact,
  open,
  onClose,
  onSaved,
  canDelete = true,
}: ContactEditSheetProps) {
  const [, actions] = useContacts();

  // Form state — keyed off contact.id so switching targets resets the form
  const initial = splitE164(contact?.phone);
  const [name, setName] = useState(contact?.name ?? "");
  const [country, setCountry] = useState<Country>(initial.country);
  const [subscriber, setSubscriber] = useState(initial.subscriber);
  const [relation, setRelation] = useState(contact?.relation ?? "Other");
  const [type, setType] = useState<ContactType>(contact?.type ?? "ghost");
  const [isFavorite, setIsFavorite] = useState(contact?.isFavorite ?? false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Re-seed when contact changes
  useEffect(() => {
    if (!open) return;
    const split = splitE164(contact?.phone);
    setName(contact?.name ?? "");
    setCountry(split.country);
    setSubscriber(split.subscriber);
    setRelation(contact?.relation ?? "Other");
    setType(contact?.type ?? "ghost");
    setIsFavorite(contact?.isFavorite ?? false);
    setShowDeleteConfirm(false);
  }, [contact?.id, open]);

  // ── Validation ─────────────────────────────────────────────
  const nameValid = name.trim().length >= 2;
  const phoneCanonical = buildE164(country, subscriber);
  const phoneValid = isValidE164(phoneCanonical);
  const canSave = nameValid && phoneValid;

  // ── Save handler ───────────────────────────────────────────
  const handleSave = () => {
    if (!canSave) {
      if (!nameValid) toast.error("Please enter a name (at least 2 characters)");
      else if (!phoneValid) toast.error("Please enter a valid phone number");
      return;
    }
    if (contact) {
      // Update existing
      actions.update(contact.id, {
        name: name.trim(),
        phone: phoneCanonical,
        relation,
        type,
        isFavorite,
        // Keep hasApp + theirPlan in sync with type
        hasApp: type !== "ghost",
        theirPlan: type === "full" ? "pro" : "free",
      });
      // If made primary, demote others
      if (isFavorite && !contact.isFavorite) actions.setPrimary(contact.id);
      toast.success(`${name.trim()} updated`);
      onSaved?.({ ...contact, name: name.trim(), phone: phoneCanonical, relation, type, isFavorite });
    } else {
      // Add new
      const created = actions.add({
        name: name.trim(),
        phone: phoneCanonical,
        relation,
        hasApp: type !== "ghost",
        theirPlan: type === "full" ? "pro" : "free",
        isFavorite,
      });
      if (isFavorite) actions.setPrimary(created.id);
      toast.success(`${name.trim()} added`);
      onSaved?.(created);
    }
    onClose();
  };

  // ── Delete handler ──────────────────────────────────────────
  const handleDelete = () => {
    if (!contact) return;
    actions.remove(contact.id);
    toast.success(`${contact.name} removed`);
    onSaved?.(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="cedit-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(0,0,0,0.8)" }}
          />

          {/* Sheet */}
          <motion.div
            key="cedit-sheet"
            initial={{ y: "100%", opacity: 0.5 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed bottom-0 left-0 right-0 z-[51] px-5 pt-5"
            style={{
              borderRadius: "28px 28px 0 0",
              background: "rgba(10,18,32,0.99)",
              boxShadow: "inset 0 1px 0 rgba(0,200,224,0.12), 0 -8px 32px rgba(0,0,0,0.5)",
              paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)",
              maxHeight: "90vh",
              overflowY: "auto",
              overflowX: "hidden",  // AUDIT-FIX: prevents horizontal drag
              overscrollBehavior: "contain",
              scrollbarWidth: "none",
              touchAction: "pan-y",  // vertical scroll only, no horizontal pan
            }}
          >
            {/* Grabber */}
            <div className="flex justify-center mb-4">
              <div style={{ width: 36, height: 4, borderRadius: 99, background: "rgba(255,255,255,0.1)" }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-white" style={{ fontSize: 17, fontWeight: 700 }}>
                  {contact ? `Edit ${contact.name || "Contact"}` : "New Emergency Contact"}
                </p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                  {contact ? "Edit name, phone, relation or type" : "Will be alerted during SOS emergencies"}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="size-9 rounded-[11px] flex items-center justify-center"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <X className="size-[16px]" style={{ color: "rgba(255,255,255,0.5)" }} />
              </button>
            </div>

            {/* ── Name ── */}
            <label className="block mb-4">
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                Name
              </span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Sarah Johnson"
                className="mt-2 w-full px-3.5 h-12 rounded-[12px] text-white outline-none"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${nameValid || !name ? "rgba(255,255,255,0.08)" : "rgba(255,45,85,0.3)"}`,
                  fontSize: 15,
                }}
              />
            </label>

            {/* ── Phone (country + subscriber) ── */}
            <div className="mb-4">
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                Phone Number
              </span>
              <div className="mt-2 flex gap-2">
                {/* Country picker */}
                <button
                  type="button"
                  onClick={() => setShowCountryPicker(true)}
                  className="flex items-center gap-1.5 px-3 h-12 rounded-[12px]"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", minWidth: 110 }}
                >
                  <span style={{ fontSize: 18 }}>{country.flag}</span>
                  <span className="text-white" style={{ fontSize: 14, fontWeight: 600, fontFamily: "'Outfit', monospace" }}>{country.dial}</span>
                </button>
                {/* Subscriber digits */}
                <input
                  type="tel"
                  inputMode="numeric"
                  value={subscriber}
                  onChange={e => setSubscriber(e.target.value.replace(/\D/g, ""))}
                  placeholder="7728569514"
                  className="flex-1 px-3.5 h-12 rounded-[12px] text-white outline-none"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${phoneValid || !subscriber ? "rgba(255,255,255,0.08)" : "rgba(255,45,85,0.3)"}`,
                    fontSize: 15, fontFamily: "'Outfit', monospace",
                  }}
                />
              </div>
              {phoneCanonical && (
                <p style={{ fontSize: 11, color: phoneValid ? "rgba(0,200,83,0.6)" : "rgba(255,45,85,0.7)", marginTop: 6 }}>
                  {phoneValid ? `✓ ${phoneCanonical}` : "✗ Invalid — check country code and number"}
                </p>
              )}
            </div>

            {/* ── Relation ── */}
            <div className="mb-4">
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                Relationship
              </span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {RELATIONS.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRelation(r)}
                    className="px-3 h-9 rounded-[10px]"
                    style={{
                      background: relation === r ? "rgba(0,200,224,0.12)" : "rgba(255,255,255,0.03)",
                      boxShadow: `inset 0 0 0 1px ${relation === r ? "rgba(0,200,224,0.35)" : "rgba(255,255,255,0.06)"}`,
                      fontSize: 12, fontWeight: 600,
                      color: relation === r ? "#00C8E0" : "rgba(255,255,255,0.55)",
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Contact Type ── */}
            <div className="mb-4">
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                Type
              </span>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {([
                  { id: "full" as ContactType,  icon: Shield,     label: "Full",  sub: "Pro app · live GPS", color: "#00C853" },
                  { id: "lite" as ContactType,  icon: Smartphone, label: "Lite",  sub: "Free app · basic",   color: "#00C8E0" },
                  { id: "ghost" as ContactType, icon: LinkIcon,   label: "Ghost", sub: "SMS + safety link",  color: "#FF9500" },
                ]).map(t => {
                  const Icon = t.icon;
                  const active = type === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setType(t.id)}
                      className="p-2.5 rounded-[12px] flex flex-col items-center gap-1"
                      style={{
                        background: active ? `${t.color}14` : "rgba(255,255,255,0.04)",
                        boxShadow: `inset 0 0 0 1px ${active ? `${t.color}40` : "rgba(255,255,255,0.06)"}`,
                      }}
                    >
                      <Icon className="size-[16px]" style={{ color: t.color }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: active ? t.color : "#fff" }}>{t.label}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.3px" }}>{t.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Primary toggle ── */}
            <button
              type="button"
              onClick={() => setIsFavorite(!isFavorite)}
              className="w-full flex items-center justify-between px-3.5 h-12 rounded-[12px] mb-5"
              style={{
                background: isFavorite ? "rgba(0,200,224,0.08)" : "rgba(255,255,255,0.03)",
                boxShadow: `inset 0 0 0 1px ${isFavorite ? "rgba(0,200,224,0.25)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              <span className="flex items-center gap-2">
                <Star className="size-[15px]" style={{ fill: isFavorite ? "#00C8E0" : "none", color: isFavorite ? "#00C8E0" : "rgba(255,255,255,0.4)" }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: isFavorite ? "#00C8E0" : "rgba(255,255,255,0.7)" }}>
                  {isFavorite ? "Primary Contact" : "Set as primary"}
                </span>
              </span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
                Alerted first in SOS
              </span>
            </button>

            {/* ── Save / Delete ── */}
            <div className="flex gap-2">
              {contact && canDelete && !showDeleteConfirm && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center justify-center gap-1.5 px-4 h-12 rounded-[12px]"
                  style={{
                    background: "rgba(255,45,85,0.08)",
                    boxShadow: "inset 0 0 0 1px rgba(255,45,85,0.25)",
                    fontSize: 13, fontWeight: 700, color: "#FF2D55",
                  }}
                >
                  <Trash2 className="size-[15px]" />
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="flex-1 flex items-center justify-center gap-1.5 h-12 rounded-[12px] disabled:opacity-40"
                style={{
                  background: canSave ? "linear-gradient(135deg, #00C8E0, #0099B3)" : "rgba(255,255,255,0.05)",
                  fontSize: 14, fontWeight: 700, color: "#fff",
                  boxShadow: canSave ? "0 4px 14px rgba(0,200,224,0.25)" : "none",
                }}
              >
                <Check className="size-[15px]" />
                {contact ? "Save changes" : "Add contact"}
              </button>
            </div>

            {/* ── Inline delete confirm ── */}
            <AnimatePresence>
              {showDeleteConfirm && contact && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: "hidden" }}
                >
                  <div
                    className="mt-3 px-3.5 py-3 rounded-[12px] flex items-center gap-2"
                    style={{ background: "rgba(255,45,85,0.06)", boxShadow: "inset 0 0 0 1px rgba(255,45,85,0.2)" }}
                  >
                    <AlertTriangle className="size-4 shrink-0" style={{ color: "#FF2D55" }} />
                    <span className="flex-1" style={{ fontSize: 12, color: "rgba(255,255,255,0.75)" }}>
                      Delete {contact.name}?
                    </span>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-3 h-8 rounded-[8px]"
                      style={{ background: "rgba(255,255,255,0.05)", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      className="px-3 h-8 rounded-[8px]"
                      style={{ background: "#FF2D55", fontSize: 11, fontWeight: 700, color: "#fff" }}
                    >
                      Delete
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Country picker overlay - wrapped in high-z container
              so it sits ABOVE the main sheet. Without this the
              picker renders behind and looks unresponsive. */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 60,
              pointerEvents: showCountryPicker ? "auto" : "none",
            }}
          >
            <CountrySheet
              open={showCountryPicker}
              onClose={() => setShowCountryPicker(false)}
              onSelect={(c) => { setCountry(c); setShowCountryPicker(false); }}
              selected={country}
            />
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
