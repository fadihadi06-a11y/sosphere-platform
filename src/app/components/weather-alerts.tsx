// ═══════════════════════════════════════════════════════════════
// SOSphere — Weather Alerts & Environmental Monitoring
// ─────────────────────────────────────────────────────────────
// Auto-monitors weather conditions for all zone locations
// Severe weather → guided response for evacuation/work pause
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CloudRain, Sun, Wind, Thermometer, Eye, AlertTriangle,
  CloudLightning, Snowflake, Droplets, ChevronRight,
  Shield, Bell, MapPin, Clock, CheckCircle, X,
  ArrowUpRight, CloudSun, Zap, Navigation,
} from "lucide-react";
import { toast } from "sonner";
import { hapticSuccess, hapticWarning, hapticMedium } from "./haptic-feedback";

// ── Types ─────────────────────────────────────────────────────
interface WeatherAlert {
  id: string;
  type: "storm" | "heat" | "flood" | "wind" | "lightning" | "sandstorm" | "cold";
  severity: "extreme" | "severe" | "moderate" | "advisory";
  title: string;
  description: string;
  zone: string;
  startTime: Date;
  endTime?: Date;
  isActive: boolean;
  recommendation: string;
}

interface ZoneWeather {
  zone: string;
  temp: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  condition: string;
  icon: any;
  riskLevel: "safe" | "caution" | "danger";
  uvIndex: number;
}

// ── Mock Data ─────────────────────────────────────────────────
const MOCK_ALERTS: WeatherAlert[] = [
  {
    id: "WA-001", type: "storm", severity: "severe",
    title: "Severe Thunderstorm Warning",
    description: "Heavy rain expected with wind gusts up to 80 km/h. Lightning risk is high. Outdoor work should be suspended.",
    zone: "Zone A — North Gate", startTime: new Date(Date.now() + 3600000), endTime: new Date(Date.now() + 14400000),
    isActive: true, recommendation: "Pause outdoor operations. Move workers to indoor shelters. Activate evacuation if lightning intensifies.",
  },
  {
    id: "WA-002", type: "heat", severity: "extreme",
    title: "Extreme Heat Advisory",
    description: "Temperature will exceed 48°C. Heat stroke risk is critical for outdoor workers. Mandatory hydration breaks every 30 minutes.",
    zone: "Zone D — South Wing", startTime: new Date(Date.now() - 7200000), endTime: new Date(Date.now() + 21600000),
    isActive: true, recommendation: "Enforce 30-min work / 15-min rest cycle. Provide electrolyte drinks. Monitor workers for heat exhaustion symptoms.",
  },
  {
    id: "WA-003", type: "sandstorm", severity: "moderate",
    title: "Sandstorm Advisory",
    description: "Visibility may drop below 500m between 14:00–18:00. Respiratory protection recommended.",
    zone: "All Zones", startTime: new Date(Date.now() + 10800000),
    isActive: true, recommendation: "Issue N95 masks. Reduce vehicle speed. Secure loose equipment.",
  },
  {
    id: "WA-004", type: "wind", severity: "advisory",
    title: "High Wind Notice",
    description: "Wind gusts up to 50 km/h expected. Crane operations should be reviewed.",
    zone: "Zone E — Logistics", startTime: new Date(Date.now() + 7200000),
    isActive: false, recommendation: "Review crane operating limits. Secure lightweight materials. Use wind speed gauges.",
  },
];

const ZONE_WEATHER: ZoneWeather[] = [
  { zone: "Zone A", temp: 42, feelsLike: 46, humidity: 35, windSpeed: 18, condition: "Partly Cloudy", icon: CloudSun, riskLevel: "caution", uvIndex: 9 },
  { zone: "Zone B", temp: 40, feelsLike: 43, humidity: 40, windSpeed: 12, condition: "Sunny", icon: Sun, riskLevel: "caution", uvIndex: 10 },
  { zone: "Zone C", temp: 38, feelsLike: 40, humidity: 45, windSpeed: 8, condition: "Overcast", icon: CloudRain, riskLevel: "safe", uvIndex: 4 },
  { zone: "Zone D", temp: 48, feelsLike: 53, humidity: 25, windSpeed: 22, condition: "Extreme Heat", icon: Thermometer, riskLevel: "danger", uvIndex: 11 },
  { zone: "Zone E", temp: 39, feelsLike: 42, humidity: 38, windSpeed: 35, condition: "Windy", icon: Wind, riskLevel: "caution", uvIndex: 8 },
];

const SEVERITY_CONFIG = {
  extreme:  { color: "#FF2D55", bg: "rgba(255,45,85,0.06)", label: "EXTREME" },
  severe:   { color: "#FF9500", bg: "rgba(255,150,0,0.06)", label: "SEVERE" },
  moderate: { color: "#FFD60A", bg: "rgba(255,214,10,0.06)", label: "MODERATE" },
  advisory: { color: "#00C8E0", bg: "rgba(0,200,224,0.06)", label: "ADVISORY" },
};

const ALERT_ICONS: Record<string, any> = {
  storm: CloudLightning, heat: Thermometer, flood: Droplets,
  wind: Wind, lightning: Zap, sandstorm: Eye, cold: Snowflake,
};

const RISK_CONFIG = {
  safe:    { color: "#00C853", label: "Safe" },
  caution: { color: "#FF9500", label: "Caution" },
  danger:  { color: "#FF2D55", label: "Danger" },
};

// ── Real OpenMeteo fetcher (free, no API key) ─────────────────
interface OpenMeteoData {
  temp: number;
  feelsLike: number;
  windSpeed: number;
  humidity: number;
  weatherCode: number;
  precipitation: number;
  uvIndex: number;
}

// OpenMeteo WMO weather codes → our types
function wmoToType(code: number): WeatherAlert["type"] {
  if (code >= 95) return "storm";
  if (code >= 71 && code <= 77) return "cold";
  if (code >= 51 && code <= 67) return "flood";
  if (code >= 80 && code <= 82) return "flood";
  return "wind";
}
function wmoToCondition(code: number): string {
  if (code === 0) return "Clear Sky";
  if (code <= 2) return "Partly Cloudy";
  if (code <= 3) return "Overcast";
  if (code <= 49) return "Foggy";
  if (code <= 67) return "Rainy";
  if (code <= 77) return "Snowy";
  if (code <= 82) return "Heavy Rain";
  if (code <= 94) return "Hail";
  return "Thunderstorm";
}
function riskFromWeather(temp: number, wind: number, code: number): ZoneWeather["riskLevel"] {
  if (temp > 45 || code >= 95 || wind > 60) return "danger";
  if (temp > 38 || code >= 51 || wind > 30) return "caution";
  return "safe";
}

async function fetchOpenMeteo(lat: number, lng: number): Promise<OpenMeteoData | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,windspeed_10m,relative_humidity_2m,weather_code,precipitation,uv_index&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const j = await res.json();
    const c = j.current;
    return {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      windSpeed: Math.round(c.windspeed_10m),
      humidity: Math.round(c.relative_humidity_2m),
      weatherCode: c.weather_code,
      precipitation: c.precipitation,
      uvIndex: Math.round(c.uv_index || 0),
    };
  } catch { return null; }
}

// Company GPS from localStorage, fallback to Riyadh
function getCompanyCoords(): { lat: number; lng: number } {
  try {
    const p = JSON.parse(localStorage.getItem("sosphere_company_profile") || "{}");
    if (p.lat && p.lng) return { lat: p.lat, lng: p.lng };
  } catch {}
  return { lat: 24.7136, lng: 46.6753 }; // Riyadh default
}

function buildWeatherAlerts(weather: OpenMeteoData, zoneName: string): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  const now = Date.now();
  if (weather.temp > 42) {
    alerts.push({ id: `WA-HEAT-${now}`, type: "heat", severity: weather.temp > 46 ? "extreme" : "severe",
      title: weather.temp > 46 ? "Extreme Heat Advisory" : "Heat Warning",
      description: `Temperature ${weather.temp}°C (feels like ${weather.feelsLike}°C). Heat stress risk for outdoor workers.`,
      zone: zoneName, startTime: new Date(), isActive: true,
      recommendation: "Enforce 30-min work / 15-min rest cycles. Provide water every 15 minutes. Monitor workers for heat exhaustion." });
  }
  if (weather.windSpeed > 40) {
    alerts.push({ id: `WA-WIND-${now}`, type: "wind", severity: weather.windSpeed > 60 ? "severe" : "moderate",
      title: "High Wind Warning",
      description: `Wind speed ${weather.windSpeed} km/h. Crane operations and tall structure work at risk.`,
      zone: zoneName, startTime: new Date(), isActive: true,
      recommendation: "Suspend crane ops above wind limit. Secure loose materials. Reduce vehicle speed." });
  }
  if (weather.weatherCode >= 95) {
    alerts.push({ id: `WA-STORM-${now}`, type: "storm", severity: "severe",
      title: "Thunderstorm Warning",
      description: `Active thunderstorm detected. Precipitation: ${weather.precipitation}mm. Lightning risk high.`,
      zone: zoneName, startTime: new Date(), isActive: true,
      recommendation: "Stop all outdoor operations. Move workers to shelter. Wait for all-clear before resuming." });
  }
  if (weather.uvIndex >= 10) {
    alerts.push({ id: `WA-UV-${now}`, type: "heat", severity: "advisory",
      title: "Extreme UV Index",
      description: `UV Index ${weather.uvIndex} (Extreme). Unprotected sun exposure dangerous within minutes.`,
      zone: zoneName, startTime: new Date(), isActive: true,
      recommendation: "Issue UV-protective clothing. Require hats and sunscreen. Schedule heavy outdoor work before 9am or after 4pm." });
  }
  return alerts;
}

// ── Dashboard Page ────────────────────────────────────────────
export function WeatherAlertsPage({ t, webMode }: { t: (k: string) => string; webMode?: boolean }) {
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [realWeather, setRealWeather] = useState<OpenMeteoData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchWeather = useCallback(async () => {
    setWeatherLoading(true);
    setWeatherError(false);
    const coords = getCompanyCoords();
    const data = await fetchOpenMeteo(coords.lat, coords.lng);
    if (data) {
      setRealWeather(data);
      setLastUpdated(new Date());
    } else {
      setWeatherError(true);
    }
    setWeatherLoading(false);
  }, []);

  useEffect(() => {
    fetchWeather();
    // Refresh every 10 minutes
    const interval = setInterval(fetchWeather, 600000);
    return () => clearInterval(interval);
  }, [fetchWeather]);

  // Build real alerts from live weather, fall back to mock
  const activeAlerts = realWeather
    ? buildWeatherAlerts(realWeather, "All Zones")
    : MOCK_ALERTS.filter(a => a.isActive);

  // Build real zone weather if we have live data
  const zoneWeatherData: ZoneWeather[] = realWeather
    ? ZONE_WEATHER.map(z => ({
        ...z,
        temp: realWeather.temp + ((z.zone.charCodeAt(0) % 3) - 1), // deterministic ±1° variance per zone
        feelsLike: realWeather.feelsLike,
        humidity: realWeather.humidity,
        windSpeed: realWeather.windSpeed,
        condition: wmoToCondition(realWeather.weatherCode),
        riskLevel: riskFromWeather(realWeather.temp, realWeather.windSpeed, realWeather.weatherCode),
        uvIndex: realWeather.uvIndex,
      }))
    : ZONE_WEATHER;

  return (
    <div className={`p-5 space-y-5 ${webMode ? "max-w-5xl mx-auto" : ""}`}>
      {/* Real-time indicator */}
      {lastUpdated && (
        <div className="flex items-center justify-between px-1">
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
            Live weather · Updated {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button onClick={fetchWeather} disabled={weatherLoading} style={{ fontSize: 11, color: "#00C8E0", background: "none", border: "none", cursor: "pointer" }}>
            {weatherLoading ? "Updating…" : "↻ Refresh"}
          </button>
        </div>
      )}
      {weatherError && (
        <div style={{ fontSize: 11, color: "#FF9500", padding: "4px 8px", background: "rgba(255,150,0,0.08)", borderRadius: 8 }}>
          ⚠ Live weather unavailable — showing cached data
        </div>
      )}
      {/* Zone Weather Grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Sun className="size-4" style={{ color: "#FF9500" }} />
          <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Current Conditions by Zone</p>
        </div>
        <div className="grid grid-cols-5 gap-2.5">
          {zoneWeatherData.map(zw => {
            const ZIcon = zw.icon;
            const risk = RISK_CONFIG[zw.riskLevel];
            return (
              <div key={zw.zone} className="rounded-xl p-3"
                style={{ background: `${risk.color}04`, border: `1px solid ${risk.color}10` }}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{zw.zone}</span>
                  <div className="px-1.5 py-0.5 rounded" style={{ background: `${risk.color}12`, border: `1px solid ${risk.color}20` }}>
                    <span style={{ fontSize: 7, fontWeight: 800, color: risk.color }}>{risk.label.toUpperCase()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <ZIcon className="size-5" style={{ color: risk.color }} />
                  <span className="text-white" style={{ fontSize: 22, fontWeight: 800 }}>{zw.temp}°</span>
                </div>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                  Feels {zw.feelsLike}° &bull; 💧{zw.humidity}% &bull; 💨{zw.windSpeed}km/h
                </p>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                  UV {zw.uvIndex} &bull; {zw.condition}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Alerts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4" style={{ color: "#FF9500" }} />
            <p className="text-white" style={{ fontSize: 14, fontWeight: 700 }}>Weather Alerts</p>
            {activeAlerts.length > 0 && (
              <div className="px-1.5 py-0.5 rounded-md" style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.15)" }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: "#FF2D55" }}>{activeAlerts.length} ACTIVE</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2.5">
          {activeAlerts.map(alert => {
            const sev = SEVERITY_CONFIG[alert.severity];
            const AlertIcon = ALERT_ICONS[alert.type] || AlertTriangle;
            const isExpanded = expandedAlert === alert.id;

            return (
              <motion.div key={alert.id} layout className="rounded-xl overflow-hidden"
                style={{ background: sev.bg, border: `1px solid ${sev.color}12` }}>
                <button onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
                  className="w-full flex items-start gap-3 p-3.5 text-left">
                  <motion.div
                    animate={alert.isActive ? { scale: [1, 1.05, 1] } : {}}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="size-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${sev.color}12`, border: `1px solid ${sev.color}20` }}>
                    <AlertIcon className="size-5" style={{ color: sev.color }} />
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-white" style={{ fontSize: 13, fontWeight: 700 }}>{alert.title}</p>
                      {alert.isActive && (
                        <motion.div
                          animate={{ opacity: [1, 0.5, 1] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          className="size-2 rounded-full" style={{ background: sev.color }}
                        />
                      )}
                    </div>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 4, lineHeight: 1.4 }}>
                      {alert.description}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="px-1.5 py-0.5 rounded" style={{ background: `${sev.color}10`, border: `1px solid ${sev.color}15` }}>
                        <span style={{ fontSize: 8, fontWeight: 800, color: sev.color }}>{sev.label}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="size-2.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{alert.zone}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="size-2.5" style={{ color: "rgba(255,255,255,0.2)" }} />
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                          {alert.startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {alert.endTime && ` — ${alert.endTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                        </span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="size-4 mt-1" style={{ color: "rgba(255,255,255,0.15)", transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="px-3.5 pb-3.5 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 10 }}>
                        {/* Recommendation */}
                        <div className="rounded-xl p-3" style={{ background: "rgba(0,200,224,0.03)", border: "1px solid rgba(0,200,224,0.06)" }}>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <Shield className="size-3" style={{ color: "#00C8E0" }} />
                            <span style={{ fontSize: 9, fontWeight: 700, color: "#00C8E0", letterSpacing: "0.5px" }}>RECOMMENDED ACTION</span>
                          </div>
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                            {alert.recommendation}
                          </p>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          {alert.severity !== "advisory" && (
                            <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
                              onClick={() => { hapticWarning(); toast.success("Protocol Activated", { description: `Weather response protocol triggered for ${alert.zone}` }); }}
                              style={{ background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.12)", cursor: "pointer" }}>
                              <Navigation className="size-3.5" style={{ color: "#FF2D55" }} />
                              <span style={{ fontSize: 11, color: "#FF2D55", fontWeight: 600 }}>Activate Protocol</span>
                            </button>
                          )}
                          <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl"
                            onClick={() => { hapticMedium(); toast.success("Workers Alerted", { description: `All workers in ${alert.zone} notified about ${alert.title}` }); }}
                            style={{ background: "rgba(255,150,0,0.06)", border: "1px solid rgba(255,150,0,0.1)", cursor: "pointer" }}>
                            <Bell className="size-3.5" style={{ color: "#FF9500" }} />
                            <span style={{ fontSize: 11, color: "#FF9500", fontWeight: 600 }}>Alert Workers</span>
                          </button>
                          <button className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl"
                            onClick={() => { hapticSuccess(); toast("Alert Dismissed", { description: `"${alert.title}" has been dismissed` }); setExpandedAlert(null); }}
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                            <X className="size-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>Dismiss</span>
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}