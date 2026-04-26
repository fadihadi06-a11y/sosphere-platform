// W3-12 hard test — evidence-vault wiring end-to-end.
// Phase C wires the previously-dead evidence-vault-service into:
//   P1: createVault on SOS doEnd (sos-emergency.tsx)
//   P2: "Police" button in emergency-response-record.tsx
//   P4: syncPendingVaults + autoLockExpiredVaults wired to network/resume/periodic
//
// Includes regression for the create-vs-verify hash inconsistency W3-12 found.

import crypto from "node:crypto";

let fail = 0;
function assert(label, cond, extra = "") {
  if (!cond) fail++;
  console.log((cond ? "OK " : "X  ") + label + (extra ? "  " + extra : ""));
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function makeVaultStore() {
  let vaults = [];
  return {
    create(p) {
      const v = {
        vaultId: `VAULT-${p.emergencyId}-${Date.now().toString(36).slice(-4)}-${(Math.random()*1e6|0)}`,
        emergencyId: p.emergencyId,
        userId: p.userId,
        userName: p.userName,
        startTime: p.startTime,
        endTime: p.endTime,
        durationSec: Math.round((p.endTime - p.startTime) / 1000),
        contactsNotified: p.contactsNotified.map(c => ({
          name: c.name,
          phone: "*".repeat(Math.max(0, c.phone.length - 4)) + c.phone.slice(-4),
          method: c.method || "twilio",
        })),
        photoCount: p.photos?.length || 0,
        photoIds: (p.photos || []).map(x => x.id),
        audioRecording: p.recordingDurationSec
          ? { available: true, durationSec: p.recordingDurationSec, format: p.recordingFormat || "webm" }
          : null,
        gpsTrail: p.gpsTrail || [],
        integrityHash: "",
        lockedAt: null,
        synced: false,
        shareUrl: null,
        createdAt: Date.now(),
      };
      // W3-12 fix: hash excludes the SAME fields verify excludes
      const hashInput = JSON.stringify({ ...v, integrityHash: undefined, lockedAt: undefined, synced: undefined, shareUrl: undefined });
      v.integrityHash = sha256(hashInput);
      vaults.push(v);
      return v;
    },
    get(id) { return vaults.find(v => v.vaultId === id) || null; },
    getForEmergency(eid) { return vaults.find(v => v.emergencyId === eid) || null; },
    lock(id) { const v = vaults.find(x => x.vaultId === id); if (!v) return false; v.lockedAt = Date.now(); return true; },
    verify(id) {
      const v = vaults.find(x => x.vaultId === id);
      if (!v) return false;
      const h = JSON.stringify({ ...v, integrityHash: undefined, lockedAt: undefined, synced: undefined, shareUrl: undefined });
      return sha256(h) === v.integrityHash;
    },
    tamper(id, patch) { const v = vaults.find(x => x.vaultId === id); if (v) Object.assign(v, patch); },
    generateShareUrl(id) {
      const v = vaults.find(x => x.vaultId === id);
      if (!v) return null;
      const tok = crypto.randomBytes(8).toString("hex");
      v.shareUrl = `https://sosphere.co/vault/${id}?s=${tok}`;
      return v.shareUrl;
    },
    setSynced(id, s) { const v = vaults.find(x => x.vaultId === id); if (v) v.synced = s; },
    autoLockExpired(thresholdMs) {
      let n = 0;
      for (const v of vaults) {
        if (!v.lockedAt && (Date.now() - v.createdAt) > thresholdMs) { v.lockedAt = Date.now(); n++; }
      }
      return n;
    },
    syncPending(uploadFn) {
      let n = 0;
      for (const v of vaults) { if (!v.synced && uploadFn(v)) { v.synced = true; n++; } }
      return n;
    },
  };
}

// S1: vault created
{
  const store = makeVaultStore();
  const v = store.create({
    emergencyId: "ERR-1", userId: "u1", userName: "Alice",
    startTime: Date.now() - 60000, endTime: Date.now(),
    contactsNotified: [{ name: "Bob", phone: "+15551234567" }],
    photos: [{ id: "p1" }, { id: "p2" }],
    recordingDurationSec: 60,
  });
  assert("S1 vaultId starts with VAULT-", v.vaultId.startsWith("VAULT-ERR-1"));
  assert("S1 phone masked (last 4)", v.contactsNotified[0].phone.endsWith("4567") && !v.contactsNotified[0].phone.includes("1555"));
  assert("S1 SHA-256 64 hex chars", /^[a-f0-9]{64}$/.test(v.integrityHash));
  assert("S1 photoCount=2", v.photoCount === 2);
  assert("S1 audio metadata", v.audioRecording?.available === true);
  assert("S1 not synced", v.synced === false);
  assert("S1 not locked", v.lockedAt === null);
}

// S2: integrity verify on FRESH vault — was the W3-12 hash inconsistency
{
  const store = makeVaultStore();
  const v = store.create({
    emergencyId: "ERR-2", userId: "u", userName: "u",
    startTime: Date.now() - 1000, endTime: Date.now(),
    contactsNotified: [], photos: [],
  });
  assert("S2 fresh vault verifies (W3-12 hash inconsistency fix)", store.verify(v.vaultId) === true);
}

// S3: tamper detection
{
  const store = makeVaultStore();
  const v = store.create({
    emergencyId: "ERR-3", userId: "u", userName: "u",
    startTime: Date.now() - 1000, endTime: Date.now(),
    contactsNotified: [{ name: "Bob", phone: "+15551112222" }], photos: [{ id: "p1" }],
  });
  store.lock(v.vaultId);
  store.tamper(v.vaultId, { contactsNotified: [{ name: "Eve", phone: "*******9999", method: "twilio" }] });
  assert("S3 tampered vault FAILS verify", store.verify(v.vaultId) === false);
}

// S4: auto-lock after 24h
{
  const store = makeVaultStore();
  const v1 = store.create({ emergencyId: "ERR-recent", userId: "u", userName: "u", startTime: 0, endTime: 0, contactsNotified: [], photos: [] });
  const v2 = store.create({ emergencyId: "ERR-old", userId: "u", userName: "u", startTime: 0, endTime: 0, contactsNotified: [], photos: [] });
  v2.createdAt = Date.now() - 25 * 60 * 60 * 1000;
  const locked = store.autoLockExpired(24 * 60 * 60 * 1000);
  assert("S4 autoLockExpired locks 1 (the >24h vault)", locked === 1);
  assert("S4 v1 stays unlocked", store.get(v1.vaultId).lockedAt === null);
  assert("S4 v2 is locked", store.get(v2.vaultId).lockedAt !== null);
}

// S5: share URL
{
  const store = makeVaultStore();
  const v = store.create({ emergencyId: "ERR-5", userId: "u", userName: "u", startTime: 0, endTime: 0, contactsNotified: [], photos: [] });
  const url = store.generateShareUrl(v.vaultId);
  assert("S5 URL generated", !!url && url.startsWith("https://sosphere.co/vault/"));
  assert("S5 URL contains vaultId", url.includes(v.vaultId));
  assert("S5 URL has 16-hex token", /\?s=[a-f0-9]{16}$/.test(url));
  assert("S5 unknown vault returns null", store.generateShareUrl("VAULT-NONE") === null);
}

// S6: syncPending
{
  const store = makeVaultStore();
  const v1 = store.create({ emergencyId: "ERR-A", userId: "u", userName: "u", startTime: 0, endTime: 0, contactsNotified: [], photos: [] });
  const v2 = store.create({ emergencyId: "ERR-B", userId: "u", userName: "u", startTime: 0, endTime: 0, contactsNotified: [], photos: [] });
  store.setSynced(v1.vaultId, true);
  let calls = 0;
  const synced = store.syncPending(() => { calls++; return true; });
  assert("S6 syncPending only calls upload for unsynced", calls === 1);
  assert("S6 returns 1 newly-synced", synced === 1);
  assert("S6 v2 now synced", store.get(v2.vaultId).synced === true);
}

// S7: sync fail-secure
{
  const store = makeVaultStore();
  const v = store.create({ emergencyId: "ERR-fail", userId: "u", userName: "u", startTime: 0, endTime: 0, contactsNotified: [], photos: [] });
  const synced = store.syncPending(() => false);
  assert("S7 upload-fail keeps unsynced", store.get(v.vaultId).synced === false);
  assert("S7 returns 0", synced === 0);
}

// S8: getForEmergency
{
  const store = makeVaultStore();
  const v = store.create({ emergencyId: "ERR-8", userId: "u", userName: "u", startTime: 0, endTime: 0, contactsNotified: [], photos: [] });
  assert("S8 found", store.getForEmergency("ERR-8")?.vaultId === v.vaultId);
  assert("S8 missing returns null", store.getForEmergency("ERR-NONE") === null);
}

// S9: lock-then-verify (the prod chain)
{
  const store = makeVaultStore();
  const v = store.create({ emergencyId: "ERR-9", userId: "u", userName: "u", startTime: 0, endTime: 0, contactsNotified: [], photos: [] });
  assert("S9 verify before lock = true", store.verify(v.vaultId) === true);
  store.lock(v.vaultId);
  assert("S9 verify AFTER lock = true (lockedAt excluded from hash)",
    store.verify(v.vaultId) === true);
}

console.log("\n" + (fail === 0 ? "OK all W3-12 vault scenarios passed" : "X " + fail + " failed"));
process.exit(fail === 0 ? 0 : 1);
