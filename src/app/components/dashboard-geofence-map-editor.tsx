// ═══════════════════════════════════════════════════════════════
// SOSphere — Real GPS Geofence Map Editor
// ─────────────────────────────────────────────────────────────
// World-class, life-safety-grade: zones drawn here are REAL GPS
// circles persisted to the canonical `zones` table. The mobile
// geofence-service (initGeofenceService → evaluateGpsSample) loads
// these exact rows, so a zone created here actually drives breach
// detection. No canvas pixels, no demo data, no orphan table.
//
// Center can be set FOUR ways: click the map, "use my location",
// paste a Google-Maps link / "lat, lng" (e.g. shared on WhatsApp),
// or type lat/lng manually.
// ═══════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, Plus, Trash2, Crosshair, Save, X, Layers, ShieldAlert, ClipboardPaste } from "lucide-react";
import { supabase } from "./api/supabase-client";
import { toast } from "sonner";
import { useT } from "./dashboard-i18n";
import { useLang } from "./useLang";

type RiskLevel = "low" | "medium" | "high";
interface ZoneRow { id: string; name: string; type: string | null; risk_level: RiskLevel | null; lat: number; lng: number; radius_meters: number; }

const RISK_COLOR: Record<string, string> = { low: "#00C853", medium: "#FF9500", high: "#FF2D55" };
const ZONE_TYPES = ["work_site", "restricted", "high_risk", "safe_assembly", "storage"];

const INPUT: React.CSSProperties = {
  width: "100%", color: "#ffffff", fontSize: 13, fontWeight: 500,
  background: "rgba(255,255,255,0.09)", border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 9, padding: "9px 11px", outline: "none",
};

function getCompanyId(): string | null { try { return localStorage.getItem("sosphere_company_id"); } catch { return null; } }

/** Accepts "33.31, 44.36", "33.31 44.36", or any URL/text containing a
 *  lat,lng pair (Google Maps @lat,lng or ?q=lat,lng, WhatsApp shares, etc.). */
function parseLatLng(text: string): { lat: number; lng: number } | null {
  if (!text) return null;
  const m = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = parseFloat(m[1]); const lng = parseFloat(m[2]);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function GeofenceMapEditor({ webMode = false }: { webMode?: boolean }) {
  const { lang } = useLang();
  const t = useT(lang);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const lg = useRef<any>(null);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [form, setForm] = useState<{ name: string; type: string; risk: RiskLevel; radius: number }>({ name: "", type: "work_site", risk: "medium", radius: 150 });
  const [pasteVal, setPasteVal] = useState("");
  const [latVal, setLatVal] = useState("");
  const [lngVal, setLngVal] = useState("");
  const [saving, setSaving] = useState(false);

  const loadZones = useCallback(async () => {
    const companyId = getCompanyId();
    if (!companyId) { setLoading(false); return; }
    const { data, error } = await supabase.from("zones")
      .select("id, name, type, risk_level, lat, lon, lng, radius, radius_meters").eq("company_id", companyId);
    if (error) { console.warn("[ZoneEditor] load failed:", error.message); setLoading(false); return; }
    const rows: ZoneRow[] = (data ?? []).map((r: any) => {
      const lat = typeof r.lat === "number" ? r.lat : null;
      const lng = typeof r.lng === "number" ? r.lng : (typeof r.lon === "number" ? r.lon : null);
      if (lat == null || lng == null) return null;
      const radius = typeof r.radius_meters === "number" ? r.radius_meters : (typeof r.radius === "number" ? r.radius : 150);
      return { id: String(r.id), name: r.name || t("gfe.defaultZoneName"), type: r.type ?? null, risk_level: (r.risk_level as RiskLevel) ?? null, lat, lng, radius_meters: radius };
    }).filter(Boolean) as ZoneRow[];
    setZones(rows); setLoading(false);
  }, [t]);

  useEffect(() => { void loadZones(); }, [loadZones]);

  useEffect(() => {
    if (!mapEl.current || mapObj.current) return;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView([33.3152, 44.3661], 11);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { maxZoom: 20, subdomains: "abcd" }).addTo(map);
    lg.current = L.layerGroup().addTo(map);
    mapObj.current = map;
    setTimeout(() => { try { map.invalidateSize(); } catch { /* */ } }, 250);
    return () => { try { map.remove(); } catch { /* */ } mapObj.current = null; };
  }, []);

  useEffect(() => {
    const map = mapObj.current; if (!map) return;
    const onClick = (e: any) => { if (placing) setDraft({ lat: e.latlng.lat, lng: e.latlng.lng }); };
    map.on("click", onClick);
    return () => { try { map.off("click", onClick); } catch { /* */ } };
  }, [placing]);

  useEffect(() => {
    const group = lg.current; const map = mapObj.current; if (!group || !map) return;
    group.clearLayers();
    const pts: any[] = [];
    for (const z of zones) {
      const color = RISK_COLOR[z.risk_level || "medium"] || "#FF9500";
      L.circle([z.lat, z.lng], { radius: z.radius_meters, color, weight: 2, fillColor: color, fillOpacity: 0.15 }).addTo(group).bindTooltip(`${z.name} · ${z.radius_meters}m`, { direction: "top" });
      pts.push([z.lat, z.lng]);
    }
    if (draft) {
      const color = RISK_COLOR[form.risk] || "#FF9500";
      L.circle([draft.lat, draft.lng], { radius: form.radius, color, weight: 2, dashArray: "6 6", fillColor: color, fillOpacity: 0.1 }).addTo(group);
      L.circleMarker([draft.lat, draft.lng], { radius: 5, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(group);
    }
    if (pts.length && !draft) { try { map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 15 }); } catch { /* */ } }
  }, [zones, draft, form.radius, form.risk]);

  const setCenter = (lat: number, lng: number, zoom = 16) => {
    setPlacing(true); setDraft({ lat, lng });
    try { mapObj.current?.setView([lat, lng], zoom); } catch { /* */ }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) { toast(t("gfe.gpsUnavailable")); return; }
    toast(t("gfe.locating"));
    navigator.geolocation.getCurrentPosition(
      (pos) => setCenter(pos.coords.latitude, pos.coords.longitude),
      () => toast(t("gfe.locationReadFailed"), { description: t("gfe.locationReadFailedDesc") }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const applyPaste = () => {
    const p = parseLatLng(pasteVal);
    if (!p) { toast(t("gfe.coordsNotFound"), { description: t("gfe.coordsNotFoundDesc") }); return; }
    setLatVal(p.lat.toFixed(6)); setLngVal(p.lng.toFixed(6)); setCenter(p.lat, p.lng);
    toast.success(t("gfe.locationSetFromPaste"));
  };
  const applyManual = () => {
    const p = parseLatLng(`${latVal}, ${lngVal}`);
    if (!p) { toast(t("gfe.invalidLatLng")); return; }
    setCenter(p.lat, p.lng);
  };

  const startPlacing = () => { setPlacing(true); setDraft(null); };
  const cancelDraft = () => { setPlacing(false); setDraft(null); setPasteVal(""); setLatVal(""); setLngVal(""); setForm({ name: "", type: "work_site", risk: "medium", radius: 150 }); };

  const saveZone = async () => {
    if (!draft) { toast(t("gfe.setCenterFirst")); return; }
    if (!form.name.trim()) { toast(t("gfe.giveZoneName")); return; }
    const companyId = getCompanyId(); if (!companyId) { toast(t("gfe.noCompanyContext")); return; }
    setSaving(true);
    const row = { company_id: companyId, name: form.name.trim(), type: form.type, risk_level: form.risk, lat: draft.lat, lon: draft.lng, lng: draft.lng, radius: form.radius, radius_meters: form.radius, is_active: true, status: "active" };
    const { error } = await supabase.from("zones").insert(row);
    setSaving(false);
    if (error) { toast(t("gfe.saveZoneFailed"), { description: error.message }); return; }
    toast.success(t("gfe.zoneCreated"), { description: `${form.name.trim()}${t("gfe.zoneCreatedDescSuffix")}` });
    cancelDraft(); void loadZones();
  };

  const deleteZone = async (id: string, name: string) => {
    const { error } = await supabase.from("zones").delete().eq("id", id);
    if (error) { toast(t("gfe.deleteFailed"), { description: error.message }); return; }
    toast.success(`${name}${t("gfe.deletedSuffix")}`); void loadZones();
  };

  const counts = { total: zones.length, high: zones.filter(z => z.risk_level === "high").length, medium: zones.filter(z => z.risk_level === "medium").length, low: zones.filter(z => z.risk_level === "low").length };

  return (
    <div className={webMode ? "p-6" : "p-3"} style={{ fontFamily: "'Tajawal','Outfit',sans-serif" }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-white flex items-center gap-2" style={{ fontSize: 18, fontWeight: 800 }}><MapPin className="size-4" style={{ color: "#00C853" }} /> {t("gfe.title")}</h2>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{t("gfe.subtitle")}</p>
        </div>
        {!placing ? (
          <button onClick={startPlacing} className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#05070E", background: "#00C853" }}><Plus className="size-3.5" /> {t("gfe.addZone")}</button>
        ) : (
          <button onClick={cancelDraft} className="flex items-center gap-1.5 px-3 py-2 rounded-xl" style={{ fontSize: 12, fontWeight: 700, color: "#FF9500", background: "rgba(255,149,0,0.1)", border: "1px solid rgba(255,149,0,0.3)" }}><X className="size-3.5" /> {t("gfe.cancel")}</button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {[{ label: t("gfe.totalZones"), value: counts.total, color: "#00C8E0", icon: Layers }, { label: t("gfe.highRisk"), value: counts.high, color: "#FF2D55", icon: ShieldAlert }, { label: t("gfe.medium"), value: counts.medium, color: "#FF9500", icon: MapPin }, { label: t("gfe.low"), value: counts.low, color: "#00C853", icon: MapPin }].map(s => (
          <div key={s.label} className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: webMode ? "1fr 340px" : "1fr" }}>
        <div ref={mapEl} style={{ height: webMode ? "62vh" : 360, minHeight: 320, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#0a0e17" }} />

        <div className="space-y-3">
          {placing && (
            <div className="p-3 rounded-2xl space-y-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(0,200,83,0.3)" }}>
              <p className="text-white" style={{ fontSize: 13, fontWeight: 800 }}>{t("gfe.newZoneSetCenter")}</p>

              {/* Method 1+2: my location / click map */}
              <div className="flex gap-1.5">
                <button onClick={useMyLocation} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg" style={{ fontSize: 11, fontWeight: 700, color: "#00C8E0", background: "rgba(0,200,224,0.1)", border: "1px solid rgba(0,200,224,0.25)" }}><Crosshair className="size-3.5" /> {t("gfe.myLocation")}</button>
                <div className="flex-1 flex items-center justify-center py-2 rounded-lg" style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.12)" }}>{t("gfe.orClickMap")}</div>
              </div>

              {/* Method 3: paste a maps link / coordinates */}
              <div>
                <label style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>{t("gfe.pasteMapsLabel")}</label>
                <div className="flex gap-1.5 mt-1">
                  <input value={pasteVal} onChange={e => setPasteVal(e.target.value)} placeholder={t("gfe.pastePlaceholder")} style={INPUT} />
                  <button onClick={applyPaste} className="px-3 rounded-lg flex items-center" style={{ background: "rgba(0,200,83,0.15)", border: "1px solid rgba(0,200,83,0.3)", color: "#00C853" }}><ClipboardPaste className="size-4" /></button>
                </div>
              </div>

              {/* Method 4: manual lat/lng */}
              <div>
                <label style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 600 }}>{t("gfe.orTypeCoords")}</label>
                <div className="flex gap-1.5 mt-1">
                  <input value={latVal} onChange={e => setLatVal(e.target.value)} placeholder={t("gfe.latitude")} inputMode="decimal" style={INPUT} />
                  <input value={lngVal} onChange={e => setLngVal(e.target.value)} placeholder={t("gfe.longitude")} inputMode="decimal" style={INPUT} />
                  <button onClick={applyManual} className="px-3 rounded-lg" style={{ fontSize: 11, fontWeight: 700, background: "rgba(0,200,83,0.15)", border: "1px solid rgba(0,200,83,0.3)", color: "#00C853" }}>{t("gfe.set")}</button>
                </div>
              </div>

              {draft && (
                <div className="pt-2 space-y-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <p style={{ fontSize: 10, color: "#00C853", fontFamily: "monospace" }}>✓ {t("gfe.center")}: {draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}</p>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t("gfe.zoneNamePlaceholder")} style={INPUT} />
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={{ ...INPUT, fontSize: 12 }}>
                    {ZONE_TYPES.map(t => <option key={t} value={t} style={{ background: "#0a0e17" }}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                  <div className="flex gap-1.5">
                    {(["low", "medium", "high"] as RiskLevel[]).map(r => (
                      <button key={r} onClick={() => setForm(f => ({ ...f, risk: r }))} className="flex-1 py-1.5 rounded-lg" style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", color: form.risk === r ? "#05070E" : RISK_COLOR[r], background: form.risk === r ? RISK_COLOR[r] : `${RISK_COLOR[r]}18`, border: `1px solid ${RISK_COLOR[r]}40` }}>{r}</button>
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>{t("gfe.radius")}</label>
                      <div className="flex items-center gap-1">
                        <input type="number" min={10} max={5000} value={form.radius} onChange={e => setForm(f => ({ ...f, radius: Math.max(10, Math.min(5000, Number(e.target.value) || 0)) }))} style={{ ...INPUT, width: 78, padding: "5px 8px", fontSize: 12, fontWeight: 700, textAlign: "right" }} />
                        <span style={{ fontSize: 12, color: "#00C8E0", fontWeight: 700 }}>m</span>
                      </div>
                    </div>
                    <input type="range" min={25} max={2000} step={25} value={Math.min(2000, form.radius)} onChange={e => setForm(f => ({ ...f, radius: Number(e.target.value) }))} style={{ width: "100%", accentColor: "#00C853" }} />
                  </div>
                  <button onClick={saveZone} disabled={saving} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl" style={{ fontSize: 13, fontWeight: 800, color: "#05070E", background: "#00C853", opacity: saving ? 0.6 : 1 }}><Save className="size-4" /> {saving ? t("gfe.saving") : t("gfe.saveZone")}</button>
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-white px-3 py-2" style={{ fontSize: 12, fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>{t("gfe.zonesHeading")} ({zones.length})</p>
            {loading ? (
              <p className="px-3 py-4" style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{t("gfe.loading")}</p>
            ) : zones.length === 0 ? (
              <p className="px-3 py-4" style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{t("gfe.noZonesYet")}</p>
            ) : zones.map(z => (
              <div key={z.id} className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <span className="size-2.5 rounded-full flex-shrink-0" style={{ background: RISK_COLOR[z.risk_level || "medium"] }} />
                <button onClick={() => { try { mapObj.current?.setView([z.lat, z.lng], 16); } catch { /* */ } }} className="flex-1 text-left">
                  <p className="text-white" style={{ fontSize: 12, fontWeight: 600 }}>{z.name}</p>
                  <p style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>{(z.type || t("gfe.zoneFallbackType")).replace(/_/g, " ")} · {z.radius_meters}m</p>
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
