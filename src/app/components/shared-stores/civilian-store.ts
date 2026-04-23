// ═══════════════════════════════════════════════════════════════
// SOSphere — Civilian Shared Store
// ───────────────────────────────────────────────────────────────
// Single source of truth for ALL civilian user data.
// Every screen reads + writes through these hooks.
// Changes propagate automatically via useSyncExternalStore.
//
// HISTORIC COMPATIBILITY: the store reads/writes the SAME localStorage
// keys that existing screens read directly, so legacy code keeps
// working untouched. Migration from old-key (sosphere_emergency_contacts)
// → new-key (sosphere_safety_contacts) happens transparently on first
// read.
// ═══════════════════════════════════════════════════════════════

import { useSyncExternalStore, useMemo } from "react";
import {
  type SafetyContact,
  type ContactType,
  type ContactPlan,
  getSafetyContacts as rawGetContacts,
  saveSafetyContacts as rawSaveContacts,
  generateSafetyLink,
  determineContactType,
} from "../contact-tier-system";

// ═══════════════════════════════════════════════════════════════
// STORAGE KEYS (authoritative)
// ═══════════════════════════════════════════════════════════════
const KEYS = {
  contacts:    "sosphere_safety_contacts",         // canonical
  contactsOld: "sosphere_emergency_contacts",       // legacy — migrated
  profile:     "sosphere_user_profile",
  medical:     "sosphere_medical_id",
  incidents:   "sosphere_incident_history",
  subscription:"sosphere_subscription",
} as const;

// ═══════════════════════════════════════════════════════════════
// EVENT BUS — makes every useSyncExternalStore hook re-render
// when any mutation happens, in any tab or any direct localStorage
// write from legacy code.
// ═══════════════════════════════════════════════════════════════
const listeners = new Set<() => void>();

function notifyAll() {
  listeners.forEach(l => {
    try { l(); } catch { /* listener bugs don't cascade */ }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ── Hook into 'storage' events so legacy direct-write code ──
// is picked up even when it bypasses our store. This runs once.
if (typeof window !== "undefined" && !(window as { __sosphereStoreWired?: boolean }).__sosphereStoreWired) {
  (window as { __sosphereStoreWired?: boolean }).__sosphereStoreWired = true;
  window.addEventListener("storage", (e: StorageEvent) => {
    if (!e.key) return;
    if (Object.values(KEYS).includes(e.key as typeof KEYS[keyof typeof KEYS])) {
      invalidateAllCaches();
      notifyAll();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// CACHE LAYER — prevents JSON.parse on every render
// ═══════════════════════════════════════════════════════════════
let contactsCache: SafetyContact[] | null = null;
let profileCache: UserProfile | null = null;
let medicalCache: MedicalID | null = null;

function invalidateAllCaches() {
  contactsCache = null;
  profileCache = null;
  medicalCache = null;
}

// ═══════════════════════════════════════════════════════════════
// CONTACTS
// ═══════════════════════════════════════════════════════════════

/**
 * One-time migration: if legacy key has data but canonical key is empty,
 * copy legacy → canonical. Legacy writers (Family Circle, Home) stored
 * only { name, phone } — we expand those into minimal SafetyContact.
 */
function migrateLegacyContactsIfNeeded(): void {
  try {
    const canonical = localStorage.getItem(KEYS.contacts);
    if (canonical && canonical !== "[]") return; // already has data
    const legacy = localStorage.getItem(KEYS.contactsOld);
    if (!legacy) return;
    const parsed: { name: string; phone: string; relation?: string }[] = JSON.parse(legacy);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    const now = Date.now();
    const upgraded: SafetyContact[] = parsed
      .filter(c => c.name?.trim())
      .map((c, i) => ({
        id: `SC-MIG-${now.toString(36)}-${i}`,
        name: c.name,
        phone: c.phone || "",
        relation: c.relation || "Other",
        priority: i + 1,
        isFavorite: i === 0,
        type: (c.phone ? "ghost" : "ghost") as ContactType,
        hasApp: false,
        theirPlan: "free" as ContactPlan,
        trackingRole: "watcher",
        locationSharingEnabled: false,
        lastKnownLocation: null,
        locationUpdateFrequency: 0,
        safetyLinkId: null,
        safetyLinkExpiry: null,
        safetyLinkActive: false,
        isOnline: false,
        lastSeen: 0,
        batteryLevel: null,
        appStatus: "uninstalled" as const,
        consentGiven: false,
        consentTimestamp: null,
        totalAlertsReceived: 0,
        totalAlertsResponded: 0,
        avgResponseTime: 0,
        addedAt: now,
      }));
    if (upgraded.length) {
      rawSaveContacts(upgraded);
    }
  } catch { /* silent — migration is best-effort */ }
}

function readContacts(): SafetyContact[] {
  if (contactsCache !== null) return contactsCache;
  migrateLegacyContactsIfNeeded();
  contactsCache = rawGetContacts();
  return contactsCache;
}

function writeContacts(next: SafetyContact[]) {
  rawSaveContacts(next);
  // Also sync to legacy key so old readers (Family Circle, Home) stay consistent
  // until they migrate to the store. We store only the minimal shape they expect.
  try {
    const legacyShape = next.map(c => ({ name: c.name, phone: c.phone }));
    localStorage.setItem(KEYS.contactsOld, JSON.stringify(legacyShape));
  } catch { /* legacy sync best-effort */ }
  contactsCache = next;
  notifyAll();
}

export interface ContactsActions {
  add: (input: AddContactInput) => SafetyContact;
  update: (id: string, patch: Partial<SafetyContact>) => void;
  remove: (id: string) => void;
  setPrimary: (id: string) => void;
  toggleTracking: (id: string) => void;
  setAll: (list: SafetyContact[]) => void;
}

export interface AddContactInput {
  name: string;
  phone: string;        // canonical E.164 (e.g. "+9647728569514")
  relation: string;
  hasApp?: boolean;
  theirPlan?: ContactPlan;
  isFavorite?: boolean;
  priority?: number;
}

/**
 * useContacts — the ONLY way civilian screens should read/write contacts.
 *
 * Returns [list, actions].
 * Changes in any screen re-render every other screen automatically.
 */
export function useContacts(): [SafetyContact[], ContactsActions] {
  const list = useSyncExternalStore(
    subscribe,
    () => readContacts(),
    () => [] as SafetyContact[], // SSR default
  );

  const actions = useMemo<ContactsActions>(() => ({
    add: (input) => {
      const now = Date.now();
      const existing = readContacts();
      const hasApp = input.hasApp ?? false;
      const theirPlan = input.theirPlan ?? "free";
      const type = determineContactType(hasApp, theirPlan);
      const contact: SafetyContact = {
        id: `SC-${now.toString(36).toUpperCase()}`,
        name: input.name,
        phone: input.phone,
        relation: input.relation,
        priority: input.priority ?? existing.length + 1,
        isFavorite: input.isFavorite ?? false,
        type,
        hasApp,
        theirPlan,
        trackingRole: hasApp ? "mutual" : "watcher",
        locationSharingEnabled: hasApp,
        lastKnownLocation: null,
        locationUpdateFrequency: theirPlan === "pro" ? 30 : 300,
        safetyLinkId: null,
        safetyLinkExpiry: null,
        safetyLinkActive: false,
        isOnline: false,
        lastSeen: 0,
        batteryLevel: null,
        appStatus: hasApp ? "active" : "uninstalled",
        consentGiven: false,
        consentTimestamp: null,
        totalAlertsReceived: 0,
        totalAlertsResponded: 0,
        avgResponseTime: 0,
        addedAt: now,
      };
      if (type === "ghost") {
        const link = generateSafetyLink(contact.id, input.name);
        contact.safetyLinkId = link.linkId;
        contact.safetyLinkExpiry = link.expiry;
        contact.safetyLinkActive = true;
      }
      writeContacts([...existing, contact]);
      return contact;
    },
    update: (id, patch) => {
      const next = readContacts().map(c => (c.id === id ? { ...c, ...patch } : c));
      writeContacts(next);
    },
    remove: (id) => {
      writeContacts(readContacts().filter(c => c.id !== id));
    },
    setPrimary: (id) => {
      // Only ONE contact can be primary at a time.
      const next = readContacts().map(c => ({ ...c, isFavorite: c.id === id }));
      writeContacts(next);
    },
    toggleTracking: (id) => {
      const next = readContacts().map(c =>
        c.id === id ? { ...c, locationSharingEnabled: !c.locationSharingEnabled } : c
      );
      writeContacts(next);
    },
    setAll: (listInput) => {
      writeContacts(listInput);
    },
  }), []);

  return [list, actions];
}

// ═══════════════════════════════════════════════════════════════
// USER PROFILE (name, avatar, zone)
// ═══════════════════════════════════════════════════════════════

export interface UserProfile {
  name: string;
  avatarUrl: string;      // data URL or https://
  avatarInitials: string; // fallback (e.g. "FH")
  dateOfBirth: string;    // ISO date
  zone: string;           // e.g. "Baghdad, IQ"
  phone: string;          // canonical E.164
}

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  avatarUrl: "",
  avatarInitials: "",
  dateOfBirth: "",
  zone: "",
  phone: "",
};

function readProfile(): UserProfile {
  if (profileCache !== null) return profileCache;
  try {
    const raw = localStorage.getItem(KEYS.profile);
    profileCache = raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : { ...DEFAULT_PROFILE };
  } catch {
    profileCache = { ...DEFAULT_PROFILE };
  }
  return profileCache;
}

function writeProfile(next: UserProfile) {
  try {
    localStorage.setItem(KEYS.profile, JSON.stringify(next));
  } catch { /* quota errors silent */ }
  profileCache = next;
  notifyAll();
}

function initialsOf(name: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export interface ProfileActions {
  updateName: (name: string) => void;
  updateAvatar: (dataUrlOrHttps: string) => void;
  removeAvatar: () => void;
  updateZone: (zone: string) => void;
  updatePhone: (e164: string) => void;
  update: (patch: Partial<UserProfile>) => void;
}

export function useProfile(): [UserProfile, ProfileActions] {
  const profile = useSyncExternalStore(
    subscribe,
    () => readProfile(),
    () => DEFAULT_PROFILE,
  );

  const actions = useMemo<ProfileActions>(() => ({
    updateName: (name) => {
      const next = { ...readProfile(), name, avatarInitials: initialsOf(name) };
      writeProfile(next);
    },
    updateAvatar: (url) => {
      writeProfile({ ...readProfile(), avatarUrl: url });
    },
    removeAvatar: () => {
      writeProfile({ ...readProfile(), avatarUrl: "" });
    },
    updateZone: (zone) => {
      writeProfile({ ...readProfile(), zone });
    },
    updatePhone: (phone) => {
      writeProfile({ ...readProfile(), phone });
    },
    update: (patch) => {
      const current = readProfile();
      const merged = { ...current, ...patch };
      if (patch.name !== undefined) merged.avatarInitials = initialsOf(patch.name);
      writeProfile(merged);
    },
  }), []);

  return [profile, actions];
}

// ═══════════════════════════════════════════════════════════════
// MEDICAL ID
// ═══════════════════════════════════════════════════════════════

export interface MedicalID {
  bloodType: string;
  height: string;
  weight: string;
  dateOfBirth: string;
  conditions: string[];
  allergies: string[];
  medications: string[];
  emergencyMedicalContact: { name: string; phone: string; relation: string };
  notes: string;
  organDonor: boolean;
}

const DEFAULT_MEDICAL: MedicalID = {
  bloodType: "",
  height: "",
  weight: "",
  dateOfBirth: "",
  conditions: [],
  allergies: [],
  medications: [],
  emergencyMedicalContact: { name: "", phone: "", relation: "" },
  notes: "",
  organDonor: false,
};

function readMedical(): MedicalID {
  if (medicalCache !== null) return medicalCache;
  try {
    const raw = localStorage.getItem(KEYS.medical);
    medicalCache = raw ? { ...DEFAULT_MEDICAL, ...JSON.parse(raw) } : { ...DEFAULT_MEDICAL };
  } catch {
    medicalCache = { ...DEFAULT_MEDICAL };
  }
  return medicalCache;
}

function writeMedical(next: MedicalID) {
  try {
    localStorage.setItem(KEYS.medical, JSON.stringify(next));
  } catch { /* quota errors silent */ }
  medicalCache = next;
  notifyAll();
}

export interface MedicalActions {
  update: (patch: Partial<MedicalID>) => void;
  addCondition: (c: string) => void;
  removeCondition: (index: number) => void;
  addAllergy: (a: string) => void;
  removeAllergy: (index: number) => void;
  addMedication: (m: string) => void;
  removeMedication: (index: number) => void;
  setEmergencyMedicalContact: (c: MedicalID["emergencyMedicalContact"]) => void;
}

export function useMedical(): [MedicalID, MedicalActions] {
  const medical = useSyncExternalStore(
    subscribe,
    () => readMedical(),
    () => DEFAULT_MEDICAL,
  );

  const actions = useMemo<MedicalActions>(() => ({
    update: (patch) => writeMedical({ ...readMedical(), ...patch }),
    addCondition: (c) => {
      if (!c.trim()) return;
      const cur = readMedical();
      writeMedical({ ...cur, conditions: [...cur.conditions, c.trim()] });
    },
    removeCondition: (i) => {
      const cur = readMedical();
      writeMedical({ ...cur, conditions: cur.conditions.filter((_, idx) => idx !== i) });
    },
    addAllergy: (a) => {
      if (!a.trim()) return;
      const cur = readMedical();
      writeMedical({ ...cur, allergies: [...cur.allergies, a.trim()] });
    },
    removeAllergy: (i) => {
      const cur = readMedical();
      writeMedical({ ...cur, allergies: cur.allergies.filter((_, idx) => idx !== i) });
    },
    addMedication: (m) => {
      if (!m.trim()) return;
      const cur = readMedical();
      writeMedical({ ...cur, medications: [...cur.medications, m.trim()] });
    },
    removeMedication: (i) => {
      const cur = readMedical();
      writeMedical({ ...cur, medications: cur.medications.filter((_, idx) => idx !== i) });
    },
    setEmergencyMedicalContact: (c) => {
      writeMedical({ ...readMedical(), emergencyMedicalContact: c });
    },
  }), []);

  return [medical, actions];
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION HELPERS — exported so every editor uses the same rules
// ═══════════════════════════════════════════════════════════════

/**
 * E.164 validator — normalises "00" international prefix to "+".
 * Accepts: "+9647728569514", "009647728569514", "+1-202-555-0123"
 * Rejects: "asdf", "0", strings with leading zero, < 8 or > 15 digits.
 */
export function isValidE164(phone: string | undefined | null): boolean {
  if (!phone) return false;
  let s = String(phone).replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  return /^\+?[1-9]\d{7,14}$/.test(s);
}

/** Normalise to canonical E.164 form (leading +, digits only). */
export function normaliseE164(phone: string): string {
  let s = String(phone).replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) s = "+" + s;
  return s;
}

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
export function isValidBloodType(b: string): boolean {
  return BLOOD_TYPES.includes(b);
}

/** Returns "HA" for "Hadi Ahmed", "F" for "Fadi", "" for "" */
export function profileInitials(name: string): string {
  return initialsOf(name);
}
