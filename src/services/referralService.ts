import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { getSession } from './authService';
import { supabase } from './supabaseClient';

/**
 * Referidos (bloque social) -- mismo patrón que pendingChallenge.ts:
 * persiste el código de invitación por fuera de la navegación (se
 * pierde en el camino a Auth, ver ese archivo para el motivo completo),
 * y lo consume UNA sola vez apenas hay sesión real. El PREMIO nunca sale
 * de acá -- eso lo decide el trigger server-side cuando el referido
 * completa su primer Scan (ver la migración); esto solo REGISTRA la
 * atribución.
 */
const STORAGE_KEY = 'auraxp_pending_referral_code';

/** Captura `?ref=CODE` de la URL apenas carga la app (web) -- solo si
 * todavía no hay uno guardado, para no pisar el código real de una
 * visita anterior con una navegación interna sin ese param. Llamar una
 * vez al boot (App.tsx). */
export function captureReferralFromUrl(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const code = new URLSearchParams(window.location.search).get('ref');
    if (!code) return;
    AsyncStorage.getItem(STORAGE_KEY).then((existing) => {
      if (!existing) AsyncStorage.setItem(STORAGE_KEY, code.toUpperCase());
    });
  } catch {
    // best-effort -- sin código capturado, el flujo normal sigue igual,
    // solo sin atribución de referido.
  }
}

/** Llamar apenas hay sesión real (RootNavigator, mismo punto que
 * consumePendingChallengeToken). Un solo intento real: se borra el
 * código guardado ANTES de llamar al RPC, así que un resultado ya
 * resuelto (o un error) nunca vuelve a reintentarse en la sesión
 * siguiente con el mismo código viejo. */
export async function tryAttributePendingReferral(): Promise<void> {
  if (!supabase) return;
  try {
    const code = await AsyncStorage.getItem(STORAGE_KEY);
    if (!code) return;
    const session = await getSession();
    if (!session) return;
    await AsyncStorage.removeItem(STORAGE_KEY);
    await supabase.rpc('attribute_referral', { p_code: code });
  } catch {
    // best-effort -- nunca debe bloquear el login.
  }
}

export interface ReferralInfo {
  code: string;
  shareUrl: string;
}

export async function fetchMyReferralInfo(): Promise<ReferralInfo | null> {
  if (!supabase) return null;
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('profiles').select('referral_code').eq('id', session.user.id).maybeSingle();
  if (error || !data?.referral_code) return null;
  return { code: data.referral_code, shareUrl: `https://auravs.app/?ref=${data.referral_code}` };
}

export interface ReferralStats {
  totalReferred: number;
  totalActivated: number;
}

export async function fetchMyReferralStats(): Promise<ReferralStats> {
  const empty = { totalReferred: 0, totalActivated: 0 };
  if (!supabase) return empty;
  const session = await getSession();
  if (!session) return empty;
  const { data, error } = await supabase.from('referrals').select('activated_at').eq('referrer_id', session.user.id);
  if (error || !data) return empty;
  return {
    totalReferred: data.length,
    totalActivated: data.filter((r) => r.activated_at).length,
  };
}
