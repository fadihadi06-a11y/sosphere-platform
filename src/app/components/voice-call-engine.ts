// ═════════════════════════════════════════════════════════════
// SOSphere — Voice Call Engine (Adapter Pattern)
//
// This is the ONLY file that sos-emergency.tsx and
// admin-incoming-call.tsx import. The public API is unchanged.
//
// Internally, it delegates to a VoiceProvider:
//   - LocalWebRTC  → Demo (BroadcastChannel, same computer)
//   - TwilioClient → Production (browser ↔ browser via Twilio)
//   - TwilioVoice  → Production (browser → real phone via PSTN)
//   - Hybrid       → Smart (browser first → phone → escalation)
//
// To switch providers, call:
//   voiceCallEngine.setProvider("hybrid", { supabaseUrl: "...", ... });
//
// By default, uses "hybrid" which auto-detects:
//   - No Supabase config → falls back to LocalWebRTC (demo)
//   - With Supabase config → uses TwilioClient + TwilioVoice
// ═════════════════════════════════════════════════════════════

import type {
  VoiceCallState,
  VoiceCallInfo,
  VoiceProvider,
  ProviderConfig,
  ProviderType,
  ProviderEvents,
} from "./voice-call-types";
import { LocalWebRTCProvider } from "./voice-provider-local";
import { TwilioClientProvider, TwilioVoiceProvider } from "./voice-provider-twilio";
import { HybridProvider } from "./voice-provider-hybrid";

// Re-export types for backward compatibility
export type { VoiceCallState, VoiceCallInfo } from "./voice-call-types";

type StateCallback = (info: VoiceCallInfo) => void;

// ── Active call states (for guards) ─────────────────────────
const ACTIVE_STATES: Set<VoiceCallState> = new Set([
  "requesting-mic", "ringing", "connecting", "connected",
]);

// ═════════════════════════════════════════════════════════════
class VoiceCallEngine {
  // ── Active provider ────────────────────────────────────────
  private provider: VoiceProvider | null = null;
  private providerType: ProviderType = "hybrid";
  private providerConfig: ProviderConfig = {};
  private _initializingProvider = false; // [FIX #14] prevent recursive ensureProvider

  // ── State (owned by Engine, not Provider) ──────────────────
  private listeners: Set<StateCallback> = new Set();
  private _state: VoiceCallState = "idle";
  private _elapsed = 0;
  private _isMuted = false;
  private _audioLevel = 0;
  private _remoteAudioLevel = 0;
  private _error?: string;
  private _maxDuration = 60;
  private _callActive = false; // [FIX #5] guard against double endCall

  // ── Audio analysis ─────────────────────────────────────────
  private audioCtx: AudioContext | null = null;
  private analyserLocal: AnalyserNode | null = null;
  private analyserRemote: AnalyserNode | null = null;
  private localStream: MediaStream | null = null;
  private levelInterval: ReturnType<typeof setInterval> | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private _timerStarted = false; // [FIX #15] prevent double timer start

  // [FIX #16] Eagerly initialize default provider so BroadcastChannel
  // is always open and ready to receive offers before answerCall.
  // Without this, offers sent by employee would be lost because the
  // admin's BroadcastChannel wouldn't exist yet.
  constructor() {
    this._eagerInit();
  }

  private _eagerInit(): void {
    // [PHASE 8] Auto-configure Hybrid with Supabase creds from Vite env.
    // Without these the HybridProvider silently degrades to LocalWebRTC
    // (demo mode) because Twilio edge-function calls throw on empty URL.
    // Pulling from env at construction time keeps sos-emergency.tsx and
    // admin-incoming-call.tsx oblivious to backend wiring.
    const supabaseUrl = (typeof import.meta !== "undefined" &&
      (import.meta as any).env?.VITE_SUPABASE_URL) || "";
    const supabaseAnonKey = (typeof import.meta !== "undefined" &&
      (import.meta as any).env?.VITE_SUPABASE_ANON_KEY) || "";

    const config: ProviderConfig = (supabaseUrl && supabaseAnonKey)
      ? { supabaseUrl, supabaseAnonKey }
      : {};

    this.setProvider("hybrid", config).catch((err) => {
      console.warn("[VoiceCallEngine] Eager init failed (non-fatal):", err);
    });
  }

  /**
   * Refresh the Supabase access token used by Twilio edge-function calls.
   * Call this after login/refresh so PSTN calls authenticate against the
   * server with the signed-in user (used for tier enforcement).
   */
  async refreshAuthToken(accessToken: string | null | undefined): Promise<void> {
    if (!accessToken) return;
    const next: ProviderConfig = {
      ...this.providerConfig,
      supabaseAccessToken: accessToken,
    };
    await this.setProvider(this.providerType, next);
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API (unchanged — sos-emergency.tsx & admin-incoming-call.tsx use these)
  // ══════════════════════════════════════════════════════════

  /**
   * Switch the voice provider.
   * Call this before starting any calls.
   */
  async setProvider(type: ProviderType, config: ProviderConfig = {}): Promise<void> {
    // Dispose old provider
    if (this.provider) {
      this.provider.dispose();
      this.provider = null;
    }

    this.providerType = type;
    this.providerConfig = config;

    // Create new provider
    const provider = this.createProvider(type);
    const events = this.createProviderEvents();

    try {
      await provider.initialize(config, events);
      this.provider = provider;
      console.info(`[VoiceCallEngine] Provider set: ${type} (ready: ${provider.isReady()})`);
    } catch (err: any) {
      console.error(`[VoiceCallEngine] Failed to initialize provider "${type}":`, err);
      // Fallback to local
      if (type !== "local-webrtc") {
        console.warn("[VoiceCallEngine] Falling back to local-webrtc");
        try {
          const fallback = new LocalWebRTCProvider();
          await fallback.initialize({}, events);
          this.provider = fallback;
          this.providerType = "local-webrtc";
        } catch (fallbackErr) {
          // [FIX #14] Even fallback failed — provider stays null
          console.error("[VoiceCallEngine] Fallback provider also failed:", fallbackErr);
          this.provider = null;
        }
      }
    }
  }

  /** Employee initiates call to admin */
  async startCall(callId: string, maxDuration: number = 60): Promise<void> {
    this.reset();
    this._maxDuration = maxDuration;
    this._callActive = true; // [FIX #5]
    this.setState("requesting-mic");

    // Auto-initialize provider if not set
    await this.ensureProvider();

    // [FIX #1] Null safety — ensureProvider could fail
    if (!this.provider) {
      this._error = "Voice provider unavailable. Please try again.";
      this.setState("failed");
      this._callActive = false;
      return;
    }

    // [FIX #5] Guard: user may have called endCall while we were awaiting provider
    if (!this._callActive) return;

    const stream = await this.provider.startCall(callId);

    // [FIX #5] Guard again after async operation
    if (!this._callActive) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      return;
    }

    if (!stream) {
      if (this._state !== "failed") {
        this._error = "Failed to start call";
        this.setState("failed");
      }
      this._callActive = false;
      return;
    }

    this.localStream = stream;
    this.setupAudioAnalysis();
    this.setState("ringing");
  }

  /** Admin answers the incoming call */
  async answerCall(callId: string, maxDuration: number = 60): Promise<void> {
    // [FIX #2] Reset stale state from any previous call
    this.reset();
    this._maxDuration = maxDuration;
    this._callActive = true; // [FIX #5]
    this.setState("requesting-mic");

    // Auto-initialize provider if not set
    await this.ensureProvider();

    // [FIX #1] Null safety
    if (!this.provider) {
      this._error = "Voice provider unavailable. Please try again.";
      this.setState("failed");
      this._callActive = false;
      return;
    }

    // [FIX #5] Guard: user may have called endCall/forceReset during await
    if (!this._callActive) return;

    const stream = await this.provider.answerCall(callId);

    // [FIX #5] Guard again
    if (!this._callActive) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      return;
    }

    if (!stream) {
      if (this._state !== "failed") {
        this._error = "Failed to answer call";
        this.setState("failed");
      }
      this._callActive = false;
      return;
    }

    this.localStream = stream;
    this.setupAudioAnalysis();
    this.setState("connecting");
  }

  /** End the call from either side */
  endCall(): void {
    // [FIX #5] Guard against double endCall
    if (!this._callActive && this._state !== "connected" && this._state !== "ringing" && this._state !== "connecting") {
      // Already ended or idle — just ensure cleanup
      this.provider?.endCall();
      this.cleanup();
      return;
    }

    this._callActive = false;
    this.provider?.endCall();
    this.setState("ended");
    this.cleanup();
  }

  /** Toggle mute */
  toggleMute(): boolean {
    this._isMuted = !this._isMuted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this._isMuted;
      });
    }
    this.notify();
    return this._isMuted;
  }

  /** Set mute state directly */
  setMuted(muted: boolean): void {
    this._isMuted = muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this._isMuted;
      });
    }
    this.notify();
  }

  /** Subscribe to state changes */
  subscribe(cb: StateCallback): () => void {
    this.listeners.add(cb);
    cb(this.getInfo()); // immediate update
    return () => this.listeners.delete(cb);
  }

  /** Get current state */
  getInfo(): VoiceCallInfo {
    return {
      state: this._state,
      elapsed: this._elapsed,
      isMuted: this._isMuted,
      audioLevel: this._audioLevel,
      remoteAudioLevel: this._remoteAudioLevel,
      error: this._error,
      maxDuration: this._maxDuration,
      provider: this.providerType,
    };
  }

  /** Force reset everything */
  forceReset(): void {
    this._callActive = false; // [FIX #5] Mark call as inactive first
    this.provider?.endCall();
    this.cleanup();
    // [FIX #3] Reset ALL state including muted and audio levels
    this._state = "idle";
    this._elapsed = 0;
    this._isMuted = false;
    this._audioLevel = 0;
    this._remoteAudioLevel = 0;
    this._error = undefined;
    this._timerStarted = false;
    this.notify();
  }

  /** Get active provider type */
  getProviderType(): ProviderType {
    return this.providerType;
  }

  /** Get debug info from active provider */
  getDebugInfo(): Record<string, unknown> {
    return {
      engine: {
        state: this._state,
        elapsed: this._elapsed,
        muted: this._isMuted,
        maxDuration: this._maxDuration,
        callActive: this._callActive,
        providerType: this.providerType,
        providerReady: this.provider?.isReady() ?? false,
      },
      provider: this.provider?.getDebugInfo() ?? { status: "not initialized" },
    };
  }

  // ══════════════════════════════════════════════════════════
  // PRIVATE: Provider Management
  // ══════════════════════════════════════════════════════════

  private createProvider(type: ProviderType): VoiceProvider {
    switch (type) {
      case "local-webrtc":
        return new LocalWebRTCProvider();
      case "twilio-client":
        return new TwilioClientProvider();
      case "twilio-voice":
        return new TwilioVoiceProvider();
      case "hybrid":
        return new HybridProvider();
      default:
        console.warn(`[VoiceCallEngine] Unknown provider "${type}", using hybrid`);
        return new HybridProvider();
    }
  }

  private createProviderEvents(): ProviderEvents {
    return {
      onRemoteStream: (stream: MediaStream) => {
        // [FIX #5] Guard: ignore if call already ended
        if (!this._callActive) return;
        this.setupRemoteAnalyser(stream);
      },

      onStateChange: (state, error) => {
        // [FIX #5] Guard: ignore provider events if call already ended
        if (!this._callActive && state !== "disconnected") return;

        switch (state) {
          case "connecting":
            if (ACTIVE_STATES.has(this._state)) {
              this.setState("connecting");
            }
            break;

          case "connected":
            if (this._state !== "connected" && this._callActive) {
              this.setState("connected");
              this.startTimer();
            }
            break;

          case "disconnected":
            // [FIX #4] Handle disconnected in ALL active states, not just "connected"
            if (ACTIVE_STATES.has(this._state)) {
              this._callActive = false;
              this.setState("ended");
              this.cleanup();
            }
            break;

          case "failed":
            this._error = error || "Connection failed";
            this._callActive = false;
            this.setState("failed");
            break;
        }
      },

      onEscalation: (reason, _nextProvider) => {
        console.info(`[VoiceCallEngine] Escalation: ${reason}`);
        // Future: emit event for sos-emergency.tsx to show escalation UI
      },
    };
  }

  // [FIX #14] Prevent recursive/concurrent ensureProvider
  private async ensureProvider(): Promise<void> {
    if (this.provider) return;
    if (this._initializingProvider) return; // Already initializing

    this._initializingProvider = true;
    try {
      await this.setProvider(this.providerType, this.providerConfig);
    } finally {
      this._initializingProvider = false;
    }
  }

  // ══════════════════════════════════════════════════════════
  // PRIVATE: Audio Analysis (level meters)
  // ══════════════════════════════════════════════════════════

  private setupAudioAnalysis(): void {
    if (!this.localStream) return;
    // Clean previous if any (defensive)
    if (this.levelInterval) { clearInterval(this.levelInterval); this.levelInterval = null; }

    try {
      this.audioCtx = new AudioContext();
      const source = this.audioCtx.createMediaStreamSource(this.localStream);
      this.analyserLocal = this.audioCtx.createAnalyser();
      this.analyserLocal.fftSize = 256;
      source.connect(this.analyserLocal);

      this.levelInterval = setInterval(() => {
        if (!this._callActive) { // [FIX #5] Stop polling if call ended
          if (this.levelInterval) { clearInterval(this.levelInterval); this.levelInterval = null; }
          return;
        }
        this._audioLevel = this.getLevel(this.analyserLocal);
        this._remoteAudioLevel = this.getLevel(this.analyserRemote);
        this.notify();
      }, 100);
    } catch {
      // Audio analysis is not critical
    }
  }

  private setupRemoteAnalyser(stream: MediaStream): void {
    if (!this.audioCtx) return;
    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyserRemote = this.audioCtx.createAnalyser();
      this.analyserRemote.fftSize = 256;
      source.connect(this.analyserRemote);
    } catch {
      // Not critical
    }
  }

  private getLevel(analyser: AnalyserNode | null): number {
    if (!analyser) return 0;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 3);
  }

  // ══════════════════════════════════════════════════════════
  // PRIVATE: Timer
  // ══════════════════════════════════════════════════════════

  // [FIX #15] Prevent double timer from duplicate "connected" events (ICE + connection state)
  private startTimer(): void {
    if (this._timerStarted || this.timerInterval) return;
    this._timerStarted = true;
    this._elapsed = 0;
    this.timerInterval = setInterval(() => {
      if (!this._callActive) { // [FIX #5] Stop timer if call ended
        if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
        return;
      }
      this._elapsed += 1;
      this.notify();
      // Auto-end at max duration
      if (this._elapsed >= this._maxDuration) {
        this.endCall();
      }
    }, 1000);
  }

  // ══════════════════════════════════════════════════════════
  // PRIVATE: State & Cleanup
  // ══════════════════════════════════════════════════════════

  private setState(state: VoiceCallState): void {
    if (this._state === state) return; // [FIX #5] Skip duplicate state transitions
    this._state = state;
    this.notify();
  }

  private notify(): void {
    const info = this.getInfo();
    this.listeners.forEach((cb) => {
      try { cb(info); } catch { /* listener error */ }
    });
  }

  private cleanup(): void {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.levelInterval) { clearInterval(this.levelInterval); this.levelInterval = null; }
    this._timerStarted = false; // [FIX #15]
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.analyserLocal = null;
    this.analyserRemote = null;
  }

  private reset(): void {
    this._callActive = false; // [FIX #5] Deactivate before cleanup
    this.cleanup();
    this._state = "idle";
    this._elapsed = 0;
    this._isMuted = false;
    this._audioLevel = 0;
    this._remoteAudioLevel = 0;
    this._error = undefined;
    this._timerStarted = false; // [FIX #15]
  }
}

// ── Singleton export (same as before) ────────────────────────
export const voiceCallEngine = new VoiceCallEngine();