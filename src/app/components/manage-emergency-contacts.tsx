// ═══════════════════════════════════════════════════════════════
// SOSphere — Manage Emergency Contacts (inline modal)
// ─────────────────────────────────────────────────────────────
// Dedicated CRUD surface over `localStorage['sosphere_emergency_contacts']`.
// This is the store the SOS fan-out reads — so the same key must be
// edited here, NOT the tier-system key used by emergency-contacts.tsx.
//
// User story this fixes:
//   "لا توجد اوبشن لتغيير رقم الاميرجنسي كونتاكت فقط عندما انشئه اول مرة"
//   (no way to change the emergency contact's number after creation)
//
// Every save runs the phone through `normalizeE164` so the value on
// disk is what Twilio will accept. If the normalizer rejects the
// input, the save is blocked with a user-visible toast — far better
// than silently persisting a number that the server will refuse at
// fan-out time (Twilio 21211, which is easy to miss).
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Plus, Edit3, Trash2, Check, Phone, AlertTriangle, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { normalizeE164 } from "./phone-utils";
import { useLang } from "./useLang";
import { CountrySheet, COUNTRIES, type Country } from "./country-picker";

// AUDIT-FIX (2026-04-18): default country = Iraq (most users). The picker
// lets the user change it — but we never again parse mystery phone
// strings for their country code. Canonical E.164 is BUILT from the
// selected dial + the subscriber digits.
const DEFAULT_COUNTRY: Country = COUNTRIES.find(c => c.code === "IQ") || COUNTRIES[0];

/**
 * Parse an already-stored E.164 phone back into {country, subscriber}
 * for the edit form. Falls back to the default country if we can't
 * identify the prefix (graceful for legacy data).
 */
function splitE164(e164: string | undefined): { country: Country; subscriber: string } {
  if (!e164) return { country: DEFAULT_COUNTRY, subscriber: "" };
  const cleaned = String(e164).trim();
  // Sort country dials by length descending so +1268 matches before +1.
  const sorted = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const c of sorted) {
    if (cleaned.startsWith(c.dial)) {
      return { country: c, subscriber: cleaned.slice(c.dial.length).replace(/\D/g, "") };
    }
  }
  return { country: DEFAULT_COUNTRY, subscriber: cleaned.replace(/\D/g, "") };
}

/**
 * Build canonical E.164 from {country, subscriber}. Strips any leading
 * zero from the subscriber (local trunk prefix that some users type),
 * then returns `<dial><subscriber-digits>`.
 */
function buildE164(country: Country, subscriber: string): string {
  const digits = subscriber.replace(/\D/g, "").replace(/^0+/, "");
  return digits ? `${country.dial}${digits}` : "";
}

interface StoredContact {
  id: number;
  name: string;
  relation?: string;
  phone: string;
  avatar?: string;
  status?: string;
  phoneInvalid?: boolean;
}

const STORAGE_KEY = "sosphere_emergency_contacts";

function loadContacts(): StoredContact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveContacts(list: StoredContact[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // storage full / private mode — surface upstream via toast
    try { toast.error("Storage unavailable — changes not saved"); } catch {}
  }
}

export function ManageEmergencyContacts({ onClose }: { onClose: () => void }) {
  const { isAr } = useLang();
  const tr = (en: string, ar: string) => (isAr ? ar : en);

  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [editing, setEditing] = useState<StoredContact | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => { setContacts(loadContacts()); }, []);

  const openAdd = () => {
    setEditing({ id: Date.now(), name: "", phone: "", relation: "" });
    setShowForm(true);
  };
  const openEdit = (c: StoredContact) => {
    setEditing({ ...c });
    setShowForm(true);
  };
  const confirmDelete = (id: number) => {
    const next = contacts.filter(c => c.id !== id);
    setContacts(next);
    saveContacts(next);
    setDeleteId(null);
    try { toast.success(tr("Contact removed", "تم حذف جهة الاتصال")); } catch {}
  };

  const handleSave = (draft: StoredContact) => {
    const name = (draft.name || "").trim();
    const rawPhone = (draft.phone || "").trim();
    if (!name || !rawPhone) {
      try { toast.error(tr("Name and phone are required", "الاسم ورقم الهاتف مطلوبان")); } catch {}
      return;
    }
    const e164 = normalizeE164(rawPhone);
    if (!e164) {
      try {
        toast.error(
          tr(
            "Invalid phone — try 07728569514 or +9647728569514",
            "رقم غير صالح — مثال: 07728569514 أو +9647728569514"
          )
        );
      } catch {}
      return;
    }
    const merged: StoredContact = {
      ...draft,
      name,
      phone: e164,
      relation: (draft.relation || "").trim() || (isAr ? "جهة طوارئ" : "Emergency"),
      phoneInvalid: false,
    };
    const existingIdx = contacts.findIndex(c => c.id === merged.id);
    const next = existingIdx >= 0
      ? contacts.map((c, i) => (i === existingIdx ? merged : c))
      : [...contacts, merged];
    setContacts(next);
    saveContacts(next);
    setShowForm(false);
    setEditing(null);
    try {
      toast.success(
        existingIdx >= 0
          ? tr("Contact updated", "تم تحديث جهة الاتصال")
          : tr("Contact added", "تم إضافة جهة الاتصال")
      );
    } catch {}
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 600 }}
        animate={{ y: 0 }}
        exit={{ y: 600 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        onClick={e => e.stopPropagation()}
        className="w-full"
        style={{
          maxHeight: "85vh",
          overflow: "hidden",
          borderRadius: "24px 24px 0 0",
          background: "#0A1220",
          border: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "none",
        }}
      >
        <div className="p-6 overflow-y-auto" style={{ maxHeight: "85vh", scrollbarWidth: "none" }}>
          <div className="w-8 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(255,255,255,0.1)" }} />

          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-white" style={{ fontSize: 18, fontWeight: 700 }}>
                {tr("Emergency Contacts", "جهات اتصال الطوارئ")}
              </h2>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                {contacts.length}{" "}
                {tr(
                  contacts.length === 1 ? "contact" : "contacts",
                  contacts.length === 1 ? "جهة" : "جهات"
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
            </button>
          </div>

          {/* Contact list */}
          <div className="space-y-2 mb-4">
            <AnimatePresence>
              {contacts.map(c => (
                <motion.div
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-2xl p-3.5"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: `1px solid ${c.phoneInvalid ? "rgba(255,150,0,0.25)" : "rgba(255,255,255,0.05)"}`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="size-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: c.phoneInvalid ? "rgba(255,150,0,0.08)" : "rgba(0,200,224,0.06)",
                        border: `1px solid ${c.phoneInvalid ? "rgba(255,150,0,0.2)" : "rgba(0,200,224,0.12)"}`,
                      }}
                    >
                      {c.phoneInvalid
                        ? <AlertTriangle className="size-4" style={{ color: "#FF9500" }} />
                        : <Phone className="size-4" style={{ color: "#00C8E0" }} />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white truncate" style={{ fontSize: 14, fontWeight: 600 }}>
                        {c.name}
                      </p>
                      <p className="truncate" style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "'Outfit', monospace", direction: "ltr" }}>
                        {c.phone || tr("(no number)", "(بدون رقم)")}
                      </p>
                      {c.relation && (
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>
                          {c.relation}
                        </p>
                      )}
                      {c.phoneInvalid && (
                        <p style={{ fontSize: 10, color: "#FF9500", marginTop: 2 }}>
                          {tr("⚠ Invalid format — tap edit to fix", "⚠ صيغة غير صالحة — اضغط تعديل للإصلاح")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => openEdit(c)}
                        className="size-8 rounded-lg flex items-center justify-center"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <Edit3 className="size-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
                      </button>
                      <button
                        onClick={() => setDeleteId(c.id)}
                        className="size-8 rounded-lg flex items-center justify-center"
                        style={{ background: "rgba(255,45,85,0.05)", border: "1px solid rgba(255,45,85,0.1)" }}
                      >
                        <Trash2 className="size-3.5" style={{ color: "rgba(255,45,85,0.6)" }} />
                      </button>
                    </div>
                  </div>

                  {/* Inline delete confirm */}
                  <AnimatePresence>
                    {deleteId === c.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div
                          className="flex items-center gap-2 mt-3 pt-3"
                          style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
                        >
                          <p style={{ fontSize: 12, color: "rgba(255,45,85,0.7)", flex: 1 }}>
                            {tr("Remove this contact?", "حذف جهة الاتصال هذه؟")}
                          </p>
                          <button
                            onClick={() => setDeleteId(null)}
                            className="px-3 py-1.5 rounded-lg"
                            style={{ background: "rgba(255,255,255,0.04)", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}
                          >
                            {tr("Cancel", "إلغاء")}
                          </button>
                          <button
                            onClick={() => confirmDelete(c.id)}
                            className="px-3 py-1.5 rounded-lg"
                            style={{ background: "rgba(255,45,85,0.1)", fontSize: 11, fontWeight: 600, color: "#FF2D55" }}
                          >
                            {tr("Remove", "حذف")}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>

            {contacts.length === 0 && (
              <div
                className="rounded-2xl p-6 text-center"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.06)" }}
              >
                <p className="text-white" style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                  {tr("No emergency contacts yet", "لا توجد جهات اتصال طوارئ")}
                </p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                  {tr("Tap the button below to add your first contact.", "اضغط الزر أدناه لإضافة أول جهة.")}
                </p>
              </div>
            )}
          </div>

          {/* Add button */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={openAdd}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl"
            style={{
              background: "rgba(0,200,224,0.06)",
              border: "1px dashed rgba(0,200,224,0.2)",
              fontSize: 14, fontWeight: 600,
              color: "#00C8E0",
            }}
          >
            <Plus className="size-4" />
            {tr("Add Emergency Contact", "إضافة جهة اتصال طوارئ")}
          </motion.button>

          <div className="h-4" />
        </div>

        {/* Edit/Add form */}
        <AnimatePresence>
          {showForm && editing && (
            <ContactForm
              draft={editing}
              isAr={isAr}
              onCancel={() => { setShowForm(false); setEditing(null); }}
              onSave={handleSave}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// ── Form ───────────────────────────────────────────────────────

function ContactForm({
  draft, isAr, onCancel, onSave,
}: {
  draft: StoredContact;
  isAr: boolean;
  onCancel: () => void;
  onSave: (d: StoredContact) => void;
}) {
  const tr = (en: string, ar: string) => (isAr ? ar : en);
  const [name, setName] = useState(draft.name || "");
  // AUDIT-FIX: split phone into country + subscriber. Parse an
  // existing stored E.164 back into its components for edit.
  const initial = splitE164(draft.phone);
  const [country, setCountry] = useState<Country>(initial.country);
  const [subscriber, setSubscriber] = useState(initial.subscriber);
  const [relation, setRelation] = useState(draft.relation || "");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Canonical E.164 form the rest of the app consumes.
  const phone = buildE164(country, subscriber);

  const isNew = !draft.name && !draft.phone;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 flex items-end"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ y: 400 }}
        animate={{ y: 0 }}
        exit={{ y: 400 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="w-full"
        onClick={e => e.stopPropagation()}
        style={{ borderRadius: "24px 24px 0 0", background: "#0A1220", border: "1px solid rgba(255,255,255,0.08)", borderBottom: "none" }}
      >
        <div className="p-6">
          <div className="w-8 h-1 rounded-full mx-auto mb-4" style={{ background: "rgba(255,255,255,0.1)" }} />
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-white" style={{ fontSize: 16, fontWeight: 700 }}>
              {isNew ? tr("Add Contact", "إضافة جهة اتصال") : tr("Edit Contact", "تعديل جهة الاتصال")}
            </h3>
            <button
              onClick={onCancel}
              className="size-8 rounded-full flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>
                {tr("NAME", "الاسم")}
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={tr("Full name", "الاسم الكامل")}
                className="w-full mt-1.5 px-4 py-3 text-white outline-none"
                style={{
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  fontSize: 14,
                  direction: isAr ? "rtl" : "ltr",
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>
                {tr("PHONE NUMBER", "رقم الهاتف")}
              </label>
              <div className="flex gap-2 mt-1.5" dir="ltr">
                {/* Country code trigger */}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex items-center gap-2 px-3 py-3 text-white outline-none"
                  style={{
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    fontSize: 14,
                    minWidth: 110,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{country.flag}</span>
                  <span style={{ fontFamily: "'Outfit', monospace", fontWeight: 600 }}>{country.dial}</span>
                  <ChevronDown className="size-3.5 ml-auto" style={{ color: "rgba(255,255,255,0.4)" }} />
                </button>
                {/* Subscriber number (digits only — the dial is guaranteed) */}
                <input
                  value={subscriber}
                  onChange={e => setSubscriber(e.target.value.replace(/\D/g, ""))}
                  placeholder="7728569514"
                  type="tel"
                  inputMode="numeric"
                  dir="ltr"
                  className="flex-1 px-4 py-3 text-white outline-none"
                  style={{
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    fontSize: 14,
                    fontFamily: "'Outfit', monospace",
                  }}
                />
              </div>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4, fontFamily: "'Outfit', monospace" }}>
                {subscriber
                  ? tr("Will dial: ", "سيتّصل بـ: ") + (phone || "—")
                  : tr("Type the local number (digits only)", "اكتب الرقم المحلي (أرقام فقط)")
                }
              </p>
            </div>

            {/* Country picker sheet */}
            <CountrySheet
              open={pickerOpen}
              selected={country}
              onSelect={(c) => { setCountry(c); setPickerOpen(false); }}
              onClose={() => setPickerOpen(false)}
            />

            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.2)", letterSpacing: "0.5px" }}>
                {tr("RELATION (optional)", "الصلة (اختياري)")}
              </label>
              <input
                value={relation}
                onChange={e => setRelation(e.target.value)}
                placeholder={tr("e.g. Wife, Brother, Friend", "مثال: زوجة، أخ، صديق")}
                className="w-full mt-1.5 px-4 py-3 text-white outline-none"
                style={{
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  fontSize: 14,
                  direction: isAr ? "rtl" : "ltr",
                }}
              />
            </div>
          </div>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onSave({ ...draft, name, phone, relation })}
            disabled={!name.trim() || !phone.trim()}
            className="w-full flex items-center justify-center gap-2 py-3.5 mt-5"
            style={{
              borderRadius: 14,
              background: name.trim() && phone.trim()
                ? "linear-gradient(135deg, #00C8E0, #0099B3)"
                : "rgba(255,255,255,0.04)",
              fontSize: 15, fontWeight: 700,
              color: name.trim() && phone.trim() ? "#fff" : "rgba(255,255,255,0.2)",
              boxShadow: name.trim() && phone.trim() ? "0 8px 22px rgba(0,200,224,0.25)" : "none",
            }}
          >
            <Check className="size-4" />
            {isNew ? tr("Add", "إضافة") : tr("Save Changes", "حفظ التعديلات")}
          </motion.button>

          <div className="h-4" />
        </div>
      </motion.div>
    </motion.div>
  );
}
