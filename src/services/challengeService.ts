import * as Crypto from 'expo-crypto';

import { ChallengePreview } from '../types';
import { getSession } from './authService';
import { supabase } from './supabaseClient';

/** Corto y URL-friendly — no hace falta un UUID completo para un share_token. */
function generateShareToken(): string {
  return Crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

export async function createChallenge(sourceScanId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const session = await getSession();
  if (!session) throw new Error('No autenticado');

  const shareToken = generateShareToken();
  const { error } = await supabase
    .from('challenges')
    .insert({ share_token: shareToken, source_scan_id: sourceScanId, from_user_id: session.user.id });
  if (error) throw error;

  return shareToken;
}

/** Pública — no requiere sesión. Usada tanto por la landing web como por el deep link nativo. */
export async function fetchChallengePreview(token: string): Promise<ChallengePreview | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.functions.invoke('get-challenge-preview', {
    body: { token },
  });
  if (error || !data || data.error) return null;
  return data as ChallengePreview;
}
