// ═══════════════════════════════════════════════════════════════
// SOSphere — Real GPS Geofence Map Editor
// ─────────────────────────────────────────────────────────────
// World-class, life-safety-grade: zones drawn here are REAL GPS
// circles persisted to the canonical `zones` table. The mobile
// geofence-service (initGeofenceService → evaluateGpsSample) loads
// these exact rows, so a zone created here actually drives breach
// detection. No canvas pixels, no demo data, no orphan table.
//
// Replaces the disconnected canvas "Geofencing editor" that wrote a
// separate `geofences` table the rest of the platform never read.
// ═══════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Plus, Trash2, Crosshair, Save, X, Layers, ShieldAlert } from "lucide-react";
import { supabase } from "./api/supabase-client";
import { toast } from "sonner";

type RiskLevel = "low" | "medium" | "high";
interface ZoneRow {
  id: string;
  name: string;
  type: string | null;
  risk_level: RiskLevel | null;
  lat: number;
  lng: number;
  radius_meters: number;
}

const RISK_COLOR: Record<string, string> = { low: "#00C853", medium: "#FF9500", high: "#FF2D55" };
const ZONE_TYPES = ["work_site", "restricted", "high_risk", "safe_assembly", "storage"];

function getCompanyId(): string | null {
  try { return localStorage.getItem("sosphere_company_id"); } catch { return null; }
}

export function GeofenceMapEditor({ webMode = false }: { webMode?: boolean }) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const lg = useRef<any>(null);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState<{ name: string; type: string; risk: RiskLevel; radius: number }>(
    { name: "", type: "work_site", risk: "medium", radius: 150 },
  );
  const [saving, setSaving] = useState(false);

  const loadZones = useCallback(async () => {
    const companyId = getCompanyId();
    if (!companyId) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("zones")
      .select("id, name, type, risk_level, lat, lon, lng, radius, radius_meters")
      .eq("company_id", companyId);
    if (error) { console.warn("[ZoneEditor] load failed:", error.message); setLoading(false); return; }
    const rows: ZoneRow[] = (data ?? []).map((r: any) => {
      const lat = typeof r.lat === "number" ? r.lat : null;
      const lng = typeof r.lng === "number" ? r.lng : (typeof r.lon === "number" ? r.lon : null);
      if (lat == null || lng == null) return null;
      const radius = typeof r.radius_meters === "number" ? r.radius_meters
                   : typeof r.radius === "number" ? r.radius : 150;
      return { id: String(r.id), name: r.name || "Zone", type: r.type ?? null, risk_level: (r.risk_level as RiskLevel) ?? null, lat, lng, radius_meters: radius };
    }).filter(Boolean) as ZoneRow[];
    setZones(rows);
    setLoading(false);
  }, []);

  useEffect(() => { void loadZones(); }, [loadZones]);

  // Init the Leaflet map once.
  useEffect(() => {
    if (!mapEl.current || mapObj.current) return;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView([33.3152, 44.3661], 11);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 20, subdomains: "abcd" }).addTo(map);
    lg.current = L.layerGroup().addTo(map);
    mapObj.current = map;
    setTimeout(() => { try { map.invalidateSize(); } catch { /* */ } }, 250);
    return () => { try { map.remove(); } catch { /* */ } mapObj.current = null; };
  }, []);

  // Click-to-place handler (only while in placing mode).
  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    const onClick = (e: any) => { if (placing) setDraft({ lat: e.latlng.lat, lng: e.latlng.lng }); };
    map.on("click", onClick);
    return () => { try { map.off("click", onClick); } catch { /* */ } };
  }, [placing]);

  // Redraw all zones + the in-progress draft circle.
  useEffect(() => {
    const group = lg.current; const map = mapObj.current;
    if (!group || !map) return;
    group.clearLayers();
    const pts: any[] = [];
    for (const z of zones) {
      const color = RISK_COLOR[z.risk_level || "medium"] || "#FF9500";
      L.circle([z.lat, z.lng], { radius: z.radius_meters, color, weight: 2, fillColor: color, fillOpacity: 0.15 })
        .addTo(group)
        .bindTooltip(`${z.name} · ${z.radius_meters}m`, { direction: "top" });
      pts.push([z.lat, z.lng]);
    }
    if (draft) {
      const color = RISK_COLOR[form.risk] || "#FF9500";
      L.circle([draft.lat, draft.lng], { radius: form.radius, color, weight: 2, dashArray: "6 6", fillColor: color, fillOpacity: 0.1 }).addTo(group);
      L.circleMarker([draft.lat, draft.lng], { radius: 5, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(group);
    }
    if (pts.length && !draft) { try { map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 15 }); } catch { /* */ } }
  }, [zones, draft, form.radius, form.risk]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast("GPS not available on this device"); return; }
    toast("Locating…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setPlacing(true);
        setDraft({ lat: latitude, lng: longitude });
        try { mapObj.current?.setView([latitude, longitude], 16); } catch { /* */ }
      },
      () => toast("Couldn't read your location", { description: "Allow location access, or click the map to place the zone center." }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const startPlacing = () => { setPlacing(true); setDraft(null); };
  const cancelDraft = () => { setPlacing(false); setDraft(null); setForm({ name: "", type: "work_site", risk: "medium", radius: 150 }); };

  const saveZone = async () => {
    if (!draft) { toast("Click the map (or use your location) to set the zone center"); return; }
    if (!form.name.trim()) { toast("Give the zone a name"); return; }
    const companyId = getCompanyId();
    if (!companyId) { toast("No company context — re-open the dashboard"); return; }
    setSaving(true);
    const row = {
      company_id: companyId,
      name: form.name.trim(),
      type: form.type,
      risk_level: form.risk,
      lat: draft.lat,
      lon: draft.lng,
      lng: draft.lng,
      radius: form.radius,
      radius_meters: form.radius,
      is_active: true,
      status: "active",
    };
    const { error } = await supabase.from("zones").insert(row);
    setSaving(false);
    if (error) { toast("Couldn't save zone", { description: error.message }); return; }
    toast.success("Zone created", { description: `${form.name.trim()} is now a live geofence — workers entering/leaving it are monitored.` });
    cancelDraft();
    void loadZones();
  };

  const deleteZone = async (id: string, name: string) => {
    const { error } = await supabase.from("zones").delete().eq("id", id);
    if (error) { toast("Couldn't delete", { description: error.message }); return; }
    toast.success(`${name} deleted`);
    void loadZones();
  };

  const counts = {
    total: zones.length,
    high: zones.filter(z => z.risk_level === "high").length,
    medium: zones.filter(z => z.risk_level === "medium").length,
    low: zones.filter(z => z.risk_level === "low").length,
  };

  return (
    <div className={webMode ? "p-6" : "p-3"} style={{ fontFamily: "'Tajawal','Outfit',sans-serif" }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-white flex items-center gap-2" style={{ fontSize: 18, fontWeight: 800 }}>
            <MapPin className="size-4" style={{ color: "#00C853" }} /> Geofence Map
          </h2>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Draw real GPS safety zones — workers are monitored against these live.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={useMyLocation} className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 600, color: "#00C8E0", background: "rgba(0,200,224,0.08)", border: "1px solid rgba(0,200,224,0.2)" }}>
            <Crosshair className="size-3.5" /> Use my location
          </button>
          {!placing ? (
            <button onClick={startPlacing} className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#05070E", background: "#00C853" }}>
              <Plus className="size-3.5" /> Add zone
            </button>
          ) : (
            <button onClick={cancelDraft} className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#FF9500", background: "rgba(255,149,0,0.1)", border: "1px solid rgba(255,149,0,0.3)" }}>
              <X className="size-3.5" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Stat tiles (real counts) */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: "Total Zones", value: counts.total, color: "#00C8E0", icon: Layers },
          { label: "High Risk", value: counts.high, color: "#FF2D55", icon: ShieldAlert },
          { label: "Medium", value: counts.medium, color: "#FF9500", icon: MapPin },
          { label: "Low", value: counts.low, color: "#00C853", icon: MapPin },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>{s.label}</p>
          </div>
        ))}
      </div>

      {placing && (
        <div className="mb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(0,200,83,0.08)", border: "1px solid rgba(0,200,83,0.2)" }}>
          <p style={{ fontSize: 12, color: "#00C853", fontWeight: 600 }}>📍 Click anywhere on the map to set the zone center, then fill the details below and Save.</p>
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: webMode ? "1fr 320px" : "1fr" }}>
        {/* The real map */}
        <div ref={mapEl} style={{ height: webMode ? "62vh" : 360, minHeight: 320, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#0a0e17" }} />

        {/* Side panel: draft form + zone list */}
        <div className="space-y-3">
          {draft && (
            <div className="p-3 rounded-2xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(0,200,83,0.25)" }}>
              <p className="text-white mb-2" style={{ fontSize: 13, fontWeight: 700 }}>New zone</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 8, fontFamily: "monospace" }}>{draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}</p>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Zone name (e.g. Warehouse B)"
                className="w-full px-3 py-2 rounded-lg mb-2 text-white" style={{ fontSize: 13, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", outline: "none" }} />
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg mb-2 text-white" style={{ fontSize: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", outline: "none" }}>
                {ZONE_TYPES.map(t => <option key={t} value={t} style={{ background: "#0a0e17" }}>{t.replace(/_/g, " ")}</option>)}
              </select>
              <div className="flex gap-1.5 mb-2">
                {(["low", "medium", "high"] as RiskLevel[]).map(r => (
                  <button key={r} onClick={() => setForm(f => ({ ...f, risk: r }))} className="flex-1 py-1.5 rounded-lg" style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", color: form.risk === r ? "#05070E" : RISK_COLOR[r], background: form.risk === r ? RISK_COLOR[r] : `${RISK_COLOR[r]}15`, border: `1px solid ${RISK_COLOR[r]}40` }}>{r}</button>
                ))}
              </div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Radius: <span style={{ color: "#00C8E0", fontWeight: 700 }}>{form.radius} m</span></label>
              <input type="range" min={25} max={2000} step={25} value={form.radius} onChange={e => setForm(f => ({ ...f, radius: Number(e.target.value) }))} className="w-full mb-3" />
              <button onClick={saveZone} disabled={saving} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl" style={{ fontSize: 13, fontWeight: 700, color: "#05070E", background: "#00C853", opacity: saving ? 0.6 : 1 }}>
                <Save className="size-4" /> {saving ? "Saving…" : "Save zone"}
              </button>
            </div>
          )}

          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-white px-3 py-2" style={{ fontSize: 12, fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>Zones ({zones.length})</p>
            {loading ? (
              <p className="px-3 py-4" style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Loading…</p>
            ) : zones.length === 0 ? (
              <p className="px-3 py-4" style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>No zones yet. Click “Add zone” and place one on the map.</p>
            ) : zones.map(z => (
              <div key={z.id} className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <span className="size-2.5 rounded-full flex-shrink-0" style={{ background: RISK_COLOR[z.risk_level || "medium"] }} />
                <button onClick={() => { try { mapObj.current?.setView([z.lat, z.lng], 16); } catch { /* */ } }} className="flex-1 text-left">
                  <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{z.name}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{(z.type || "zone").replace(/_/g, " ")} · {z.radius_meters}m</p>
                </button>
                <button onClick={() => deleteZone(z.id, z.name)} className="p-1.5 rounded-lg" style={{ color: "#FF2D55", background: "rgba(255,45,85,0.08)" }}><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
