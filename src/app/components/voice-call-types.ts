// ═══════════════════════════════════════════════════════════════
// SOSphere — Voice Call Types & Provider Interface
// Shared types for all voice providers (Local, Twilio, Hybrid)
// ═══════════════════════════════════════════════════════════════

// ── Call States ──────────────────────────────────────────────
export type VoiceCallState =
  | "idle"
  | "requesting-mic"   // Asking for microphone permission
  | "ringing"          // Waiting for other party to answer
  | "connecting"       // Establishing connection
  | "connected"        // Voice active
  | "ended"            // Call ended normally
  | "failed";          // Error occurred

// ── Call Info (exposed to UI) ────────────────────────────────
export interface VoiceCallInfo {
  state: VoiceCallState;
  elapsed: number;         // Seconds since connected
  isMuted: boolean;
  audioLevel: number;      // 0-1 local mic level
  remoteAudioLevel: number;// 0-1 remote speaker level
  error?: string;
  maxDuration: number;     // seconds (30 free, 60 paid)
  provider: ProviderType;  // Which provider is active
}

// ── Provider Types ───────────────────────────────────────────
export type ProviderType =
  | "local-webrtc"     // BroadcastChannel + WebRTC (demo/prototype)
  | "twilio-client"    // Twilio Client SDK (browser ↔ browser)
  | "twilio-voice"     // Twilio Voice API (browser → real phone)
  | "hybrid";          // Smart: browser first → phone fallback

// ── Provider Configuration ───────────────────────────────────
export interface ProviderConfig {
  // ── Local WebRTC (no config needed, uses BroadcastChannel) ──

  // ── Twilio (populated from Supabase secrets) ───────────────
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseAccessToken?: string;  // User's auth token

  // ── Hybrid escalation timing ───────────────────────────────
  browserTimeoutMs?: number;  // Wait before escalating to phone (default: 10000)
  phoneTimeoutMs?: number;    // Wait before next escalation (default: 30000)

  // ── Admin phone number (for Twilio Voice) ──────────────────
  adminPhoneNumber?: string;  // E.164 format: +966501234567
  twilioFromNumber?: string;  // Twilio virtual number: +15551234567

  // ── Company context (for Twilio Voice greeting) ────────────
  companyName?: string;
  employeeName?: string;
  zoneName?: string;
}

// ── Provider Events ──────────────────────────────────────────
export interface ProviderEvents {
  onRemoteStream: (stream: MediaStream) => void;
  onStateChange: (state: "connecting" | "connected" | "disconnected" | "failed", error?: string) => void;
  onEscalation?: (reason: string, nextProvider: ProviderType) => void;
}

// ── Voice Provider Interface ─────────────────────────────────
// Every provider MUST implement this interface.
// The VoiceCallEngine delegates all transport logic here.
// Timer, Audio Analysis, Mute, State Machine stay in the Engine.
export interface VoiceProvider {
  readonly name: ProviderType;

  /**
   * Initialize the provider with config.
   * Called once when the provider is selected.
   * For Twilio: fetches token from Supabase Edge Function.
   * For Local: creates BroadcastChannel.
   */
  initialize(config: ProviderConfig, events: ProviderEvents): Promise<void>;

  /**
   * Clean up all resources.
   * Called when switching providers or shutting down.
   */
  dispose(): void;

  /**
   * Employee initiates a call.
   * Returns the local MediaStream (for audio analysis).
   * The provider handles signaling + connection internally.
   */
  startCall(callId: string): Promise<MediaStream | null>;

  /**
   * Admin answers an incoming call.
   * Returns the local MediaStream (for audio analysis).
   */
  answerCall(callId: string): Promise<MediaStream | null>;

  /**
   * End the active call from either side.
   */
  endCall(): void;

  /**
   * Check if the provider is ready to make/receive calls.
   * For Twilio: checks if token is valid.
   * For Local: always true.
   */
  isReady(): boolean;

  /**
   * Get provider-specific status info for debugging.
   */
  getDebugInfo(): Record<string, unknown>;
}

// ── Supabase Edge Function Request/Response types ────────────
// These define the contract with the Supabase Edge Function
// that manages Twilio. When you create the Edge Function,
// use these types as the API contract.

export interface TwilioTokenRequest {
  identity: string;    // Unique user identifier (e.g., "admin-123" or "employee-456")
  roomName?: string;   // Optional: for Twilio Video (not needed for Voice)
}

export interface TwilioTokenResponse {
  token: string;       // Twilio Access Token (JWT)
  identity: string;
  expiresAt: number;   // Unix timestamp
}

export interface TwilioCallRequest {
  to: string;          // Phone number to call (E.164): +966501234567
  from: string;        // Twilio number (E.164): +15551234567
  callId: string;      // SOSphere call ID for tracking
  employeeName: string;
  companyName: string;
  zoneName: string;
  callbackUrl: string; // Webhook for call status updates
}

export interface TwilioCallResponse {
  callSid: string;     // Twilio Call SID
  status: "queued" | "ringing" | "in-progress" | "completed" | "failed";
}

export interface TwilioSMSRequest {
  to: string;          // Phone number (E.164)
  from: string;        // Twilio number (E.164)
  body: string;        // SMS text
}

// ── Supabase Edge Function Endpoints (reference) ─────────────
// These are the Edge Functions you'll create in Supabase:
//
// 1. POST /functions/v1/twilio-token
//    Body: TwilioTokenRequest
//    Returns: TwilioTokenResponse
//    Purpose: Generate Twilio Client SDK token for browser calls
//
// 2. POST /functions/v1/twilio-call
//    Body: TwilioCallRequest
//    Returns: TwilioCallResponse
//    Purpose: Initiate call to admin's real phone number
//
// 3. POST /functions/v1/twilio-sms
//    Body: TwilioSMSRequest
//    Returns: { success: boolean }
//    Purpose: Send SMS notification (missed SOS, etc.)
//
// 4. POST /functions/v1/twilio-status (webhook)
//    Body: Twilio webhook payload
//    Purpose: Receive call status updates (answered, busy, no-answer)
//
// ═══════════════════════════════════════════════════════════════
