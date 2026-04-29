// ═══════════════════════════════════════════════════════════════
// SOSphere — Mission Control Supabase wiring (Wave 1 / T1.1)
// ─────────────────────────────────────────────────────────────
// Pins the contract for the Mission Control → Supabase migration.
// If a future PR reverts to localStorage polling, drops the
// realtime subscription, or removes RLS-tenant-scoped reads,
// this test fails and the regression is caught in CI.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let supabaseSrc = "";
let controlSrc = "";
let migrationSrc = "";

beforeAll(() => {
  const cwd = process.cwd();
  supabaseSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/mission-supabase.ts"),
    "utf8",
  );
  controlSrc = fs.readFileSync(
    path.resolve(cwd, "src/app/components/mission-control.tsx"),
    "utf8",
  );
  migrationSrc = fs.readFileSync(
    path.resolve(
      cwd,
      "supabase/migrations/20260429180000_w1_t11_missions_realtime_publication.sql",
    ),
    "utf8",
  );
});

// ─────────────────────────────────────────────────────────────
describe("Wave1/T1.1 / mission-supabase data layer", () => {
  it("exports useSupabaseMissions hook", () => {
    expect(supabaseSrc).toMatch(/export function useSupabaseMissions\(/);
  });

  it("reads the missions table from Supabase", () => {
    expect(supabaseSrc).toMatch(/\.from\("missions"\)/);
  });

  it("subscribes to realtime postgres_changes on missions", () => {
    expect(supabaseSrc).toMatch(/subscribeToMissions/);
    expect(supabaseSrc).toContain("postgres_changes");
    expect(supabaseSrc).toMatch(/table:\s*"missions"/);
  });

  it("translates DB rows via mapDbRowToMission", () => {
    expect(supabaseSrc).toMatch(/export function mapDbRowToMission\(/);
  });

  it("provides write helpers (create + cancel)", () => {
    expect(supabaseSrc).toMatch(
      /export async function createMissionInSupabase\(/,
    );
    expect(supabaseSrc).toMatch(
      /export async function cancelMissionInSupabase\(/,
    );
  });

  it("does NOT manually scope by company_id in the read (RLS handles it)", () => {
    // RLS on `missions` filters by company; a manual `.eq("company_id"`)
    // would either be redundant or block legit RLS-resolved rows.
    const readBlock = supabaseSrc.match(
      /loadMissionsFromSupabase[\s\S]{0,400}/,
    );
    expect(readBlock).not.toBeNull();
    expect(readBlock![0]).not.toMatch(/\.eq\("company_id"/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("Wave1/T1.1 / mission-control wired to Supabase", () => {
  it("imports useSupabaseMissions", () => {
    expect(controlSrc).toMatch(
      /import \{ useSupabaseMissions[\s\S]{0,80}\} from "\.\/mission-supabase"/,
    );
  });

  it("calls the hook (no localStorage polling)", () => {
    expect(controlSrc).toMatch(/useSupabaseMissions\(\)/);
  });

  it("does NOT seed demo missions in Mission Control", () => {
    // The old path called seedDemoMissions on mount which polluted
    // every fresh tenant with fake "EMP-001…" missions.
    expect(controlSrc).not.toMatch(/seedDemoMissions\(\)/);
  });

  it("does NOT call getAllMissions (legacy localStorage path)", () => {
    // Strip comments first so explanatory mentions don't false-positive.
    const codeOnly = controlSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/getAllMissions\(\)/);
  });

  it("does NOT poll via setInterval(... 3000)", () => {
    const codeOnly = controlSrc
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/setInterval\([\s\S]*?,\s*3000\s*\)/);
  });

  it("cancel button calls Supabase cancel helper", () => {
    expect(controlSrc).toMatch(/cancelMissionInSupabase\(/);
  });
});

// ─────────────────────────────────────────────────────────────
describe("Wave1/T1.1 / realtime publication migration", () => {
  it("adds the 3 mission tables to supabase_realtime publication", () => {
    expect(migrationSrc).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.missions/,
    );
    expect(migrationSrc).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.mission_gps/,
    );
    expect(migrationSrc).toMatch(
      /ALTER PUBLICATION supabase_realtime ADD TABLE public\.mission_heartbeats/,
    );
  });

  it("uses idempotent guard so the migration is re-runnable", () => {
    expect(migrationSrc).toMatch(/IF NOT EXISTS \(/);
    expect(migrationSrc).toMatch(
      /pg_publication_tables[\s\S]{0,200}supabase_realtime/,
    );
  });
});
