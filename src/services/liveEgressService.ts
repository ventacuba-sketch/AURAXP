import { supabase } from './supabaseClient';

export type LiveSocialPlatform = 'tiktok' | 'instagram' | 'facebook';
export interface DestinationStatus { platform: LiveSocialPlatform; enabled: boolean; updated_at?: string }

async function invoke(body: Record<string, unknown>) {
  if (!supabase) return { ok: false, error: 'backend_not_configured' } as any;
  const { data, error } = await supabase.functions.invoke('livekit-multistream', { body });
  if (error) return { ok: false, error: error.message } as any;
  return data as any;
}

export async function listSocialDestinations(): Promise<DestinationStatus[]> {
  const result = await invoke({ action: 'list' });
  return result?.ok && Array.isArray(result.destinations) ? result.destinations : [];
}

export async function configureSocialDestination(platform: LiveSocialPlatform, rtmpUrl: string, streamKey: string): Promise<{ ok: boolean; error?: string }> {
  const result = await invoke({ action: 'configure', platform, rtmpUrl, streamKey });
  return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? 'configure_failed' };
}

export async function startExternalStreams(roomId: string, platforms: LiveSocialPlatform[]): Promise<{ ok: boolean; error?: string }> {
  if (!platforms.length) return { ok: true };
  const result = await invoke({ action: 'start', roomId, platforms });
  return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? 'start_failed' };
}

export async function stopExternalStreams(roomId: string): Promise<{ ok: boolean }> {
  const result = await invoke({ action: 'stop', roomId });
  return { ok: Boolean(result?.ok) };
}
