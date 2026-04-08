// ═══════════════════════════════════════════════════════════════
// SOSphere — Health Check Endpoint
// Returns system status and rate limit statistics.
// Useful for monitoring, uptime checks, and dashboards.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getRateLimitStats } from "../_shared/rate-limiter.ts";

const VERSION = "1.0.0";
const STARTUP_TIME = new Date().toISOString();

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // Only allow GET
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed. Use GET /health",
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  try {
    const rateLimitStats = getRateLimitStats();
    const now = new Date().toISOString();
    const uptime = Date.now() - new Date(STARTUP_TIME).getTime();

    const response = {
      status: "ok",
      timestamp: now,
      version: VERSION,
      startupTime: STARTUP_TIME,
      uptimeMs: uptime,
      rateLimitStats: {
        activeWindows: rateLimitStats.activeWindows,
        sosPriorityUsers: rateLimitStats.sosPriorityUsers,
      },
      environment: {
        region: Deno.env.get("REGION") || "unknown",
        runtime: "Deno",
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[api-health] Error:", errorMsg);

    return new Response(
      JSON.stringify({
        status: "error",
        message: errorMsg,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
