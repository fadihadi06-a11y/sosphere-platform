import { useState, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, User, Phone, ShieldPlus, Plus, X, Check } from "lucide-react";
import { storeJSONSync } from "./api/storage-adapter";
import { useLang } from "./useLang";

interface IndividualRegisterProps {
  onComplete: (data: { name: string; phone: string; contacts: { name: string; phone: string }[] }) => void;
  onBack: () => void;
  initialPhone?: string;
}

interface EmergencyContact {
  id: number;
  name: string;
  phone: string;
}

export function IndividualRegister({ onComplete, onBack, initialPhone = "" }: IndividualRegisterProps) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState(initialPhone);
  const [contacts, setContacts] = useState<EmergencyContact[]>([
    { id: 1, name: "", phone: "" },
  ]);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nextId = useRef(2);

  const { isAr } = useLang();

  const addContact = () => {
    if (contacts.length >= 5) return;
    setContacts([...contacts, { id: nextId.current++, name: "", phone: "" }]);
  };

  const removeContact = (id: number) => {
    if (contacts.length <= 1) return;
    setContacts(contacts.filter((c) => c.id !== id));
  };

  const updateContact = (id: number, field: "name" | "phone", value: string) => {
    setContacts(contacts.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  const isValid = fullName.trim().length >= 2 && phone.length >= 8;

  const handleSubmit = () => {
    if (!isValid) return;
    setSubmitting(true);
    // ── FIX 3: Persist individual profile to localStorage ──
    const profileData = {
      name: fullName.trim(),
      phone: phone.trim(),
      contacts: contacts.filter(c => c.name.trim() && c.phone.trim()).map(c => ({ name: c.name.trim(), phone: c.phone.trim() })),
      registeredAt: Date.now(),
    };
    storeJSONSync("sosphere_individual_profile", profileData);
    setTimeout(() => onComplete({ name: profileData.name, phone: profileData.phone, contacts: profileData.contacts }), 1500);
  };

  const inputStyle = (fieldKey: string) => ({
    borderRadius: "14px",
    background: "rgba(255,255,255,0.025)",
    backdropFilter: "blur(20px)" as const,
    border: focusedField === fieldKey
      ? "1.5px solid rgba(0,200,224,0.3)"
      : "1.5px solid rgba(255,255,255,0.05)",
    boxShadow: focusedField === fieldKey
      ? "0 0 0 4px rgba(0,200,224,0.04)"
      : "none",
    transition: "all 0.35s ease",
  });

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* Ambient */}
      <div
        className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[450px] h-[350px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(0,200,224,0.04) 0%, transparent 60%)" }}
      />

      <div className="flex-1 flex flex-col relative z-10 overflow-hidden">
        {/* Fixed Header */}
        <div className="px-6 pt-14 pb-4 shrink-0">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-2 mb-5">
            <div className="size-2 rounded-full" style={{ background: "rgba(0,200,224,0.4)" }}>
              <div className="size-2 rounded-full" style={{ background: "#00C8E0" }} />
            </div>
            <div className="w-6 h-[2px] rounded-full" style={{ background: "rgba(0,200,224,0.2)" }} />
            <div className="size-2 rounded-full" style={{ background: "#00C8E0" }} />
            <div className="w-6 h-[2px] rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
            <div className="size-2 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
          </div>

          {/* Back + Title */}
          <motion.button
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={onBack}
            className="flex items-center gap-1.5 mb-5 group"
            style={{ color: "rgba(255,255,255,0.35)", fontSize: "13px", fontWeight: 500 }}
          >
            <ArrowLeft className="size-4 group-hover:-translate-x-0.5 transition-transform" />
            {isAr ? "رجوع" : "Back"}
          </motion.button>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center gap-2.5 mb-1.5">
              <h1 className="text-white" style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.4px" }}>
                إنشاء حسابك
              </h1>
            </div>
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
              Set up your personal safety profile
            </p>
          </motion.div>
        </div>

        {/* Scrollable Form */}
        <div className="flex-1 overflow-y-auto px-6 pb-6" style={{ scrollbarWidth: "none" }}>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="space-y-5 pt-2"
          >
            {/* الاسم الكامل */}
            <div>
              <label
                className="flex items-center gap-1.5 mb-2.5"
                style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "0.3px" }}
              >
                <User className="size-3" />
                الاسم الكامل
              </label>
              <div style={inputStyle("name")}>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onFocus={() => setFocusedField("name")}
                  onBlur={() => setFocusedField(null)}
                  placeholder="أدخل اسمك الكامل"
                  className="w-full bg-transparent text-white outline-none px-4 py-[14px]"
                  style={{ fontSize: "15px", fontFamily: "inherit", caretColor: "#00C8E0" }}
                />
              </div>
            </div>

            {/* رقم الهاتف */}
            <div>
              <label
                className="flex items-center gap-1.5 mb-2.5"
                style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "0.3px" }}
              >
                <Phone className="size-3" />
                رقم الهاتف
              </label>
              <div style={inputStyle("phone")}>
                <div className="flex items-center">
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                    onFocus={() => setFocusedField("phone")}
                    onBlur={() => setFocusedField(null)}
                    placeholder="5XX XXX XXXX"
                    className="flex-1 bg-transparent text-white outline-none px-3 py-[14px]"
                    style={{ fontSize: "15px", fontFamily: "inherit", letterSpacing: "1px", caretColor: "#00C8E0" }}
                  />
                </div>
              </div>
            </div>

            {/* جهة اتصال الطوارئ */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label
                  className="flex items-center gap-1.5"
                  style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", fontWeight: 500, letterSpacing: "0.3px" }}
                >
                  <ShieldPlus className="size-3" />
                  جهة اتصال الطوارئ
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.15)" }}>
                    ({contacts.length}/5)
                  </span>
                </label>
                <span
                  style={{
                    fontSize: "10px",
                    color: "rgba(255,255,255,0.18)",
                    fontWeight: 500,
                    padding: "2px 8px",
                    borderRadius: "6px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {isAr ? "اختياري" : "Optional"}
                </span>
              </div>

              <div className="space-y-3">
                <AnimatePresence>
                  {contacts.map((contact, i) => (
                    <motion.div
                      key={contact.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div
                        className="p-3.5 space-y-2.5"
                        style={{
                          borderRadius: "16px",
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.04)",
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: "11px", color: "rgba(0,200,224,0.5)", fontWeight: 600 }}>
                            {isAr ? `جهة ${i + 1}` : `Contact ${i + 1}`}
                            {i === 0 && (
                              <span style={{ color: "rgba(255,255,255,0.12)", fontWeight: 400 }}> · {isAr ? "أساسية" : "Primary"}</span>
                            )}
                          </span>
                          {contacts.length > 1 && (
                            <button
                              onClick={() => removeContact(contact.id)}
                              className="p-1 rounded-md transition-colors"
                              style={{ color: "rgba(255,255,255,0.15)" }}
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </div>
                        <div style={inputStyle(`c-name-${contact.id}`)}>
                          <input
                            type="text"
                            value={contact.name}
                            onChange={(e) => updateContact(contact.id, "name", e.target.value)}
                            onFocus={() => setFocusedField(`c-name-${contact.id}`)}
                            onBlur={() => setFocusedField(null)}
                            placeholder="الاسم"
                            className="w-full bg-transparent text-white outline-none px-3.5 py-[11px]"
                            style={{ fontSize: "14px", fontFamily: "inherit", caretColor: "#00C8E0" }}
                          />
                        </div>
                        <div style={inputStyle(`c-phone-${contact.id}`)}>
                          <input
                            type="tel"
                            value={contact.phone}
                            onChange={(e) => updateContact(contact.id, "phone", e.target.value.replace(/\D/g, ""))}
                            onFocus={() => setFocusedField(`c-phone-${contact.id}`)}
                            onBlur={() => setFocusedField(null)}
                            placeholder="رقم الهاتف"
                            className="w-full bg-transparent text-white outline-none px-3.5 py-[11px]"
                            style={{ fontSize: "14px", fontFamily: "inherit", letterSpacing: "0.5px", caretColor: "#00C8E0" }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>

                {contacts.length < 5 && (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={addContact}
                    className="w-full flex items-center justify-center gap-2 py-3 transition-all duration-300"
                    style={{
                      borderRadius: "14px",
                      border: "1.5px dashed rgba(255,255,255,0.06)",
                      background: "transparent",
                      fontSize: "13px",
                      color: "rgba(255,255,255,0.2)",
                      fontWeight: 500,
                    }}
                  >
                    <Plus className="size-3.5" />
                    {isAr ? "إضافة جهة اتصال" : "Add Contact"}
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Fixed CTA */}
        <div
          className="px-6 pt-3 pb-10 shrink-0"
          style={{
            background: "linear-gradient(180deg, transparent, rgba(5,7,14,0.95) 25%)",
          }}
        >
          {!isValid && !submitting && (
            <p
              className="text-center mb-3"
              style={{ fontSize: "11px", color: "rgba(255,45,85,0.6)", letterSpacing: "0.1px" }}
            >
              {fullName.trim().length < 2
                ? "أدخل اسمك الكامل to continue"
                : "Enter a valid phone number (8+ digits)"}
            </p>
          )}
          <motion.button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            whileTap={isValid && !submitting ? { scale: 0.97 } : {}}
            className="w-full flex items-center justify-center gap-2.5 transition-all duration-500"
            style={{
              padding: "16px",
              borderRadius: "16px",
              background: isValid
                ? submitting
                  ? "linear-gradient(135deg, #00C853 0%, #009940 100%)"
                  : "linear-gradient(135deg, #00C8E0 0%, #00A5C0 100%)"
                : "rgba(255,255,255,0.03)",
              color: isValid ? "#fff" : "rgba(255,255,255,0.15)",
              fontSize: "15px",
              fontWeight: 600,
              boxShadow: isValid
                ? submitting
                  ? "0 8px 32px rgba(0,200,83,0.25)"
                  : "0 8px 32px rgba(0,200,224,0.25)"
                : "none",
              border: isValid ? "none" : "1px solid rgba(255,255,255,0.04)",
              cursor: isValid && !submitting ? "pointer" : "default",
            }}
          >
            {submitting ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                  className="size-[18px] rounded-full"
                  style={{ border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff" }}
                />
                جاري الإنشاء...
              </>
            ) : (
              <>
                {isAr ? "إنشاء حسابي" : "Create Account"}
                <Check className="size-[17px]" />
              </>
            )}
          </motion.button>
        </div>
      </div>
    </div>
  );
}