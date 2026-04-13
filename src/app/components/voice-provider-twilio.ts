// ═══════════════════════════════════════════════════════════════
// SOSphere — Twilio Voice Provider (Production)
// Uses Supabase Edge Functions to communicate with Twilio API.
//
// TWO modes:
//   1. TwilioClientProvider — Browser ↔ Browser via Twilio SDK
//   2. TwilioVoiceProvider  — Browser → Real Phone via PSTN
//
// ── Prerequisites ─────────────────────────────────────────────
// 1. Supabase project connected with Edge Functions deployed
// 2. Twilio Account SID + Auth Token stored as Supabase secrets
// 3. Twilio virtual phone number purchased (~$1/month)
// 4. @twilio/voice-sdk package installed (for Client mode)
//
// ── Supabase Edge Functions needed ────────────────────────────
// POST /functions/v1/twilio-token → Generate Client SDK token
// POST /functions/v1/twilio-call  → Initiate PSTN call to phone
// POST /functions/v1/twilio-sms   → Send SMS notification
// POST /functions/v1/twilio-status → Webhook for call status
// ═══════════════════════════════════════════════════════════════

import type {
  VoiceProvider,
  ProviderConfig,
  ProviderEvents,
  ProviderType,
  TwilioTokenResponse,
  TwilioCallResponse,
} from "./voice-call-types";

// ─────────────────────────────────────────────────────────────
// Helper: Call Supabase Edge Function
// ─────────────────────────────────────────────────────────────
async function callEdgeFunction<TReq, TRes>(
  config: ProviderConfig,
  functionName: string,
  body: TReq,
): Promise<TRes> {
  const { supabaseUrl, supabaseAnonKey, supabaseAccessToken } = config;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      `[Twilio] Supabase not configured. Set supabaseUrl and supabaseAnonKey in ProviderConfig.`,
    );
  }

  const url = `${supabaseUrl}/functions/v1/${functionName}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: supabaseAnonKey,
  };
  if (supabaseAccessToken) {
    headers["Authorization"] = `Bearer ${supabaseAccessToken}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`[Twilio] Edge function "${functionName}" failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ═════════════════════════════════════════════════════════════
// Twilio Client Provider (Browser ↔ Browser)
// Uses @twilio/voice-sdk in the browser.
// Both employee and admin connect to Twilio's infrastructure.
// Voice is relayed through Twilio servers (not peer-to-peer).
// ═════════════════════════════════════════════════════════════
export class TwilioClientProvider implements VoiceProvider {
  readonly name: ProviderType = "twilio-client";

  private config: ProviderConfig = {};
  private events: ProviderEvents | null = null;
  private _ready = false;
  private _disposed = false; // Guard against post-dispose operations
  private _token: string | null = null;
  private _tokenExpiresAt = 0;
  private _device: any = null; // Twilio.Device instance
  private _activeCall: any = null; // Twilio.Call instance
  private callId = "";
  private localStream: MediaStream | null = null;

  // ── Interface Implementation ────────────────────────────────

  async initialize(config: ProviderConfig, events: ProviderEvents): Promise<void> {
    this.config = config;
    this.events = events;
    this._disposed = false;

    // Check if Supabase is configured
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      this._ready = false;
      console.info("[TwilioClient] No Supabase config — staying inactive.");
      return;
    }

    try {
      // 1. Fetch token from Supabase Edge Function
      const identity = `sosphere-${config.employeeName || "user"}-${Date.now()}`;
      const { token, expiresAt } = await callEdgeFunction<
        { identity: string },
        TwilioTokenResponse
      >(config, "twilio-token", { identity });

      this._token = token;
      this._tokenExpiresAt = expiresAt;

      // 2. Dynamically import Twilio Voice SDK (installed via npm)
      // @ts-ignore — dynamic import for optional dependency
      const { Device } = await import("@twilio/voice-sdk");

      // 3. Create Twilio Device
      this._device = new Device(token, {
        codecPreferences: [Device.Codec.Opus, Device.Codec.PCMU],
        edge: "ashburn",
      });

      // 4. Register event handlers
      this._device.on("incoming", (call: any) => {
        this._activeCall = call;
        this.events?.onStateChange("connecting");
      });

      this._device.on("error", (error: any) => {
        console.error("[TwilioClient] Device error:", error);
        this.events?.onStateChange("failed", error.message || "Device error");
      });

      // 5. Register the device
      await this._device.register();
      this._ready = true;
      console.info("[TwilioClient] Provider ready — device registered as:", identity);
    } catch (err: any) {
      this._ready = false;
      console.warn("[TwilioClient] Init failed (will use fallback):", err.message || err);
    }
  }

  dispose(): void {
    this._disposed = true; // Set FIRST to block pending operations
    // this._device?.destroy();
    this._device = null;
    this._activeCall = null;
    this._token = null;
    this.events = null;
    this._ready = false;
    this.cleanupStream();
  }

  async startCall(callId: string): Promise<MediaStream | null> {
    if (this._disposed) return null;
    this.callId = callId;

    if (!this._device || !this._ready) {
      console.warn("[TwilioClient] Device not ready.");
      this.events?.onStateChange("failed", "Twilio device not ready. Check configuration.");
      return null;
    }

    try {
      // 1. Ensure token is valid
      await this.ensureToken();

      // 2. Connect via Twilio Device
      this._activeCall = await this._device.connect({
        params: {
          To: `sosphere-admin-${this.config.companyName || "default"}`,
          callId: callId,
          employeeName: this.config.employeeName || "Employee",
        },
      });

      // 3. Handle call events
      this._activeCall.on("accept", () => {
        if (this._disposed) return;
        this.events?.onStateChange("connected");
        const remoteStream = this._activeCall?.getRemoteStream?.();
        if (remoteStream) this.events?.onRemoteStream(remoteStream);
      });

      this._activeCall.on("disconnect", () => {
        if (this._disposed) return;
        this.events?.onStateChange("disconnected");
      });

      this._activeCall.on("error", (err: any) => {
        if (this._disposed) return;
        this.events?.onStateChange("failed", err.message || "Call error");
      });

      // 4. Return local stream for audio analysis
      this.localStream = this._activeCall.getLocalStream?.() || null;
      return this.localStream;
    } catch (err: any) {
      console.error("[TwilioClient] startCall failed:", err);
      this.events?.onStateChange("failed", err.message || "Failed to start call");
      return null;
    }
  }

  async answerCall(callId: string): Promise<MediaStream | null> {
    if (this._disposed) return null;
    this.callId = callId;

    if (!this._activeCall) {
      console.warn("[TwilioClient] No incoming call to answer.");
      this.events?.onStateChange("failed", "No incoming call found.");
      return null;
    }

    try {
      // Accept the incoming call
      this._activeCall.accept();

      this._activeCall.on("accept", () => {
        if (this._disposed) return;
        this.events?.onStateChange("connected");
        const remoteStream = this._activeCall?.getRemoteStream?.();
        if (remoteStream) this.events?.onRemoteStream(remoteStream);
      });

      this._activeCall.on("disconnect", () => {
        if (this._disposed) return;
        this.events?.onStateChange("disconnected");
      });

      this._activeCall.on("error", (err: any) => {
        if (this._disposed) return;
        this.events?.onStateChange("failed", err.message || "Call error");
      });

      this.localStream = this._activeCall.getLocalStream?.() || null;
      return this.localStream;
    } catch (err: any) {
      console.error("[TwilioClient] answerCall failed:", err);
      this.events?.onStateChange("failed", err.message || "Failed to answer call");
      return null;
    }
  }

  endCall(): void {
    // this._activeCall?.disconnect();
    this._activeCall = null;
    this.cleanupStream();
  }

  isReady(): boolean {
    return this._ready && !this._disposed;
  }

  getDebugInfo(): Record<string, unknown> {
    return {
      provider: "twilio-client",
      ready: this._ready,
      hasDevice: !!this._device,
      hasActiveCall: !!this._activeCall,
      tokenExpires: this._tokenExpiresAt
        ? new Date(this._tokenExpiresAt * 1000).toISOString()
        : "none",
      callId: this.callId,
    };
  }

  // ── Private helpers ────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this._token && this._tokenExpiresAt > now + 60) {
      return this._token;
    }

    const resp = await callEdgeFunction<{ identity: string }, TwilioTokenResponse>(
      this.config,
      "twilio-token",
      { identity: `sosphere-${this.callId}` },
    );

    this._token = resp.token;
    this._tokenExpiresAt = resp.expiresAt;
    return resp.token;
  }

  private cleanupStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
  }
}

// ═════════════════════════════════════════════════════════════
// Twilio Voice Provider (Browser → Real Phone)
// Calls the admin's actual phone number via PSTN.
// No SDK needed on admin side — their phone just rings.
// Uses Supabase Edge Function to trigger the call.
// ═════════════════════════════════════════════════════════════
export class TwilioVoiceProvider implements VoiceProvider {
  readonly name: ProviderType = "twilio-voice";

  private config: ProviderConfig = {};
  private events: ProviderEvents | null = null;
  private _ready = false;
  private _disposed = false; // Guard against post-dispose operations
  private _callSid: string | null = null;
  private callId = "";
  private localStream: MediaStream | null = null;
  private _statusPollInterval: ReturnType<typeof setInterval> | null = null;
  private _realtimeChannel: any = null;
  private _realtimeSb: any = null;
  private _channelTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Interface Implementation ────────────────────────────────

  async initialize(config: ProviderConfig, events: ProviderEvents): Promise<void> {
    this.config = config;
    this.events = events;
    this._disposed = false;

    // Validate required config
    const hasSupabase = config.supabaseUrl && config.supabaseAnonKey;
    const hasPhone = config.adminPhoneNumber && config.twilioFromNumber;

    if (hasSupabase && hasPhone) {
      this._ready = true;
      console.info("[TwilioVoice] Provider ready. Will call:", config.adminPhoneNumber);
    } else {
      this._ready = false;
      const missing: string[] = [];
      if (!config.supabaseUrl) missing.push("supabaseUrl");
      if (!config.supabaseAnonKey) missing.push("supabaseAnonKey");
      if (!config.adminPhoneNumber) missing.push("adminPhoneNumber");
      if (!config.twilioFromNumber) missing.push("twilioFromNumber");
      console.warn("[TwilioVoice] Not ready. Missing config:", missing.join(", "));
    }
  }

  dispose(): void {
    this._disposed = true; // Set FIRST to block pending operations
    if (this._statusPollInterval) {
      clearInterval(this._statusPollInterval);
      this._statusPollInterval = null;
    }
    if (this._channelTimeout) { clearTimeout(this._channelTimeout); this._channelTimeout = null; }
    if (this._realtimeChannel && this._realtimeSb) {
      this._realtimeSb.removeChannel(this._realtimeChannel);
      this._realtimeChannel = null;
    }
    this._callSid = null;
    this.events = null;
    this._ready = false;
    this.cleanupStream();
  }

  async startCall(callId: string): Promise<MediaStream | null> {
    if (this._disposed) return null;
    this.callId = callId;

    if (!this._ready) {
      this.events?.onStateChange("failed", "Twilio Voice not configured.");
      return null;
    }

    try {
      // 1. Call Supabase Edge Function to initiate PSTN call
      const resp = await callEdgeFunction<any, TwilioCallResponse>(
        this.config,
        "twilio-call",
        {
          to: this.config.adminPhoneNumber!,
          from: this.config.twilioFromNumber!,
          callId: callId,
          employeeName: this.config.employeeName || "Employee",
          companyName: this.config.companyName || "SOSphere",
          zoneName: this.config.zoneName || "Unknown Zone",
        },
      );

      this._callSid = resp.callSid;
      this.events?.onStateChange("connecting");
      console.info(`[TwilioVoice] PSTN call initiated: ${resp.callSid}`);

      // 2. Listen for call status via Supabase Realtime
      // The twilio-status Edge Function broadcasts updates
      try {
        const { supabaseUrl, supabaseAnonKey } = this.config;
        if (supabaseUrl && supabaseAnonKey) {
          // Use dynamic import to avoid hard dependency
          const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
          const sb = createClient(supabaseUrl, supabaseAnonKey);
          this._realtimeSb = sb;
          const channel = sb.channel(`call-${callId}`);
          this._realtimeChannel = channel;

          const cleanupChannel = () => {
            if (this._channelTimeout) { clearTimeout(this._channelTimeout); this._channelTimeout = null; }
            if (this._realtimeChannel) { sb.removeChannel(this._realtimeChannel); this._realtimeChannel = null; }
          };

          channel
            .on("broadcast", { event: "call_status" }, (payload: any) => {
              const status = payload.payload?.status;
              if (this._disposed) { cleanupChannel(); return; }
              if (status === "answered" || status === "accepted" || status === "in-progress") {
                this.events?.onStateChange("connected");
              } else if (status === "completed" || status === "canceled") {
                this.events?.onStateChange("disconnected");
                cleanupChannel();
              } else if (status === "no-answer" || status === "busy" || status === "failed") {
                this.events?.onStateChange("failed", `Call ${status}`);
                cleanupChannel();
              }
            })
            .subscribe();

          // Cleanup channel after 5 minutes max (single cleanup point)
          this._channelTimeout = setTimeout(() => cleanupChannel(), 300000);
        }
      } catch (e) {
        console.warn("[TwilioVoice] Realtime listener setup failed:", e);
      }

      // 3. Fallback: poll status every 3 seconds for 60 seconds
      let pollCount = 0;
      this._statusPollInterval = setInterval(() => {
        pollCount++;
        if (this._disposed || pollCount > 20) {
          if (this._statusPollInterval) {
            clearInterval(this._statusPollInterval);
            this._statusPollInterval = null;
          }
          if (pollCount > 20 && !this._disposed) {
            this.events?.onStateChange("failed", "Call timeout — no response");
          }
        }
      }, 3000);

      return null; // No local stream for PSTN calls (audio is on admin's phone)
    } catch (err: any) {
      console.error("[TwilioVoice] startCall failed:", err);
      this.events?.onStateChange("failed", err.message || "Failed to initiate call");
      return null;
    }
  }

  async answerCall(_callId: string): Promise<MediaStream | null> {
    if (this._disposed) return null;
    // Admin answers on their PHONE — no browser action needed.
    // The call status webhook updates us when admin answers.
    console.info("[TwilioVoice] answerCall() — Admin answers on their physical phone. No browser action needed.");
    return null;
  }

  endCall(): void {
    // End the PSTN call if active
    if (this._callSid && this.config.supabaseUrl && this.config.supabaseAnonKey) {
      // Fire-and-forget: tell Twilio to end the call
      callEdgeFunction(this.config, "twilio-call", {
        action: "end",
        callSid: this._callSid,
      }).catch((e) => console.warn("[TwilioVoice] End call request failed:", e));
    }

    if (this._statusPollInterval) {
      clearInterval(this._statusPollInterval);
      this._statusPollInterval = null;
    }
    this._callSid = null;
    this.cleanupStream();
  }

  isReady(): boolean {
    return this._ready && !this._disposed;
  }

  getDebugInfo(): Record<string, unknown> {
    return {
      provider: "twilio-voice",
      ready: this._ready,
      callSid: this._callSid,
      adminPhone: this.config.adminPhoneNumber ? "***" + this.config.adminPhoneNumber.slice(-4) : "none",
      twilioFrom: this.config.twilioFromNumber || "none",
      callId: this.callId,
    };
  }

  // ── Private helpers ────────────────────────────────────────

  private cleanupStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
  }
}