// ═══════════════════════════════════════════════════════════════
// SOSphere — API Keys Service
// Thin client over the admin-gated SECURITY DEFINER RPCs
// (create_api_key / list_api_keys / revoke_api_key). The raw key is
// returned ONCE by create; only a SHA-256 hash is stored server-side.
// ═══════════════════════════════════════════════════════════════
import { supabase } from "./api/supabase-client";

export interface ApiKeyMeta {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Create a new API key. Returns the RAW key exactly once — store it now. */
export async function createApiKey(
  companyId: string,
  name: string,
): Promise<{ ok: boolean; apiKey?: string; prefix?: string; error?: string }> {
  const { data, error } = await supabase.rpc("create_api_key", {
    p_company_id: companyId,
    p_name: name,
  });
  if (error) return { ok: false, error: error.message };
  const d = (data ?? {}) as { ok?: boolean; api_key?: string; prefix?: string };
  return { ok: !!d.ok, apiKey: d.api_key, prefix: d.prefix };
}

/** List a company's API keys (safe metadata only — never the hash). */
export async function listApiKeys(companyId: string): Promise<ApiKeyMeta[]> {
  const { data, error } = await supabase.rpc("list_api_keys", { p_company_id: companyId });
  if (error) return [];
  return (data as ApiKeyMeta[]) ?? [];
}

/** Revoke an API key by id. */
export async function revokeApiKey(keyId: string): Promise<boolean> {
  const { error } = await supabase.rpc("revoke_api_key", { p_key_id: keyId });
  return !error;
}
