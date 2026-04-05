// ═══════════════════════════════════════════════════════════════
// SOSphere — Employee Invite Manager (Hybrid Zero-Cost)
// ─────────────────────────────────────────────────────────────
// Company sends invitations via its OWN email/WhatsApp
// SOSphere only prepares the message content
// No third-party sending · No QR codes · Maximum security
// ═══════════════════════════════════════════════════════════════
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Copy, Check, Mail, MessageSquare, Users,
  CheckCircle2, Link2, Shield, Zap,
  ExternalLink, UserCheck, X, Eye,
  ChevronDown, Clipboard, Share2,
  Building2, Send, ArrowRight, Lock,
} from "lucide-react";

interface Employee {
  id: string;
  name: string;
  phone: string;
  email?: string;
  zone?: string;
  role?: string;
  status?: "pending" | "sent" | "delivered" | "joined" | "failed";
}

interface EmployeeInviteManagerProps {
  employees: Employee[];
  companyName: string;
  inviteCode: string;
  companyEmail?: string; // الإيميل الرسمي للشركة
  autoSend?: boolean;
  onInvitesSent?: (method: string, count: number) => void;
  onClose?: () => void;
}

const APP_LINKS = {
  playStore: "https://play.google.com/store/apps/details?id=com.sosphere.app",
  appStore: "https://apps.apple.com/app/sosphere/id1234567890",
  universal: "https://sosphere.app/download",
};

export function EmployeeInviteManager({
  employees,
  companyName,
  inviteCode,
  companyEmail = "admin@company.com",
  onInvitesSent,
  onClose,
}: EmployeeInviteManagerProps) {
  const [activeTab, setActiveTab] = useState<"templates" | "individual" | "status">("templates");
  const [copied, setCopied] = useState<string | null>(null);
  const [showEmailFull, setShowEmailFull] = useState(false);
  const [showWhatsAppFull, setShowWhatsAppFull] = useState(false);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [markedAsSent, setMarkedAsSent] = useState<Set<string>>(new Set());
  const [confirmSent, setConfirmSent] = useState(false);

  const joinLink = `https://sosphere.app/join/${inviteCode}`;

  const copyText = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2500);
  };

  // ── Templates ──────────────────────────────────────────────
  const emailTemplate = `Subject: ${companyName} — Download SOSphere Safety App

Dear Team,

${companyName} has adopted SOSphere as our official safety platform.
Please download the app and join our company network.

Download the App:
• iPhone: ${APP_LINKS.appStore}
• Android: ${APP_LINKS.playStore}

Quick Join Link (opens app directly):
${joinLink}

Your Company Invite Code: ${inviteCode}

How to Join:
1. Download SOSphere from the link above
2. Open the app → tap "Join My Company"
3. Enter invite code: ${inviteCode}
4. Verify your phone number (must match your registered number)
5. Complete quick setup (2 minutes) → You're in!

Important: Your phone number must match the one registered in our system for automatic approval.

Best regards,
${companyName} Safety Team`;

  const whatsappTemplate = `*${companyName}* — SOSphere Safety App

Download the app:
• iPhone: ${APP_LINKS.appStore}
• Android: ${APP_LINKS.playStore}

Quick Join: ${joinLink}

Company Code: *${inviteCode}*

Steps:
1. Download SOSphere
2. Tap "Join My Company"
3. Enter code: *${inviteCode}*
4. Verify your phone number
5. Done! ✅

Your phone number must match your company record for auto-approval.`;

  // للإرسال الفردي عبر واتساب
  const getWhatsAppDirectLink = (phone: string, name: string) => {
    const cleanPhone = phone.replace(/[^0-9+]/g, "").replace("+", "");
    const msg = encodeURIComponent(
      `Hi ${name},\n\n${companyName} has added you to SOSphere safety app.\n\nDownload:\n• iPhone: ${APP_LINKS.appStore}\n• Android: ${APP_LINKS.playStore}\n\nJoin Link: ${joinLink}\nCode: ${inviteCode}\n\nOpen app → Join My Company → Enter code → Verify phone → Done!`
    );
    return `https://wa.me/${cleanPhone}?text=${msg}`;
  };

  // للإرسال الفردي عبر إيميل
  const getMailtoLink = (email: string, name: string) => {
    const subject = encodeURIComponent(`${companyName} — Join SOSphere Safety App`);
    const body = encodeURIComponent(
      `Dear ${name},\n\n${companyName} has added you to SOSphere safety platform.\n\nDownload the app:\n• iPhone: ${APP_LINKS.appStore}\n• Android: ${APP_LINKS.playStore}\n\nQuick Join: ${joinLink}\nCode: ${inviteCode}\n\nSteps:\n1. Download SOSphere\n2. Tap "Join My Company"\n3. Enter code: ${inviteCode}\n4. Verify your phone number\n5. Done!\n\nBest regards,\n${companyName} Safety Team`
    );
    return `mailto:${email}?subject=${subject}&body=${body}`;
  };

  /*
    SUPABASE_MIGRATION_POINT: invite_status
    Replace with:
    await supabase
      .from('employee_invites')
      .upsert(employees.map(e => ({
        employee_id: e.id,
        company_id: companyId,
        status: 'sent',
        method: 'company-channel',
        sent_at: new Date().toISOString(),
      })))
  */
  const handleConfirmSent = () => {
    const allIds = new Set(employees.map(e => e.id));
    setMarkedAsSent(allIds);
    setConfirmSent(true);
    console.log("[SUPABASE_READY] invite_status: marked " + employees.length + " employees as invited");
    onInvitesSent?.("company-channel", employees.length);
    setActiveTab("status");
  };

  const sentCount = markedAsSent.size;
  const totalCount = employees.length;

  return (
    <div className="space-y-4">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="size-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)" }}>
            <Share2 className="size-4" style={{ color: "#00C8E0" }} />
          </div>
          <div>
            <h3 className="text-white" style={{ fontSize: 17, fontWeight: 800 }}>Invite Employees</h3>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>
              {totalCount} employees · via <span style={{ color: "#00C8E0" }}>{companyName}</span>
            </p>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.05)" }}>
            <X className="size-4" style={{ color: "rgba(255,255,255,0.3)" }} />
          </button>
        )}
      </div>

      {/* ── How It Works ───────────────────────────────────── */}
      <div className="p-3.5 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(0,200,224,0.04), rgba(123,94,255,0.02))", border: "1px solid rgba(0,200,224,0.1)" }}>
        <div className="flex items-start gap-3">
          <div className="size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: "rgba(0,200,224,0.08)" }}>
            <Lock className="size-3.5" style={{ color: "#00C8E0" }} />
          </div>
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0", marginBottom: 3 }}>Secure & Zero Cost</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
              SOSphere prepares the invitation message — <span style={{ color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>your company sends it from its own email or WhatsApp</span>. 
              Employees trust messages from their company. No third-party involved.
            </p>
          </div>
        </div>

        {/* Visual Flow */}
        <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: "1px solid rgba(0,200,224,0.06)" }}>
          {[
            { label: "SOSphere prepares", color: "#00C8E0" },
            { label: "You copy", color: "#7B5EFF" },
            { label: "Send from your email", color: "#FF9500" },
            { label: "Employees join", color: "#00C853" },
          ].map((step, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="size-1.5 rounded-full" style={{ background: step.color }} />
              <span style={{ fontSize: 8, fontWeight: 700, color: step.color, whiteSpace: "nowrap" }}>{step.label}</span>
              {i < 3 && <ArrowRight className="size-2.5" style={{ color: "rgba(255,255,255,0.1)" }} />}
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
        {([
          { id: "templates" as const, icon: Clipboard, label: "Copy & Send", color: "#00C8E0" },
          { id: "individual" as const, icon: UserCheck, label: "One by One", color: "#7B5EFF" },
          { id: "status" as const, icon: CheckCircle2, label: `Status${sentCount > 0 ? ` · ${sentCount}` : ""}`, color: "#00C853" },
        ]).map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg transition-all"
            style={{
              background: activeTab === tab.id ? "rgba(255,255,255,0.06)" : "transparent",
              fontSize: 11, fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? tab.color : "rgba(255,255,255,0.25)",
              border: activeTab === tab.id ? `1px solid ${tab.color}20` : "1px solid transparent",
            }}>
            <tab.icon className="size-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════ TAB: Copy & Send ═══════════════════════ */}
      <AnimatePresence mode="wait">
        {activeTab === "templates" && (
          <motion.div key="templates" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">

            {/* Invite Code */}
            <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(0,200,224,0.04)", border: "1px solid rgba(0,200,224,0.12)" }}>
              <div className="flex-1">
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontWeight: 700, letterSpacing: "1px", marginBottom: 2 }}>INVITE CODE</p>
                <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: "5px", color: "#00C8E0" }}>{inviteCode}</span>
              </div>
              <button onClick={() => copyText(inviteCode, "code")}
                className="px-3 py-2 rounded-lg flex items-center gap-1.5"
                style={{
                  background: copied === "code" ? "rgba(0,200,83,0.1)" : "rgba(0,200,224,0.1)",
                  border: `1px solid ${copied === "code" ? "rgba(0,200,83,0.25)" : "rgba(0,200,224,0.2)"}`,
                  color: copied === "code" ? "#00C853" : "#00C8E0",
                  fontSize: 11, fontWeight: 700,
                }}>
                {copied === "code" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied === "code" ? "Copied!" : "Copy"}
              </button>
            </div>

            {/* ══ Email Template Card ══ */}
            <TemplateCard
              icon={Mail}
              title="Email Template"
              subtitle={`Send from ${companyEmail}`}
              color="#7B5EFF"
              tag="RECOMMENDED"
              content={emailTemplate}
              isExpanded={showEmailFull}
              onToggle={() => setShowEmailFull(!showEmailFull)}
              onCopy={() => copyText(emailTemplate, "email")}
              copied={copied === "email"}
              copyLabel="Copy Full Email"
              copiedLabel="Copied! Paste in your email client"
              hint="Open your company email (Outlook, Gmail, etc.) → New Message → Paste → Send to your employees or distribution list"
            />

            {/* ══ WhatsApp Template Card ══ */}
            <TemplateCard
              icon={MessageSquare}
              title="WhatsApp Message"
              subtitle="Paste in company group or broadcast"
              color="#25D366"
              content={whatsappTemplate}
              isExpanded={showWhatsAppFull}
              onToggle={() => setShowWhatsAppFull(!showWhatsAppFull)}
              onCopy={() => copyText(whatsappTemplate, "whatsapp")}
              copied={copied === "whatsapp"}
              copyLabel="Copy WhatsApp Message"
              copiedLabel="Copied! Paste in WhatsApp"
              hint="Open WhatsApp → Company group or broadcast list → Paste message → Send"
            />

            {/* ══ Confirm Button ══ */}
            <motion.button whileTap={{ scale: 0.98 }} onClick={handleConfirmSent}
              className="w-full flex items-center justify-center gap-2.5 py-4 rounded-xl"
              style={{
                background: confirmSent
                  ? "rgba(0,200,83,0.08)"
                  : "linear-gradient(135deg, #00C8E0, #00A5C0)",
                border: confirmSent ? "1px solid rgba(0,200,83,0.2)" : "none",
                color: confirmSent ? "#00C853" : "#fff",
                fontSize: 14, fontWeight: 700,
                boxShadow: confirmSent ? "none" : "0 6px 24px rgba(0,200,224,0.2)",
              }}>
              {confirmSent ? (
                <><CheckCircle2 className="size-5" /> Invitations Marked as Sent</>
              ) : (
                <><Send className="size-5" /> I've Sent the Invitations</>
              )}
            </motion.button>

            {/* Info */}
            <div className="flex items-start gap-2 p-2.5 rounded-lg" style={{ background: "rgba(0,200,83,0.03)", border: "1px solid rgba(0,200,83,0.08)" }}>
              <Zap className="size-3.5 shrink-0 mt-0.5" style={{ color: "#00C853" }} />
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                <span style={{ color: "#00C853", fontWeight: 700 }}>Works for any team size</span> — 
                Whether you have 10 or 35,000 employees, just copy the message and send via your company's communication channels. One code for everyone.
              </p>
            </div>
          </motion.div>
        )}

        {/* ═══════════ TAB: Individual ═══════════════════════ */}
        {activeTab === "individual" && (
          <motion.div key="individual" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">

            <div className="flex items-center justify-between">
              <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>
                Send individually ({employees.length})
              </p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>Tap to expand</p>
            </div>

            <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
              {employees.map((emp) => {
                const isExpanded = expandedEmployee === emp.id;
                const isSent = markedAsSent.has(emp.id);

                return (
                  <div key={emp.id} className="rounded-xl overflow-hidden"
                    style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${isExpanded ? "rgba(0,200,224,0.15)" : "rgba(255,255,255,0.04)"}` }}>
                    
                    {/* Employee Row */}
                    <button
                      onClick={() => setExpandedEmployee(isExpanded ? null : emp.id)}
                      className="w-full flex items-center gap-3 px-3.5 py-3 text-left"
                    >
                      <div className="size-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{
                          background: isSent ? "rgba(0,200,83,0.08)" : "rgba(0,200,224,0.06)",
                          border: `1px solid ${isSent ? "rgba(0,200,83,0.15)" : "rgba(0,200,224,0.1)"}`,
                        }}>
                        {isSent ? (
                          <Check className="size-4" style={{ color: "#00C853" }} />
                        ) : (
                          <span style={{ fontSize: 12, fontWeight: 800, color: "#00C8E0" }}>{emp.name.charAt(0)}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white truncate" style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {emp.email && (
                            <span className="flex items-center gap-1 truncate" style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                              <Mail className="size-2.5" /> {emp.email}
                            </span>
                          )}
                          {emp.phone && (
                            <span className="flex items-center gap-1" style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                              <MessageSquare className="size-2.5" /> {emp.phone}
                            </span>
                          )}
                        </div>
                      </div>
                      {isSent && (
                        <span className="px-2 py-1 rounded-md shrink-0" style={{ background: "rgba(0,200,83,0.06)", fontSize: 9, fontWeight: 700, color: "#00C853" }}>
                          Sent
                        </span>
                      )}
                      <ChevronDown className="size-4 shrink-0" style={{
                        color: "rgba(255,255,255,0.12)",
                        transform: isExpanded ? "rotate(180deg)" : "none",
                        transition: "transform 0.2s",
                      }} />
                    </button>

                    {/* Expanded Actions */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3.5 pb-3 pt-2 flex flex-wrap gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                            
                            {/* Email */}
                            {emp.email && (
                              <a href={getMailtoLink(emp.email, emp.name)} target="_blank" rel="noopener noreferrer"
                                onClick={() => setMarkedAsSent(prev => new Set([...prev, emp.id]))}
                                className="flex items-center gap-2 px-3 py-2.5 rounded-lg no-underline"
                                style={{ background: "rgba(123,94,255,0.06)", border: "1px solid rgba(123,94,255,0.12)", color: "#7B5EFF", fontSize: 11, fontWeight: 600 }}>
                                <Mail className="size-3.5" />
                                Send via Email
                                <ExternalLink className="size-3" style={{ opacity: 0.5 }} />
                              </a>
                            )}

                            {/* WhatsApp */}
                            {emp.phone && (
                              <a href={getWhatsAppDirectLink(emp.phone, emp.name)} target="_blank" rel="noopener noreferrer"
                                onClick={() => setMarkedAsSent(prev => new Set([...prev, emp.id]))}
                                className="flex items-center gap-2 px-3 py-2.5 rounded-lg no-underline"
                                style={{ background: "rgba(37,211,102,0.06)", border: "1px solid rgba(37,211,102,0.12)", color: "#25D366", fontSize: 11, fontWeight: 600 }}>
                                <MessageSquare className="size-3.5" />
                                Send via WhatsApp
                                <ExternalLink className="size-3" style={{ opacity: 0.5 }} />
                              </a>
                            )}

                            {/* Copy personal message */}
                            <button
                              onClick={() => {
                                const personalMsg = `Hi ${emp.name},\n\n${companyName} has added you to SOSphere.\n\nDownload: ${APP_LINKS.universal}\nCode: ${inviteCode}\nJoin: ${joinLink}`;
                                copyText(personalMsg, `msg-${emp.id}`);
                                setMarkedAsSent(prev => new Set([...prev, emp.id]));
                              }}
                              className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
                              style={{
                                background: copied === `msg-${emp.id}` ? "rgba(0,200,83,0.06)" : "rgba(0,200,224,0.04)",
                                border: `1px solid ${copied === `msg-${emp.id}` ? "rgba(0,200,83,0.12)" : "rgba(0,200,224,0.08)"}`,
                                color: copied === `msg-${emp.id}` ? "#00C853" : "#00C8E0",
                                fontSize: 11, fontWeight: 600,
                              }}>
                              {copied === `msg-${emp.id}` ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                              {copied === `msg-${emp.id}` ? "Copied!" : "Copy Message"}
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* Tip for large teams */}
            {employees.length > 5 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg" style={{ background: "rgba(123,94,255,0.03)", border: "1px solid rgba(123,94,255,0.08)" }}>
                <Users className="size-3.5 shrink-0 mt-0.5" style={{ color: "#7B5EFF" }} />
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                  <span style={{ color: "#7B5EFF", fontWeight: 600 }}>Tip:</span> For large teams, use the "Copy & Send" tab — copy one message and send to all employees at once via your company email or WhatsApp group.
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══════════ TAB: Status ═══════════════════════════ */}
        {activeTab === "status" && (
          <motion.div key="status" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-3">

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Total" value={totalCount.toString()} color="#00C8E0" />
              <StatCard label="Invited" value={sentCount.toString()} color="#7B5EFF" />
              <StatCard label="Joined" value={Math.min(Math.floor(sentCount * 0.3), sentCount).toString()} color="#00C853" />
            </div>

            {/* Progress */}
            {sentCount > 0 && (
              <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>Invitation Progress</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#00C8E0" }}>
                    {Math.round((sentCount / totalCount) * 100)}%
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(sentCount / totalCount) * 100}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, #00C8E0, #00C853)" }}
                  />
                </div>
              </div>
            )}

            {/* Employee Journey */}
            <div className="p-3.5 rounded-xl" style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>What Happens Next</p>
              {[
                { step: "1", text: "You send invitation via your company's email / WhatsApp", icon: Building2, color: "#7B5EFF", done: sentCount > 0 },
                { step: "2", text: "Employee downloads SOSphere from App Store / Play Store", icon: Link2, color: "#00C8E0", done: false },
                { step: "3", text: "Employee taps 'Join My Company' → enters invite code", icon: Shield, color: "#FF9500", done: false },
                { step: "4", text: "Phone number verified → auto-matched to CSV record", icon: UserCheck, color: "#00C853", done: false },
                { step: "5", text: "Quick Setup complete → auto-approved → active employee!", icon: CheckCircle2, color: "#00C8E0", done: false },
              ].map((s, i) => (
                <div key={i} className="flex items-center gap-3 py-1.5">
                  <div className="size-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: s.done ? `${s.color}12` : `${s.color}06`,
                      border: `1px solid ${s.done ? `${s.color}25` : `${s.color}10`}`,
                    }}>
                    {s.done ? (
                      <Check className="size-3" style={{ color: s.color }} />
                    ) : (
                      <span style={{ fontSize: 9, fontWeight: 800, color: s.color }}>{s.step}</span>
                    )}
                  </div>
                  <p style={{ fontSize: 11, color: s.done ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.3)" }}>{s.text}</p>
                </div>
              ))}
            </div>

            {/* Employee list */}
            <div className="space-y-1 max-h-48 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
              {employees.map(emp => {
                const isSent = markedAsSent.has(emp.id);
                return (
                  <div key={emp.id} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.015)" }}>
                    <div className="size-7 rounded-md flex items-center justify-center shrink-0"
                      style={{ background: isSent ? "rgba(0,200,83,0.06)" : "rgba(255,255,255,0.03)" }}>
                      {isSent ? (
                        <Check className="size-3" style={{ color: "#00C853" }} />
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.15)" }}>{emp.name.charAt(0)}</span>
                      )}
                    </div>
                    <p className="flex-1 truncate" style={{ fontSize: 12, fontWeight: 600, color: isSent ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)" }}>
                      {emp.name}
                    </p>
                    <span className="px-2 py-0.5 rounded-md shrink-0" style={{
                      background: isSent ? "rgba(0,200,83,0.05)" : "rgba(255,149,0,0.05)",
                      border: `1px solid ${isSent ? "rgba(0,200,83,0.1)" : "rgba(255,149,0,0.1)"}`,
                      fontSize: 9, fontWeight: 700,
                      color: isSent ? "#00C853" : "#FF9500",
                    }}>
                      {isSent ? "Invited" : "Waiting"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Reminder */}
            {sentCount === 0 && (
              <button onClick={() => setActiveTab("templates")}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl"
                style={{ background: "rgba(0,200,224,0.06)", border: "1px solid rgba(0,200,224,0.12)", color: "#00C8E0", fontSize: 12, fontWeight: 600 }}>
                <Clipboard className="size-3.5" />
                Go to Copy & Send
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Template Card Component ─────────────────────────────────
function TemplateCard({
  icon: Icon,
  title,
  subtitle,
  color,
  tag,
  content,
  isExpanded,
  onToggle,
  onCopy,
  copied,
  copyLabel,
  copiedLabel,
  hint,
}: {
  icon: any;
  title: string;
  subtitle: string;
  color: string;
  tag?: string;
  content: string;
  isExpanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${color}18` }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ background: `${color}08` }}>
        <div className="flex items-center gap-2">
          <Icon className="size-4" style={{ color }} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
              {tag && (
                <span className="px-1.5 py-0.5 rounded" style={{ background: `${color}15`, fontSize: 8, fontWeight: 800, color }}>{tag}</span>
              )}
            </div>
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{subtitle}</p>
          </div>
        </div>
        <button onClick={onToggle}
          className="flex items-center gap-1 px-2 py-1 rounded-md"
          style={{ background: "rgba(255,255,255,0.04)", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)" }}>
          <Eye className="size-3" />
          {isExpanded ? "Hide" : "Preview"}
        </button>
      </div>

      {/* Preview */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 py-3" style={{ background: `${color}03` }}>
              <pre className="whitespace-pre-wrap" style={{
                fontSize: 10, color: "rgba(255,255,255,0.35)",
                fontFamily: "inherit", lineHeight: 1.65,
                maxHeight: 200, overflowY: "auto", scrollbarWidth: "thin",
              }}>
                {content}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions */}
      <div className="px-4 py-3" style={{ borderTop: `1px solid ${color}0A` }}>
        <button onClick={onCopy}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg mb-2"
          style={{
            background: copied ? "rgba(0,200,83,0.06)" : `${color}0A`,
            border: `1px solid ${copied ? "rgba(0,200,83,0.15)" : `${color}18`}`,
            color: copied ? "#00C853" : color,
            fontSize: 12, fontWeight: 700,
          }}>
          {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
          {copied ? copiedLabel : copyLabel}
        </button>
        <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>{hint}</p>
      </div>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-3 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      <p style={{ fontSize: 20, fontWeight: 900, color }}>{value}</p>
      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{label}</p>
    </div>
  );
}
