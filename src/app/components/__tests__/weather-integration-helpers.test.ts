// ═══════════════════════════════════════════════════════════════
// weather-service integration helpers — Integration A + B tests
// ─────────────────────────────────────────────────────────────
// 2026-06-09 — Covers the pure surface added for the weather → SAR
// (Integration A) and weather → risk-scoring (Integration B) wirings:
//
//   • lookupZoneObservation — pick the most relevant observation for
//     a zone (exact match > site-wide > worst severity fallback)
//   • captureWeatherForSAR — convert observation to forensic snapshot
//   • risk-scoring-engine weather factor — severe = +30, warning = +15
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  lookupZoneObservation,
  captureWeatherForSAR,
  type WeatherObservation,
} from "../weather-service";
import { calculateRiskScore, type EmployeeForRiskScoring } from "../risk-scoring-engine";

function obs(partial: Partial<WeatherObservation>): WeatherObservation {
  return {
    id: "WX-test", company_id: "c1", zone_id: null,
    observed_at: "2026-06-09T12:00:00Z",
    lat: 33.3152, lng: 44.3661, condition: "Clear",
    temp_c: 35, feels_like_c: 33, humidity_pct: 20,
    wind_speed_ms: 3, wind_gust_ms: 5, visibility_m: 10000,
    severity: "info", provider: "openweather", payload: {},
    observer_id: null, created_at: "2026-06-09T12:00:00Z",
    ...partial,
  };
}

const BASE_EMP: EmployeeForRiskScoring = {
  id: "EMP-001", name: "Test Worker",
  joinDate: Date.now() - 365 * 24 * 60 * 60 * 1000,  // 1 year (no new-employee factor)
  hasBuddy: true,
  checkInInterval: 60,
  batteryLevel: 80,
  isWorkingAlone: false,
  shift: "day",
};

// ═══════════════════════════════════════════════════════════════
// lookupZoneObservation
// ═══════════════════════════════════════════════════════════════
describe("weather-service: lookupZoneObservation", () => {
  it("returns null on empty rows", () => {
    expect(lookupZoneObservation([], "Z-A")).toBeNull();
    expect(lookupZoneObservation([], null)).toBeNull();
  });

  it("prefers exact zone_id match when present", () => {
    const a = obs({ zone_id: "Z-A", condition: "Sand", severity: "severe" });
    const b = obs({ zone_id: "Z-B", condition: "Clear", severity: "info" });
    const result = lookupZoneObservation([a, b], "Z-A");
    expect(result?.condition).toBe("Sand");
  });

  it("falls back to site-wide (zone_id=null) when no exact match", () => {
    const site = obs({ zone_id: null, condition: "Clear", severity: "info" });
    const b    = obs({ zone_id: "Z-B", condition: "Rain", severity: "warning" });
    const result = lookupZoneObservation([site, b], "Z-A");
    expect(result?.condition).toBe("Clear");
    expect(result?.zone_id).toBeNull();
  });

  it("falls back to worst severity when no exact + no site-wide match", () => {
    const b = obs({ zone_id: "Z-B", condition: "Clear", severity: "info" });
    const c = obs({ zone_id: "Z-C", condition: "Thunderstorm", severity: "severe" });
    const d = obs({ zone_id: "Z-D", condition: "Fog", severity: "warning" });
    const result = lookupZoneObservation([b, c, d], "Z-A");
    expect(result?.condition).toBe("Thunderstorm");
  });

  it("when zoneId=null prefers site-wide directly", () => {
    const site = obs({ zone_id: null, condition: "Clear", severity: "info" });
    const a    = obs({ zone_id: "Z-A", condition: "Sand", severity: "severe" });
    const result = lookupZoneObservation([site, a], null);
    expect(result?.zone_id).toBeNull();
    expect(result?.condition).toBe("Clear");
  });
});

// ═══════════════════════════════════════════════════════════════
// captureWeatherForSAR
// ═══════════════════════════════════════════════════════════════
describe("weather-service: captureWeatherForSAR", () => {
  it("returns null when input is null", () => {
    expect(captureWeatherForSAR(null)).toBeNull();
  });

  it("maps every numeric + string field through", () => {
    const o = obs({
      condition: "Sand", temp_c: 47, feels_like_c: 52,
      humidity_pct: 8, wind_speed_ms: 12, wind_gust_ms: 25,
      visibility_m: 800, severity: "severe", provider: "openweather_cron",
    });
    const snap = captureWeatherForSAR(o);
    expect(snap?.condition).toBe("Sand");
    expect(snap?.temp_c).toBe(47);
    expect(snap?.feels_like_c).toBe(52);
    expect(snap?.humidity_pct).toBe(8);
    expect(snap?.wind_speed_ms).toBe(12);
    expect(snap?.wind_gust_ms).toBe(25);
    expect(snap?.visibility_m).toBe(800);
    expect(snap?.severity).toBe("severe");
    expect(snap?.provider).toBe("openweather_cron");
  });

  it("preserves observedAt from the source observation", () => {
    const o = obs({ observed_at: "2026-06-09T15:30:00Z" });
    const snap = captureWeatherForSAR(o);
    expect(snap?.observedAt).toBe("2026-06-09T15:30:00Z");
  });

  it("stamps capturedAt at call time (within 2 seconds of now)", () => {
    const o = obs({});
    const before = Date.now();
    const snap = captureWeatherForSAR(o);
    const after = Date.now();
    const captured = Date.parse(snap!.capturedAt);
    expect(captured).toBeGreaterThanOrEqual(before);
    expect(captured).toBeLessThanOrEqual(after + 2000);
  });

  it("propagates null numeric fields as null (not 0)", () => {
    const o = obs({ temp_c: null, wind_gust_ms: null, visibility_m: null });
    const snap = captureWeatherForSAR(o);
    expect(snap?.temp_c).toBeNull();
    expect(snap?.wind_gust_ms).toBeNull();
    expect(snap?.visibility_m).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// risk-scoring weather factor (Integration B)
// ═══════════════════════════════════════════════════════════════
describe("risk-scoring-engine: weather factor", () => {
  it("does not add a factor when weatherSeverity is undefined", () => {
    const result = calculateRiskScore({ ...BASE_EMP });
    expect(result.factors.find(f => f.id === "severe_weather" || f.id === "warning_weather")).toBeUndefined();
    expect(result.totalScore).toBe(0);
  });

  it("does not add a factor when weatherSeverity is 'info'", () => {
    const result = calculateRiskScore({ ...BASE_EMP, weatherSeverity: "info" });
    expect(result.factors.find(f => f.id === "severe_weather" || f.id === "warning_weather")).toBeUndefined();
    expect(result.totalScore).toBe(0);
  });

  it("adds +15 (warning_weather, medium) for warning severity", () => {
    const result = calculateRiskScore({ ...BASE_EMP, weatherSeverity: "warning", weatherCondition: "Fog" });
    const factor = result.factors.find(f => f.id === "warning_weather");
    expect(factor).toBeDefined();
    expect(factor?.points).toBe(15);
    expect(factor?.severity).toBe("medium");
    expect(factor?.label).toContain("Fog");
    expect(result.totalScore).toBe(15);
  });

  it("adds +30 (severe_weather, high) for severe severity", () => {
    const result = calculateRiskScore({ ...BASE_EMP, weatherSeverity: "severe", weatherCondition: "Sand" });
    const factor = result.factors.find(f => f.id === "severe_weather");
    expect(factor).toBeDefined();
    expect(factor?.points).toBe(30);
    expect(factor?.severity).toBe("high");
    expect(factor?.label).toContain("Sand");
    expect(result.totalScore).toBe(30);
  });

  it("falls back to generic label when condition is missing", () => {
    const severe = calculateRiskScore({ ...BASE_EMP, weatherSeverity: "severe" });
    expect(severe.factors.find(f => f.id === "severe_weather")?.label).toBe("Severe weather active");
    const warn = calculateRiskScore({ ...BASE_EMP, weatherSeverity: "warning" });
    expect(warn.factors.find(f => f.id === "warning_weather")?.label).toBe("Weather warning active");
  });

  it("severe weather suggestion added to suggestions list", () => {
    const result = calculateRiskScore({ ...BASE_EMP, weatherSeverity: "severe" });
    expect(result.suggestions.some(s => /Defer non-critical outdoor work/.test(s))).toBe(true);
  });

  it("warning weather suggestion added to suggestions list", () => {
    const result = calculateRiskScore({ ...BASE_EMP, weatherSeverity: "warning" });
    expect(result.suggestions.some(s => /Brief workers on weather conditions/.test(s))).toBe(true);
  });

  it("weather factor composes additively with other factors", () => {
    // Low battery (+25) + working alone (+15) + severe weather (+30) = 70 → "warning" level
    const result = calculateRiskScore({
      ...BASE_EMP,
      batteryLevel: 12,
      isWorkingAlone: true,
      weatherSeverity: "severe",
    });
    expect(result.totalScore).toBe(70);
    expect(result.level).toBe("warning");
  });
});
