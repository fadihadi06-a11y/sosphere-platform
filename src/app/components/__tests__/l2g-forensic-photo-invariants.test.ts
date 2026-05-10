// ═══════════════════════════════════════════════════════════════
// SOSphere — L2-G: post-call forensic photo capture invariants
// ─────────────────────────────────────────────────────────────
// Locks the contract that the device captures ONE forensic
// photo when the SOS call ends, uploads it to evidence
// storage, hashes it for the manifest chain, and mirrors the
// event to audit_log.
//
// What this guards against:
//   • A refactor that fires the capture during in-call phases
//     — would burn the camera + battery + permission slot
//     during the most critical part of the SOS
//   • A refactor that fires MORE than once per SOS — would
//     burst captures (battery / storage), and the dedupe ref
//     is the cheapest possible guard
//   • A refactor that drops the SHA-256 hash — would break the
//     L2-H evidence chain-of-custody contract (a photo entry
//     with no hash can't be proven untampered)
//   • A refactor that drops the silent permission policy —
//     surfacing an OS camera-permission modal during an active
//     emergency would be a brutal UX regression
//   • A refactor that lets the camera track leak (no
//     stream.getTracks().forEach(t => t.stop())) — would
//     keep the LED on and block subsequent captures
//   • A refactor that drops the audit_log mirror — would
//     break the unified compliance timeline
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

let captureSrc = "";
let sosSrc = "";

beforeAll(() => {
  captureSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/sos-forensic-capture.ts"),
    "utf8",
  );
  sosSrc = fs.readFileSync(
    path.resolve(process.cwd(), "src/app/components/sos-emergency.tsx"),
    "utf8",
  );
});

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("L2-G: capture module — security + correctness envelope", () => {
  it("exports captureForensicPhoto with the expected result shape", () => {
    expect(captureSrc).toMatch(/export async function captureForensicPhoto\(/);
    expect(captureSrc).toMatch(/interface ForensicPhotoResult/);
    for (const field of ["url", "sha256", "width", "height", "bytes", "facing", "capturedAt"]) {
      expect(captureSrc).toMatch(new RegExp(`\\b${field}:\\s*`));
    }
  });

  it("uses getUserMedia with rear-camera preference (facingMode environment)", () => {
    expect(captureSrc).toMatch(/navigator\.mediaDevices\.getUserMedia/);
    expect(captureSrc).toMatch(/facingMode:\s*\{\s*ideal:\s*["']environment["']\s*\}/);
    // Audio must be false — this is photo capture, not a parallel mic feed.
    expect(captureSrc).toMatch(/audio:\s*false/);
  });

  it("races the camera open against a capture timeout (no hang)", () => {
    const code = stripComments(captureSrc);
    expect(code).toMatch(/CAPTURE_TIMEOUT_MS\s*=\s*\d+/);
    expect(code).toMatch(/Promise\.race\(\s*\[openPromise,\s*timeout\]\s*\)/);
    expect(code).toMatch(/camera_open_timeout/);
  });

  it("ALWAYS releases the camera track in finally (no LED leak)", () => {
    const code = stripComments(captureSrc);
    // The finally block must include track.stop() — failure to do
    // this keeps the camera LED on after capture.
    expect(code).toMatch(/finally\s*\{[\s\S]{0,300}stream\?\.getTracks\(\)\.forEach\(\s*t\s*=>\s*t\.stop\(\)\s*\)/);
  });

  it("computes SHA-256 of the JPEG bytes (forensic chain)", () => {
    expect(captureSrc).toMatch(/crypto\.subtle\.digest\(\s*["']SHA-256["']/);
  });

  it("upload path is scoped under sos/<emergencyId>/forensic (storage RLS contract)", () => {
    expect(captureSrc).toMatch(/`sos\/\$\{emergencyId\}\/forensic\.jpg`/);
  });

  it("upload target is the 'evidence' bucket (shared with audio)", () => {
    expect(captureSrc).toMatch(/STORAGE_BUCKET\s*=\s*["']evidence["']/);
  });

  it("returns null silently on no-camera / no-permission (best-effort contract)", () => {
    const code = stripComments(captureSrc);
    // Two paths to null: (a) navigator.mediaDevices unavailable,
    // (b) any caught error in the main try.
    expect(code).toMatch(/if \(typeof navigator === ["']undefined["'][\s\S]{0,300}return null/);
    expect(code).toMatch(/catch \(err\)[\s\S]{0,300}return null/);
  });

  it("never auto-prompts during an emergency — no Capacitor Camera plugin call", () => {
    // The Capacitor Camera plugin opens an OS-level UI which is
    // hostile to an active SOS. The capture module MUST use
    // getUserMedia only, never the Capacitor plugin path.
    expect(captureSrc).not.toMatch(/@capacitor\/camera/);
    expect(captureSrc).not.toMatch(/Camera\.getPhoto\(/);
  });
});

describe("L2-G: sos-emergency hook — fire once per session, aftermath only", () => {
  it("declares a one-shot ref (forensicPhotoFiredRef) to dedupe", () => {
    expect(sosSrc).toMatch(/const\s+forensicPhotoFiredRef\s*=\s*useRef\(false\)/);
    expect(sosSrc).toMatch(/forensicPhotoFiredRef\.current\s*=\s*true/);
  });

  it("guards against re-fire on every phase re-render", () => {
    const code = stripComments(sosSrc);
    expect(code).toMatch(/if \(forensicPhotoFiredRef\.current\)\s*return/);
  });

  it("fires only in aftermath phases (monitoring / documenting)", () => {
    const code = stripComments(sosSrc);
    // The phase allowlist must include the post-call states and
    // EXCLUDE the in-call ones.
    expect(code).toMatch(/aftermathPhases:\s*Phase\[\]\s*=\s*\[\s*["']monitoring["']\s*,\s*["']documenting["']\s*\]/);
    expect(code).toMatch(/if \(!aftermathPhases\.includes\(phase\)\)\s*return/);
  });

  it("dynamic-imports the capture module (keeps initial chunk slim)", () => {
    const code = stripComments(sosSrc);
    expect(code).toMatch(/await import\(\s*["']\.\/sos-forensic-capture["']\s*\)/);
  });

  it("mirrors successful capture to audit_log (compliance timeline)", () => {
    const code = stripComments(sosSrc);
    expect(code).toMatch(/rpc\(\s*["']log_sos_audit["']/);
    expect(code).toMatch(/p_action:\s*["']forensic_photo_captured["']/);
    expect(code).toMatch(/p_operation:\s*["']evidence["']/);
    // Metadata must include the hash + dimensions so the audit row
    // is forensically meaningful even if the storage object is
    // later moved / archived.
    for (const field of ["sha256", "bytes", "width", "height", "facing", "captured_at", "upload_path"]) {
      expect(code).toMatch(new RegExp(`\\b${field}:`));
    }
  });

  it("audit_log mirror failure is non-fatal (capture itself is the record)", () => {
    const code = stripComments(sosSrc);
    // The audit_log try/catch must be INSIDE the success branch so
    // a logging failure doesn't surface as a capture failure.
    expect(code).toMatch(/audit_log mirror failed/);
  });
});
