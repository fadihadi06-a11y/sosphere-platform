// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio Voice Call Edge Function (Production-Ready)
// Handles: POST /functions/v1/twilio-call
// Purpose: Initiate emergency voice calls from mobile app to safety admin
// Security: Validates JWT, enforces rate limits, logs to audit trail
// Enhanced: Better error handling, retry logic, response timing
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkRateLimit,
  markSosPriority,
  getRateLimitHeaders,
} from "../_shared/rate-limiter.ts";

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Twilio error code mapping ──────────────────────────────────
interface TwilioError {
  code: number;
  message: string;
  isTransient: boolean;
  detail: string;
}

const TWILIO_ERROR_CODES: Record<number, TwilioError> = {
  21211: {
    code: 21211,
    message: "Invalid 'To' number",
    isTransient: false,
    detail: "The phone number is not valid. Check format (E.164).",
  },
  21214: {
    code: 21214,
    message: "Not a mobile number",
    isTransient: false,
    detail: "The number provided is not a mobile phone. Mobile required for voice.",
  },
  21610: {
    code: 21610,
    message: "Unsubscribed recipient",
    isTransient: false,
    detail: "The recipient has requested not to be contacted.",
  },
  20003: {
    code: 20003,
    message: "Not enough credit",
    isTransient: false,
    detail: "Insufficient account credit to send message.",
  },
  // Transient errors that can be retried
  11200: {
    code: 11200,
    message: "HTTP retrieval failure",
    isTransient: true,
    detail: "Failed to retrieve callback URL. May retry.",
  },
  30001: {
    code: 30001,
    message: "Queue overflow",
    isTransient: true,
    detail: "System busy. May retry.",
  },
};

function getTwilioErrorInfo(errorCode: number | string): TwilioError | null {
  const code = parseInt(String(errorCode));
  return TWILIO_ERROR_CODES[code] || null;
}

// ── Retry helper ───────────────────────────────────────────────
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 2,
  delayMs: number = 2000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.log(
        `[twilio-call] Attempt ${attempt} failed, retrying in ${delayMs}ms...`
      );
      await sleep(delayMs);
    }
  }
  throw new Error("Max retries exceeded");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Service-Role-Key",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    let userId: string | null = null;
    let userRole: string | null = null;

    // ── Authenticate: JWT token OR service role key ──────────────
    const authHeader = req.headers.get("Authorization");
    const serviceRoleKey = req.headers.get("X-Service-Role-Key");

    if (authHeader?.startsWith("Bearer ")) {
      // JWT authentication
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }
      userId = user.id;

      // Optional: fetch user role from profiles table
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        userRole = profile?.role || null;
      } catch (e) {
        console.warn("[twilio-call] Could not fetch user role:", e);
      }
    } else if (serviceRoleKey && serviceRoleKey === SUPABASE_SERVICE_KEY) {
      // Service role authentication
      userId = "service-account";
      userRole = "system";
      console.log("[twilio-call] Authenticated via service role key");
    } else {
      return new Response(JSON.stringify({ error: "Missing or invalid authorization" }), {
        status: 401,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // Rate limit check (skip for service accounts)
    // Check if this is an SOS emergency call
    const isSosCall = emergencyId !== undefined;
    if (isSosCall) {
      markSosPriority(userId);
    }

    const rateLimitResult = checkRateLimit(userId, "api", isSosCall);
    if (!rateLimitResult.allowed) {
      const headers: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
        ...getRateLimitHeaders(rateLimitResult),
      };
      return new Response(
        JSON.stringify({
          error: "Rate limited",
          message: isSosCall
            ? "Emergency call rate limit exceeded. SOS priority users get 10x higher limits."
            : "API rate limit exceeded. Max 60 requests per minute.",
          remaining: rateLimitResult.remaining,
          retryAfterMs: rateLimitResult.retryAfterMs,
        }),
        {
          status: 429,
          headers,
        }
      );
    }

    // Parse request body
    const { to, emergencyId, callerName, companyId } = await req.json();
    if (!to || !emergencyId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, emergencyId" }),
        {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // Validate phone number format (E.164)
    const cleanPhone = to.replace(/[^+\d]/g, "");
    if (!/^\+\d{7,15}$/.test(cleanPhone)) {
      return new Response(
        JSON.stringify({
          error: "Invalid phone number format. Use E.164 (e.g., +966501234567)",
        }),
        {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // ── Initiate Twilio call with retry logic ──────────────────
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`;
    const twimlUrl = `${SUPABASE_URL}/functions/v1/twilio-twiml?emergencyId=${emergencyId}&caller=${encodeURIComponent(
      callerName || "SOSphere"
    )}`;

    let twilioResponse: Response;
    let twilioData: Record<string, unknown>;
    let apiResponseTime = 0;
    let retryAttempt = 0;

    try {
      await retryWithBackoff(async () => {
        retryAttempt++;
        const startTime = Date.now();

        twilioResponse = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: cleanPhone,
            From: TWILIO_FROM_NUMBER,
            Url: twimlUrl,
            StatusCallback: `${SUPABASE_URL}/functions/v1/twilio-status`,
            StatusCallbackMethod: "POST",
            StatusCallbackEvent: "initiated ringing answered completed",
            Timeout: "30",
            MachineDetection: "Enable",
          }),
        });

        apiResponseTime = Date.now() - startTime;
        twilioData = (await twilioResponse.json()) as Record<string, unknown>;

        // Check if response indicates transient error (retry) or permanent error (fail)
        if (!twilioResponse.ok) {
          const errorCode = twilioData.code;
          const errorInfo = getTwilioErrorInfo(errorCode);

          if (errorInfo && errorInfo.isTransient && retryAttempt < 2) {
            console.log(
              `[twilio-call] Transient error (${errorCode}): ${errorInfo.message}. Retrying...`
            );
            throw new Error(`Transient error: ${errorInfo.message}`);
          }
          // If permanent error or max retries, break out
          throw new Error(
            `${errorInfo?.message || "Unknown error"}: ${twilioData.message}`
          );
        }
      });
    } catch (err) {
      // Log failure to audit
      const errorMsg =
        err instanceof Error ? err.message : String(err);
      const errorCode = twilioData?.code;
      const errorInfo = getTwilioErrorInfo(errorCode);

      await supabase.from("audit_log").insert({
        id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        action: "twilio_call_failed",
        actor: userId,
        operation: "emergency_call",
        target: cleanPhone,
        created_at: new Date().toISOString(),
        metadata: {
          error: errorMsg,
          errorCode,
          errorDetail: errorInfo?.detail,
          emergencyId,
          companyId,
          attempts: retryAttempt,
          apiResponseTimeMs: apiResponseTime,
        },
      });

      const statusCode =
        twilioResponse!.status >= 500 ? 502 : twilioResponse!.status;
      return new Response(
        JSON.stringify({
          error: "Failed to initiate call",
          detail: errorMsg,
          errorCode,
          retries: retryAttempt - 1,
        }),
        {
          status: statusCode,
          headers: { "Access-Control-Allow-Origin": "*" },
        }
      );
    }

    // Log success to audit with API response time
    await supabase.from("audit_log").insert({
      id: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      action: "twilio_call_initiated",
      actor: userId,
      operation: "emergency_call",
      target: cleanPhone,
      created_at: new Date().toISOString(),
      metadata: {
        callSid: twilioData.sid,
        emergencyId,
        companyId,
        apiResponseTimeMs: apiResponseTime,
        attempts: retryAttempt,
      },
    });

    const rateLimitHeaders = getRateLimitHeaders(rateLimitResult);
    return new Response(
      JSON.stringify({
        success: true,
        callSid: twilioData.sid,
        status: twilioData.status,
        apiResponseTime: apiResponseTime,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          ...rateLimitHeaders,
        },
      }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[twilio-call] Unhandled error:", errorMsg);

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: errorMsg,
      }),
      {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
      }
    );
  }
});
