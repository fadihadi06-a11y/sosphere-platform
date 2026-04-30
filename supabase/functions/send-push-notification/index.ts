// ═══════════════════════════════════════════════════════════════════════════
// send-push-notification — Native Web Push (RFC 8030 / RFC 8291 / RFC 8292)
//
// PIVOT (2026-04-30): replaced Firebase Cloud Messaging HTTP v1 with the
// native Web Push protocol. FCM was rejecting our API key with persistent
// 401 UNAUTHENTICATED on the FCM Registration API V1 endpoint despite
// every visible Cloud Console setting being correct (key value matched,
// API restriction allowed FCM Registration, app restrictions = None,
// FCM API enabled). Root cause was opaque (Google-side propagation or
// OAuth consent screen requirement). Pivoting to the underlying W3C
// standard removes the dependency entirely.
//
// HOW IT WORKS:
//   The client (fcm-push.ts) calls PushManager.subscribe() and saves the
//   resulting PushSubscription JSON into push_tokens.token. This row
//   contains:
//     { endpoint: "https://fcm.googleapis.com/wp/...",
//       keys: { p256dh: "BN...", auth: "..." } }
//   We sign a VAPID JWT (ECDSA P-256, 6-hour expiry), encrypt the
//   payload with AES-128-GCM using ECDH-derived keys, and POST to the
//   endpoint URL. The browser's push service routes the message to the
//   registered service worker, which fires the `push` event handled by
//   /sw.js (already implemented).
//
// AUTHORIZATION MODEL (UNCHANGED from FCM era — this is purely a
// transport change):
//   1) self    — caller === target
//   2) company — caller and target share an active company_membership
//   3) service-role — bypasses checks (sos-alert internal calls)
//   Anything else returns 403.
//
// ENVIRONMENT VARIABLES (set via `supabase secrets set`):
//   VAPID_PUBLIC_KEY   — base64url-encoded P-256 public key (raw, 65 bytes
//                        starting with 0x04, the uncompressed marker).
//                        SAME value as client's VITE_FIREBASE_VAPID_KEY.
//   VAPID_PRIVATE_KEY  — base64url-encoded P-256 private key (raw, 32 bytes).
//   VAPID_SUBJECT      — "mailto:ops@sosphere.app" or a https URL.
//
// FAIL-MODES:
//   • VAPID env vars missing → 503 with reason="vapid_not_configured"
//   • Push service returns 410/404 → token marked is_active=false
//   • Push service returns other 4xx → counted as failure, kept active
//   • No push_tokens for target → 200 with sent_count=0 (not an error)
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPA_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:ops@sosphere.app";

const VAPID_CONFIGURED = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://sosphere-platform.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function buildCors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────
// Base64url helpers. Web Push uses URL-safe base64 WITHOUT padding
// everywhere (subscription keys, VAPID keys, JWT encoding).
// ─────────────────────────────────────────────────────────────────────────
function b64uToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// VAPID JWT signing. ECDSA P-256 with SHA-256.
// We cache the imported private key in module memory to avoid re-importing
// it on every call. The JWT is short-lived (12h max per spec; we cap at 6h)
// and reused per-audience until 5min before expiry.
// ─────────────────────────────────────────────────────────────────────────
const _cachedJwts = new Map<string, { jwt: string; expiresAt: number }>();
let _cachedPrivateKey: CryptoKey | null = null;

async function importVapidPrivateKey(): Promise<CryptoKey> {
  if (_cachedPrivateKey) return _cachedPrivateKey;
  const dBytes = b64uToBytes(VAPID_PRIVATE_KEY);
  const pubBytes = b64uToBytes(VAPID_PUBLIC_KEY);
  if (dBytes.length !== 32) {
    throw new Error(`VAPID_PRIVATE_KEY wrong length: expected 32 bytes, got ${dBytes.length}`);
  }
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error(`VAPID_PUBLIC_KEY must be 65 bytes starting with 0x04 (uncompressed P-256)`);
  }
  const x = pubBytes.slice(1, 33);
  const y = pubBytes.slice(33, 65);
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: bytesToB64u(dBytes),
    x: bytesToB64u(x),
    y: bytesToB64u(y),
    ext: true,
  };
  _cachedPrivateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return _cachedPrivateKey;
}

async function signVapidJwt(audience: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = _cachedJwts.get(audience);
  if (cached && cached.expiresAt > now + 300) return cached.jwt;

  const exp = now + 6 * 3600;
  const headerB64 = bytesToB64u(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claimsB64 = bytesToB64u(utf8(JSON.stringify({
    aud: audience,
    exp,
    sub: VAPID_SUBJECT,
  })));
  const signingInput = `${headerB64}.${claimsB64}`;
  const key = await importVapidPrivateKey();
  // WebCrypto returns r||s concatenated (64 bytes for P-256). That's the
  // correct JWS format — no DER wrapping needed.
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(signingInput),
  ));
  const jwt = `${signingInput}.${bytesToB64u(sig)}`;
  _cachedJwts.set(audience, { jwt, expiresAt: exp });
  return jwt;
}

// ─────────────────────────────────────────────────────────────────────────
// HKDF helper (RFC 5869). Used by aes128gcm content-encoding (RFC 8188)
// to derive the content encryption key (CEK) and nonce from the IKM.
// ─────────────────────────────────────────────────────────────────────────
async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw", ikm, { name: "HKDF" }, false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ─────────────────────────────────────────────────────────────────────────
// Encrypt payload using aes128gcm content-encoding (RFC 8188 / RFC 8291).
//
// Returns the full body to POST to the endpoint:
//   header(86 bytes: salt[16] || rs[4]=4096 || idlen[1]=65 || keyid[65]=as_pub_uncompressed)
//   || ciphertext (= AES-GCM(plaintext || 0x02))
//
// We append a single 0x02 delimiter to the plaintext (no extra padding —
// payloads are short and we prefer minimum overhead).
// ─────────────────────────────────────────────────────────────────────────
async function encryptAes128Gcm(
  plaintext: Uint8Array,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
): Promise<Uint8Array> {
  // 1) Generate ephemeral ECDH P-256 keypair (Application Server's per-msg
  //    keys — distinct from the long-lived VAPID keys; spec requires fresh
  //    per-message keypair for forward secrecy).
  const ephKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const asPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephKeyPair.publicKey),
  );
  if (asPubRaw.length !== 65) {
    throw new Error(`Unexpected AS public key length: ${asPubRaw.length}`);
  }

  // 2) Import UA's public key for ECDH derivation.
  const uaPubKey = await crypto.subtle.importKey(
    "raw", uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false, [],
  );

  // 3) ECDH → shared secret (32 bytes).
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: uaPubKey },
      ephKeyPair.privateKey,
      256,
    ),
  );

  // 4) HKDF chain per RFC 8291:
  //    keyInfo = "WebPush: info\0" || ua_pub || as_pub
  //    IKM     = HKDF(sharedSecret, salt=authSecret, info=keyInfo, 32)
  //    salt    = random(16)
  //    PRK     = HKDF-Extract(salt, IKM)
  //    cek     = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0", 16)
  //    nonce   = HKDF-Expand(PRK, "Content-Encoding: nonce\0", 12)
  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, asPubRaw);
  const ikm = await hkdf(sharedSecret, authSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdf(ikm, salt, new Uint8Array(0), 32);
  const cek = await hkdf(prk, new Uint8Array(0), utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(prk, new Uint8Array(0), utf8("Content-Encoding: nonce\0"), 12);

  // 5) AES-128-GCM encryption with 0x02 delimiter appended.
  const aesKey = await crypto.subtle.importKey(
    "raw", cek, { name: "AES-GCM" }, false, ["encrypt"],
  );
  const padded = concat(plaintext, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded),
  );

  // 6) Build aes128gcm body header per RFC 8188 §2.1:
  //    salt(16) || rs(4 BE) || idlen(1) || keyid(idlen)
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  header[16] = 0x00; header[17] = 0x00; header[18] = 0x10; header[19] = 0x00; // rs=4096
  header[20] = 65; // idlen
  header.set(asPubRaw, 21);

  return concat(header, ciphertext);
}

// ─────────────────────────────────────────────────────────────────────────
// POST one message to a single subscription.
// Returns ok/reason/dead. `dead=true` (404/410) means caller should mark
// the subscription is_active=false in push_tokens.
// ─────────────────────────────────────────────────────────────────────────
async function sendOneWebPush(params: {
  subscriptionJson: string;
  payloadJson: string;
}): Promise<{ ok: boolean; reason?: string; dead?: boolean }> {
  let sub: { endpoint: string; keys: { p256dh: string; auth: string } };
  try {
    sub = JSON.parse(params.subscriptionJson);
  } catch {
    return { ok: false, reason: "subscription_json_unparseable", dead: true };
  }
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return { ok: false, reason: "subscription_json_invalid_shape", dead: true };
  }

  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await signVapidJwt(audience);

  const uaPublic = b64uToBytes(sub.keys.p256dh);
  const authSecret = b64uToBytes(sub.keys.auth);
  const plaintext = utf8(params.payloadJson);

  let body: Uint8Array;
  try {
    body = await encryptAes128Gcm(plaintext, uaPublic, authSecret);
  } catch (e) {
    return { ok: false, reason: `encrypt_failed: ${(e as Error).message}` };
  }

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
      "Urgency": "high",
      "Authorization": `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
    },
    body,
  });

  if (res.status === 201 || res.status === 202 || res.status === 200) {
    return { ok: true };
  }
  // 404/410 → permanently dead. Other 4xx/5xx → transient (keep active).
  const dead = res.status === 404 || res.status === 410;
  let bodyText = "";
  try { bodyText = (await res.text()).slice(0, 200); } catch { /* ignore */ }
  return {
    ok: false,
    dead,
    reason: `${res.status} ${res.statusText} ${bodyText}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Main handler.
// ─────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  if (!VAPID_CONFIGURED) {
    return new Response(
      JSON.stringify({
        error: "vapid_not_configured",
        message: "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars are not set on this Supabase project.",
      }),
      { status: 503, headers: CORS },
    );
  }

  // ── 1) Auth ──────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing token" }), { status: 401, headers: CORS });
  }

  const isServiceRole = (jwt === SUPA_SERVICE_ROLE);

  let callerUserId: string | null = null;
  if (!isServiceRole) {
    const userClient = createClient(SUPA_URL, SUPA_ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });
    }
    callerUserId = userData.user.id;
  }

  // ── 2) Parse body ────────────────────────────────────────────────
  let body: {
    targetUserId?: string;
    title?: string;
    body?: string;
    data?: Record<string, string>;
  };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: CORS });
  }
  const targetUserId = (body.targetUserId || "").trim();
  const title = (body.title || "").trim();
  const messageBody = (body.body || "").trim();
  const data = body.data || {};

  if (!targetUserId || !UUID_RE.test(targetUserId)) {
    return new Response(JSON.stringify({ error: "Invalid targetUserId" }), { status: 400, headers: CORS });
  }
  if (!title || title.length > 200) {
    return new Response(JSON.stringify({ error: "titl