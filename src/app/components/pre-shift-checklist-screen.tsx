// ═══════════════════════════════════════════════════════════════
// SOSphere — Worker Pre-Shift Checklist (mobile)
// ─────────────────────────────────────────────────────────────
// The worker confirms each safety item before starting the shift, then submits.
// The submission persists to public.checklist_submissions (real compliance
// record). Required items the worker can't confirm are auto-flagged so the
// admin dashboard sees the real safety gap. No fabricated data.
// ═══════════════════════════════════════════════════════════════
import { useState, useMemo } from "react";
import { motion } from "motion/react";
import {
  ChevronRight, ChevronLeft, CheckCircle2, Circle, AlertTriangle,
  Shield, HardHat, Settings, MapPin, Activity, Loader2, ClipboardCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useLang } from "./useLang";
import { hapticSuccess } from "./haptic-feedback";
import {
  DEFAULT_CHECKLIST_TEMPLATES, CATEGORY_META, requiredItemIds,
  type ChecklistCategory,
} from "./checklist-templates";
import { submitChecklistSubmission } from "./checklist-service";

const CATEGORY_ICON: Record<ChecklistCategory, any> = {
  ppe: HardHat, equipment: Settings, environment: MapPin, communication: Activity, medical: Shield,
};

export function PreShiftChecklistScreen({ companyId, employeeId, employeeName, zone, onBack }: {
  companyId: string;
  employeeId: string;
  employeeName: string;
  zone?: string;
  onBack: () => void;
}) {
  const { isAr } = useLang();

  const [templateId, setTemplateId] = useState<string>(() => {
    const zoneMatch = DEFAULT_CHECKLIST_TEMPLATES.find(
      t => t.zone && zone && t.zone.toLowerCase() === zone.toLowerCase(),
    );
    return (zoneMatch || DEFAULT_CHECKLIST_TEMPLATES[0]).id;
  });
  const template = DEFAULT_CHECKLIST_TEMPLATES.find(t => t.id === templateId) || DEFAULT_CHECKLIST_TEMPLATES[0];

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { isComplete: boolean; flaggedCount: number }>(null);

  const required = useMemo(() => requiredItemIds(template), [template]);
  const flagged = required.filter(id => !checked.has(id));
  const isComplete = flagged.length === 0;
  const completedCount = template.items.filter(i => checked.has(i.id)).length;
  const progress = Math.round((completedCount / template.items.length) * 100);

  const toggle = (id: string) => setChecked(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const switchTemplate = (id: string) => { setTemplateId(id); setChecked(new Set()); };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!companyId) {
      toast.error(isAr ? "لا توجد شركة مرتبطة بحسابك" : "No company linked to your account");
      return;
    }
    setSubmitting(true);
    const res = await submitChecklistSubmission({
      companyId, employeeId, employeeName,
      templateId: template.id, templateName: template.name,
      completedItems: template.items.filter(i => checked.has(i.id)).map(i => i.id),
      flaggedItems: flagged,
      totalItems: template.items.length,
      isComplete, zone,
    });
    setSubmitting(false);
    if (res.ok) {
      hapticSuccess();
      setDone({ isComplete, flaggedCount: flagged.length });
    } else {
      toast.error(isAr ? "تعذّر الإرسال، حاول مجدداً" : "Could not submit — please try again");
    }
  };

  // ── Success state ──────────────────────────────────────────────
  if (done) {
    const ok = done.isComplete;
    const col = ok ? "#00C853" : "#FF9500";
    return (
      <div className="app-screen" style={{ background: "#05070E", fontFamily: "'Tajawal','Outfit',sans-serif" }}>
        <div className="flex flex-col items-center justify-center h-full px-8 text-center" style={{ direction: isAr ? "rtl" : "ltr" }}>
          <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            style={{ width: 84, height: 84, borderRadius: 24, background: `${col}14`, border: `1px solid ${col}30`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
            {ok ? <CheckCircle2 size={40} color={col} /> : <AlertTriangle size={38} color={col} />}
          </motion.div>
          <p style={{ fontSize: 19, fontWeight: 800, color: "#fff", marginBottom: 8 }}>
            {ok ? (isAr ? "تم تأكيد الفحص" : "Checklist confirmed") : (isAr ? "تم الإرسال مع ملاحظات" : "Submitted with flags")}
          </p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,.45)", lineHeight: 1.6, marginBottom: 28 }}>
            {ok
              ? (isAr ? "كل بنود السلامة الإلزامية مؤكدة. وردِيّتك آمنة للبدء." : "All required safety items confirmed. You're cleared to start your shift.")
              : (isAr ? `${done.flaggedCount} بند إلزامي غير مؤكد — تم تنبيه المشرف لمراجعته.` : `${done.flaggedCount} required item(s) unconfirmed — your supervisor has been notified to review.`)}
          </p>
          <button onClick={onBack} className="touch-target" style={{ width: "100%", maxWidth: 280, padding: "15px", borderRadius: 16, background: col, color: "#04240F", fontSize: 15, fontWeight: 800, border: "none" }}>
            {isAr ? "تم" : "Done"}
          </button>
        </div>
      </div>
    );
  }

  // ── Checklist form ─────────────────────────────────────────────
  const BackIcon = isAr ? ChevronRight : ChevronLeft;
  return (
    <div className="app-screen" style={{ background: "#05070E", fontFamily: "'Tajawal','Outfit',sans-serif" }}>
      <div className="scroll-area" style={{ paddingBottom: 110 }}>
        <div style={{ paddingTop: "max(14px,env(safe-area-inset-top))" }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-5 mb-4" style={{ direction: isAr ? "rtl" : "ltr" }}>
            <button onClick={onBack} className="touch-target" style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BackIcon size={20} color="rgba(255,255,255,.6)" />
            </button>
            <div className="flex items-center gap-2.5 flex-1" style={{ flexDirection: isAr ? "row-reverse" : "row" }}>
              <ClipboardCheck size={22} color="#00C8E0" />
              <div style={{ textAlign: isAr ? "right" : "left" }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{isAr ? "فحص ما قبل الوردية" : "Pre-Shift Checklist"}</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,.3)" }}>{template.name}{zone ? ` · ${zone}` : ""}</p>
              </div>
            </div>
          </div>

          {/* Template switcher (only if more than one) */}
          {DEFAULT_CHECKLIST_TEMPLATES.length > 1 && (
            <div className="px-5 mb-4 flex gap-2" style={{ direction: isAr ? "rtl" : "ltr", flexWrap: "wrap" }}>
              {DEFAULT_CHECKLIST_TEMPLATES.map(t => {
                const active = t.id === template.id;
                return (
                  <button key={t.id} onClick={() => switchTemplate(t.id)} style={{ padding: "7px 12px", borderRadius: 10, background: active ? "rgba(0,200,224,.12)" : "rgba(255,255,255,.03)", border: `1px solid ${active ? "rgba(0,200,224,.3)" : "rgba(255,255,255,.06)"}` }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: active ? "#00C8E0" : "rgba(255,255,255,.4)" }}>{t.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Progress */}
          <div className="px-5 mb-5" style={{ direction: isAr ? "rtl" : "ltr" }}>
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,.5)" }}>
                {isAr ? `${completedCount} من ${template.items.length} مؤكد` : `${completedCount} of ${template.items.length} confirmed`}
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, color: isComplete ? "#00C853" : "#FF9500" }}>{progress}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,.06)", overflow: "hidden" }}>
              <motion.div animate={{ width: `${progress}%` }} style={{ height: "100%", borderRadius: 999, background: isComplete ? "#00C853" : "#FF9500" }} />
            </div>
          </div>

          {/* Items */}
          <div className="px-5" style={{ display: "flex", flexDirection: "column", gap: 8, direction: isAr ? "rtl" : "ltr" }}>
            {template.items.map(item => {
              const on = checked.has(item.id);
              const Icon = CATEGORY_ICON[item.category];
              const meta = CATEGORY_META[item.category];
              return (
                <motion.button key={item.id} whileTap={{ scale: .985 }} onClick={() => toggle(item.id)}
                  className="w-full flex items-center gap-3"
                  style={{ padding: "13px 14px", borderRadius: 14, background: on ? "rgba(0,200,83,.06)" : "rgba(255,255,255,.03)", border: `1px solid ${on ? "rgba(0,200,83,.25)" : "rgba(255,255,255,.06)"}`, flexDirection: isAr ? "row-reverse" : "row" }}>
                  {on ? <CheckCircle2 size={22} color="#00C853" style={{ flexShrink: 0 }} /> : <Circle size={22} color="rgba(255,255,255,.25)" style={{ flexShrink: 0 }} />}
                  <div className="flex-1" style={{ textAlign: isAr ? "right" : "left" }}>
                    <p style={{ fontSize: 13.5, fontWeight: 600, color: on ? "#fff" : "rgba(255,255,255,.7)", lineHeight: 1.4 }}>{item.text}</p>
                    <div className="flex items-center gap-1.5 mt-1" style={{ flexDirection: isAr ? "row-reverse" : "row" }}>
                      <Icon size={11} color={meta.color} />
                      <span style={{ fontSize: 9.5, color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                      {item.required && <span style={{ fontSize: 9, color: "#FF2D55", fontWeight: 700 }}>{isAr ? "• إلزامي" : "• Required"}</span>}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* Flag notice */}
          {flagged.length > 0 && (
            <div className="px-5 mt-4" style={{ direction: isAr ? "rtl" : "ltr" }}>
              <div className="flex items-start gap-2" style={{ padding: "11px 13px", borderRadius: 12, background: "rgba(255,149,0,.06)", border: "1px solid rgba(255,149,0,.18)", flexDirection: isAr ? "row-reverse" : "row" }}>
                <AlertTriangle size={15} color="#FF9500" style={{ flexShrink: 0, marginTop: 1 }} />
                <p style={{ fontSize: 11, color: "rgba(255,255,255,.5)", lineHeight: 1.5, textAlign: isAr ? "right" : "left" }}>
                  {isAr ? `${flagged.length} بند إلزامي غير مؤكد. يمكنك الإرسال، وسيُعلَّم للمشرف للمراجعة.` : `${flagged.length} required item(s) not yet confirmed. You can still submit — they'll be flagged for your supervisor.`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Submit bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "14px 20px max(14px,env(safe-area-inset-bottom))", background: "linear-gradient(to top,#05070E 60%,transparent)", direction: isAr ? "rtl" : "ltr" }}>
        <button onClick={handleSubmit} disabled={submitting} className="touch-target w-full flex items-center justify-center gap-2"
          style={{ padding: "15px", borderRadius: 16, background: isComplete ? "#00C853" : "#FF9500", color: isComplete ? "#04240F" : "#221400", fontSize: 15, fontWeight: 800, border: "none", opacity: submitting ? 0.7 : 1 }}>
          {submitting && <Loader2 size={17} className="animate-spin" />}
          {submitting ? (isAr ? "جارٍ الإرسال…" : "Submitting…") : isComplete ? (isAr ? "تأكيد وإرسال" : "Confirm & Submit") : (isAr ? "إرسال مع ملاحظات" : "Submit with flags")}
        </button>
      </div>
    </div>
  );
}
