// =================================================================
// SOSphere — Integration Readiness Checklist
// =================================================================
// Run this in the browser console to see what's connected and
// what still needs work before production deployment.
//
// Usage: import { runIntegrationCheck } from "./api/integration-checklist";
//        runIntegrationCheck(); // Prints report to console
// =================================================================

import { SUPABASE_CONFIG } from "./supabase-client";
import { getDataMode } from "./data-layer";
import { getStorageBackend } from "./storage-adapter";

interface CheckResult {
  name: string;
  status: "ready" | "mock" | "missing" | "partial";
  detail: string;
  priority: "critical" | "high" | "medium" | "low";
  effort: string;
}

export function runIntegrationCheck(): CheckResult[] {
  const results: CheckResult[] = [];

  // 1. Supabase Connection
  results.push({
    name: "Supabase Connection",
    status: SUPABASE_CONFIG.isConfigured ? "ready" : "missing",
    detail: SUPABASE_CONFIG.isConfigured
      ? `Connected to ${SUPABASE_CONFIG.url}`
      : "Set SUPABASE_URL and SUPABASE_ANON_KEY in supabase-client.ts",
    priority: "critical",
    effort: "5 minutes",
  });

  // 2. Data Layer Mode
  results.push({
    name: "Data Layer",
    status: getDataMode() === "supabase" ? "ready" : "mock",
    detail: getDataMode() === "supabase"
      ? "Using Supabase for data"
      : "Using mock data — call setDataMode('supabase') after connecting",
    priority: "critical",
    effort: "1 line change",
  });

  // 3. Storage Backend
  results.push({
    name: "Storage Backend",
    status: getStorageBackend() === "supabase" ? "ready" : "mock",
    detail: getStorageBackend() === "supabase"
      ? "Using Supabase Storage"
      : "Using localStorage — call setStorageBackend('supabase') after connecting",
    priority: "high",
    effort: "1 line change",
  });

  // 4. Voice Call Provider
  results.push({
    name: "Voice Calls (Twilio)",
    status: SUPABASE_CONFIG.isConfigured ? "partial" : "mock",
    detail: SUPABASE_CONFIG.isConfigured
      ? "Supabase connected — deploy Edge Functions + set Twilio secrets"
      : "Using LocalWebRTC (demo) — needs Supabase + Twilio account",
    priority: "critical",
    effort: "2 hours (Edge Functions + Twilio setup)",
  });

  // 5. SMS Notifications
  results.push({
    name: "SMS Notifications",
    status: "mock",
    detail: "Needs Twilio SMS Edge Function — twilio-sms",
    priority: "critical",
    effort: "1 hour",
  });

  // 6. Push Notifications
  results.push({
    name: "Push Notifications",
    status: typeof Notification !== "undefined" && Notification.permission === "granted" ? "partial" : "mock",
    detail: "Browser notifications work — needs FCM/APNs for mobile",
    priority: "high",
    effort: "4 hours",
  });

  // 7. GPS Tracking
  results.push({
    name: "GPS Tracking",
    status: "navigator" in globalThis && "geolocation" in navigator ? "partial" : "mock",
    detail: "Browser Geolocation API available — needs native app for background tracking",
    priority: "high",
    effort: "React Native migration",
  });

  // 8. Database Schema
  results.push({
    name: "Database Schema (RLS)",
    status: "missing",
    detail: "Copy SQL from rls-policies.ts to Supabase SQL Editor",
    priority: "critical",
    effort: "15 minutes",
  });

  // 9. Authentication
  results.push({
    name: "Authentication",
    status: "mock",
    detail: "RBAC types ready — enable Supabase Auth + set role in JWT claims",
    priority: "critical",
    effort: "2 hours",
  });

  // 10. Offline Sync
  results.push({
    name: "Offline Sync Engine",
    status: "partial",
    detail: "IndexedDB + Sync Engine ready — replace simulateNetworkSend() with fetch()",
    priority: "medium",
    effort: "30 minutes",
  });

  // 11. Error Tracking
  results.push({
    name: "Error Tracking (Sentry)",
    status: "missing",
    detail: "Error Boundaries added — connect to Sentry for production monitoring",
    priority: "high",
    effort: "30 minutes",
  });

  // 12. Zustand Store
  results.push({
    name: "State Management (Zustand)",
    status: "ready",
    detail: "Dashboard store created — ready for React Query integration",
    priority: "low",
    effort: "Done",
  });

  // Print report
  console.group("%c SOSphere Integration Checklist", "font-size: 16px; font-weight: bold; color: #00C8E0;");
  
  const statusEmoji = { ready: "✅", partial: "🟡", mock: "🔶", missing: "❌" };
  const priorityColor = { critical: "#FF2D55", high: "#FF9500", medium: "#FFD700", low: "#00C853" };

  results.forEach(r => {
    console.log(
      `${statusEmoji[r.status]} %c${r.name}%c — ${r.detail} %c[${r.effort}]`,
      `font-weight: bold; color: ${priorityColor[r.priority]}`,
      "color: inherit",
      "color: #888; font-style: italic",
    );
  });

  const readyCount = results.filter(r => r.status === "ready").length;
  const total = results.length;
  console.log(`\n📊 Progress: ${readyCount}/${total} ready (${Math.round(readyCount / total * 100)}%)`);
  console.groupEnd();

  return results;
}

// Auto-expose to window for console access
if (typeof window !== "undefined") {
  (window as any).sosCheck = runIntegrationCheck;
}
