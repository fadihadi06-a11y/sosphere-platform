// ═══════════════════════════════════════════════════════════════
// SOSphere — Dashboard Pricing Admin Page (28th pattern app)
// ─────────────────────────────────────────────────────────────
// 2026-06-08 — Super-admin-only CRUD for the public plans table.
// Until today, pricing changes were DBA-only (raw SQL, no audit
// trail, no preview). This page wires the upsert_plan + delete_plan
// SECDEF RPCs to a real UI:
//
//   • Lists plans grouped by kind (unified, individual, addon).
//   • Inline edit modal with all 15 fields, save calls upsertPlan.
//   • Delete with double-confirm (typed plan id).
//   • Refreshes via loadPlans() on every successful mutation.
//   • Role gate: callers without role==='super_admin' see only a
//     locked notice. The page still imports cleanly so the lazy
//     bundle works for everyone — the guard is render-time, not
//     load-time.
//
// AUDIT
//   Every successful save / delete writes a row to public.audit_log
//   from inside the RPC (server-side guarantee, can't be bypassed
//   by a client bug). Surface: dashboard-audit-log-page renders
//   action=plan_created|plan_updated|plan_deleted under operation
//   ='pricing'.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from "react";
import { DollarSign, Plus, Edit3, Trash2, Save, X, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { TOKENS, TYPOGRAPHY, PageHeader } from "./design-system";
import { useT } from "./dashboard-i18n";
import { useLang } from "./useLang";
import {
  loadPlans,
  upsertPlan,
  deletePlan,
  normalizePlanInput,
  validatePlanInput,
  type PlanRow,
  type PlanKind,
  type PlanInput,
} from "./pricing-service";

interface PricingAdminPageProps {
  /** The auth user's role string (e.g. "super_admin"). Used as the
   *  render-time guard. The DB RPC enforces this too, so a forged
   *  prop only buys the attacker a 401. */
  userRole: string;
}

// ───────── PURE UI HELPERS ─────────

function formatPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function kindLabelKey(k: PlanKind): string {
  return k === "unified" ? "pradm.kind.unified" : k === "individual" ? "pradm.kind.individual" : "pradm.kind.addon";
}

const KIND_ORDER: PlanKind[] = ["unified", "individual", "addon"];

const EMPTY_INPUT: PlanInput = {
  id:                   "",
  kind:                 "unified",
  name:                 "",
  name_ar:              "",
  description:          "",
  color:                "#5856D6",
  monthly_price:        null,
  annual_price:         null,
  annual_monthly:       null,
  max_employees:        null,
  max_zones:            null,
  extra_employee_price: null,
  features:             [],
  popular:              false,
  sort_order:           100,
  active:               true,
};

function rowToInput(r: PlanRow): PlanInput {
  return {
    id:                   r.id,
    kind:                 r.kind,
    name:                 r.name,
    name_ar:              r.name_ar ?? "",
    description:          r.description ?? "",
    color:                r.color ?? "#5856D6",
    monthly_price:        r.monthly_price,
    annual_price:         r.annual_price,
    annual_monthly:       r.annual_monthly,
    max_employees:        r.max_employees,
    max_zones:            r.max_zones,
    extra_employee_price: r.extra_employee_price,
    features:             r.features.slice(),
    popular:              r.popular,
    sort_order:           r.sort_order,
    active:               true, // loadPlans only returns active rows; assume true for edit
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════
export function PricingAdminPage({ userRole }: PricingAdminPageProps) {
  const { lang } = useLang();
  const t = useT(lang);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlanInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteTypedId, setDeleteTypedId] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const allowed = userRole === "super_admin";

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await loadPlans();
      setPlans(rows);
    } catch (err) {
      setLoadError((err as Error)?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    refresh();
  }, [allowed, refresh]);

  // Auto-clear toasts after 4s.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const grouped = useMemo(() => {
    const out: Record<PlanKind, PlanRow[]> = { unified: [], individual: [], addon: [] };
    for (const p of plans) out[p.kind].push(p);
    for (const k of KIND_ORDER) out[k].sort((a, b) => a.sort_order - b.sort_order);
    return out;
  }, [plans]);

  // ───────── HANDLERS ─────────

  async function handleSave() {
    if (!editing) return;
    const normalized = normalizePlanInput(editing);
    const reason = validatePlanInput(normalized);
    if (reason) { setToast({ kind: "err", msg: reason }); return; }
    setBusy(true);
    try {
      const result = await upsertPlan(normalized);
      if (!result.ok) {
        setToast({ kind: "err", msg: result.error ?? t("pradm.toast.saveFailed") });
      } else {
        setToast({ kind: "ok", msg: `${t("pradm.toast.planPrefix")} "${normalized.id}" ${t("pradm.toast.savedSuffix")}` });
        setEditing(null);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (deleteTypedId !== id) {
      setToast({ kind: "err", msg: t("pradm.toast.idMismatch") });
      return;
    }
    setBusy(true);
    try {
      const result = await deletePlan(id);
      if (!result.ok) {
        setToast({ kind: "err", msg: result.error ?? t("pradm.toast.deleteFailed") });
      } else {
        setToast({ kind: "ok", msg: `${t("pradm.toast.planPrefix")} "${id}" ${t("pradm.toast.deletedSuffix")}` });
        setConfirmDeleteId(null);
        setDeleteTypedId("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  // ───────── RENDER: GUARD ─────────
  if (!allowed) {
    return (
      <div style={{ padding: 24 }}>
        <PageHeader
          title={t("pradm.title")}
          description={t("pradm.subtitle")}
          icon={DollarSign}
        />
        <div style={{
          marginTop: 32, padding: 32, borderRadius: TOKENS.radius.card,
          background: TOKENS.bg.surface, border: `1px solid ${TOKENS.border.subtle}`,
          textAlign: "center",
        }}>
          <Lock size={36} color={TOKENS.accent.danger} style={{ margin: "0 auto 12px" }} />
          <div style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary, marginBottom: 6 }}>
            {t("pradm.guard.title")}
          </div>
          <div style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted }}>
            {t("pradm.guard.desc")}
          </div>
        </div>
      </div>
    );
  }

  // ───────── RENDER: MAIN ─────────
  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title={t("pradm.title")}
        description={t("pradm.subtitleMain")}
        icon={DollarSign}
      />

      {/* Action bar */}
      <div style={{ display: "flex", gap: 8, marginTop: 20, marginBottom: 16 }}>
        <button
          onClick={() => setEditing({ ...EMPTY_INPUT })}
          disabled={busy || loading}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: TOKENS.radius.small,
            background: TOKENS.accent.primary, color: "#fff",
            border: "none", cursor: "pointer",
            opacity: busy ? 0.6 : 1,
            ...TYPOGRAPHY.bodySm,
          }}
        >
          <Plus size={14} /> {t("pradm.newPlan")}
        </button>
        <button
          onClick={refresh}
          disabled={busy || loading}
          style={{
            padding: "8px 14px", borderRadius: TOKENS.radius.small,
            background: TOKENS.bg.surface, color: TOKENS.text.primary,
            border: `1px solid ${TOKENS.border.subtle}`, cursor: "pointer",
            opacity: busy ? 0.6 : 1,
            ...TYPOGRAPHY.bodySm,
          }}
        >
          {t("pradm.refresh")}
        </button>
      </div>

      {loadError && (
        <div style={{ padding: 12, borderRadius: TOKENS.radius.small, background: "rgba(255,45,85,0.1)", color: TOKENS.accent.danger, marginBottom: 16 }}>
          <AlertTriangle size={14} style={{ display: "inline", marginRight: 6 }} />
          {t("pradm.loadFailed")} {loadError}
        </div>
      )}

      {loading && !plans.length && (
        <div style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted }}>{t("pradm.loading")}</div>
      )}

      {/* Grouped tables */}
      {!loading && KIND_ORDER.map(kind => (
        <div key={kind} style={{ marginBottom: 32 }}>
          <div style={{ ...TYPOGRAPHY.h4, color: TOKENS.text.primary, marginBottom: 8 }}>
            {t(kindLabelKey(kind))} ({grouped[kind].length})
          </div>
          <div style={{ borderRadius: TOKENS.radius.card, overflow: "hidden", border: `1px solid ${TOKENS.border.subtle}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: TOKENS.bg.surface }}>
              <thead>
                <tr style={{ background: TOKENS.bg.elevated }}>
                  <th style={thStyle}>{t("pradm.th.id")}</th>
                  <th style={thStyle}>{t("pradm.th.name")}</th>
                  <th style={thStyle}>{t("pradm.th.monthly")}</th>
                  <th style={thStyle}>{t("pradm.th.annual")}</th>
                  <th style={thStyle}>{t("pradm.th.maxEmp")}</th>
                  <th style={thStyle}>{t("pradm.th.pop")}</th>
                  <th style={thStyle}>{t("pradm.th.sort")}</th>
                  <th style={{ ...thStyle, width: 120 }}>{t("pradm.th.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {grouped[kind].length === 0 ? (
                  <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: TOKENS.text.muted }}>{t("pradm.noPlansPrefix")} {t(kindLabelKey(kind))} {t("pradm.noPlansSuffix")}</td></tr>
                ) : grouped[kind].map(p => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${TOKENS.border.subtle}` }}>
                    <td style={{ ...tdStyle, fontFamily: "monospace", color: TOKENS.text.muted }}>{p.id}</td>
                    <td style={{ ...tdStyle, color: TOKENS.text.primary, fontWeight: 600 }}>{p.name}</td>
                    <td style={tdStyle}>{formatPrice(p.monthly_price)}</td>
                    <td style={tdStyle}>{formatPrice(p.annual_price)}</td>
                    <td style={tdStyle}>{p.max_employees ?? "—"}</td>
                    <td style={tdStyle}>{p.popular ? "★" : ""}</td>
                    <td style={tdStyle}>{p.sort_order}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => setEditing(rowToInput(p))}
                        disabled={busy}
                        style={iconBtnStyle}
                        title={t("pradm.action.edit")}
                      ><Edit3 size={13} /></button>
                      <button
                        onClick={() => { setConfirmDeleteId(p.id); setDeleteTypedId(""); }}
                        disabled={busy}
                        style={{ ...iconBtnStyle, color: TOKENS.accent.danger, marginLeft: 6 }}
                        title={t("pradm.action.delete")}
                      ><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* ───────── EDIT MODAL ───────── */}
      {editing && (
        <div style={modalScrimStyle} onClick={() => !busy && setEditing(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary }}>
                {plans.some(p => p.id === editing.id) ? t("pradm.modal.editPlan") : t("pradm.modal.newPlan")}
              </div>
              <button onClick={() => setEditing(null)} disabled={busy} style={iconBtnStyle}><X size={16} /></button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label={t("pradm.field.id")} value={editing.id} onChange={v => setEditing({ ...editing, id: v })} disabled={plans.some(p => p.id === editing.id) || busy} />
              <Field label={t("pradm.field.kind")} value={editing.kind} onChange={v => setEditing({ ...editing, kind: (v as PlanKind) })} type="select" options={["unified", "individual", "addon"]} disabled={busy} />
              <Field label={t("pradm.field.nameEn")} value={editing.name} onChange={v => setEditing({ ...editing, name: v })} disabled={busy} />
              <Field label={t("pradm.field.nameAr")} value={editing.name_ar ?? ""} onChange={v => setEditing({ ...editing, name_ar: v })} disabled={busy} />
              <Field label={t("pradm.field.description")} value={editing.description ?? ""} onChange={v => setEditing({ ...editing, description: v })} disabled={busy} fullWidth />
              <Field label={t("pradm.field.color")} value={editing.color ?? ""} onChange={v => setEditing({ ...editing, color: v })} disabled={busy} />
              <Field label={t("pradm.field.sortOrder")} value={String(editing.sort_order ?? 100)} onChange={v => setEditing({ ...editing, sort_order: Number(v) || 100 })} type="number" disabled={busy} />
              <Field label={t("pradm.field.monthlyPrice")} value={editing.monthly_price == null ? "" : String(editing.monthly_price)} onChange={v => setEditing({ ...editing, monthly_price: v === "" ? null : Number(v) })} type="number" disabled={busy} />
              <Field label={t("pradm.field.annualPrice")} value={editing.annual_price == null ? "" : String(editing.annual_price)} onChange={v => setEditing({ ...editing, annual_price: v === "" ? null : Number(v) })} type="number" disabled={busy} />
              <Field label={t("pradm.field.annualMonthly")} value={editing.annual_monthly == null ? "" : String(editing.annual_monthly)} onChange={v => setEditing({ ...editing, annual_monthly: v === "" ? null : Number(v) })} type="number" disabled={busy} />
              <Field label={t("pradm.field.maxEmployees")} value={editing.max_employees == null ? "" : String(editing.max_employees)} onChange={v => setEditing({ ...editing, max_employees: v === "" ? null : Number(v) })} type="number" disabled={busy} />
              <Field label={t("pradm.field.maxZones")} value={editing.max_zones == null ? "" : String(editing.max_zones)} onChange={v => setEditing({ ...editing, max_zones: v === "" ? null : Number(v) })} type="number" disabled={busy} />
              <Field label={t("pradm.field.extraEmpPrice")} value={editing.extra_employee_price == null ? "" : String(editing.extra_employee_price)} onChange={v => setEditing({ ...editing, extra_employee_price: v === "" ? null : Number(v) })} type="number" disabled={busy} />
              <Field label={t("pradm.field.features")} value={(editing.features ?? []).join("\n")} onChange={v => setEditing({ ...editing, features: v.split("\n").map(s => s.trim()).filter(Boolean) })} disabled={busy} fullWidth multiline />

              <label style={{ display: "flex", alignItems: "center", gap: 8, color: TOKENS.text.primary, ...TYPOGRAPHY.bodySm }}>
                <input type="checkbox" checked={editing.popular ?? false} onChange={e => setEditing({ ...editing, popular: e.target.checked })} disabled={busy} />
                {t("pradm.markPopular")}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, color: TOKENS.text.primary, ...TYPOGRAPHY.bodySm }}>
                <input type="checkbox" checked={editing.active ?? true} onChange={e => setEditing({ ...editing, active: e.target.checked })} disabled={busy} />
                {t("pradm.activeVisible")}
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button onClick={() => setEditing(null)} disabled={busy} style={{ ...btnStyle, background: TOKENS.bg.elevated, color: TOKENS.text.primary }}>{t("pradm.cancel")}</button>
              <button onClick={handleSave} disabled={busy} style={{ ...btnStyle, background: TOKENS.accent.primary, color: "#fff" }}>
                <Save size={13} style={{ marginRight: 6 }} /> {busy ? t("pradm.saving") : t("pradm.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────── DELETE CONFIRM MODAL ───────── */}
      {confirmDeleteId && (
        <div style={modalScrimStyle} onClick={() => !busy && setConfirmDeleteId(null)}>
          <div style={{ ...modalStyle, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...TYPOGRAPHY.h3, color: TOKENS.accent.danger, marginBottom: 12 }}>
              <AlertTriangle size={18} style={{ display: "inline", marginRight: 6 }} />
              {t("pradm.deleteTitlePrefix")} "{confirmDeleteId}"?
            </div>
            <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginBottom: 16 }}>
              {t("pradm.deleteBody")}
            </p>
            <input
              type="text"
              value={deleteTypedId}
              onChange={(e) => setDeleteTypedId(e.target.value)}
              placeholder={confirmDeleteId}
              disabled={busy}
              style={{
                width: "100%", padding: "8px 12px",
                background: TOKENS.bg.elevated, color: TOKENS.text.primary,
                border: `1px solid ${TOKENS.border.subtle}`,
                borderRadius: TOKENS.radius.small,
                fontFamily: "monospace",
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDeleteId(null)} disabled={busy} style={{ ...btnStyle, background: TOKENS.bg.elevated, color: TOKENS.text.primary }}>{t("pradm.cancel")}</button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={busy || deleteTypedId !== confirmDeleteId}
                style={{ ...btnStyle, background: TOKENS.accent.danger, color: "#fff", opacity: deleteTypedId !== confirmDeleteId ? 0.5 : 1 }}
              >
                <Trash2 size={13} style={{ marginRight: 6 }} /> {busy ? t("pradm.deleting") : t("pradm.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────── TOAST ───────── */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 20, right: 20,
          padding: "12px 18px", borderRadius: TOKENS.radius.small,
          background: toast.kind === "ok" ? "rgba(48,209,88,0.15)" : "rgba(255,45,85,0.15)",
          color: toast.kind === "ok" ? TOKENS.accent.success : TOKENS.accent.danger,
          border: `1px solid ${toast.kind === "ok" ? TOKENS.accent.success : TOKENS.accent.danger}40`,
          ...TYPOGRAPHY.bodySm,
          zIndex: 1000,
        }}>
          {toast.kind === "ok" ? <CheckCircle2 size={14} style={{ display: "inline", marginRight: 6 }} /> : <AlertTriangle size={14} style={{ display: "inline", marginRight: 6 }} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Form field component
// ═══════════════════════════════════════════════════════════════
interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "number" | "select";
  options?: string[];
  disabled?: boolean;
  fullWidth?: boolean;
  multiline?: boolean;
}
function Field({ label, value, onChange, type = "text", options, disabled, fullWidth, multiline }: FieldProps) {
  const wrapperStyle: React.CSSProperties = {
    display: "flex", flexDirection: "column", gap: 4,
    gridColumn: fullWidth ? "1 / -1" : undefined,
  };
  const inputStyle: React.CSSProperties = {
    padding: "8px 12px",
    background: TOKENS.bg.elevated, color: TOKENS.text.primary,
    border: `1px solid ${TOKENS.border.subtle}`,
    borderRadius: TOKENS.radius.small,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };
  return (
    <div style={wrapperStyle}>
      <label style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>{label}</label>
      {type === "select" && options ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={inputStyle}>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} rows={4} style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 12 }} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={inputStyle} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Shared styles
// ═══════════════════════════════════════════════════════════════
const thStyle: React.CSSProperties = {
  padding: "10px 12px", textAlign: "left",
  ...TYPOGRAPHY.micro, color: TOKENS.text.muted, fontWeight: 600,
};
const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  ...TYPOGRAPHY.bodySm, color: TOKENS.text.primary,
};
const iconBtnStyle: React.CSSProperties = {
  padding: "6px 8px", borderRadius: TOKENS.radius.small,
  background: TOKENS.bg.elevated, color: TOKENS.text.primary,
  border: `1px solid ${TOKENS.border.subtle}`, cursor: "pointer",
};
const btnStyle: React.CSSProperties = {
  padding: "8px 14px", borderRadius: TOKENS.radius.small,
  border: "none", cursor: "pointer",
  ...TYPOGRAPHY.bodySm, fontWeight: 600,
  display: "inline-flex", alignItems: "center",
};
const modalScrimStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 999, padding: 20,
};
const modalStyle: React.CSSProperties = {
  background: TOKENS.bg.surface, color: TOKENS.text.primary,
  borderRadius: TOKENS.radius.card,
  border: `1px solid ${TOKENS.border.subtle}`,
  padding: 24, maxWidth: 720, width: "100%",
  maxHeight: "90vh", overflowY: "auto",
};
