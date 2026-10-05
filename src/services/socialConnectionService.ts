import { supabase } from './supabaseClient';
import type { LiveSocialPlatform } from './liveEgressService';

export type SocialConnectionStatus = 'pending' | 'connected' | 'expired' | 'revoked' | 'error';
export interface SocialConnection {
  platform: LiveSocialPlatform;
  status: SocialConnectionStatus;
  external_account_name?: string | null;
  connected_at?: string | null;
  token_expires_at?: string | null;
  last_error_code?: string | null;
  updated_at?: string;
}

async function invoke(body: Record<string, unknown>) {
  if (!supabase) return { ok: false, error: 'backend_not_configured' } as any;
  const { data, error } = await supabase.functions.invoke('social-connections', { body });
  if (error) return { ok: false, error: error.message } as any;
  return data as any;
}

export async function listSocialConnections(): Promise<SocialConnection[]> {
  const result = await invoke({ action: 'list' });
  return result?.ok && Array.isArray(result.connections) ? result.connections : [];
}

export async function beginSocialConnection(platform: LiveSocialPlatform): Promise<{ ok: boolean; authorizeUrl?: string; error?: string }> {
  const result = await invoke({ action: 'begin', platform });
  return result?.ok ? { ok: true, authorizeUrl: result.authorizeUrl } : { ok: false, error: result?.error ?? 'connect_failed' };
}

export async function disconnectSocialConnection(platform: LiveSocialPlatform): Promise<{ ok: boolean; error?: string }> {
  const result = await invoke({ action: 'disconnect', platform });
  return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? 'disconnect_failed' };
}
