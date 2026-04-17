// ═══════════════════════════════════════════════════════════════
// SOSphere — Local WebRTC Voice Provider (Demo/Prototype)
// Uses BroadcastChannel for signaling between browser tabs.
// Works ONLY on the same computer, same origin.
// Production: Replace with TwilioProvider or HybridProvider.
// ═══════════════════════════════════════════════════════════════

import type { VoiceProvider, ProviderConfig, ProviderEvents, ProviderType } from "./voice-call-types";

// ── Signaling message format ─────────────────────────────────
interface SignalMessage {
  type: "offer" | "answer" | "ice-candidate" | "hangup" | "mic-status";
  from: "employee" | "admin";
  callId: string;
  data?: any;
}

// ── STUN servers (free, public) ──────────────────────────────
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// ═════════════════════════════════════════════════════════════
export class LocalWebRTCProvider implements VoiceProvider {
  readonly name: ProviderType = "local-webrtc";

  private channel: BroadcastChannel | null = null;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private events: ProviderEvents | null = null;
  private role: "employee" | "admin" = "employee";
  private callId = "";
  private _ready = false;
  private _disposed = false;   // [FIX #8] Guard against stale signal processing
  private _callEnded = false;  // [FIX #8] Guard against events after endCall

  // Buffered signaling data (admin may receive offer before answering)
  private _pendingOffer: RTCSessionDescriptionInit | null = null;
  private _pendingCallId = "";
  private _pendingCandidates: RTCIceCandidateInit[] = [];

  // ── VoiceProvider Interface ─────────────────────────────────

  async initialize(_config: ProviderConfig, events: ProviderEvents): Promise<void> {
    this.events = events;
    this._disposed = false;
    this._callEnded = false;
    this.channel = new BroadcastChannel("sosphere_voice_call");
    this.channel.onmessage = (ev) => {
      // [FIX #8] Don't process signals if disposed
      if (this._disposed) return;
      this.handleSignal(ev.data);
    };
    this._ready = true;
  }

  dispose(): void {
    this._disposed = true; // [FIX #8] Set BEFORE cleanup to block pending handlers
    this._callEnded = true;
    this.cleanupConnection();
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.events = null;
    this._ready = false;
  }

  async startCall(callId: string): Promise<MediaStream | null> {
    // [FIX #7] Clean any previous call state
    this.cleanupConnection();
    this.callId = callId;
    this.role = "employee";
    this._callEnded = false;
    this._pendingCallId = "";
    this._pendingOffer = null;
    this._pendingCandidates = [];

    // Get microphone
    const stream = await this.acquireMicrophone();
    if (!stream) return null;

    this.localStream = stream;
    this.createPeerConnection();

    // Add local tracks to peer connection
    stream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, stream);
    });

    // Create and send offer
    try {
      const offer = await this.pc!.createOffer();
      await this.pc!.setLocalDescription(offer);
      this.sendSignal({
        type: "offer",
        from: "employee",
        callId: this.callId,
        data: offer,
      });
      return stream;
    } catch (err: any) {
      this.events?.onStateChange("failed", "Failed to create call offer");
      this.cleanupConnection();
      return null;
    }
  }

  async answerCall(callId: string): Promise<MediaStream | null> {
    // [FIX #17] Save pending signaling data BEFORE cleanup
    // The offer may have arrived via BroadcastChannel before answerCall was called.
    // cleanupConnection() would wipe it, so we preserve it.
    const savedOffer = this._pendingOffer;
    const savedPendingCallId = this._pendingCallId;
    const savedCandidates = [...this._pendingCandidates];

    // [FIX #7] Clean any previous connection state
    this.cleanupConnection();

    this.callId = callId;
    this.role = "admin";
    this._callEnded = false;

    // [FIX #17] Restore pending signaling data
    this._pendingOffer = savedOffer;
    this._pendingCallId = savedPendingCallId;
    this._pendingCandidates = savedCandidates;

    // Get microphone
    const stream = await this.acquireMicrophone();
    if (!stream) return null;

    this.localStream = stream;
    this.createPeerConnection();

    // Add local tracks
    stream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, stream);
    });

    // Process pending offer if it arrived before admin clicked Answer
    if (this._pendingOffer) {
      // Use pending callId if available, fallback to provided callId
      if (this._pendingCallId) this.callId = this._pendingCallId;
      await this.processOffer(this._pendingOffer);
      this._pendingOffer = null; // Clear after processing
    } else {
      this.events?.onStateChange("connecting");
    }

    return stream;
  }

  endCall(): void {
    // [FIX #8] Mark as ended to prevent stale event processing
    this._callEnded = true;

    if (this.channel && this.callId) {
      this.sendSignal({
        type: "hangup",
        from: this.role,
        callId: this.callId,
      });
    }
    this.cleanupConnection();
  }

  isReady(): boolean {
    return this._ready && !this._disposed;
  }

  getDebugInfo(): Record<string, unknown> {
    return {
      provider: "local-webrtc",
      channelActive: !!this.channel,
      disposed: this._disposed,
      callEnded: this._callEnded,
      peerConnectionState: this.pc?.connectionState ?? "none",
      iceConnectionState: this.pc?.iceConnectionState ?? "none",
      signalingState: this.pc?.signalingState ?? "none",
      localTracks: this.localStream?.getTracks().length ?? 0,
      pendingOffer: !!this._pendingOffer,
      pendingCandidates: this._pendingCandidates.length,
      role: this.role,
      callId: this.callId,
    };
  }

  // ── Signaling ──────────────────────────────────────────────

  private sendSignal(msg: SignalMessage): void {
    if (this._disposed) return; // [FIX #8]
    try {
      this.channel?.postMessage(msg);
    } catch (err) {
      // BroadcastChannel might be closed
      console.warn("[LocalWebRTC] Failed to send signal:", err);
    }
  }

  private async handleSignal(msg: SignalMessage): Promise<void> {
    // [FIX #8] Don't process signals if call ended or disposed
    if (this._disposed) return;

    // Accept offers for any callId (admin may not have set callId yet)
    const isRelevant = msg.callId === this.callId || msg.callId === this._pendingCallId;
    if (msg.type !== "offer" && !isRelevant) return;

    switch (msg.type) {
      case "offer":
        // BroadcastChannel guarantees the SENDER tab doesn't receive its own message.
        // So any offer we receive is from a DIFFERENT tab — always store it.
        // Note: role defaults to "employee" on both tabs, so we CANNOT filter by role here.
        this._pendingOffer = msg.data;
        this._pendingCallId = msg.callId;
        // If admin already has a PeerConnection and it's in stable state, process immediately
        if (this.role === "admin" && this.pc && !this._callEnded) {
          const sigState = this.pc.signalingState;
          if (sigState === "stable") {
            this.callId = msg.callId;
            await this.processOffer(msg.data);
          }
        }
        break;

      case "answer":
        if (this._callEnded) return; // [FIX #8]
        if (this.role === "employee" && this.pc) {
          try {
            await this.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            // Apply buffered ICE candidates
            await this.drainPendingCandidates();
          } catch (err) {
            console.error("[LocalWebRTC] Error setting remote answer:", err);
            this.events?.onStateChange("failed", "Failed to process answer from admin");
          }
        }
        break;

      case "ice-candidate":
        if (this._callEnded) return; // [FIX #8]
        // BroadcastChannel ensures we don't receive our own ICE candidates.
        // No role filtering needed — just buffer or apply.

        if (this.pc && this.pc.remoteDescription) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(msg.data));
          } catch (err) {
            console.error("[LocalWebRTC] Error adding ICE candidate:", err);
          }
        } else {
          // Buffer for later
          this._pendingCandidates.push(msg.data);
        }
        break;

      case "hangup":
        if (msg.from !== this.role && !this._callEnded) {
          this._callEnded = true; // [FIX #8] Mark before notifying
          this.events?.onStateChange("disconnected");
          this.cleanupConnection();
        }
        break;

      case "mic-status":
        // Reserved for future remote mute indicator
        break;
    }
  }

  private async processOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc || this._callEnded) return; // [FIX #8]
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.sendSignal({
        type: "answer",
        from: "admin",
        callId: this.callId,
        data: answer,
      });
      // Apply buffered ICE candidates
      await this.drainPendingCandidates();
    } catch (err) {
      console.error("[LocalWebRTC] Error processing offer:", err);
      this.events?.onStateChange("failed", "Failed to establish connection");
    }
  }

  private async drainPendingCandidates(): Promise<void> {
    if (!this.pc || this._callEnded) return; // [FIX #8]
    const candidates = [...this._pendingCandidates]; // Copy to avoid mutation during iteration
    this._pendingCandidates = [];
    for (const c of candidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.error("[LocalWebRTC] Error adding buffered ICE:", err);
      }
    }
  }

  // ── WebRTC Peer Connection ─────────────────────────────────

  private createPeerConnection(): void {
    // [FIX #7] Close existing PC before creating new one
    if (this.pc) {
      try { this.pc.close(); } catch { /* ignore */ }
      this.pc = null;
    }

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate && !this._callEnded) { // [FIX #8]
        this.sendSignal({
          type: "ice-candidate",
          from: this.role,
          callId: this.callId,
          data: ev.candidate.toJSON(),
        });
      }
    };

    this.pc.ontrack = (ev) => {
      if (this._callEnded || this._disposed) return; // [FIX #8]

      // Play remote audio
      if (!this.remoteAudio) {
        this.remoteAudio = new Audio();
        this.remoteAudio.autoplay = true;
      }
      this.remoteAudio.srcObject = ev.streams[0];

      // Notify engine of remote stream (for audio analysis)
      this.events?.onRemoteStream(ev.streams[0]);
    };

    this.pc.onconnectionstatechange = () => {
      if (this._callEnded || this._disposed) return; // [FIX #8]

      const state = this.pc?.connectionState;
      if (state === "connected") {
        this.events?.onStateChange("connected");
      } else if (state === "failed") {
        this._callEnded = true;
        this.events?.onStateChange("failed", "WebRTC connection failed");
        this.cleanupConnection();
      } else if (state === "disconnected") {
        // "disconnected" might be temporary (network hiccup).
        // Wait 3 seconds before reporting — it may recover.
        setTimeout(() => {
          if (this._callEnded || this._disposed) return;
          if (this.pc?.connectionState === "disconnected") {
            this._callEnded = true;
            this.events?.onStateChange("disconnected", "Connection lost");
            this.cleanupConnection();
          }
        }, 3000);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (this._callEnded || this._disposed) return; // [FIX #8]

      const state = this.pc?.iceConnectionState;
      if (state === "connected" || state === "completed") {
        this.events?.onStateChange("connected");
      }
      // Don't duplicate "failed" handling — onconnectionstatechange handles it
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private async acquireMicrophone(): Promise<MediaStream | null> {
    // E-C3: mediaDevices is absent on insecure contexts / old WebViews.
    // Distinct failure state so UI can show "upgrade your browser"
    // instead of misleading "permission denied".
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      this.events?.onStateChange("failed", "This browser does not support voice calls. Please update Chrome / system WebView.");
      return null;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      this.events?.onStateChange("failed", "Microphone access denied. Please allow microphone permission.");
      return null;
    }
  }

  private cleanupConnection(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
    if (this.pc) {
      // Remove event handlers to prevent stale callbacks
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      try { this.pc.close(); } catch { /* ignore */ }
      this.pc = null;
    }
    this._pendingOffer = null;
    this._pendingCandidates = [];
  }
}