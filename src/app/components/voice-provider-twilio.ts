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

    // ────────────────────────────────────────────────────────
    // TODO: When ready to connect Twilio:
    //
    // 1. Install Twilio SDK:
    //    npm install @twilio/voice-sdk
    //
    // 2. Import it:
    //    import { Device } from "@twilio/voice-sdk";
    //
    // 3. Fetch token from Supabase Edge Function:
    //    const { token } = await callEdgeFunction<...>(
    //      config, "twilio-token", { identity: "admin-123" }
    //    );
    //
    // 4. Create Twilio Device:
    //    this._device = new Device(token, {
    //      codecPreferences: [Device.Codec.Opus, Device.Codec.PCMU],
    //      edge: "ashburn",
    //    });
    //
    // 5. Register event handlers:
    //    this._device.on("incoming", (call) => { ... });
    //    this._device.on("error", (error) => { ... });
    //
    // 6. Register the device:
    //    await this._device.register();
    // ────────────────────────────────────────────────────────

    this._ready = false; // Will be true after Twilio Device is registered
    console.info("[TwilioClient] Provider initialized (stub). Connect Supabase + install @twilio/voice-sdk to activate.");
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

    // ────────────────────────────────────────────────────────
    // TODO: Implement employee-side call initiation:
    //
    // 1. Ensure token is valid (refresh if expired):
    //    await this.ensureToken();
    //
    // 2. Connect via Twilio Device:
    //    this._activeCall = await this._device.connect({
    //      params: {
    //        To: "admin-identity",  // or a Twilio Client identity
    //        callId: callId,
    //        employeeName: this.config.employeeName,
    //      },
    //    });
    //
    // 3. Handle call events:
    //    this._activeCall.on("accept", () => {
    //      this.events?.onStateChange("connected");
    //      // Get remote audio stream for analysis
    //      const remoteStream = this._activeCall.getRemoteStream();
    //      if (remoteStream) this.events?.onRemoteStream(remoteStream);
    //    });
    //
    //    this._activeCall.on("disconnect", () => {
    //      this.events?.onStateChange("disconnected");
    //    });
    //
    //    this._activeCall.on("error", (err) => {
    //      this.events?.onStateChange("failed", err.message);
    //    });
    //
    // 4. Return local stream for audio analysis:
    //    this.localStream = this._activeCall.getLocalStream();
    //    return this.localStream;
    // ────────────────────────────────────────────────────────

    console.warn("[TwilioClient] startCall() is a stub. Connect Supabase to activate.");
    this.events?.onStateChange("failed", "Twilio not configured. Connect Supabase first.");
    return null;
  }

  async answerCall(callId: string): Promise<MediaStream | null> {
    if (this._disposed) return null;
    this.callId = callId;

    // ────────────────────────────────────────────────────────
    // TODO: Implement admin-side call answering:
    //
    // Incoming calls arrive via this._device.on("incoming"):
    //
    // this._device.on("incoming", (call) => {
    //   this._activeCall = call;
    //   // Store it, show UI notification
    // });
    //
    // When admin clicks "Answer":
    //   this._activeCall.accept();
    //
    //   this._activeCall.on("accept", () => {
    //     this.events?.onStateChange("connected");
    //     const remoteStream = this._activeCall.getRemoteStream();
    //     if (remoteStream) this.events?.onRemoteStream(remoteStream);
    //   });
    //
    //   this.localStream = this._activeCall.getLocalStream();
    //   return this.localStream;
    // ────────────────────────────────────────────────────────

    console.warn("[TwilioClient] answerCall() is a stub. Connect Supabase to activate.");
    this.events?.onStateChange("failed", "Twilio not configured. Connect Supabase first.");
    return null;
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

    // ────────────────────────────────────────────────────────
    // TODO: Implement PSTN call to admin's phone:
    //
    // 1. Call Supabase Edge Function to initiate the call:
    //    const resp = await callEdgeFunction<TwilioCallRequest, TwilioCallResponse>(
    //      this.config,
    //      "twilio-call",
    //      {
    //        to: this.config.adminPhoneNumber!,
    //        from: this.config.twilioFromNumber!,
    //        callId: callId,
    //        employeeName: this.config.employeeName || "Employee",
    //        companyName: this.config.companyName || "SOSphere",
    //        zoneName: this.config.zoneName || "Unknown Zone",
    //        callbackUrl: `${this.config.supabaseUrl}/functions/v1/twilio-status`,
    //      },
    //    );
    //
    //    this._callSid = resp.callSid;
    //
    // 2. Poll for call status updates (or use Supabase Realtime):
    //    this._statusPollInterval = setInterval(async () => {
    //      const status = await this.checkCallStatus();
    //      if (status === "in-progress") {
    //        this.events?.onStateChange("connected");
    //        clearInterval(this._statusPollInterval!);
    //      } else if (status === "completed" || status === "failed") {
    //        this.events?.onStateChange("disconnected");
    //        clearInterval(this._statusPollInterval!);
    //      }
    //    }, 2000);
    //
    // 3. For employee's audio:
    //    Use Twilio Client SDK on employee side to connect
    //    to the same call (conference bridge).
    //    OR use WebRTC + Twilio's TURN servers.
    //
    // 4. The Edge Function's TwiML should:
    //    <Response>
    //      <Say>Emergency SOS from {employeeName} in {zoneName}.</Say>
    //      <Say>Press 1 to accept.</Say>
    //      <Gather numDigits="1" action="/functions/v1/twilio-gather">
    //        <Play loop="3">{ringTone}</Play>
    //      </Gather>
    //      <Say>No response. Escalating to next contact.</Say>
    //    </Response>
    // ────────────────────────────────────────────────────────

    console.warn("[TwilioVoice] startCall() is a stub. Deploy Supabase Edge Functions to activate.");
    this.events?.onStateChange("failed", "Twilio Voice not deployed. Deploy Edge Functions first.");
    return null;
  }

  async answerCall(_callId: string): Promise<MediaStream | null> {
    if (this._disposed) return null;
    // Admin answers on their PHONE — no browser action needed.
    // The call status webhook updates us when admin answers.
    console.info("[TwilioVoice] answerCall() — Admin answers on their physical phone. No browser action needed.");
    return null;
  }

  endCall(): void {
    // ────────────────────────────────────────────────────────
    // TODO: End the PSTN call:
    //
    // if (this._callSid) {
    //   await callEdgeFunction(this.config, "twilio-call-end", {
    //     callSid: this._callSid,
    //   });
    // }
    // ────────────────────────────────────────────────────────

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