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
//   resulting PushSubscription JSON into push_tokens.token. We sign a
//   VAPID JWT (ECDSA P-256, 6-hour expiry), encrypt the payload with
//   AES-128-GCM using ECDH-derived keys, and POST to the endpoint URL.
//   The browser routes the message to /sw.js which fires the push event.
//
// AUTHORIZATION MODEL (UNCHANGED from FCM era):
//   1) self    — caller === target
//   2) company — caller and target share an active company_membership
//   3) service-role — bypasses checks (sos-alert internal calls)
//
// ENVIRONMENT VARIABLES (set via Supabase Edge Function Secrets):
//   VAPID_PUBLIC_KEY   — base64url P-256 public key (raw, 65 bytes, 0x04 prefix)
//   VAPID_PRIVATE_KEY  — base64url P-256 private key (raw, 32 bytes)
//   VAPID_SUBJECT      — "mailto:..." or a https URL
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

// Base64url helpers.
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

function utf8(s: string): Uint8Array { return new TextEncoder().encode(s); }

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// VAPID JWT: ECDSA P-256 with SHA-256, cached per-audience.
const _cachedJwts = new Map<string, { jwt: string; expiresAt: number }>();
let _cachedPrivateKey: CryptoKey | null = null;

async function importVapidPrivateKey(): Promise<CryptoKey> {
  if (_cachedPrivateKey) return _cachedPrivateKey;
  const dBytes = b64uToBytes(VAPID_PRIVATE_KEY);
  const pubBytes = b64uToBytes(VAPID_PUBLIC_KEY);
  if (dBytes.length !== 32) throw new Error("VAPID_PRIVATE_KEY wrong length: " + dBytes.length);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) throw new Error("VAPID_PUBLIC_KEY must be 65b uncompressed P-256");
  const x = pubBytes.slice(1, 33);
  const y = pubBytes.slice(33, 65);
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", d: bytesToB64u(dBytes), x: bytesToB64u(x), y: bytesToB64u(y), ext: true };
  _cachedPrivateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return _cachedPrivateKey;
}

async function signVapidJwt(audience: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = _cachedJwts.get(audience);
  if (cached && cached.expiresAt > now + 300) return cached.jwt;
  const exp = now + 6 * 3600;
  const headerB64 = bytesToB64u(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claimsB64 = bytesToB64u(utf8(JSON.stringify({ aud: audience, exp, sub: VAPID_SUBJECT })));
  const signingInput = headerB64 + "." + claimsB64;
  const key = await importVapidPrivateKey();
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(signingInput)));
  const jwt = signingInput + "." + bytesToB64u(sig);
  _cachedJwts.set(audience, { jwt, expiresAt: exp });
  return jwt;
}

// HKDF-Extract (RFC 5869): PRK = HMAC-SHA-256(salt, IKM).
// Extract is just one HMAC. We do this directly with WebCrypto's HMAC sign,
// not WebCrypto's HKDF (which fuses Extract+Expand and gives the wrong PRK
// when you want the bare extract output).
async function hmacSha256(keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
}

// HKDF-Expand (RFC 5869): output = T(1) || T(2) || ... where
// T(i) = HMAC-SHA-256(PRK, T(i-1) || info || byte(i)). We must implement this
// manually because WebCrypto HKDF always prepends an Extract step.
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const hashLen = 32; // SHA-256
  const blocks = Math.ceil(length / hashLen);
  if (blocks > 255) throw new Error("hkdfExpand: length too large");
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  let written = 0;
  for (let i = 1; i <= blocks; i++) {
    const inputArr = new Uint8Array(prev.length + info.length + 1);
    inputArr.set(prev, 0);
    inputArr.set(info, prev.length);
    inputArr[prev.length + info.length] = i;
    prev = await hmacSha256(prk, inputArr);
    const take = Math.min(hashLen, length - written);
    out.set(prev.subarray(0, take), written);
    written += take;
  }
  return out;
}

// aes128gcm content-encoding (RFC 8188 / RFC 8291).
//
// Audit 2026-05-02 (lifesaving fix): the previous implementation used
// WebCrypto's HKDF (which performs Extract+Expand atomically) for ALL three
// derivation steps. That worked for the FIRST call (computing IKM from the
// ECDH shared secret + auth_secret + key_info), because there we genuinely
// need Extract+Expand. But for the second step we need PRK = HMAC(salt, IKM)
// raw — *just* Extract — and for steps 3 and 4 we need Expand-only from PRK.
//
// Calling WebCrypto HKDF with empty info to "approximate" Extract gave us
// HMAC(HMAC(salt, IKM), 0x01), not HMAC(salt, IKM). And calling HKDF for the
// CEK/NONCE re-Extracted PRK against an empty salt before Expanding, so the
// CEK and NONCE were *both* off by a factor of an extra Extract.
//
// The cumulative effect: ciphertext that the push service happily accepts and
// forwards (it doesn't validate encryption), but that the browser silently
// drops because it can't decrypt with the auth_secret it gave us at subscribe
// time. Symptom: send-push-notification returns sent_count:1, but the SW push
// event never fires and getNotifications() stays empty.
//
// Fix: separate hmacSha256() (= Extract for our case) and a hand-rolled
// hkdfExpand() (RFC 5869 § 2.3). All three derivations now match the spec.
async function encryptAes128Gcm(plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array): Promise<Uint8Array> {
  const ephKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephKeyPair.publicKey));
  if (asPubRaw.length !== 65) throw new Error("AS public key wrong length: " + asPubRaw.length);
  const uaPubKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaPubKey }, ephKeyPair.privateKey, 256));
  // RFC 8291 step: IKM = HKDF(salt=auth_secret, IKM=ECDH_shared, info=key_info, len=32).
  // Here we DO want Extract+Expand together → use hmacSha256 for Extract then hkdfExpand.
  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, asPubRaw);
  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  // RFC 8188 PRK = HMAC-SHA-256(salt, IKM) — Extract ONLY. NOT another HKDF.
  const prk = await hmacSha256(salt, ikm);
  // RFC 8188 CEK / NONCE = HKDF-Expand from PRK. Do NOT re-Extract.
  const cek = await hkdfExpand(prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, utf8("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const padded = concat(plaintext, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  header[16] = 0x00; header[17] = 0x00; header[18] = 0x10; header[19] = 0x00;
  header[20] = 65;
  header.set(asPubRaw, 21);
  return concat(header, ciphertext);
}

async function sendOneWebPush(params: { subscriptionJson: string; payloadJson: string }): Promise<{ ok: boolean; reason?: string; dead?: boolean }> {
  let sub: { endpoint: string; keys: { p256dh: string; auth: string } };
  try { sub = JSON.parse(params.subscriptionJson); } catch { return { ok: false, reason: "subscription_json_unparseable", dead: true }; }
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return { ok: false, reason: "subscription_invalid_shape", dead: true };
  const url = new URL(sub.endpoint);
  const audience = url.protocol + "//" + url.host;
  const jwt = await signVapidJwt(audience);
  const uaPublic = b64uToBytes(sub.keys.p256dh);
  const authSecret = b64uToBytes(sub.keys.auth);
  const plaintext = utf8(params.payloadJson);
  let body: Uint8Array;
  try { body = await encryptAes128Gcm(plaintext, uaPublic, authSecret); }
  catch (e) { return { ok: false, reason: "encrypt_failed: " + (e as Error).message }; }
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
      "Urgency": "high",
      "Authorization": "vapid t=" + jwt + ", k=" + VAPID_PUBLIC_KEY,
    },
    body,
  });
  if (res.status === 201 || res.status === 202 || res.status === 200) return { ok: true };
  const dead = res.status === 404 || res.status === 410;
  let bodyText = "";
  try { bodyText = (await res.text()).slice(0, 200); } catch { /* ignore */ }
  return { ok: false, dead, reason: res.status + " " + res.statusText + " " + bodyText };
}

// ═══════════════════════════════════════════════════════════════════════════
// R-54 (MOBILE_AUDIT_FINDINGS, 2026-05-19) — FCM HTTP v1 dual-path
// ─────────────────────────────────────────────────────────────────────────
// The 2026-04-30 PIVOT to Web Push solved the dashboard/web path but left
// native Android push broken: Capacitor WebView's service worker does not
// reliably receive push events when the app is backgrounded or killed by
// Doze. R-53 wired @capacitor/push-notifications on the client side to
// collect FCM registration tokens with platform='android'. This block
// adds the SERVER side: FCM HTTP v1 delivery using a Service Account JWT
// (FCM_SERVICE_ACCOUNT_JSON Supabase secret, uploaded via R-55).
//
// Why NOT the legacy API key path the 2026-04-30 commit abandoned:
//   • Service Account auth is OAuth2 with RS256-signed JWT — a fundamentally
//     different code path on Google's side from API key auth. The 401
//     UNAUTHENTICATED failures that triggered the pivot were on the API
//     key path; they do not apply here.
//   • Service Account is the recommended modern approach (Google deprecated
//     the legacy server key in 2024).
//
// Detection: every row of push_tokens carries the token. Web Push
// subscriptions are JSON-stringified objects starting with '{'. FCM
// registration tokens are plain strings. We route accordingly.
// ═══════════════════════════════════════════════════════════════════════════

const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") || "";

interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let _fcmServiceAccount: FcmServiceAccount | null | undefined = undefined;
let _fcmAccessToken: { token: string; expiresAt: number } | null = null;
let _fcmPrivateKey: CryptoKey | null = null;

function getFcmServiceAccount(): FcmServiceAccount | null {
  if (_fcmServiceAccount !== undefined) return _fcmServiceAccount;
  if (!FCM_SERVICE_ACCOUNT_JSON) { _fcmServiceAccount = null; return null; }
  try {
    const j = JSON.parse(FCM_SERVICE_ACCOUNT_JSON);
    if (!j.project_id || !j.client_email || !j.private_key) {
      console.warn("[FCM] service account JSON missing required fields");
      _fcmServiceAccount = null; return null;
    }
    _fcmServiceAccount = { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key };
    return _fcmServiceAccount;
  } catch (e) {
    console.warn("[FCM] service account JSON parse failed:", (e as Error).message);
    _fcmServiceAccount = null;
    return null;
  }
}

const FCM_CONFIGURED = !!getFcmServiceAccount();

/** Convert a PEM-encoded PKCS8 RSA private key to a WebCrypto CryptoKey. */
async function importFcmPrivateKey(): Promise<CryptoKey | null> {
  if (_fcmPrivateKey) return _fcmPrivateKey;
  const sa = getFcmServiceAccount();
  if (!sa) return null;
  // Strip PEM armor + whitespace, decode base64 to DER bytes.
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s/g, "");
  // PEM uses standard base64 (+,/); convert to b64url so b64uToBytes works.
  const b64u = pem.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const derBytes = b64uToBytes(b64u);
  _fcmPrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    derBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return _fcmPrivateKey;
}

/** Sign a Google-OAuth2 RS256 JWT asserting the service account identity. */
async function signFcmJwt(): Promise<string | null> {
  const sa = getFcmServiceAccount();
  if (!sa) return null;
  const key = await importFcmPrivateKey();
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const signingInput = bytesToB64u(utf8(JSON.stringify(header))) + "." + bytesToB64u(utf8(JSON.stringify(claim)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(signingInput));
  return signingInput + "." + bytesToB64u(new Uint8Array(sig));
}

/** Exchange the JWT for a short-lived (1h) OAuth2 access token. Cached. */
async function getFcmAccessToken(): Promise<string | null> {
  // Refresh ~1 minute before actual expiry to avoid races on long requests.
  if (_fcmAccessToken && _fcmAccessToken.expiresAt > Date.now() + 60_000) {
    return _fcmAccessToken.token;
  }
  const jwt = await signFcmJwt();
  if (!jwt) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }).toString(),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[FCM] oauth2 token exchange failed:", res.status, errText.slice(0, 200));
      return null;
    }
    const j = await res.json();
    _fcmAccessToken = {
      token: j.access_token,
      expiresAt: Date.now() + ((j.expires_in || 3600) * 1000),
    };
    return _fcmAccessToken.token;
  } catch (e) {
    console.warn("[FCM] oauth2 fetch threw:", (e as Error).message);
    return null;
  }
}

/** Send one FCM HTTP v1 message to a single registration token. */
async function sendOneFcmV1(params: {
  registrationToken: string;
  title: string;
  body: string;
  data: Record<string, string>;
}): Promise<{ ok: boolean; reason?: string; dead?: boolean }> {
  const sa = getFcmServiceAccount();
  if (!sa) return { ok: false, reason: "fcm_service_account_not_configured" };
  const accessToken = await getFcmAccessToken();
  if (!accessToken) return { ok: false, reason: "fcm_oauth_failed" };

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const message = {
    message: {
      token: params.registrationToken,
      // notification block lets Android render a system notification even
      // when the app is in background / killed. Without this, only
      // foreground apps would see anything.
      notification: { title: params.title, body: params.body },
      // data block carries the deep-link path + custom fields. The client
      // listener (push-notifications-native.ts) reads data.path for routing.
      data: params.data,
      android: {
        priority: "high",
        notification: {
          channel_id: "sosphere_sos",
          sound: "default",
          default_sound: true,
          // Wake the screen + show on lock screen for SOS-severity alerts.
          notification_priority: "PRIORITY_MAX",
          visibility: "PUBLIC",
        },
      },
    },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (res.ok) return { ok: true };
    const errText = await res.text().catch(() => "");
    // FCM marks dead tokens with 404 + "UNREGISTERED" or "NOT_FOUND" in the
    // body. We surface dead=true so the caller can deactivate the row.
    const dead = res.status === 404 || /UNREGISTERED|NOT_FOUND/i.test(errText);
    return { ok: false, reason: `HTTP ${res.status}: ${errText.slice(0, 200)}`, dead };
  } catch (e) {
    return { ok: false, reason: "exception: " + (e as Error).message };
  }
}

/**
 * Detect whether a push_tokens row stores a Web Push subscription (JSON)
 * or an FCM registration token (plain string).
 */
function isWebPushSubscription(token: string): boolean {
  if (!token || token.length < 10) return false;
  return token.trimStart().startsWith("{");
}


Deno.serve(async (req) => {
  const CORS = buildCors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });

  if (!VAPID_CONFIGURED) {
    return new Response(JSON.stringify({ error: "vapid_not_configured", message: "VAPID env vars missing." }), { status: 503, headers: CORS });
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return new Response(JSON.stringify({ error: "Missing token" }), { status: 401, headers: CORS });

  const isServiceRole = (jwt === SUPA_SERVICE_ROLE);

  let callerUserId: string | null = null;
  if (!isServiceRole) {
    const userClient = createClient(SUPA_URL, SUPA_ANON, { global: { headers: { Authorization: "Bearer " + jwt } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: CORS });
    callerUserId = userData.user.id;
  }

  let body: { targetUserId?: string; title?: string; body?: string; data?: Record<string, string> };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: CORS }); }
  const targetUserId = (body.targetUserId || "").trim();
  const title = (body.title || "").trim();
  const messageBody = (body.body || "").trim();
  const data = body.data || {};

  if (!targetUserId || !UUID_RE.test(targetUserId)) return new Response(JSON.stringify({ error: "Invalid targetUserId" }), { status: 400, headers: CORS });
  if (!title || title.length > 200) return new Response(JSON.stringify({ error: "title required (1-200 chars)" }), { status: 400, headers: CORS });
  if (!messageBody || messageBody.length > 1000) return new Response(JSON.stringify({ error: "body required (1-1000 chars)" }), { status: 400, headers: CORS });

  const admin = createClient(SUPA_URL, SUPA_SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

  if (!isServiceRole && callerUserId) {
    if (callerUserId !== targetUserId) {
      const { data: cm } = await admin.from("company_memberships").select("company_id").eq("user_id", callerUserId).eq("active", true);
      const callerCompanies = new Set((cm || []).map((r: any) => r.company_id));
      let sharedCompany = false;
      if (callerCompanies.size > 0) {
        const { data: tm } = await admin.from("company_memberships").select("company_id").eq("user_id", targetUserId).eq("active", true);
        sharedCompany = (tm || []).some((r: any) => callerCompanies.has(r.company_id));
      }
      if (!sharedCompany) return new Response(JSON.stringify({ error: "Not authorized to push to this user" }), { status: 403, headers: CORS });
    }
  }

  const { data: tokens, error: tokenErr } = await admin.from("push_tokens").select("id, token, platform").eq("user_id", targetUserId).eq("is_active", true);
  if (tokenErr) {
    console.warn("[send-push-notification] push_tokens query failed:", tokenErr);
    return new Response(JSON.stringify({ error: "Token lookup failed" }), { status: 500, headers: CORS });
  }
  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent_count: 0, failed_count: 0, note: "No active push tokens for target user" }), { status: 200, headers: CORS });
  }

  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) stringData[k] = typeof v === "string" ? v : JSON.stringify(v);
  const payloadJson = JSON.stringify({
    title, body: messageBody, data: stringData,
    severity: stringData.severity || "high",
    tag: stringData.tag || stringData.callId || ("sosphere-" + Date.now()),
  });

  let sentCount = 0;
  let failedCount = 0;
  const failures: Array<{ tokenId: string; reason: string }> = [];

  // R-54: dual-path delivery. Web Push subscriptions (JSON, starts with
  // '{') go through the existing AES-128-GCM + VAPID path. FCM
  // registration tokens (plain strings, platform='android'|'ios') go
  // through FCM HTTP v1 with the Service Account JWT.
  let webPushCount = 0;
  let fcmCount = 0;
  for (const t of tokens) {
    let result: { ok: boolean; reason?: string; dead?: boolean };
    const platform = String(t.platform || "").toLowerCase();
    const isWebPush = isWebPushSubscription(t.token);

    if (isWebPush) {
      try { result = await sendOneWebPush({ subscriptionJson: t.token, payloadJson }); }
      catch (e) { result = { ok: false, reason: "exception: " + (e as Error).message }; }
      webPushCount++;
    } else if (platform === "android" || platform === "ios") {
      if (!FCM_CONFIGURED) {
        result = { ok: false, reason: "fcm_service_account_not_configured" };
      } else {
        try {
          result = await sendOneFcmV1({
            registrationToken: t.token,
            title,
            body: messageBody,
            data: stringData,
          });
        } catch (e) { result = { ok: false, reason: "exception: " + (e as Error).message }; }
      }
      fcmCount++;
    } else {
      // Unknown shape — non-JSON token without an android/ios platform tag.
      // Most likely a legacy row from before R-50 widened the platform check;
      // mark failed but do NOT deactivate (we don't know what it is).
      result = { ok: false, reason: `unrecognized_token_shape: platform=${platform || "(empty)"}` };
    }

    if (result.ok) sentCount++;
    else {
      failedCount++;
      failures.push({ tokenId: t.id, reason: result.reason || "unknown" });
      if (result.dead) {
        try { await admin.from("push_tokens").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", t.id); }
        catch (e) { console.warn("[send-push-notification] token deactivation failed:", e); }
      }
    }
  }

  try {
    await admin.from("audit_log").insert({
      id: crypto.randomUUID(),
      action: "push_notification_sent",
      actor: isServiceRole ? "service_role" : (callerUserId || "anonymous"),
      actor_id: callerUserId,
      actor_role: isServiceRole ? "system" : "user",
      operation: "PUSH",
      target: targetUserId,
      category: "communications",
      severity: failedCount > 0 ? "warning" : "info",
      metadata: {
        title, body_preview: messageBody.slice(0, 80), target_user_id: targetUserId,
        sent_count: sentCount, failed_count: failedCount, failures: failures.slice(0, 5),
        is_service_role: isServiceRole, transport: "dual-path", web_push_count: webPushCount, fcm_count: fcmCount, fcm_configured: FCM_CONFIGURED,
      },
      created_at: new Date().toISOString(),
    });
  } catch (err) { console.warn("[send-push-notification] audit_log write failed:", err); }

  return new Response(JSON.stringify({
    ok: true, sent_count: sentCount, failed_count: failedCount,
    target_token_count: tokens.length, failures: failures.slice(0, 5),
  }), { status: 200, headers: CORS });
});
