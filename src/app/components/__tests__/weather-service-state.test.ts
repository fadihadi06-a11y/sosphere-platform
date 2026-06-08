// ═══════════════════════════════════════════════════════════════
// weather-service — 29th pattern app contract tests
// ─────────────────────────────────────────────────────────────
// 2026-06-08 — Covers the pure surface of the weather service:
// severityFromCondition (must mirror DB rules in
// record_weather_observation), formatTempC (null-safety),
// isStaleObs (60-min default freshness), aggregateSeverity
// (worst-of-list).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  severityFromCondition,
  formatTempC,
  isStaleObs,
  aggregateSeverity,
  type WeatherObservation,
} from "../weather-service";

function obs(partial: Partial<WeatherObservation>): WeatherObservation {
  return {
    id: "WX-test", company_id: "c1", zone_id: null,
    observed_at: new Date().toISOString(),
    lat: 24.7, lng: 46.7, condition: "Clear",
    temp_c: 25, feels_like_c: 25, humidity_pct: 40,
    wind_speed_ms: 3, wind_gust_ms: null, visibility_m: 10000,
    severity: "info", provider: "openweather", payload: {},
    observer_id: null, created_at: new Date().toISOString(),
    ...partial,
  };
}

describe("weather-service: severityFromCondition (mirrors DB rules)", () => {
  it("Thunderstorm/Tornado/Squall → severe", () => {
    expect(severityFromCondition("Thunderstorm")).toBe("severe");
    expect(severityFromCondition("Tornado")).toBe("severe");
    expect(severityFromCondition("Squall")).toBe("severe");
  });

  it("Sand/Dust/Ash → severe (MENA-critical)", () => {
    expect(severityFromCondition("Sand")).toBe("severe");
    expect(severityFromCondition("Dust")).toBe("severe");
    expect(severityFromCondition("Ash")).toBe("severe");
  });

  it("temp ≥ 45°C → severe (MENA-critical heat)", () => {
    expect(severityFromCondition("Clear", 45)).toBe("severe");
    expect(severityFromCondition("Clear", 50)).toBe("severe");
    expect(severityFromCondition("Clear", 44.9)).not.toBe("severe");
  });

  it("wind gust ≥ 20 m/s → severe", () => {
    expect(severityFromCondition("Clear", 20, 20)).toBe("severe");
    expect(severityFromCondition("Clear", 20, 25)).toBe("severe");
    expect(severityFromCondition("Clear", 20, 19.9)).not.toBe("severe");
  });

  it("Snow/Fog/Mist/Haze → warning", () => {
    expect(severityFromCondition("Snow")).toBe("warning");
    expect(severityFromCondition("Fog")).toBe("warning");
    expect(severityFromCondition("Mist")).toBe("warning");
    expect(severityFromCondition("Haze")).toBe("warning");
  });

  it("temp ≥ 40°C (but < 45°C) → warning", () => {
    expect(severityFromCondition("Clear", 40)).toBe("warning");
    expect(severityFromCondition("Clear", 44.9)).toBe("warning");
    expect(severityFromCondition("Clear", 39.9)).toBe("info");
  });

  it("visibility < 1000m → warning", () => {
    expect(severityFromCondition("Clear", 20, 5, 999)).toBe("warning");
    expect(severityFromCondition("Clear", 20, 5, 1000)).toBe("info");
  });

  it("Clear day at 25°C → info", () => {
    expect(severityFromCondition("Clear", 25, 3, 10000)).toBe("info");
  });

  it("severe rule precedence: Sand beats temp warning", () => {
    expect(severityFromCondition("Sand", 41)).toBe("severe");
  });
});

describe("weather-service: formatTempC", () => {
  it("rounds to nearest integer + appends °C", () => {
    expect(formatTempC(23.4)).toBe("23°C");
    expect(formatTempC(23.6)).toBe("24°C");
    expect(formatTempC(0)).toBe("0°C");
    expect(formatTempC(-5.5)).toBe("-5°C");
  });

  it("returns dash for null/undefined/NaN", () => {
    expect(formatTempC(null)).toBe("—");
    expect(formatTempC(undefined)).toBe("—");
    expect(formatTempC(NaN)).toBe("—");
    expect(formatTempC(Infinity)).toBe("—");
  });
});

describe("weather-service: isStaleObs", () => {
  it("fresh observation (within 60 min) → false", () => {
    const now = Date.parse("2026-06-08T12:00:00Z");
    expect(isStaleObs("2026-06-08T11:30:00Z", now)).toBe(false);
    expect(isStaleObs("2026-06-08T11:00:01Z", now)).toBe(false);
  });

  it("stale observation (> 60 min) → true", () => {
    const now = Date.parse("2026-06-08T12:00:00Z");
    expect(isStaleObs("2026-06-08T10:59:59Z", now)).toBe(true);
    expect(isStaleObs("2026-06-08T09:00:00Z", now)).toBe(true);
  });

  it("custom freshness window respected", () => {
    const now = Date.parse("2026-06-08T12:00:00Z");
    expect(isStaleObs("2026-06-08T11:50:00Z", now, 5)).toBe(true);   // 10 min ago, 5min window
    expect(isStaleObs("2026-06-08T11:58:00Z", now, 5)).toBe(false);  // 2 min ago, 5min window
  });

  it("invalid timestamp → treated as stale (safe default)", () => {
    expect(isStaleObs("not-a-date")).toBe(true);
    expect(isStaleObs("")).toBe(true);
  });
});

describe("weather-service: aggregateSeverity", () => {
  it("empty list → info", () => {
    expect(aggregateSeverity([])).toBe("info");
  });

  it("all info → info", () => {
    expect(aggregateSeverity([obs({ severity: "info" }), obs({ severity: "info" })])).toBe("info");
  });

  it("any warning → warning", () => {
    expect(aggregateSeverity([obs({ severity: "info" }), obs({ severity: "warning" })])).toBe("warning");
  });

  it("any severe → severe (highest precedence)", () => {
    expect(aggregateSeverity([
      obs({ severity: "info" }),
      obs({ severity: "warning" }),
      obs({ severity: "severe" }),
    ])).toBe("severe");
  });

  it("severe in front does not get downgraded by trailing warnings", () => {
    expect(aggregateSeverity([
      obs({ severity: "severe" }),
      obs({ severity: "warning" }),
      obs({ severity: "info" }),
    ])).toBe("severe");
  });
});
