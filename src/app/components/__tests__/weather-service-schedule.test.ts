// ═══════════════════════════════════════════════════════════════
// weather-service schedule helpers — 29th pattern phase 3 contract tests
// ─────────────────────────────────────────────────────────────
// 2026-06-08 — Covers the pure surface added for Weather Admin UI:
// validateScheduleInput (mirrors DB upsert_weather_schedule checks),
// nextFetchAt (computes due time from last_fetched_at + freq),
// formatTimeUntil (UI badge "now/5m/2h 15m/—").
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  validateScheduleInput,
  nextFetchAt,
  formatTimeUntil,
  type WeatherScheduleInput,
} from "../weather-service";

const VALID: WeatherScheduleInput = {
  companyId:        "c07008cd-2824-40ad-9dae-33f8074e1ed9",
  zoneId:           null,
  lat:              33.3152,
  lng:              44.3661,
  frequencyMinutes: 60,
  enabled:          true,
};

describe("weather-service: validateScheduleInput", () => {
  it("accepts a valid baghdad-coords site-wide input", () => {
    expect(validateScheduleInput({ ...VALID })).toBeNull();
  });

  it("accepts zone-specific schedules", () => {
    expect(validateScheduleInput({ ...VALID, zoneId: "Z-A" })).toBeNull();
  });

  it("rejects missing/short company id", () => {
    expect(validateScheduleInput({ ...VALID, companyId: "" })).toMatch(/Company id/);
    expect(validateScheduleInput({ ...VALID, companyId: "short" })).toMatch(/Company id/);
  });

  it("rejects out-of-range latitude", () => {
    expect(validateScheduleInput({ ...VALID, lat: 91 })).toMatch(/Latitude/);
    expect(validateScheduleInput({ ...VALID, lat: -91 })).toMatch(/Latitude/);
    expect(validateScheduleInput({ ...VALID, lat: NaN })).toMatch(/Latitude/);
  });

  it("rejects out-of-range longitude", () => {
    expect(validateScheduleInput({ ...VALID, lng: 181 })).toMatch(/Longitude/);
    expect(validateScheduleInput({ ...VALID, lng: -181 })).toMatch(/Longitude/);
    expect(validateScheduleInput({ ...VALID, lng: Infinity })).toMatch(/Longitude/);
  });

  it("accepts edge coordinates (±90, ±180)", () => {
    expect(validateScheduleInput({ ...VALID, lat: 90,  lng: 180 })).toBeNull();
    expect(validateScheduleInput({ ...VALID, lat: -90, lng: -180 })).toBeNull();
  });

  it("rejects frequency outside 15-1440 range", () => {
    expect(validateScheduleInput({ ...VALID, frequencyMinutes: 14 })).toMatch(/Frequency/);
    expect(validateScheduleInput({ ...VALID, frequencyMinutes: 1441 })).toMatch(/Frequency/);
    expect(validateScheduleInput({ ...VALID, frequencyMinutes: 0 })).toMatch(/Frequency/);
  });

  it("rejects non-integer frequency", () => {
    expect(validateScheduleInput({ ...VALID, frequencyMinutes: 60.5 })).toMatch(/Frequency/);
  });

  it("accepts frequency at the edges (15 and 1440)", () => {
    expect(validateScheduleInput({ ...VALID, frequencyMinutes: 15 })).toBeNull();
    expect(validateScheduleInput({ ...VALID, frequencyMinutes: 1440 })).toBeNull();
  });
});

describe("weather-service: nextFetchAt", () => {
  it("returns null for disabled schedules", () => {
    expect(nextFetchAt({ enabled: false, last_fetched_at: null, frequency_minutes: 60 })).toBeNull();
    expect(nextFetchAt({ enabled: false, last_fetched_at: "2026-06-08T19:00:00Z", frequency_minutes: 60 })).toBeNull();
  });

  it("returns 'now' (current Date) for never-fetched enabled schedules", () => {
    const result = nextFetchAt({ enabled: true, last_fetched_at: null, frequency_minutes: 60 });
    expect(result).toBeInstanceOf(Date);
    expect(Math.abs((result as Date).getTime() - Date.now())).toBeLessThan(1000);
  });

  it("returns last_fetched_at + frequency for fetched schedules", () => {
    const result = nextFetchAt({
      enabled: true,
      last_fetched_at: "2026-06-08T19:00:00Z",
      frequency_minutes: 60,
    });
    expect(result?.toISOString()).toBe("2026-06-08T20:00:00.000Z");
  });

  it("returns null for invalid timestamps", () => {
    expect(nextFetchAt({ enabled: true, last_fetched_at: "not-a-date", frequency_minutes: 60 })).toBeNull();
  });
});

describe("weather-service: formatTimeUntil", () => {
  const now = Date.parse("2026-06-08T19:00:00Z");

  it("returns dash for null target", () => {
    expect(formatTimeUntil(null, now)).toBe("—");
  });

  it("returns 'now' when target is past or equal", () => {
    expect(formatTimeUntil(new Date(now), now)).toBe("now");
    expect(formatTimeUntil(new Date(now - 1000), now)).toBe("now");
  });

  it("formats minutes-only when under 1 hour", () => {
    expect(formatTimeUntil(new Date(now + 5 * 60_000), now)).toBe("5m");
    expect(formatTimeUntil(new Date(now + 30 * 60_000), now)).toBe("30m");
    expect(formatTimeUntil(new Date(now + 59 * 60_000), now)).toBe("59m");
  });

  it("formats hours when at or over 1 hour", () => {
    expect(formatTimeUntil(new Date(now + 60 * 60_000), now)).toBe("1h");
    expect(formatTimeUntil(new Date(now + 120 * 60_000), now)).toBe("2h");
  });

  it("formats hours + minutes when not on the hour", () => {
    expect(formatTimeUntil(new Date(now + 75 * 60_000), now)).toBe("1h 15m");
    expect(formatTimeUntil(new Date(now + 135 * 60_000), now)).toBe("2h 15m");
  });

  it("rounds to nearest minute", () => {
    expect(formatTimeUntil(new Date(now + 60_000 * 4.4), now)).toBe("4m");
    expect(formatTimeUntil(new Date(now + 60_000 * 4.6), now)).toBe("5m");
  });
});
