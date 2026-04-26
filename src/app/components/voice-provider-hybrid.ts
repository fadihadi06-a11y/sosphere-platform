// ═══════════════════════════════════════════════════════════════
// SOSphere — Hybrid Voice Provider (Smart Escalation)
//
// The intelligent orchestrator:
// 1. Try browser call first (TwilioClient — cheap & fast)
// 2. No answer? → Call admin's real phone (TwilioVoice — reliable)
// 3. Still no answer? → Escalate to next admin / emergency contacts
//
// In demo mode (no Twilio): falls back to LocalWebRTC.
// ═══════════════════════════════════════════════════════════════

import type {
  VoiceProvider,
  ProviderConfig,
  ProviderEvents,
  ProviderType,
} from "./voice-call-types";
import { LocalWebRTCProvider } from "./voice-provider-local";
import { DisposeGuard } from "./utils/lifecycle-guards";
import { TwilioClientProvider, TwilioVoiceProvider } from "./voice-provider-twilio";

// ── Escalation Stage ─────────────────────────────────────────
type EscalationStage =
  | "browser"        // Stage 1: Try browser call (TwilioClient or LocalWebRTC)
  | "phone"          // Stage 2: Call admin's real phone (TwilioVoice)
  | "backup-admin"   // Stage 3: Call backup admin
  | "contacts"       // Stage 4: Emergency Ripple (employee's contacts)
  | "exhausted";     // All options tried

interface EscalationState {
  stage: EscalationStage;
  attempt: number;
  startedAt: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

// ═════════════════════════════════════════════════════════════
export class HybridProvider implements VoiceProvider {
  readonly name: ProviderType = "hybrid";

  private config: ProviderConfig = {};
  private events: ProviderEvents | null = null;
  private _ready = false;
  private callId = "";
  private _callActive = false;  // [FIX #10] Guard against post-endCall escalation
  private _disposed = false;     // [FIX #10] Guard against post-dispose operations
  // ──────────────────────────────────────────────────────────────
  // B-03 (2026-04-25): a synchronous abort signal so dispose() not
  // only sets a flag but actively cancels in-flight fetches, Realtime
  // subscriptions, and any awaited timer. Combined with the existing
  // _disposed flag (kept for back-compat with the many `if (this._disposed) return`
  // sites), this guarantees no post-dispose status events.
  // ──────────────────────────────────────────────────────────────
  private _disposeGuard = new DisposeGuard();
  private _wasConnected = false; // [FIX #19] Track if call was ever connected (to distinguish hangup from failure)

  // Available providers (ordered by priority)
  private browserProvider: VoiceProvider | null = null;
  private phoneProvider: VoiceProvider | null = null;
  private activeProvider: VoiceProvider | null = null;

  // Escalation state
  private escalation: EscalationState = {
    stage: "browser",
    attempt: 0,
    startedAt: 0,
    timeoutId: null,
  };

  // Timing defaults
  private browserTimeoutMs = 10_000;  // 10 seconds before escalating to phone
  private phoneTimeoutMs = 30_000;    // 30 seconds before escalating to backup

  // ── Interface Implementation ────────────────────────────────

  async initialize(config: ProviderConfig, events: ProviderEvents): Promise<void> {
    this.config = config;
    this.events = events;
    this._disposed = false;
    this._callActive = false;
    this.browserTimeoutMs = config.browserTimeoutMs ?? 10_000;
    this.phoneTimeoutMs = config.phoneTimeoutMs ?? 30_000;

    // Determine which providers are available
    const hasTwilio = !!(config.supabaseUrl && config.supabaseAnonKey);
    const hasPhone = !!(config.adminPhoneNumber && config.twilioFromNumber);

    // ── Browser Provider ──────────────────────────────────
    if (hasTwilio) {
      this.browserProvider = new TwilioClientProvider();
      await this.browserProvider.initialize(config, this.createProviderEvents("browser"));
      console.info("[Hybrid] Browser provider: TwilioClient");
    } else {
      this.browserProvider = new LocalWebRTCProvider();
      await this.browserProvider.initialize(config, this.createProviderEvents("browser"));
      console.info("[Hybrid] Browser provider: LocalWebRTC (demo mode)");
    }

    // ── Phone Provider ────────────────────────────────────
    if (hasTwilio && hasPhone) {
      this.phoneProvider = new TwilioVoiceProvider();
      await this.phoneProvider.initialize(config, this.createProviderEvents("phone"));
      console.info("[Hybrid] Phone provider: TwilioVoice →", config.adminPhoneNumber?.slice(-4));
    } else {
      this.phoneProvider = null;
      console.info("[Hybrid] Phone provider: none (no Twilio config)");
    }

    this._ready = this.browserProvider?.isReady() || false;
    console.info(`[Hybrid] Ready: ${this._ready} | Browser: ${this.browserProvider?.name} | Phone: ${this.phoneProvider?.name ?? "none"}`);
  }

  dispose(): void {
    // B-03 (2026-04-25): abort first — any awaited fetch / Realtime
    // subscription resumes synchronously and bails out at its next
    // signal.aborted check. Then the legacy _disposed flag handles
    // call sites that haven't been ported to the signal-checking
    // pattern yet.
    this._disposeGuard.dispose();
    this._disposed = true;  // [FIX #10] Set FIRST to block pending operations
    this._callActive = false;
    this.clearEscalationTimeout();
    this.browserProvider?.dispose();
    this.phoneProvider?.dispose();
    this.browserProvider = null;
    this.phoneProvider = null;
    this.activeProvider = null;
    this.events = null;
    this._ready = false;
  }

  async startCall(callId: string): Promise<MediaStream | null> {
    this.callId = callId;
    this._callActive = true;  // [FIX #10]
    this._wasConnected = false; // [FIX #19]
    // B-03: fresh AbortSignal for this call lifecycle. Any leftover
    // signal from a previous call is aborted by begin().
    this._disposeGuard.begin();
    this.resetEscalation();

    // Stage 1: Try browser call
    this.escalation.stage = "browser";
    this.escalation.startedAt = Date.now();
    this.activeProvider = this.browserProvider;

    if (!this.activeProvider?.isReady()) {
      return this.escalateToPhone();
    }

    const stream = await this.activeProvider.startCall(callId);

    // [FIX #10] Guard: call may have ended while awaiting
    if (!this._callActive || this._disposed) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      return null;
    }

    if (!stream) {
      return this.escalateToPhone();
    }

    // Start escalation timer: if no connection in browserTimeoutMs → escalate
    this.startEscalationTimer("browser");

    return stream;
  }

  async answerCall(callId: string): Promise<MediaStream | null> {
    this.callId = callId;
    this._callActive = true; // [FIX #10]
    this._wasConnected = false; // [FIX #19]

    // Admin answering — use whatever provider received the call
    if (this.activeProvider) {
      this.clearEscalationTimeout();
      return this.activeProvider.answerCall(callId);
    }

    // Fallback to browser provider
    if (this.browserProvider?.isReady()) {
      this.activeProvider = this.browserProvider;
      return this.browserProvider.answerCall(callId);
    }

    this.events?.onStateChange("failed", "No provider available to answer call");
    return null;
  }

  endCall(): void {
    this._callActive = false; // [FIX #10] Set FIRST to block pending escalation
    this.clearEscalationTimeout();
    this.activeProvider?.endCall();
    this.activeProvider = null;
    this.resetEscalation();
  }

  isReady(): boolean {
    return this._ready && !this._disposed;
  }

  getDebugInfo(): Record<string, unknown> {
    return {
      provider: "hybrid",
      ready: this._ready,
      disposed: this._disposed,
      callActive: this._callActive,
      escalationStage: this.escalation.stage,
      escalationAttempt: this.escalation.attempt,
      activeProvider: this.activeProvider?.name ?? "none",
      browserProvider: this.browserProvider?.name ?? "none",
      browserProviderReady: this.browserProvider?.isReady() ?? false,
      phoneProvider: this.phoneProvider?.name ?? "none",
      phoneProviderReady: this.phoneProvider?.isReady() ?? false,
      browserTimeoutMs: this.browserTimeoutMs,
      phoneTimeoutMs: this.phoneTimeoutMs,
      callId: this.callId,
    };
  }

  // ── Escalation Logic ───────────────────────────────────────

  private startEscalationTimer(stage: "browser" | "phone"): void {
    this.clearEscalationTimeout();

    const timeout = stage === "browser" ? this.browserTimeoutMs : this.phoneTimeoutMs;

    this.escalation.timeoutId = setTimeout(() => {
      // [FIX #10] Guard: don't escalate if call already ended
      if (!this._callActive || this._disposed) return;

      if (stage === "browser") {
        // [FIX #9] Wrap async escalation in error handler
        this.escalateToPhone().catch((err) => {
          console.error("[Hybrid] Escalation to phone failed:", err);
          this.events?.onStateChange("failed", "Escalation failed: " + (err?.message || "Unknown error"));
        });
      } else if (stage === "phone") {
        this.escalateToBackup();
      }
    }, timeout);
  }

  private async escalateToPhone(): Promise<MediaStream | null> {
    // [FIX #10] Guard: don't escalate if call already ended
    if (!this._callActive || this._disposed) {
      return null;
    }

    // [FIX #22] DON'T end the browser call if there's no phone provider!
    // In demo mode (no Twilio), killing the browser WebRTC connection would
    // make it impossible for the admin to answer after the escalation timeout.
    // Only end browser call when we ACTUALLY have a working phone fallback.
    if (!this.phoneProvider?.isReady()) {
      console.info("[Hybrid] No phone provider available — keeping browser call alive (demo mode).");
      this.events?.onEscalation?.("No phone provider available — browser call continues", "twilio-voice");
      // Don't end browser call, don't start phone timeout — just let the browser call continue
      return null;
    }

    // We have a phone provider — safe to end browser call and switch
    if (this.activeProvider === this.browserProvider) {
      this.browserProvider?.endCall();
    }

    // [FIX #10] Re-check after ending browser call
    if (!this._callActive || this._disposed) return null;

    console.info("[Hybrid] Escalating: browser → phone");
    this.escalation.stage = "phone";
    this.escalation.attempt += 1;
    this.activeProvider = this.phoneProvider;
    this.events?.onEscalation?.("No browser answer. Calling admin's phone...", "twilio-voice");

    const stream = await this.phoneProvider.startCall(this.callId);

    // [FIX #10] Guard after async
    if (!this._callActive || this._disposed) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      return null;
    }

    // Start phone timeout
    this.startEscalationTimer("phone");

    return stream;
  }

  private escalateToBackup(): void {
    // [FIX #10] Guard
    if (!this._callActive || this._disposed) return;

    console.info("[Hybrid] Escalating: phone → backup admin / contacts");
    this.escalation.stage = "backup-admin";
    this.escalation.attempt += 1;

    // End phone call
    this.phoneProvider?.endCall();

    // Notify the engine — it should trigger Emergency Ripple
    this.events?.onEscalation?.(
      "Admin unreachable. Escalating to backup contacts...",
      "hybrid",
    );
  }

  // ── Provider Event Wrappers ────────────────────────────────

  private createProviderEvents(stage: "browser" | "phone"): ProviderEvents {
    return {
      onRemoteStream: (stream) => {
        // [FIX #10] Guard
        if (!this._callActive || this._disposed) return;
        // Connection established — cancel escalation timer
        this.clearEscalationTimeout();
        this.events?.onRemoteStream(stream);
      },

      onStateChange: (state, error) => {
        // [FIX #10] Guard
        if (this._disposed) return;
        // Allow "disconnected" through even if !_callActive (for cleanup)
        if (!this._callActive && state !== "disconnected") return;

        if (state === "connected") {
          // Connected! Cancel escalation timer.
          this._wasConnected = true; // [FIX #19]
          this.clearEscalationTimeout();
          this.events?.onStateChange("connected");

        } else if (state === "failed" && stage === "browser" && this._callActive) {
          // [FIX #11] Browser call failed — escalate to phone
          this.escalateToPhone().catch((err) => {
            console.error("[Hybrid] Escalation to phone failed:", err);
            this.events?.onStateChange("failed", "Escalation failed");
          });

        } else if (state === "disconnected" && stage === "browser" && this._callActive) {
          // [FIX #19] Only escalate if call was NEVER connected.
          // If it WAS connected and now disconnected, that's a normal hangup — pass through.
          if (this._wasConnected) {
            // Normal call end (remote hung up after being connected)
            this.events?.onStateChange("disconnected", error);
          } else {
            // [FIX #11] Never reached connected — escalate to phone
            this.escalateToPhone().catch((err) => {
              console.error("[Hybrid] Escalation after browser disconnect failed:", err);
              this.events?.onStateChange("disconnected", "Connection lost");
            });
          }

        } else if (state === "failed" && stage === "phone" && this._callActive) {
          // Phone call failed — escalate to backup
          this.escalateToBackup();

        } else if (state === "disconnected" && stage === "phone" && this._callActive) {
          // [FIX #19] Same logic: only escalate if never connected
          if (this._wasConnected) {
            this.events?.onStateChange("disconnected", error);
          } else {
            this.escalateToBackup();
          }

        } else {
          this.events?.onStateChange(state, error);
        }
      },

      onEscalation: (reason, next) => {
        if (this._disposed) return;
        this.events?.onEscalation?.(reason, next);
      },
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private clearEscalationTimeout(): void {
    if (this.escalation.timeoutId) {
      clearTimeout(this.escalation.timeoutId);
      this.escalation.timeoutId = null;
    }
  }

  private resetEscalation(): void {
    this.clearEscalationTimeout();
    this.escalation = {
      stage: "browser",
      attempt: 0,
      startedAt: 0,
      timeoutId: null,
    };
  }
}