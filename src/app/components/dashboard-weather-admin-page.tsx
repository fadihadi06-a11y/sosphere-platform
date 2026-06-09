// ═══════════════════════════════════════════════════════════════
// SOSphere — Dashboard Weather Admin Page (29th pattern phase 3)
// ─────────────────────────────────────────────────────────────
// 2026-06-08 — Super-admin-only CRUD for weather_fetch_schedule.
// Mirrors Pricing Admin (28th pattern app) shape exactly:
//
//   • Lists schedules for the company.
//   • Inline edit modal: lat/lng/freq/zone/enabled.
//   • Delete with double-confirm (typed schedule id).
//   • "Fetch now" button to trigger a manual observation
//     (calls requestObservation, useful for verifying setup).
//   • Refreshes via loadSchedules() on every successful mutation.
//   • Role gate: render-time userRole === "super_admin".
//
// COMPANIONS
//   • Schedules are managed via upsert_weather_schedule RPC
//     (super_admin gated server-side).
//   • Manual fetches call weather-fetch?action=user — these use
//     the caller's JWT and write through record_weather_observation
//     (auth.uid() enforced).
//   • Cron sweeps run independently every 15 min via pg_cron.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from "react";
import { CloudLightning, Plus, Edit3, Trash2, Save, X, AlertTriangle, CheckCircle2, Lock, RefreshCw, Zap } from "lucide-react";
import { TOKENS, TYPOGRAPHY, PageHeader } from "./design-system";
import {
  loadSchedules,
  upsertSchedule,
  deleteSchedule,
  requestObservation,
  validateScheduleInput,
  nextFetchAt,
  formatTimeUntil,
  type WeatherScheduleRow,
  type WeatherScheduleInput,
} from "./weather-service";

interface WeatherAdminPageProps {
  /** The auth user's role (e.g. "super_admin"). Render-time gate.
   *  DB RPC enforces the real check; a forged prop only buys a 401. */
  userRole:  string;
  /** Current company's UUID — all schedules scoped to this. */
  companyId: string;
}

// ───────── PURE UI HELPERS ─────────

function formatLastFetched(ts: string | null, nowMs: number = Date.now()): string {
  if (!ts) return "never";
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "—";
  const diff = nowMs - t;
  if (diff < 60_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

const EMPTY_INPUT = (companyId: string): WeatherScheduleInput => ({
  companyId,
  zoneId:           null,
  lat:              0,
  lng:              0,
  frequencyMinutes: 60,
  enabled:          true,
});

function rowToInput(r: WeatherScheduleRow): WeatherScheduleInput {
  return {
    companyId:        r.company_id,
    zoneId:           r.zone_id,
    lat:              r.lat,
    lng:              r.lng,
    frequencyMinutes: r.frequency_minutes,
    enabled:          r.enabled,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════
export function WeatherAdminPage({ userRole, companyId }: WeatherAdminPageProps) {
  const [schedules, setSchedules] = useState<WeatherScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ input: WeatherScheduleInput; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WeatherScheduleRow | null>(null);
  const [deleteTypedId, setDeleteTypedId] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);

  const allowed = userRole === "super_admin";

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await loadSchedules(companyId);
      setSchedules(rows);
    } catch (err) {
      setLoadError((err as Error)?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!allowed) { setLoading(false); return; }
    refresh();
  }, [allowed, refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const enabledCount = useMemo(() => schedules.filter(s => s.enabled).length, [schedules]);
  const dueCount = useMemo(() => {
    const now = Date.now();
    return schedules.filter(s => s.enabled && (!s.last_fetched_at || Date.parse(s.last_fetched_at) + s.frequency_minutes * 60_000 <= now)).length;
  }, [schedules]);

  // ───────── HANDLERS ─────────

  async function handleSave() {
    if (!editing) return;
    const reason = validateScheduleInput(editing.input);
    if (reason) { setToast({ kind: "err", msg: reason }); return; }
    setBusy(true);
    try {
      const result = await upsertSchedule(editing.input);
      if (!result.ok) {
        setToast({ kind: "err", msg: result.error ?? "Save failed" });
      } else {
        setToast({ kind: "ok", msg: `Schedule for "${editing.input.zoneId ?? "site"}" saved` });
        setEditing(null);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(row: WeatherScheduleRow) {
    if (deleteTypedId !== row.id) {
      setToast({ kind: "err", msg: "Typed id does not match" });
      return;
    }
    setBusy(true);
    try {
      const result = await deleteSchedule(row.company_id, row.zone_id);
      if (!result.ok) {
        setToast({ kind: "err", msg: result.error ?? "Delete failed" });
      } else {
        setToast({ kind: "ok", msg: `Schedule deleted` });
        setConfirmDelete(null);
        setDeleteTypedId("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleFetchNow(row: WeatherScheduleRow) {
    setFetchingId(row.id);
    try {
      const result = await requestObservation(row.company_id, row.zone_id, row.lat, row.lng);
      if (!result.ok) {
        setToast({ kind: "err", msg: result.error ?? "Fetch failed" });
      } else {
        setToast({ kind: "ok", msg: `Fetched ${row.zone_id ?? "site"} (saved to weather_log)` });
        await refresh();
      }
    } finally {
      setFetchingId(null);
    }
  }

  // ───────── RENDER: GUARD ─────────
  if (!allowed) {
    return (
      <div style={{ padding: 24 }}>
        <PageHeader
          title="Weather Monitoring"
          description="Schedule + manage per-zone weather observations"
          icon={CloudLightning}
        />
        <div style={{
          marginTop: 32, padding: 32, borderRadius: TOKENS.radius.card,
          background: TOKENS.bg.surface, border: `1px solid ${TOKENS.border.subtle}`,
          textAlign: "center",
        }}>
          <Lock size={36} color={TOKENS.accent.danger} style={{ margin: "0 auto 12px" }} />
          <div style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary, marginBottom: 6 }}>
            Super Admin Only
          </div>
          <div style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted }}>
            Weather schedules drive OpenWeather API costs + sweep timing. Only platform super-admins can edit.
          </div>
        </div>
      </div>
    );
  }

  // ───────── RENDER: MAIN ─────────
  return (
    <div style={{ padding: 24 }}>
      <PageHeader
        title="Weather Monitoring"
        description="Schedule + manage per-zone weather observations (OpenWeather)"
        icon={CloudLightning}
        badge={{ label: `${enabledCount} enabled · ${dueCount} due now`, pulse: dueCount > 0 }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 20, marginBottom: 16 }}>
        <button
          onClick={() => setEditing({ input: EMPTY_INPUT(companyId), isNew: true })}
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
          <Plus size={14} /> New Schedule
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
          Refresh
        </button>
      </div>

      {loadError && (
        <div style={{ padding: 12, borderRadius: TOKENS.radius.small, background: "rgba(255,45,85,0.1)", color: TOKENS.accent.danger, marginBottom: 16 }}>
          <AlertTriangle size={14} style={{ display: "inline", marginRight: 6 }} />
          Failed to load schedules: {loadError}
        </div>
      )}

      {loading && !schedules.length && (
        <div style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted }}>Loading schedules…</div>
      )}

      {!loading && schedules.length === 0 && (
        <div style={{
          padding: 24, borderRadius: TOKENS.radius.card,
          background: TOKENS.bg.surface, border: `1px dashed ${TOKENS.border.subtle}`,
          textAlign: "center", color: TOKENS.text.muted,
          ...TYPOGRAPHY.bodySm,
        }}>
          No weather schedules yet. Click <strong>New Schedule</strong> to start monitoring a zone.
        </div>
      )}

      {!loading && schedules.length > 0 && (
        <div style={{ borderRadius: TOKENS.radius.card, overflow: "hidden", border: `1px solid ${TOKENS.border.subtle}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: TOKENS.bg.surface }}>
            <thead>
              <tr style={{ background: TOKENS.bg.elevated }}>
                <th style={thStyle}>Zone</th>
                <th style={thStyle}>Coords</th>
                <th style={thStyle}>Freq</th>
                <th style={thStyle}>Last fetch</th>
                <th style={thStyle}>Next</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => {
                const next = nextFetchAt(s);
                return (
                  <tr key={s.id} style={{ borderTop: `1px solid ${TOKENS.border.subtle}` }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{s.zone_id ?? <em style={{ color: TOKENS.text.muted }}>site-wide</em>}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", color: TOKENS.text.muted }}>
                      {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                    </td>
                    <td style={tdStyle}>{s.frequency_minutes}m</td>
                    <td style={tdStyle}>{formatLastFetched(s.last_fetched_at)}</td>
                    <td style={tdStyle}>{formatTimeUntil(next)}</td>
                    <td style={tdStyle}>
                      {s.last_error
                        ? <span style={{ color: TOKENS.accent.danger }} title={s.last_error}>⚠ error</span>
                        : s.enabled
                          ? <span style={{ color: TOKENS.accent.success }}>● enabled</span>
                          : <span style={{ color: TOKENS.text.muted }}>○ paused</span>}
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => handleFetchNow(s)}
                        disabled={busy || fetchingId === s.id}
                        style={iconBtnStyle}
                        title="Fetch now (manual)"
                      >
                        {fetchingId === s.id
                          ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} />
                          : <Zap size={13} />}
                      </button>
                      <button
                        onClick={() => setEditing({ input: rowToInput(s), isNew: false })}
                        disabled={busy}
                        style={{ ...iconBtnStyle, marginLeft: 6 }}
                        title="Edit"
                      ><Edit3 size={13} /></button>
                      <button
                        onClick={() => { setConfirmDelete(s); setDeleteTypedId(""); }}
                        disabled={busy}
                        style={{ ...iconBtnStyle, color: TOKENS.accent.danger, marginLeft: 6 }}
                        title="Delete"
                      ><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ───────── EDIT MODAL ───────── */}
      {editing && (
        <div style={modalScrimStyle} onClick={() => !busy && setEditing(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ ...TYPOGRAPHY.h3, color: TOKENS.text.primary }}>
                {editing.isNew ? "New Schedule" : "Edit Schedule"}
              </div>
              <button onClick={() => setEditing(null)} disabled={busy} style={iconBtnStyle}><X size={16} /></button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Zone ID (empty for site-wide)" value={editing.input.zoneId ?? ""}
                onChange={v => setEditing({ ...editing, input: { ...editing.input, zoneId: v.trim() === "" ? null : v.trim() } })}
                disabled={busy || !editing.isNew} />
              <Field label="Frequency (min, 15-1440)" type="number" value={String(editing.input.frequencyMinutes)}
                onChange={v => setEditing({ ...editing, input: { ...editing.input, frequencyMinutes: Number(v) || 60 } })}
                disabled={busy} />
              <Field label="Latitude (-90 to 90)" type="number" value={String(editing.input.lat)}
                onChange={v => setEditing({ ...editing, input: { ...editing.input, lat: Number(v) || 0 } })}
                disabled={busy} />
              <Field label="Longitude (-180 to 180)" type="number" value={String(editing.input.lng)}
                onChange={v => setEditing({ ...editing, input: { ...editing.input, lng: Number(v) || 0 } })}
                disabled={busy} />

              <label style={{ display: "flex", alignItems: "center", gap: 8, color: TOKENS.text.primary, ...TYPOGRAPHY.bodySm, gridColumn: "1 / -1" }}>
                <input type="checkbox" checked={editing.input.enabled}
                  onChange={e => setEditing({ ...editing, input: { ...editing.input, enabled: e.target.checked } })}
                  disabled={busy} />
                Enabled (cron will fetch this schedule)
              </label>
            </div>

            <div style={{ marginTop: 12, padding: 10, background: TOKENS.bg.elevated, borderRadius: TOKENS.radius.small, ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>
              💡 Common coords: Baghdad (33.3152, 44.3661) · Basra (30.5085, 47.7804) · Erbil (36.1911, 43.9931) · Mosul (36.3450, 43.1450)
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button onClick={() => setEditing(null)} disabled={busy} style={{ ...btnStyle, background: TOKENS.bg.elevated, color: TOKENS.text.primary }}>Cancel</button>
              <button onClick={handleSave} disabled={busy} style={{ ...btnStyle, background: TOKENS.accent.primary, color: "#fff" }}>
                <Save size={13} style={{ marginRight: 6 }} /> {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───────── DELETE CONFIRM ───────── */}
      {confirmDelete && (
        <div style={modalScrimStyle} onClick={() => !busy && setConfirmDelete(null)}>
          <div style={{ ...modalStyle, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...TYPOGRAPHY.h3, color: TOKENS.accent.danger, marginBottom: 12 }}>
              <AlertTriangle size={18} style={{ display: "inline", marginRight: 6 }} />
              Delete schedule?
            </div>
            <p style={{ ...TYPOGRAPHY.bodySm, color: TOKENS.text.muted, marginBottom: 8 }}>
              Removes monitoring for <strong>{confirmDelete.zone_id ?? "site-wide"}</strong> at ({confirmDelete.lat}, {confirmDelete.lng}).
              Past observations in <code>weather_log</code> are kept. Type the id to confirm:
            </p>
            <p style={{ ...TYPOGRAPHY.micro, fontFamily: "monospace", color: TOKENS.text.muted, marginBottom: 8, wordBreak: "break-all" }}>
              {confirmDelete.id}
            </p>
            <input
              type="text" value={deleteTypedId}
              onChange={(e) => setDeleteTypedId(e.target.value)}
              placeholder="Paste the id above" disabled={busy}
              style={{
                width: "100%", padding: "8px 12px",
                background: TOKENS.bg.elevated, color: TOKENS.text.primary,
                border: `1px solid ${TOKENS.border.subtle}`,
                borderRadius: TOKENS.radius.small, fontFamily: "monospace",
                marginBottom: 16, boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} disabled={busy} style={{ ...btnStyle, background: TOKENS.bg.elevated, color: TOKENS.text.primary }}>Cancel</button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={busy || deleteTypedId !== confirmDelete.id}
                style={{ ...btnStyle, background: TOKENS.accent.danger, color: "#fff", opacity: deleteTypedId !== confirmDelete.id ? 0.5 : 1 }}
              >
                <Trash2 size={13} style={{ marginRight: 6 }} /> {busy ? "Deleting…" : "Delete"}
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
          ...TYPOGRAPHY.bodySm, zIndex: 1000,
        }}>
          {toast.kind === "ok" ? <CheckCircle2 size={14} style={{ display: "inline", marginRight: 6 }} /> : <AlertTriangle size={14} style={{ display: "inline", marginRight: 6 }} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Form field component (same style as Pricing Admin)
// ═══════════════════════════════════════════════════════════════
interface FieldProps {
  label: string; value: string; onChange: (v: string) => void;
  type?: "text" | "number"; disabled?: boolean;
}
function Field({ label, value, onChange, type = "text", disabled }: FieldProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ ...TYPOGRAPHY.micro, color: TOKENS.text.muted }}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        style={{
          padding: "8px 12px",
          background: TOKENS.bg.elevated, color: TOKENS.text.primary,
          border: `1px solid ${TOKENS.border.subtle}`,
          borderRadius: TOKENS.radius.small,
          outline: "none", width: "100%", boxSizing: "border-box",
        }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Shared styles (same as Pricing Admin)
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
  padding: 24, maxWidth: 560, width: "100%",
  maxHeight: "90vh", overflowY: "auto",
};
