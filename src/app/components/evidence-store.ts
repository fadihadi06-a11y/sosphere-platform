import { supabase, SUPABASE_CONFIG } from "./api/supabase-client";
import type { EvidenceManifest } from "./evidence-hash";

import { Shield } from "lucide-react";
// =================================================================
// SOSphere -- Evidence Intelligence Pipeline (Central Vault)
// =================================================================
// Stores, tracks, and routes ALL field evidence (photos + audio)
// through the entire dashboard lifecycle:
//
//  Worker captures --> Evidence Store --> AdminBroadcastPanel
//     --> Incident Reports Hub --> Incident Investigation (RCA)
//     --> Risk Register --> Audit Log --> Emergency Lifecycle PDF
//
// Chain of Custody: every view, comment, and action is tracked
// =================================================================

export interface EvidencePhoto {
  id: string;
  dataUrl: string;
  caption?: string;
  size: string;
}

export interface EvidenceAudioMemo {
  id: string;
  dataUrl: string;       // base64 audio
  durationSec: number;
  format: string;        // "webm", "mp4", etc.
  transcription?: string; // AI transcription (mock for prototype)
}

export interface EvidenceComment {
  id: string;
  author: string;
  role: string;          // "HSE Manager", "Zone Admin", etc.
  text: string;
  timestamp: number;
  type: "comment" | "annotation" | "escalation" | "resolution";
}

export interface EvidenceAction {
  id: string;
  actor: string;
  role: string;
  action: string;
  // What happened
  actionType:
    | "viewed"
    | "broadcast"
    | "forwarded"
    | "attached_to_rca"
    | "attached_to_risk"
    | "added_to_audit"
    | "exported_pdf"
    | "guide_me_triggered"
    | "archived";
  timestamp: number;
  details?: string;
}

export interface EvidenceEntry {
  // Core identity
  id: string;                    // EVD-{timestamp}
  emergencyId: string;
  incidentReportId?: string;     // Links to hub-incident-reports

  // Who submitted
  submittedBy: string;           // Worker name
  submittedAt: number;
  zone: string;

  // Incident metadata
  severity: "low" | "medium" | "high" | "critical";
  incidentType: string;
  workerComment: string;

  // Evidence payloads
  photos: EvidencePhoto[];
  audioMemo?: EvidenceAudioMemo;

  // Lifecycle tracking
  status: "pending" | "reviewed" | "broadcast" | "in_rca" | "closed" | "archived";
  reviewedBy?: string;
  reviewedAt?: number;

  // Chain of custody
  actions: EvidenceAction[];
  comments: EvidenceComment[];

  // Cross-references (which pages consumed this evidence)
  linkedInvestigationId?: string;  // INV-xxx
  linkedRiskEntryId?: string;      // RISK-xxx
  linkedAuditEntryId?: string;     // AUD-xxx
  includedInPDF?: boolean;

  // Tier info
  tier: "free" | "paid" | "enterprise";
  retentionDays: number;

  /**
   * Phase 5 — Tamper-evident SHA-256 manifest for this evidence
   * bundle. Optional: attached asynchronously after storeEvidence()
   * via attachEvidenceManifest() once hashing completes. Older
   * entries (pre-Phase 5) simply omit this field; readers must
   * tolerate its absence.
   */
  evidenceManifest?: EvidenceManifest;
}

// =================================================================
// Storage — Dual Mode: Supabase (primary) + localStorage (fallback)
// =================================================================
// Tries Supabase first. If offline or unconfigured, falls back to
// localStorage. Photos/audio upload to Supabase Storage bucket.
// =================================================================

const EVIDENCE_KEY = "sosphere_evidence_vault";
const EVIDENCE_EVENT_KEY = "sosphere_evidence_event";

// ── Helper: Check if Supabase is available ──
function isSupabaseReady(): boolean {
  return SUPABASE_CONFIG.isConfigured;
}

// ── Helper: Upload a base64 dataUrl to Supabase Storage ──
async function uploadToStorage(path: string, dataUrl: string): Promise<string> {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const { error } = await supabase.storage
      .from("evidence")
      .upload(path, blob, { upsert: true, contentType: blob.type });
    if (error) throw error;
    const { data: urlData } = supabase.storage
      .from("evidence").getPublicUrl(path);
    return urlData.publicUrl;
  } catch (e) {
    console.warn("[Evidence] Storage upload failed, keeping dataUrl:", e);
    return dataUrl; // Keep original base64 as fallback
  }
}

// ── Load from Supabase first, then localStorage fallback ──
async function loadVaultAsync(): Promise<EvidenceEntry[]> {
  if (isSupabaseReady()) {
    try {
      const { data, error } = await supabase
        .from("evidence")
        .select("*")
        .order("submitted_at", { ascending: false })
        .limit(100);
      if (!error && data && data.length > 0) {
        return data as EvidenceEntry[];
      }
    } catch (e) {
      console.warn("[Evidence] Supabase load failed, using localStorage:", e);
    }
  }
  return loadVault();
}

// ── Synchronous localStorage (for backwards compatibility) ──
function loadVault(): EvidenceEntry[] {
  try {
    return JSON.parse(localStorage.getItem(EVIDENCE_KEY) || "[]");
  } catch {
    return [];
  }
}

// ── Save to both Supabase AND localStorage ──
async function saveVaultAsync(entries: EvidenceEntry[]): Promise<void> {
  // Always save to localStorage as fallback/cache
  localStorage.setItem(EVIDENCE_KEY, JSON.stringify(entries));

  if (isSupabaseReady()) {
    try {
      // Upsert each entry to Supabase
      const { error } = await supabase
        .from("evidence")
        .upsert(
          entries.map(e => ({
            id: e.id,
            emergency_id: e.emergencyId,
            incident_report_id: e.incidentReportId || null,
            submitted_by: e.submittedBy,
            submitted_at: new Date(e.submittedAt).toISOString(),
            zone: e.zone,
            severity: e.severity,
            incident_type: e.incidentType,
            worker_comment: e.workerComment,
            photos: e.photos,
            audio_memo: e.audioMemo || null,
            status: e.status,
            reviewed_by: e.reviewedBy || null,
            reviewed_at: e.reviewedAt ? new Date(e.reviewedAt).toISOString() : null,
            actions: e.actions,
            comments: e.comments,
            linked_investigation_id: e.linkedInvestigationId || null,
            linked_risk_entry_id: e.linkedRiskEntryId || null,
            linked_audit_entry_id: e.linkedAuditEntryId || null,
            included_in_pdf: e.includedInPDF || false,
            tier: e.tier,
            retention_days: e.retentionDays,
          })),
          { onConflict: "id" }
        );
      if (error) console.warn("[Evidence] Supabase save failed:", error.message);
    } catch (e) {
      console.warn("[Evidence] Supabase save failed:", e);
    }
  }
}

function saveVault(entries: EvidenceEntry[]) {
  // Synchronous localStorage save (immediate)
  localStorage.setItem(EVIDENCE_KEY, JSON.stringify(entries));
  // Async Supabase save (background, non-blocking)
  saveVaultAsync(entries).catch(() => {});
}

// Notify other tabs/devices about evidence changes
function notifyChange(evidenceId: string, action: string) {
  // localStorage event for same-browser tabs
  const payload = JSON.stringify({ evidenceId, action, _ts: Date.now() });
  localStorage.setItem(EVIDENCE_EVENT_KEY, payload);
  window.dispatchEvent(
    new StorageEvent("storage", { key: EVIDENCE_EVENT_KEY, newValue: payload })
  );

  // Supabase Realtime broadcast for cross-device sync
  if (isSupabaseReady()) {
    supabase.channel("evidence-changes").send({
      type: "broadcast",
      event: "evidence_update",
      payload: { evidenceId, action },
    }).catch(() => {});
  }
}

// =================================================================
// CRUD Operations
// =================================================================

/** Store new evidence from field worker report */
export function storeEvidence(entry: Omit<EvidenceEntry, "id" | "actions" | "comments" | "status">): EvidenceEntry {
  const vault = loadVault();
  const evidenceId = `EVD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const newEntry: EvidenceEntry = {
    ...entry,
    id: evidenceId,
    status: "pending",
    actions: [{
      id: `ACT-${Date.now()}`,
      actor: entry.submittedBy,
      role: "Field Worker",
      action: "Evidence submitted from field",
      actionType: "viewed",
      timestamp: entry.submittedAt,
      details: `${entry.photos.length} photos${entry.audioMemo ? " + voice memo" : ""} submitted`,
    }],
    comments: [],
  };
  vault.unshift(newEntry);
  // Keep max 100 entries
  saveVault(vault.slice(0, 100));
  notifyChange(newEntry.id, "new_evidence");

  // Background: upload photos & audio to Supabase Storage (non-blocking)
  if (isSupabaseReady()) {
    (async () => {
      try {
        // Upload each photo
        for (let i = 0; i < newEntry.photos.length; i++) {
          const photo = newEntry.photos[i];
          if (photo.dataUrl && photo.dataUrl.startsWith("data:")) {
            const ext = photo.dataUrl.includes("png") ? "png" : "jpg";
            const path = `${evidenceId}/photo-${i}.${ext}`;
            const publicUrl = await uploadToStorage(path, photo.dataUrl);
            photo.dataUrl = publicUrl; // Replace base64 with server URL
          }
        }
        // Upload audio memo
        if (newEntry.audioMemo?.dataUrl?.startsWith("data:")) {
          const audioPath = `${evidenceId}/audio-memo.webm`;
          const audioUrl = await uploadToStorage(audioPath, newEntry.audioMemo.dataUrl);
          newEntry.audioMemo.dataUrl = audioUrl;
        }
        // Re-save with server URLs
        const updatedVault = loadVault();
        const idx = updatedVault.findIndex(e => e.id === evidenceId);
        if (idx !== -1) {
          updatedVault[idx] = newEntry;
          saveVault(updatedVault);
        }
      } catch (e) {
        console.warn("[Evidence] Background upload failed, data safe in localStorage:", e);
      }
    })();
  }

  return newEntry;
}

/** Get all evidence entries */
export function getAllEvidence(): EvidenceEntry[] {
  return loadVault();
}

/** Get evidence for a specific emergency */
export function getEvidenceForEmergency(emergencyId: string): EvidenceEntry[] {
  return loadVault().filter(e => e.emergencyId === emergencyId);
}

/** Get evidence for a specific zone */
export function getEvidenceForZone(zone: string): EvidenceEntry[] {
  return loadVault().filter(e => e.zone.toLowerCase().includes(zone.toLowerCase()));
}

/** Get pending (unreviewed) evidence */
export function getPendingEvidence(): EvidenceEntry[] {
  return loadVault().filter(e => e.status === "pending");
}

/** Update evidence status */
export function updateEvidenceStatus(
  evidenceId: string,
  status: EvidenceEntry["status"],
  actor: string,
  role: string
): EvidenceEntry | null {
  const vault = loadVault();
  const idx = vault.findIndex(e => e.id === evidenceId);
  if (idx === -1) return null;

  vault[idx].status = status;
  if (status === "reviewed") {
    vault[idx].reviewedBy = actor;
    vault[idx].reviewedAt = Date.now();
  }
  vault[idx].actions.push({
    id: `ACT-${Date.now()}`,
    actor,
    role,
    action: `Status changed to ${status}`,
    actionType: "viewed",
    timestamp: Date.now(),
  });
  saveVault(vault);
  notifyChange(evidenceId, "status_changed");
  return vault[idx];
}

/** Add an action to evidence chain of custody */
export function addEvidenceAction(
  evidenceId: string,
  action: Omit<EvidenceAction, "id" | "timestamp">
): void {
  const vault = loadVault();
  const idx = vault.findIndex(e => e.id === evidenceId);
  if (idx === -1) return;

  vault[idx].actions.push({
    ...action,
    id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
    timestamp: Date.now(),
  });
  saveVault(vault);
  notifyChange(evidenceId, action.actionType);
}

/** Add a comment to evidence */
export function addEvidenceComment(
  evidenceId: string,
  comment: Omit<EvidenceComment, "id" | "timestamp">
): void {
  const vault = loadVault();
  const idx = vault.findIndex(e => e.id === evidenceId);
  if (idx === -1) return;

  vault[idx].comments.push({
    ...comment,
    id: `CMT-${Date.now()}`,
    timestamp: Date.now(),
  });
  saveVault(vault);
  notifyChange(evidenceId, "comment_added");
}

/**
 * Phase 5 — Attach a SHA-256 integrity manifest to an existing
 * evidence entry. Called after storeEvidence() once async hashing
 * finishes. Silently no-ops if the entry has been evicted or never
 * existed; never throws so the SOS flow can't be blocked.
 *
 * We also log a dedicated chain-of-custody action so the manifest's
 * arrival is visible in the dashboard's existing "recent actions"
 * stream — no new UI code required.
 */
export function attachEvidenceManifest(
  evidenceId: string,
  manifest: EvidenceManifest
): void {
  try {
    const vault = loadVault();
    const idx = vault.findIndex(e => e.id === evidenceId);
    if (idx === -1) return;
    vault[idx].evidenceManifest = manifest;
    vault[idx].actions.push({
      id: `ACT-${Date.now()}-hash`,
      actor: vault[idx].submittedBy,
      role: "Field Worker",
      action: "Evidence integrity hash computed",
      actionType: "viewed",
      timestamp: manifest.computedAt,
      details: `SHA-256 manifest · ${manifest.photoHashes.length} photo hash${manifest.photoHashes.length === 1 ? "" : "es"}${manifest.audioHash ? " + audio" : ""}${manifest.commentHash ? " + comment" : ""}`,
    });
    saveVault(vault);
    notifyChange(evidenceId, "hash_attached");
  } catch (e) {
    console.warn("[Evidence] attachEvidenceManifest failed (non-fatal):", e);
  }
}

/** Link evidence to an investigation */
export function linkToInvestigation(evidenceId: string, investigationId: string, actor: string): void {
  const vault = loadVault();
  const idx = vault.findIndex(e => e.id === evidenceId);
  if (idx === -1) return;

  vault[idx].linkedInvestigationId = investigationId;
  vault[idx].status = "in_rca";
  vault[idx].actions.push({
    id: `ACT-${Date.now()}`,
    actor,
    role: "Investigator",
    action: `Linked to investigation ${investigationId}`,
    actionType: "attached_to_rca",
    timestamp: Date.now(),
  });
  saveVault(vault);
  notifyChange(evidenceId, "linked_to_rca");
}

/** Link evidence to risk register */
export function linkToRiskRegister(evidenceId: string, riskEntryId: string, actor: string): void {
  const vault = loadVault();
  const idx = vault.findIndex(e => e.id === evidenceId);
  if (idx === -1) return;

  vault[idx].linkedRiskEntryId = riskEntryId;
  vault[idx].actions.push({
    id: `ACT-${Date.now()}`,
    actor,
    role: "Risk Manager",
    action: `Linked to risk register entry ${riskEntryId}`,
    actionType: "attached_to_risk",
    timestamp: Date.now(),
  });
  saveVault(vault);
  notifyChange(evidenceId, "linked_to_risk");
}

/** Mark evidence as exported in PDF */
export function markExportedInPDF(evidenceId: string, actor: string): void {
  const vault = loadVault();
  const idx = vault.findIndex(e => e.id === evidenceId);
  if (idx === -1) return;

  vault[idx].includedInPDF = true;
  vault[idx].actions.push({
    id: `ACT-${Date.now()}`,
    actor,
    role: "Report Generator",
    action: "Evidence metadata included in Emergency Lifecycle PDF",
    actionType: "exported_pdf",
    timestamp: Date.now(),
  });
  saveVault(vault);
}

/** Listen for evidence vault changes (localStorage + Supabase Realtime) */
export function onEvidenceChange(callback: (evidenceId: string, action: string) => void) {
  // localStorage listener (same browser)
  const handler = (e: StorageEvent) => {
    if (e.key === EVIDENCE_EVENT_KEY && e.newValue) {
      try {
        const { evidenceId, action } = JSON.parse(e.newValue);
        callback(evidenceId, action);
      } catch {}
    }
  };
  window.addEventListener("storage", handler);

  // Supabase Realtime listener (cross-device)
  let unsubRealtime: (() => void) | null = null;
  if (isSupabaseReady()) {
    try {
      const channel = supabase
        .channel("evidence-changes")
        .on("broadcast", { event: "evidence_update" }, (payload: any) => {
          const { evidenceId, action } = payload.payload || {};
          if (evidenceId) callback(evidenceId, action);
        })
        .subscribe();
      unsubRealtime = () => supabase.removeChannel(channel);
    } catch {}
  }

  return () => {
    window.removeEventListener("storage", handler);
    unsubRealtime?.();
  };
}

// =================================================================
// Evidence Pipeline Summary — for Guide Me / Copilot
// =================================================================

export interface EvidencePipelineStatus {
  totalEvidence: number;
  pendingReview: number;
  inRCA: number;
  linkedToRisk: number;
  exported: number;
  archived: number;
  recentActions: EvidenceAction[];
  // Suggestions for Guide Me
  suggestions: EvidenceSuggestion[];
}

export interface EvidenceSuggestion {
  id: string;
  priority: "high" | "medium" | "low";
  icon: string; // lucide icon name
  title: string;
  description: string;
  actionLabel: string;
  navigateTo: string;    // dashboard page to navigate to
  evidenceId?: string;
}

/** Get pipeline status + smart suggestions for Guide Me */
export function getEvidencePipelineStatus(): EvidencePipelineStatus {
  const vault = loadVault();
  const suggestions: EvidenceSuggestion[] = [];

  const pending = vault.filter(e => e.status === "pending");
  const reviewed = vault.filter(e => e.status === "reviewed");
  const inRca = vault.filter(e => e.status === "in_rca");

  // Suggestion: Unreviewed evidence
  if (pending.length > 0) {
    suggestions.push({
      id: "sug-review",
      priority: "high",
      icon: "Eye",
      title: `${pending.length} evidence report${pending.length > 1 ? "s" : ""} awaiting review`,
      description: `From ${pending.map(p => p.submittedBy).join(", ")}. Review photos and voice memos now.`,
      actionLabel: "Review Evidence",
      navigateTo: "emergencyHub",
      evidenceId: pending[0]?.id,
    });
  }

  // Suggestion: Reviewed but not linked to investigation
  const reviewedNoRCA = reviewed.filter(e => !e.linkedInvestigationId);
  if (reviewedNoRCA.length > 0) {
    suggestions.push({
      id: "sug-rca",
      priority: "medium",
      icon: "Search",
      title: `${reviewedNoRCA.length} evidence not linked to any investigation`,
      description: "Attach field evidence to an incident investigation for complete RCA documentation.",
      actionLabel: "Open Investigations",
      navigateTo: "investigation",
    });
  }

  // Suggestion: Evidence not in risk register
  const noRisk = vault.filter(e => e.status !== "pending" && !e.linkedRiskEntryId && e.severity !== "low");
  if (noRisk.length > 0) {
    suggestions.push({
      id: "sug-risk",
      priority: "low",
      icon: "Shield",
      title: "Update Risk Register with field evidence",
      description: `${noRisk.length} high/medium severity evidence entries can improve your risk matrix.`,
      actionLabel: "Open Risk Register",
      navigateTo: "riskRegister",
    });
  }

  // Get recent actions across all evidence
  const allActions = vault.flatMap(e => e.actions);
  allActions.sort((a, b) => b.timestamp - a.timestamp);

  return {
    totalEvidence: vault.length,
    pendingReview: pending.length,
    inRCA: inRca.length,
    linkedToRisk: vault.filter(e => e.linkedRiskEntryId).length,
    exported: vault.filter(e => e.includedInPDF).length,
    archived: vault.filter(e => e.status === "archived").length,
    recentActions: allActions.slice(0, 10),
    suggestions,
  };
}

// =================================================================
// Audio Recording Tier Limits
// =================================================================

export const AUDIO_LIMITS = {
  free: { maxDurationSec: 30,  label: "30 seconds" },
  paid: { maxDurationSec: 180, label: "3 minutes" },
  enterprise: { maxDurationSec: 600, label: "10 minutes" },
} as const;

// =================================================================
// Evidence Flow Stages (for visual pipeline)
// =================================================================

export const EVIDENCE_PIPELINE_STAGES = [
  { id: "captured",    label: "Captured",          icon: "Camera",       color: "#00C8E0", desc: "Worker captures photos + audio" },
  { id: "submitted",   label: "Submitted",         icon: "Send",         color: "#7B5EFF", desc: "Report sent to admin" },
  { id: "reviewed",    label: "Admin Reviewed",     icon: "Eye",          color: "#FF9500", desc: "Admin reviews and broadcasts" },
  { id: "broadcast",   label: "Team Notified",      icon: "Megaphone",    color: "#FF6B00", desc: "Safety warning broadcast" },
  { id: "rca",         label: "In Investigation",   icon: "Search",       color: "#AF52DE", desc: "Attached to RCA + CAPA" },
  { id: "risk",        label: "Risk Updated",       icon: "Shield",       color: "#FF2D55", desc: "Risk matrix updated" },
  { id: "audit",       label: "Audit Logged",       icon: "FileText",     color: "#4A90D9", desc: "Permanent compliance record" },
  { id: "pdf",         label: "In Report",          icon: "Download",     color: "#00C853", desc: "Evidence in lifecycle PDF" },
] as const;

/** Get the current stage of an evidence entry */
export function getEvidenceStage(entry: EvidenceEntry): number {
  if (entry.includedInPDF) return 7;
  if (entry.linkedRiskEntryId) return 5;
  if (entry.linkedInvestigationId) return 4;
  if (entry.status === "broadcast") return 3;
  if (entry.status === "reviewed") return 2;
  if (entry.status === "pending") return 1;
  return 0;
}

// =================================================================
// Mock Evidence Seeding — for Prototype Demo
// =================================================================

const MOCK_SEED_KEY = "sosphere_evidence_seeded_v2";

/** Seed realistic mock evidence so the prototype isn't empty on first load */
export function seedMockEvidence(): void {
  if (localStorage.getItem(MOCK_SEED_KEY)) return;
  const existing = loadVault();
  if (existing.length > 0) {
    localStorage.setItem(MOCK_SEED_KEY, "1");
    return;
  }

  const now = Date.now();
  const hour = 3_600_000;

  // Use a tiny 1x1 placeholder for photo dataUrls (avoids bloating localStorage)
  const PLACEHOLDER_IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

  const mockEntries: EvidenceEntry[] = [
    {
      id: "EVD-2026-001",
      emergencyId: "EM-2026-0312-001",
      incidentReportId: "RPT-001",
      submittedBy: "Mohammed Ali",
      submittedAt: now - 2 * hour,
      zone: "Zone A - North Tower",
      severity: "high",
      incidentType: "Scaffolding Instability",
      workerComment: "The scaffolding on Level 3 was shaking when wind picked up. I heard metal creaking. Took photos of the loose bolts and the base plate shifting.",
      photos: [
        { id: "P-001a", dataUrl: PLACEHOLDER_IMG, caption: "Loose bolt on Level 3 joint", size: "1.2MB" },
        { id: "P-001b", dataUrl: PLACEHOLDER_IMG, caption: "Base plate displacement", size: "0.8MB" },
        { id: "P-001c", dataUrl: PLACEHOLDER_IMG, caption: "Overview from ground level", size: "1.5MB" },
      ],
      audioMemo: {
        id: "AUD-001",
        dataUrl: "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGCGFVVWBAYWOZTGEVRTFNH",
        durationSec: 42,
        format: "webm",
        transcription: "I'm on Level 3, north side. The scaffolding is visibly shaking. I can see two bolts missing from the joint connector, and the base plate has shifted about 3 centimeters from its mark.",
      },
      status: "pending",
      actions: [
        { id: "ACT-M001-1", actor: "Mohammed Ali", role: "Field Worker", action: "Evidence submitted from field", actionType: "viewed", timestamp: now - 2 * hour, details: "3 photos + voice memo submitted" },
      ],
      comments: [],
      tier: "enterprise",
      retentionDays: 365,
    },
    {
      id: "EVD-2026-002",
      emergencyId: "EM-2026-0311-002",
      submittedBy: "Fatima Hassan",
      submittedAt: now - 8 * hour,
      zone: "Zone B - Chemical Storage",
      severity: "critical",
      incidentType: "Chemical Spill",
      workerComment: "Chemical leak from Drum #47 in Storage Bay 2. The containment bund is overflowing. Strong fumes. I evacuated the area immediately.",
      photos: [
        { id: "P-002a", dataUrl: PLACEHOLDER_IMG, caption: "Leaking drum #47", size: "0.9MB" },
        { id: "P-002b", dataUrl: PLACEHOLDER_IMG, caption: "Overflowing containment bund", size: "1.1MB" },
      ],
      audioMemo: {
        id: "AUD-002",
        dataUrl: "data:audio/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwH/////////FUmpZpkq17GDD0JATYCGQ2hyb21lV0GGCGFVVQBTYM4ZTGEVRTFNH",
        durationSec: 28,
        format: "webm",
      },
      status: "reviewed",
      reviewedBy: "Rania Abbas",
      reviewedAt: now - 6 * hour,
      actions: [
        { id: "ACT-M002-1", actor: "Fatima Hassan", role: "Field Worker", action: "Evidence submitted from field", actionType: "viewed", timestamp: now - 8 * hour, details: "2 photos + voice memo" },
        { id: "ACT-M002-2", actor: "Rania Abbas", role: "HSE Manager", action: "Evidence reviewed — critical severity confirmed", actionType: "viewed", timestamp: now - 6 * hour },
        { id: "ACT-M002-3", actor: "Rania Abbas", role: "HSE Manager", action: "Safety warning broadcast to Zone B team", actionType: "broadcast", timestamp: now - 5.5 * hour },
      ],
      comments: [
        { id: "CMT-M002-1", author: "Rania Abbas", role: "HSE Manager", text: "Drum #47 is Acetone. MSDS protocol activated. Environmental team dispatched.", type: "escalation", timestamp: now - 5.8 * hour },
      ],
      tier: "enterprise",
      retentionDays: 365,
    },
    {
      id: "EVD-2026-003",
      emergencyId: "EM-2026-0310-003",
      submittedBy: "Omar Al-Farsi",
      submittedAt: now - 26 * hour,
      zone: "Zone C - Main Road Access",
      severity: "medium",
      incidentType: "Near Miss — Vehicle",
      workerComment: "Delivery truck nearly hit a worker at the pedestrian crossing. No barriers in place. Speed was excessive.",
      photos: [
        { id: "P-003a", dataUrl: PLACEHOLDER_IMG, caption: "Unmarked crossing point", size: "0.7MB" },
      ],
      status: "in_rca",
      reviewedBy: "Admin",
      reviewedAt: now - 24 * hour,
      linkedInvestigationId: "INV-001",
      actions: [
        { id: "ACT-M003-1", actor: "Omar Al-Farsi", role: "Field Worker", action: "Evidence submitted from field", actionType: "viewed", timestamp: now - 26 * hour },
        { id: "ACT-M003-2", actor: "Admin", role: "HSE Manager", action: "Status changed to reviewed", actionType: "viewed", timestamp: now - 24 * hour },
        { id: "ACT-M003-3", actor: "Admin", role: "Investigator", action: "Linked to investigation INV-001", actionType: "attached_to_rca", timestamp: now - 20 * hour },
      ],
      comments: [
        { id: "CMT-M003-1", author: "Admin", role: "HSE Manager", text: "Speed limit enforcement and barrier installation added to CAPA plan.", type: "annotation", timestamp: now - 22 * hour },
      ],
      tier: "enterprise",
      retentionDays: 365,
    },
  ];

  saveVault(mockEntries);
  localStorage.setItem(MOCK_SEED_KEY, "1");
}