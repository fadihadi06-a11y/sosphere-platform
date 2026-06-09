// ═══════════════════════════════════════════════════════════════
// SOSphere — Drones Management Page (Dashboard)
// Register drones, generate the agent key (shown once), and see live
// status. The platform stores only light control data — never video.
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Plane, Plus, RefreshCw, Trash2, Copy, X, BatteryMedium,
  MapPin, Wifi, WifiOff, ShieldAlert, Check,
} from "lucide-react";
import { toast } from "sonner";
import { listDrones, createDrone, deleteDrone, type Drone } from "./drone-service";

const STATUS_META: Record<Drone["status"], { label: string; color: string }> = {
  online:      { label: "Online",      color: "#00C853" },
  busy:        { label: "On Mission",  color: "#FF9500" },
  maintenance: { label: "Maintenance", color: "#FF2D55" },
  offline:     { label: "Offline",     color: "#8E8E93" },
};

interface Props {
  companyState?: { company?: { id?: string } };
  t?: (k: string) => string;
  webMode?: boolean;
}

export function DronesPage({ companyState }: Props) {
  const companyId = companyState?.company?.id;
  const [drones, setDrones] = useState<Drone[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [zone, setZone] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    setDrones(await listDrones(companyId));
    setLoading(false);
  }, [companyId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleCreate = async () => {
    if (!companyId) { toast.error("No active company"); return; }
    if (!name.trim()) { toast.error("Enter a drone name"); return; }
    setBusy(true);
    const res = await createDrone(companyId, name.trim(), zone.trim());
    setBusy(false);
    if (!res.ok || !res.agentKey) { toast.error("Could not register drone", { description: res.error || "Try again." }); return; }
    setNewKey(res.agentKey);
    setName(""); setZone(""); setAdding(false);
    toast.success("Drone registered", { description: "Copy its agent key now — shown only once." });
    void refresh();
  };

  const handleDelete = async (d: Drone) => {
    if (!confirm(`Remove drone "${d.name}"? This cannot be undone.`)) return;
    const ok = await deleteDrone(d.id);
    if (ok) { toast.success("Drone removed"); void refresh(); }
    else toast.error("Could not remove drone");
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("Copied to clipboard"); } catch (_) { /* */ }
  };

  return (
    <div style={{ padding: 4 }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(0,200,224,0.12)", border: "1px solid rgba(0,200,224,0.2)" }}>
            <Plane className="size-5" style={{ color: "#00C8E0" }} />
          </div>
          <div>
            <p className="text-white" style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.3px" }}>Drones</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Aerial-eye fleet — control data only, video stays on your media server</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void refresh()} className="size-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }} title="Refresh">
            <RefreshCw className="size-4" style={{ color: "rgba(255,255,255,0.6)" }} />
          </button>
          <button onClick={() => setAdding(v => !v)} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 13, fontWeight: 700, color: "#05070E", background: "#00C8E0", cursor: "pointer" }}>
            <Plus className="size-4" /> Add Drone
          </button>
        </div>
      </div>

      {/* New key reveal */}
      <AnimatePresence>
        {newKey && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
            <div className="rounded-2xl p-4" style={{ background: "rgba(0,200,83,0.06)", border: "1px solid rgba(0,200,83,0.25)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="size-4 mt-0.5" style={{ color: "#00C853" }} />
                  <div>
                    <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>Agent key — copy it now, shown only once</p>
                    <code style={{ fontSize: 12, color: "#00C853", wordBreak: "break-all" }}>{newKey}</code>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>Paste it into the drone agent host (.env). It is stored only as a hash.</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => copy(newKey)} className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(0,200,83,0.12)", cursor: "pointer" }} title="Copy"><Copy className="size-3.5" style={{ color: "#00C853" }} /></button>
                  <button onClick={() => setNewKey(null)} className="size-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(255,255,255,0.06)", cursor: "pointer" }} title="Dismiss"><X className="size-3.5" style={{ color: "rgba(255,255,255,0.6)" }} /></button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add form */}
      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
            <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Drone name (e.g. Falcon-1)" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13 }} />
              <input value={zone} onChange={e => setZone(e.target.value)} placeholder="Zone (optional, e.g. zone-a)" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13 }} />
              <div className="flex items-center gap-2">
                <button disabled={busy} onClick={() => void handleCreate()} className="flex items-center gap-2 px-4 py-2 rounded-xl" style={{ fontSize: 13, fontWeight: 700, color: "#05070E", background: busy ? "rgba(0,200,224,0.5)" : "#00C8E0", cursor: busy ? "default" : "pointer" }}>
                  <Check className="size-4" /> {busy ? "Registering…" : "Register drone"}
                </button>
                <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-xl" style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.04)", cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      {loading ? (
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", padding: 24 }}>Loading…</p>
      ) : drones.length === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(255,255,255,0.01)", border: "1px dashed rgba(255,255,255,0.1)" }}>
          <Plane className="size-8 mx-auto mb-3" style={{ color: "rgba(255,255,255,0.2)" }} />
          <p className="text-white" style={{ fontSize: 14, fontWeight: 600 }}>No drones yet</p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>Add a drone, then run the agent on its host to bring it online.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {drones.map(d => {
            const meta = STATUS_META[d.status];
            const online = d.status !== "offline";
            return (
              <div key={d.id} className="flex items-center gap-4 rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="size-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${meta.color}15` }}>
                  {online ? <Wifi className="size-4" style={{ color: meta.color }} /> : <WifiOff className="size-4" style={{ color: meta.color }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>{d.name}</p>
                  <div className="flex items-center gap-3" style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                    <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                    {d.zone && <span className="flex items-center gap-1"><MapPin className="size-3" /> {d.zone}</span>}
                    {d.battery != null && <span className="flex items-center gap-1"><BatteryMedium className="size-3" /> {d.battery}%</span>}
                    <span style={{ opacity: 0.6 }}>{d.source}</span>
                  </div>
                </div>
                <button onClick={() => void handleDelete(d)} className="size-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,45,85,0.08)", cursor: "pointer" }} title="Remove">
                  <Trash2 className="size-3.5" style={{ color: "#FF2D55" }} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
