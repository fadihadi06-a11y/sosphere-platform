// ═══════════════════════════════════════════════════════════════
// SOSphere — Drones Management + Operations (Dashboard)
// Tab 1 (Fleet): register drones, show-once agent key, live status.
// Tab 2 (Operations): raise an incident, operator approves a dispatch,
// then watch the drone move live (realtime telemetry → SVG tracker).
// The platform stores only light control data — never video.
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Plane, Plus, RefreshCw, Trash2, Copy, X, BatteryMedium, MapPin,
  Wifi, WifiOff, ShieldAlert, Check, Siren, Navigation2, Gauge, ArrowUp, Video, FileDown, Lock, Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  listDrones, createDrone, deleteDrone,
  reportIncident, listActiveMissions, approveMission,
  listTelemetry, subscribeTelemetry, subscribeMissions,
  getDataAccessMode, setDataAccessMode, listAccessAudit,
  type Drone, type DroneMission, type Telemetry, type AccessAudit,
} from "./drone-service";
import { generateMissionReport } from "./drone-report";
import { useT } from "./dashboard-i18n";
import { useLang } from "./useLang";

const STATUS_META: Record<Drone["status"], { labelKey: string; color: string }> = {
  online:      { labelKey: "drn.status.online",      color: "#00C853" },
  busy:        { labelKey: "drn.status.busy",        color: "#FF9500" },
  maintenance: { labelKey: "drn.status.maintenance", color: "#FF2D55" },
  offline:     { labelKey: "drn.status.offline",     color: "#8E8E93" },
};

// Demo base ≈ matches the simulator agent's default (Baghdad). The SOS
// is raised ~1.5 km away so the drone visibly flies to it.
const DEMO_TARGET = { lat: 33.3262, lng: 44.3771 };

interface Props {
  companyState?: { company?: { id?: string } };
  t?: (k: string) => string;
  webMode?: boolean;
}

export function DronesPage({ companyState }: Props) {
  const { lang } = useLang();
  const t = useT(lang);
  const companyId = companyState?.company?.id;
  const [tab, setTab] = useState<"fleet" | "ops" | "sov">("fleet");

  // ── Fleet state ──
  const [drones, setDrones] = useState<Drone[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [zone, setZone] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const refreshDrones = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    setDrones(await listDrones(companyId));
    setLoading(false);
  }, [companyId]);
  useEffect(() => { void refreshDrones(); }, [refreshDrones]);

  const handleCreate = async () => {
    if (!companyId) { toast.error(t("drn.toast.noCompany")); return; }
    if (!name.trim()) { toast.error(t("drn.toast.enterName")); return; }
    setBusy(true);
    const res = await createDrone(companyId, name.trim(), zone.trim());
    setBusy(false);
    if (!res.ok || !res.agentKey) { toast.error(t("drn.toast.registerFail"), { description: res.error || t("drn.toast.tryAgain") }); return; }
    setNewKey(res.agentKey); setName(""); setZone(""); setAdding(false);
    toast.success(t("drn.toast.registered"), { description: t("drn.toast.copyKeyOnce") });
    void refreshDrones();
  };
  const handleDelete = async (d: Drone) => {
    if (!confirm(t("drn.confirm.remove").replace("{name}", d.name))) return;
    if (await deleteDrone(d.id)) { toast.success(t("drn.toast.removed")); void refreshDrones(); }
    else toast.error(t("drn.toast.removeFail"));
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); toast.success(t("drn.toast.copied")); } catch (_) { /* */ } };

  // ── Operations state ──
  const [missions, setMissions] = useState<DroneMission[]>([]);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [track, setTrack] = useState<Telemetry[]>([]);

  const refreshMissions = useCallback(async () => {
    if (!companyId) return;
    setMissions(await listActiveMissions(companyId));
  }, [companyId]);

  useEffect(() => {
    if (tab !== "ops" || !companyId) return;
    void refreshMissions();
    const unsub = subscribeMissions(companyId, () => void refreshMissions());
    return unsub;
  }, [tab, companyId, refreshMissions]);

  // The mission currently being flown (first non-pending active one)
  const activeMission = useMemo(
    () => missions.find(m => ["approved", "enroute", "onsite", "returning"].includes(m.status)),
    [missions],
  );

  useEffect(() => {
    if (!activeMission) { setTrack([]); return; }
    let alive = true;
    void listTelemetry(activeMission.id).then(rows => { if (alive) setTrack(rows); });
    const unsub = subscribeTelemetry(activeMission.id, (row) => {
      setTrack(prev => (prev.some(p => p.id === row.id) ? prev : [...prev, row]));
    });
    return () => { alive = false; unsub(); };
  }, [activeMission?.id]);

  const simulateSOS = async () => {
    if (!companyId) { toast.error(t("drn.toast.noCompany")); return; }
    const res = await reportIncident(companyId, DEMO_TARGET.lat, DEMO_TARGET.lng, "zone-a");
    if (!res.ok) { toast.error(t("drn.toast.raiseFail"), { description: res.error }); return; }
    toast.success(t("drn.toast.sosRaised"), { description: t("drn.toast.sosRaisedDesc") });
    void refreshMissions();
  };
  const handleApprove = async (m: DroneMission) => {
    const droneId = sel[m.id];
    if (!droneId) { toast.error(t("drn.toast.selectDrone")); return; }
    const res = await approveMission(m.id, droneId);
    if (!res.ok) { toast.error(t("drn.toast.approveFail"), { description: res.error }); return; }
    toast.success(t("drn.toast.approved"), { description: t("drn.toast.approvedDesc") });
    void refreshMissions();
  };

  return (
    <div style={{ padding: 4 }}>
      {/* Header + tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.2)" }}>
            <Plane className="size-5" style={{ color: "#00C8E0" }} />
          </div>
          <div>
            <p className="text-white" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.3px" }}>{t("drn.title")}</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{t("drn.subtitle")}</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 mb-5 p-1 rounded-xl w-fit" style={{ background: "rgba(255,255,255,0.03)" }}>
        {([["fleet", "drn.tab.fleet"], ["ops", "drn.tab.ops"], ["sov", "drn.tab.sov"]] as const).map(([id, labelKey]) => (
          <button key={id} onClick={() => setTab(id)} className="px-4 py-1.5 rounded-lg" style={{ fontSize: 13, fontWeight: 700, color: tab === id ? "#05070E" : "rgba(255,255,255,0.5)", background: tab === id ? "#00C8E0" : "transparent", cursor: "pointer" }}>{t(labelKey)}</button>
        ))}
      </div>

      {tab === "fleet" && (
        <FleetTab
          t={t}
          drones={drones} loading={loading} adding={adding} setAdding={setAdding}
          name={name} setName={setName} zone={zone} setZone={setZone}
          busy={busy} newKey={newKey} setNewKey={setNewKey}
          onCreate={handleCreate} onDelete={handleDelete} onRefresh={refreshDrones} onCopy={copy}
        />
      )}

      {tab === "ops" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>{t("drn.ops.intro")}</p>
            {import.meta.env.DEV && (
            <button onClick={() => void simulateSOS()} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: "#FF2D55", cursor: "pointer" }}>
              <Siren className="size-4" /> {t("drn.ops.simulateSos")}
            </button>
            )}
          </div>

          {/* Live tracker */}
          {activeMission && (
            <LiveTracker t={t} mission={activeMission} points={track} droneName={drones.find(d => d.id === activeMission.drone_id)?.name} />
          )}

          {/* Missions */}
          {missions.length === 0 ? (
            <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(255,255,255,0.01)", border: "1px dashed rgba(255,255,255,0.1)" }}>
              <Siren className="size-7 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.2)" }} />
              <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{t("drn.ops.noDispatches")}</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{t("drn.ops.noDispatchesHint")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {missions.map(m => {
                const isPending = m.status === "pending";
                return (
                  <div key={m.id} className="rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="size-9 rounded-xl flex items-center justify-center" style={{ background: isPending ? "rgba(255,45,85,0.12)" : "rgba(255,150,0,0.12)" }}>
                          <Siren className="size-4" style={{ color: isPending ? "#FF2D55" : "#FF9500" }} />
                        </div>
                        <div>
                          <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{t("drn.dispatch")} · <span style={{ color: isPending ? "#FF2D55" : "#FF9500" }}>{t("drn.mstatus." + m.status)}</span></p>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{t("drn.target")} {m.target_lat.toFixed(4)}, {m.target_lng.toFixed(4)}</p>
                        </div>
                      </div>
                      {isPending && (
                        <div className="flex items-center gap-2">
                          <select value={sel[m.id] ?? ""} onChange={e => setSel(s => ({ ...s, [m.id]: e.target.value }))} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "8px 10px", color: "#fff", fontSize: 12 }}>
                            <option value="">{t("drn.selectDrone")}</option>
                            {drones.map(d => <option key={d.id} value={d.id} style={{ color: "#000" }}>{d.name} {d.status === "online" ? `● ${t("drn.status.online")}` : `(${t("drn.status." + d.status)})`}</option>)}
                          </select>
                          <button onClick={() => void handleApprove(m)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#05070E", background: "#00C853", cursor: "pointer" }}>
                            <Check className="size-3.5" /> {t("drn.approve")}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {tab === "sov" && <SovereigntyTab t={t} companyId={companyId} />}
    </div>
  );
}

// ── Live SVG tracker (no external map dep — reliable everywhere) ──
function LiveTracker({ t, mission, points, droneName }: { t: (k: string) => string; mission: DroneMission; points: Telemetry[]; droneName?: string }) {
  const W = 640, H = 300, PAD = 28;
  const target = { lat: mission.target_lat, lng: mission.target_lng };
  const last = points[points.length - 1];

  const all = [...points.map(p => ({ lat: p.lat, lng: p.lng })), target];
  const lats = all.map(p => p.lat), lngs = all.map(p => p.lng);
  let minLa = Math.min(...lats), maxLa = Math.max(...lats), minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
  if (maxLa - minLa < 0.001) { minLa -= 0.0008; maxLa += 0.0008; }
  if (maxLo - minLo < 0.001) { minLo -= 0.0008; maxLo += 0.0008; }
  const px = (lng: number) => PAD + ((lng - minLo) / (maxLo - minLo)) * (W - 2 * PAD);
  const py = (lat: number) => PAD + (1 - (lat - minLa) / (maxLa - minLa)) * (H - 2 * PAD);
  const trail = points.map(p => `${px(p.lng).toFixed(1)},${py(p.lat).toFixed(1)}`).join(" ");

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(5,10,20,0.7)", border: "1px solid rgba(0,200,224,0.18)" }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{droneName || t("drn.drone")} · <span style={{ color: "#FF9500" }}>{t("drn.mstatus." + mission.status)}</span></p>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{points.length} {t("drn.telemetryPoints")}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", background: "linear-gradient(180deg,rgba(0,200,224,0.04),transparent)" }}>
        {Array.from({ length: 6 }).map((_, i) => <line key={`h${i}`} x1={0} y1={(H / 6) * i} x2={W} y2={(H / 6) * i} stroke="rgba(255,255,255,0.04)" />)}
        {Array.from({ length: 12 }).map((_, i) => <line key={`v${i}`} x1={(W / 12) * i} y1={0} x2={(W / 12) * i} y2={H} stroke="rgba(255,255,255,0.04)" />)}
        {/* target */}
        <circle cx={px(target.lng)} cy={py(target.lat)} r={10} fill="none" stroke="#FF2D55" strokeWidth={2} />
        <circle cx={px(target.lng)} cy={py(target.lat)} r={3} fill="#FF2D55" />
        {/* trail */}
        {points.length > 1 && <polyline points={trail} fill="none" stroke="#00C8E0" strokeWidth={2} strokeLinejoin="round" />}
        {/* drone */}
        {last && (
          <g transform={`translate(${px(last.lng)},${py(last.lat)}) rotate(${last.heading ?? 0})`}>
            <circle r={13} fill="rgba(0,200,224,0.18)" />
            <path d="M0,-9 L6,7 L0,3 L-6,7 Z" fill="#00C8E0" />
          </g>
        )}
      </svg>
      <div className="flex items-center gap-5 px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <Stat icon={Navigation2} label={t("drn.stat.status")} value={last?.status ?? "—"} />
        <Stat icon={BatteryMedium} label={t("drn.stat.battery")} value={last?.battery != null ? `${last.battery}%` : "—"} />
        <Stat icon={ArrowUp} label={t("drn.stat.altitude")} value={last?.altitude != null ? `${Math.round(last.altitude)} m` : "—"} />
        <Stat icon={Gauge} label={t("drn.stat.speed")} value={last?.speed != null ? `${last.speed} m/s` : "—"} />
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center gap-2" style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
          <Video className="size-3.5" style={{ color: "#00C8E0" }} />
          {mission.stream_url
            ? <a href={mission.stream_url} target="_blank" rel="noreferrer" style={{ color: "#00C8E0" }}>{t("drn.openLiveVideo")}</a>
            : <span>{t("drn.noStreamUrl")}</span>}
        </div>
        <button onClick={() => generateMissionReport(mission, points, droneName)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ fontSize: 12, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.2)", cursor: "pointer" }}>
          <FileDown className="size-3.5" /> {t("drn.reportPdf")}
        </button>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4" style={{ color: "#00C8E0" }} />
      <div>
        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{label}</p>
        <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{value}</p>
      </div>
    </div>
  );
}

// ── Fleet tab (extracted to keep the main component readable) ──
function FleetTab(props: {
  t: (k: string) => string;
  drones: Drone[]; loading: boolean; adding: boolean; setAdding: (v: boolean) => void;
  name: string; setName: (v: string) => void; zone: string; setZone: (v: string) => void;
  busy: boolean; newKey: string | null; setNewKey: (v: string | null) => void;
  onCreate: () => void; onDelete: (d: Drone) => void; onRefresh: () => void; onCopy: (s: string) => void;
}) {
  const { t, drones, loading, adding, setAdding, name, setName, zone, setZone, busy, newKey, setNewKey, onCreate, onDelete, onRefresh, onCopy } = props;
  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-4">
        <button onClick={onRefresh} className="size-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }} title={t("drn.refresh")}><RefreshCw className="size-4" style={{ color: "rgba(255,255,255,0.6)" }} /></button>
        <button onClick={() => setAdding(!adding)} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 13, fontWeight: 700, color: "#05070E", background: "#00C8E0", cursor: "pointer" }}><Plus className="size-4" /> {t("drn.addDrone")}</button>
      </div>

      <AnimatePresence>
        {newKey && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
            <div className="rounded-2xl p-4" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.25)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="size-4 mt-0.5" style={{ color: "#00C853" }} />
                  <div>
                    <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{t("drn.agentKeyOnce")}</p>
                    <code style={{ fontSize: 12, color: "#00C853", wordBreak: "break-all" }}>{newKey}</code>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => onCopy(newKey)} className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,83,0.12)", cursor: "pointer" }}><Copy className="size-3.5" style={{ color: "#00C853" }} /></button>
                  <button onClick={() => setNewKey(null)} className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)", cursor: "pointer" }}><X className="size-3.5" style={{ color: "rgba(255,255,255,0.6)" }} /></button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
            <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t("drn.namePlaceholder")} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13 }} />
              <input value={zone} onChange={e => setZone(e.target.value)} placeholder={t("drn.zonePlaceholder")} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13 }} />
              <div className="flex items-center gap-2">
                <button disabled={busy} onClick={onCreate} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 13, fontWeight: 700, color: "#05070E", background: busy ? "rgba(0,200,224,0.5)" : "#00C8E0", cursor: busy ? "default" : "pointer" }}><Check className="size-4" /> {busy ? t("drn.registering") : t("drn.registerDrone")}</button>
                <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-xl" style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.04)", cursor: "pointer" }}>{t("drn.cancel")}</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", padding: 24 }}>{t("drn.loading")}</p>
      ) : drones.length === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(255,255,255,0.01)", border: "1px dashed rgba(255,255,255,0.1)" }}>
          <Plane className="size-8 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.2)" }} />
          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>{t("drn.noDrones")}</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>{t("drn.noDronesHint")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {drones.map(d => {
            const meta = STATUS_META[d.status]; const online = d.status !== "offline";
            return (
              <div key={d.id} className="flex items-center gap-4 rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${meta.color}15` }}>{online ? <Wifi className="size-4" style={{ color: meta.color }} /> : <WifiOff className="size-4" style={{ color: meta.color }} />}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{d.name}</p>
                  <div className="flex items-center gap-3" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                    <span style={{ color: meta.color, fontWeight: 600 }}>{t(meta.labelKey)}</span>
                    {d.zone && <span className="flex items-center gap-1"><MapPin className="size-3" /> {d.zone}</span>}
                    {d.battery != null && <span className="flex items-center gap-1"><BatteryMedium className="size-3" /> {d.battery}%</span>}
                    <span style={{ opacity: 0.6 }}>{d.source}</span>
                  </div>
                </div>
                <button onClick={() => onDelete(d)} className="size-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,45,85,0.08)", cursor: "pointer" }} title={t("drn.remove")}><Trash2 className="size-3.5" style={{ color: "#FF2D55" }} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sovereignty tab: per-company data access mode + audit trail ──
function SovereigntyTab({ t, companyId }: { t: (k: string) => string; companyId?: string }) {
  const [mode, setMode] = useState<"private" | "support_allowed">("private");
  const [audit, setAudit] = useState<AccessAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    setMode(await getDataAccessMode(companyId));
    setAudit(await listAccessAudit(companyId));
    setLoading(false);
  }, [companyId]);
  useEffect(() => { void load(); }, [load]);
  const toggle = async () => {
    if (!companyId) return;
    const next = mode === "private" ? "support_allowed" : "private";
    if (await setDataAccessMode(companyId, next)) { setMode(next); toast.success(next === "private" ? t("drn.toast.supportDisabled") : t("drn.toast.supportEnabled")); void load(); }
    else toast.error(t("drn.toast.modeFail"));
  };
  if (loading) return <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", padding: 24 }}>{t("drn.loading")}</p>;
  const allowed = mode === "support_allowed";
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl p-5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: allowed ? "rgba(255,150,0,0.12)" : "rgba(0,200,83,0.12)" }}>
              <Lock className="size-5" style={{ color: allowed ? "#FF9500" : "#00C853" }} />
            </div>
            <div>
              <p className="text-white" style={{ fontSize: 15, fontWeight: 700 }}>{t("drn.sov.title")}</p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", maxWidth: 470, marginTop: 4 }}>
                {t("drn.sov.desc")}{" "}
                {allowed ? t("drn.sov.descOn") : t("drn.sov.descOff")}
              </p>
            </div>
          </div>
          <button onClick={() => void toggle()} className="px-4 py-2 rounded-xl flex-shrink-0" style={{ fontSize: 13, fontWeight: 700, color: allowed ? "#FF9500" : "#00C853", background: allowed ? "rgba(255,150,0,0.1)" : "rgba(0,200,83,0.1)", border: allowed ? "1px solid rgba(255,150,0,0.25)" : "1px solid rgba(0,200,83,0.25)", cursor: "pointer" }}>
            {allowed ? t("drn.sov.disable") : t("drn.sov.allow")}
          </button>
        </div>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="px-4 py-3 flex items-center gap-2" style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <Eye className="size-4" style={{ color: "#00C8E0" }} />
          <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{t("drn.sov.auditTrail")}</p>
        </div>
        {audit.length === 0 ? (
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", padding: 16 }}>{t("drn.sov.noEvents")}</p>
        ) : audit.map(a => (
          <div key={a.id} className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}>
            <span className="text-white">{a.action}{a.reason ? ` — ${a.reason}` : ""}</span>
            <span style={{ color: "rgba(255,255,255,0.35)" }}>{a.actor_email || "—"} · {new Date(a.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
