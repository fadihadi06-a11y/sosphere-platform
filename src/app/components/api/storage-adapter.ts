// =================================================================
// SOSphere — Storage Adapter (localStorage → Supabase Bridge)
// =================================================================
// Unified interface for all persistent storage operations.
//
// Currently: Uses localStorage (prototype)
// Production: Swap adapter to Supabase DB + Supabase Storage
//
// All existing stores use this pattern:
//   const STORAGE_KEY = "sosphere_xxx";
//   localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
//   JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
//
// This adapter abstracts that so swapping is a ONE-LINE change:
//   setStorageBackend("supabase");
// =================================================================

// ── Backend Types ─────────────────────────────────────────────────

export type StorageBackend = "localStorage" | "supabase";

let activeBackend: StorageBackend = "localStorage";

export function setStorageBackend(backend: StorageBackend) {
  activeBackend = backend;
}

export function getStorageBackend(): StorageBackend {
  return activeBackend;
}

// ── Supabase Config (filled when connected) ─────────────────────

interface SupabaseStorageConfig {
  client: any; // SupabaseClient — typed `any` until connected
  bucketName: string; // For file storage (photos, audio)
}

let supabaseConfig: SupabaseStorageConfig | null = null;

export function configureSupabaseStorage(config: SupabaseStorageConfig) {
  supabaseConfig = config;
}

// =================================================================
// Key-Value Storage (for JSON data)
// Maps to: localStorage → Supabase "app_state" table
// =================================================================

/**
 * Store a JSON-serializable value.
 * @param key - Storage key (e.g., "sosphere_ire_performance")
 * @param value - Any JSON-serializable value
 * @param table - Supabase table name (used in production mode)
 */
export async function storeJSON<T>(
  key: string,
  value: T,
  table = "app_state",
): Promise<void> {
  if (activeBackend === "supabase" && supabaseConfig) {
    // PRODUCTION:
    // await supabaseConfig.client
    //   .from(table)
    //   .upsert({
    //     key,
    //     value: JSON.stringify(value),
    //     updated_at: new Date().toISOString(),
    //   }, { onConflict: "key" });
    return;
  }

  // localStorage mode
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[Storage] Failed to write key "${key}":`, e);
  }
}

/**
 * Retrieve a JSON value by key.
 * @param key - Storage key
 * @param defaultValue - Returned if key doesn't exist
 * @param table - Supabase table name (used in production mode)
 */
export async function loadJSON<T>(
  key: string,
  defaultValue: T,
  table = "app_state",
): Promise<T> {
  if (activeBackend === "supabase" && supabaseConfig) {
    // PRODUCTION:
    // const { data, error } = await supabaseConfig.client
    //   .from(table)
    //   .select("value")
    //   .eq("key", key)
    //   .single();
    // if (error || !data) return defaultValue;
    // return JSON.parse(data.value) as T;
    return defaultValue;
  }

  // localStorage mode
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Delete a key.
 */
export async function removeJSON(key: string, table = "app_state"): Promise<void> {
  if (activeBackend === "supabase" && supabaseConfig) {
    // PRODUCTION:
    // await supabaseConfig.client
    //   .from(table)
    //   .delete()
    //   .eq("key", key);
    return;
  }

  localStorage.removeItem(key);
}

// =================================================================
// Sync-compatible versions (non-async — for current codebase)
// These work only in localStorage mode. In Supabase mode, use async.
// =================================================================

export function storeJSONSync<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`[Storage] Sync write failed for "${key}":`, e);
  }
}

export function loadJSONSync<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function removeJSONSync(key: string): void {
  localStorage.removeItem(key);
}

// =================================================================
// File Storage (for photos, audio, PDFs)
// Maps to: base64 in localStorage → Supabase Storage bucket
// =================================================================

export interface StoredFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string; // In localStorage: data URL. In Supabase: public/signed URL.
  uploadedAt: number;
}

/**
 * Upload a file (photo, audio, PDF).
 * @param path - File path in bucket (e.g., "evidence/EMG-001/photo-1.jpg")
 * @param data - Base64 data URL or Blob
 * @param metadata - Additional metadata
 */
export async function uploadFile(
  path: string,
  data: string | Blob,
  metadata?: { mimeType?: string; name?: string },
): Promise<StoredFile> {
  const id = `FILE-${Date.now().toString(36)}`;
  const now = Date.now();

  if (activeBackend === "supabase" && supabaseConfig) {
    // PRODUCTION:
    // const blob = typeof data === "string"
    //   ? await (await fetch(data)).blob()  // Convert data URL to Blob
    //   : data;
    //
    // const { data: uploadData, error } = await supabaseConfig.client
    //   .storage
    //   .from(supabaseConfig.bucketName)
    //   .upload(path, blob, {
    //     contentType: metadata?.mimeType || "application/octet-stream",
    //     upsert: true,
    //   });
    //
    // if (error) throw new Error(`File upload failed: ${error.message}`);
    //
    // const { data: urlData } = supabaseConfig.client
    //   .storage
    //   .from(supabaseConfig.bucketName)
    //   .getPublicUrl(path);
    //
    // return {
    //   id,
    //   name: metadata?.name || path.split("/").pop() || "file",
    //   mimeType: metadata?.mimeType || "application/octet-stream",
    //   size: blob.size,
    //   url: urlData.publicUrl,
    //   uploadedAt: now,
    // };
  }

  // localStorage mode — store as data URL
  const dataUrl = typeof data === "string" ? data : await blobToDataUrl(data);
  const file: StoredFile = {
    id,
    name: metadata?.name || path.split("/").pop() || "file",
    mimeType: metadata?.mimeType || "application/octet-stream",
    size: dataUrl.length,
    url: dataUrl,
    uploadedAt: now,
  };

  // Store in localStorage (limited to ~5MB total)
  const filesIndex = loadJSONSync<string[]>("sosphere_files_index", []);
  filesIndex.push(id);
  storeJSONSync("sosphere_files_index", filesIndex);
  storeJSONSync(`sosphere_file_${id}`, file);

  return file;
}

/**
 * Get a stored file by ID.
 */
export async function getFile(id: string): Promise<StoredFile | null> {
  if (activeBackend === "supabase" && supabaseConfig) {
    // PRODUCTION:
    // const { data, error } = await supabaseConfig.client
    //   .from("files")
    //   .select("*")
    //   .eq("id", id)
    //   .single();
    // if (error) return null;
    // return data as StoredFile;
  }

  return loadJSONSync<StoredFile | null>(`sosphere_file_${id}`, null);
}

// =================================================================
// Real-time Cross-Tab Communication
// Maps to: StorageEvent → Supabase Realtime Broadcast
// =================================================================

export type BroadcastCallback = (data: any) => void;

/**
 * Broadcast a message to all connected clients.
 * Currently: Uses localStorage StorageEvent (same browser only)
 * Production: Uses Supabase Realtime Broadcast (cross-device)
 */
export function broadcast(channel: string, data: any): void {
  if (activeBackend === "supabase" && supabaseConfig) {
    // PRODUCTION:
    // supabaseConfig.client
    //   .channel(channel)
    //   .send({
    //     type: "broadcast",
    //     event: "message",
    //     payload: data,
    //   });
    return;
  }

  // localStorage mode
  const payload = JSON.stringify({ ...data, _channel: channel, _ts: Date.now() });
  localStorage.setItem(`sosphere_broadcast_${channel}`, payload);
  window.dispatchEvent(new StorageEvent("storage", {
    key: `sosphere_broadcast_${channel}`,
    newValue: payload,
  }));
}

/**
 * Subscribe to broadcast messages on a channel.
 */
export function onBroadcast(channel: string, callback: BroadcastCallback): () => void {
  if (activeBackend === "supabase" && supabaseConfig) {
    // PRODUCTION:
    // const ch = supabaseConfig.client
    //   .channel(channel)
    //   .on("broadcast", { event: "message" }, (payload: any) => {
    //     callback(payload.payload);
    //   })
    //   .subscribe();
    //
    // return () => { supabaseConfig.client.removeChannel(ch); };
    return () => {};
  }

  // localStorage mode
  const key = `sosphere_broadcast_${channel}`;
  const handler = (e: StorageEvent) => {
    if (e.key === key && e.newValue) {
      try { callback(JSON.parse(e.newValue)); } catch {}
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

// =================================================================
// Migration Utilities
// =================================================================

/**
 * List all SOSphere keys in localStorage.
 * Useful for migration: dump all data → upload to Supabase.
 */
export function listAllLocalKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("sosphere_")) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Export all localStorage data as a JSON object.
 * Can be imported into Supabase during migration.
 */
export function exportAllLocalData(): Record<string, any> {
  const data: Record<string, any> = {};
  listAllLocalKeys().forEach(key => {
    try {
      data[key] = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      data[key] = localStorage.getItem(key);
    }
  });
  return data;
}

// =================================================================
// Helpers
// =================================================================

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
