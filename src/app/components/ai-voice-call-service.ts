// ═══════════════════════════════════════════════════════════════
// SOSphere — AI Voice Call Service (Elite feature)
// ─────────────────────────────────────────────────────────────
// Builds the spoken script the AI reads to emergency contacts when
// `sos-alert` places a PSTN or conference call on behalf of the user.
// Playback runs server-side (Twilio <Say voice="Polly.*"> / conference
// announce flow); this module is the SOURCE of that script.
//
// Server contract (documented here so the edge function knows what to
// honour — this is the only client module that shapes the AI script):
//
//   POST /functions/v1/sos-alert  { ..., aiScript?: { en?: string; ar?: string; lang?: "en"|"ar"; voice?: string; } }
//
//     If `aiScript` is present AND the authenticated user's tier
//     resolves to Elite server-side, the edge function should splice
//     the chosen string into the `<Say>` node of the outbound TwiML
//     instead of the generic fallback message. Missing/empty → server
//     falls back to its built-in message (behaviour is unchanged for
//     non-Elite users).
//
// Design goals:
//   • Safe defaults — if no template is set, the generic server message
//     runs. Elite users can personalise.
//   • Bilingual — EN + AR strings both stored; lang chosen at call time.
//   • Token expansion — {name}, {location}, {time} get interpolated
//     client-side before transmission so the server never sees raw
//     placeholder syntax.
//   • Tier-gated — silently returns null for non-Elite users; the SOS
//     path continues with the default server message.
//
// Public API:
//   getAiVoiceScript()        → { en, ar, lang, voice }
//   setAiVoiceScript(patch)   → AiVoiceScriptSettings
//   buildAiScriptPayload(ctx) → payload or null
// ═══════════════════════════════════════════════════════════════

import { hasFeature } from "./subscription-service";

export type AiVoiceLang = "en" | "ar";

/** Polly voices that ship with Twilio out-of-the-box. */
export type AiVoiceName =
  | "Polly.Joanna"   // en-US, natural
  | "Polly.Matthew"  // en-US, male
  | "Polly.Amy"      // en-GB, natural
  | "Polly.Zeina";   // ar, natural

export interface AiVoiceScriptSettings {
  /** English template. May contain {name}, {location}, {time}. */
  en: string;
  /** Arabic template. May contain {name}, {location}, {time}. */
  ar: string;
  /** Which language to play by default. */
  lang: AiVoiceLang;
  /** Polly voice to use. */
  voice: AiVoiceName;
}

const STORAGE_KEY = "sosphere_ai_voice_script";

const DEFAULTS: AiVoiceScriptSettings = {
  en: "Hello, this is an automated SOSphere emergency call on behalf of {name}. " +
      "They need help right now and their last known location is {location}. " +
      "The alert was raised at {time}. Please respond immediately.",
  ar: "مرحباً، هذه مكالمة طوارئ آلية من نظام سوسفير نيابةً عن {name}. " +
      "يحتاج إلى المساعدة في هذه اللحظة وآخر موقع معروف هو {location}. " +
      "تم إطلاق التنبيه في {time}. يُرجى الاستجابة فوراً.",
  lang: "en",
  voice: "Polly.Joanna",
};

// ─────────────────────────────────────────────────────────────
// Settings accessors
// ─────────────────────────────────────────────────────────────
export function getAiVoiceScript(): AiVoiceScriptSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AiVoiceScriptSettings>;
    return {
      en:    typeof parsed.en    === "string" && parsed.en.trim()    ? parsed.en    : DEFAULTS.en,
      ar:    typeof parsed.ar    === "string" && parsed.ar.trim()    ? parsed.ar    : DEFAULTS.ar,
      lang:  parsed.lang === "ar" ? "ar" : "en",
      voice: (["Polly.Joanna","Polly.Matthew","Polly.Amy","Polly.Zeina"] as const)
                .includes(parsed.voice as AiVoiceName) ? (parsed.voice as AiVoiceName) : DEFAULTS.voice,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setAiVoiceScript(patch: Partial<AiVoiceScriptSettings>): AiVoiceScriptSettings {
  const current = getAiVoiceScript();
  const merged: AiVoiceScriptSettings = {
    en:    patch.en    ?? current.en,
    ar:    patch.ar    ?? current.ar,
    lang:  patch.lang  ?? current.lang,
    voice: patch.voice ?? current.voice,
  };
  // Length cap — TwiML <Say> gets unwieldy past ~600 chars.
  merged.en = merged.en.slice(0, 600);
  merged.ar = merged.ar.slice(0, 600);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch {}
  return merged;
}

export function resetAiVoiceScript(): AiVoiceScriptSettings {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  return { ...DEFAULTS };
}

// ─────────────────────────────────────────────────────────────
// Interpolation + payload builder
// ─────────────────────────────────────────────────────────────
export interface AiScriptContext {
  name?: string;
  location?: string;
  /** Date object — rendered as local time string in the chosen language. */
  time?: Date;
}

/**
 * Replace {name}, {location}, {time} tokens in a template. Unknown tokens
 * are left alone. Input is trusted (user-configured); no HTML/XML escaping
 * happens here — the server is responsible for escaping into TwiML.
 */
export function interpolate(template: string, ctx: AiScriptContext, lang: AiVoiceLang): string {
  const locale = lang === "ar" ? "ar-SA" : "en-US";
  const time = ctx.time
    ? ctx.time.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : "";
  return template
    .replaceAll("{name}",     ctx.name     ?? "")
    .replaceAll("{location}", ctx.location ?? "")
    .replaceAll("{time}",     time)
    .replace(/\s+/g, " ")
    .trim();
}

export interface AiScriptPayload {
  /** Pre-interpolated text the server will place inside <Say>. */
  text: string;
  /** Language code the server should pass as <Say language=""> (en-US / ar-SA). */
  language: "en-US" | "ar-SA";
  /** Polly voice name. */
  voice: AiVoiceName;
}

/**
 * Build the payload to include in `sos-alert`'s body as `aiScript`.
 * Returns `null` if the user isn't Elite — in that case the primary SOS
 * path continues unchanged and the server uses its default script.
 */
export function buildAiScriptPayload(ctx: AiScriptContext): AiScriptPayload | null {
  if (!hasFeature("aiVoiceCalls")) return null;
  const cfg = getAiVoiceScript();
  const template = cfg.lang === "ar" ? cfg.ar : cfg.en;
  const text = interpolate(template, ctx, cfg.lang);
  if (!text) return null;
  return {
    text,
    language: cfg.lang === "ar" ? "ar-SA" : "en-US",
    voice: cfg.voice,
  };
}
